import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createDemoSession, updateLicense, updateApplication, updateTSA, publishSessionApplications } from "../lib/session/session.ts";
import { createLicenseAnalyzer } from "../lib/server/licenses/analyze.ts";
import { createALAAnalyzer } from "../lib/server/ala/analyze.ts";
import { projectLicenseResults } from "../lib/server/licenses/presentation.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import type { LicenseResult } from "../lib/server/licenses/schema.ts";
import { createLicenseSelectionDraft, saveLicenseSelection, clearLicenseSelection, licenseReviewIdentity } from "../lib/license-optimizer/review-selections.ts";
import { createReviewDraft } from "../lib/ala/review-overrides.ts";
import { prepareCSEContext } from "../lib/server/cost-synergy/reviewed-context.ts";
import { calculateCSE, sourceCostMinor } from "../lib/cost-synergy/calculation.ts";
import { CSERequestSchema, MAX_CSE_BYTES } from "../lib/cost-synergy/calculation-contract.ts";
import type { CSERequest } from "../lib/cost-synergy/calculation-contract.ts";
import { buildLicenseCSEHandoff, validateCurrentLicenseCSEHandoff } from "../lib/server/licenses/cse-handoff.ts";
import { readLicenseCSEHandoff, LicenseCSEHandoffSchema, licenseCostEvidence, assessLicenseCandidates } from "../lib/license-optimizer/cse-handoff.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { EnabledPolicySchema } from "../lib/server/ai/control-policy.ts";
import { POST } from "../app/api/ai/ala/route.ts";

// Entirely fabricated inference/financial test fixtures, never public analysis or approvals.
const session = createDemoSession(), deal = session.current_deal, licenses = deal.license_positions;
licenses[0].annual_spend = 0; licenses[0].notes = '<script>offline-only</script> & "Case"'; delete licenses[0].renewal_date;
licenses[1].annual_spend = null; licenses[1].renewal_date = null; licenses[2].annual_spend = 1.001;
deal.applications.find((a) => a.app_id === licenses[2].app_id)!.annual_cost = 1.001;
function specimen(s = session): LicenseResult {
  const findings: LicenseResult["findings"] = s.current_deal.license_positions.map((l, i) => ({ finding_id: `finding_${i}`, category: "Fabricated test", license_ids: [l.license_id], app_ids: [l.app_id],
    suggested_action: "Offline fixture only.", rationale: "No real analysis.", evidence: [{ license_id: l.license_id, attribute: "annual_spend" }], unknowns: ["Missing contract evidence."], assumptions: ["Test only."], uncertainty: { level: "unknown", reason: "No model ran." }, review_required: true }));
  findings.push({ ...structuredClone(findings[0]), finding_id: "shared_license" }); return { findings, not_evaluated: [] };
}
const model = { model_provider: "offline-paid", model_id: "handoff-test", approved: true, approval_ref: "fabricated-not-model-approval", monthly_budget_units: 10_000_000, per_request_ceiling_units: 1_000_000, input_units_per_token: 2, output_units_per_token: 3, concurrency: 1, credential_slot: "paid" };
const policy = EnabledPolicySchema.parse({ enabled: true, live_dispatch_enabled: false, namespace: "handoff-offline", period_key: "2026-11", paid_enabled: true, fallback_enabled: true, paid: model,
  fallback: { ...model, model_provider: "offline-fallback", model_id: "handoff-open-test", credential_slot: "fallback", open_weight_verified: true, open_weight_evidence: "https://example.invalid/test-only", daily_requests: 50, monthly_requests: 100 }, client_window_ms: 60000, client_requests: 20, global_window_ms: 60000, global_requests: 50,
  global_concurrency: 3, client_concurrency: 1, max_input_bytes: 128000, max_output_tokens: 2048, input_overhead_tokens: 512, lease_ms: 5000, timeout_ms: 1000, store_timeout_ms: 50 });
