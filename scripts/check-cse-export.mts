import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDemoSession, updateApplication, updateLicense, updateTSA, publishSessionApplications } from "../lib/session/session.ts";
import { buildALARequest } from "../lib/server/ala/request.ts";
import { inspectALAResult } from "../lib/server/ala/schema.ts";
import type { ALAResult } from "../lib/server/ala/schema.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { createReviewDraft, reviewIdentity, saveReviewOverride } from "../lib/ala/review-overrides.ts";
import { prepareCSEContext } from "../lib/server/cost-synergy/reviewed-context.ts";
import type { CSEContext, CSEResult } from "../lib/cost-synergy/calculation-contract.ts";
import { MAX_MINOR, MAX_CSE_BYTES, CSEResultSchema } from "../lib/cost-synergy/calculation-contract.ts";
import { calculateCSE } from "../lib/cost-synergy/calculation.ts";
import { buildEstimateRequest, createEstimateDraft, parseCADInput, verifyEditorDigest, MONEY_FIELDS } from "../lib/cost-synergy/estimate-form.ts";
import { captureEstimateExport, prepareCSEDownload, downloadCSEEstimate, revokeEstimateExport, CSEEstimateExportSchema, CSE_EXPORT_VERSION } from "../lib/cost-synergy/estimate-export.ts";
import type { CSEExportPermit, CSEExportFormat } from "../lib/cost-synergy/estimate-export.ts";
import type { EstimateDraft } from "../lib/cost-synergy/estimate-form.ts";
import type { DownloadPort } from "../lib/ala/review-export.ts";
import { parseCSVBytes } from "../lib/data-mapper/parse-csv.ts";
import { POST } from "../app/api/ai/ala/route.ts";

// Fabricated outcomes only; original validators/context composer, no model execution.
const session = createDemoSession();
const specimen: ALAResult = { findings: session.current_deal.applications.map((a, i) => ({ finding_id: `f_${i}`, domain: "Offline export test", relationship: "unique", buyer_app_ids: a.company_side === "buyer" ? [a.app_id] : [], target_app_ids: a.company_side === "target" ? [a.app_id] : [],
  actions: [{ action_id: i === 0 ? "-a_0" : `a_${i}`, subject: { app_id: a.app_id, side: a.company_side }, disposition: "Needs Review", destination: null, rationale: "Invented original recommendation, not a model invocation." }], rationale: "Fabricated outcome.", evidence: [{ app_id: a.app_id, attribute: "annual_cost" }], uncertainty: { level: "unknown", reason: "Fabricated evidence only." } })), not_evaluated: [] };
