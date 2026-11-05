import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fixture } from "./check-playbook-review.mts";
import { createDemoSession, updateApplication, updateLicense, updateTSA } from "../lib/session/session.ts";
import { buildTSASummary } from "../lib/tsa-tracker/tsa-summary.ts";
import { prepareCSEContext } from "../lib/server/cost-synergy/reviewed-context.ts";
import { createEstimateDraft, buildEstimateRequest } from "../lib/cost-synergy/estimate-form.ts";
import { MAX_CSE_BYTES } from "../lib/cost-synergy/calculation-contract.ts";
import { calculateCSE } from "../lib/cost-synergy/calculation.ts";
import { buildHealthMetrics, isCurrentHealthMetrics } from "../lib/server/integration-health/metrics.ts";
import type { HealthSources } from "../lib/server/integration-health/metrics.ts";

let groups = 0, network = 0; const saved = globalThis.fetch;
globalThis.fetch = async () => { network++; throw Error("Offline dashboard metrics forbid external requests"); };
const accepted = (read: () => HealthSources | null) => { const result = buildHealthMetrics(read); assert.ok(result.ok, JSON.stringify(result)); return result.metrics; };
async function check(name: string, run: () => unknown | Promise<unknown>) { await run(); groups++; console.log(`PASS: ${name}`); }
try {
  await check("current session app/TSA metrics match exact inventory, side and source statuses; missing analysis is not zero", () => {
    const s = createDemoSession(), before = JSON.stringify(s), m = accepted(() => ({ session: s })), tsa = buildTSASummary(s); assert.ok(tsa.ok);
    assert.equal(m.contract_version, "health/metrics/v1"); assert.equal(m.applications.value?.total, s.current_deal.applications.length);
    assert.equal(m.applications.value?.buyer, s.current_deal.applications.filter(a => a.company_side === "buyer").length);
    assert.equal(m.applications.value?.target, s.current_deal.applications.filter(a => a.company_side === "target").length); assert.deepEqual(m.tsa.value, tsa.summary.counts);
    assert.deepEqual(m.source.input_revisions, s.input_revisions); assert.equal(m.source.session_id, s.session_id);
    for (const key of ["ala", "estimate", "playbook"] as const) { assert.equal(m[key].state, "absent"); assert.equal(m[key].value, null); }
    assert.equal(m.reviewed_suggestions.state, "not_recorded"); assert.equal(m.reviewed_suggestions.value, null); assert.equal(JSON.stringify(s), before); assert.ok(Object.isFrozen(m.source.input_revisions));
    const empty = structuredClone(s); empty.current_deal.tsa_services = []; assert.equal(accepted(() => ({ session: empty })).tsa.value?.total, 0);
  });
  const p = await fixture(true), i = p.read(), context = prepareCSEContext(i.outcome, i.captured_session, i.current_session, i.review); assert.ok(context);
  const draft = createEstimateDraft(context); draft.horizon = "2"; draft.actions[0].included = true;
  for (const field of ["annual_run_rate", "migration_one_time_cost", "transition_overlap_cost"] as const) draft.actions[0][field] = { amount: "0", note: "Explicit fabricated visitor zero for offline test" };
  const built = buildEstimateRequest(context, draft); assert.ok(built.ok); const result = calculateCSE(built.request, context); assert.notEqual(result.status, "invalid");
  const base: HealthSources = { session: i.current_session, ala: { outcome: i.outcome, captured_session: i.captured_session, review: i.review }, estimate: { result, draft }, playbook: { source: p.source, review: p.draft } };
  await check("validated upstream metrics retain original/review distinction, exact CSE totals/units, draft activities and provenance without invocation", () => {
    const before = JSON.stringify(base), calls = p.calls(), m = accepted(() => base); assert.ok(m.ala.value && m.playbook.value);
    const findings = i.outcome.status !== "error" ? i.outcome.envelope.data.findings : []; assert.equal(m.ala.value.original_action_rows, findings.reduce((n, f) => n + f.actions.length, 0));
    assert.equal(m.ala.value.visitor_overrides, i.review.overrides.length); assert.equal(m.reviewed_suggestions.value, null);
    assert.equal(m.playbook.state, "incomplete"); assert.equal(m.playbook.value.activities, p.result.status !== "error" ? p.result.envelope.data.actions.length : -1); assert.equal(m.playbook.value.visitor_edits, 0);
    if (result.status !== "invalid" && result.status !== "not_computable") { assert.deepEqual(m.estimate.value?.totals, result.totals); assert.equal(m.estimate.value?.currency, "CAD"); assert.equal(m.estimate.value?.totals.annual_recurring_savings_minor, 0); }
    else assert.equal(m.estimate.value, null);
    assert.ok("trace" in m.ala && m.ala.trace.request_id); assert.equal(JSON.stringify(base), before); assert.equal(p.calls(), calls); assert.ok(isCurrentHealthMetrics(m));
    assert.equal(isCurrentHealthMetrics(structuredClone(m)), false); assert.equal(isCurrentHealthMetrics({ current: true, ...m }), false);
  });
  await check("unknown/invalid/dirty financial data never becomes zero or a fabricated KPI; tampered totals rejected", () => {
    const changed = structuredClone(draft); changed.actions[0].annual_run_rate.amount = "";
    const dirty = accepted(() => ({ ...base, estimate: { result, draft: changed } })); assert.equal(dirty.estimate.state, "outdated"); assert.equal(dirty.estimate.value, null);
    const request = buildEstimateRequest(context, changed); assert.ok(request.ok); const unknown = calculateCSE(request.request, context);
    const m = accepted(() => ({ ...base, estimate: { result: unknown, draft: changed } })); assert.equal(m.estimate.value?.totals.annual_recurring_savings_minor ?? null, null);
    const tampered = structuredClone(result); if (tampered.status !== "invalid") tampered.totals.annual_recurring_savings_minor = 123;
    assert.equal(accepted(() => ({ ...base, estimate: { result: tampered, draft } })).estimate.state, "invalid");
    const invalid = accepted(() => ({ ...base, estimate: { result, draft: {} as never } })); assert.equal(invalid.estimate.state, "invalid"); assert.ok(invalid.applications.value);
  });
  await check("invalid/missing upstream sections preserve available inventory and explicit review uncertainty", () => {
    const invalid = accepted(() => ({ ...base, ala: { ...base.ala!, outcome: {} }, playbook: { ...base.playbook!, review: {} } }));
    assert.equal(invalid.ala.state, "invalid"); assert.equal(invalid.playbook.state, "invalid"); assert.ok(invalid.applications.value);
    const noReview = accepted(() => ({ ...base, ala: { ...base.ala!, review: null }, estimate: null, playbook: { ...base.playbook!, review: null } }));
    assert.equal(noReview.ala.value?.visitor_overrides, null); assert.equal(noReview.playbook.value?.visitor_edits, null);
    assert.equal(accepted(() => ({ ...base, ala: { ...base.ala!, review: {} } })).ala.state, "invalid");
  });
  await check("session/reset/revision/review/assumption/Playbook changes revoke observed captures even when counts match; revert cannot revive", () => {
    const a = structuredClone(base.ala!); a.review.overrides[0].visitor_reason = "Changed visitor justification";
    const d = structuredClone(draft); d.actions[0].annual_run_rate.note = "New explicit note";
    const revisions = structuredClone(i.current_session); revisions.input_revisions.tsa++;
    const changes: HealthSources[] = [
      { ...base, session: updateApplication(i.current_session, i.current_session.current_deal.applications[0].app_id, { notes: "Changed source" }) },
      { ...base, session: updateLicense(i.current_session, i.current_session.current_deal.license_positions[0].license_id, { notes: "Changed source" }) },
      { ...base, session: updateTSA(i.current_session, i.current_session.current_deal.tsa_services[0].tsa_id, { status: "completed" }) },
      { ...base, session: createDemoSession() }, { ...base, session: revisions }, { ...base, ala: a }, { ...base, estimate: { result, draft: d } }, { ...base, playbook: null },
    ];
    for (const changed of changes) { let latest = base; const m = accepted(() => latest); latest = changed; assert.equal(isCurrentHealthMetrics(m), false); latest = base; assert.equal(isCurrentHealthMetrics(m), false); }
    const s = updateApplication(i.current_session, i.current_session.current_deal.applications[0].app_id, { notes: "Changed" }); const stale = accepted(() => ({ ...base, session: s })); assert.equal(stale.ala.state, "outdated"); assert.equal(stale.estimate.value, null); assert.equal(stale.playbook.state, "outdated");
  });
  await check("invalid primary source, dangling IDs, oversized data, throwing/unstable readers fail closed with no partial snapshot", () => {
    const bad = structuredClone(i.current_session); bad.current_deal.license_positions[0].app_id = "invented";
    for (const session of [null, {}, bad, { ...i.current_session, extra: true }, { ...i.current_session, extra: "x".repeat(512001) }]) assert.equal(buildHealthMetrics(() => ({ session })).ok, false);
    assert.equal(buildHealthMetrics(() => ({ ...base, ala: { ...base.ala!, outcome: { oversized: "x".repeat(MAX_CSE_BYTES + 1) } } })).ok, false);
    assert.equal(buildHealthMetrics(() => { throw Error("PRIVATE_SOURCE_DETAIL"); }).ok, false); let n = 0; const unstable = buildHealthMetrics(() => ({ session: n++ ? createDemoSession() : i.current_session })); assert.ok(!unstable.ok && unstable.code === "source_changed");
  });
  await check("server-only projection has no inference, mutation, persistence, public fixture or UI activation", async () => {
    const code = await readFile("lib/server/integration-health/metrics.ts", "utf8"); assert.doesNotMatch(code, /createAIRouter|createAIAdapter|fetch\(|process\.env|console\.|sessionStorage|localStorage|updateApplication\(|updateTSA\(/);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/integration-health/metrics.ts')"], { encoding: "utf8", timeout: 5000 }); assert.notEqual(child.status, 0); assert.match(child.stderr, /server-only|Client Component/); assert.equal(network, 0);
  });
  await mkdir(".temp/u13-01", { recursive: true }); await writeFile(".temp/u13-01/metrics-tests.json", JSON.stringify({ groups, external_requests: network, source_session_id: i.current_session.session_id }, null, 2));
  console.log(`PASS: ${groups} U13.01 groups; source-traceable metrics, explicit missing values, no provider calls by projection.`);
} finally { globalThis.fetch = saved; }
