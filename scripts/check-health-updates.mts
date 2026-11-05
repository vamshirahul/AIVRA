import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { healthFixture } from "./check-health-metrics.mts";
import { fixture as providerFixture } from "./check-license-findings.mts";
import { createDemoSessionController } from "../lib/session/controller.ts";
import { SESSION_STORAGE_KEY, updateTSA } from "../lib/session/session.ts";
import { buildTSASummary } from "../lib/tsa-tracker/tsa-summary.ts";
import { buildHealthMetrics, isCurrentHealthMetrics } from "../lib/server/integration-health/metrics.ts";
import type { HealthSources } from "../lib/server/integration-health/metrics.ts";
import { dashboardPresentation } from "../lib/integration-health/dashboard-view.ts";
import { createALAAnalyzer } from "../lib/server/ala/analyze.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { createReviewDraft, saveReviewOverride } from "../lib/ala/review-overrides.ts";
import { prepareCSEContext } from "../lib/server/cost-synergy/reviewed-context.ts";
import { cloneBaseline, editAlternativeFinancialInput, editAlternativeHorizon } from "../lib/scenario-modeling/scenario-draft.ts";
import { compareScenarios } from "../lib/scenario-modeling/scenario-comparison.ts";
import { buildEstimateRequest, formatCAD } from "../lib/cost-synergy/estimate-form.ts";
import { calculateCSE } from "../lib/cost-synergy/calculation.ts";
import { createPlaybookReviewSource } from "../lib/server/playbook/review-source.ts";
import { createPlaybookReviewDraft, projectPlaybookReview, savePlaybookEdit } from "../lib/playbook-generator/review-draft.ts";

