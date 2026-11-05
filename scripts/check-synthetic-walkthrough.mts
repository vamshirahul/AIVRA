import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture as mockFixture } from "./check-license-findings.mts";
import { setup, specimen } from "./check-playbook-contract.mts";
import { createDemoSessionController } from "../lib/session/controller.ts";
import { INVENTORY_COLUMNS } from "../lib/data-mapper/inventory-view.ts";
import { parseCSVBytes } from "../lib/data-mapper/parse-csv.ts";
import { columnMappingReducer, initialMappingState } from "../lib/data-mapper/column-mapping.ts";
import { currentConfirmedApplications } from "../lib/data-mapper/publish-applications.ts";
import { createALAAnalyzer } from "../lib/server/ala/analyze.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { createReviewDraft, saveReviewOverride } from "../lib/ala/review-overrides.ts";
import { buildReviewedExport, prepareReviewedDownload, consumeReviewedExport } from "../lib/ala/review-export.ts";
import { prepareCSEContext } from "../lib/server/cost-synergy/reviewed-context.ts";
import { buildEstimateRequest, createEstimateDraft } from "../lib/cost-synergy/estimate-form.ts";
import { calculateCSE } from "../lib/cost-synergy/calculation.ts";
import { captureEstimateExport, prepareCSEDownload } from "../lib/cost-synergy/estimate-export.ts";
import { cloneBaseline, editAlternativeFinancialInput } from "../lib/scenario-modeling/scenario-draft.ts";
import { compareScenarios } from "../lib/scenario-modeling/scenario-comparison.ts";
import { captureScenarioExport, prepareScenarioDownload } from "../lib/scenario-modeling/scenario-export.ts";
import { projectLicenseResults } from "../lib/server/licenses/presentation.ts";
import { createLicenseSelectionDraft, saveLicenseSelection, licenseReviewIdentity } from "../lib/license-optimizer/review-selections.ts";
import { buildLicenseCSEHandoff, validateCurrentLicenseCSEHandoff } from "../lib/server/licenses/cse-handoff.ts";
import { buildTSASummary } from "../lib/tsa-tracker/tsa-summary.ts";
import { prepareTSADownload } from "../lib/tsa-tracker/tsa-export.ts";
import { preparePlaybookContract } from "../lib/server/playbook/contract.ts";
import { createPlaybookGenerator } from "../lib/server/playbook/generate.ts";
import { createPlaybookReviewSource } from "../lib/server/playbook/review-source.ts";
import { createPlaybookReviewDraft, projectPlaybookReview, savePlaybookEdit } from "../lib/playbook-generator/review-draft.ts";
import { capturePlaybookExport, preparePlaybookDownload } from "../lib/playbook-generator/review-export.ts";
import { createAssistantAskOwner } from "../lib/server/assistant/ask.ts";
import { buildAssistantContext, validateAssistantReferences } from "../lib/server/assistant/context.ts";
import { buildHealthMetrics, isCurrentHealthMetrics } from "../lib/server/integration-health/metrics.ts";
import type { AssistantSources } from "../lib/server/assistant/context.ts";
import type { PlaybookInputs } from "../lib/server/playbook/input.ts";
import type { PlaybookExportState } from "../lib/playbook-generator/review-export.ts";

