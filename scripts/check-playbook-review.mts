import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { setup, specimen } from "./check-playbook-contract.mts";
import { preparePlaybookContract } from "../lib/server/playbook/contract.ts";
import { PlaybookResultSchema } from "../lib/server/playbook/schema.ts";
import { createPlaybookGenerator } from "../lib/server/playbook/generate.ts";
import { createPlaybookReviewSource } from "../lib/server/playbook/review-source.ts";
import { EnabledPolicySchema } from "../lib/server/ai/control-policy.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { createDemoSession, updateApplication, updateLicense, updateTSA } from "../lib/session/session.ts";
import { createPlaybookReviewDraft, validatePlaybookReviewDraft, PlaybookReviewDraftSchema, playbookReviewBinding, projectPlaybookReview,
  savePlaybookEdit, restorePlaybookRow, validatePlaybookEdit, verifyPlaybookReviewSession, readPlaybookSource, MAX_PLAYBOOK_REVIEW_BYTES } from "../lib/playbook-generator/review-draft.ts";
import { POST } from "../app/api/ai/playbook/route.ts";

// Fabricated protected outcomes/policies/roles/dates, isolated offline tests ONLY.
export async function fixture(incomplete = false, many = false) {
  const seed = setup(); let latest = structuredClone(seed.inputs), calls = 0; const listeners = new Set<() => void>();
  const prepared = preparePlaybookContract(latest); assert.ok(prepared.ok);
  const output = specimen(prepared.input), refs = output.actions.flatMap(a => a.source_refs);
  output.phases.push({ ...output.phases[0], phase_id: "phase_2", sequence: 2, title: "Fabricated second phase" });
  output.actions = [
    { ...output.actions[0], activity_id: "activity_0", title: "Fabricated discovery activity", description: "Offline test content only", depends_on_activity_ids: [], source_refs: refs.slice(0, 20) },
    { ...output.actions[1], activity_id: "activity_1", title: "Fabricated planning activity", depends_on_activity_ids: ["activity_0"], source_refs: refs.slice(20) },
    { ...output.actions[2], activity_id: "activity_2", phase_id: "phase_2", title: "Fabricated transition activity", depends_on_activity_ids: ["activity_1"], source_refs: [refs[0]] },
  ];
  output.milestones = [
    { ...output.milestones[0], milestone_id: "milestone_0", title: "Fabricated discovery milestone", after_activity_ids: ["activity_1"] },
    { ...output.milestones[0], milestone_id: "milestone_1", phase_id: "phase_2", title: "Fabricated transition milestone", after_activity_ids: ["activity_2"], proposed_date: "2027-01-31", date_assumption: "Fabricated unverified planning date" },
  ];
  output.risks = [{ risk_id: "risk_0", description: "Fabricated uncertain risk narrative", source_refs: [refs[0]], assumptions: ["Evidence is incomplete in this fictional example"], uncertainty: { level: "unknown", reason: "No real analysis performed" } }];
  if (incomplete) { output.actions[1].source_refs = refs.slice(20, -1); output.coverage_status = "incomplete"; }
  if (many) for (let i = 3; i < 100; i++) output.actions.push({ ...output.actions[0], activity_id: `activity_${i}`, title: "Fabricated extra activity", source_refs: [refs[0]] });
  const paid = { model_provider: "offline-paid", model_id: "review-test-paid", approved: true, approval_ref: "fabricated-not-real-approval", monthly_budget_units: 10000000, per_request_ceiling_units: 1000000, input_units_per_token: 1, output_units_per_token: 1, concurrency: 1, credential_slot: "paid" };
  const policy = EnabledPolicySchema.parse({ enabled: true, live_dispatch_enabled: false, namespace: "playbook-review-offline", period_key: "2026-11", paid_enabled: true, fallback_enabled: false, paid,
    fallback: { ...paid, model_provider: "offline-open", model_id: "review-test-open", credential_slot: "fallback", open_weight_verified: true, open_weight_evidence: "https://example.invalid/offline", daily_requests: 10, monthly_requests: 20 },
    client_window_ms: 60000, client_requests: 10, global_window_ms: 60000, global_requests: 20, global_concurrency: 1, client_concurrency: 1, max_input_bytes: 128000, max_output_tokens: 2048, input_overhead_tokens: 512, timeout_ms: 1500, lease_ms: 5000, store_timeout_ms: 100 });
  const clock = () => Date.UTC(2026, 10, 4, 12), owner = createPlaybookGenerator({ policy, execution: "offline-test", clock, store: createFakeUsageStore(clock), paid: { model_provider: paid.model_provider, model_id: paid.model_id, generate: async () => { calls++; return { output, usage: { inputTokens: 10, outputTokens: 5 } }; } } });
  const read = () => latest, subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
  const result = await owner.generate(read, { client_key: "a".repeat(64) }); assert.notEqual(result.status, "error", JSON.stringify(result));
  const source = createPlaybookReviewSource(owner, result, read, subscribe);
  const draft = createPlaybookReviewDraft(source); assert.ok(draft);
  return { seed, read, source, draft, owner, result, subscribe, calls: () => calls, replace: (v: typeof latest) => { latest = v; listeners.forEach(n => n()); } };
}
function proposal(f: Awaited<ReturnType<typeof fixture>>, kind: "activity" | "milestone" = "activity", id = kind === "activity" ? "activity_0" : "milestone_0") {
  const projected = projectPlaybookReview(f.source, f.draft)!; const row = (kind === "activity" ? projected.activities : projected.milestones).find(r => r.id === id)!;
  return { binding: playbookReviewBinding(f.source)!, kind, id, values: { ...row.values }, visitor_reason: "Fabricated visitor justification" };
}
function saved(r: ReturnType<typeof savePlaybookEdit>) { assert.ok(r.ok, JSON.stringify(r)); return r.draft; }
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/check-playbook-review.mts")) {
let groups = 0, network = 0; const savedFetch = globalThis.fetch; globalThis.fetch = async () => { network++; throw Error("Review tests forbid network"); };
async function check(name: string, run: () => unknown | Promise<unknown>) { await run(); groups++; console.log(`PASS: ${name}`); }
try {
  await check("real issued/current server owner only; cloned/forged/bool/JSON sources cannot grant a review", async () => {
    const f = await fixture(); assert.equal(readPlaybookSource(f.source).state, "current"); assert.ok(Object.isFrozen(f.result));
    const imported = createPlaybookReviewSource(f.owner, structuredClone(f.result), f.read, f.subscribe); assert.equal(createPlaybookReviewDraft(imported), null);
    for (const source of [null, { current: true, outcome: f.result }, JSON.parse(JSON.stringify(f.source))]) assert.equal(createPlaybookReviewDraft(source as never), null);
    const invalid = structuredClone(f.result); if (invalid.status !== "error") { invalid.envelope.data.actions[0].depends_on_activity_ids = ["activity_0"]; assert.equal(PlaybookResultSchema.safeParse(invalid.envelope.data).success, false); } assert.equal(createPlaybookReviewDraft(createPlaybookReviewSource(f.owner, invalid, f.read, f.subscribe)), null);
  });
  await check("minimal activity patches, original/effective/provenance separation, no-op and repeated save/restore", async () => {
    const f = await fixture(), original = JSON.stringify({ result: f.result, inputs: f.read() }), p = proposal(f); p.values.title = "Visitor proposed title";
    const d = saved(savePlaybookEdit(f.source, f.draft, p)); assert.deepEqual(d.overrides[0].changes, { title: p.values.title }); assert.equal(d.overrides[0].origin, "visitor_edit");
    const view = projectPlaybookReview(f.source, d)!; assert.equal(view.activities[0].values.title, p.values.title); assert.equal(view.activities[0].original.title, "Fabricated discovery activity"); assert.equal(view.visitor_edit_count, 1);
    const same = savePlaybookEdit(f.source, d, p); assert.ok(same.ok && !same.changed); const restored = saved(restorePlaybookRow(f.source, d, "activity", "activity_0")); assert.equal(restored.overrides.length, 0);
    const noOp = saved(savePlaybookEdit(f.source, d, { ...proposal(f), visitor_reason: "" })); assert.equal(noOp.overrides.length, 0); assert.equal(JSON.stringify({ result: f.result, inputs: f.read() }), original); assert.equal(f.calls(), 1);
  });
  await check("title/description/nullable proposed roles and nonblank reasons validate strictly without normalization", async () => {
    const f = await fixture(), p = proposal(f); assert.equal(p.values.ownership_role, null); p.values.ownership_role = "Proposed integration role"; p.values.description = "Visitor wording, not source evidence";
    const d = saved(savePlaybookEdit(f.source, f.draft, p)); assert.equal(projectPlaybookReview(f.source, d)!.activities[0].values.ownership_role, p.values.ownership_role);
    for (const values of [{ ...p.values, title: " " }, { ...p.values, description: "" }, { ...p.values, ownership_role: "" }, { ...p.values, ownership_role: " " }, { ...p.values, title: "x".repeat(121) }, { ...p.values, description: "x".repeat(801) }]) assert.equal(savePlaybookEdit(f.source, d, { ...p, values }).ok, false);
    for (const visitor_reason of ["", " ", "x".repeat(401)]) assert.equal(savePlaybookEdit(f.source, d, { ...p, visitor_reason }).ok, false);
    const cleared = saved(savePlaybookEdit(f.source, d, { ...p, values: { ...p.values, ownership_role: null } })); assert.equal(projectPlaybookReview(f.source, cleared)!.activities[0].values.ownership_role, null);
  });
  await check("proposed milestone date+basis pairing, real calendar date, unknown and exact original restore", async () => {
    const f = await fixture(), p = proposal(f, "milestone"); p.values.title = "Visitor proposed milestone"; p.values.proposed_date = "2027-02-28"; p.values.date_assumption = "Unverified visitor planning assumption";
    const d = saved(savePlaybookEdit(f.source, f.draft, p)); assert.equal(projectPlaybookReview(f.source, d)!.milestones[0].values.proposed_date, "2027-02-28");
    for (const values of [{ ...p.values, proposed_date: "2027-02-30" }, { ...p.values, proposed_date: "2027-2-2" }, { ...p.values, proposed_date: "2027-02-28T00:00:00Z" }, { ...p.values, date_assumption: null }, { ...p.values, date_assumption: " " }, { ...p.values, proposed_date: null }]) assert.equal(savePlaybookEdit(f.source, d, { ...p, values }).ok, false);
    const unknown = saved(savePlaybookEdit(f.source, d, { ...p, values: { title: p.values.title, proposed_date: null, date_assumption: null } })); assert.equal(projectPlaybookReview(f.source, unknown)!.milestones[0].values.proposed_date, null);
    assert.equal(saved(restorePlaybookRow(f.source, d, "milestone", "milestone_0")).overrides.length, 0);
  });
  await check("IDs/phases/refs/dependencies/links/assumptions/uncertainty are read-only; forgery and extra fields rejected", async () => {
    const f = await fixture(), p = proposal(f); p.values.title = "Changed";
    for (const extra of ["activity_id", "phase_id", "source_refs", "depends_on_activity_ids", "assumptions", "uncertainty", "actual_status", "approved"]) assert.equal(savePlaybookEdit(f.source, f.draft, { ...p, values: { ...p.values, [extra]: [] } }).ok, false);
    assert.equal(savePlaybookEdit(f.source, f.draft, { ...p, id: "foreign" }).ok, false); assert.equal(savePlaybookEdit(f.source, f.draft, { ...p, kind: "phase" }).ok, false);
    const milestone = proposal(f, "milestone"); assert.equal(savePlaybookEdit(f.source, f.draft, { ...milestone, values: { ...milestone.values, after_activity_ids: ["foreign"] } }).ok, false);
    assert.equal(restorePlaybookRow(f.source, f.draft, "activity", "foreign").ok, false);
  });
  await check("strict identity/source binding, duplicate/redundant/empty/undefined overlays and oversized review fail atomically", async () => {
    const f = await fixture(), p = proposal(f); p.values.title = "Changed"; const d = saved(savePlaybookEdit(f.source, f.draft, p));
    for (const value of [{ ...d, extra: true }, { ...d, overrides: [...d.overrides, d.overrides[0]] }, { ...d, overrides: [{ ...d.overrides[0], changes: {} }] }, { ...d, overrides: [{ ...d.overrides[0], changes: { title: "Fabricated discovery activity" } }] }, { ...d, overrides: [{ ...d.overrides[0], changes: { title: undefined } }] }, { ...d, binding: { ...d.binding, request_id: crypto.randomUUID() } }, { ...d, binding: { ...d.binding, input_digest: "0".repeat(64) } }, { ...d, binding: { ...d.binding, source: { ...d.binding.source, scenario_digest: "0".repeat(64) } } }]) assert.equal(validatePlaybookReviewDraft(f.source, value), null);
    const large = await fixture(false, true); let current = large.draft, refused = false;
    for (let i = 0; i < 100; i++) { const proposal = { binding: current.binding, kind: "activity", id: `activity_${i}`, values: { title: "t".repeat(120), description: "d".repeat(800), ownership_role: "r".repeat(120) }, visitor_reason: "b".repeat(400) }; const before = JSON.stringify(current), result = savePlaybookEdit(large.source, current, proposal); if (!result.ok) { assert.equal(JSON.stringify(current), before); refused = true; break; } current = result.draft; assert.ok(new TextEncoder().encode(JSON.stringify(current)).length <= MAX_PLAYBOOK_REVIEW_BYTES); }
    assert.ok(refused); assert.ok(PlaybookReviewDraftSchema.safeParse(current).success);
  });
  await check("Reset/app/license/TSA/review/scenario/raw-source changes revoke saved+unsaved authority, with notifications", async () => {
    const mutations = [(v: ReturnType<typeof setup>["inputs"]) => { v.current_session = createDemoSession(); }, (v: ReturnType<typeof setup>["inputs"]) => { v.current_session = updateApplication(v.current_session, v.current_session.current_deal.applications[0].app_id, { notes: "Changed" }); }, (v: ReturnType<typeof setup>["inputs"]) => { v.current_session = updateLicense(v.current_session, v.current_session.current_deal.license_positions[0].license_id, { seats_used: 0 }); }, (v: ReturnType<typeof setup>["inputs"]) => { v.current_session = updateTSA(v.current_session, v.current_session.current_deal.tsa_services[0].tsa_id, { status: "active" }); }, (v: ReturnType<typeof setup>["inputs"]) => { v.review.overrides[0].visitor_reason = "Changed review"; }, (v: ReturnType<typeof setup>["inputs"]) => { v.selected_scenario = "baseline"; }, (v: ReturnType<typeof setup>["inputs"]) => { v.scenario.alternative.financial_draft.actions[0].annual_run_rate.note = "Changed assumption"; }, (v: ReturnType<typeof setup>["inputs"]) => { v.current_session.current_deal.tsa_services[0].owner = "Unversioned change"; }];
    for (const mutate of mutations) { const f = await fixture(); let notices = 0; const unsubscribe = f.source.subscribe(() => { notices++; }); const p = proposal(f); p.values.title = "Unsaved candidate"; const d = saved(savePlaybookEdit(f.source, f.draft, p)); const v = structuredClone(f.read()); mutate(v); f.replace(v); assert.equal(readPlaybookSource(f.source).state, "outdated"); assert.equal(validatePlaybookReviewDraft(f.source, d), null); assert.equal(savePlaybookEdit(f.source, d, p).ok, false); assert.equal(projectPlaybookReview(f.source, d), null); assert.ok(notices > 0); unsubscribe(); assert.equal(f.calls(), 1); }
  });
  await check("replacement result binding and async local digest cannot authorize an old review or manufacture currentness", async () => {
    const f = await fixture(); assert.ok(await verifyPlaybookReviewSession(f.source, f.read().current_session));
    const raw = structuredClone(f.read().current_session); raw.current_deal.tsa_services[0].title = "Local unversioned mismatch"; assert.equal(await verifyPlaybookReviewSession(f.source, raw), false);
    const replacement = await f.owner.generate(f.read, { client_key: "a".repeat(64) }), source = createPlaybookReviewSource(f.owner, replacement, f.read, f.subscribe); assert.equal(validatePlaybookReviewDraft(source, f.draft), null);
    const pending = verifyPlaybookReviewSession(f.source, f.read().current_session); const changed = structuredClone(f.read()); changed.selected_scenario = "baseline"; f.replace(changed); assert.equal(await pending, false);
  });
  await check("incomplete coverage/unknown roles/original provenance survive effective edits; graph shape remains unchanged", async () => {
    const f = await fixture(true), original = JSON.stringify(f.result), p = proposal(f); p.values.title = "<img src=x onerror=alert(1)>";
    const d = saved(savePlaybookEdit(f.source, f.draft, p)), projection = projectPlaybookReview(f.source, d)!; assert.equal(projection.data.original.status, "incomplete"); assert.ok(projection.data.original.coverage.missing_tsa_ids.length > 0); assert.equal(projection.activities[0].values.ownership_role, null); assert.equal(JSON.stringify(f.result), original);
    const candidate = { ...projection.data.original.envelope.data, actions: projection.activities.map(r => ({ ...r.original, ...r.values })), milestones: projection.milestones.map(r => ({ ...r.original, ...r.values })) }; assert.ok(PlaybookResultSchema.safeParse(candidate).success);
    const evidence = await fixture(true); const view = readPlaybookSource(evidence.source); assert.ok("data" in view);
    const replacement = await evidence.owner.generate(evidence.read, { client_key: "a".repeat(64) }); const replacementView = readPlaybookSource(createPlaybookReviewSource(evidence.owner, replacement, evidence.read, evidence.subscribe)); assert.ok("data" in replacementView);
    await mkdir(".temp/u04-03", { recursive: true }); await writeFile(".temp/u04-03/fixture.json", JSON.stringify({ session: evidence.read().current_session, view, replacementView }));
  });
  await check("public503/source absence, no client server runtime/network/storage/export and original safety boundaries", async () => {
    let reads = 0; const r = (POST as (request?: unknown) => Response)(new Proxy({}, { get() { reads++; throw Error("No request reads"); } })); assert.equal(r.status, 503); assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(reads, 0);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/playbook/review-source.ts')"], { encoding: "utf8", timeout: 5000 }); assert.notEqual(child.status, 0); assert.match(child.stderr, /server-only|Client Component/);
    for (const file of ["lib/playbook-generator/review-draft.ts", "components/playbook-generator/playbook-review-workspace.tsx"]) { const text = (await readFile(file, "utf8")).replace(/^import type .*$/gm, ""); assert.doesNotMatch(text, /server\/|server-only|fetch\(|localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML|createObjectURL|process\.env|console\./); }
    assert.equal(createPlaybookReviewDraft(null), null); assert.equal(network, 0);
  });
  console.log(`PASS: ${groups} U04.03 groups; issued-source review, strict visitor overlays, immutable originals, stale revocation and zero network.`);
} finally { globalThis.fetch = savedFetch; }

}