let mockCalls = 0, network = 0, groups = 0;
async function invoke(kind: "licenses" | "ala", output: unknown, source = session, fallback = false) {
  const clock = () => Date.UTC(2026, 10, 1, 21), store = createFakeUsageStore(clock);
  const p = fallback ? EnabledPolicySchema.parse({ ...policy, paid: { ...policy.paid, monthly_budget_units: 1 } }) : policy;
  const transport = (mode: "paid" | "fallback") => ({ model_provider: p[mode].model_provider, model_id: p[mode].model_id, generate: async () => { mockCalls++; return { output }; } });
  const options = { policy: p, execution: "offline-test" as const, clock, store, paid: transport("paid"), fallback: transport("fallback") };
  return (kind === "licenses" ? createLicenseAnalyzer(options) : createALAAnalyzer(options))(source, { client_key: "a".repeat(64) });
}
async function setup(output = specimen(), source = session, fallback = false) {
  const outcome = await invoke("licenses", output, source, fallback), view = projectLicenseResults(outcome, source, source); assert.ok("data" in view);
  const empty = createLicenseSelectionDraft(view)!;
  function select(ids: string[]) { let draft = empty; for (const finding_id of ids) { const r = saveLicenseSelection(view, draft, { result_identity: licenseReviewIdentity(view), finding_id, status: "selected" }); assert.ok(r.ok); draft = r.draft; } return draft; }
  return { outcome, view, empty, select };
}
function handoff(r: ReturnType<typeof buildLicenseCSEHandoff>) { assert.ok(r.ok, JSON.stringify(r)); return r.handoff; }
function failure(r: ReturnType<typeof buildLicenseCSEHandoff>, code?: string) { assert.equal(r.ok, false); if (!r.ok && code) assert.equal(r.code, code); assert.equal("handoff" in r, false); }
async function cse(source = session) {
  const output = { findings: source.current_deal.applications.map((a, i) => ({ finding_id: `ala_${i}`, domain: "Test", relationship: "unique", buyer_app_ids: a.company_side === "buyer" ? [a.app_id] : [], target_app_ids: a.company_side === "target" ? [a.app_id] : [],
    actions: [{ action_id: `action_${i}`, subject: { app_id: a.app_id, side: a.company_side }, disposition: "Needs Review", destination: null, rationale: "Test." }], rationale: "Test.", evidence: [{ app_id: a.app_id, attribute: "annual_cost" }], uncertainty: { level: "unknown", reason: "Test." } })), not_evaluated: [] };
  const outcome = await invoke("ala", output, source), view = projectALAResults(outcome, source, source), context = prepareCSEContext(outcome, source, source, createReviewDraft(view)); assert.ok(context?.reviewed);
  const money = (annual: boolean) => ({ amount_minor: annual ? 7000 : 0, unit: annual ? "minor_units_per_year" : "minor_units_once", currency: "CAD", basis: "visitor_assumption", basis_note: "Explicit fabricated financial assumption." });
  const action = context.reviewed.effective_actions.find((a) => a.subject.app_id === source.current_deal.license_positions[0].app_id)!;
  const request = { contract_version: "cse/calculation/v1", expected_source: context.source, expected_review_digest: context.review_digest, review_identity: context.reviewed.review.result_identity, horizon_years: 1,
    lines: [{ line_id: "cse_line", attribution_key: "cse_owner", source_kind: "ala", included: true, spend_app_ids: [action.subject.app_id], action_reference: { finding_id: action.finding_id, action_id: action.action_id, subject: action.subject }, annual_run_rate: money(true), migration_one_time_cost: money(false), transition_overlap_cost: money(false) }] };
  return { context, request: CSERequestSchema.parse(request) };
}
const fetchBefore = globalThis.fetch; globalThis.fetch = async () => { network++; throw Error("Handoff tests forbid network"); };
async function check(name: string, run: () => void | Promise<void>) { await run(); groups++; console.log(`PASS: ${name}`); }
try {
  const base = await setup(), review = base.select(["finding_0"]), original = JSON.stringify({ session, base: { outcome: base.outcome, view: base.view, review } });
  const built = handoff(buildLicenseCSEHandoff(base.outcome, session, session, review));
  await check("guarded mocked outcome -> current projection/selection -> immutable selected-only handoff, exact originals/provenance", () => {
    assert.equal(built.contract_version, "licenses/cse-handoff/v1"); assert.equal(built.target_contract, "cse/calculation/v1"); assert.equal(built.status, "provisional_unapproved"); assert.equal(built.candidates.length, 1);
    assert.deepEqual(built.candidates[0].original, base.view.data.findings[0].original); assert.deepEqual(built.provenance, base.view.data.provenance); assert.deepEqual(built.review_snapshot, review); assert.deepEqual(built.source_token, base.view.data.source_token);
    assert.deepEqual(built.candidates[0].licenses[0].record, licenses[0]); assert.equal(Object.hasOwn(built.candidates[0].licenses[0].record, "renewal_date"), false);
    assert.equal(built.candidates[0].applications[0].company_side, deal.applications.find((a) => a.app_id === licenses[0].app_id)!.company_side);
    assert.equal(built.financial_aggregation, "withheld"); assert.equal(CSERequestSchema.safeParse(built).success, false); assert.equal("totals" in built, false); assert.equal("current_deal" in built, false); assert.ok(Object.isFrozen(built.candidates[0].original));
  });
  await check("unreviewed/not-selected/cleared findings never become impact candidates; no-selection is not zero savings", () => {
    const none = handoff(buildLicenseCSEHandoff(base.outcome, session, session, base.empty)); assert.equal(none.selection_state, "no_selected_opportunities"); assert.deepEqual(none.candidates, []);
    const declined = saveLicenseSelection(base.view, review, { result_identity: licenseReviewIdentity(base.view), finding_id: "finding_0", status: "not_selected" }); assert.ok(declined.ok); assert.deepEqual(handoff(buildLicenseCSEHandoff(base.outcome, session, session, declined.draft)).candidates, []);
    const cleared = clearLicenseSelection(base.view, review, { result_identity: licenseReviewIdentity(base.view), finding_id: "finding_0" }); assert.ok(cleared.ok); assert.deepEqual(handoff(buildLicenseCSEHandoff(base.outcome, session, session, cleared.draft)).candidates, []);
    const both = saveLicenseSelection(base.view, review, { result_identity: licenseReviewIdentity(base.view), finding_id: "finding_1", status: "not_selected" }); assert.ok(both.ok); const h = handoff(buildLicenseCSEHandoff(base.outcome, session, session, both.draft)); assert.equal(h.candidates.length, 1); assert.equal(h.review_snapshot.selections.length, 2);
  });
  await check("known zero/null/nonexact/range source cost evidence never becomes savings or rounded money", () => {
    assert.deepEqual(licenseCostEvidence(0), { major_units: 0, minor_units: 0, state: "known" }); assert.deepEqual(licenseCostEvidence(null), { major_units: null, minor_units: null, state: "unknown" });
    for (const amount of [1.001, 0.1 + 0.2, 1e-20, 1e30]) assert.deepEqual(licenseCostEvidence(amount), { major_units: amount, minor_units: null, state: "unsupported_precision" });
    assert.equal(licenseCostEvidence(100.25).minor_units, 10025);
    const h = handoff(buildLicenseCSEHandoff(base.outcome, session, session, base.select(["finding_0", "finding_1", "finding_2"])));
    assert.equal(h.candidates[0].licenses[0].annual_spend.minor_units, 0); assert.equal(h.candidates[1].licenses[0].annual_spend.state, "unknown"); assert.equal(h.candidates[2].licenses[0].annual_spend.state, "unsupported_precision");
    assert.equal(h.candidates[0].financial_eligibility, "withheld_cse_license_source_unsupported"); assert.ok(h.candidates[1].withholding_reasons.includes("withheld_unknown_amount"));
    const missing = structuredClone(session); delete (missing.current_deal.license_positions[0] as unknown as Record<string, unknown>).annual_spend; failure(buildLicenseCSEHandoff(base.outcome, missing, missing, review), "invalid_source");
  });
  await check("repeated license/shared-app conflicts remain distinct and withheld; claim IDs survive finding reorder", async () => {
    const selected = base.select(["finding_0", "shared_license"]), h = handoff(buildLicenseCSEHandoff(base.outcome, session, session, selected));
    assert.equal(h.candidates.length, 2); assert.equal(h.selected_license_overlap[0].license_id, licenses[0].license_id); assert.ok(h.candidates.every((c) => c.financial_eligibility === "withheld_overlap")); assert.ok(h.ownership_conflicts.some((c) => c.reason === "overlapping_spend"));
    const source = structuredClone(session); source.current_deal.license_positions[1].app_id = licenses[0].app_id; const s = await setup(specimen(source), source);
    const sameApp = handoff(buildLicenseCSEHandoff(s.outcome, source, source, s.select(["finding_0", "finding_1"]))); assert.deepEqual(sameApp.selected_license_overlap, []); assert.equal(sameApp.ownership_conflicts[0].key, licenses[0].app_id); assert.ok(sameApp.candidates.every((c) => c.financial_eligibility === "withheld_overlap"));
    const different = licenses.findIndex((l) => l.app_id !== licenses[0].app_id); const separate = handoff(buildLicenseCSEHandoff(base.outcome, session, session, base.select(["finding_0", `finding_${different}`]))); assert.deepEqual(separate.ownership_conflicts, []);
    const reordered = structuredClone(base.outcome); assert.ok(reordered.status !== "error"); reordered.envelope.data.findings.reverse();
    const other = handoff(buildLicenseCSEHandoff(reordered, session, session, selected)); for (const c of h.candidates) assert.equal(other.candidates.find((x) => x.original.finding_id === c.original.finding_id)!.claim.line_id, c.claim.line_id);
  });
  const comparison = await cse();
  await check("current CSE ALA claims share exact spend roots without forging license review; original arithmetic unchanged", () => {
    const before = calculateCSE(comparison.request, comparison.context); assert.equal(before.status, "computed");
    const h = handoff(buildLicenseCSEHandoff(base.outcome, session, session, review, comparison)); assert.equal(h.comparison!.claims[0].source_line_id, "cse_line"); assert.equal(h.candidates[0].financial_eligibility, "withheld_overlap"); assert.equal(h.comparison!.source.source_digest, h.source_token.source_digest);
    assert.deepEqual(calculateCSE(comparison.request, comparison.context), before); assert.equal(before.status !== "invalid" && before.totals.illustrative_net_benefit_minor, 7000);
    const separate = structuredClone(comparison.request), action = comparison.context.reviewed!.effective_actions.find((a) => a.subject.app_id !== licenses[0].app_id && sourceCostMinor(deal.applications.find((app) => app.app_id === a.subject.app_id)!.annual_cost) !== null)!;
    separate.lines[0].action_reference = { finding_id: action.finding_id, action_id: action.action_id, subject: action.subject }; separate.lines[0].spend_app_ids = [action.subject.app_id];
    assert.deepEqual(handoff(buildLicenseCSEHandoff(base.outcome, session, session, review, { context: comparison.context, request: separate })).ownership_conflicts, []);
    const wrong = structuredClone(comparison.request); wrong.expected_source.license_revision++; failure(buildLicenseCSEHandoff(base.outcome, session, session, review, { context: comparison.context, request: wrong }), "invalid_comparison");
  });
  await check("unchanged CSE calculator rejects numeric license contributions and handoff is never a CSERequest", () => {
    const req = structuredClone(comparison.request); req.lines[0].source_kind = "license"; req.lines[0].action_reference = null;
    const r = calculateCSE(req, comparison.context); assert.equal(r.status, "not_computable"); assert.ok(r.status !== "invalid" && r.warnings.includes("unsupported_license_source")); assert.ok(r.status !== "invalid" && r.totals.annual_recurring_savings_minor === null);
    failure(buildLicenseCSEHandoff(base.outcome, session, session, review, { context: comparison.context, request: req }), "invalid_comparison"); assert.equal(calculateCSE(built, comparison.context).status, "invalid");
  });
  await check("incomplete/missing/not-evaluated original coverage stays visible and never creates selected records", async () => {
    const output = specimen(); const missing = output.findings.splice(3, 1)[0], skipped = output.findings.splice(3, 1)[0]; output.not_evaluated.push({ license_id: skipped.license_ids[0], reason: "Fabricated missing entitlement evidence." });
    const s = await setup(output), h = handoff(buildLicenseCSEHandoff(s.outcome, session, session, s.select(["finding_0"])));
    assert.equal(h.coverage.status, "incomplete"); assert.deepEqual(h.coverage.missing_license_ids, missing.license_ids); assert.equal(h.not_evaluated[0].reason, "Fabricated missing entitlement evidence."); assert.equal(h.candidates.length, 1);
    failure(buildLicenseCSEHandoff(s.outcome, session, session, { ...s.empty, selections: [{ finding_id: missing.finding_id, status: "selected", origin: "visitor_selection" }] }), "invalid_selection");
    const empty = await setup({ findings: [], not_evaluated: [] }); const none = handoff(buildLicenseCSEHandoff(empty.outcome, session, session, empty.empty)); assert.equal(none.coverage.status, "incomplete"); assert.equal(none.selection_state, "no_selected_opportunities");
  });
  await check("source edits/publication/reorder/reset, new result and changed review invalidate consumption; TSA-only stays current", async () => {
    const reorder = structuredClone(session); reorder.current_deal.license_positions.reverse();
    const publish = publishSessionApplications(session, "buyer", [...deal.applications.filter((a) => a.company_side === "buyer"), { ...deal.applications[0], app_id: "extra-test-app" }], { session_id: session.session_id, session_revision: session.session_revision });
    for (const current of [updateLicense(session, licenses[0].license_id, { product: "Changed source" }), updateApplication(session, licenses[0].app_id, { annual_cost: 999 }), publish, reorder, createDemoSession()]) {
      failure(buildLicenseCSEHandoff(base.outcome, session, current, review), "outdated"); failure(validateCurrentLicenseCSEHandoff(built, base.outcome, session, current, review), "outdated");
    }
    const tsa = updateTSA(session, deal.tsa_services[0].tsa_id, { title: "TSA-only edit" }); assert.deepEqual(handoff(buildLicenseCSEHandoff(base.outcome, session, tsa, review)), built);
    assert.ok(validateCurrentLicenseCSEHandoff(built, base.outcome, session, tsa, review).ok);
    assert.deepEqual(handoff(buildLicenseCSEHandoff(base.outcome, session, tsa, review, comparison)), handoff(buildLicenseCSEHandoff(base.outcome, session, session, review, comparison)));
    failure(validateCurrentLicenseCSEHandoff(built, base.outcome, session, session, base.empty), "invalid_handoff");
    const next = await setup(); failure(buildLicenseCSEHandoff(next.outcome, session, session, review), "invalid_selection"); failure(validateCurrentLicenseCSEHandoff(built, next.outcome, session, session, next.select(["finding_0"])), "invalid_handoff");
  });
  await check("strict structural reader rejects tampering; self-consistent client data is not authenticated current evidence", () => {
    const mutations: ((h: typeof built) => void)[] = [
      (h) => { h.review_snapshot.selections.push({ ...h.review_snapshot.selections[0] }); }, (h) => { h.review_snapshot.selections[0].status = "not_selected"; },
      (h) => { h.candidates.push(structuredClone(h.candidates[0])); }, (h) => { h.candidates[0].ownership[0].app_id = "foreign"; }, (h) => { h.candidates[0].original.license_ids.push("foreign"); },
      (h) => { h.candidates[0].licenses[0].annual_spend.minor_units = 123; }, (h) => { h.candidates[0].financial_eligibility = "withheld_overlap"; },
      (h) => { h.provenance.mode = "fallback"; }, (h) => { h.source_token.source_digest = "invalid"; }, (h) => { h.coverage.accounted_count = 0; },
      (h) => { h.candidates[0].source_evidence[0].value = 123; }, (h) => { h.candidates[0].claim.spend_app_ids = ["foreign"]; },
    ];
    for (const mutate of mutations) { const h = structuredClone(built); mutate(h); assert.equal(readLicenseCSEHandoff(h).ok, false); }
    for (const key of ["savings", "annual_run_rate", "totals", "approved", "horizon_years"]) assert.equal(readLicenseCSEHandoff({ ...built, [key]: 0 }).ok, false);
    const fake = structuredClone(built); fake.candidates[0].applications[0].company_side = fake.candidates[0].applications[0].company_side === "buyer" ? "target" : "buyer";
    assert.ok(readLicenseCSEHandoff(fake).ok, "Structural shape does not prove captured side/authenticity"); failure(validateCurrentLicenseCSEHandoff(fake, base.outcome, session, session, review), "invalid_handoff");
    for (const bad of [null, { ...review, selections: [...review.selections, ...review.selections] }, { ...review, result_identity: { ...review.result_identity, input_digest: "0".repeat(64) } }]) failure(buildLicenseCSEHandoff(base.outcome, session, session, bad), "invalid_selection");
    failure(buildLicenseCSEHandoff(null, session, session, review), "no_analysis");
  });
  await check("100 selections and combined 200 claims fit unchanged guard; excess/oversized source copies fail closed", async () => {
    const output = specimen(); output.findings = Array.from({ length: 100 }, (_, i) => ({ ...output.findings[0], finding_id: `bounded_${i}` })); const s = await setup(output), selected = s.select(output.findings.map((f) => f.finding_id));
    const many = structuredClone(comparison.request); many.lines = Array.from({ length: 100 }, (_, i) => ({ ...many.lines[0], line_id: `external_${i}`, attribution_key: `external_basis_${i}` }));
    const h = handoff(buildLicenseCSEHandoff(s.outcome, session, session, selected, { context: comparison.context, request: many })); assert.equal(h.candidates.length, 100); assert.equal(h.ownership_conflicts[0].line_ids.length, 200);
    many.lines.push({ ...many.lines[0], line_id: "external_over", attribution_key: "external_over" }); failure(buildLicenseCSEHandoff(s.outcome, session, session, selected, { context: comparison.context, request: many }), "ownership_limit_exceeded");
    const big = structuredClone(session); big.current_deal.license_positions[0].product = "P".repeat(20000); const large = await setup(output, big);
    failure(buildLicenseCSEHandoff(large.outcome, big, big, large.select(output.findings.map((f) => f.finding_id))), "handoff_too_large");
    failure(readLicenseCSEHandoff({ ...built, padding: "x".repeat(MAX_CSE_BYTES + 1) }), "handoff_too_large"); assert.equal(assessLicenseCandidates(null), null);
  });
  await check("paid/fallback provenance and client/server isolation preserve public hard stops, originals and zero network calls", async () => {
    const fallback = await setup(specimen(), session, true), h = handoff(buildLicenseCSEHandoff(fallback.outcome, session, session, fallback.select(["finding_0"]))); assert.equal(h.provenance.mode, "fallback"); assert.equal(h.provenance.routing_reason, "budget_exhausted");
    const ordinary = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/license-optimizer/cse-handoff.ts')"], { encoding: "utf8" }); assert.equal(ordinary.status, 0, ordinary.stderr);
    const blocked = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/licenses/cse-handoff.ts')"], { encoding: "utf8" }); assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /cannot be imported from a Client Component/);
    const pure = await readFile("lib/license-optimizer/cse-handoff.ts", "utf8"); assert.doesNotMatch(pure, /^import(?! type).*server\/|node:|fetch\(|sessionStorage|localStorage|recordDerived|console\./m);
    const server = await readFile("lib/server/licenses/cse-handoff.ts", "utf8"); assert.match(server, /projectLicenseResults\(/); assert.doesNotMatch(server, /createAI|fake-usage-store|fetch\(|recordDerived|process\.env/);
    const page = await readFile("app/[module]/page.tsx", "utf8"); assert.doesNotMatch(page, /cse-handoff|buildLicenseCSEHandoff/);
    const response = POST(); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(network, 0);
    assert.equal(JSON.stringify({ session, base: { outcome: base.outcome, view: base.view, review } }), original); assert.deepEqual(session.derived_results, {}); LicenseCSEHandoffSchema.parse(built);
  });
  console.log(`PASS: ${groups} U05.04 groups; ${mockCalls} fabricated guarded mock dispatches; selected-only source evidence, whole-spend withholding, unchanged CSE arithmetic, zero external/provider API calls. No public result delivery or financial aggregation.`);
} finally { globalThis.fetch = fetchBefore; }
