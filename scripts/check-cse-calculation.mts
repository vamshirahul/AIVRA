import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createDemoSession, updateApplication, updateLicense, updateTSA, publishSessionApplications } from "../lib/session/session.ts";
import { buildALARequest } from "../lib/server/ala/request.ts";
import { inspectALAResult } from "../lib/server/ala/schema.ts";
import type { ALAResult } from "../lib/server/ala/schema.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { createReviewDraft, reviewIdentity, saveReviewOverride } from "../lib/ala/review-overrides.ts";
import { prepareCSEContext, matchesCSESource, calculateFromReviewedALA } from "../lib/server/cost-synergy/reviewed-context.ts";
import { CSE_VERSION, CSEContextSchema, CSERequestSchema, CSEResultSchema, MAX_MINOR, MAX_CSE_BYTES } from "../lib/cost-synergy/calculation-contract.ts";
import type { CSEContext, CSERequest, CSEResult } from "../lib/cost-synergy/calculation-contract.ts";
import { calculateCSE, inspectCostClaims, sourceCostMinor } from "../lib/cost-synergy/calculation.ts";
import { POST } from "../app/api/ai/ala/route.ts";

// Fabricated ALA specimens/financial assumptions ONLY; no genuine inference or provider approval.
const session = createDemoSession(), apps = session.current_deal.applications;
function specimen(s = session, disposition: ALAResult["findings"][number]["actions"][number]["disposition"] = "Needs Review"): ALAResult {
  const data: ALAResult = { findings: s.current_deal.applications.map((app, i) => ({ finding_id: `finding_${i}`, domain: "Fabricated test domain", relationship: "unique",
    buyer_app_ids: app.company_side === "buyer" ? [app.app_id] : [], target_app_ids: app.company_side === "target" ? [app.app_id] : [],
    actions: [{ action_id: `action_${i}`, subject: { app_id: app.app_id, side: app.company_side }, disposition: "Needs Review", destination: null, rationale: "Fabricated original action; no financial recommendation." }],
    rationale: "Fabricated financial contract test only.", evidence: [{ app_id: app.app_id, attribute: "annual_cost" }], uncertainty: { level: "unknown", reason: "No inference occurred." } })), not_evaluated: [] };
  const first = data.findings[0]; first.actions[0].disposition = disposition;
  if (disposition === "Migrate" || disposition === "Integrate") {
    const target = s.current_deal.applications.find((a) => a.company_side === "target")!;
    first.relationship = "functional_overlap"; first.target_app_ids = [target.app_id]; first.actions[0].destination = { app_id: target.app_id, side: "target" };
    first.actions.push({ action_id: "paired_target", subject: { app_id: target.app_id, side: "target" }, disposition: "Needs Review", destination: null, rationale: "Fabricated paired member." });
  }
  return data;
}
function outcome(data = specimen(), captured = session, request_id = "73dbce5b-3594-414a-9302-804d93f397c0") {
  const built = buildALARequest(captured), checked = inspectALAResult(data, captured.current_deal.applications); assert.ok(built.ok && checked.ok);
  return { status: checked.coverage.status === "complete" ? "success" : "incomplete", source_token: built.source_token, coverage: checked.coverage,
    envelope: { module: "ala", request_id, input_digest: createHash("sha256").update(JSON.stringify({ input: built.request, references: { allow_empty: true, duplicates: "reject" } })).digest("hex"),
      model_provider: "fabricated-only", model_id: "cse-test-specimen", mode: "paid", prompt_version: "ala/v1", generated_at: "2026-11-01T20:00:00Z",
      usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data } };
}
function setup(data = specimen(), captured = session, current = captured) {
  const result = outcome(data, captured), view = projectALAResults(result, captured, current), review = createReviewDraft(view);
  const context = prepareCSEContext(result, captured, current, review); assert.ok(context); return { result, view, review, context };
}
const base = setup(), context = base.context;
function amount(value: number | null, annual = false) { return { amount_minor: value, unit: annual ? "minor_units_per_year" as const : "minor_units_once" as const, currency: "CAD" as const, basis: "visitor_assumption" as const, basis_note: "Invented explicit financial test assumption, not a forecast." }; }
function line(index = 0, c = context): CSERequest["lines"][number] {
  const action = c.reviewed!.effective_actions.find((a) => a.action_id === `action_${index}`)!;
  return { line_id: `line_${index}`, attribution_key: `claim_${index}`, source_kind: "ala", spend_app_ids: [action.subject.app_id], included: true,
    action_reference: { finding_id: action.finding_id, action_id: action.action_id, subject: structuredClone(action.subject) },
    annual_run_rate: amount(10000, true) as CSERequest["lines"][number]["annual_run_rate"], migration_one_time_cost: amount(2000) as CSERequest["lines"][number]["migration_one_time_cost"], transition_overlap_cost: amount(3000) as CSERequest["lines"][number]["transition_overlap_cost"] };
}
function request(c = context): CSERequest { return { contract_version: CSE_VERSION, expected_source: structuredClone(c.source), review_identity: structuredClone(c.reviewed?.review.result_identity ?? null), expected_review_digest: c.review_digest, horizon_years: 1, lines: c.reviewed ? [line(0, c)] : [] }; }
function valid(result: CSEResult) { assert.notEqual(result.status, "invalid", JSON.stringify(result)); if (result.status === "invalid") throw Error("Expected valid result"); CSEResultSchema.parse(result); return result; }
function invalid(input: unknown, code?: string, c = context) { const r = calculateCSE(input, c); assert.equal(r.status, "invalid"); if (r.status === "invalid" && code) assert.equal(r.code, code); assert.equal("totals" in r, false); }
let groups = 0, network = 0;
const savedFetch = globalThis.fetch; globalThis.fetch = async () => { network++; throw Error("CSE checks forbid network"); };
async function check(name: string, run: () => void | Promise<void>) { await run(); groups++; console.log(`PASS: ${name}`); }
const original = JSON.stringify({ session, base });
try {
  await check("strict versioned contract; one-year/multiyear undiscounted arithmetic and signed net in integer CAD cents", () => {
    const r = valid(calculateCSE(request(), context)); assert.equal(r.status, "computed");
    assert.deepEqual(r.totals, { annual_recurring_savings_minor: 10000, migration_one_time_cost_minor: 2000, transition_overlap_cost_minor: 3000, one_time_total_minor: 5000, horizon_recurring_savings_minor: 10000, illustrative_net_benefit_minor: 5000, horizon_years: 1 });
    const years = request(); years.horizon_years = 3; const multi = valid(calculateCSE(years, context)); assert.equal(multi.totals.illustrative_net_benefit_minor, 25000); assert.equal(multi.totals.one_time_total_minor, 5000);
    const loss = request(); loss.lines[0].annual_run_rate!.amount_minor = 0; assert.equal(valid(calculateCSE(loss, context)).totals.illustrative_net_benefit_minor, -5000);
  });
  await check("disjoint app ownership adds explicitly supplied annual inputs and counts one-time costs once", () => {
    const input = request(); input.lines.push(line(1)); const r = valid(calculateCSE(input, context)); assert.equal(r.status, "computed"); assert.equal(r.totals.annual_recurring_savings_minor, 20000); assert.equal(r.totals.one_time_total_minor, 10000); assert.equal(r.totals.illustrative_net_benefit_minor, 10000);
    assert.deepEqual(r.lines[0].source_costs, [{ app_id: apps[0].app_id, annual_cost_major: apps[0].annual_cost, annual_cost_minor: sourceCostMinor(apps[0].annual_cost) }]);
  });
  await check("explicit zero differs from absent/null/undefined values; missing horizon preserves yearly components only", () => {
    const zero = request(); for (const key of ["annual_run_rate", "migration_one_time_cost", "transition_overlap_cost"] as const) zero.lines[0][key]!.amount_minor = 0;
    const r = valid(calculateCSE(zero, context)); assert.equal(r.status, "computed"); assert.equal(r.totals.illustrative_net_benefit_minor, 0);
    for (const value of [null, undefined]) { const input = request(); input.lines[0].annual_run_rate = value; const result = valid(calculateCSE(input, context)); assert.equal(result.status, "incomplete"); assert.equal(result.totals.annual_recurring_savings_minor, null); assert.equal(result.totals.migration_one_time_cost_minor, 2000); assert.equal(result.totals.illustrative_net_benefit_minor, null); }
    const absent = request(); delete absent.lines[0].annual_run_rate; delete absent.lines[0].migration_one_time_cost; delete absent.lines[0].transition_overlap_cost; assert.equal(valid(calculateCSE(absent, context)).status, "not_computable");
    for (const horizon of [null, undefined]) { const input = request(); input.horizon_years = horizon; const result = valid(calculateCSE(input, context)); assert.equal(result.status, "incomplete"); assert.equal(result.totals.annual_recurring_savings_minor, 10000); assert.equal(result.totals.illustrative_net_benefit_minor, null); assert.ok(result.warnings.includes("missing_horizon")); }
  });
  await check("no assumptions or inclusion never becomes a zero-savings KPI; no default completion of unknown amounts", () => {
    const empty = request(); empty.lines = []; const result = valid(calculateCSE(empty, context)); assert.equal(result.status, "not_computable"); assert.equal(result.totals.annual_recurring_savings_minor, null);
    const excluded = request(); excluded.lines[0].included = false; const r = valid(calculateCSE(excluded, context)); assert.equal(r.status, "not_computable"); assert.equal(r.lines[0].state, "excluded"); assert.equal(r.lines[0].annual.amount_minor, null);
    const unknown = request(); unknown.lines[0].annual_run_rate!.amount_minor = null; const u = valid(calculateCSE(unknown, context)); assert.equal(u.totals.annual_recurring_savings_minor, null); assert.ok(u.lines[0].reasons.includes("missing_amount"));
  });
  await check("all five effective ALA labels leave formulas unchanged; originals and visitor overrides remain distinct", () => {
    for (const disposition of ["Retain", "Retire", "Migrate", "Integrate", "Needs Review"] as const) { const sample = setup(specimen(session, disposition)); const r = valid(calculateCSE(request(sample.context), sample.context)); assert.equal(r.totals.illustrative_net_benefit_minor, 5000); }
    assert.ok(base.review && "data" in base.view); const override = saveReviewOverride(base.view, base.review, { result_identity: reviewIdentity(base.view), finding_id: "finding_0", action_id: "action_0", subject: { app_id: apps[0].app_id, side: apps[0].company_side }, proposed_disposition: "Retire", proposed_destination: null, visitor_reason: "Fabricated visitor choice, not approval." }); assert.ok(override.ok);
    const changed = prepareCSEContext(base.result, session, session, override.draft)!; assert.equal(changed.reviewed!.effective_actions[0].origin, "visitor_override"); assert.equal(changed.reviewed!.effective_actions[0].original.disposition, "Needs Review"); assert.equal(changed.reviewed!.effective_actions[0].effective.disposition, "Retire");
    invalid(request(), "source_mismatch", changed); const r = valid(calculateCSE(request(changed), changed)); assert.equal(r.totals.illustrative_net_benefit_minor, 5000); assert.deepEqual(r.context.reviewed!.analysis, context.reviewed!.analysis);
  });
  await check("duplicate attribution/actions/shared spend withhold totals without choosing winners or silently capping", () => {
    const repeated = request(); repeated.lines.push({ ...line(), line_id: "other", attribution_key: "other_claim" }); const r = valid(calculateCSE(repeated, context)); assert.equal(r.status, "not_computable"); assert.ok(r.conflicts.some((c) => c.reason === "overlapping_spend")); assert.ok(r.lines.every((l) => l.state === "conflicting")); assert.equal(r.totals.annual_recurring_savings_minor, null);
    const duplicate = request(); duplicate.lines.push({ ...line(1), attribution_key: "claim_0" }); const d = valid(calculateCSE(duplicate, context)); assert.equal(d.status, "not_computable"); assert.equal(d.conflicts[0].reason, "duplicate_attribution");
    repeated.lines[1].included = false; assert.equal(valid(calculateCSE(repeated, context)).status, "computed");
    const largeExplicit = request(); largeExplicit.lines[0].annual_run_rate!.amount_minor = 90000000; assert.equal(valid(calculateCSE(largeExplicit, context)).totals.annual_recurring_savings_minor, 90000000, "Explicit assumptions are not inferred/capped to application source cost");
  });
  await check("future app/license whole-spend ownership guard is non-additive; all license contributions remain disabled", () => {
    assert.deepEqual(inspectCostClaims([{ line_id: "app", attribution_key: "app_basis", source_kind: "ala", spend_app_ids: [apps[0].app_id] }, { line_id: "license", attribution_key: "license_basis", source_kind: "license", spend_app_ids: [apps[0].app_id] }]), [{ reason: "overlapping_spend", key: apps[0].app_id, line_ids: ["app", "license"] }]);
    assert.equal(inspectCostClaims(Array.from({ length: 101 }, (_, i) => ({ line_id: `bound_${i}`, attribution_key: `basis_${i}`, source_kind: "ala", spend_app_ids: [`app-bound-${i}`] }))), null);
    const license = request(); license.lines[0].source_kind = "license"; license.lines[0].action_reference = null; const r = valid(calculateCSE(license, context)); assert.equal(r.status, "not_computable"); assert.ok(r.warnings.includes("unsupported_license_source")); assert.equal(r.totals.annual_recurring_savings_minor, null);
    const mixed = request(); mixed.lines.push({ ...line(1), source_kind: "license", action_reference: null }); assert.equal(valid(calculateCSE(mixed, context)).totals.annual_recurring_savings_minor, null);
  });
  await check("missing/zero/unsupported source app costs remain exact; no source annual cost or license spend becomes savings", () => {
    for (const value of [null, 0, 1.001, 0.1 + 0.2, 1e-20]) {
      const edited = structuredClone(session); edited.current_deal.applications[0].annual_cost = value;
      const c = setup(specimen(edited), edited).context, input = request(c), r = valid(calculateCSE(input, c));
      assert.equal(r.lines[0].source_costs[0].annual_cost_major, value);
      assert.equal(r.totals.annual_recurring_savings_minor, value === 0 ? 10000 : null); assert.equal(r.totals.migration_one_time_cost_minor, 2000);
    }
    for (const [source, cents] of [[0.29, 29], [1.1, 110], [0, 0], [1.005, null], [Infinity, null], [-1, null]] as const) assert.equal(sourceCostMinor(source), cents);
    assert.ok(session.current_deal.license_positions.length); const input = request(); input.lines[0].annual_run_rate!.amount_minor = 7; assert.equal(valid(calculateCSE(input, context)).totals.annual_recurring_savings_minor, 7);
    const unsupported = request(); unsupported.lines[0].annual_run_rate!.basis = "unsupported"; const r = valid(calculateCSE(unsupported, context)); assert.equal(r.totals.annual_recurring_savings_minor, null); assert.ok(r.warnings.includes("unsupported_basis"));
  });
  await check("current/incomplete/absent/invalid/outdated context and missing coverage are explicit", () => {
    const partial = specimen(); partial.findings.pop(); const r = setup(partial); assert.equal(r.context.analysis_state, "incomplete"); const c = valid(calculateCSE(request(r.context), r.context)); assert.equal(c.status, "incomplete"); assert.equal(c.totals.illustrative_net_benefit_minor, 5000); assert.ok(c.context.reviewed!.analysis.coverage.target.missing_app_ids.length);
    const skipped = specimen(); const removed = skipped.findings.pop()!; skipped.not_evaluated.push({ app_id: removed.actions[0].subject.app_id, side: removed.actions[0].subject.side, reason: "Fabricated not-evaluated source." }); const n = setup(skipped); assert.equal(valid(calculateCSE(request(n.context), n.context)).status, "incomplete");
    for (const raw of [null, {}, { ...base.result, envelope: { ...base.result.envelope, input_digest: "0".repeat(64) } }]) { const c = prepareCSEContext(raw, session, session, null)!; assert.ok(c); const r = valid(calculateCSE(request(c), c)); assert.equal(r.status, "not_computable"); assert.equal(r.totals.illustrative_net_benefit_minor, null); }
    const invalidReview = prepareCSEContext(base.result, session, session, { ...base.review, unexpected: true })!; assert.equal(invalidReview.analysis_state, "invalid");
  });
  await check("source/reset/reorder/app-cost/license edits invalidate old calculation; TSA-only retains currentness", () => {
    const appEdit = updateApplication(session, apps[0].app_id, { annual_cost: 123 }), licenseEdit = updateLicense(session, session.current_deal.license_positions[0].license_id, { product: "Edited cost dependency" });
    const reordered = structuredClone(session); reordered.current_deal.applications.reverse();
    const silentCost = structuredClone(session); silentCost.current_deal.applications[0].annual_cost = 321;
    const published = publishSessionApplications(session, "buyer", [...apps.filter((a) => a.company_side === "buyer"), { ...apps[0], app_id: "extra-published-app" }], { session_id: session.session_id, session_revision: session.session_revision });
    for (const current of [appEdit, licenseEdit, reordered, silentCost, published, createDemoSession()]) {
      assert.equal(matchesCSESource(context.source, current), false); const c = prepareCSEContext(base.result, session, current, base.review)!; assert.ok(c); invalid(request(), "source_mismatch", c);
      assert.equal(calculateFromReviewedALA(base.result, session, current, base.review, request()).status, "invalid");
    }
    const tsa = updateTSA(session, session.current_deal.tsa_services[0].tsa_id, { title: "Irrelevant TSA source change" }); assert.ok(matchesCSESource(context.source, tsa)); assert.equal(calculateFromReviewedALA(base.result, session, tsa, base.review, request()).status, "computed");
    const next = outcome(specimen(), session, "f55c4a56-536b-408a-9728-a12ed3dd10d2"), view = projectALAResults(next, session, session), c = prepareCSEContext(next, session, session, createReviewDraft(view))!; invalid(request(), "source_mismatch", c);
  });
  await check("foreign/duplicate/malformed identities and missing source action bindings fail closed", () => {
    const bad = (change: (r: CSERequest) => void) => { const r = request(); change(r); invalid(r); };
    bad((r) => { r.lines[0].action_reference!.finding_id = "foreign"; }); bad((r) => { r.lines[0].action_reference!.action_id = "foreign"; }); bad((r) => { r.lines[0].action_reference!.subject.side = "target"; });
    bad((r) => { r.lines[0].spend_app_ids = ["foreign"]; }); bad((r) => { r.lines[0].spend_app_ids = [apps[1].app_id]; }); bad((r) => { r.lines[0].spend_app_ids.push(apps[0].app_id); });
    bad((r) => { r.lines.push({ ...line() }); }); bad((r) => { r.expected_source.source_digest = "0".repeat(64); }); bad((r) => { r.expected_source.license_revision++; }); bad((r) => { r.review_identity!.input_digest = "0".repeat(64); });
    invalid({ ...request(), approved: true }); invalid({ ...request(), contract_version: "cse/calculation/v2" }); invalid({ ...request(), expected_source: { ...context.source, currency: "USD" } });
    invalid({ ...request(), lines: Array.from({ length: 201 }, (_, i) => ({ ...line(), line_id: `long_${i}` })) });
    const tampered = structuredClone(context); tampered.applications[0].annual_cost = 999; assert.equal(calculateCSE(request(), tampered).status, "invalid");
  });
  await check("strict integer units/currency/basis notes and bounded BigInt arithmetic reject precision/overflow", () => {
    for (const number of [-1, 0.1, NaN, Infinity, MAX_MINOR + 1, "100" as unknown as number]) { const r = request(); r.lines[0].annual_run_rate!.amount_minor = number; invalid(r); }
    for (const year of [0, -1, 1.5, 31, Infinity, "1" as unknown as number]) { const r = request(); r.horizon_years = year; invalid(r); }
    const note = request(); note.lines[0].annual_run_rate!.basis_note = "x".repeat(401); invalid(note);
    invalid({ ...request(), lines: [{ ...line(), annual_run_rate: { ...line().annual_run_rate!, unit: "minor_units_once" } }] });
    invalid({ ...request(), lines: [{ ...line(), annual_run_rate: { ...line().annual_run_rate!, currency: "USD" } }] });
    const sum = request(); sum.lines[0].annual_run_rate!.amount_minor = MAX_MINOR; sum.lines.push(line(1)); invalid(sum, "numeric_overflow");
    const total = request(); total.lines[0].migration_one_time_cost!.amount_minor = MAX_MINOR; invalid(total, "numeric_overflow");
    const horizon = request(); horizon.horizon_years = 2; horizon.lines[0].annual_run_rate!.amount_minor = MAX_MINOR; invalid(horizon, "numeric_overflow");
  });
  await check("deterministic immutable results, client-safe arithmetic imports, server trust guard, no public path/network/state writes", async () => {
    const input = request(), before = JSON.stringify(input), result = calculateCSE(input, context); assert.deepEqual(result, calculateCSE(input, context)); assert.equal(JSON.stringify(input), before); assert.equal(JSON.stringify({ session, base }), original); assert.deepEqual(session.derived_results, {});
    assert.ok(result.status !== "invalid" && Object.isFrozen(result.context.reviewed!.analysis.findings)); assert.equal(network, 0);
    const ordinary = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/cost-synergy/calculation.ts')"], { encoding: "utf8" }); assert.equal(ordinary.status, 0, ordinary.stderr);
    const blocked = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/cost-synergy/reviewed-context.ts')"], { encoding: "utf8" }); assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /cannot be imported from a Client Component/);
    for (const name of ["calculation-contract", "calculation"]) { const code = await readFile(`lib/cost-synergy/${name}.ts`, "utf8"); assert.doesNotMatch(code, /server-only|node:|fetch\(|console\.|sessionStorage|localStorage|recordDerived|process\.env|Math\.round/); }
    const server = await readFile("lib/server/cost-synergy/reviewed-context.ts", "utf8"); assert.match(server, /projectALAResults\(/); assert.match(server, /buildReviewedExport\(/); assert.doesNotMatch(server, /createAI|fake-usage-store|fetch\(|recordDerived|process\.env/);
    const page = await readFile("app/[module]/page.tsx", "utf8"); assert.doesNotMatch(page, /calculateCSE|prepareCSEContext|cost-synergy\/calculation/);
    const response = POST(); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(CSERequestSchema.safeParse(request()).success, true); assert.equal(CSEContextSchema.safeParse(context).success, true);
    const oversized = { ...request(), padding: "x".repeat(MAX_CSE_BYTES + 1) }; invalid(oversized);
  });
  console.log(`PASS: ${groups} U03.01 groups; exact explicit CAD-cent arithmetic, immutable existing reviewed contracts, zero network/provider calls; no public estimate, license handoff, persistence or deployment.`);
} finally { globalThis.fetch = savedFetch; }