// One root deal, real module operations, guarded fabricated providers. Never a
// public result fixture, transport or model-quality assertion.
const caller = { client_key: "a".repeat(64) }, records: { stage: string; status: "PASS" | "BLOCKED"; detail: string }[] = [];
const pass = (stage: string, detail: string) => { records.push({ stage, status: "PASS", detail }); console.log(`PASS: ${stage}: ${detail}`); };
const options = (mock: ReturnType<typeof mockFixture>) => ({ policy: mock.p, execution: "offline-test" as const, store: mock.store, clock: mock.clock, paid: mock.paid, fallback: mock.fallback });
let network = 0; const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { network++; throw Error("U90.01 walkthrough forbids external providers"); };
try {
  const values = new Map<string, string>(), controller = createDemoSessionController(() => ({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } })); controller.initialize();
  const initial = controller.getSnapshot().session!, rows = initial.current_deal.applications.filter(a => a.company_side === "buyer").map((a, i) => i ? a : { ...a, app_name: "Published synthetic walkthrough application" });
  const csv = [INVENTORY_COLUMNS.map(([k]) => k).join(","), ...rows.map(a => INVENTORY_COLUMNS.map(([k]) => `"${String(a[k] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
  const parsed = parseCSVBytes("offline-walkthrough.csv", new TextEncoder().encode(csv)); assert.ok(parsed.ok);
  let mapping = columnMappingReducer(initialMappingState, { type: "csv", action: { type: "begin", side: "buyer", generation: 1 } });
  mapping = columnMappingReducer(mapping, { type: "csv", action: { type: "complete", side: "buyer", generation: 1, result: parsed } });
  for (const [index, [field]] of INVENTORY_COLUMNS.entries()) mapping = columnMappingReducer(mapping, { type: "map", side: "buyer", generation: 1, field, index });
  mapping = columnMappingReducer(mapping, { type: "confirm", side: "buyer", generation: 1, revision: mapping.mapping.buyer!.revision });
  const confirmed = currentConfirmedApplications(mapping.csv.buyer, mapping.mapping.buyer, "buyer"); assert.ok(confirmed.ok);
  assert.ok(controller.publishApplications("buyer", confirmed.applications, { session_id: initial.session_id, session_revision: initial.session_revision }).ok);
  assert.ok(controller.updateTSA(initial.current_deal.tsa_services[0].tsa_id, { status: "active" }).ok);
  const captured = controller.getSnapshot().session!, current = () => controller.getSnapshot().session!;
  assert.equal(captured.session_id, initial.session_id); assert.equal(captured.input_revisions.applications, 1); assert.equal(captured.input_revisions.tsa, 1);
  assert.deepEqual(captured.current_deal.license_positions, initial.current_deal.license_positions);
  assert.deepEqual(captured.current_deal.applications.map(a => a.app_id), initial.current_deal.applications.map(a => a.app_id));
  pass("U01.04 published source", "CSV parse/map/confirm/publication plus TSA update preserve linked IDs and one root session");

  const seed = setup(captured), alaMock = mockFixture(seed.inputs.outcome.envelope.data), analyze = createALAAnalyzer(options(alaMock));
  const ala = await analyze(captured, caller); assert.notEqual(ala.status, "error"); const view = projectALAResults(ala, captured, current()); assert.ok("data" in view);
  const empty = createReviewDraft(view); assert.ok(empty); const first = view.data.findings[0], action = first.actions[0];
  const saved = saveReviewOverride(view, empty, { result_identity: empty.result_identity, finding_id: first.finding_id, action_id: action.action_id, subject: action.subject, proposed_disposition: "Retain", proposed_destination: null, visitor_reason: "Explicit offline visitor proposal" }); assert.ok(saved.ok); const review = saved.draft;
  const exported = buildReviewedExport(view, review); assert.ok(exported.ok); const consumed = consumeReviewedExport(exported.artifact); assert.ok(consumed.ok);
  for (const format of ["json", "csv"] as const) { const file = prepareReviewedDownload(view, review, format); assert.ok(file.ok && file.content.length); }
  assert.equal(exported.artifact.effective_actions[0].origin, "visitor_override"); assert.equal(exported.artifact.effective_actions[0].original.disposition, action.disposition);
  pass("U02.05 reviewed ALA", "guarded mocked generation, original/visitor separation, JSON/CSV and downstream consumption share exact actions");

  const context = prepareCSEContext(ala, captured, current(), review); assert.ok(context?.reviewed); const draft = createEstimateDraft(context); draft.horizon = "3"; draft.actions[0].included = true;
  for (const [i, field] of (["annual_run_rate", "migration_one_time_cost", "transition_overlap_cost"] as const).entries()) draft.actions[0][field] = { amount: ["100", "20", "30"][i], note: "Explicit fabricated visitor assumption, not inferred savings" };
  const built = buildEstimateRequest(context, draft); assert.ok(built.ok); const estimate = calculateCSE(built.request, context); assert.equal(estimate.status, "computed"); if (estimate.status === "invalid") throw Error(); assert.equal(estimate.totals.illustrative_net_benefit_minor, 25000);
  const csePermit = captureEstimateExport(estimate, context, draft, true); assert.ok(csePermit);
  for (const format of ["json", "csv"] as const) assert.ok(prepareCSEDownload(csePermit, context, draft, true, format).ok);
  assert.deepEqual(context.reviewed.effective_actions, exported.artifact.effective_actions);
  const scenarioSource = { context, view, financial_draft: draft }, cloned = cloneBaseline(scenarioSource); assert.ok(cloned.ok);
  const financial = structuredClone(cloned.scenario.alternative.financial_draft.actions[0]); financial.annual_run_rate.amount = "200";
  const edited = editAlternativeFinancialInput(scenarioSource, cloned.scenario, financial); assert.ok(edited.ok); const scenario = edited.scenario, comparison = compareScenarios(scenarioSource, scenario); assert.ok(comparison.ok);
  const scenarioPermit = captureScenarioExport(scenarioSource, scenario, comparison.comparison, true, false); assert.ok(scenarioPermit);
  for (const format of ["json", "csv"] as const) assert.ok(prepareScenarioDownload(scenarioPermit, scenarioSource, scenario, comparison.comparison, true, false, format).ok);
  assert.equal(comparison.comparison.differences.illustrative_net_benefit_minor.amount_minor, 30000); assert.equal(estimate.totals.illustrative_net_benefit_minor, 25000);
  pass("U03.03/U11.03 financial exports", "same reviewed source, explicit CAD cents, immutable baseline/one alternative and both export formats");

  const licenseMock = mockFixture(), licenses = await licenseMock.analyze(captured, caller), licenseView = projectLicenseResults(licenses, captured, current()); assert.ok("data" in licenseView);
  let selection = createLicenseSelectionDraft(licenseView); assert.ok(selection);
  for (const finding of licenseView.data.findings.slice(0, 2)) { const next = saveLicenseSelection(licenseView, selection, { result_identity: licenseReviewIdentity(licenseView), finding_id: finding.original.finding_id, status: "selected" }); assert.ok(next.ok); selection = next.draft; }
  const handoff = buildLicenseCSEHandoff(licenses, captured, current(), selection, { context, request: built.request }); assert.ok(handoff.ok);
  assert.equal(handoff.handoff.candidates.length, 2); assert.equal(handoff.handoff.financial_aggregation, "withheld"); assert.ok(handoff.handoff.candidates.every(c => c.financial_eligibility.startsWith("withheld")));
  assert.deepEqual(calculateCSE(built.request, context), estimate);
  const tsa = buildTSASummary(current()); assert.ok(tsa.ok); assert.equal(tsa.summary.counts.active, 1);
  for (const format of ["json", "csv"] as const) assert.ok(prepareTSADownload(current(), format).ok);
  pass("U05.04/U07.03 supporting records", "selected-only license evidence is withheld from numeric aggregation; current TSA exports/counts preserve source statuses");

  let playbookInputs: PlaybookInputs = { outcome: ala, captured_session: captured, current_session: current(), review, financial_draft: draft, scenario, selected_scenario: "alternative" };
  const prepared = preparePlaybookContract(playbookInputs); assert.ok(prepared.ok); assert.deepEqual(prepared.input.reviewed_ala.effective_actions, exported.artifact.effective_actions); assert.deepEqual(prepared.input.financial_summary.totals, comparison.comparison.alternative_result.status !== "invalid" ? comparison.comparison.alternative_result.totals : null); assert.deepEqual(prepared.input.tsa_services, captured.current_deal.tsa_services); const planOutput = specimen(prepared.input), refs = planOutput.actions.flatMap(a => a.source_refs);
  // A compact fixed offline model specimen covers every input reference; no source
  // rows or request data are removed to evade invocation limits.
  const templates = planOutput.actions; planOutput.actions = Array.from({ length: Math.ceil(refs.length / 20) }, (_, i) => ({ ...templates[i], depends_on_activity_ids: i ? [templates[i - 1].activity_id] : [], source_refs: refs.slice(i * 20, (i + 1) * 20) })); planOutput.milestones[0].after_activity_ids = [planOutput.actions.at(-1)!.activity_id];
  const planMock = mockFixture(planOutput), planOwner = createPlaybookGenerator(options(planMock)), readPlan = () => ({ ...playbookInputs, current_session: current() }), plan = await planOwner.generate(readPlan, caller); assert.notEqual(plan.status, "error", JSON.stringify(plan));
  const planSource = createPlaybookReviewSource(planOwner, plan, readPlan, controller.subscribe), initialReview = createPlaybookReviewDraft(planSource); assert.ok(initialReview); const projection = projectPlaybookReview(planSource, initialReview)!;
  const row = projection.activities[0], planEdit = savePlaybookEdit(planSource, initialReview, { binding: initialReview.binding, kind: "activity", id: row.id, values: { ...row.values, title: "Visitor-proposed walkthrough activity" }, visitor_reason: "Provisional offline visitor wording" }); assert.ok(planEdit.ok);
  const planReview = planEdit.draft; let exportState: PlaybookExportState = { source: planSource, draft: planReview, session: current(), editing: false, revision: 1 };
  const permit = await capturePlaybookExport(() => ({ ...exportState, session: current() })); assert.ok(permit.ok);
  for (const format of ["json", "md"] as const) assert.ok(preparePlaybookDownload(permit.permit, format).ok);
  assert.equal(prepared.input.source.session_id, captured.session_id);
  pass("U04.04 reviewed Playbook", "actual guarded owner consumes the same reviewed ALA/scenario/TSA, preserves original and exports saved review JSON/Markdown");

  const readAssistant = (): AssistantSources => ({ session: current(), ala: { outcome: ala, captured_session: captured, review }, licenses: { outcome: licenses, captured_session: captured }, assumptions: { captured_session: captured, draft, expected_review_digest: context.review_digest! }, playbook: { source: planSource, review: planReview } });
  const assistantMock = mockFixture(undefined, undefined, async call => { const c = call.input.context.assistant!.context; return { output: { contract_version: "assistant/answer/v1", status: "answered", answer: "Fabricated offline contextual draft only; no business actions.", citations: [c.allowed_references.find(r => r.kind === "application")!], missing_context: c.missing_context, illustrative_unapproved: true, narrative_not_verified: true }, usage: { inputTokens: 10, outputTokens: 5 } }; });
  const assistant = createAssistantAskOwner(options(assistantMock)), opened = assistant.createConversation(readAssistant); assert.equal(opened.status, "ready", JSON.stringify(opened)); if (opened.status !== "ready") throw Error();
  const beforeAsk = JSON.stringify(current()), answer = await assistant.ask(opened.conversation, { contract_version: "assistant/ask/v1", question: "Explain the available fictional source; do not change any records." }, caller);
  assert.equal(answer.status, "success", JSON.stringify(answer)); if (answer.status !== "success") throw Error();
  const ctx = buildAssistantContext(readAssistant); assert.ok(ctx.ok && validateAssistantReferences(ctx.context, answer.envelope.data.citations).ok); assert.equal(JSON.stringify(current()), beforeAsk);
  const history = assistant.getHistory(opened.conversation); const invalidAsk = await assistant.ask(opened.conversation, { contract_version: "assistant/ask/v1", question: "" }, caller); assert.equal(invalidAsk.status, "error"); assert.equal(assistant.getHistory(opened.conversation), history);
  const countsBeforeHealth = JSON.stringify([alaMock.calls(), licenseMock.calls(), planMock.calls(), assistantMock.calls()]);
  const readHealth = () => ({ session: current(), ala: { outcome: ala, captured_session: captured, review }, estimate: { result: estimate, draft }, playbook: { source: planSource, review: planReview } });
  const health = buildHealthMetrics(readHealth); assert.ok(health.ok && isCurrentHealthMetrics(health.metrics)); assert.equal(health.metrics.tsa.value?.active, 1); assert.equal(health.metrics.ala.value?.visitor_overrides, 1); assert.equal(health.metrics.estimate.value?.totals.illustrative_net_benefit_minor, estimate.totals.illustrative_net_benefit_minor);
  assert.equal(JSON.stringify([alaMock.calls(), licenseMock.calls(), planMock.calls(), assistantMock.calls()]), countsBeforeHealth);
  pass("U10.04/U13.03 contextual consumers", "bounded guarded Assistant cites same-source IDs without mutation; dashboard uses exact current metric identities and existing CSE output");

  const staleBefore = current(); assert.ok(controller.updateApplication(captured.current_deal.applications[0].app_id, { notes: "Explicit source mutation after all captures" }).ok);
  const staleView = projectALAResults(ala, captured, current()); assert.equal(staleView.state, "outdated"); assert.equal(prepareReviewedDownload(staleView, review, "json").ok, false);
  const staleContext = prepareCSEContext(ala, captured, current(), review); assert.ok(staleContext); assert.equal(prepareCSEDownload(csePermit, staleContext, draft, true, "json").ok, false);
  const staleScenarioSource = { ...scenarioSource, context: staleContext, view: staleView }; assert.equal(prepareScenarioDownload(scenarioPermit, staleScenarioSource, scenario, comparison.comparison, true, false, "json").ok, false);
  assert.equal(validateCurrentLicenseCSEHandoff(handoff.handoff, licenses, captured, current(), selection, { context, request: built.request }).ok, false);
  assert.equal(preparePlaybookDownload(permit.permit, "json").ok, false); assert.equal(assistant.isCurrent(answer), false); assert.equal(assistant.getHistory(opened.conversation), null); assert.equal(isCurrentHealthMetrics(health.metrics), false);
  assert.equal(JSON.stringify(staleBefore.current_deal.license_positions), JSON.stringify(current().current_deal.license_positions));
  assert.ok(controller.resetDemoSession().ok); assert.notEqual(current().session_id, captured.session_id); assert.equal(isCurrentHealthMetrics(health.metrics), false); assert.equal(assistant.getHistory(opened.conversation), null);
  pass("cross-module invalidation/Reset", "one source edit blocks old ALA/CSE/scenario/license/Playbook/Assistant/dashboard consumers; linked source records retained and Reset cannot revive old captures");
  assert.equal(network, 0);
  records.push({ stage: "one public demo end to end", status: "BLOCKED", detail: "Protected ALA/license/Playbook/Assistant result delivery and live-model activation are not authorized/connected. Offline PASS is not public end-to-end success." });
  await mkdir(".temp/u90-01", { recursive: true }); await writeFile(".temp/u90-01/walkthrough.json", JSON.stringify({ session_id: captured.session_id, source_revisions: captured.input_revisions, records, external_requests: network, mocked_provider_calls: { ala: alaMock.calls(), licenses: licenseMock.calls(), playbook: planMock.calls(), assistant: assistantMock.calls() } }, null, 2));
  console.log(`PASS: ${records.filter(r => r.status === "PASS").length} protected offline walkthrough stages; public end-to-end BLOCKED, no live calls.`);
} finally { globalThis.fetch = oldFetch; }
