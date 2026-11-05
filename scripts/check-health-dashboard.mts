import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { healthFixture } from "./check-health-metrics.mts";
import { buildHealthMetrics, isCurrentHealthMetrics } from "../lib/server/integration-health/metrics.ts";
import { dashboardPresentation, validHealthDisplay, HEALTH_STATE_LABELS } from "../lib/integration-health/dashboard-view.ts";
import type { HealthPresentationSource } from "../lib/integration-health/dashboard-view.ts";
import { createDemoSession, updateTSA } from "../lib/session/session.ts";
import { formatCAD, buildEstimateRequest } from "../lib/cost-synergy/estimate-form.ts";
import { calculateCSE } from "../lib/cost-synergy/calculation.ts";

let groups = 0, network = 0; const saved = globalThis.fetch;
globalThis.fetch = async () => { network++; throw Error("Offline dashboard forbids external requests"); };
async function check(name: string, test: () => unknown | Promise<unknown>) { await test(); groups++; console.log(`PASS: ${name}`); }
try {
  const f = await healthFixture(); let latest = f.base;
  const built = buildHealthMetrics(() => latest); assert.ok(built.ok); const snapshot = built.metrics;
  const source: HealthPresentationSource = { getSnapshot: () => snapshot, subscribe: () => () => {}, isCurrent: isCurrentHealthMetrics, matchesSession: session => JSON.stringify(session) === JSON.stringify(latest.session) };
  await check("public counts use validated current session while protected results stay unavailable; loading/invalid never zero", () => {
    const s = createDemoSession(), before = JSON.stringify(s), view = dashboardPresentation(s, true);
    assert.equal(view.applications?.total, s.current_deal.applications.length); assert.equal(view.applications?.buyer, s.current_deal.applications.filter(a => a.company_side === "buyer").length);
    for (const metric of [view.ala, view.estimate, view.playbook]) { assert.equal(metric.state, "unavailable"); assert.equal(metric.value, null); }
    assert.equal(view.reviewed_suggestions.state, "not_recorded"); assert.equal(dashboardPresentation(s, false).applications, null); assert.equal(dashboardPresentation(null, true).state, "invalid"); assert.equal(JSON.stringify(s), before);
    const passedJson = dashboardPresentation(s, true, structuredClone(snapshot)); assert.equal(passedJson.ala.value, null);
  });
  await check("current U13.01 owner-issued snapshot yields exact typed metrics with original override semantics and signed CAD", () => {
    const before = JSON.stringify(latest), calls = f.p.calls(), view = dashboardPresentation(f.i.current_session, true, snapshot, source);
    assert.ok(validHealthDisplay(snapshot)); assert.equal(view.ala.value?.original_action_rows, snapshot.ala.value?.original_action_rows); assert.equal(view.ala.value?.visitor_overrides, f.i.review.overrides.length);
    assert.equal(view.reviewed_suggestions.value, null); assert.equal(view.playbook.state, "incomplete"); assert.deepEqual(view.estimate.value, snapshot.estimate.value);
    assert.equal(formatCAD(0), "CAD 0.00"); assert.equal(formatCAD(-12345), "−CAD 123.45"); assert.equal(formatCAD(null), "Unknown / Not computable"); assert.equal(JSON.stringify(latest), before); assert.equal(f.p.calls(), calls);
  });
  await check("extra-key/invalid state/amount/count and JSON snapshots cannot bypass display or source authority", () => {
    for (const invalid of [{ ...snapshot, private_context: {} }, { ...snapshot, ala: { state: "current", value: null } }, { ...snapshot, applications: { ...snapshot.applications, value: { total: -1, buyer: 0, target: 0 } } }, { ...snapshot, estimate: { state: "approved", value: {} } }]) {
      assert.equal(validHealthDisplay(invalid), false); assert.equal(dashboardPresentation(f.i.current_session, true, invalid, { ...source, isCurrent: () => true }).ala.state, "invalid");
    }
    assert.equal(dashboardPresentation(f.i.current_session, true, structuredClone(snapshot), source).ala.state, "outdated");
    assert.equal(dashboardPresentation(f.i.current_session, true, snapshot, { current: true } as never).ala.state, "invalid");
    assert.deepEqual(Object.keys(HEALTH_STATE_LABELS), ["current", "incomplete", "absent", "outdated", "invalid", "unavailable", "not_recorded"]);
  });
  await check("changed revision/session hides protected snapshot immediately; no old result survives Reset or source reversion", () => {
    const original = latest; latest = { ...latest, session: updateTSA(f.i.current_session, f.i.current_session.current_deal.tsa_services[0].tsa_id, { status: "active" }) };
    const view = dashboardPresentation(latest.session as typeof f.i.current_session, true, snapshot, source); assert.equal(view.ala.state, "outdated"); assert.equal(view.estimate.value, null); assert.equal(view.playbook.value, null);
    latest = original; assert.equal(dashboardPresentation(f.i.current_session, true, snapshot, source).ala.state, "outdated");
    assert.equal(dashboardPresentation(createDemoSession(), true, snapshot, source).estimate.value, null);
  });
  await check("public route mounts only dashboard without source, reuses one TSA summary and links existing overviews without provider/storage paths", async () => {
    const route = await readFile("app/[module]/page.tsx", "utf8"), ui = await readFile("components/integration-health/dashboard.tsx", "utf8"), view = await readFile("lib/integration-health/dashboard-view.ts", "utf8");
    assert.match(route, /<HealthDashboard \/>/); assert.doesNotMatch(route, /<HealthDashboard source|<TSAHealthSummary/); assert.equal((ui.match(/<TSAHealthSummary \/>/g) ?? []).length, 1);
    for (const path of ["/data-mapper", "/application-rationalization", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator"]) assert.ok(ui.includes(`href="${path}"`));
    for (const code of [ui, view]) assert.doesNotMatch(code.replace(/^import type .*$/gm, ""), /from ["'][^"']*server\/|fetch\(|sessionStorage|localStorage|dangerouslySetInnerHTML|process\.env|console\.|calculateCSE\(/);
    assert.equal(network, 0);
  });
  // Isolated browser evidence uses actual U13.01 snapshots only. No public fixtures.
  const negative = structuredClone(f.draft); negative.actions[0].migration_one_time_cost = { amount: "123.45", note: "Fabricated explicit cost only" };
  const request = buildEstimateRequest(f.context, negative); assert.ok(request.ok);
  const inputs = { ...f.base, estimate: { draft: negative, result: calculateCSE(request.request, f.context) } };
  const display = buildHealthMetrics(() => inputs); assert.ok(display.ok);
  const absent = buildHealthMetrics(() => ({ session: f.i.current_session })); assert.ok(absent.ok);
  await mkdir(".temp/u13-02", { recursive: true }); const unknownDraft = structuredClone(negative); unknownDraft.actions[0].annual_run_rate.amount = "";
  const unknownRequest = buildEstimateRequest(f.context, unknownDraft); assert.ok(unknownRequest.ok);
  const incomplete = buildHealthMetrics(() => ({ ...inputs, estimate: { draft: unknownDraft, result: calculateCSE(unknownRequest.request, f.context) } })); assert.ok(incomplete.ok);
  const outdated = buildHealthMetrics(() => ({ ...inputs, estimate: { ...inputs.estimate, draft: unknownDraft } })); assert.ok(outdated.ok);
  await writeFile(".temp/u13-02/fixtures.json", JSON.stringify({ session: f.i.current_session, populated: display.metrics, absent: absent.metrics, incomplete: incomplete.metrics, outdated: outdated.metrics }));
  console.log(`PASS: ${groups} U13.02 groups; actual metrics owner, truthful public inventory/unavailable state, zero external requests.`);
} finally { globalThis.fetch = saved; }
