import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { POST, runtime } from "../app/api/ai/ala/route.ts";
import { createALAAnalyzer, ALAActionErrorSchema, ALAAnalyzeOutcomeSchema } from "../lib/server/ala/analyze.ts";
import { matchesALASource } from "../lib/server/ala/request.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { EnabledPolicySchema } from "../lib/server/ai/control-policy.ts";
import type { EnabledPolicy } from "../lib/server/ai/control-policy.ts";
import type { StructuredTransport } from "../lib/server/ai/contracts.ts";
import { createDemoSession, updateApplication, updateLicense, publishSessionApplications } from "../lib/session/session.ts";
import type { ALAResult } from "../lib/server/ala/schema.ts";

const session = createDemoSession();
const apps = session.current_deal.applications;
const buyer = apps.find((app) => app.company_side === "buyer")!, target = apps.find((app) => app.company_side === "target")!;
// Synthetic structured fixtures only; never provided to the public route/UI.
const data = (): ALAResult => ({ findings: apps.map((app, index) => ({ finding_id: `f_${index}`, domain: "Offline structural check", relationship: "unique",
  buyer_app_ids: app.company_side === "buyer" ? [app.app_id] : [], target_app_ids: app.company_side === "target" ? [app.app_id] : [],
  actions: [{ action_id: `a_${index}`, subject: { app_id: app.app_id, side: app.company_side }, disposition: "Needs Review", destination: null, rationale: "No real recommendation in this synthetic fixture." }],
  rationale: "Offline contract only.", evidence: [{ app_id: app.app_id, attribute: "function" }], uncertainty: { level: "unknown", reason: "No real analysis performed." } })), not_evaluated: [] });