function setup(s = session, data = specimen, request_id = "4c453b2e-dde1-4f16-a6cf-75b5c0bd952f") {
  const built = buildALARequest(s), checked = inspectALAResult(data, s.current_deal.applications); assert.ok(built.ok && checked.ok);
  const outcome = { status: checked.coverage.status === "complete" ? "success" : "incomplete", source_token: built.source_token, coverage: checked.coverage, envelope: { module: "ala", request_id,
    input_digest: createHash("sha256").update(JSON.stringify({ input: built.request, references: { allow_empty: true, duplicates: "reject" } })).digest("hex"), model_provider: "fabricated-only", model_id: "offline-cse-export", mode: "fallback", routing_reason: "budget_exhausted", prompt_version: "ala/v1", generated_at: "2026-11-02T00:00:00Z", usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data } };
  const view = projectALAResults(outcome, s, s), review = createReviewDraft(view), context = prepareCSEContext(outcome, s, s, review); assert.ok(context); return { outcome, view, review, context };
}
const base = setup(), context = base.context;
function filled(c = context) { const d = createEstimateDraft(c); d.horizon = "1"; d.actions[0].included = true; for (const [i, field] of MONEY_FIELDS.entries()) d.actions[0][field] = { amount: ["100", "20", "30"][i], note: '=SUM(1,2), "évidence"\nFictional visitor note' }; return d; }
function request(d = filled(), c = context) { const r = buildEstimateRequest(c, d); assert.ok(r.ok, JSON.stringify(r)); return r.request; }
function calculated(d = filled(), c = context) { return calculateCSE(request(d, c), c); }
function permit(d = filled(), c = context) { const result = calculated(d, c), p = captureEstimateExport(result, c, d, true); assert.ok(p, JSON.stringify(result)); return p; }
function prepared(format: CSEExportFormat, d = filled(), c = context) { const result = prepareCSEDownload(permit(d, c), c, d, true, format); assert.ok(result.ok, JSON.stringify(result)); return result; }
function json(d = filled(), c = context) { const artifact = CSEEstimateExportSchema.parse(JSON.parse(prepared("json", d, c).content)); assert.notEqual(artifact.estimate.status, "invalid"); return artifact; }
const untouched = JSON.stringify({ base, session }); let groups = 0, attempts = 0; const beforeFetch = globalThis.fetch;
globalThis.fetch = async () => { attempts++; throw Error("Offline export checks forbid network"); };
async function check(name: string, fn: () => unknown | Promise<unknown>) { await fn(); groups++; console.log(`PASS: ${name}`); }
try {
  await check("versioned JSON preserves exact calculated result, originals/visitor overlays, identity, units and fallback provenance", () => {
    const d = filled(), a = json(d); assert.equal(a.contract_version, CSE_EXPORT_VERSION); assert.deepEqual(a.estimate, calculated(d)); assert.ok(a.illustrative_unapproved); assert.equal(a.estimate.status, "computed");
    const saved = saveReviewOverride(base.view, base.review, { result_identity: reviewIdentity(base.view), finding_id: "f_0", action_id: "-a_0", subject: specimen.findings[0].actions[0].subject, proposed_disposition: "Retire", proposed_destination: null, visitor_reason: "Invented visitor override" }); assert.ok(saved.ok);
    const c = prepareCSEContext(base.outcome, session, session, saved.draft)!; const result = json(filled(c), c).estimate; assert.ok(result.status !== "invalid"); assert.equal(result.context.reviewed!.effective_actions[0].original.disposition, "Needs Review"); assert.equal(result.context.reviewed!.effective_actions[0].effective.disposition, "Retire"); assert.equal(result.context.reviewed!.analysis.metadata.routing_reason, "budget_exhausted");
    assert.deepEqual(result.assumptions.expected_source, c.source); assert.equal(result.assumptions.expected_review_digest, c.review_digest); assert.equal(result.assumptions.lines.filter((l) => !l.included).length, 29);
    assert.equal(CSEEstimateExportSchema.safeParse({ ...a, secret: "not-allowed" }).success, false); assert.equal(CSEEstimateExportSchema.safeParse({ ...a, contract_version: "cse/estimate-export/v2" }).success, false);
    assert.ok(!prepared("json").content.includes('"tsa_services"')); assert.ok(!prepared("json").content.includes('"license_positions"'));
  });
  await check("1/3/5 years, once-only costs, edited components and negative net remain exact calculator output", () => {
    for (const year of [1, 3, 5]) { const d = filled(); d.horizon = String(year); const r = json(d).estimate; assert.ok(r.status !== "invalid"); assert.deepEqual(r.totals, { annual_recurring_savings_minor: 10000, migration_one_time_cost_minor: 2000, transition_overlap_cost_minor: 3000, one_time_total_minor: 5000, horizon_recurring_savings_minor: 10000 * year, illustrative_net_benefit_minor: 10000 * year - 5000, horizon_years: year }); }
    for (const field of MONEY_FIELDS) { const d = filled(), old = prepared("json", d); d.actions[0][field].amount = "0.00"; const next = json(d).estimate; assert.ok(next.status !== "invalid"); assert.equal(next.assumptions.lines[0][field]!.amount_minor, 0); assert.notEqual(JSON.stringify(next), old.content); }
    const d = filled(); d.actions[0].annual_run_rate.amount = "0"; const r = json(d).estimate; assert.ok(r.status !== "invalid"); assert.equal(r.totals.illustrative_net_benefit_minor, -5000);
    const csv = parseCSVBytes("negative.csv", new TextEncoder().encode(prepared("csv", d).content)); assert.ok(csv.ok); assert.equal(csv.rows[0][csv.headers.indexOf("illustrative_net_benefit_minor")], "-5000");
  });
  await check("dirty amounts/notes/inclusion/horizon and stale context reject previous permits without files", () => {
    const d = filled(), p = permit(d);
    for (const field of MONEY_FIELDS) for (const part of ["amount", "note"] as const) { const changed = structuredClone(d); changed.actions[0][field][part] += "1"; assert.equal(prepareCSEDownload(p, context, changed, true, "json").ok, false); }
    for (const change of [(x: EstimateDraft) => { x.horizon = "3"; }, (x: EstimateDraft) => { x.actions[0].included = false; }]) { const changed = structuredClone(d); change(changed); assert.equal(prepareCSEDownload(p, context, changed, true, "csv").ok, false); }
    assert.equal(prepareCSEDownload(p, context, d, false, "json").ok, false); assert.equal(prepareCSEDownload(null, context, d, true, "json").ok, false); assert.equal(prepareCSEDownload({} as CSEExportPermit, context, d, true, "json").ok, false);
    const foreign = setup(session, specimen, "e75a2d4a-c730-414c-8d30-e24576b0909c").context; assert.equal(prepareCSEDownload(p, foreign, filled(foreign), true, "json").ok, false);
    assert.equal(captureEstimateExport(calculated(), context, d, false), null);
    revokeEstimateExport(p); assert.equal(prepareCSEDownload(p, context, d, true, "json").ok, false, "Revoked permit cannot replay after restoring matching inputs");
  });
  await check("forged totals/lines/warnings/review/context never become captured calculated exports", () => {
    const original = calculated(); assert.ok(original.status !== "invalid");
    for (const change of [(r: typeof original) => { r.totals.illustrative_net_benefit_minor = 999; }, (r: typeof original) => { r.lines[0].annual.amount_minor = 999; }, (r: typeof original) => { r.context.source.source_digest = "0".repeat(64); }, (r: typeof original) => { r.warnings.push("missing_amount"); }, (r: typeof original) => { r.assumptions.lines[0].annual_run_rate!.basis_note = "Forged"; }]) { const r = structuredClone(original); change(r); assert.equal(captureEstimateExport(r, context, filled(), true), null); }
    const bad = { ...original, extra: true }; assert.equal(captureEstimateExport(bad, context, filled(), true), null);
  });
  await check("null/zero/horizon/incomplete coverage and source precision are explicit; invalid/not-computable fail closed", () => {
    const d = filled(); d.horizon = ""; d.actions[0].annual_run_rate = { amount: "", note: "" }; const r = json(d).estimate; assert.ok(r.status !== "invalid"); assert.equal(r.status, "incomplete"); assert.equal(r.totals.annual_recurring_savings_minor, null); assert.equal(r.totals.horizon_years, null); assert.equal(r.totals.one_time_total_minor, 5000);
    for (const cost of [null, 1.001]) { const s = structuredClone(session); s.current_deal.applications[0].annual_cost = cost; const c = setup(s).context, r = json(filled(c), c).estimate; assert.ok(r.status !== "invalid"); assert.equal(r.totals.illustrative_net_benefit_minor, null); assert.equal(r.totals.migration_one_time_cost_minor, 2000); }
    const partial = structuredClone(specimen); partial.findings.pop(); const skipped = partial.findings.pop()!; partial.not_evaluated.push({ ...skipped.actions[0].subject, reason: "Offline missing information" }); const c = setup(session, partial).context; const incomplete = json(filled(c), c).estimate; assert.ok(incomplete.status !== "invalid"); assert.equal(incomplete.status, "incomplete"); assert.equal(incomplete.context.reviewed!.counts.missing, 1); assert.equal(incomplete.context.reviewed!.counts.not_evaluated, 1);
    const empty = createEstimateDraft(context); assert.equal(captureEstimateExport(calculated(empty), context, empty, true), null);
    assert.equal(captureEstimateExport(calculateCSE({}, context), context, filled(), true), null);
    const overflow = filled(); overflow.horizon = "2"; overflow.actions[0].annual_run_rate.amount = "10000000000"; assert.equal(captureEstimateExport(calculated(overflow), context, overflow, true), null);
    for (const [raw, expected] of [["0", 0], ["0.00", 0], ["1.23", 123], ["10000000000.00", MAX_MINOR]] as const) assert.deepEqual(parseCADInput(raw), { ok: true, minor: expected });
    for (const raw of ["-1", "1e3", "1,000", "1.234", "10000000000.01"]) assert.equal(parseCADInput(raw).ok, false);
    const noNote = filled(); noNote.actions[0].annual_run_rate.note = ""; assert.equal(buildEstimateRequest(context, noNote).ok, false);
  });
  await check("shared app/attribution and included license claims withheld; disjoint and excluded claims unchanged", () => {
    const overlapping = structuredClone(specimen), extra = structuredClone(specimen.findings[0]); extra.finding_id = "extra"; extra.actions[0].action_id = "extra"; overlapping.findings.push(extra); const c = setup(session, overlapping).context, d = filled(c); d.actions.at(-1)!.included = true;
    for (const field of MONEY_FIELDS) d.actions.at(-1)![field] = { ...d.actions[0][field] };
    const r = calculated(d, c); assert.ok(r.status !== "invalid"); assert.equal(r.status, "not_computable"); assert.ok(r.conflicts.length); assert.equal(captureEstimateExport(r, c, d, true), null); d.actions.at(-1)!.included = false; assert.ok(permit(d, c));
    const disjoint = filled(); disjoint.actions[1] = { ...structuredClone(disjoint.actions[0]), line_id: disjoint.actions[1].line_id }; assert.equal(json(disjoint).estimate.status, "computed");
    for (const kind of ["license", "duplicate"] as const) { const input = request(disjoint); if (kind === "license") { input.lines[0].source_kind = "license"; input.lines[0].action_reference = null; } else input.lines[1].attribution_key = input.lines[0].attribution_key; const result = calculateCSE(input, context); assert.ok(result.status !== "invalid"); assert.equal(result.status, "not_computable"); assert.equal(captureEstimateExport(result, context, disjoint, true), null); }
  });
  await check("CSV is rectangular UTF-8 CRLF, quoted, formula-safe and lossless through structured ID/money/null cells", () => {
    const d = filled(); const csv = prepared("csv", d), jsonArtifact = json(d); assert.equal(csv.filename, "aivra-cse-estimate-v1.csv"); assert.equal(csv.mime, "text/csv;charset=utf-8"); assert.ok(csv.content.endsWith("\r\n"));
    const parsed = parseCSVBytes("estimate.csv", new TextEncoder().encode(csv.content)); assert.ok(parsed.ok, JSON.stringify(parsed)); const col = (name: string) => parsed.headers.indexOf(name);
    assert.equal(parsed.rows.length, 31); assert.ok(parsed.rows.every((r) => r.length === parsed.headers.length)); assert.equal(parsed.rows[1][col("line_id")], "'-a_0");
    assert.deepEqual(JSON.parse(parsed.rows[1][col("request_line_json")]), request(d).lines[0]); assert.deepEqual(JSON.parse(parsed.rows[0][col("context_json")]), context);
    assert.equal(JSON.parse(parsed.rows[1][col("request_line_json")]).annual_run_rate.basis_note, d.actions[0].annual_run_rate.note); assert.equal(parsed.rows[0][col("currency")], "CAD"); assert.equal(parsed.rows[0][col("money_unit")], "minor_units");
    assert.ok(parsed.rows[2][col("request_line_json")].includes('"included":false')); assert.deepEqual(JSON.parse(parsed.rows[0][col("disclosures_json")]), jsonArtifact.disclosures);
    d.horizon = ""; const incomplete = parseCSVBytes("unknown.csv", new TextEncoder().encode(prepared("csv", d).content)); assert.ok(incomplete.ok); assert.equal(incomplete.rows[0][col("illustrative_net_benefit_minor")], "null");
    assert.equal(prepared("json").filename, "aivra-cse-estimate-v1.json"); assert.equal(prepared("json").mime, "application/json;charset=utf-8");
  });
  await check("current app/license/source/review identity rejects replay; TSA-only digest remains current", async () => {
    const p = permit(), reordered = structuredClone(session); reordered.current_deal.license_positions.reverse();
    const publication = publishSessionApplications(session, "buyer", [...session.current_deal.applications.filter((a) => a.company_side === "buyer"), { ...session.current_deal.applications[0], app_id: "export-test-only" }], { session_id: session.session_id, session_revision: session.session_revision });
    for (const s of [updateApplication(session, session.current_deal.applications[0].app_id, { notes: "Changed" }), updateLicense(session, session.current_deal.license_positions[0].license_id, { notes: "Changed" }), reordered, publication, createDemoSession()]) { assert.equal(await verifyEditorDigest(context, s), false); const c = prepareCSEContext(base.outcome, session, s, base.review)!; assert.equal(prepareCSEDownload(p, c, filled(), true, "json").ok, false); }
    const tsa = updateTSA(session, session.current_deal.tsa_services[0].tsa_id, { title: "TSA only" }); assert.ok(await verifyEditorDigest(context, tsa)); assert.ok(prepareCSEDownload(p, context, filled(), true, "json").ok);
    const saved = saveReviewOverride(base.view, base.review, { result_identity: reviewIdentity(base.view), finding_id: "f_0", action_id: "-a_0", subject: specimen.findings[0].actions[0].subject, proposed_disposition: "Retain", proposed_destination: null, visitor_reason: "Changed visitor review" }); assert.ok(saved.ok); const c = prepareCSEContext(base.outcome, session, session, saved.draft)!; assert.equal(prepareCSEDownload(p, c, filled(c), true, "csv").ok, false);
  });
  await check("Blob download initiates exact bytes, cleans URLs on every failure, rejects before allocation", async () => {
    const d = filled(), p = permit(d); let blob: Blob | undefined, filename = "", clean: (() => void) | undefined, created = 0, revoked = 0, removed = 0, clicks = 0;
    const port: DownloadPort = { createURL(b) { blob = b; created++; return "blob:offline"; }, revokeURL() { revoked++; }, createAnchor() { return { href: "", get download() { return filename; }, set download(v) { filename = v; }, click() { clicks++; }, remove() { removed++; } }; }, appendAnchor() {}, deferCleanup(fn) { clean = fn; } };
    assert.ok(downloadCSEEstimate(p, context, d, true, "json", port).ok); assert.equal(filename, "aivra-cse-estimate-v1.json"); assert.equal(await blob!.text(), prepared("json", d).content); assert.equal(revoked, 0); clean!(); assert.equal(revoked, 1); assert.equal(clicks, 1); assert.equal(removed, 1);
    const changed = structuredClone(d); changed.horizon = "3"; assert.equal(downloadCSEEstimate(p, context, changed, true, "csv", port).ok, false); assert.equal(created, 1);
    for (const stage of ["createURL", "createAnchor", "appendAnchor", "deferCleanup"] as const) { const broken = { ...port, [stage]: () => { throw Error("private-canary"); } }; const result = downloadCSEEstimate(p, context, d, true, "csv", broken); assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes("private-canary")); }
    for (const stage of ["click", "remove"] as const) { const before = revoked, broken = { ...port, createAnchor() { return { ...port.createAnchor(), [stage]() { throw Error("private-canary"); } }; } }; assert.equal(downloadCSEEstimate(p, context, d, true, "csv", broken).ok, false); assert.equal(revoked, before + 1); }
  });
  await check("bounded serialization, unchanged public/security boundary and zero mutable/persistent/provider state", async () => {
    // Actual validated repeated finding membership expands captured evidence and CSV
    // quoting, without raising inference/derived caps or forging a trusted context.
    const s = structuredClone(session); s.current_deal.applications[0].app_name = '"'.repeat(2200);
    const large = structuredClone(specimen); large.findings[0].evidence[0].attribute = "app_name";
    for (let i = 0; i < 70; i++) { const f = structuredClone(large.findings[0]); f.finding_id = `extra_${i}`; f.actions[0].action_id = `extra_${i}`; large.findings.push(f); }
    const c = setup(s, large).context, d = filled(c); for (const action of d.actions) for (const field of MONEY_FIELDS) action[field] = { amount: "0", note: '"'.repeat(400) };
    const p = permit(d, c), small = prepareCSEDownload(p, c, d, true, "json"), oversized = prepareCSEDownload(p, c, d, true, "csv"); assert.ok(small.ok); assert.equal(oversized.ok, false); if (!oversized.ok) assert.equal(oversized.code, "export_too_large");
    assert.ok(!("content" in oversized)); assert.ok(new TextEncoder().encode(small.content).length <= MAX_CSE_BYTES);
    let allocations = 0; const blocked = new Proxy({} as DownloadPort, { get() { allocations++; throw Error("No allocation allowed"); } }); assert.equal(downloadCSEEstimate(p, c, d, true, "csv", blocked).ok, false); assert.equal(allocations, 0);
    assert.equal(prepareCSEDownload(permit(), context, filled(), true, "pdf" as CSEExportFormat).ok, false);
    const ui = await readFile("components/cost-synergy/estimate-workspace.ts", "utf8"), code = await readFile("lib/cost-synergy/estimate-export.ts", "utf8");
    assert.match(ui, /!dirty && exportPermit && exportAuthorized/); assert.match(ui, /setExportPermit\(null\)/); assert.match(ui, /exportAuthorized = false/);
    assert.doesNotMatch(code, /fetch\(|sessionStorage|localStorage|process\.env|node:|server-only|Math\.round/);
    assert.equal(POST().status, 503); assert.equal(POST().headers.get("cache-control"), "no-store"); assert.equal(JSON.stringify({ base, session }), untouched); assert.equal(attempts, 0); assert.equal(MAX_CSE_BYTES, 1500000);
  });
  console.log(`PASS: ${groups} U03.03 groups; JSON/CSV fidelity, unchanged arithmetic and fail-closed lifecycle; zero provider/network attempts.`);
} finally { globalThis.fetch = beforeFetch; }
