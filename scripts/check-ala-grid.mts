import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { buildALARequest } from "../lib/server/ala/request.ts";
import { ALAAnalyzeOutcomeSchema } from "../lib/server/ala/analyze.ts";
import { ALAResultSchema, inspectALAResult } from "../lib/server/ala/schema.ts";
import type { ALAResult } from "../lib/server/ala/schema.ts";
import type { ALAResultsView } from "../lib/ala/results-view.ts";
import { createDemoSession, updateApplication, updateLicense, publishSessionApplications } from "../lib/session/session.ts";
import type { DemoSession } from "../lib/session/session.ts";
import { POST } from "../app/api/ai/ala/route.ts";

const session = createDemoSession("2026-11-01T03:00:00Z");
const apps = session.current_deal.applications, buyers = apps.filter((a) => a.company_side === "buyer"), targets = apps.filter((a) => a.company_side === "target");
type Finding = ALAResult["findings"][number];
// Fabricated test structures, NOT a local recommendation engine or provider execution.
function finding(id: string, buyer: string[], target: string[], relationship: Finding["relationship"] = "functional_overlap"): Finding {
  return { finding_id: id, domain: "Invented offline domain", relationship, buyer_app_ids: buyer, target_app_ids: target,
    actions: [...buyer.map((app_id) => ({ app_id, side: "buyer" as const })), ...target.map((app_id) => ({ app_id, side: "target" as const }))].map((subject, index) => ({
      action_id: `${id}_a${index}`, subject, disposition: "Needs Review", destination: null, rationale: `Invented action rationale ${id}_${index}.` })),
    rationale: `Invented finding rationale ${id}.`, evidence: [...buyer, ...target].map((app_id) => ({ app_id, attribute: "function" })),
    uncertainty: { level: "unknown", reason: `Invented uncertainty ${id}.` } };
}
function complete(): ALAResult {
  const data: ALAResult = { findings: buyers.map((buyer, i) => finding(`pair_${i}`, [buyer.app_id], [targets[i].app_id])), not_evaluated: [] };
  data.findings[0].actions[0].disposition = "Retain";
  data.findings[0].actions[1] = { ...data.findings[0].actions[1], disposition: "Migrate", destination: { app_id: buyers[0].app_id, side: "buyer" } };
  return data;
}
function mock(data = complete(), source = session, mode: "paid" | "fallback" = "paid") {
  const built = buildALARequest(source); assert.ok(built.ok);
  const checked = inspectALAResult(data, source.current_deal.applications); assert.ok(checked.ok);
  const envelope = { module: "ala", request_id: "16f75d43-d1ce-4c5b-b6a8-9c704da82151", input_digest: createHash("sha256").update(JSON.stringify({ input: built.request, references: { allow_empty: true, duplicates: "reject" } })).digest("hex"),
    model_provider: "invented-offline-provider", model_id: mode === "paid" ? "invented-paid/v1" : "invented-open-weight/v1", mode,
    ...(mode === "fallback" ? { routing_reason: "budget_exhausted" } : {}), prompt_version: "ala/v1", generated_at: "2026-11-01T03:00:00Z",
    usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data };
  return ALAAnalyzeOutcomeSchema.parse({ status: checked.coverage.status === "complete" ? "success" : "incomplete", envelope, coverage: checked.coverage, source_token: built.source_token });
}
// Ordinary React SSR in a separate process: react-server condition is for projection only.
// No fixture route/server/test flag is added to the application.
const renderScript = `import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
 import {ALAResultsGrid} from './components/ala/ala-results-grid.ts';
 globalThis.fetch=()=>{throw Error('Renderer network forbidden')};
 let input=''; for await(const chunk of process.stdin) input+=chunk;
 process.stdout.write(renderToStaticMarkup(createElement(ALAResultsGrid,{view:JSON.parse(input)})));`;
