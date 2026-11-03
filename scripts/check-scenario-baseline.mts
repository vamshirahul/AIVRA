import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createDemoSession, updateApplication, updateLicense, updateTSA, publishSessionApplications } from "../lib/session/session.ts";
import { buildALARequest } from "../lib/server/ala/request.ts";
import { inspectALAResult } from "../lib/server/ala/schema.ts";
import type { ALAResult } from "../lib/server/ala/schema.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { createReviewDraft, reviewIdentity, saveReviewOverride } from "../lib/ala/review-overrides.ts";
import { prepareCSEContext } from "../lib/server/cost-synergy/reviewed-context.ts";
import { createEstimateDraft, verifyEditorDigest } from "../lib/cost-synergy/estimate-form.ts";
import { cloneBaseline, validateCurrentScenario, editAlternativeAction, restoreAlternativeAction, editAlternativeFinancialInput, restoreAlternativeFinancialInput, editAlternativeHorizon, resetAlternative, scenarioChanges, ScenarioDraftSchema, scenarioSourceKey } from "../lib/scenario-modeling/scenario-draft.ts";
import type { ScenarioSource, ScenarioDraft, ScenarioOperation, ScenarioActionEdit } from "../lib/scenario-modeling/scenario-draft.ts";
import { POST } from "../app/api/ai/ala/route.ts";

// Fabricated offline outcomes through real source/reference/review composers only.
const session = createDemoSession(), apps = session.current_deal.applications;
const buyers = apps.filter((a) => a.company_side === "buyer"), targets = apps.filter((a) => a.company_side === "target");
const specimen: ALAResult = { findings: buyers.map((a, i) => ({ finding_id: `f_${i}`, domain: "Fabricated offline domain", relationship: "functional_overlap", buyer_app_ids: [a.app_id], target_app_ids: [targets[i].app_id],
  actions: [{ action_id: `b_${i}`, subject: { app_id: a.app_id, side: "buyer" }, disposition: "Needs Review", destination: null, rationale: "Fabricated original AI recommendation; no model was invoked." }, { action_id: `t_${i}`, subject: { app_id: targets[i].app_id, side: "target" }, disposition: "Needs Review", destination: null, rationale: "Fabricated original target action." }], rationale: "Fabricated finding only.", evidence: [{ app_id: a.app_id, attribute: "annual_cost" }], uncertainty: { level: "unknown", reason: "No genuine inference." } })), not_evaluated: [] };
