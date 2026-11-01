import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { createAIAdapter } from "../lib/server/ai/adapter.ts";
import { createSDKTransport } from "../lib/server/ai/sdk-transport.ts";
import { createOpenAITransport } from "../lib/server/ai/openai-transport.ts";
import { FailureSchema, MAX_INPUT_BYTES, resultEnvelopeSchema, TransportFailure } from "../lib/server/ai/contracts.ts";
import type { AdapterResult, FailureCode, InvocationInput, OutputContract, StructuredTransport } from "../lib/server/ai/contracts.ts";
import { loadSyntheticDealFixture } from "../lib/fixtures/synthetic-deal.ts";

const deal = loadSyntheticDealFixture();
const appId = deal.applications[0].app_id;
const licenseId = deal.license_positions[0].license_id;
const tsaId = deal.tsa_services[0].tsa_id;
const canary = "private-test-context-must-not-be-logged";
const fakeKey = "test-only-key-must-not-be-logged";
const input: InvocationInput = { module: "assistant", prompt_version: "contract-check/v1", system: "Return the caller's generic structured record shape.", context: { deal, user_text: canary }, allowed_source_ids: [appId, licenseId, tsaId] };
const schema = z.strictObject({ status: z.enum(["noted"]), source_ids: z.array(z.string()) });
type Data = z.infer<typeof schema>;
const contract: OutputContract<Data> = { schema, references: { extract: (data) => data.source_ids, allow_empty: false, duplicates: "reject" } };
const valid = { status: "noted", source_ids: [appId, licenseId, tsaId] };
let dispatches = 0;
const fake = (...outputs: unknown[]): StructuredTransport => ({ model_provider: "mock", model_id: "offline-model-version-1", generate: async () => { dispatches++; return { output: outputs.length ? outputs[0] : valid }; } });
const logs: string[] = [];
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden in adapter validation"); };
console.log = console.warn = console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
let passed = 0;
async function check(name: string, run: () => Promise<void>) { await run(); passed++; originalLog(`PASS: ${name}`); }
function expectFailure(result: AdapterResult<unknown>, code: FailureCode) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected safe failure");
  FailureSchema.parse(result);
  assert.equal(result.error.code, code);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${canary}|${fakeKey}`));
  return result;
}

try {
  await check("valid result has strictly validated G1 provenance and unknown usage/cost", async () => {
    const invoke = createAIAdapter(fake());
    const result = await invoke(input, contract);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Expected successful offline result");
    resultEnvelopeSchema(schema).parse(result.result);
    assert.deepEqual(result.result.data, valid);
    assert.equal(result.result.module, input.module);
    assert.equal(result.result.prompt_version, input.prompt_version);
    assert.equal(result.result.model_id, "offline-model-version-1");
    assert.equal(result.result.model_provider, "mock"); assert.equal(result.result.mode, "paid");
    assert.match(result.result.input_digest, /^[a-f0-9]{64}$/); assert.ok(result.result.request_id);
    assert.deepEqual(result.result.usage_estimate, { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null });
    assert.deepEqual(result.result.warnings, ["ai_generated_draft", "references_not_narrative_verification"]);
    const again = await invoke(input, contract);
    assert.ok(again.ok);
    assert.equal(again.result.input_digest, result.result.input_digest);
    assert.notEqual(again.result.request_id, result.result.request_id);
    assert.doesNotMatch(JSON.stringify(result.result), new RegExp(canary));
  });
  await check("actual SDK generateText + Output.object path works with an offline V4 model", async () => {
    const model = new MockLanguageModelV4({ provider: "mock", modelId: "offline-sdk-model-v1", doGenerate: {
      content: [{ type: "text", text: JSON.stringify(valid) }], finishReason: { unified: "stop", raw: "stop" }, warnings: [],
      usage: { inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 7, text: 7, reasoning: 0 } },
    } });
    const result = await createAIAdapter(createSDKTransport(model, "mock"))(input, contract);
    assert.ok(result.ok);
    assert.deepEqual(result.result.usage_estimate, { input_tokens: 11, output_tokens: 7, total_tokens: 18, cost_usd: null });
    assert.equal(model.doGenerateCalls.length, 1);
    const call = model.doGenerateCalls[0];
    assert.equal(call.responseFormat?.type, "json");
    assert.equal(call.providerOptions?.openai?.store, false);
    assert.equal(call.maxOutputTokens, 2048);
    assert.ok(call.prompt[0].role === "system");
    assert.ok(JSON.stringify(call.prompt).includes("untrusted_context"));
  });
  await check("hallucinated, out-of-scope and malformed app/license/TSA IDs are rejected", async () => {
    for (const id of ["app-wellformed-but-absent", "lic-wellformed-but-absent", "tsa-wellformed-but-absent", deal.applications[1].app_id, "", "bad id"]) {
      expectFailure(await createAIAdapter(fake({ status: "noted", source_ids: [id] }))(input, contract), "invalid_model_output");
    }
  });
  await check("duplicate and empty citations follow explicit caller reference policy", async () => {
    expectFailure(await createAIAdapter(fake({ status: "noted", source_ids: [appId, appId] }))(input, contract), "invalid_model_output");
    expectFailure(await createAIAdapter(fake({ status: "noted", source_ids: [] }))(input, contract), "invalid_model_output");
    assert.ok((await createAIAdapter(fake({ status: "noted", source_ids: [] }))(input, { ...contract, references: { ...contract.references, allow_empty: true } })).ok);
    assert.ok((await createAIAdapter(fake({ status: "noted", source_ids: [appId, appId] }))(input, { ...contract, references: { ...contract.references, duplicates: "allow" } })).ok);
  });
  await check("wrong output shape/enum/type, missing refs, extra fields and empty output fail safely", async () => {
    for (const output of [null, undefined, {}, "", { status: "wrong", source_ids: [appId] }, { status: "noted", source_ids: 1 }, { status: "noted" }, { ...valid, extra: "not allowed" }]) {
      expectFailure(await createAIAdapter(fake(output))(input, contract), "invalid_model_output");
    }
    // Even a caller schema with default stripping cannot silently discard fields.
    expectFailure(await createAIAdapter(fake({ ...valid, extra: true }))(input, { ...contract, schema: z.object(schema.shape) }), "invalid_model_output");
  });
  await check("SDK-invalid structured JSON maps to invalid_model_output without provider text", async () => {
    const model = new MockLanguageModelV4({ doGenerate: {
      content: [{ type: "text", text: "not JSON" }], finishReason: { unified: "stop", raw: "stop" }, warnings: [],
      usage: { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } },
    } });
    expectFailure(await createAIAdapter(createSDKTransport(model, "mock"))(input, contract), "invalid_model_output");
  });
  await check("invalid module, versions, source allowlists, context and client credentials fail before dispatch", async () => {
    const before = dispatches;
    const invalid = [
      { ...input, module: "cost" }, { ...input, prompt_version: "unversioned" }, { ...input, system: " " },
      { ...input, allowed_source_ids: [] }, { ...input, allowed_source_ids: [appId, appId] },
      { ...input, allowed_source_ids: ["app-absent"] }, { ...input, allowed_source_ids: ["bad id"] },
      { ...input, apiKey: fakeKey }, { ...input, context: { ...input.context, deal: {} } },
    ];
    for (const request of invalid) expectFailure(await createAIAdapter(fake())(request as InvocationInput, contract), "invalid_input");
    assert.equal(dispatches, before);
  });
  await check("prompt/context/ID count and raw byte limits fail before dispatch", async () => {
    const before = dispatches;
    for (const request of [{ ...input, system: "x".repeat(4001) }, { ...input, context: { ...input.context, user_text: "x".repeat(2001) } }, { ...input, allowed_source_ids: Array.from({ length: 401 }, () => appId) }, { ...input, system: "x".repeat(MAX_INPUT_BYTES) }]) {
      expectFailure(await createAIAdapter(fake())(request, contract), "request_too_large");
    }
    assert.equal(dispatches, before);
  });
  await check("missing model config and invalid reference contracts cannot dispatch", async () => {
    const before = dispatches;
    expectFailure(await createAIAdapter({ ...fake(), model_id: "" })(input, contract), "invalid_input");
    expectFailure(await createAIAdapter(fake())(input, { ...contract, references: { ...contract.references, duplicates: "invalid" } } as unknown as OutputContract<Data>), "invalid_input");
    assert.equal(dispatches, before);
  });
  await check("provider exceptions, typed unavailable and timeout are safe and bounded", async () => {
    expectFailure(await createAIAdapter({ ...fake(), generate: async () => { throw new Error(`${fakeKey} ${canary}`); } })(input, contract), "provider_unavailable");
    expectFailure(await createAIAdapter({ ...fake(), generate: async () => { throw new TransportFailure("provider_unavailable"); } })(input, contract), "provider_unavailable");
    let signal: AbortSignal | undefined;
    expectFailure(await createAIAdapter({ ...fake(), generate: async (call) => { signal = call.signal; return new Promise(() => {}); } }, { timeoutMs: 5 })(input, contract), "provider_unavailable");
    assert.equal(signal?.aborted, true);
  });
  await check("reference extractor exceptions and invalid usage cannot leak raw messages", async () => {
    expectFailure(await createAIAdapter(fake())(input, { ...contract, references: { ...contract.references, extract: () => { throw new Error(`${canary} ${fakeKey}`); } } }), "unexpected_error");
    expectFailure(await createAIAdapter({ ...fake(), generate: async () => ({ output: valid, usage: { inputTokens: -1 } }) })(input, contract), "invalid_model_output");
  });
  await check("transport cannot mutate the authoritative source-ID allowlist", async () => {
    const transport = { ...fake(), generate: async (call: Parameters<StructuredTransport["generate"]>[0]) => { call.input.allowed_source_ids.push("app-invented"); return { output: { status: "noted", source_ids: ["app-invented"] } }; } };
    expectFailure(await createAIAdapter(transport)(input, contract), "invalid_model_output");
    assert.deepEqual(input.allowed_source_ids, [appId, licenseId, tsaId]);
  });
  await check("live factory is hard-disabled with no configuration and cannot be enabled by env alone", async () => {
    expectFailure(await createAIAdapter(createOpenAITransport({}))(input, contract), "ai_not_enabled");
    expectFailure(await createAIAdapter(createOpenAITransport({ AIVRA_AI_ENABLED: "true" }))(input, contract), "invalid_input");
    const live = createOpenAITransport({ AIVRA_AI_ENABLED: "true", OPENAI_API_KEY: fakeKey, AIVRA_PAID_MODEL_ID: "unapproved-configurable-id" });
    expectFailure(await createAIAdapter(live)(input, contract), "ai_controls_not_ready");
    await assert.rejects(() => live.generate({ input, schema, signal: new AbortController().signal }), (error: unknown) => error instanceof TransportFailure && error.code === "ai_controls_not_ready");
    assert.equal(networkAttempts, 0);
  });
  await check("server-only marker rejects ordinary import; only inert ALA availability route is allowed", async () => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/ai/adapter.ts')"], { encoding: "utf8", timeout: 5000 });
    assert.notEqual(child.status, 0); assert.match(child.stderr, /cannot be imported from a Client Component/);
    for (const directory of ["app", "components"]) {
      for (const file of await readdir(directory, { recursive: true })) {
        if (!/\.(tsx?|jsx?)$/.test(file)) continue;
        assert.doesNotMatch(await readFile(`${directory}/${file}`, "utf8"), /server\/ai|OPENAI_API_KEY/);
      }
    }
    const api = (await readdir("app", { recursive: true })).map((file) => file.replaceAll("\\", "/")).filter((file) => /^api(?:\/|$)/.test(file)).sort();
    assert.deepEqual(api, ["api", "api/ai", "api/ai/ala", "api/ai/ala/route.ts"]);
    const route = await readFile("app/api/ai/ala/route.ts", "utf8");
    assert.match(route, /export function POST\(\)/); assert.match(route, /status: 503/);
    assert.doesNotMatch(route, /\bimport\s|process\.env|createAI|fake-usage|\b(?:request|req)\.(?:json|text|arrayBuffer|body)/);
  });
  assert.equal(networkAttempts, 0);
  assert.ok(logs.every((line) => !line.includes(canary) && !line.includes(fakeKey)));
  originalLog(`PASS: ${passed} focused adapter groups; zero network attempts, model API requests or charges. No prior-unit suites run.`);
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalLog; console.warn = originalWarn; console.error = originalError;
}