function html(view: ALAResultsView) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", renderScript], { input: JSON.stringify(view), encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0, child.stderr); return child.stdout;
}
function populated(view: ALAResultsView) { assert.ok("data" in view); return view.data; }
function rejected(value: unknown, captured: unknown = session, current: unknown = session) {
  const view = projectALAResults(value, captured, current); assert.equal(view.state, "invalid"); assert.ok(!("data" in view));
  const rendered = html(view); assert.match(rendered, /No valid AI result/); assert.doesNotMatch(rendered, /<table|Provider:|Invented|private-canary/);
}
let groups = 0, attempts = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); groups++; console.log(`PASS: ${name}`); }
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => { attempts++; throw new Error("U02.03 offline tests forbid network"); };
try {
  await check("complete 1:1: exact IDs/actions/destination, rationale, evidence, uncertainty, immutable bounded projection", () => {
    const input = mock(), before = JSON.stringify({ input, session });
    const view = projectALAResults(input, session, session), data = populated(view), rendered = html(view);
    assert.equal(view.state, "current"); assert.equal(data.findings.length, 15);
    for (const app of apps) assert.ok(rendered.includes(app.app_id));
    for (const finding of complete().findings) {
      assert.ok(rendered.includes(finding.finding_id)); assert.ok(rendered.includes(finding.rationale));
      for (const action of finding.actions) { assert.ok(rendered.includes(action.action_id)); assert.ok(rendered.includes(action.rationale)); }
    }
    assert.match(rendered, /Migrate/); assert.match(rendered, new RegExp(`Destination: Buyer ${buyers[0].app_id}`));
    assert.match(rendered, /AI-generated draft/); assert.match(rendered, /Complete source coverage/); assert.match(rendered, /not a calibrated probability/);
    assert.ok(Object.isFrozen(data) && Object.isFrozen(data.findings[0].actions));
    assert.throws(() => { (data.findings as unknown[]).push({}); });
    assert.equal(JSON.stringify({ input, session }), before); assert.ok(!JSON.stringify(data).includes("license_positions"));
  });
  await check("1:N, N:1, related/unique/uncertain and repeated cross-finding memberships retain stable identity", () => {
    const data = complete();
    data.findings.push(finding("one_many", [buyers[0].app_id], [targets[0].app_id, targets[1].app_id]),
      finding("many_one", [buyers[0].app_id, buyers[1].app_id], [targets[0].app_id], "potentially_related"),
      finding("unique", [buyers[0].app_id], [], "unique"), finding("uncertain", [], [targets[0].app_id], "uncertain"));
    const multi = data.findings.find((f) => f.finding_id === "one_many")!;
    multi.actions[0].disposition = "Retain";
    multi.actions[1] = { ...multi.actions[1], disposition: "Integrate", destination: { app_id: buyers[0].app_id, side: "buyer" } };
    multi.actions[2].disposition = "Retire";
    const view = projectALAResults(mock(data), session, session), projected = populated(view), rendered = html(view);
    assert.equal(view.state, "current"); assert.deepEqual(projected.findings.map((f) => f.finding_id), data.findings.map((f) => f.finding_id));
    assert.deepEqual(projected.findings.flatMap((f) => f.actions.map((a) => a.action_id)), data.findings.flatMap((f) => f.actions.map((a) => a.action_id)));
    assert.equal(projected.findings.filter((f) => f.buyer.some((a) => a.app_id === buyers[0].app_id)).length, 4);
    for (const label of ["Functional overlap", "Potentially related", "Unique", "Uncertain", "Integrate", "Retire", "None / Not applicable"]) assert.ok(rendered.includes(label));
  });
  await check("incomplete and zero findings: missing/unevaluated source-order IDs, exact reason, no manufactured actions", () => {
    const data = complete(); data.findings.splice(0, 2);
    data.not_evaluated = [{ app_id: targets[1].app_id, side: "target", reason: "Invented not-evaluated reason." }, { app_id: buyers[1].app_id, side: "buyer", reason: "Other invented reason." }];
    const view = projectALAResults(mock(data), session, session), projected = populated(view), rendered = html(view);
    assert.equal(view.state, "incomplete"); assert.deepEqual(projected.missing.map((a) => a.app_id), apps.filter((a) => [buyers[0].app_id, targets[0].app_id].includes(a.app_id)).map((a) => a.app_id));
    assert.deepEqual(projected.not_evaluated.map((a) => a.app_id), apps.filter((a) => [buyers[1].app_id, targets[1].app_id].includes(a.app_id)).map((a) => a.app_id));
    assert.equal(projected.coverage.buyer.accounted_count, 14); assert.equal(projected.findings.flatMap((f) => f.actions).length, 26);
    assert.match(rendered, /Incomplete analysis/); assert.match(rendered, /No AI finding returned/); assert.match(rendered, /Invented not-evaluated reason/);
    const empty = html(projectALAResults(mock({ findings: [], not_evaluated: [] }), session, session)); assert.match(empty, /No AI findings returned/); assert.match(empty, /<dd>0<\/dd>/);
  });
  await check("captured evidence: zero/null/case and exact names/notes; XSS strings escaped as inert visible text", () => {
    const source = updateApplication(session, buyers[0].app_id, { annual_cost: 0, vendor: null, app_name: 'MiXeD <img src=x onerror="private-canary">', notes: '<script>private-canary</script> & Keep CASE' });
    const data = complete(), first = data.findings[0]; first.rationale = '<script>private-canary</script> & rationale';
    first.evidence = ["annual_cost", "vendor", "app_name", "notes"].map((attribute) => ({ app_id: buyers[0].app_id, attribute: attribute as "notes" }));
    const view = projectALAResults(mock(data, source), source, source), projected = populated(view), rendered = html(view);
    assert.deepEqual(projected.findings[0].source_evidence.map((e) => e.value), [0, null, source.current_deal.applications.find((a) => a.app_id === buyers[0].app_id)!.app_name, '<script>private-canary</script> & Keep CASE']);
    assert.ok(rendered.includes(`Annual cost (${source.current_deal.currency})`)); assert.match(rendered, /<p>0<\/p>/); assert.match(rendered, /Unknown/); assert.match(rendered, /&lt;script&gt;private-canary/); assert.match(rendered, /MiXeD &lt;img/);
    assert.doesNotMatch(rendered, /<script|<img|<a\b|<iframe|<button|<input|<select|<textarea/);
    const stale = projectALAResults(mock(data, source), source, updateApplication(source, buyers[0].app_id, { notes: "New source must never appear" }));
    assert.equal(stale.state, "outdated"); assert.doesNotMatch(html(stale), /New source|private-canary|<table|Provider:/);
    const unnormalized = structuredClone(source); unnormalized.current_deal.applications[0].app_name = " Needs trimming "; rejected(mock(), unnormalized);
  });
  await check("paid/fallback provenance is exact envelope data; no client override or execution-attestation claim", () => {
    for (const mode of ["paid", "fallback"] as const) {
      const input = mock(complete(), session, mode), projected = populated(projectALAResults(input, session, session)), rendered = html({ state: "current", data: projected });
      assert.equal(projected.metadata.model_id, input.status !== "error" && input.envelope.model_id);
      assert.match(rendered, /invented-offline-provider/); assert.match(rendered, /ala\/v1/); assert.match(rendered, /2026-11-01T03:00:00Z/);
      assert.match(rendered, /16f75d43-d1ce-4c5b-b6a8-9c704da82151/); assert.match(rendered, /Input digest/);
      if (mode === "fallback") { assert.match(rendered, /Open-weight AI fallback/); assert.match(rendered, /budget_exhausted/); }
      else assert.match(rendered, /Paid model/);
      assert.doesNotMatch(rendered, /cost_usd|input_tokens|calibrated confidence|approved model/);
    }
  });
  await check("source currentness: edit/publication/reset/digest change suppress rows; license-only change stays current", () => {
    const result = mock();
    const changed = updateApplication(session, buyers[0].app_id, { notes: "Edited source" });
    const published = publishSessionApplications(session, "buyer", changed.current_deal.applications.filter((a) => a.company_side === "buyer"), { session_id: session.session_id, session_revision: session.session_revision });
    const silent = structuredClone(session); silent.current_deal.applications[0].notes = "Digest changed without revision";
    for (const current of [changed, published, createDemoSession(), silent]) {
      const view = projectALAResults(result, session, current); assert.equal(view.state, "outdated"); assert.doesNotMatch(html(view), /<table|Invented|Provider:/);
    }
    const license = updateLicense(session, session.current_deal.license_positions[0].license_id, { notes: "Unrelated license edit" });
    assert.equal(projectALAResults(result, session, license).state, "current");
    const bad = structuredClone(result); assert.ok(bad.status !== "error"); bad.source_token.applications_digest = "f".repeat(64); rejected(bad);
    rejected(result, null); rejected(result, session, { invalid: true });
  });
  await check("invalid output/provenance/coverage fails closed, including source-valid shape with actual sides swapped", () => {
    const mutations: ((value: any) => void)[] = [
      (v) => { v.private_payload = "private-canary"; }, (v) => { v.envelope.provider_override = "private-canary"; },
      (v) => { v.envelope.module = "assistant"; }, (v) => { v.envelope.prompt_version = "ala/v2"; },
      (v) => { v.envelope.model_id = "<script>private-canary</script>"; }, (v) => { v.envelope.generated_at = "yesterday"; },
      (v) => { v.envelope.input_digest = "f".repeat(64); }, (v) => { v.envelope.routing_reason = "paid_unavailable"; },
      (v) => { v.envelope.data.findings[0].model_provider = "private-canary"; },
      (v) => { v.coverage.buyer.accounted_count = 0; }, (v) => { v.coverage.buyer.missing_app_ids = [buyers[0].app_id]; },
      (v) => { v.status = "incomplete"; }, (v) => { v.envelope.data.findings[0].evidence[0].attribute = "api_key"; },
      (v) => { v.envelope.data.findings[0].evidence[0].app_id = session.current_deal.license_positions[0].license_id; },
      (v) => { v.envelope.data.findings[0].actions[1].destination.app_id = "unknown"; },
      (v) => { v.envelope.data.findings[0].actions.push({ ...v.envelope.data.findings[0].actions[0], action_id: "conflict", disposition: "Retire" }); },
      (v) => { const f = v.envelope.data.findings[0]; [f.buyer_app_ids, f.target_app_ids] = [f.target_app_ids, f.buyer_app_ids]; for (const a of f.actions) { a.subject.side = a.subject.side === "buyer" ? "target" : "buyer"; if(a.destination) a.destination.side = a.destination.side === "buyer" ? "target" : "buyer"; } },
      (v) => { v.envelope.data.findings[0].rationale = "x".repeat(64001); },
    ];
    for (const mutate of mutations) { const value = structuredClone(mock()); mutate(value); rejected(value); }
    const incomplete = mock({ findings: [], not_evaluated: [{ app_id: buyers[0].app_id, side: "buyer", reason: "Not evaluated" }] });
    assert.ok(incomplete.status !== "error"); incomplete.coverage.buyer.not_evaluated_app_ids = []; rejected(incomplete);
    rejected({ status: "error", error: { code: "provider_unavailable", request_id: null, message: "private-canary" } });
    assert.equal(ALAResultSchema.safeParse(complete()).success, true);
  });
  await check("public absent state and unchanged route: no body reads/success, no result source or mock activation", async () => {
    const absent = projectALAResults(null, null, null), rendered = html(absent); assert.equal(absent.state, "absent");
    assert.match(rendered, /No AI analysis has been run/); assert.doesNotMatch(rendered, /<table|Invented|Provider:|AI draft/);
    let reads = 0; const hostile = new Proxy({}, { get() { reads++; throw Error("body read"); } });
    const response = (POST as (...args: unknown[]) => Response)(hostile); assert.equal(response.status, 503); assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.equal(reads, 0);
    assert.equal((await response.json()).error.code, "ai_controls_not_ready");
    const action = await readFile("components/ala/analyze-applications.tsx", "utf8"); assert.match(action, /ALAReviewWorkspace view=\{\{ state: "absent" \}\}/);
    assert.doesNotMatch(action, /body:|JSON\.stringify|projectALAResults|server\/ala|status: "current"|mock|fixture/);
    const api = (await readdir("app", { recursive: true })).map((s) => s.replaceAll("\\", "/")).filter((s) => /^api(?:\/|$)/.test(s)).sort();
    assert.deepEqual(api, ["api", "api/ai", "api/ai/ala", "api/ai/ala/route.ts", "api/ai/playbook", "api/ai/playbook/route.ts"]);
  });
  await check("deterministic table/a11y/CSS layout: caption, scoped headers, row groups, focusable scroll and full native details", async () => {
    const rendered = html(projectALAResults(mock(), session, session));
    assert.match(rendered, /<caption>AI draft findings/); assert.equal((rendered.match(/scope="col"/g) ?? []).length, 7);
    assert.equal((rendered.match(/scope="rowgroup"/g) ?? []).length, 15); assert.equal((rendered.match(/<tbody>/g) ?? []).length, 15);
    assert.equal((rendered.match(/<tr>/g) ?? []).length, 31); assert.match(rendered, /role="region" aria-label="[^"]+horizontally scrollable" tabindex="0"/);
    assert.match(rendered, /<details><summary>Action rationale/); assert.match(rendered, /<details><summary>Finding rationale/);
    const css = await readFile("app/globals.css", "utf8");
    assert.match(css, /\.ala-results-scroll \{ max-width: 100%; overflow-x: auto;/); assert.match(css, /\.ala-results \{ min-width: 0; max-width: 100%/);
    assert.match(css, /\.ala-results-table \{[^}]*min-width: 1200px; table-layout: fixed/); assert.match(css, /\.ala-results summary:focus-visible \{ outline: 3px solid var\(--focus\)/);
    assert.match(css, /\.ala-results-table th, \.ala-results-table td \{[^}]*white-space: pre-wrap; overflow-wrap: anywhere/);
  });
  await check("isolation/integrity: no renderer side effects, no server runtime in client, projection imports server-only", async () => {
    const marker = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/ala/presentation.ts')"], { encoding: "utf8", timeout: 5000 });
    assert.notEqual(marker.status, 0); assert.match(marker.stderr, /cannot be imported from a Client Component/);
    for (const file of ["components/ala/ala-results-grid.ts", "lib/ala/results-view.ts", "lib/server/ala/presentation.ts"]) {
      const source = await readFile(file, "utf8");
      assert.doesNotMatch(source, /fetch\(|sessionStorage|localStorage|recordDerivedResultMetadata|dangerouslySetInnerHTML|createAIAdapter|createAIRouter|fake-usage|process\.env|console\./);
    }
    const source = await readFile("lib/server/ala/presentation.ts", "utf8"); assert.match(source, /import "server-only"/); assert.match(source, /inspectALAResult\(/); assert.equal((source.match(/matchesALASource\(/g) ?? []).length, 2);
    assert.equal(attempts, 0);
  });
  console.log(`PASS: ${groups} U02.03 groups; fabricated structured inputs stay test-only; zero network/provider attempts. Populated-grid browser UAT is pending protected live integration.`);
} finally { globalThis.fetch = fetchBefore; }
