import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { setup, specimen } from "./check-playbook-contract.mts";
import { createDemoSession, updateApplication, updateLicense, updateTSA } from "../lib/session/session.ts";
import { buildPlaybookInvocation } from "../lib/server/playbook/request.ts";
import { createPlaybookGenerator, PlaybookOutcomeSchema, validatePlaybookEnvelope } from "../lib/server/playbook/generate.ts";
import type { PlaybookOutcome } from "../lib/server/playbook/generate.ts";
import { PlaybookResultSchema, PLAYBOOK_OUTPUT_CONTRACT } from "../lib/server/playbook/schema.ts";
import { validateInvocation } from "../lib/server/ai/adapter.ts";
import { createAIRouter } from "../lib/server/ai/router.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { EnabledPolicySchema, reservationUnits } from "../lib/server/ai/control-policy.ts";
import type { EnabledPolicy } from "../lib/server/ai/control-policy.ts";
import { createOpenAITransport } from "../lib/server/ai/openai-transport.ts";
import { createSDKTransport } from "../lib/server/ai/sdk-transport.ts";
import { InvocationSchema, MAX_INPUT_BYTES, TransportFailure } from "../lib/server/ai/contracts.ts";
import type { InvocationInput, StructuredTransport } from "../lib/server/ai/contracts.ts";
import type { UsageStore } from "../lib/server/ai/usage-store.ts";
import { POST, runtime } from "../app/api/ai/playbook/route.ts";
import { POST as ALA_POST } from "../app/api/ai/ala/route.ts";

