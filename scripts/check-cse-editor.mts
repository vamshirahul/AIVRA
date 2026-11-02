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
import { CSE_VERSION, CSERequestSchema, MAX_MINOR } from "../lib/cost-synergy/calculation-contract.ts";
import type { CSEContext } from "../lib/cost-synergy/calculation-contract.ts";
import { calculateCSE } from "../lib/cost-synergy/calculation.ts";
import { parseCADInput, formatCAD, createEstimateDraft, buildEstimateRequest, editorIdentity, editorSessionStamp, matchesEditorSession, verifyEditorDigest, MONEY_FIELDS } from "../lib/cost-synergy/estimate-form.ts";
import type { EstimateDraft } from "../lib/cost-synergy/estimate-form.ts";
import { POST } from "../app/api/ai/ala/route.ts";

// Fabricated offline trusted-composition specimens, not actual model execution.
const session = createDemoSession();
const data: ALAResult = { findings: session.current_deal.applications.map((a, i) => ({ finding_id: `f_${i}`, domain: "Fabricated offline domain", relationship: "unique", buyer_app_ids: a.company_side === "buyer" ? [a.app_id] : [], target_app_ids: a.company_side === "target" ? [a.app_id] : [],
  actions: [{ action_id: `a_${i}`, subject: { app_id: a.app_id, side: a.company_side }, disposition: "Needs Review", destination: null, rationale: "Fabricated original AI rationale; no inference occurred." }],
  rationale: "Fabricated financial editor test only.", evidence: [{ app_id: a.app_id, attribute: "annual_cost" }], uncertainty: { level: "unknown", reason: "Fabricated test evidence, not real analysis." } })), not_evaluated: [] };
