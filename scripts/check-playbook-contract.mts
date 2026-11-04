import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createDemoSession, updateApplication, updateLicense, updateTSA } from "../lib/session/session.ts";
import { buildALARequest } from "../lib/server/ala/request.ts";
import { inspectALAResult } from "../lib/server/ala/schema.ts";
import type { ALAResult } from "../lib/server/ala/schema.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { createReviewDraft, saveReviewOverride } from "../lib/ala/review-overrides.ts";
import { prepareCSEContext } from "../lib/server/cost-synergy/reviewed-context.ts";
import { createEstimateDraft } from "../lib/cost-synergy/estimate-form.ts";
import { cloneBaseline, editAlternativeAction, editAlternativeFinancialInput, editAlternativeHorizon } from "../lib/scenario-modeling/scenario-draft.ts";
import { compareScenarios } from "../lib/scenario-modeling/scenario-comparison.ts";
import { preparePlaybookContract } from "../lib/server/playbook/contract.ts";
import { buildPlaybookInput, matchesPlaybookInput, PlaybookInputSchema } from "../lib/server/playbook/input.ts";
import type { PlaybookInputs, PlaybookInput } from "../lib/server/playbook/input.ts";
import { PLAYBOOK_SYSTEM_PROMPT } from "../lib/server/playbook/prompt.ts";
import { PlaybookResultSchema, PlaybookEnvelopeSchema, inspectPlaybookResult, extractPlaybookReferences, PLAYBOOK_OUTPUT_CONTRACT } from "../lib/server/playbook/schema.ts";
import type { PlaybookResult } from "../lib/server/playbook/schema.ts";
import { MAX_INPUT_BYTES } from "../lib/server/ai/contracts.ts";