const start = Date.UTC(2026, 10, 1, 12), caller = { client_key: "a".repeat(64) };
function policy(patch: Partial<EnabledPolicy> = {}): EnabledPolicy {
  const paid = { model_provider: "offline-paid", model_id: "ala-paid-fixture", approved: true as const, approval_ref: "invented-offline-only-not-approval",
    monthly_budget_units: 10_000_000, per_request_ceiling_units: 1_000_000, input_units_per_token: 2, output_units_per_token: 3, concurrency: 3, credential_slot: "paid" as const };
  return EnabledPolicySchema.parse({ enabled: true, live_dispatch_enabled: false, namespace: "ala-action-offline", period_key: "2026-11", paid_enabled: true, fallback_enabled: true,
    paid, fallback: { ...paid, model_provider: "offline-fallback", model_id: "ala-open-fixture", credential_slot: "fallback", open_weight_verified: true, open_weight_evidence: "https://example.invalid/test-only", daily_requests: 50, monthly_requests: 100 },
    client_window_ms: 60_000, client_requests: 10, global_window_ms: 60_000, global_requests: 20, global_concurrency: 5, client_concurrency: 3,
    max_input_bytes: 64_000, max_output_tokens: 256, input_overhead_tokens: 512, lease_ms: 5000, timeout_ms: 1000, store_timeout_ms: 50, ...patch });
}
function fixture(output: unknown = data(), p = policy(), generate?: StructuredTransport["generate"]) {
  let paidCalls = 0, fallbackCalls = 0;
  const clock = () => start, store = createFakeUsageStore(clock);
  const paid: StructuredTransport = { model_provider: p.paid.model_provider, model_id: p.paid.model_id, generate: async (call) => { paidCalls++; return generate ? generate(call) : { output, usage: { inputTokens: 10, outputTokens: 5 } }; } };
  const fallback: StructuredTransport = { model_provider: p.fallback.model_provider, model_id: p.fallback.model_id, generate: async () => { fallbackCalls++; return { output, usage: { inputTokens: 10, outputTokens: 5 } }; } };
  return { p, store, clock, paid, fallback, analyze: createALAAnalyzer({ policy: p, execution: "offline-test", store, clock, paid, fallback }), calls: () => ({ paid: paidCalls, fallback: fallbackCalls }) };
}
let groups = 0, network = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); groups++; console.log(`PASS: ${name}`); }
if (!process.argv.includes("--ala-browser")) {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { network++; throw new Error("ALA action checks forbid external network"); };
  try {
    await check("actual POST is unconditional 503/no-store, with no request access or env/header/model activation", async () => {
      assert.equal(runtime, "nodejs"); let reads = 0;
      const hostile = new Proxy({}, { get() { reads++; throw new Error("Body must not be touched"); } });
      const previous = process.env.AIVRA_AI_ENABLED; process.env.AIVRA_AI_ENABLED = "true";
      try { for (let i = 0; i < 3; i++) {
        const response = (POST as (request?: unknown) => Response)(hostile);
        assert.equal(response.status, 503); assert.equal(response.headers.get("Cache-Control"), "no-store");
        const text = await response.text(); assert.ok(text.length <= 256); const result = ALAActionErrorSchema.parse(JSON.parse(text));
        assert.equal(result.error.code, "ai_controls_not_ready"); assert.equal(result.error.request_id, null);
      } } finally { if (previous === undefined) delete process.env.AIVRA_AI_ENABLED; else process.env.AIVRA_AI_ENABLED = previous; }
      assert.equal(reads, 0);
      const source = await readFile("app/api/ai/ala/route.ts", "utf8"); assert.doesNotMatch(source, /\bimport\s|process\.env|createAI|\.headers|\.body|\.json\(request/);
    });
    await check("complete/incomplete outcomes use actual guarded router and validated ALA envelope/source snapshot", async () => {
      const f = fixture(), before = JSON.stringify(session); const result = await f.analyze(session, caller);
      assert.equal(result.status, "success"); ALAAnalyzeOutcomeSchema.parse(result);
      if (result.status === "error") throw new Error("Expected offline structured outcome");
      assert.equal(result.envelope.prompt_version, "ala/v1"); assert.equal(result.envelope.module, "ala"); assert.equal(result.envelope.model_provider, "offline-paid");
      assert.equal(result.envelope.mode, "paid"); assert.equal(result.coverage.status, "complete"); assert.ok(matchesALASource(result.source_token, session));
      assert.deepEqual(f.calls(), { paid: 1, fallback: 0 }); assert.equal(JSON.stringify(session), before);
      const omitted = data(); const removed = omitted.findings.pop()!;
      const partial = await fixture(omitted).analyze(session, caller); assert.equal(partial.status, "incomplete");
      if (partial.status !== "error") { assert.deepEqual(partial.coverage.target.missing_app_ids, removed.target_app_ids); assert.equal(partial.envelope.data.findings.length, apps.length - 1); }
      omitted.not_evaluated.push({ app_id: removed.target_app_ids[0], side: "target", reason: "Offline unassessed example." });
      const notEvaluated = await fixture(omitted).analyze(session, caller); assert.equal(notEvaluated.status, "incomplete");
      if (notEvaluated.status !== "error") assert.deepEqual(notEvaluated.coverage.reasons, ["not_evaluated_applications"]);
    });
    await check("disabled/invalid/caller/store/rate/budget failures stay guarded; independently eligible fallback only", async () => {
      const disabled = await createALAAnalyzer()(session, caller); assert.ok(disabled.status === "error" && disabled.error.code === "ai_disabled");
      const invalid = fixture(); assert.equal((await invalid.analyze(null, caller)).status, "error"); assert.deepEqual(invalid.calls(), { paid: 0, fallback: 0 });
      assert.equal((await invalid.analyze(session)).status, "error"); assert.deepEqual(invalid.calls(), { paid: 0, fallback: 0 });
      const outage = fixture(); const badStore = { ...outage.store, authorizeAndReserve: async () => { throw new Error("private-store-canary"); } };
      const denied = await createALAAnalyzer({ policy: outage.p, execution: "offline-test", store: badStore, clock: outage.clock, paid: outage.paid, fallback: outage.fallback })(session, caller);
      assert.ok(denied.status === "error" && denied.error.code === "controls_unavailable"); assert.deepEqual(outage.calls(), { paid: 0, fallback: 0 });
      const rate = fixture(data(), policy({ client_requests: 1 })); await rate.analyze(session, caller); const limited = await rate.analyze(session, caller);
      assert.ok(limited.status === "error" && limited.error.code === "rate_limited"); assert.deepEqual(rate.calls(), { paid: 1, fallback: 0 });
      const original = policy(); const fallback = fixture(data(), policy({ paid: { ...original.paid, monthly_budget_units: 1 } }));
      const routed = await fallback.analyze(session, caller); assert.equal(routed.status, "success");
      if (routed.status !== "error") { assert.equal(routed.envelope.mode, "fallback"); assert.equal(routed.envelope.routing_reason, "budget_exhausted"); }
      assert.deepEqual(fallback.calls(), { paid: 0, fallback: 1 });
    });
    await check("wrong sides/IDs/foreign citations/destinations/conflicts/spoofed/oversized data produce no draft", async () => {
      const wrongSide = data(); wrongSide.findings[0].buyer_app_ids = []; wrongSide.findings[0].target_app_ids = [buyer.app_id]; wrongSide.findings[0].actions[0].subject.side = "target";
      const destination = data(); destination.findings[0].actions[0].disposition = "Migrate";
      const contradictory = data(); contradictory.findings[0].actions.push({ ...contradictory.findings[0].actions[0], action_id: "conflict", disposition: "Retire" });
      for (const output of [wrongSide, destination, contradictory, { ...data(), model_id: "spoofed" }, null, { pad: "x".repeat(64_001) },
        ...["unknown-id", session.current_deal.license_positions[0].license_id, session.current_deal.tsa_services[0].tsa_id].map((app_id) => ({ findings: [], not_evaluated: [{ app_id, side: "buyer", reason: "Foreign typed reference fixture." }] }))]) {
        const f = fixture(output), result = await f.analyze(session, caller); assert.ok(result.status === "error" && result.error.code === "invalid_model_output");
        assert.equal("envelope" in result, false); assert.deepEqual(f.calls(), { paid: 1, fallback: 0 });
      }
    });
    await check("pending source edit/publish/reset invalidates snapshot; license edit retains application freshness", async () => {
      let release!: () => void; const deferred = new Promise<void>((resolve) => { release = resolve; });
      const f = fixture(data(), policy(), async () => { await deferred; return { output: data() }; });
      const pending = f.analyze(session, caller);
      await new Promise((resolve) => setImmediate(resolve));
      const appEdit = updateApplication(session, buyer.app_id, { app_name: "Changed synthetic source" });
      const licenseEdit = updateLicense(session, session.current_deal.license_positions[0].license_id, { product: "License-only source edit" });
      const published = publishSessionApplications(session, "buyer", [...apps.filter((app) => app.company_side === "buyer"), { ...buyer, app_id: "new-source-while-pending" }], { session_id: session.session_id, session_revision: session.session_revision });
      release(); const result = await pending; assert.equal(result.status, "success");
      if (result.status === "error") throw new Error("Expected offline snapshot result");
      assert.equal(matchesALASource(result.source_token, appEdit), false); assert.equal(matchesALASource(result.source_token, published), false);
      assert.equal(matchesALASource(result.source_token, createDemoSession()), false); assert.equal(matchesALASource(result.source_token, licenseEdit), true);
      assert.equal(result.coverage.buyer.source_count, 15); assert.deepEqual(result.envelope.data, data());
    });
    await check("capacity/provider error/timeout are safe and never dispatch fallback or retry", async () => {
      let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
      const base = policy(); const p = policy({ global_concurrency: 1, client_concurrency: 1, paid: { ...base.paid, concurrency: 1 }, fallback: { ...base.fallback, concurrency: 1 } });
      const busy = fixture(data(), p, async () => { await waiting; return { output: data() }; });
      const first = busy.analyze(session, caller); await new Promise((resolve) => setImmediate(resolve)); const blocked = await busy.analyze(session, caller);
      assert.ok(blocked.status === "error" && blocked.error.code === "capacity_reached"); release(); await first; assert.deepEqual(busy.calls(), { paid: 1, fallback: 0 });
      const failed = fixture(data(), policy(), async () => { throw new Error("private-provider-canary"); });
      const error = await failed.analyze(session, caller); assert.ok(error.status === "error" && error.error.code === "provider_unavailable"); assert.ok(!JSON.stringify(error).includes("private-provider-canary")); assert.deepEqual(failed.calls(), { paid: 1, fallback: 0 });
      const timeout = fixture(data(), policy({ timeout_ms: 5 }), async () => new Promise(() => {})); const timed = await timeout.analyze(session, caller);
      assert.ok(timed.status === "error" && timed.error.code === "provider_unavailable"); assert.deepEqual(timeout.calls(), { paid: 1, fallback: 0 });
    });
    await check("public UI has no dataset transport/success rendering; composition has no provider bypass or writes", async () => {
      const ui = await readFile("components/ala/analyze-applications.tsx", "utf8");
      assert.doesNotMatch(ui, /body:|JSON\.stringify|metadataFromValidatedResult|setView\(\{ status: "completed"|recordDerivedResultMetadata|sessionStorage/);
      const analyze = await readFile("lib/server/ala/analyze.ts", "utf8");
      assert.match(analyze, /createAIRouter\(options\)/); assert.match(analyze, /buildALARequest\(session\)/); assert.match(analyze, /inspectALAResult\(/);
      assert.doesNotMatch(analyze, /createAIAdapter|sdk-transport|openai-transport|fake-usage-store|recordDerivedResultMetadata|process\.env/);
      assert.equal(network, 0);
    });
    console.log(`PASS: ${groups} U02.02 offline groups; real guarded router, fake test-only providers/store; public POST never reads data; zero external/provider attempts.`);
  } finally { globalThis.fetch = savedFetch; }
}

export async function checkALAActionBrowser({ page, evaluate, until, base }: Parameters<typeof import("./check-csv-preview.mts").checkCSVBrowser>[0]) {
  const tracker = `(() => {
    const original = window.fetch.bind(window); window.__alaCalls = []; window.__holdALA = false;
    window.fetch = (input, init) => {
      if (String(input) !== '/api/ai/ala') return original(input, init);
      window.__alaCalls.push({method:init?.method,bodyAbsent:init?.body===undefined,credentials:init?.credentials});
      if (window.__holdALA) return new Promise((resolve,reject) => { window.__releaseALA = () => original(input,init).then(resolve,reject); });
      return original(input,init);
    };
  })()`;
  await page("Page.addScriptToEvaluateOnNewDocument", { source: tracker });
  await page("Page.navigate", { url: `${base}/application-rationalization` });
  await until("!!document.querySelector('.ala-analyze-button') && document.querySelector('.session-controls').dataset.sessionReady === 'true'");
  assert.equal(await evaluate("window.__alaCalls.length"), 0);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.ala-source-summary dd')].map(e=>e.textContent)"), ["15", "15", "0"]);
  const original = await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')");
  for (const width of [1440, 390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const before = await evaluate("window.__alaCalls.length");
    await evaluate("window.__holdALA=true; document.querySelector('.ala-analyze-button').focus()");
    assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none");
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until("document.querySelector('.ala-analyze-button').disabled && !!document.querySelector('.ala-checking')");
    await evaluate("document.querySelector('.ala-analyze-button').click(); document.querySelector('.ala-analyze-button').click()");
    assert.equal(await evaluate("window.__alaCalls.length"), before + 1);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    await evaluate("window.__holdALA=false; window.__releaseALA()");
    await until("!!document.querySelector('.ai-notice--error') && !document.querySelector('.ala-analyze-button').disabled");
    assert.match(await evaluate("document.querySelector('.ai-notice--error').textContent"), /not ready for live requests/);
    assert.equal(await evaluate("document.querySelector('.ai-notice-model') === null"), true);
    assert.equal(await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')"), original);
  }
  // Reset during an actual pending readiness fetch: old completion is ignored, no automatic request.
  await evaluate("window.__holdALA=true; document.querySelector('.ala-analyze-button').click()"); await until("!!document.querySelector('.ala-checking')");
  const beforeReset = await evaluate("window.__alaCalls.length");
  await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Reset demo session').click()"); await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Confirm reset').click()");
  await until("!document.querySelector('.ala-checking') && !document.querySelector('.ala-analyze-button').disabled");
  await evaluate("window.__holdALA=false; window.__releaseALA().catch(()=>{})");
  assert.equal(await evaluate("window.__alaCalls.length"), beforeReset); assert.equal(await evaluate("document.querySelector('.ai-notice-title').textContent"), "AI not enabled");
  // Client navigation unmounts and aborts; remount/refresh do not invoke AI.
  await evaluate("window.__holdALA=true; document.querySelector('.ala-analyze-button').click()"); await until("!!document.querySelector('.ala-checking')");
  const beforeNavigate = await evaluate("window.__alaCalls.length");
  await evaluate("document.querySelector('nav a[href=\"/\"]').click()"); await until("location.pathname==='/'");
  await evaluate("window.__holdALA=false; window.__releaseALA().catch(()=>{})");
  await evaluate("document.querySelector('nav a[href=\"/application-rationalization\"]').click()"); await until("!!document.querySelector('.ala-analyze-button')");
  assert.equal(await evaluate("window.__alaCalls.length"), beforeNavigate);
  assert.equal(await evaluate("document.querySelector('.ai-notice-title').textContent"), "AI not enabled");
  assert.ok(await evaluate("window.__alaCalls.every(c=>c.method==='POST' && c.bodyAbsent && c.credentials==='omit')"));
  await page("Page.reload"); await until("!!document.querySelector('.ala-analyze-button') && !document.querySelector('.ala-analyze-button').disabled");
  assert.equal(await evaluate("window.__alaCalls.length"), 0);
  assert.equal((await fetch(`${base}/api/ai/ala`, { method: "GET" })).status, 405);
  const response = await fetch(`${base}/api/ai/ala`, { method: "POST", body: "synthetic rejected body", headers: { "x-aivra-test-mode": "enabled" } });
  assert.equal(response.status, 503); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.ok(ALAActionErrorSchema.safeParse(await response.json()).success);
  for (const route of ["/", "/data-mapper", "/integration-health", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"]) assert.equal((await fetch(`${base}${route}`)).status, 200);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature a,.future-feature button,.future-feature [tabindex]').length"), 0);
  console.log("PASS: Chromium 1440/390/320; no mount/reset/navigation/refresh AI calls, one body-free POST per keyboard action, pending double-click block, truthful unavailable/no result, stale reset/unmount cancellation, unchanged source, 503/no-store and GET 405");
}