function setup(s = session, input = data, request_id = "30550aca-e6db-4a61-b1d0-34ef2bd17af0") {
  const built = buildALARequest(s), checked = inspectALAResult(input, s.current_deal.applications); assert.ok(built.ok && checked.ok);
  const outcome = { status: checked.coverage.status === "complete" ? "success" : "incomplete", source_token: built.source_token, coverage: checked.coverage,
    envelope: { module: "ala", request_id, input_digest: createHash("sha256").update(JSON.stringify({ input: built.request, references: { allow_empty: true, duplicates: "reject" } })).digest("hex"),
      model_provider: "fabricated-only", model_id: "offline-cse-editor", mode: "paid", prompt_version: "ala/v1", generated_at: "2026-11-02T00:00:00Z",
      usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data: input } };
  const view = projectALAResults(outcome, s, s), review = createReviewDraft(view), context = prepareCSEContext(outcome, s, s, review); assert.ok(context);
  return { outcome, view, review, context };
}
const base = setup(), context = base.context;
function filled(c = context): EstimateDraft {
  const draft = createEstimateDraft(c); draft.horizon = "1"; draft.actions[0].included = true;
  for (const [i, field] of MONEY_FIELDS.entries()) draft.actions[0][field] = { amount: ["100.00", "20.00", "30.00"][i], note: "Invented explicit visitor financial assumption." };
  return draft;
}
function request(draft = filled(), c = context) { const built = buildEstimateRequest(c, draft); assert.ok(built.ok, JSON.stringify(built)); return built.request; }
function calc(draft = filled(), c = context) { const r = calculateCSE(request(draft, c), c); assert.notEqual(r.status, "invalid", JSON.stringify(r)); if (r.status === "invalid") throw Error("invalid"); return r; }
function render(props: object) {
  const child = spawnSync(process.execPath, ["scripts/check-cse-editor-browser.mjs", "--render"], { input: JSON.stringify(props), encoding: "utf8", timeout: 15000 });
  assert.equal(child.status, 0, child.stderr); return child.stdout;
}
const original = JSON.stringify({ base, session });
let groups = 0, network = 0; const beforeFetch = globalThis.fetch;
globalThis.fetch = async () => { network++; throw Error("CSE editor tests forbid network/provider calls"); };
async function check(name: string, fn: () => unknown | Promise<unknown>) { await fn(); groups++; console.log(`PASS: ${name}`); }
try {
  await check("exact CAD cents and boundaries; missing differs from zero; unsafe syntax never rounded", () => {
    for (const [raw, minor] of [["", null], ["0", 0], ["0.00", 0], ["1.23", 123], ["1200.5", 120050], ["1200.50", 120050], ["10000000000.00", MAX_MINOR]] as const) assert.deepEqual(parseCADInput(raw), { ok: true, minor });
    for (const raw of ["-1", "+1", "1e3", "0.001", "1.230", "1,000", "$1", "NaN", "Infinity", " 1", "1 ", " ", ".1", "1.", "01", "10000000000.01", "9".repeat(1000)]) assert.equal(parseCADInput(raw).ok, false, raw);
    assert.equal(formatCAD(123), "CAD 1.23"); assert.equal(formatCAD(0), "CAD 0.00"); assert.equal(formatCAD(-5000), "−CAD 50.00"); assert.equal(formatCAD(null), "Unknown / Not computable");
  });
  await check("independent controlled drafts start excluded, blank, no auto-savings/notes/horizon", () => {
    const draft = createEstimateDraft(context); assert.equal(draft.horizon, ""); assert.ok(draft.actions.every((a) => !a.included && MONEY_FIELDS.every((field) => a[field].amount === "" && a[field].note === "")));
    const r = calc(draft); assert.equal(r.status, "not_computable"); assert.equal(r.totals.annual_recurring_savings_minor, null);
    const b = createEstimateDraft(context); draft.actions[0].annual_run_rate.amount = "12"; assert.equal(b.actions[0].annual_run_rate.amount, "");
  });
  await check("exact action/side IDs, originals and override separation; safe foreign/duplicate bindings", () => {
    const r = request(); assert.equal(r.contract_version, CSE_VERSION); assert.equal(CSERequestSchema.safeParse(r).success, true);
    assert.deepEqual(r.lines[0].action_reference, { finding_id: "f_0", action_id: "a_0", subject: data.findings[0].actions[0].subject });
    assert.deepEqual(r.lines[0].spend_app_ids, [data.findings[0].actions[0].subject.app_id]); assert.ok(r.lines.every((l) => l.source_kind === "ala"));
    const d = filled(); d.actions[0].line_id = "foreign"; assert.equal(buildEstimateRequest(context, d).ok, false);
    d.actions[0].line_id = "a_0"; d.actions.push(d.actions[0]); assert.equal(buildEstimateRequest(context, d).ok, false);
    const changed = saveReviewOverride(base.view, base.review, { result_identity: reviewIdentity(base.view), finding_id: "f_0", action_id: "a_0", subject: data.findings[0].actions[0].subject, proposed_disposition: "Retire", proposed_destination: null, visitor_reason: '<script>offline-only</script> & Keep CASE' }); assert.ok(changed.ok);
    const next = prepareCSEContext(base.outcome, session, session, changed.draft)!; assert.notEqual(editorIdentity(next), editorIdentity(context));
    const html = render({ mode: "editor", context: next }); assert.match(html, /Original AI recommendation/); assert.match(html, /Visitor override — unapproved/); assert.match(html, /Needs Review/); assert.match(html, /Retire/); assert.match(html, /&lt;script&gt;offline-only/); assert.doesNotMatch(html, /<script>/);
  });
  await check("amount notes, missing vs explicit zero, horizon and real-time field errors", () => {
    for (const year of ["0", "31", "1.5", "1e1", " 1", "-1", "01"]) { const d = filled(); d.horizon = year; const b = buildEstimateRequest(context, d); assert.ok(!b.ok && b.errors.horizon); }
    for (const year of ["", "1", "3", "5", "30"]) { const d = filled(); d.horizon = year; assert.equal(buildEstimateRequest(context, d).ok, true); }
    for (const value of ["0", "100"]) { const d = filled(); d.actions[0].annual_run_rate = { amount: value, note: " " }; const b = buildEstimateRequest(context, d); assert.ok(!b.ok && b.errors["a_0.annual_run_rate.note"]); }
    const d = filled(); d.actions[0].annual_run_rate = { amount: "", note: "" }; const r = calc(d); assert.equal(r.status, "incomplete"); assert.equal(r.totals.annual_recurring_savings_minor, null); assert.equal(r.totals.one_time_total_minor, 5000);
    d.actions[0].annual_run_rate = { amount: "0.00", note: "Invented explicit zero" }; assert.equal(calc(d).totals.illustrative_net_benefit_minor, -5000);
    d.actions[0].annual_run_rate.note = "x".repeat(401); assert.equal(buildEstimateRequest(context, d).ok, false);
  });
  await check("unchanged CSE arithmetic across 1/3/5 years and a second edited calculation", () => {
    for (const year of [1, 3, 5]) { const d = filled(); d.horizon = String(year); const r = calc(d); assert.equal(r.status, "computed"); assert.deepEqual(r.totals, { annual_recurring_savings_minor: 10000, migration_one_time_cost_minor: 2000, transition_overlap_cost_minor: 3000, one_time_total_minor: 5000, horizon_recurring_savings_minor: 10000 * year, illustrative_net_benefit_minor: 10000 * year - 5000, horizon_years: year }); }
    const d = filled(), first = calc(d); d.actions[0].annual_run_rate.amount = "200"; const second = calc(d); assert.equal(first.totals.illustrative_net_benefit_minor, 5000); assert.equal(second.totals.illustrative_net_benefit_minor, 15000);
    const overflow = filled(); overflow.actions[0].annual_run_rate.amount = "10000000000"; overflow.horizon = "2"; assert.equal(calculateCSE(request(overflow), context).status, "invalid");
  });
  await check("unknown/unsupported source amounts preserve known one-time values; coverage stays incomplete", () => {
    for (const cost of [null, 1.001, 1e-7]) {
      const s = structuredClone(session); s.current_deal.applications[0].annual_cost = cost; const c = setup(s).context, r = calc(filled(c), c);
      assert.equal(r.status, "incomplete"); assert.equal(r.totals.annual_recurring_savings_minor, null); assert.equal(r.totals.one_time_total_minor, 5000); assert.equal(r.totals.illustrative_net_benefit_minor, null);
      const html = render({ result: r }); assert.match(html, /Incomplete estimate/); assert.match(html, /Unknown \/ Not computable/);
    }
    const partial = structuredClone(data); partial.findings.pop(); const skipped = partial.findings.pop()!; partial.not_evaluated.push({ ...skipped.actions[0].subject, reason: "Fabricated unevaluated reason" });
    const c = setup(session, partial).context; assert.equal(calc(filled(c), c).status, "incomplete"); const html = render({ mode: "editor", context: c }); assert.match(html, /Missing: 1; not evaluated: 1/); assert.match(html, /Fabricated unevaluated reason/);
  });
  await check("shared whole-app spend conflicts retained, excluded claims never silently included", () => {
    const overlapping = structuredClone(data); const extra = structuredClone(data.findings[0]); extra.finding_id = "extra"; extra.actions[0].action_id = "extra_action"; overlapping.findings.push(extra);
    const c = setup(session, overlapping).context, d = filled(c); const last = d.actions.at(-1)!; last.included = true;
    for (const field of MONEY_FIELDS) last[field] = { ...d.actions[0][field] };
    const r = calc(d, c); assert.equal(r.status, "not_computable"); assert.ok(r.conflicts.some((v) => v.reason === "overlapping_spend")); assert.equal(r.totals.illustrative_net_benefit_minor, null);
    assert.match(render({ result: r }), /No automatic resolution or double counting/);
    last.included = false; assert.equal(calc(d, c).status, "computed");
  });
  await check("synchronous dependency keys and async digest detect edits/publication/reorder/reset; TSA-only stays fresh", async () => {
    const reversed = structuredClone(session); reversed.current_deal.applications.reverse();
    const licenseReorder = structuredClone(session); licenseReorder.current_deal.license_positions.reverse();
    const silent = structuredClone(session); silent.current_deal.license_positions[0].product = "Silent edit";
    const published = publishSessionApplications(session, "buyer", [...session.current_deal.applications.filter((a) => a.company_side === "buyer"), { ...session.current_deal.applications[0], app_id: "new-test-only" }], { session_id: session.session_id, session_revision: session.session_revision });
    for (const s of [updateApplication(session, session.current_deal.applications[0].app_id, { notes: "test change" }), updateLicense(session, session.current_deal.license_positions[0].license_id, { notes: "test change" }), reversed, licenseReorder, silent, published, createDemoSession()]) {
      assert.notEqual(editorSessionStamp(s), editorSessionStamp(session)); assert.equal(await verifyEditorDigest(context, s), false);
    }
    const tsa = updateTSA(session, session.current_deal.tsa_services[0].tsa_id, { title: "TSA-only edit" }); assert.equal(editorSessionStamp(tsa), editorSessionStamp(session)); assert.ok(matchesEditorSession(context, tsa)); assert.ok(await verifyEditorDigest(context, tsa));
    assert.notEqual(editorIdentity(setup(session, data, "1fe7d360-5f0d-40b5-9cb0-dacacb7ba391").context), editorIdentity(context));
    const absent = prepareCSEContext(null, session, session, null)!; assert.equal(buildEstimateRequest(absent, createEstimateDraft(absent)).ok, false);
    const stale = prepareCSEContext(base.outcome, session, updateApplication(session, session.current_deal.applications[0].app_id, { notes: "Changed" }), base.review)!; assert.equal(buildEstimateRequest(stale, createEstimateDraft(stale)).ok, false);
  });
  await check("SSR native labels, disclosure, escaped notes, strict unavailable/invalid/no-KPI states", () => {
    const html = render({ mode: "editor", context }); assert.match(html, /<fieldset/); assert.match(html, /<legend>Buyer/); assert.match(html, /type="checkbox"/); assert.doesNotMatch(html, /checked=""/);
    for (const label of ["Annual recurring savings", "One-time migration cost", "One-time transition overlap cost", "Calculation horizon", "Basis note"]) assert.ok(html.includes(label));
    assert.match(html, /aria-describedby=/); assert.match(html, /aria-live="polite"/); assert.match(html, /Calculate estimate/); assert.match(html, /Reset financial inputs/); assert.doesNotMatch(html, /placeholder="\d/);
    const empty = render({ mode: "empty" }); assert.match(empty, /No validated ALA analysis available/); assert.doesNotMatch(empty, /<input|<button|CAD \d/);
    const unknown = calc(createEstimateDraft(context)); assert.doesNotMatch(render({ result: unknown }), /<dl|CAD 0.00/);
    assert.doesNotMatch(render({ result: calculateCSE({}, context) }), /<dl|<dd/);
  });
  await check("client/server boundaries, no provider/endpoint/storage/math changes; original data immutable", async () => {
    const helper = await readFile("lib/cost-synergy/estimate-form.ts", "utf8"), ui = await readFile("components/cost-synergy/estimate-workspace.ts", "utf8");
    for (const code of [helper, ui]) assert.doesNotMatch(code, /server-only|lib\/server|node:|fetch\(|sessionStorage|localStorage|recordDerived|process\.env|Math\.round|dangerouslySetInnerHTML/);
    assert.match(ui, /calculateCSE\(validation.request, context\)/); assert.match(ui, /key, context/); assert.match(ui, /verified\?\.key !== key/);
    const page = await readFile("app/[module]/page.tsx", "utf8"); assert.match(page, /<CostSynergyEstimateWorkspace \/>/); assert.doesNotMatch(page, /prepareCSEContext|calculateCSE|mock|fixture/);
    const response = POST(); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
    const numericLicense = request(); numericLicense.lines[0].source_kind = "license"; numericLicense.lines[0].action_reference = null; assert.equal(calculateCSE(numericLicense, context).status, "not_computable");
    assert.equal(network, 0); assert.equal(JSON.stringify({ base, session }), original); assert.deepEqual(session.derived_results, {});
  });
  // Optional isolated browser input; ignored temporary directory, never imported by production.
  if (process.env.AIVRA_CSE_BROWSER_FIXTURE === "1") { await mkdir(".temp/u03-02", { recursive: true }); await writeFile(".temp/u03-02/fixture.json", JSON.stringify({ context, session })); }
  console.log(`PASS: ${groups} U03.02 groups; fabricated offline contracts/SSR only, zero provider/network calls. Browser validation is a separate explicit command.`);
} finally { globalThis.fetch = beforeFetch; }
