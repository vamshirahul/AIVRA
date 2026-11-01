import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildReviewedExport, consumeReviewedExport, downloadReviewedResults, MAX_EXPORT_BYTES, prepareReviewedDownload, readReviewedExport, ReviewedALAExportSchema, REVIEW_EXPORT_VERSION } from "../lib/ala/review-export.ts";
import type { DownloadPort } from "../lib/ala/review-export.ts";
import { createReviewDraft, effectiveReviewActions, restoreAIRecommendation, reviewIdentity, saveReviewOverride } from "../lib/ala/review-overrides.ts";
import { buildALARequest } from "../lib/server/ala/request.ts";
import { inspectALAResult } from "../lib/server/ala/schema.ts";
import type { ALAResult } from "../lib/server/ala/schema.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import type { ALAResultsView } from "../lib/ala/results-view.ts";
import { createDemoSession, updateApplication, updateLicense } from "../lib/session/session.ts";
import { parseCSVBytes } from "../lib/data-mapper/parse-csv.ts";
import { POST } from "../app/api/ai/ala/route.ts";

// Fabricated structured testing specimens ONLY, not provider execution or approved models.
const session = createDemoSession("2026-11-01T06:00:00Z"), apps = session.current_deal.applications;
const [b0, b1] = apps.filter((a) => a.company_side === "buyer"), [t0, t1] = apps.filter((a) => a.company_side === "target");
const ref = (app: typeof b0) => ({ app_id: app.app_id, side: app.company_side });
function specimen(): ALAResult {
  const finding = (id: string, members: typeof apps, relationship: "unique" | "functional_overlap" | "potentially_related"): ALAResult["findings"][number] => ({
    finding_id: id, domain: "Fabricated test domain", relationship, buyer_app_ids: members.filter((a) => a.company_side === "buyer").map((a) => a.app_id), target_app_ids: members.filter((a) => a.company_side === "target").map((a) => a.app_id),
    actions: members.map((app, i) => ({ action_id: `${id}_${i}`, subject: ref(app), disposition: "Needs Review", destination: null, rationale: `Fabricated original ${id}_${i}.` })),
    rationale: `Fabricated finding ${id}.`, evidence: members.flatMap((a) => (["notes", "annual_cost", "vendor"] as const).map((attribute) => ({ app_id: a.app_id, attribute }))),
    uncertainty: { level: "unknown", reason: "Fabricated structural test only." } });
  const data: ALAResult = { findings: apps.map((app, i) => finding(`single_${i}`, [app], "unique")), not_evaluated: [] };
  const oneMany = finding("one_many", [b0, t0, t1], "functional_overlap"); oneMany.actions[0].disposition = "Retain";
  oneMany.actions[1] = { ...oneMany.actions[1], disposition: "Migrate", destination: ref(b0) };
  oneMany.actions[2] = { ...oneMany.actions[2], disposition: "Integrate", destination: ref(b0) };
  const manyOne = finding("many_one", [b0, b1, t0], "potentially_related"); manyOne.actions[1].disposition = "Retire";
  data.findings.push(oneMany, manyOne); return data;
}
function makeView(data = specimen(), captured = session, current = captured, mode: "paid" | "fallback" = "paid"): ALAResultsView {
  const built = buildALARequest(captured), inspected = inspectALAResult(data, captured.current_deal.applications); assert.ok(built.ok && inspected.ok);
  return projectALAResults({ status: inspected.coverage.status === "complete" ? "success" : "incomplete", coverage: inspected.coverage, source_token: built.source_token,
    envelope: { module: "ala", request_id: "e1ec2e05-2517-467e-a356-5306bab01110", input_digest: createHash("sha256").update(JSON.stringify({ input: built.request, references: { allow_empty: true, duplicates: "reject" } })).digest("hex"),
      model_provider: "fabricated-export-test", model_id: "invented-export/v1", mode, ...(mode === "fallback" ? { routing_reason: "budget_exhausted" } : {}), prompt_version: "ala/v1", generated_at: "2026-11-01T06:00:00Z",
      usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data } }, captured, current);
}
const view = makeView(), draft = createReviewDraft(view)!; assert.ok("data" in view);
function edit(current = view, reason = "Fabricated visitor justification.") {
  assert.ok("data" in current); return { result_identity: reviewIdentity(current)!, finding_id: "single_0", action_id: "single_0_0", subject: ref(b0), proposed_disposition: "Retain", proposed_destination: null, visitor_reason: reason } as const;
}
function artifact(current = view, review: unknown = createReviewDraft(current)) { const result = buildReviewedExport(current, review); assert.ok(result.ok, JSON.stringify(result)); return result.artifact; }
const before = JSON.stringify({ view, draft, session }), saved = saveReviewOverride(view, draft, edit()); assert.ok(saved.ok);
function rejected(input: unknown) { const result = readReviewedExport(input); assert.equal(result.ok, false); assert.ok(!("artifact" in result)); }
let groups = 0, attempts = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); groups++; console.log(`PASS: ${name}`); }
const originalFetch = globalThis.fetch; globalThis.fetch = async () => { attempts++; throw Error("Offline export tests forbid network"); };
try {
  await check("canonical version/full originals: empty and visitor drafts, all original occurrences/order and effective origin", () => {
    const a = artifact(), changed = artifact(view, saved.draft); assert.equal(a.contract_version, REVIEW_EXPORT_VERSION); assert.equal(a.status, "exported_unapproved");
    assert.deepEqual(a.analysis, view.data); assert.equal(a.counts.original_action_rows, 36); assert.equal(a.effective_actions.length, 36); assert.equal(a.counts.visitor_overrides, 0);
    assert.deepEqual(a.effective_actions.map((r) => [r.finding_id, r.action_id]), view.data.findings.flatMap((f) => f.actions.map((action) => [f.finding_id, action.action_id])));
    assert.equal(a.effective_actions.filter((r) => r.subject.app_id === b0.app_id).length, 3);
    assert.equal(changed.effective_actions[0].original.disposition, "Needs Review"); assert.equal(changed.effective_actions[0].effective.disposition, "Retain"); assert.equal(changed.effective_actions[0].origin, "visitor_override");
    assert.equal(changed.effective_actions[0].visitor_reason, edit().visitor_reason); assert.deepEqual(changed.analysis, a.analysis); assert.equal(changed.counts.visitor_overrides, 1);
    assert.ok(a.disclaimers.every((s) => s.length)); assert.ok(Object.isFrozen(changed.effective_actions[0]));
  });
  await check("all dispositions/destinations/reason bounds and conflicting or stale drafts reuse review validation", () => {
    const dispositions = new Set(artifact().effective_actions.map((r) => r.original.disposition)); assert.equal(dispositions.size, 5);
    for (const bad of [{ ...saved.draft, overrides: [...saved.draft.overrides, ...saved.draft.overrides] }, { ...saved.draft, result_identity: { ...saved.draft.result_identity, source_revision: 99 } },
      { ...saved.draft, overrides: [{ ...saved.draft.overrides[0], proposed_disposition: "Migrate", proposed_destination: null }] },
      { ...saved.draft, overrides: [{ ...saved.draft.overrides[0], visitor_reason: " " }] }, { ...saved.draft, overrides: [{ ...saved.draft.overrides[0], visitor_reason: "x".repeat(401) }] }]) assert.equal(buildReviewedExport(view, bad).ok, false);
    const reason400 = saveReviewOverride(view, draft, edit(view, "x".repeat(400))); assert.ok(reason400.ok); assert.equal(artifact(view, reason400.draft).effective_actions[0].visitor_reason!.length, 400);
    const restored = restoreAIRecommendation(view, saved.draft, { result_identity: reviewIdentity(view)!, finding_id: "single_0", action_id: "single_0_0", subject: ref(b0) }); assert.ok(restored.ok); assert.equal(artifact(view, restored.draft).counts.visitor_overrides, 0);
  });
  await check("incomplete and zero-action exports retain source-order missing/unevaluated IDs/reasons without filling", () => {
    const data = specimen(); const omitted = data.findings.splice(29, 1)[0], unevaluated = data.findings.splice(28, 1)[0];
    data.not_evaluated = [{ ...unevaluated.actions[0].subject, reason: "Fabricated unassessed reason." }];
    const incomplete = artifact(makeView(data)); assert.equal(incomplete.analysis.coverage.status, "incomplete"); assert.equal(incomplete.counts.missing, 1); assert.equal(incomplete.counts.not_evaluated, 1);
    assert.equal(incomplete.analysis.missing[0].app_id, omitted.actions[0].subject.app_id); assert.deepEqual(incomplete.analysis.not_evaluated, data.not_evaluated);
    const emptyView = makeView({ findings: [], not_evaluated: [] }), empty = artifact(emptyView); assert.equal(empty.counts.original_action_rows, 0); assert.equal(empty.analysis.coverage.status, "incomplete"); assert.equal(empty.analysis.missing.length, 30);
    const csv = prepareReviewedDownload(emptyView, createReviewDraft(emptyView), "csv"); assert.ok(csv.ok); const parsed = parseCSVBytes("empty.csv", new TextEncoder().encode(csv.content)); assert.ok(parsed.ok); assert.equal(parsed.rows.length, 1);
  });
  await check("strict reader rejects versions, extras, duplicate/conflicting/foreign references, evidence and coverage/provenance/count spoofing", () => {
    const mutations: ((a: any) => void)[] = [(a) => { a.contract_version = "ala/review-export/v2"; }, (a) => { a.secret = "private-canary"; },
      (a) => { a.analysis.provenance.model_override = "private-canary"; }, (a) => { a.analysis.metadata.mode = "free"; }, (a) => { a.analysis.metadata.routing_reason = "paid_unavailable"; },
      (a) => { a.analysis.provenance.generated_at = "yesterday"; }, (a) => { a.analysis.provenance.input_digest = "invalid"; }, (a) => { a.effective_actions[0].effective.disposition = "Retire"; },
      (a) => { a.counts.original_action_rows--; }, (a) => { a.analysis.coverage.buyer.accounted_count--; }, (a) => { a.analysis.coverage.status = "incomplete"; },
      (a) => { a.analysis.findings[0].source_evidence[0].attribute = "api_key"; }, (a) => { a.analysis.findings[0].source_evidence[0].app_id = "foreign"; },
      (a) => { a.analysis.findings[0].actions[0].subject.side = "target"; }, (a) => { a.analysis.findings[0].actions[0].destination = ref(b1); },
      (a) => { a.analysis.findings[0].actions.push(a.analysis.findings[0].actions[0]); }, (a) => { a.analysis.findings[0].buyer[0].name = "Mismatched repeated name"; },
      (a) => { a.effective_actions[0].origin = "approved"; }, (a) => { a.review.overrides[0].subject.app_id = "unknown"; }];
    for (const mutate of mutations) { const value = structuredClone(artifact(view, saved.draft)); mutate(value); rejected(value); }
    rejected("{"); rejected(null); rejected(" ".repeat(MAX_EXPORT_BYTES + 1));
    const normalized = structuredClone(artifact());
    for (const finding of normalized.analysis.findings) for (const member of finding.buyer) if (member.app_id === b0.app_id) member.name = ` ${member.name} `;
    assert.equal(ReviewedALAExportSchema.safeParse(normalized).success, false, "The exported schema itself must reject normalization, not only the reader");
    const badView = structuredClone(view) as any; badView.data.extra = true; assert.equal(buildReviewedExport(badView, draft).ok, false);
    const tooLarge = structuredClone(view) as any; tooLarge.data.findings[0].buyer[0].name = "x".repeat(MAX_EXPORT_BYTES); assert.equal(buildReviewedExport(tooLarge, draft).ok, false);
  });
  await check("source/currentness gating and deterministic JSON round trip/effective-only consumption with original access", () => {
    for (const state of ["absent", "invalid", "outdated"] as const) assert.equal(buildReviewedExport({ state }, draft).ok, false);
    const changed = updateApplication(session, b0.app_id, { notes: "Edited source" }); assert.equal(buildReviewedExport(makeView(specimen(), session, changed), draft).ok, false);
    assert.equal(buildReviewedExport(makeView(specimen(), session, createDemoSession()), draft).ok, false);
    const license = updateLicense(session, session.current_deal.license_positions[0].license_id, { notes: "Unrelated license" }); assert.equal(buildReviewedExport(makeView(specimen(), session, license), draft).ok, true);
    const one = prepareReviewedDownload(view, saved.draft, "json"), two = prepareReviewedDownload(view, saved.draft, "json"); assert.ok(one.ok && two.ok); assert.equal(one.content, two.content);
    const read = readReviewedExport(one.content), consumed = consumeReviewedExport(one.content); assert.ok(read.ok && consumed.ok); assert.deepEqual(read.artifact, artifact(view, saved.draft));
    assert.equal(consumed.data.actions[0].effective.disposition, "Retain"); assert.equal(consumed.data.actions[0].original.disposition, "Needs Review"); assert.equal(consumed.data.coverage.status, "complete"); assert.deepEqual(consumed.data.original_analysis, view.data);
    const fallback = artifact(makeView(specimen(), session, session, "fallback")); assert.equal(fallback.analysis.metadata.routing_reason, "budget_exhausted");
  });
  await check("CSV rectangular RFC4180 quoting, embedded comma/quote/newline, formula-neutralized text, null/zero and metadata", () => {
    const source = updateApplication(session, b0.app_id, { notes: '=SUM(1,2)\n"Quoted"', annual_cost: 0, vendor: null });
    const current = makeView(specimen(), source), overridden = saveReviewOverride(current, createReviewDraft(current), edit(current, " =HYPERLINK(\"test\")\nVisitor text")); assert.ok(overridden.ok);
    const json = prepareReviewedDownload(current, overridden.draft, "json"), csv = prepareReviewedDownload(current, overridden.draft, "csv"); assert.ok(json.ok && csv.ok);
    const parsed = parseCSVBytes("review.csv", new TextEncoder().encode(csv.content)); assert.ok(parsed.ok); assert.equal(parsed.rows.length, 37); assert.ok(parsed.rows.every((row) => row.length === parsed.headers.length));
    const get = (row: number, field: string) => parsed.rows[row][parsed.headers.indexOf(field)];
    assert.equal(get(0, "record_type"), "analysis"); assert.match(get(0, "metadata_json"), /fabricated-export-test/); assert.match(get(0, "coverage_json"), /complete/);
    assert.ok(get(1, "visitor_reason").startsWith("' =HYPERLINK")); assert.ok(JSON.parse(json.content).effective_actions[0].visitor_reason.startsWith(" =HYPERLINK"));
    const captured = JSON.parse(get(1, "source_evidence_json")); assert.deepEqual(captured.map((p: any) => p.value), ['=SUM(1,2)\n"Quoted"', 0, null]);
    assert.deepEqual(get(1, "subject_app_id"), b0.app_id); assert.match(csv.content, /\r\n$/); assert.equal(prepareReviewedDownload(current, overridden.draft, "xml" as never).ok, false);
    const largeSource = updateApplication(session, b0.app_id, { notes: "x".repeat(500) });
    const first = specimen().findings[30];
    const dense: ALAResult = { findings: [{ ...first, finding_id: "dense", buyer_app_ids: apps.filter((a) => a.company_side === "buyer").map((a) => a.app_id), target_app_ids: apps.filter((a) => a.company_side === "target").map((a) => a.app_id),
      actions: [...apps.map((app, i) => ({ action_id: `retain_${i}`, subject: ref(app), disposition: "Retain" as const, destination: null, rationale: "Fabricated size test." })),
        ...apps.filter((app) => app.app_id !== b0.app_id).map((app, i) => ({ action_id: `connect_${i}`, subject: ref(b0), disposition: "Integrate" as const, destination: ref(app), rationale: "Fabricated size test." }))],
      evidence: Array.from({ length: 100 }, () => ({ app_id: b0.app_id, attribute: "notes" as const })) }], not_evaluated: [] };
    const largeView = makeView(dense, largeSource), largeDraft = createReviewDraft(largeView);
    assert.equal(prepareReviewedDownload(largeView, largeDraft, "json").ok, true);
    const tooLargeCSV = prepareReviewedDownload(largeView, largeDraft, "csv"); assert.ok(!tooLargeCSV.ok && tooLargeCSV.code === "export_too_large"); assert.ok(!("content" in tooLargeCSV));
  });
  await check("controlled browser download: latest draft, Blob MIME/name, deferred URL cleanup and error cleanup/no partial output", async () => {
    for (const format of ["json", "csv"] as const) {
      let captured!: Blob, clicked = 0, revoked = 0, removed = 0, pending!: () => void;
      const anchor = { href: "", download: "", click() { clicked++; }, remove() { removed++; } };
      const port: DownloadPort = { createURL: (blob) => { captured = blob; return "blob:test"; }, revokeURL: (url) => { assert.equal(url, "blob:test"); revoked++; }, createAnchor: () => anchor, appendAnchor: () => {}, deferCleanup: (cleanup) => { pending = cleanup; } };
      assert.deepEqual(downloadReviewedResults(view, saved.draft, format, port), { ok: true, status: "initiated" }); assert.equal(clicked, 1); assert.equal(removed, 1); assert.equal(revoked, 0); pending(); assert.equal(revoked, 1);
      assert.equal(anchor.download, `aivra-ala-reviewed-draft.${format}`); assert.ok(captured.type.startsWith(format === "json" ? "application/json" : "text/csv"));
      if (format === "json") assert.equal(JSON.parse(await captured.text()).counts.visitor_overrides, 1);
      clicked = 0; const failed = downloadReviewedResults(view, saved.draft, format, { ...port, createAnchor: () => ({ ...anchor, click() { throw Error("private-canary"); } }) }); assert.equal(failed.ok, false); assert.ok(!JSON.stringify(failed).includes("private-canary")); assert.equal(revoked, 2);
      const denied = downloadReviewedResults({ state: "absent" }, draft, format, { ...port, createURL: () => { throw Error("must not allocate"); } }); assert.equal(denied.ok, false);
      for (const failurePoint of ["anchor", "append", "defer", "remove"] as const) {
        const revokedBefore = revoked;
        const broken = { ...port,
          createAnchor: () => { if (failurePoint === "anchor") throw Error("private-canary"); return { ...anchor, remove() { removed++; if (failurePoint === "remove") throw Error("private-canary"); } }; },
          appendAnchor: () => { if (failurePoint === "append") throw Error("private-canary"); },
          deferCleanup: (cleanup: () => void) => { if (failurePoint === "defer") throw Error("private-canary"); cleanup(); } };
        const failure = downloadReviewedResults(view, saved.draft, format, broken); assert.equal(failure.ok, false); assert.equal(revoked, revokedBefore + 1);
      }
    }
  });
  await check("SSR native download labels only for populated review; public absence, fixed API and no state/provider/import integration", async () => {
    const code = `import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ALAReviewWorkspace} from './components/ala/ala-review-workspace.ts';globalThis.fetch=()=>{throw Error('Network forbidden')};let s='';for await(const c of process.stdin)s+=c;process.stdout.write(renderToStaticMarkup(createElement(ALAReviewWorkspace,{view:JSON.parse(s)})));`;
    for (const candidate of [view, { state: "absent" }, { state: "invalid" }, { state: "outdated" }]) {
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { input: JSON.stringify(candidate), encoding: "utf8", timeout: 10000 }); assert.equal(child.status, 0, child.stderr);
      if (candidate.state === "current") { assert.match(child.stdout, />Download reviewed results \(JSON\)<\/button>/); assert.match(child.stdout, />Download reviewed results \(CSV\)<\/button>/); assert.match(child.stdout, /unsaved form edits are excluded/); }
      else assert.doesNotMatch(child.stdout, /Download reviewed results|<button/);
    }
    let reads = 0; const response = (POST as (...args: unknown[]) => Response)(new Proxy({}, { get() { reads++; throw Error("read"); } })); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(reads, 0);
    const source = await readFile("lib/ala/review-export.ts", "utf8"); assert.doesNotMatch(source, /server-only|server\/ai|server\/ala|fetch\(|sessionStorage|localStorage|indexedDB|recordDerivedResultMetadata|process\.env|dangerouslySetInnerHTML/);
    const ui = await readFile("components/ala/ala-review-workspace.ts", "utf8"); assert.match(ui, /downloadReviewedResults\(view, latest\.current, format\)/); assert.match(ui, /Download initiated/); assert.match(ui, /file saving is not confirmed/); assert.match(ui, /role: "alert"/);
    const publicUI = await readFile("components/ala/analyze-applications.tsx", "utf8"); assert.match(publicUI, /ALAReviewWorkspace view=\{\{ state: "absent" \}\}/);
    assert.equal(ReviewedALAExportSchema.safeParse(artifact()).success, true); assert.equal(JSON.stringify({ view, draft, session }), before); assert.equal(attempts, 0);
  });
  console.log(`PASS: ${groups} U02.05 groups; JSON/CSV, validated effective consumption, original preservation and controlled download cleanup; zero provider/network attempts. No public populated export UAT claimed.`);
} finally { globalThis.fetch = originalFetch; }