// Entirely fabricated offline model content/provenance; never imported by public UI.
const session = createDemoSession(), apps = session.current_deal.applications;
const data: ALAResult = { findings: apps.map((a, i) => ({ finding_id: `f_${i}`, domain: "Offline contract specimen", relationship: "unique", buyer_app_ids: a.company_side === "buyer" ? [a.app_id] : [], target_app_ids: a.company_side === "target" ? [a.app_id] : [], actions: [{ action_id: `a_${i}`, subject: { app_id: a.app_id, side: a.company_side }, disposition: "Needs Review", destination: null, rationale: "Fabricated original only, never actual analysis." }], rationale: "Offline contract test.", evidence: [{ app_id: a.app_id, attribute: "annual_cost" }], uncertainty: { level: "unknown", reason: "No genuine model execution." } })), not_evaluated: [] };
export function setup(s = session, value = data) {
  const built = buildALARequest(s), inspected = inspectALAResult(value, s.current_deal.applications); assert.ok(built.ok && inspected.ok);
  const outcome = { status: inspected.coverage.status === "complete" ? "success" : "incomplete", source_token: built.source_token, coverage: inspected.coverage,
    envelope: { module: "ala", request_id: "efb62c13-f1ea-43d4-86a9-ab595398b4bb", input_digest: createHash("sha256").update(JSON.stringify({ input: built.request, references: { allow_empty: true, duplicates: "reject" } })).digest("hex"), model_provider: "fabricated-only", model_id: "offline-contract", mode: "paid", prompt_version: "ala/v1", generated_at: "2026-11-04T00:00:00Z", usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data: value } };
  const view = projectALAResults(outcome, s, s), draft = createReviewDraft(view); assert.ok(draft);
  const saved = value.findings.length ? saveReviewOverride(view, draft, { result_identity: draft.result_identity, finding_id: value.findings[0].finding_id, action_id: value.findings[0].actions[0].action_id, subject: value.findings[0].actions[0].subject, proposed_disposition: "Retain", proposed_destination: null, visitor_reason: "Fabricated visitor baseline proposal" }) : null;
  assert.ok(saved?.ok); const review = saved.draft, context = prepareCSEContext(outcome, s, s, review); assert.ok(context);
  const financial_draft = createEstimateDraft(context); financial_draft.horizon = "3"; financial_draft.actions[0].included = true;
  for (const [i, field] of (["annual_run_rate", "migration_one_time_cost", "transition_overlap_cost"] as const).entries()) financial_draft.actions[0][field] = { amount: ["100", "0", "20"][i], note: "Fabricated explicit visitor assumption" };
  const source = { context, view, financial_draft }, cloned = cloneBaseline(source); assert.ok(cloned.ok);
  const changed = editAlternativeAction(source, cloned.scenario, { finding_id: "f_0", action_id: "a_0", subject: { app_id: s.current_deal.applications[0].app_id, side: s.current_deal.applications[0].company_side }, disposition: "Retire", destination: null, scenario_reason: "Fabricated hypothetical alternative" }); assert.ok(changed.ok);
  return { source, inputs: { outcome, captured_session: s, current_session: s, review, financial_draft, scenario: changed.scenario, selected_scenario: "alternative" } satisfies PlaybookInputs };
}
const base = setup();
function input(args = base.inputs) { const b = preparePlaybookContract(args); assert.ok(b.ok, JSON.stringify(b)); return b.input; }
const captured = input(), original = JSON.stringify({ base, session });
export function specimen(s: PlaybookInput = captured): PlaybookResult {
  const refs = [...s.reviewed_ala.effective_actions.map((a) => ({ kind: "ala_action" as const, finding_id: a.finding_id, action_id: a.action_id, ...a.subject })),
    ...s.applications.filter((a) => !s.reviewed_ala.effective_actions.some((r) => r.subject.app_id === a.app_id)).map((a) => ({ kind: "application" as const, app_id: a.app_id, side: a.company_side })),
    ...s.tsa_services.map((t) => ({ kind: "tsa" as const, tsa_id: t.tsa_id }))];
  return { contract_version: "playbook/output/v1", status: "ai_generated_unapproved_draft", coverage_status: s.incomplete_context.length ? "incomplete" : "complete",
    phases: [{ phase_id: "phase_1", sequence: 1, title: "Fabricated test phase", assumptions: [], source_refs: [refs[0]] }],
    actions: refs.map((ref, i) => ({ activity_id: `activity_${i}`, phase_id: "phase_1", title: "Fabricated test activity", description: "Offline-only LLM specimen, not a public plan.", ownership_role: null, depends_on_activity_ids: i ? [`activity_${i - 1}`] : [], assumptions: [], uncertainty: { level: "unknown", reason: "Offline fabricated content" }, source_refs: [ref] })),
    milestones: [{ milestone_id: "milestone_1", phase_id: "phase_1", title: "Fabricated test milestone", after_activity_ids: [`activity_${refs.length - 1}`], proposed_date: null, date_assumption: null, source_refs: [refs[0]] }], risks: [], not_addressed: [], limitations: ["Fabricated offline test only"] };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
let groups = 0, network = 0; const beforeFetch = globalThis.fetch; globalThis.fetch = async () => { network++; throw Error("Playbook contract tests forbid network"); };
async function check(name: string, run: () => unknown | Promise<unknown>) { await run(); groups++; console.log(`PASS: ${name}`); }
try {
  await check("strict bounded detached input preserves original AI, visitor reviews, alternative hypotheses and unchanged CSE", () => {
    assert.ok(PlaybookInputSchema.safeParse(captured).success); assert.equal(captured.reviewed_ala.effective_actions[0].original.disposition, "Needs Review"); assert.equal(captured.reviewed_ala.effective_actions[0].effective.disposition, "Retain"); assert.equal(captured.scenario.alternative.action_edits[0].disposition, "Retire");
    assert.deepEqual(captured.tsa_services, session.current_deal.tsa_services); assert.deepEqual(captured.applications, apps); assert.deepEqual(captured.source.input_revisions, session.input_revisions);
    const comparison = compareScenarios(base.source, base.inputs.scenario); assert.ok(comparison.ok); assert.deepEqual(captured.financial_summary.totals, comparison.comparison.alternative_result.totals); assert.equal(captured.financial_summary.totals.migration_one_time_cost_minor, 0);
    const baseline = input({ ...base.inputs, selected_scenario: "baseline" }); assert.deepEqual(baseline.financial_summary.totals, comparison.comparison.baseline_result.totals); assert.notEqual(baseline.source.scenario_digest, captured.source.scenario_digest);
    assert.ok(Object.isFrozen(captured.scenario.baseline.financial_request.lines)); assert.equal(JSON.stringify({ base, session }), original); assert.equal(PlaybookInputSchema.safeParse({ ...captured, extra: true }).success, false);
  });
  await check("absent/invalid/untrusted export inputs, altered references/baseline and malformed sessions fail without mutation", () => {
    for (const outcome of [null, {}, captured.reviewed_ala, { ...base.inputs.outcome, extra: true }]) assert.equal(preparePlaybookContract({ ...base.inputs, outcome }).ok, false);
    for (const field of ["review", "financial_draft", "scenario"] as const) assert.equal(preparePlaybookContract({ ...base.inputs, [field]: null }).ok, false);
    const bad = structuredClone(base.inputs); bad.scenario.baseline.actions[0].original.rationale = "Changed original"; assert.equal(preparePlaybookContract(bad).ok, false);
    const invalid = structuredClone(session); invalid.current_deal.tsa_services[0].related_app_ids = ["missing"]; assert.equal(preparePlaybookContract({ ...base.inputs, current_session: invalid }).ok, false);
    const duplicate = structuredClone(session); duplicate.current_deal.tsa_services[0].tsa_id = apps[0].app_id; assert.equal(preparePlaybookContract({ ...base.inputs, current_session: duplicate }).ok, false);
    const longID = structuredClone(session); longID.current_deal.tsa_services[0].tsa_id = "t".repeat(129); assert.equal(preparePlaybookContract({ ...base.inputs, current_session: longID }).ok, false);
    assert.equal(preparePlaybookContract({ ...base.inputs, current_session: { ...session, extra: true } }).ok, false);
  });
  await check("source lifetime, every input revision, unversioned content, reviews and scenario assumptions invalidate capture", () => {
    assert.ok(matchesPlaybookInput(captured, base.inputs));
    const changed = [updateApplication(session, apps[0].app_id, { notes: "Changed source" }), updateLicense(session, session.current_deal.license_positions[0].license_id, { notes: "Changed license" }), updateTSA(session, session.current_deal.tsa_services[0].tsa_id, { status: "active" }), createDemoSession()];
    const unversioned = structuredClone(session); unversioned.current_deal.tsa_services[0].owner = "Changed role"; changed.push(unversioned);
    for (const current_session of changed) assert.equal(matchesPlaybookInput(captured, { ...base.inputs, current_session }), false);
    const review = structuredClone(base.inputs.review); review.overrides[0].visitor_reason = "Changed review justification"; assert.equal(matchesPlaybookInput(captured, { ...base.inputs, review }), false);
    const alternative = editAlternativeHorizon(base.source, base.inputs.scenario, "5"); assert.ok(alternative.ok); assert.equal(matchesPlaybookInput(captured, { ...base.inputs, scenario: alternative.scenario }), false);
    const row = structuredClone(base.inputs.scenario.alternative.financial_draft.actions[0]); row.annual_run_rate.note = "Changed assumption note"; const financial = editAlternativeFinancialInput(base.source, base.inputs.scenario, row); assert.ok(financial.ok); assert.equal(matchesPlaybookInput(captured, { ...base.inputs, scenario: financial.scenario }), false);
    assert.equal(matchesPlaybookInput(captured, { ...base.inputs, selected_scenario: "baseline" }), false);
  });
  await check("phases/actions/roles/dependencies/assumptions/risks/milestones validate without generation", () => {
    const output = specimen(), r = inspectPlaybookResult(output, captured); assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.coverage.status, "complete"); assert.equal(output.actions[0].ownership_role, null);
    output.actions[0].ownership_role = "Proposed integration lead"; output.actions[0].assumptions = ["Unverified test assumption"]; output.milestones[0].proposed_date = "2027-01-01"; output.milestones[0].date_assumption = "Illustrative proposed date, not an obligation";
    output.risks = [{ risk_id: "risk_1", description: "Fabricated advisory narrative", assumptions: ["Unverified"], uncertainty: { level: "unknown", reason: "No verified risk evidence" }, source_refs: output.actions[0].source_refs }]; assert.ok(inspectPlaybookResult(output, captured).ok);
    assert.deepEqual(extractPlaybookReferences(output), [...apps.map((a) => a.app_id), ...session.current_deal.tsa_services.map((t) => t.tsa_id)]); assert.equal(PLAYBOOK_OUTPUT_CONTRACT.references.allow_empty, true);
  });
  await check("wrong sides, foreign IDs, altered finding/action subjects and every structured citation path rejected", () => {
    for (const area of ["phases", "actions", "milestones", "risks"] as const) {
      const r = specimen(); r.risks = [{ risk_id: "risk_1", description: "Offline", assumptions: [], uncertainty: { level: "unknown", reason: "Unknown" }, source_refs: r.actions[0].source_refs }];
      r[area][0].source_refs = [{ kind: "tsa", tsa_id: "foreign" }]; assert.equal(inspectPlaybookResult(r, captured).ok, false);
    }
    for (const ref of [{ kind: "application", app_id: apps[0].app_id, side: "target" }, { kind: "ala_action", app_id: apps[0].app_id, side: "buyer", finding_id: "foreign", action_id: "a_0" }, { kind: "tsa", tsa_id: apps[0].app_id }]) { const r = specimen(); r.actions[0].source_refs = [ref as never]; assert.equal(inspectPlaybookResult(r, captured).ok, false); }
    const r = specimen(); r.not_addressed = [{ source: { kind: "tsa", tsa_id: "foreign" }, reason: "Unknown" }]; r.coverage_status = "incomplete"; assert.equal(inspectPlaybookResult(r, captured).ok, false);
  });
  await check("graph cycles/self/unknown/forward-phase dependencies, duplicate identities and unsupported dates fail", () => {
    const edits: ((r: PlaybookResult) => void)[] = [r => { r.actions[0].depends_on_activity_ids = ["activity_0"]; }, r => { r.actions[0].depends_on_activity_ids = ["activity_1"]; }, r => { r.actions[0].depends_on_activity_ids = ["foreign"]; }, r => { r.actions[1].activity_id = r.actions[0].activity_id; }, r => { r.phases[0].sequence = 2; }, r => { r.milestones[0].after_activity_ids = ["foreign"]; }, r => { r.milestones[0].proposed_date = "2027-01-01"; }, r => { r.milestones[0].proposed_date = "2027-02-30"; r.milestones[0].date_assumption = "Unverified"; }, r => { r.actions[0].ownership_role = " "; }, r => { r.actions[0].source_refs.push(r.actions[0].source_refs[0]); }];
    for (const edit of edits) { const r = specimen(); edit(r); assert.equal(inspectPlaybookResult(r, captured).ok, false); }
    const forward = specimen(); forward.phases.push({ ...forward.phases[0], phase_id: "phase_2", sequence: 2 }); forward.actions[1].phase_id = "phase_2"; forward.actions[1].depends_on_activity_ids = []; forward.actions[0].depends_on_activity_ids = ["activity_1"]; assert.equal(inspectPlaybookResult(forward, captured).ok, false);
  });
  await check("coverage rejects false completeness and explicitly retains skipped/missing and incomplete context", () => {
    const r = specimen(); r.actions.pop(); r.milestones[0].after_activity_ids = ["activity_0"]; assert.equal(inspectPlaybookResult(r, captured).ok, false); r.coverage_status = "incomplete"; let inspected = inspectPlaybookResult(r, captured); assert.ok(inspected.ok && inspected.coverage.missing_tsa_ids.length === 1);
    r.not_addressed = [{ source: { kind: "tsa", tsa_id: inspected.coverage.missing_tsa_ids[0] }, reason: "No supported activity was generated" }]; assert.ok(inspectPlaybookResult(r, captured).ok);
    r.not_addressed.push(r.not_addressed[0]); assert.equal(inspectPlaybookResult(r, captured).ok, false);
    const missing = structuredClone(data); missing.findings.pop(); const partial = input(setup(session, missing).inputs), output = specimen(partial); assert.ok(partial.incomplete_context.includes("ala_incomplete")); assert.ok(inspectPlaybookResult(output, partial).ok); output.coverage_status = "complete"; assert.equal(inspectPlaybookResult(output, partial).ok, false);
    const empty = { ...specimen(), coverage_status: "incomplete", phases: [], actions: [], milestones: [], risks: [] }; assert.ok(inspectPlaybookResult(empty, captured).ok);
  });
  await check("unknown/zero/omitted TSA links and unsupported financial values remain distinct", () => {
    const s = structuredClone(session); s.current_deal.applications[0].annual_cost = null; s.current_deal.tsa_services[0].owner = null; delete s.current_deal.tsa_services[0].related_app_ids; s.current_deal.tsa_services[1].related_app_ids = [];
    const p = input(setup(s).inputs); assert.equal(p.applications[0].annual_cost, null); assert.equal(p.financial_summary.totals.annual_recurring_savings_minor, null); assert.equal(p.financial_summary.totals.migration_one_time_cost_minor, 0); assert.equal(Object.hasOwn(p.tsa_services[0], "related_app_ids"), false); assert.deepEqual(p.tsa_services[1].related_app_ids, []); assert.ok(p.incomplete_context.includes("financial_incomplete"));
  });
  await check("bounded JSON/schema/provenance rejects extras, non-JSON, oversized and model-authored metadata", () => {
    assert.ok(PLAYBOOK_SYSTEM_PROMPT.length <= 4000); assert.ok(Buffer.byteLength(JSON.stringify({ input: captured, system: PLAYBOOK_SYSTEM_PROMPT, schema: z.toJSONSchema(PlaybookResultSchema) }), "utf8") <= MAX_INPUT_BYTES);
    assert.equal(inspectPlaybookResult({ ...specimen(), provider: "made-up" }, captured).ok, false); assert.equal(inspectPlaybookResult(undefined, captured).ok, false); assert.equal(inspectPlaybookResult({ ...specimen(), limitations: Array(20).fill("x".repeat(4000)) }, captured).ok, false);
    const envelope = { ...base.inputs.outcome.envelope, module: "playbook", prompt_version: "playbook/v1", data: specimen() }; assert.ok(PlaybookEnvelopeSchema.safeParse(envelope).success); assert.equal(PlaybookEnvelopeSchema.safeParse({ ...envelope, module: "ala" }).success, false); assert.equal(PlaybookEnvelopeSchema.safeParse({ ...envelope, mode: "fallback" }).success, false);
    const oversized = structuredClone(base.inputs); const huge = "x".repeat(513000); assert.equal(buildPlaybookInput({ ...oversized, current_session: { ...session, huge } }).ok, false);
    const largeSession = structuredClone(session); largeSession.current_deal.tsa_services = Array.from({ length: 100 }, (_, i) => ({ ...session.current_deal.tsa_services[0], tsa_id: `large-tsa-${i}`, title: "x".repeat(100), risk_notes: "y".repeat(500) }));
    const largeInputs = setup(largeSession).inputs, tooLarge = preparePlaybookContract(largeInputs); assert.equal(tooLarge.ok, false); if (!tooLarge.ok) assert.equal(tooLarge.code, "request_too_large");
    const largeOutput = specimen(); largeOutput.actions = Array.from({ length: 100 }, (_, i) => ({ ...largeOutput.actions[0], activity_id: `large_${i}`, description: "x".repeat(800), depends_on_activity_ids: [] })); largeOutput.milestones[0].after_activity_ids = ["large_0"];
    assert.ok(PlaybookResultSchema.safeParse(largeOutput).success); assert.ok(Buffer.byteLength(JSON.stringify(largeOutput), "utf8") > 64000); assert.equal(inspectPlaybookResult(largeOutput, captured).ok, false);
    assert.equal(PlaybookResultSchema.safeParse({ ...specimen(), phases: Array(13).fill(specimen().phases[0]) }).success, false); assert.equal(PlaybookResultSchema.safeParse({ ...specimen(), actions: Array(101).fill(specimen().actions[0]) }).success, false);
  });
  await check("server-only boundary, unchanged public disabled route and no live/network/storage operations", async () => {
    const blocked = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/playbook/contract.ts')"], { encoding: "utf8" }); assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /server-only|Client Component/);
    for (const file of ["input.ts", "schema.ts", "prompt.ts", "contract.ts"]) { const code = await readFile(`lib/server/playbook/${file}`, "utf8"); assert.match(code, /import "server-only"/); assert.doesNotMatch(code, /fetch\(|createAIRouter\(|createAIAdapter\(|sessionStorage|localStorage|process\.env|console\./); }
    const page = await readFile("app/[module]/page.tsx", "utf8"); assert.doesNotMatch(page, /server\/playbook|Generate plan/); assert.match(page, /GeneratePlaybook/);
    assert.equal(JSON.stringify({ base, session }), original); assert.equal(network, 0);
  });
  console.log(`PASS: ${groups} U04.01 groups; contract-only, original/review/scenario separation, source/graph/coverage validation, zero network.`);
} finally { globalThis.fetch = beforeFetch; }
}