// Fabricated model content, approvals/rates, caller and stores: OFFLINE TESTS ONLY.
const start = Date.UTC(2026, 10, 4, 12), caller = { client_key: "a".repeat(64) };
const canary = "private-offline-provider-error";
function policy(patch: Partial<EnabledPolicy> = {}) {
  const paid = { model_provider: "offline-paid", model_id: "playbook-test-paid", approved: true as const, approval_ref: "fabricated-only-not-founder-approval", monthly_budget_units: 10_000_000, per_request_ceiling_units: 1_000_000, input_units_per_token: 1, output_units_per_token: 1, concurrency: 3, credential_slot: "paid" as const };
  return EnabledPolicySchema.parse({ enabled: true, live_dispatch_enabled: false, namespace: "playbook-offline", period_key: "2026-11", paid_enabled: true, fallback_enabled: true,
    paid, fallback: { ...paid, model_provider: "offline-open-weight", model_id: "playbook-test-open", credential_slot: "fallback", open_weight_verified: true, open_weight_evidence: "https://example.invalid/offline-only", daily_requests: 50, monthly_requests: 100 },
    client_window_ms: 60000, client_requests: 20, global_window_ms: 60000, global_requests: 40, global_concurrency: 5, client_concurrency: 3,
    max_input_bytes: MAX_INPUT_BYTES, max_output_tokens: 2048, input_overhead_tokens: 512, timeout_ms: 1500, lease_ms: 5000, store_timeout_ms: 100, ...patch });
}
/** Existing installed-Chromium CDP harness only; no browser dependency or public test hook. */
export async function checkPlaybookBrowser({ page, evaluate, waitFor, load, key, base, output, evidence }: any) {
  assert.equal(new URL(base).hostname, "127.0.0.1");
  const tracker = `(() => {
    const original = window.fetch.bind(window); window.__pbCalls=[]; window.__pbHold=false;
    window.fetch=(input,init)=>{
      if(input!=='/api/ai/playbook')return original(input,init);
      window.__pbCalls.push({method:init?.method,bodyAbsent:init?.body===undefined,credentials:init?.credentials});
      if(window.__pbMalformed)return Promise.resolve(new Response(JSON.stringify({status:'success',secret:'Fabricated reply must never render'}),{status:200}));
      if(window.__pbHold)return new Promise((resolve,reject)=>{window.__pbRelease=()=>original(input,init).then(resolve,reject);});
      return original(input,init);
    };
  })()`;
  await page("Page.addScriptToEvaluateOnNewDocument", { source: tracker });
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await load("Page.navigate", { url: `${base}/playbook-generator` });
  await waitFor("!!document.querySelector('.playbook-generate-button') && !document.querySelector('.playbook-generate-button').disabled");
  assert.equal(await evaluate("window.__pbCalls.length"), 0); const original = await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')");
  for (const width of [1440, 390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    const before = await evaluate("window.__pbCalls.length"); await evaluate("window.__pbHold=true; document.querySelector('.playbook-generate-button').focus()");
    assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none"); await key("Enter", 13);
    await waitFor("document.querySelector('.playbook-generate-button').disabled && !!document.querySelector('.playbook-checking')");
    await evaluate("document.querySelector('.playbook-generate-button').click();document.querySelector('.playbook-generate-button').click()"); assert.equal(await evaluate("window.__pbCalls.length"), before + 1);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false); await evaluate("window.__pbHold=false;window.__pbRelease()");
    await waitFor("!!document.querySelector('[role=alert]') && !document.querySelector('.playbook-generate-button').disabled");
    assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /Live Playbook AI is not enabled.*No draft was generated/);
    assert.equal(await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')"), original);
    assert.equal(await evaluate("[...document.querySelectorAll('button')].filter(e=>/Regenerate/.test(e.textContent)).length"), 0);
    const screenshot = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await writeFile(`${output}/playbook-${width}.png`, Buffer.from(screenshot.data, "base64"));
  }
  evidence.checks.push("Keyboard Generate at 1440/390/320: one body-free credential-free POST per action, repeat clicks blocked, real 503/no-store, truthful no draft, no overflow, unchanged session and three screenshots.");
  await evaluate("window.__pbMalformed=true;document.querySelector('.playbook-generate-button').click()"); await waitFor("document.querySelector('[role=alert]')?.textContent.includes('could not be verified')");
  assert.equal(await evaluate("document.body.textContent.includes('Fabricated reply must never render')"), false); await evaluate("window.__pbMalformed=false;window.__pbHold=true;document.querySelector('.playbook-generate-button').click()"); await waitFor("!!document.querySelector('.playbook-checking')");
  const beforeReset = await evaluate("window.__pbCalls.length"); await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Reset demo session').click()"); await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Confirm reset').click()"); await waitFor("!document.querySelector('.playbook-checking') && !document.querySelector('.playbook-generate-button').disabled");
  await evaluate("window.__pbHold=false;window.__pbRelease().catch(()=>{})"); assert.equal(await evaluate("window.__pbCalls.length"), beforeReset); assert.equal(await evaluate("document.querySelector('.ai-notice-title').textContent"), "AI not enabled");
  await evaluate("window.__pbHold=true;document.querySelector('.playbook-generate-button').click()"); await waitFor("!!document.querySelector('.playbook-checking')"); const beforeNav = await evaluate("window.__pbCalls.length");
  await evaluate("document.querySelector('nav a[href=\"/\"]').click()"); await waitFor("location.pathname==='/'"); await evaluate("window.__pbHold=false;window.__pbRelease().catch(()=>{})"); await evaluate("document.querySelector('nav a[href=\"/playbook-generator\"]').click()"); await waitFor("!!document.querySelector('.playbook-generate-button')"); assert.equal(await evaluate("window.__pbCalls.length"), beforeNav);
  assert.ok(await evaluate("window.__pbCalls.every(c=>c.method==='POST' && c.bodyAbsent && c.credentials==='omit')")); await load(); assert.equal(await evaluate("window.__pbCalls.length"), 0);
  assert.equal((await originalFetch(`${base}/api/ai/playbook`)).status, 405); const response = await originalFetch(`${base}/api/ai/playbook`, { method: "POST", body: "Untrusted body ignored", headers: { "x-aivra-test-mode": "enabled" } }); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal((await response.json()).status, "error");
  assert.equal((await originalFetch(`${base}/api/ai/ala`, { method: "POST" })).status, 503);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7); assert.equal(await evaluate("document.querySelectorAll('.future-feature a,.future-feature button,.future-feature [tabindex]').length"), 0);
  evidence.checks.push("Malformed success cannot display a draft; Reset/unmount abort stale readiness, remount/refresh cause zero calls, GET405 and hostile POST503 verified, ALA503 and seven inert icons preserved.");
}
function fixture(p = policy(), seed = setup()) {
  let inputs = seed.inputs, reads = 0, paidCalls = 0, fallbackCalls = 0, reservations = 0;
  const clock = () => start, actualStore = createFakeUsageStore(clock), requests: InvocationInput[] = [], requestIds: string[] = [];
  let output: unknown | undefined, dispatch: (() => void | Promise<void>) | undefined, settle: (() => void) | undefined, providerError = false;
  const store: UsageStore = { ...actualStore, authorizeAndReserve: async (r) => { reservations++; requestIds.push(r.request_id); return actualStore.authorizeAndReserve(r); }, settle: async (r) => { const result = await actualStore.settle(r); settle?.(); return result; } };
  const send: StructuredTransport["generate"] = async (call) => { requests.push(call.input); assert.ok(call.max_output_tokens! <= 2048); await dispatch?.(); if (providerError) throw new Error(canary); return { output: output === undefined ? specimen(call.input.context.playbook!) : output, usage: { inputTokens: 10, outputTokens: 5 } }; };
  const paid: StructuredTransport = { model_provider: p.paid.model_provider, model_id: p.paid.model_id, generate: async (c) => { paidCalls++; return send(c); } };
  const fallback: StructuredTransport = { model_provider: p.fallback.model_provider, model_id: p.fallback.model_id, generate: async (c) => { fallbackCalls++; return send(c); } };
  const options = { policy: p, execution: "offline-test" as const, store, paid, fallback, clock };
  return { p, options, seed, actualStore, store, paid, fallback, requests, requestIds, generator: createPlaybookGenerator(options), raw: createAIRouter(options),
    read: () => { reads++; return inputs; }, inputs: () => inputs, replace: (next: typeof inputs) => { inputs = next; },
    setOutput: (value: unknown) => { output = value; }, onDispatch: (value: () => void | Promise<void>) => { dispatch = value; }, onSettle: (value: () => void) => { settle = value; }, failProvider: () => { providerError = true; },
    counts: () => ({ paid: paidCalls, fallback: fallbackCalls, reservations, reads }) };
}
function success(r: PlaybookOutcome) { assert.notEqual(r.status, "error", JSON.stringify(r)); if (r.status === "error") throw Error("Expected offline draft"); return r; }
function denied(r: PlaybookOutcome, code?: string) { assert.equal(r.status, "error", JSON.stringify(r)); if (r.status !== "error") throw Error("Expected safe failure"); if (code) assert.equal(r.error.code, code); assert.ok(!JSON.stringify(r).includes(canary)); return r; }
function invocation(source = setup().inputs) { const b = buildPlaybookInvocation(source); assert.ok(b.ok, JSON.stringify(b)); return b; }
const measure = (request: InvocationInput) => Buffer.byteLength(JSON.stringify({ input: request, schema: z.toJSONSchema(PlaybookResultSchema) }), "utf8");
let groups = 0, network = 0; const originalFetch = globalThis.fetch;
async function check(name: string, fn: () => void | Promise<void>) { await fn(); groups++; console.log(`PASS: ${name}`); }
if (!process.argv.includes("--playbook-browser")) {
globalThis.fetch = async () => { network++; throw Error("Playbook tests forbid network"); };
try {
  await check("public Playbook/ALA availability routes are unconditional 503/no-store and ignore hostile inputs/env", async () => {
    assert.equal(runtime, "nodejs"); let reads = 0; const hostile = new Proxy({}, { get() { reads++; throw Error(canary); } });
    const previous = process.env.AIVRA_AI_ENABLED; process.env.AIVRA_AI_ENABLED = "true";
    try { for (const post of [POST, ALA_POST]) { const response = (post as (r?: unknown) => Response)(hostile); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store"); const r = await response.json(); assert.equal(r.status, "error"); assert.equal(r.error.code, "ai_controls_not_ready"); assert.equal(r.error.request_id, null); } }
    finally { if (previous === undefined) delete process.env.AIVRA_AI_ENABLED; else process.env.AIVRA_AI_ENABLED = previous; }
    assert.equal(reads, 0); const source = await readFile("app/api/ai/playbook/route.ts", "utf8"); assert.doesNotMatch(source, /\bimport\s|process\.env|createAI|\b(?:request|req)\./);
  });
  await check("complete/incomplete offline Generate returns actual guarded provenance, immutable sources and coverage", async () => {
    const f = fixture(), before = JSON.stringify(f.inputs()), r = success(await f.generator.generate(f.read, caller)); PlaybookOutcomeSchema.parse(r);
    assert.equal(r.status, "success"); assert.equal(r.operation, "generate"); assert.equal(r.envelope.model_provider, f.p.paid.model_provider); assert.equal(r.envelope.mode, "paid"); assert.equal(r.source.session_id, f.inputs().current_session.session_id);
    assert.ok(f.generator.isCurrent(r, f.read)); assert.equal(f.generator.isCurrent(structuredClone(r), f.read), false); assert.ok(Object.isFrozen(r.envelope.data.actions)); assert.equal(JSON.stringify(f.inputs()), before); assert.equal(f.counts().paid, 1); assert.equal(f.counts().reservations, 1); assert.ok(f.counts().reads >= 3);
    const checked = validateInvocation(f.requests[0], PLAYBOOK_OUTPUT_CONTRACT); assert.ok(checked.ok); assert.equal(r.envelope.input_digest, createHash("sha256").update(JSON.stringify({ input: checked.input, references: checked.references })).digest("hex"));
    const status = await f.actualStore.getSafeUsageStatus({ namespace: f.p.namespace, period_key: f.p.period_key }); assert.equal(status.paid.accounted_units, 15);
    const partial = fixture(), output = specimen(invocation(partial.inputs()).input); output.actions.pop(); output.milestones[0].after_activity_ids = ["activity_0"]; output.coverage_status = "incomplete"; partial.setOutput(output); const incomplete = success(await partial.generator.generate(partial.read, caller)); assert.equal(incomplete.status, "incomplete"); assert.equal(incomplete.coverage.missing_tsa_ids.length, 1);
  });
  await check("guarded SDK mock preserves typed untrusted JSON, server system prompt, no retries/store and output-token cap", async () => {
    const f = fixture(), built = invocation(f.inputs());
    const model = new MockLanguageModelV4({ provider: "offline-only", modelId: f.p.paid.model_id, doGenerate: { content: [{ type: "text", text: JSON.stringify(specimen(built.input)) }], finishReason: { unified: "stop", raw: "stop" }, warnings: [], usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } } });
    const generator = createPlaybookGenerator({ ...f.options, paid: createSDKTransport(model, f.p.paid.model_provider) }); success(await generator.generate(f.read, caller));
    assert.equal(model.doGenerateCalls.length, 1); const call = model.doGenerateCalls[0]; assert.equal(call.maxOutputTokens, 2048); assert.equal(call.providerOptions?.openai?.store, false); assert.equal(call.prompt[0].role, "system");
    const user = call.prompt.find((m) => m.role === "user"); assert.ok(user && user.role === "user"); const part = user.content.find((c) => c.type === "text"); assert.ok(part && part.type === "text"); const wire = JSON.parse(part.text); assert.deepEqual(wire.untrusted_context.playbook, built.input); assert.deepEqual(wire.allowed_source_ids, built.request.allowed_source_ids);
    assert.match(await readFile("lib/server/ai/sdk-transport.ts", "utf8"), /maxRetries: 0/); assert.equal(f.counts().reservations, 1);
  });
  await check("typed context/prompt/module/allowlist/source mismatches reject BEFORE any reservation; legacy modules stay compatible", async () => {
    const f = fixture(), built = invocation(f.inputs());
    const changes: ((r: InvocationInput) => void)[] = [r => { r.module = "ala"; }, r => { r.prompt_version = "wrong/v1"; }, r => { r.system = "Untrusted override"; }, r => { r.context.user_text = "Not a context escape hatch"; }, r => { r.allowed_source_ids.push("foreign"); }, r => { r.context.playbook!.applications[0].app_name = "Different source"; }, r => { r.context.playbook!.scenario.selected = "unexpected"; }, r => { r.context.playbook!.source.review_digest = "0".repeat(64); }, r => { delete r.context.playbook; }];
    for (const change of changes) { const bad = structuredClone(built.request); change(bad); const result = await f.raw(bad, PLAYBOOK_OUTPUT_CONTRACT, caller); assert.equal(result.ok, false); }
    const extra = structuredClone(built.request); (extra.context as unknown as Record<string, unknown>).arbitrary = {}; assert.equal(InvocationSchema.safeParse(extra).success, false);
    assert.equal(f.counts().reservations, 0); assert.equal(f.counts().paid, 0);
    for (const module of ["ala", "licenses", "assistant"] as const) { const old = { module, prompt_version: "legacy/v1", system: "Existing trusted instructions", context: { deal: built.request.context.deal, user_text: "Existing bounded text" }, allowed_source_ids: [built.request.allowed_source_ids[0]] }; assert.ok(validateInvocation(old, PLAYBOOK_OUTPUT_CONTRACT).ok); assert.equal(InvocationSchema.safeParse({ ...old, context: { ...old.context, playbook: built.input } }).success, false); }
  });
  await check("actual duplicated-deal/schema UTF-8 sizes, policy exact bound and large portfolio refuse truncation", async () => {
    const b = invocation(), bytes = measure(b.request); assert.equal(b.input.applications.length, 30); assert.ok(bytes <= MAX_INPUT_BYTES);
    const unicodeSession = structuredClone(setup().inputs.current_session); unicodeSession.current_deal.tsa_services[0].title = "案".repeat(500); const unicode = invocation(setup(unicodeSession).inputs); assert.ok(measure(unicode.request) > JSON.stringify({ input: unicode.request, schema: z.toJSONSchema(PlaybookResultSchema) }).length);
    const at = fixture(policy({ max_input_bytes: bytes })); success(await at.generator.generate(at.read, caller));
    const over = fixture(policy({ max_input_bytes: bytes - 1 })); denied(await over.generator.generate(over.read, caller), "request_too_large"); assert.equal(over.counts().reservations, 0);
    const large = structuredClone(setup().inputs.current_session); const app = large.current_deal.applications[0]; for (const side of ["buyer", "target"] as const) for (let i = 0; i < 35; i++) large.current_deal.applications.push({ ...app, app_id: `large-${side}-${i}`, company_side: side });
    const largeResult = buildPlaybookInvocation(setup(large).inputs); assert.equal(largeResult.ok, false); if (!largeResult.ok) assert.equal(largeResult.code, "request_too_large");
    await mkdir(".temp/u04-02", { recursive: true }); const sizes = { applications: 30, domain_bytes: Buffer.byteLength(JSON.stringify(b.input)), invocation_bytes: Buffer.byteLength(JSON.stringify(b.request)), complete_input_schema_bytes: bytes, output_bytes: Buffer.byteLength(JSON.stringify(specimen(b.input))), unicode_complete_bytes: measure(unicode.request), large_applications: 100, large_source_bytes: Buffer.byteLength(JSON.stringify(large)), large_result: largeResult.code };
    await writeFile(".temp/u04-02/request-sizes.json", JSON.stringify(sizes, null, 2)); console.log(`Measured byte bounds: ${JSON.stringify(sizes)}`);
  });
  await check("default disabled, missing caller/store, invalid live policy and wrong provider identities never dispatch", async () => {
    const f = fixture(); denied(await createPlaybookGenerator().generate(f.read, caller), "ai_disabled"); denied(await f.generator.generate(f.read), "controls_unavailable");
    denied(await createPlaybookGenerator({ ...f.options, store: undefined }).generate(f.read, caller), "controls_unavailable");
    denied(await createPlaybookGenerator({ ...f.options, store: { ...f.store, authorizeAndReserve: async () => { throw Error(canary); } } }).generate(f.read, caller), "controls_unavailable");
    denied(await createPlaybookGenerator({ ...f.options, policy: { ...f.p, live_dispatch_enabled: true } }).generate(f.read, caller), "invalid_input");
    denied(await createPlaybookGenerator({ ...f.options, paid: { ...f.paid, model_id: "spoofed" } }).generate(f.read, caller), "controls_unavailable"); assert.equal(f.counts().paid, 0);
    const live = createOpenAITransport({ AIVRA_AI_ENABLED: "true", OPENAI_API_KEY: "offline-not-real", AIVRA_PAID_MODEL_ID: "offline-specific" }); assert.equal(live.disabled_reason, "ai_controls_not_ready"); await assert.rejects(() => live.generate({ input: invocation().request, schema: PlaybookResultSchema, signal: new AbortController().signal }), TransportFailure);
  });
  await check("paid/fallback independent budgets, client/global rate limits and concurrent leases remain guarded", async () => {
    const basic = policy(), noBudget = fixture(policy({ paid: { ...basic.paid, monthly_budget_units: 1 }, fallback_enabled: false })); denied(await noBudget.generator.generate(noBudget.read, caller), "fallback_unavailable"); assert.equal(noBudget.counts().paid, 0);
    const fallback = fixture(policy({ paid: { ...basic.paid, monthly_budget_units: 1 } })); const r = success(await fallback.generator.generate(fallback.read, caller)); assert.equal(r.envelope.mode, "fallback"); assert.equal(r.envelope.routing_reason, "budget_exhausted"); assert.equal(fallback.counts().paid, 0); assert.equal(fallback.counts().fallback, 1);
    const both = fixture(policy({ paid: { ...basic.paid, monthly_budget_units: 1 }, fallback: { ...basic.fallback, monthly_budget_units: 1 } })); denied(await both.generator.generate(both.read, caller), "fallback_unavailable"); assert.equal(both.counts().fallback, 0);
    for (const patch of [{ client_requests: 1 }, { global_requests: 1 }]) { const f = fixture(policy(patch)); success(await f.generator.generate(f.read, caller)); denied(await f.generator.generate(f.read, patch.global_requests ? { client_key: "b".repeat(64) } : caller), "rate_limited"); assert.equal(f.counts().paid, 1); }
    const f = fixture(policy({ global_concurrency: 1, client_concurrency: 1, paid: { ...basic.paid, concurrency: 1 }, fallback: { ...basic.fallback, concurrency: 1 } })); let release!: () => void, entered!: () => void; const entry = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; }); f.onDispatch(async () => { entered(); await hold; }); const first = f.generator.generate(f.read, caller); await entry; denied(await f.generator.generate(f.read, caller), "capacity_reached"); release(); success(await first); assert.equal(f.counts().paid, 1);
  });
  await check("provider failure has no retry/failover; failed settlement withholds success and reservations remain accounted", async () => {
    const f = fixture(); f.failProvider(); denied(await f.generator.generate(f.read, caller), "provider_unavailable"); assert.equal(f.counts().paid, 1); assert.equal(f.counts().fallback, 0);
    const usage = await f.actualStore.getSafeUsageStatus({ namespace: f.p.namespace, period_key: f.p.period_key }); assert.equal(usage.paid.accounted_units, reservationUnits(f.p, "paid"));
    const bad = fixture(); denied(await createPlaybookGenerator({ ...bad.options, store: { ...bad.store, settle: async () => { throw Error(canary); } } }).generate(bad.read, caller), "controls_unavailable"); assert.equal(bad.counts().paid, 1);
  });
  await check("invalid model refs/sides/subjects/graph/dates/coverage/metadata/oversize fail safely without repair", async () => {
    const good = specimen(invocation().input), variants: unknown[] = [null, { ...good, model_id: "spoofed" }, { pad: "x".repeat(64001) }];
    for (const edit of [(r: typeof good) => { r.actions[0].source_refs = [{ kind: "application", app_id: "foreign", side: "buyer" }]; }, (r: typeof good) => { r.actions[0].source_refs = [{ kind: "application", app_id: setup().inputs.current_session.current_deal.applications[0].app_id, side: "target" }]; }, (r: typeof good) => { const ref = r.actions[0].source_refs[0]; if (ref.kind === "ala_action") ref.action_id = "foreign"; }, (r: typeof good) => { r.actions[0].depends_on_activity_ids = ["activity_1"]; }, (r: typeof good) => { r.actions[1].activity_id = "activity_0"; }, (r: typeof good) => { r.phases[0].sequence = 2; }, (r: typeof good) => { r.milestones[0].proposed_date = "2027-02-30"; }, (r: typeof good) => { r.actions.pop(); r.milestones[0].after_activity_ids = ["activity_0"]; }]) { const r = structuredClone(good); edit(r); variants.push(r); }
    for (const output of variants) { const f = fixture(); f.setOutput(output); denied(await f.generator.generate(f.read, caller), "invalid_model_output"); assert.equal(f.counts().paid, 1); assert.equal(f.counts().fallback, 0); }
  });
  await check("full envelope binds UUID/digest/module/prompt/provider/mode to the exact guarded request", async () => {
    const f = fixture(), accepted = success(await f.generator.generate(f.read, caller)), request = f.requests[0], captured = request.context.playbook!;
    assert.ok(validatePlaybookEnvelope(accepted.envelope, request, captured, accepted.envelope.request_id, f.p));
    for (const patch of [{ request_id: crypto.randomUUID() }, { input_digest: "0".repeat(64) }, { module: "ala" }, { prompt_version: "ala/v1" }, { model_provider: "spoofed" }, { model_id: "spoofed" }, { mode: "fallback", routing_reason: "budget_exhausted" }]) assert.equal(validatePlaybookEnvelope({ ...accepted.envelope, ...patch }, request, captured, accepted.envelope.request_id, f.p), null);
  });
  await check("fresh reads reject pre-dispatch and during/after-await Reset/source/review/scenario/assumption races", async () => {
    const before = fixture(); let reads = 0; const changed = structuredClone(before.inputs()); changed.current_session = updateTSA(changed.current_session, changed.current_session.current_deal.tsa_services[0].tsa_id, { status: "active" }); denied(await before.generator.generate(() => ++reads === 1 ? before.inputs() : changed, caller), "source_changed"); assert.equal(before.counts().paid, 0);
    const mutations = [(v: ReturnType<typeof setup>["inputs"]) => { v.current_session = createDemoSession(); }, (v: ReturnType<typeof setup>["inputs"]) => { v.current_session = updateApplication(v.current_session, v.current_session.current_deal.applications[0].app_id, { notes: "Changed" }); }, (v: ReturnType<typeof setup>["inputs"]) => { v.current_session = updateLicense(v.current_session, v.current_session.current_deal.license_positions[0].license_id, { seats_used: 0 }); }, (v: ReturnType<typeof setup>["inputs"]) => { v.current_session = updateTSA(v.current_session, v.current_session.current_deal.tsa_services[0].tsa_id, { status: "active" }); }, (v: ReturnType<typeof setup>["inputs"]) => { v.review.overrides[0].visitor_reason = "Changed review"; }, (v: ReturnType<typeof setup>["inputs"]) => { v.selected_scenario = "baseline"; }, (v: ReturnType<typeof setup>["inputs"]) => { v.scenario.alternative.financial_draft.actions[0].annual_run_rate.note = "Changed note"; }, (v: ReturnType<typeof setup>["inputs"]) => { v.current_session.current_deal.tsa_services[0].owner = "Unversioned raw change"; }];
    for (const mutate of mutations) { const f = fixture(); f.replace(structuredClone(f.inputs())); f.onDispatch(() => { mutate(f.inputs()); }); denied(await f.generator.generate(f.read, caller), "source_changed"); assert.equal(f.counts().paid, 1); assert.ok(f.counts().reads >= 3); }
    const post = fixture(); post.onSettle(() => { const v = structuredClone(post.inputs()); v.selected_scenario = "baseline"; post.replace(v); }); denied(await post.generator.generate(post.read, caller), "source_changed");
  });
  await check("Regenerate uses independent authorization/UUID/current input and failures retain immutable prior without stale-current grant", async () => {
    const f = fixture(), first = success(await f.generator.generate(f.read, caller)), original = JSON.stringify(first); const second = success(await f.generator.regenerate(first, f.read, caller)); assert.equal(second.operation, "regenerate"); assert.notEqual(second.envelope.request_id, first.envelope.request_id); assert.equal(new Set(f.requestIds).size, 2); assert.equal(f.counts().paid, 2);
    denied(await f.generator.regenerate(structuredClone(first), f.read, caller), "invalid_previous_draft"); assert.equal(f.counts().paid, 2);
    f.failProvider(); denied(await f.generator.regenerate(second, f.read, caller), "provider_unavailable"); assert.ok(f.generator.isCurrent(second, f.read)); assert.equal(JSON.stringify(first), original);
    const v = structuredClone(f.inputs()); v.selected_scenario = "baseline"; f.replace(v); assert.equal(f.generator.isCurrent(second, f.read), false); denied(await f.generator.regenerate(second, f.read, caller), "provider_unavailable"); assert.equal(JSON.stringify(first), original);
    const current = fixture(), old = success(await current.generator.generate(current.read, caller)); const fresh = structuredClone(current.inputs()); fresh.selected_scenario = "baseline"; current.replace(fresh); const regenerated = success(await current.generator.regenerate(old, current.read, caller)); assert.notEqual(old.source.scenario_digest, regenerated.source.scenario_digest); assert.ok(current.generator.isCurrent(regenerated, current.read)); assert.equal(current.generator.isCurrent(old, current.read), false);
  });
  await check("only guarded router dispatch, no public fixture/data transfer/storage/live activation and real server-only guard", async () => {
    const source = await readFile("lib/server/playbook/generate.ts", "utf8"); assert.match(source, /createAIRouter\(options\)/); assert.doesNotMatch(source, /createAIAdapter|createSDKTransport|fetch\(|process\.env|sessionStorage|console\./);
    const ui = await readFile("components/playbook-generator/generate-playbook.tsx", "utf8"); assert.doesNotMatch(ui, /server\/|JSON\.stringify|body:|sessionStorage|localStorage|dangerouslySetInnerHTML|mock|fixture/); assert.match(ui, /credentials: "omit"/); assert.match(ui, /10_000/);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/playbook/generate.ts')"], { encoding: "utf8", timeout: 5000 }); assert.notEqual(child.status, 0); assert.match(child.stderr, /server-only|Client Component/); assert.equal(network, 0);
  });
  console.log(`PASS: ${groups} U04.02 groups; guarded Generate/Regenerate, exact structured context/provenance, live-disabled/public 503, zero external network.`);
} finally { globalThis.fetch = originalFetch; }
}