function setup(s = session, data = specimen, request_id = "29fda878-d20c-4a76-b486-1133fe0d1de7", override = true) {
  const built = buildALARequest(s), checked = inspectALAResult(data, s.current_deal.applications); assert.ok(built.ok && checked.ok);
  const outcome = { status: checked.coverage.status === "complete" ? "success" : "incomplete", source_token: built.source_token, coverage: checked.coverage, envelope: { module: "ala", request_id, input_digest: createHash("sha256").update(JSON.stringify({ input: built.request, references: { allow_empty: true, duplicates: "reject" } })).digest("hex"), model_provider: "fabricated-only", model_id: "offline-scenario", mode: "paid", prompt_version: "ala/v1", generated_at: "2026-11-03T00:00:00Z", usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data } };
  const view = projectALAResults(outcome, s, s); let review = createReviewDraft(view);
  if (override) { const r = saveReviewOverride(view, review, { result_identity: reviewIdentity(view), finding_id: "f_0", action_id: "b_0", subject: specimen.findings[0].actions[0].subject, proposed_disposition: "Retire", proposed_destination: null, visitor_reason: "Existing baseline visitor override, not a scenario hypothesis." }); assert.ok(r.ok); review = r.draft; }
  const context = prepareCSEContext(outcome, s, s, review); assert.ok(context);
  const financial_draft = createEstimateDraft(context); financial_draft.horizon = "3"; if (financial_draft.actions[0]) { financial_draft.actions[0].included = true; financial_draft.actions[0].annual_run_rate = { amount: "100.00", note: "Fabricated explicit annual basis" }; financial_draft.actions[0].migration_one_time_cost = { amount: "20", note: "Fabricated migration basis" }; financial_draft.actions[0].transition_overlap_cost = { amount: "30", note: "Fabricated transition basis" }; }
  return { outcome, review, source: { context, view, financial_draft } satisfies ScenarioSource };
}
const base = setup(), source = base.source;
function success(r: ScenarioOperation): ScenarioDraft { assert.ok(r.ok, JSON.stringify(r)); return r.scenario; }
const scenario = success(cloneBaseline(source));
function edit(disposition: ScenarioActionEdit["disposition"] = "Migrate", destination: ScenarioActionEdit["destination"] = { app_id: targets[0].app_id, side: "target" }, reason = "Hypothetical scenario change"): ScenarioActionEdit { return { finding_id: "f_0", action_id: "b_0", subject: { app_id: buyers[0].app_id, side: "buyer" }, disposition, destination, scenario_reason: reason }; }
function rejected(r: ScenarioOperation) { assert.equal(r.ok, false); }
const original = JSON.stringify({ base, session }), baselineBytes = JSON.stringify(scenario.baseline);
let groups = 0, network = 0; const beforeFetch = globalThis.fetch; globalThis.fetch = async () => { network++; throw Error("Scenario tests forbid network"); };
async function check(name: string, fn: () => unknown | Promise<unknown>) { await fn(); groups++; console.log(`PASS: ${name}`); }
try {
  await check("explicit detached immutable baseline and one equivalent alternative, preserving original/visitor/CSE inputs", () => {
    assert.equal(scenario.contract_version, "scenario/draft/v1"); assert.equal(scenario.status, "provisional_unapproved"); assert.deepEqual(scenario.alternative.financial_draft, scenario.baseline.financial_draft); assert.deepEqual(scenario.alternative.financial_request, scenario.baseline.financial_request); assert.deepEqual(scenario.alternative.action_edits, []);
    assert.notEqual(scenario.baseline.financial_draft.actions[0], scenario.alternative.financial_draft.actions[0]); assert.notEqual(scenario.baseline.financial_draft.actions[0], source.financial_draft.actions[0]); assert.notEqual(scenario.baseline.actions[0], source.context.reviewed!.effective_actions[0]);
    assert.throws(() => { scenario.baseline.financial_draft.actions[0].annual_run_rate.amount = "999"; }, TypeError); assert.throws(() => { scenario.alternative.financial_draft.actions[0].included = false; }, TypeError);
    assert.equal(scenario.baseline.actions[0].original.disposition, "Needs Review"); assert.equal(scenario.baseline.actions[0].effective.disposition, "Retire"); assert.equal(scenario.baseline.actions[0].visitor_reason, base.review!.overrides[0].visitor_reason);
    assert.deepEqual(success(cloneBaseline(source, scenario)), scenario); assert.equal(Array.isArray(scenario.alternative), false); assert.equal(ScenarioDraftSchema.safeParse({ ...scenario, alternatives: [] }).success, false);
  });
  await check("all five dispositions/destinations and bounded hypothesis reasons reuse existing ALA validation", () => {
    for (const disposition of ["Retain", "Retire", "Migrate", "Integrate", "Needs Review"] as const) {
      const destination = disposition === "Migrate" || disposition === "Integrate" ? { app_id: targets[0].app_id, side: "target" as const } : null;
      const changed = success(editAlternativeAction(source, scenario, edit(disposition, destination))); assert.ok(validateCurrentScenario(source, changed)); assert.equal(JSON.stringify(changed.baseline), baselineBytes);
      const restored = success(restoreAlternativeAction(source, changed, { finding_id: "f_0", action_id: "b_0", subject: edit().subject })); assert.deepEqual(restored, scenario);
    }
    for (const e of [edit("Migrate", null), edit("Integrate", null), edit("Retain", edit().destination), edit("Migrate", { app_id: buyers[0].app_id, side: "buyer" }), edit("Migrate", { app_id: targets[0].app_id, side: "buyer" }), edit("Migrate", { app_id: targets[1].app_id, side: "target" }), edit("Migrate", edit().destination, " "), edit("Migrate", edit().destination, "x".repeat(401)), { ...edit(), finding_id: "foreign" }, { ...edit(), action_id: "foreign" }, { ...edit(), subject: { ...edit().subject, side: "target" } }, { ...edit(), extra: true }]) rejected(editAlternativeAction(source, scenario, e));
    assert.equal(success(editAlternativeAction(source, scenario, edit("Migrate", edit().destination, "x".repeat(400)))).alternative.action_edits[0].scenario_reason.length, 400);
  });
  await check("same-subject conflicts and conflicting restore are rejected atomically without automatic peer changes", () => {
    const data = structuredClone(specimen), first = data.findings[0]; first.target_app_ids.push(targets[1].app_id); first.actions[0].disposition = "Retain"; first.actions.push({ ...first.actions[0], action_id: "extra", disposition: "Integrate", destination: { app_id: targets[1].app_id, side: "target" } }, { ...data.findings[1].actions[1], action_id: "extra_target" });
    const special = setup(session, data, undefined, false).source, s = success(cloneBaseline(special)); rejected(editAlternativeAction(special, s, edit("Retire", null)));
    const migrated = success(editAlternativeAction(special, s, edit("Integrate", { app_id: targets[0].app_id, side: "target" })));
    const peer = success(editAlternativeAction(special, migrated, { ...edit("Retain", null), action_id: "extra" }));
    rejected(restoreAlternativeAction(special, peer, { finding_id: "f_0", action_id: "b_0", subject: edit().subject })); assert.equal(peer.alternative.action_edits.length, 2); assert.ok(validateCurrentScenario(special, peer));
  });
  await check("financial edits, notes/inclusion/horizon preserve baseline and raw null/zero exact cents without calculations", () => {
    const row = structuredClone(scenario.alternative.financial_draft.actions[0]); row.annual_run_rate = { amount: "0.00", note: "Explicit zero" }; row.included = false;
    const changed = success(editAlternativeFinancialInput(source, scenario, row)); assert.equal(changed.alternative.financial_request.lines[0].annual_run_rate!.amount_minor, 0); assert.equal(changed.alternative.financial_request.lines[0].included, false); assert.equal(JSON.stringify(changed.baseline), baselineBytes);
    assert.deepEqual(success(restoreAlternativeFinancialInput(source, changed, "b_0")), scenario);
    for (const value of ["", "1", "30"]) { const s = success(editAlternativeHorizon(source, scenario, value)); assert.equal(s.alternative.financial_request.horizon_years, value === "" ? null : Number(value)); }
    for (const value of ["0", "31", "1.5", "1e1", "-1"]) rejected(editAlternativeHorizon(source, scenario, value));
    for (const value of ["-1", "1e3", "1,000", "1.234", "10000000000.01"]) { row.annual_run_rate.amount = value; rejected(editAlternativeFinancialInput(source, scenario, row)); }
    row.annual_run_rate = { amount: "10000000000.00", note: "Exact maximum" }; const max = success(editAlternativeFinancialInput(source, scenario, row)); assert.equal(max.alternative.financial_request.lines[0].annual_run_rate!.amount_minor, 1000000000000);
    row.annual_run_rate = { amount: "0", note: " " }; rejected(editAlternativeFinancialInput(source, scenario, row)); row.annual_run_rate = { amount: "", note: "Unknown remains unknown" }; assert.equal(success(editAlternativeFinancialInput(source, scenario, row)).alternative.financial_request.lines[0].annual_run_rate, null);
    rejected(editAlternativeFinancialInput(source, scenario, { ...row, line_id: "foreign" })); rejected(editAlternativeFinancialInput(source, scenario, { ...row, annual_run_rate: { amount: "1", note: "x".repeat(401) } }));
  });
  await check("alternative isolation, changed-field derivation, reset and restore retain original source byte-for-byte", () => {
    let s = success(editAlternativeAction(source, scenario, edit())); const row = structuredClone(s.alternative.financial_draft.actions[1]); row.migration_one_time_cost = { amount: "1.23", note: "Explicit invented basis" }; s = success(editAlternativeFinancialInput(source, s, row)); s = success(editAlternativeHorizon(source, s, "5"));
    assert.deepEqual(scenarioChanges(s), { action_ids: ["b_0"], financial_line_ids: ["t_0"], horizon_changed: true }); assert.equal(s.alternative.financial_request.lines[1].migration_one_time_cost!.amount_minor, 123); assert.equal(s.alternative.financial_request.lines[1].included, false);
    assert.deepEqual(success(resetAlternative(source, s)), scenario); assert.equal(JSON.stringify(s.baseline), baselineBytes); assert.equal(JSON.stringify({ base, session }), original);
  });
  await check("strict shape and semantic consumer reject tampered baseline, source/review, ownership, duplicate/foreign hypothesis", () => {
    for (const change of [(s: ScenarioDraft) => { s.baseline.financial_request.lines[0].included = false; }, (s: ScenarioDraft) => { s.baseline.actions[0].original.rationale = "Forged"; }, (s: ScenarioDraft) => { s.source_binding.review_digest = "0".repeat(64); }, (s: ScenarioDraft) => { s.source_binding.source.license_revision++; }, (s: ScenarioDraft) => { s.alternative.financial_request.lines[0].spend_app_ids = [targets[0].app_id]; }, (s: ScenarioDraft) => { s.alternative.financial_request.lines[0].source_kind = "license"; }, (s: ScenarioDraft) => { s.alternative.financial_request.lines[0].attribution_key = "foreign"; }, (s: ScenarioDraft) => { s.alternative.financial_draft.actions.push(s.alternative.financial_draft.actions[0]); }]) { const s = structuredClone(scenario); change(s); assert.equal(validateCurrentScenario(source, s), null); }
    const changed = success(editAlternativeAction(source, scenario, edit())), duplicate = structuredClone(changed); duplicate.alternative.action_edits.push(duplicate.alternative.action_edits[0]); assert.equal(validateCurrentScenario(source, duplicate), null);
    assert.equal(validateCurrentScenario(source, { ...scenario, contract_version: "scenario/draft/v2" }), null); assert.equal(validateCurrentScenario(source, { ...scenario, extra: "x".repeat(1500001) }), null);
  });
  await check("source/application/license/publication/order/reset/review/financial changes invalidate; TSA-only stays current", async () => {
    const reordered = structuredClone(session); reordered.current_deal.license_positions.reverse(); const reorderedApps = structuredClone(session); reorderedApps.current_deal.applications.reverse();
    const published = publishSessionApplications(session, "buyer", [...buyers, { ...buyers[0], app_id: "offline-scenario-added" }], { session_id: session.session_id, session_revision: session.session_revision });
    for (const s of [updateApplication(session, buyers[0].app_id, { notes: "Changed" }), updateLicense(session, session.current_deal.license_positions[0].license_id, { notes: "Changed" }), reordered, reorderedApps, published, createDemoSession()]) { assert.equal(await verifyEditorDigest(source.context, s), false); const c = prepareCSEContext(base.outcome, session, s, base.review)!; assert.equal(validateCurrentScenario({ ...source, context: c }, scenario), null); }
    const tsa = updateTSA(session, session.current_deal.tsa_services[0].tsa_id, { title: "TSA only" }), c = prepareCSEContext(base.outcome, session, tsa, base.review)!; assert.ok(await verifyEditorDigest(c, tsa)); assert.ok(validateCurrentScenario({ ...source, context: c }, scenario));
    const digest = globalThis.crypto.subtle.digest; try { globalThis.crypto.subtle.digest = async () => { throw Error("Offline digest failure"); }; assert.equal(await verifyEditorDigest(source.context, session), false); } finally { globalThis.crypto.subtle.digest = digest; }
    const changedDraft = structuredClone(source.financial_draft); changedDraft.actions[0].annual_run_rate.note = "Changed baseline basis"; assert.notEqual(scenarioSourceKey({ ...source, financial_draft: changedDraft }), scenarioSourceKey(source)); assert.equal(validateCurrentScenario({ ...source, financial_draft: changedDraft }, scenario), null);
    const different = setup(session, specimen, "5fa6444d-1964-4882-9f2e-dfb8bb698f03").source; assert.equal(validateCurrentScenario(different, scenario), null);
    const review = saveReviewOverride(source.view, base.review, { result_identity: reviewIdentity(source.view), finding_id: "f_0", action_id: "b_0", subject: edit().subject, proposed_disposition: "Retain", proposed_destination: null, visitor_reason: "New review" }); assert.ok(review.ok); assert.equal(validateCurrentScenario({ ...source, context: prepareCSEContext(base.outcome, session, session, review.draft)! }, scenario), null);
  });
  await check("incomplete/unknown source and current uncalculated assumptions remain truthful; invalid/absent views cannot clone", () => {
    const partial = structuredClone(specimen); partial.findings.pop(); const s = setup(session, partial).source; s.financial_draft = createEstimateDraft(s.context); const cloned = success(cloneBaseline(s)); assert.equal(s.context.analysis_state, "incomplete"); assert.equal(cloned.baseline.financial_request.horizon_years, null); assert.ok(cloned.baseline.financial_request.lines.every((l) => l.annual_run_rate === null && !l.included));
    rejected(cloneBaseline({ ...source, view: { state: "absent" } })); const raw = structuredClone(source.financial_draft); raw.actions[0].annual_run_rate.note = ""; rejected(cloneBaseline({ ...source, financial_draft: raw }));
    const viewMismatch = setup(session, specimen, "13b7cf26-3b64-4c06-a951-07e80c81d5f6").source.view; rejected(cloneBaseline({ ...source, view: viewMismatch }));
  });
  await check("actual SSR readiness/clone semantics and public wiring preserve security, no calculations/exports/persistent writes", async () => {
    const child = spawnSync(process.execPath, ["scripts/check-scenario-browser.mjs", "--render"], { input: JSON.stringify({ source }), encoding: "utf8", timeout: 15000 }); assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /Clone baseline/); assert.doesNotMatch(child.stdout, /Alternative scenario — hypothetical/);
    const ui = await readFile("components/scenario-modeling/scenario-workspace.ts", "utf8"), lib = await readFile("lib/scenario-modeling/scenario-draft.ts", "utf8"), page = await readFile("app/[module]/page.tsx", "utf8");
    assert.match(page, /<ScenarioWorkspace \/>/); assert.match(lib, /saveReviewOverride\(/); assert.match(lib, /validateReviewDraft\(/); assert.match(lib, /buildEstimateRequest\(/);
    for (const code of [ui, lib]) assert.doesNotMatch(code, /calculateCSE\(|downloadCSE|fetch\(|sessionStorage|localStorage|recordDerived|server-only|node:|Math\.round|dangerouslySetInnerHTML/);
    assert.equal(POST().status, 503); assert.equal(POST().headers.get("cache-control"), "no-store"); assert.equal(JSON.stringify({ base, session }), original); assert.equal(network, 0);
  });
  if (process.env.AIVRA_SCENARIO_BROWSER_FIXTURE === "1") { await mkdir(".temp/u11-01", { recursive: true }); await writeFile(".temp/u11-01/fixture.json", JSON.stringify({ source, session })); }
  console.log(`PASS: ${groups} U11.01 groups; immutable baseline and one validated alternative, zero network/provider calls; no scenario metrics or exports.`);
} finally { globalThis.fetch = beforeFetch; }
