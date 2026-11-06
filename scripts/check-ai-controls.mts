import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createAIRouter } from "../lib/server/ai/router.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { createRedisUsageStore } from "../lib/server/ai/redis-usage-store.ts";
import { createOpenAITransport } from "../lib/server/ai/openai-transport.ts";
import { ControlPolicySchema, deriveAnonymousKey, EnabledPolicySchema, reservationUnits } from "../lib/server/ai/control-policy.ts";
import type { EnabledPolicy } from "../lib/server/ai/control-policy.ts";
import { failure, FailureSchema, resultEnvelopeSchema, TransportFailure } from "../lib/server/ai/contracts.ts";
import type { AdapterResult, FailureCode, InvocationInput, StructuredTransport } from "../lib/server/ai/contracts.ts";
import { ReserveRequestSchema } from "../lib/server/ai/usage-store.ts";
import type { ReserveRequest, UsageStore } from "../lib/server/ai/usage-store.ts";
import { loadSyntheticDealFixture } from "../lib/fixtures/synthetic-deal.ts";

const canary = "private-control-test-source";
const fakeKey = "not-a-real-provider-key";
const rawAddress = "192.0.2.33";
const start = Date.UTC(2026, 9, 30, 12); // Daily-window tests must not also cross month end.
const secret = "test-secret-with-at-least-thirty-two-characters";
const clientA = deriveAnonymousKey(rawAddress, secret, start)!;
const clientB = deriveAnonymousKey("192.0.2.34", secret, start)!;
const deal = loadSyntheticDealFixture();
const appId = deal.applications[0].app_id;
const input: InvocationInput = { module: "assistant", prompt_version: "controls-check/v1", system: "Return the caller's generic citation shape.", context: { deal, user_text: canary }, allowed_source_ids: [appId] };
const schema = z.strictObject({ source_ids: z.array(z.string()) });
const contract = { schema, references: { allow_empty: false, duplicates: "reject" as const, extract: (data: z.infer<typeof schema>) => data.source_ids } };
const data = { source_ids: [appId] };
function policy(patch: Partial<EnabledPolicy> = {}): EnabledPolicy {
  // Entirely invented offline rates/models/approvals, never live spending defaults.
  const paid = { model_provider: "openai", model_id: "offline-paid-v1", approved: true as const, approval_ref: "offline-test-only", monthly_budget_units: 10_000_000, per_request_ceiling_units: 1_000_000, input_units_per_token: 2, output_units_per_token: 3, concurrency: 3, credential_slot: "paid" as const };
  const fallback = { ...paid, model_provider: "offline-open-weight", model_id: "offline-open-v1", credential_slot: "fallback" as const, open_weight_verified: true as const, open_weight_evidence: "https://example.invalid/offline-model-evidence", daily_requests: 20, monthly_requests: 100 };
  return EnabledPolicySchema.parse({ enabled: true, live_dispatch_enabled: false, namespace: "aivra-offline", period_key: "2026-10", paid_enabled: true, fallback_enabled: true, paid, fallback,
    client_window_ms: 60_000, client_requests: 10, global_window_ms: 120_000, global_requests: 20,
    global_concurrency: 5, client_concurrency: 3, max_input_bytes: 64_000, max_output_tokens: 256, input_overhead_tokens: 512,
    lease_ms: 5000, timeout_ms: 1000, store_timeout_ms: 50, ...patch });
}
function transport(mode: "paid" | "fallback", p: EnabledPolicy, generate?: StructuredTransport["generate"]): StructuredTransport {
  return { model_provider: p[mode].model_provider, model_id: p[mode].model_id, generate: generate ?? (async () => ({ output: data, usage: { inputTokens: 10, outputTokens: 5 } })) };
}
function fixture(p = policy()) {
  let time = start;
  const clock = () => time;
  const store = createFakeUsageStore(clock);
  let paidCalls = 0; let fallbackCalls = 0;
  const paid = transport("paid", p, async () => { paidCalls++; return { output: data, usage: { inputTokens: 10, outputTokens: 5 } }; });
  const fallback = transport("fallback", p, async () => { fallbackCalls++; return { output: data, usage: { inputTokens: 10, outputTokens: 5 } }; });
  const invoke = createAIRouter({ policy: p, execution: "offline-test", store, paid, fallback, clock });
  return { p, clock, store, paid, fallback, invoke, calls: () => ({ paid: paidCalls, fallback: fallbackCalls }), advance: (ms: number) => { time += ms; } };
}
const caller = (client_key = clientA, request_id = randomUUID()) => ({ client_key, request_id });
function reservation(p: EnabledPolicy, mode: "paid" | "fallback" = "paid", client_key = clientA, issued_at_ms = start): ReserveRequest {
  return { request_id: randomUUID(), input_digest: "a".repeat(64), client_key, issued_at_ms, mode, policy: p };
}
async function status(f: ReturnType<typeof fixture>, period_key = f.p.period_key) { return f.store.getSafeUsageStatus({ namespace: f.p.namespace, period_key }); }
function denied(result: AdapterResult<unknown>, code: FailureCode) { assert.equal(result.ok, false); if (result.ok) throw new Error("Expected failure"); FailureSchema.parse(result); assert.equal(result.error.code, code); assert.ok(!JSON.stringify(result).includes(canary)); }
let groups = 0;
const filterArgument = process.argv.find((arg) => arg.startsWith("--filter="));
const groupFilter = filterArgument ? new RegExp(filterArgument.slice("--filter=".length)) : undefined;
async function check(name: string, run: () => Promise<void>) { if (groupFilter && !groupFilter.test(name)) return; await run(); groups++; originalLog(`PASS: ${name}`); }
const originalFetch = globalThis.fetch;
const originalLog = console.log; const originalWarn = console.warn; const originalError = console.error;
let networkAttempts = 0;
const logs: string[] = [];
globalThis.fetch = async () => { networkAttempts++; throw new Error("External network is forbidden in this suite"); };
console.log = console.warn = console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
try {
  await check("default/missing/live-only controls fail closed; original OpenAI hard stops remain", async () => {
    denied(await createAIRouter()(input, contract), "ai_disabled");
    const p = policy();
    denied(await createAIRouter({ policy: p })(input, contract, caller()), "controls_unavailable");
    denied(await createAIRouter({ policy: p, execution: "offline-test" })(input, contract, caller()), "controls_unavailable");
    const live = createOpenAITransport({ AIVRA_AI_ENABLED: "true", OPENAI_API_KEY: fakeKey, AIVRA_PAID_MODEL_ID: p.paid.model_id });
    await assert.rejects(() => live.generate({ input, schema, signal: new AbortController().signal }), (e: unknown) => e instanceof TransportFailure && e.code === "ai_controls_not_ready");
    const f = fixture(p);
    denied(await createAIRouter({ policy: p, execution: "offline-test", store: f.store, paid: live, fallback: f.fallback, clock: f.clock })(input, contract, caller()), "ai_controls_not_ready");
    assert.deepEqual(f.calls(), { paid: 0, fallback: 0 });
  });
  await check("strict policy rejects unsafe prices/budgets/limits/models/proof and absent identity", async () => {
    const p = policy(); assert.equal(ControlPolicySchema.safeParse({ enabled: false }).success, true);
    for (const candidate of [{ ...p, live_dispatch_enabled: true }, { ...p, paid: { ...p.paid, monthly_budget_units: -1 } }, { ...p, paid: { ...p.paid, input_units_per_token: 0 } }, { ...p, fallback: { ...p.fallback, open_weight_verified: false } }, { ...p, fallback: { ...p.fallback, model_id: "openrouter/auto" } }, { ...p, fallback: { ...p.fallback, daily_requests: 0 } }, { ...p, global_requests: Infinity }, { ...p, lease_ms: 100 }, { ...p, paid: { ...p.paid, per_request_ceiling_units: 1 } }, { enabled: true }]) assert.equal(ControlPolicySchema.safeParse(candidate).success, false);
    assert.equal(deriveAnonymousKey(undefined, secret, start), null); assert.equal(deriveAnonymousKey(rawAddress, "short", start), null); assert.equal(deriveAnonymousKey("192.0.2.33, 192.0.2.34", secret, start), null);
    const f = fixture(); denied(await f.invoke(input, contract), "controls_unavailable"); assert.deepEqual(f.calls(), { paid: 0, fallback: 0 });
  });
  await check("concurrent one-request paid budget authorizes at most one dispatch", async () => {
    const base = policy(); const p = policy({ paid: { ...base.paid, monthly_budget_units: reservationUnits(base, "paid") }, fallback_enabled: false });
    const f = fixture(p); let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; }); let calls = 0;
    const paid = transport("paid", p, async () => { calls++; await wait; return { output: data }; });
    const invoke = createAIRouter({ policy: p, execution: "offline-test", store: f.store, paid, clock: f.clock });
    const results = [invoke(input, contract, caller(clientA)), invoke(input, contract, caller(clientB))];
    await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls, 1); release();
    const completed = await Promise.all(results); assert.equal(completed.filter((r) => r.ok).length, 1); assert.equal((await status(f)).paid.accounted_units, reservationUnits(p, "paid"));
  });
  await check("reservation/replay and settlement are idempotent without duplicate dispatch/refund", async () => {
    const f = fixture(); const r = reservation(f.p);
    assert.equal((await f.store.authorizeAndReserve(r)).authorized, true);
    const duplicate = await f.store.authorizeAndReserve(r); assert.deepEqual(duplicate, { authorized: false, code: "duplicate_request" });
    const receipt = { namespace: f.p.namespace, request_id: r.request_id, actual_units: 35, usage_overflow: false };
    await f.store.settle(receipt); await f.store.settle(receipt); assert.equal((await status(f)).paid.accounted_units, 35);
    const id = caller(); assert.ok((await f.invoke(input, contract, id)).ok); denied(await f.invoke(input, contract, id), "duplicate_request"); assert.equal(f.calls().paid, 1);
  });
  await check("insufficient paid allowance chooses eligible independent fallback, with truthful provenance", async () => {
    const base = policy(); const p = policy({ paid: { ...base.paid, monthly_budget_units: 1 } }); const f = fixture(p);
    const result = await f.invoke(input, contract, caller()); assert.ok(result.ok); resultEnvelopeSchema(schema).parse(result.result);
    assert.equal(result.result.mode, "fallback"); assert.equal(result.result.routing_reason, "budget_exhausted");
    assert.equal(result.result.model_id, p.fallback.model_id); assert.equal(result.result.model_provider, p.fallback.model_provider);
    assert.deepEqual(f.calls(), { paid: 0, fallback: 1 }); assert.equal((await status(f)).paid.accounted_units, 0);
    const disabledPaid = fixture(policy({ paid_enabled: false })); const next = await disabledPaid.invoke(input, contract, caller()); assert.ok(next.ok); assert.equal(next.result.routing_reason, "paid_unavailable");
  });
  await check("independent fallback daily/monthly/money/concurrency limits never retry paid", async () => {
    const base = policy();
    for (const limits of [{ daily_requests: 1 }, { monthly_requests: 1, daily_requests: 1 }, { monthly_budget_units: 1 }]) {
      const p = policy({ paid_enabled: false, fallback: { ...base.fallback, ...limits } }); const f = fixture(p);
      await f.invoke(input, contract, caller()); denied(await f.invoke(input, contract, caller(clientB)), "fallback_unavailable"); assert.equal(f.calls().paid, 0);
      f.advance(86_400_000);
      const nextDay = await f.invoke(input, contract, caller(clientB));
      if ("monthly_requests" in limits || "monthly_budget_units" in limits) denied(nextDay, "fallback_unavailable"); else assert.ok(nextDay.ok);
    }
    const p = policy({ paid_enabled: false, fallback: { ...base.fallback, concurrency: 1 } }); const f = fixture(p);
    assert.equal((await f.store.authorizeAndReserve(reservation(p, "fallback"))).authorized, true);
    denied(await f.invoke(input, contract, caller(clientB)), "capacity_reached"); assert.deepEqual(f.calls(), { paid: 0, fallback: 0 });
  });
  await check("per-client and global rate windows are distinct and enforced across both modes", async () => {
    const f = fixture(policy({ client_requests: 1, global_requests: 2 }));
    assert.ok((await f.invoke(input, contract, caller())).ok); denied(await f.invoke(input, contract, caller()), "rate_limited");
    assert.ok((await f.invoke(input, contract, caller(clientB))).ok); f.advance(60_000);
    denied(await f.invoke(input, contract, caller()), "rate_limited"); f.advance(60_000);
    assert.ok((await f.invoke(input, contract, caller())).ok);
    const shared = fixture(policy({ client_requests: 1 }));
    const paid = reservation(shared.p); await shared.store.authorizeAndReserve(paid);
    await shared.store.settle({ namespace: shared.p.namespace, request_id: paid.request_id, actual_units: 35, usage_overflow: false });
    assert.deepEqual(await shared.store.authorizeAndReserve(reservation(shared.p, "fallback")), { authorized: false, code: "rate_limited" });
  });
  await check("global/client concurrency and expired leases release slots, not reserved money", async () => {
    const base = policy(); const f = fixture(policy({ global_concurrency: 2, client_concurrency: 1, paid: { ...base.paid, concurrency: 2 }, fallback: { ...base.fallback, concurrency: 2 } }));
    assert.equal((await f.store.authorizeAndReserve(reservation(f.p))).authorized, true);
    assert.deepEqual(await f.store.authorizeAndReserve(reservation(f.p)), { authorized: false, code: "capacity_reached" });
    assert.equal((await f.store.authorizeAndReserve(reservation(f.p, "paid", clientB))).authorized, true);
    const third = deriveAnonymousKey("192.0.2.35", secret, start)!;
    assert.deepEqual(await f.store.authorizeAndReserve(reservation(f.p, "fallback", third)), { authorized: false, code: "capacity_reached" });
    f.advance(f.p.lease_ms + 1); const aggregate = await status(f); assert.equal(aggregate.paid.in_flight, 0); assert.equal(aggregate.paid.accounted_units, reservationUnits(f.p, "paid") * 2);
  });
  await check("UTC rollover keeps old reservations charged to their original period", async () => {
    let time = Date.UTC(2026, 9, 31, 23, 59, 59); const store = createFakeUsageStore(() => time); const oct = policy(); const r = reservation(oct, "paid", clientA, time);
    assert.equal((await store.authorizeAndReserve(r)).authorized, true); time += 2000;
    const nov = policy({ period_key: "2026-11" }); assert.equal((await store.authorizeAndReserve(reservation(nov, "paid", clientB, time))).authorized, true);
    await store.settle({ namespace: oct.namespace, request_id: r.request_id, actual_units: 35, usage_overflow: false });
    assert.equal((await store.getSafeUsageStatus({ namespace: oct.namespace, period_key: "2026-10" })).paid.accounted_units, 35);
    assert.equal((await store.getSafeUsageStatus({ namespace: oct.namespace, period_key: "2026-11" })).paid.accounted_units, reservationUnits(nov, "paid"));
  });
  await check("unknown usage and late/expired receipts cannot refund exposure; proven overruns block", async () => {
    const f = fixture(); const r = reservation(f.p); await f.store.authorizeAndReserve(r);
    await f.store.settle({ namespace: f.p.namespace, request_id: r.request_id, actual_units: null, usage_overflow: false });
    assert.equal((await status(f)).paid.in_flight, 1);
    await f.store.settle({ namespace: f.p.namespace, request_id: r.request_id, actual_units: 1, usage_overflow: false });
    assert.equal((await status(f)).paid.in_flight, 0);
    assert.equal((await status(f)).paid.accounted_units, reservationUnits(f.p, "paid"));
    const excess = reservationUnits(f.p, "paid") + 100;
    await f.store.settle({ namespace: f.p.namespace, request_id: r.request_id, actual_units: excess, usage_overflow: false });
    await f.store.settle({ namespace: f.p.namespace, request_id: r.request_id, actual_units: excess, usage_overflow: false });
    assert.equal((await status(f)).paid.accounted_units, excess); assert.equal((await status(f)).paid.blocked, true);
    denied(await f.invoke(input, contract, caller(clientB)), "controls_unavailable");
    const g = fixture(); const expired = reservation(g.p); await g.store.authorizeAndReserve(expired); g.advance(g.p.lease_ms + 1);
    await g.store.settle({ namespace: g.p.namespace, request_id: expired.request_id, actual_units: 1, usage_overflow: false }); assert.equal((await status(g)).paid.accounted_units, reservationUnits(g.p, "paid"));
  });
  await check("provider error/timeout never falls back and settlement retains ambiguous spend", async () => {
    const p = policy({ timeout_ms: 5 }); const f = fixture(p); let resolveLate!: (value: { output: unknown }) => void;
    const paid = transport("paid", p, async () => new Promise((resolve) => { resolveLate = resolve; }));
    const invoke = createAIRouter({ policy: p, execution: "offline-test", store: f.store, paid, fallback: f.fallback, clock: f.clock });
    denied(await invoke(input, contract, caller()), "provider_unavailable"); resolveLate({ output: data }); await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await status(f)).paid.in_flight, 1);
    f.advance(p.lease_ms + 1); assert.equal((await status(f)).paid.in_flight, 0);
    assert.equal((await status(f)).paid.accounted_units, reservationUnits(p, "paid")); assert.equal(f.calls().fallback, 0);
    const g = fixture(); const errorTransport = transport("paid", g.p, async () => { throw new Error(`${canary} ${fakeKey}`); });
    denied(await createAIRouter({ policy: g.p, execution: "offline-test", store: g.store, paid: errorTransport, fallback: g.fallback, clock: g.clock })(input, contract, caller()), "provider_unavailable"); assert.equal(g.calls().fallback, 0);
    const h = fixture(policy({ paid_enabled: false }));
    const fallbackError = transport("fallback", h.p, async () => { throw new Error("Offline fallback failure"); });
    denied(await createAIRouter({ policy: h.p, execution: "offline-test", store: h.store, paid: h.paid, fallback: fallbackError, clock: h.clock })(input, contract, caller()), "provider_unavailable");
    assert.equal(h.calls().paid, 0); assert.equal((await status(h)).fallback.accounted_units, reservationUnits(h.p, "fallback"));
  });
  await check("durable-port outage/timeout/inconsistent reply denies dispatch without memory bypass", async () => {
    const p = policy();
    for (const executor of [async () => { throw new Error(`${fakeKey} ${canary}`); }, async () => new Promise<never>(() => {}), async () => ({ protocol: "aivra-usage-v1" as const, atomic: true as const, result: { authorized: true, reservation: {} } })]) {
      for (const paid_enabled of [true, false]) {
        const selected = policy({ paid_enabled }); const f = fixture(selected); const store = createRedisUsageStore(executor, 5);
        denied(await createAIRouter({ policy: selected, execution: "offline-test", store, paid: f.paid, fallback: f.fallback, clock: f.clock })(input, contract, caller()), "controls_unavailable"); assert.deepEqual(f.calls(), { paid: 0, fallback: 0 });
      }
    }
    const f = fixture(p); let authorizations = 0;
    const uncertain: UsageStore = { ...f.store, authorizeAndReserve: async (r) => { authorizations++; await f.store.authorizeAndReserve(r); return new Promise(() => {}); } };
    denied(await createAIRouter({ policy: p, execution: "offline-test", store: uncertain, paid: f.paid, fallback: f.fallback, clock: f.clock })(input, contract, caller()), "controls_unavailable"); assert.equal(authorizations, 1); assert.equal((await status(f)).paid.requests_month, 1); assert.deepEqual(f.calls(), { paid: 0, fallback: 0 });
    const settled = fixture(p);
    const missingReceipt: UsageStore = { ...settled.store, settle: async (request) => { await settled.store.settle(request); return new Promise(() => {}); } };
    denied(await createAIRouter({ policy: p, execution: "offline-test", store: missingReceipt, paid: settled.paid, fallback: settled.fallback, clock: settled.clock })(input, contract, caller()), "controls_unavailable");
    assert.deepEqual(settled.calls(), { paid: 1, fallback: 0 }); assert.equal((await status(settled)).paid.accounted_units, 35);
  });
  await check("invalid requests/results keep U00.06 validation and never trigger a second provider", async () => {
    const f = fixture();
    denied(await f.invoke({ ...input, module: "cost" } as InvocationInput, contract, caller()), "invalid_input");
    denied(await f.invoke({ ...input, context: { ...input.context, user_text: "x".repeat(3000) } }, contract, caller()), "request_too_large");
    assert.deepEqual(f.calls(), { paid: 0, fallback: 0 }); assert.equal((await status(f)).paid.requests_month, 0);
    for (const output of [null, { source_ids: ["app-unknown"] }, { source_ids: [appId, appId] }, { source_ids: [appId], extra: true }, {}]) {
      const g = fixture(); const paid = transport("paid", g.p, async () => ({ output }));
      denied(await createAIRouter({ policy: g.p, execution: "offline-test", store: g.store, paid, fallback: g.fallback, clock: g.clock })(input, contract, caller()), "invalid_model_output"); assert.equal(g.calls().fallback, 0);
    }
  });
  await check("provider identities are fixed server configuration and receipts contain no payload/IP/keys", async () => {
    const f = fixture(); const wrong = { ...f.paid, model_id: "substitution" };
    denied(await createAIRouter({ policy: f.p, execution: "offline-test", store: f.store, paid: wrong, clock: f.clock })(input, contract, caller()), "controls_unavailable");
    const wire: string[] = [];
    const redis = createRedisUsageStore(async (operation) => {
      wire.push(JSON.stringify(operation));
      const result = operation.operation === "authorizeAndReserve" ? await f.store.authorizeAndReserve(ReserveRequestSchema.parse(operation.input)) : operation.operation === "settle" ? await f.store.settle(operation.input as Parameters<UsageStore["settle"]>[0]) : await f.store.getSafeUsageStatus(operation.input as Parameters<UsageStore["getSafeUsageStatus"]>[0]);
      return { protocol: "aivra-usage-v1", atomic: true, result };
    });
    const success = await createAIRouter({ policy: f.p, execution: "offline-test", store: redis, paid: f.paid, fallback: f.fallback, clock: f.clock })(input, contract, caller()); assert.ok(success.ok); assert.equal(success.result.mode, "paid"); assert.equal(success.result.routing_reason, undefined); assert.equal((await status(f)).paid.accounted_units, 35);
    for (const text of [...wire, JSON.stringify(await status(f))]) for (const forbidden of [canary, fakeKey, rawAddress, deal.applications[0].app_name]) assert.ok(!text.includes(forbidden));
  });
  await check("protected import graph permits only inert ALA/Playbook routes; no bypass, server action or fake-store import", async () => {
    for (const directory of ["app", "components", "lib"]) for (const file of await readdir(directory, { recursive: true })) {
      if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
      const name = `${directory}/${file}`.replaceAll("\\", "/"); const source = await readFile(name, "utf8");
      assert.doesNotMatch(source, /["']use server["']/);
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const target = path.resolve(path.dirname(name), match[1]).replaceAll("\\", "/").replace(/\.ts$/, "");
        if (target.endsWith("/server/ai/adapter") && name !== "lib/server/ai/router.ts") {
          assert.ok(["lib/server/playbook/request.ts", "lib/server/playbook/generate.ts"].includes(name));
          assert.match(source, /import \{ validateInvocation \} from/); assert.doesNotMatch(source, /\bcreateAIAdapter\b/);
        }
        if (target.endsWith("/server/ai/sdk-transport")) assert.ok(["lib/server/ai/openai-transport.ts", "lib/server/local-ala/providers.ts"].includes(name));
        assert.ok(!target.endsWith("/server/ai/fake-usage-store"));
      }
      if (directory !== "lib") assert.doesNotMatch(source, /server\/ai|OPENAI_API_KEY/);
    }
    const api = (await readdir("app", { recursive: true })).map((file) => file.replaceAll("\\", "/")).filter((file) => /^api(?:\/|$)/.test(file)).sort();
    assert.deepEqual(api, ["api", "api/ai", "api/ai/ala", "api/ai/ala/route.ts", "api/ai/playbook", "api/ai/playbook/route.ts", "api/local-ala", "api/local-ala/route.ts"]);
    for (const routePath of ["app/api/ai/ala/route.ts", "app/api/ai/playbook/route.ts"]) {
    const route = await readFile(routePath, "utf8");
    assert.match(route, /export function POST\(\)/); assert.match(route, /status: 503/);
    assert.doesNotMatch(route, /\bimport\s|process\.env|createAI|fake-usage|\b(?:request|req)\.(?:json|text|arrayBuffer|body)/);
    }
  });
  assert.equal(networkAttempts, 0);
  assert.ok(logs.every((line) => ![canary, fakeKey, rawAddress].some((value) => line.includes(value))));
  originalLog(`PASS: ${groups} offline AI-control groups; zero external network/provider attempts and no cloud resources.`);
} finally { globalThis.fetch = originalFetch; console.log = originalLog; console.warn = originalWarn; console.error = originalError; }