// New update scenarios only; existing unit suites are not invoked on import.
const caller = { client_key: "a".repeat(64) };
let groups = 0, network = 0; const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { network++; throw Error("Offline dashboard update acceptance forbids network"); };
async function check(name: string, run: () => unknown | Promise<unknown>) { await run(); groups++; console.log(`PASS: ${name}`); }
const capture = (read: () => HealthSources | null) => { const b = buildHealthMetrics(read); assert.ok(b.ok, JSON.stringify(b)); return b.metrics; };
try {
  await check("approved application publication add/update/remove and conservative orphan rejection update exact side counts", () => {
    const storage = new Map<string, string>(), c = createDemoSessionController(() => ({ getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); }, removeItem: k => { storage.delete(k); } })); c.initialize();
    let notifications = 0; c.subscribe(() => { notifications++; });
    const read = () => ({ session: c.getSnapshot().session! }), initial = read().session, buyer = initial.current_deal.applications.filter(a => a.company_side === "buyer"), targetCount = initial.current_deal.applications.length - buyer.length;
    const publish = (rows: typeof buyer) => { const s = read().session; return c.publishApplications("buyer", rows, { session_id: s.session_id, session_revision: s.session_revision }); };
    assert.ok(publish([...buyer, { ...buyer[0], app_id: "app_offline_dashboard_added", app_name: "Isolated synthetic test addition" }]).ok);
    assert.equal(capture(read).applications.value?.buyer, buyer.length + 1); assert.equal(capture(read).applications.value?.target, targetCount);
    assert.ok(c.updateApplication(buyer[0].app_id, { app_name: "Updated existing application" }).ok); assert.equal(capture(read).applications.value?.total, initial.current_deal.applications.length + 1);
    assert.ok(publish(read().session.current_deal.applications.filter(a => a.company_side === "buyer" && a.app_id !== "app_offline_dashboard_added")).ok);
    assert.equal(capture(read).applications.value?.total, initial.current_deal.applications.length);
    const before = JSON.stringify(read()), linked = read().session.current_deal.license_positions[0].app_id;
    const failed = publish(buyer.filter(a => a.app_id !== linked)); assert.equal(failed.ok, false); assert.equal(JSON.stringify(read()), before); assert.equal(notifications, 3);
    assert.equal(JSON.parse(storage.get(SESSION_STORAGE_KEY)!).session_revision, read().session.session_revision);
  });
  await check("rapid TSA status transitions, Reset and rejected edits retain exact portfolio counts independent of filtered lists", () => {
    const storage = new Map<string, string>(), c = createDemoSessionController(() => ({ getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); }, removeItem: k => { storage.delete(k); } })); c.initialize();
    const id = c.getSnapshot().session!.current_deal.tsa_services[0].tsa_id;
    for (const status of ["active", "at_risk", "completed", "planned"] as const) {
      assert.ok(c.updateTSA(id, { status }).ok); const s = c.getSnapshot().session!, summary = buildTSASummary(s); assert.ok(summary.ok); const m = capture(() => ({ session: s })); assert.deepEqual(m.tsa.value, summary.summary.counts);
      assert.equal(m.tsa.value?.total, s.current_deal.tsa_services.length); assert.equal(s.current_deal.tsa_services.filter(r => r.status === "active").length, m.tsa.value?.active);
    }
    const before = c.getSnapshot().session; assert.equal(c.updateTSA(id, { status: "invented" } as never).ok, false); assert.equal(c.getSnapshot().session, before);
    assert.ok(c.resetDemoSession().ok); assert.notEqual(c.getSnapshot().session!.session_id, before!.session_id); assert.equal(capture(() => ({ session: c.getSnapshot().session })).tsa.value?.planned, 5);
  });
  const f = await healthFixture(); let latest: HealthSources = f.base;
  const providerCounts: (() => unknown)[] = [() => f.p.calls()];
  const steps: { name: string; snapshot: ReturnType<typeof capture> }[] = [];
  function issue(name: string) { const counts = providerCounts.map(read => read()); const snapshot = capture(() => latest); assert.ok(isCurrentHealthMetrics(snapshot)); assert.deepEqual(providerCounts.map(read => read()), counts); steps.push({ name, snapshot }); return snapshot; }
  function change(next: HealthSources) { const old = steps.at(-1)!.snapshot; latest = next; assert.equal(isCurrentHealthMetrics(old), false); }
  issue("initial");
  await check("owner-issued Playbook review and regenerated original update edit counts and provenance while preserving source originals", async () => {
    const original = JSON.stringify(f.p.result), projected = projectPlaybookReview(f.p.source, f.p.draft)!;
    const row = projected.activities[0], saved = savePlaybookEdit(f.p.source, f.p.draft, { binding: f.p.draft.binding, kind: "activity", id: row.id, values: { ...row.values, title: "Visitor update acceptance title" }, visitor_reason: "Isolated visitor proposal" }); assert.ok(saved.ok);
    change({ ...latest, playbook: { source: f.p.source, review: saved.draft } }); assert.equal(issue("playbook_review").playbook.value?.visitor_edits, 1); assert.equal(JSON.stringify(f.p.result), original);
    const result = await f.p.owner.generate(f.p.read, caller); assert.notEqual(result.status, "error");
    const source = createPlaybookReviewSource(f.p.owner, result, f.p.read, f.p.subscribe), review = createPlaybookReviewDraft(source); assert.ok(review);
    change({ ...latest, playbook: { source, review } }); const m = issue("playbook_regenerated"); assert.equal(m.playbook.value?.visitor_edits, 0); assert.equal(m.playbook.value?.activities, projected.activities.length);
    assert.notEqual("trace" in m.playbook && m.playbook.trace.request_id, "trace" in steps[0].snapshot.playbook && steps[0].snapshot.playbook.trace.request_id);
  });
  await check("U11.02 scenario financial/horizon edits propagate only through existing CSE results; dirty/null inputs withhold stale amounts", () => {
    const view = projectALAResults(f.i.outcome, f.i.captured_session, f.i.current_session), source = { context: f.context, view, financial_draft: f.draft };
    const cloned = cloneBaseline(source); assert.ok(cloned.ok); const line = structuredClone(cloned.scenario.alternative.financial_draft.actions[0]); line.annual_run_rate.amount = "0"; line.migration_one_time_cost = { amount: "123.45", note: "Explicit fabricated cost" };
    const edited = editAlternativeFinancialInput(source, cloned.scenario, line); assert.ok(edited.ok); const horizon = editAlternativeHorizon(source, edited.scenario, "3"); assert.ok(horizon.ok);
    const compared = compareScenarios(source, horizon.scenario); assert.ok(compared.ok);
    f.p.replace({ ...f.p.read(), financial_draft: horizon.scenario.alternative.financial_draft, scenario: horizon.scenario });
    change({ ...latest, estimate: { result: compared.comparison.alternative_result, draft: horizon.scenario.alternative.financial_draft } }); const m = issue("scenario_financial");
    assert.equal(m.estimate.value?.totals.illustrative_net_benefit_minor, -12345); assert.equal(m.estimate.value?.totals.horizon_years, 3); assert.equal(m.playbook.state, "outdated"); assert.deepEqual(m.estimate.value?.totals, compared.comparison.alternative_result.status !== "invalid" ? compared.comparison.alternative_result.totals : null);
    const partial = structuredClone(horizon.scenario.alternative.financial_draft); partial.actions[0].annual_run_rate.amount = "";
    change({ ...latest, estimate: { result: compared.comparison.alternative_result, draft: partial } }); assert.equal(issue("dirty_estimate").estimate.state, "outdated");
    const request = buildEstimateRequest(f.context, partial); assert.ok(request.ok); change({ ...latest, estimate: { draft: partial, result: calculateCSE(request.request, f.context) } }); const unknown = issue("incomplete_estimate"); assert.equal(unknown.estimate.state, "incomplete"); assert.equal(unknown.estimate.value?.totals.annual_recurring_savings_minor, null); assert.ok(unknown.estimate.value?.warnings.includes("missing_amount"));
  });
  await check("new guarded ALA output and legitimate saved review replace current counts without changing originals or inventing approvals", async () => {
    assert.notEqual(f.i.outcome.status, "error"); if (f.i.outcome.status === "error") throw Error(); const output = structuredClone(f.i.outcome.envelope.data); output.findings.pop();
    const fake = providerFixture(output), analyze = createALAAnalyzer({ policy: fake.p, execution: "offline-test", store: fake.store, clock: fake.clock, paid: fake.paid, fallback: fake.fallback });
    providerCounts.push(() => fake.calls());
    const outcome = await analyze(f.i.current_session, caller); assert.notEqual(outcome.status, "error");
    const view = projectALAResults(outcome, f.i.current_session, f.i.current_session), review = createReviewDraft(view); assert.ok(review && "data" in view);
    change({ ...latest, ala: { outcome, captured_session: f.i.current_session, review } }); const m = issue("new_ala"); assert.equal(m.ala.state, "incomplete"); assert.equal(m.ala.value?.original_action_rows, output.findings.length); assert.equal(m.ala.value?.visitor_overrides, 0); assert.equal(m.estimate.value, null);
    const action = view.data.findings[0].actions[0], saved = saveReviewOverride(view, review, { result_identity: review.result_identity, finding_id: view.data.findings[0].finding_id, action_id: action.action_id, subject: action.subject, proposed_disposition: "Retire", proposed_destination: null, visitor_reason: "Explicit isolated visitor change" }); assert.ok(saved.ok);
    const before = JSON.stringify(outcome); change({ ...latest, ala: { outcome, captured_session: f.i.current_session, review: saved.draft } }); const edited = issue("saved_ala_review"); assert.equal(edited.ala.value?.visitor_overrides, 1); assert.equal(edited.ala.value?.original_action_rows, m.ala.value?.original_action_rows); assert.equal(edited.reviewed_suggestions.value, null); assert.equal(JSON.stringify(outcome), before); assert.deepEqual(fake.calls(), { paid: 1, fallback: 0 });
    change({ ...latest, ala: null }); assert.equal(issue("missing_ala").ala.state, "absent"); change({ ...latest, ala: { outcome: {}, captured_session: f.i.current_session } }); assert.equal(issue("invalid_ala").ala.state, "invalid");
  });
  await check("observed invalidation, revision-only/source errors and same-object revocation cannot revive old dashboard values", () => {
    for (const old of steps.slice(0, -1)) assert.equal(isCurrentHealthMetrics(old.snapshot), false);
    const changed = latest; latest = f.base; assert.equal(isCurrentHealthMetrics(steps[0].snapshot), false); latest = changed;
    const current = issue("final"); let source = { getSnapshot: () => current, subscribe: () => () => {}, isCurrent: isCurrentHealthMetrics, matchesSession: (session: unknown) => JSON.stringify(session) === JSON.stringify(latest.session) };
    const invalid = { ...f.i.current_session, input_revisions: { ...f.i.current_session.input_revisions, tsa: f.i.current_session.input_revisions.tsa + 1 } };
    latest = { ...latest, session: invalid }; assert.equal(dashboardPresentation(invalid, true, current, source).ala.value, null);
    latest = { session: {} }; assert.equal(buildHealthMetrics(() => latest).ok, false); assert.equal(dashboardPresentation(null, true, current, source).state, "invalid"); assert.equal(dashboardPresentation(null, false, current, source).applications, null); assert.equal(isCurrentHealthMetrics(current), false);
    latest = changed; assert.equal(isCurrentHealthMetrics(current), false); assert.equal(buildHealthMetrics(() => null).ok, false);
    assert.equal(network, 0);
  });
  latest = f.base; const recovery = capture(() => latest); assert.ok(isCurrentHealthMetrics(recovery)); assert.equal(isCurrentHealthMetrics(steps[0].snapshot), false);
  await mkdir(".temp/u13-03", { recursive: true }); await writeFile(".temp/u13-03/updates.json", JSON.stringify({ session: f.i.current_session, recovery, steps: steps.map(s => ({ ...s, expected: { actions: s.snapshot.ala.value?.original_action_rows ?? "Not available", overrides: s.snapshot.ala.value?.visitor_overrides ?? "Not available", net: s.snapshot.estimate.value ? formatCAD(s.snapshot.estimate.value.totals.illustrative_net_benefit_minor) : "Not available", activities: s.snapshot.playbook.value?.activities ?? "Not available", edits: s.snapshot.playbook.value?.visitor_edits ?? "Not available" } })) }));
  await writeFile(".temp/u13-03/acceptance.json", JSON.stringify({ groups, steps: steps.map(s => s.name), external_requests: network }, null, 2));
  console.log(`PASS: ${groups} U13.03 groups; approved source operations, actual owners, scenario/CSE arithmetic and sticky update acceptance.`);
} finally { globalThis.fetch = oldFetch; }
