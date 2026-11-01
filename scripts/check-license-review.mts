import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createDemoSession, updateApplication, updateLicense, updateTSA, publishSessionApplications } from "../lib/session/session.ts";
import { createLicenseAnalyzer } from "../lib/server/licenses/analyze.ts";
import { EnabledPolicySchema } from "../lib/server/ai/control-policy.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { projectLicenseResults } from "../lib/server/licenses/presentation.ts";
import type { LicenseResult } from "../lib/server/licenses/schema.ts";
import type { LicenseResultsView } from "../lib/license-optimizer/results-view.ts";
import { clearLicenseSelection, createLicenseSelectionDraft, licenseDraftForView, licenseReviewEntries, licenseReviewIdentity, licenseReviewKey, saveLicenseSelection, selectedLicenseOverlaps, validateLicenseSelectionDraft } from "../lib/license-optimizer/review-selections.ts";
import type { LicenseReviewOperation } from "../lib/license-optimizer/review-selections.ts";
import { POST } from "../app/api/ai/ala/route.ts";

// Fabricated offline contract specimens, not actual recommendations/model approvals.
const session = createDemoSession(), source = session.current_deal, licenses = source.license_positions;
licenses[0].annual_spend = 0; licenses[0].seats_entitled = null; licenses[0].seats_used = 0; licenses[0].vendor = "License source vendor";
licenses[0].notes = '<script>test-only</script> & "Original CASE" ' + "L".repeat(400);
licenses[1].annual_spend = null; licenses[1].renewal_date = null; delete licenses[2].renewal_date;
source.applications.find((app) => app.app_id === licenses[0].app_id)!.app_name = "A".repeat(1500);
function specimen(): LicenseResult {
  const findings: LicenseResult["findings"] = licenses.map((r, i) => ({ finding_id: `test_${i}`, category: "Fabricated category",
    license_ids: [r.license_id], app_ids: [r.app_id], suggested_action: "Fabricated action only; no analysis ran.", rationale: `Unmodified fabricated rationale ${i}.`,
    evidence: Object.keys(r).filter((key) => r[key as keyof typeof r] !== undefined).map((attribute) => ({ license_id: r.license_id, attribute: attribute as keyof typeof r })),
    unknowns: ["Missing contract/entitlement evidence."], assumptions: ["Fabricated test assumption."], uncertainty: { level: "unknown", reason: "No real inference occurred." }, review_required: true }));
  findings.push({ ...structuredClone(findings[0]), finding_id: "overlap" });
  return { findings, not_evaluated: [] };
}
const model = { model_provider: "offline-paid", model_id: "license-review-test", approved: true, approval_ref: "invented-test-not-approval", monthly_budget_units: 10_000_000, per_request_ceiling_units: 1_000_000, input_units_per_token: 2, output_units_per_token: 3, concurrency: 1, credential_slot: "paid" };
const policy = EnabledPolicySchema.parse({ enabled: true, live_dispatch_enabled: false, namespace: "license-review-offline", period_key: "2026-11", paid_enabled: true, fallback_enabled: true, paid: model,
  fallback: { ...model, model_provider: "offline-fallback", model_id: "license-review-open-test", credential_slot: "fallback", open_weight_verified: true, open_weight_evidence: "https://example.invalid/test-only", daily_requests: 20, monthly_requests: 50 },
  client_window_ms: 60_000, client_requests: 20, global_window_ms: 60_000, global_requests: 50, global_concurrency: 3, client_concurrency: 1, max_input_bytes: 128000, max_output_tokens: 2048, input_overhead_tokens: 512, lease_ms: 5000, timeout_ms: 1000, store_timeout_ms: 50 });
let calls = 0, network = 0, groups = 0;
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { network++; throw new Error("License review tests forbid network"); };
async function outcome(output: unknown = specimen(), fallback = false, sourceSession = session) {
  const clock = () => Date.UTC(2026, 10, 1, 18), store = createFakeUsageStore(clock);
  const p = fallback ? EnabledPolicySchema.parse({ ...policy, paid: { ...policy.paid, monthly_budget_units: 1 } }) : policy;
  const transport = (mode: "paid" | "fallback") => ({ model_provider: p[mode].model_provider, model_id: p[mode].model_id, generate: async () => { calls++; return { output }; } });
  return createLicenseAnalyzer({ policy: p, execution: "offline-test", store, clock, paid: transport("paid"), fallback: transport("fallback") })(sourceSession, { client_key: "a".repeat(64) });
}
function success(operation: LicenseReviewOperation) { assert.ok(operation.ok, JSON.stringify(operation)); return operation.draft; }
function rejected(operation: LicenseReviewOperation) { assert.equal(operation.ok, false); assert.doesNotMatch(JSON.stringify(operation), /private-canary/); }
async function check(name: string, run: () => void | Promise<void>) { await run(); groups++; console.log(`PASS: ${name}`); }
const renderCode = `import {createElement as h} from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
import {LicenseReviewWorkspace,LicenseSelectionStatus} from './components/license-optimizer/license-review-workspace.ts';
globalThis.fetch=()=>{throw Error('SSR forbids network')}; let text=''; for await(const c of process.stdin)text+=c;
const p=JSON.parse(text); process.stdout.write(renderToStaticMarkup(h(p.mode==='status'?LicenseSelectionStatus:LicenseReviewWorkspace,p)));`;
function render(props: object) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", renderCode], { input: JSON.stringify(props), encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0, child.stderr); return child.stdout;
}
try {
  const originalOutcome = await outcome(), view = projectLicenseResults(originalOutcome, session, session);
  assert.ok("data" in view); const original = JSON.stringify({ originalOutcome, view, session }), initial = createLicenseSelectionDraft(view)!;
  const ref = (finding_id = "test_0") => ({ result_identity: licenseReviewIdentity(view)!, finding_id });
  const edit = (finding_id = "test_0", status: "selected" | "not_selected" = "selected") => ({ ...ref(finding_id), status });
  await check("real guarded offline outcome projects immutable original findings, exact evidence, Buyer/Target and provenance", () => {
    assert.equal(view.state, "current"); assert.ok(originalOutcome.status !== "error");
    assert.deepEqual(view.data.findings.map((f) => f.original), originalOutcome.envelope.data.findings);
    const { data: _, ...provenance } = originalOutcome.envelope; assert.deepEqual(view.data.provenance, provenance);
    for (const f of view.data.findings) {
      for (const app of f.applications) { const actual = source.applications.find((r) => r.app_id === app.app_id)!; assert.equal(app.name, actual.app_name); assert.equal(app.side, actual.company_side); }
      for (const e of f.source_evidence) { const license = licenses.find((r) => r.license_id === e.license_id)!; assert.equal(e.app_id, license.app_id); assert.equal(e.value, license[e.attribute as keyof typeof license]); }
      assert.ok(Object.isFrozen(f.original.evidence));
    }
    assert.ok(view.data.findings.some((f) => f.applications.some((a) => a.side === "target")));
    assert.ok(!view.data.findings[2].source_evidence.some((e) => e.attribute === "renewal_date"));
    assert.equal("current_deal" in view.data, false); assert.equal("system" in view.data, false);
  });
  await check("absent, invalid, tampered and outdated outcomes have no rows or selection controls", () => {
    assert.ok(originalOutcome.status !== "error");
    const bad = structuredClone(originalOutcome); bad.coverage.accounted_count = 0;
    const version = structuredClone(originalOutcome); version.envelope.prompt_version = "licenses/v2";
    const sourceToken = structuredClone(originalOutcome); sourceToken.source_token.source_digest = "0".repeat(64);
    const digest = structuredClone(originalOutcome); digest.envelope.input_digest = "0".repeat(64);
    const foreign = structuredClone(originalOutcome); foreign.envelope.data.findings[0].app_ids = ["foreign"];
    for (const result of [null, undefined, {}, bad, version, sourceToken, digest, foreign, { status: "error" }]) {
      const missing = projectLicenseResults(result, session, session); assert.equal("data" in missing, false); assert.equal(createLicenseSelectionDraft(missing), null);
      const markup = render({ view: missing }); assert.doesNotMatch(markup, /<button|<fieldset|License finding test_/);
    }
    const stale = projectLicenseResults(originalOutcome, session, updateLicense(session, licenses[0].license_id, { product: "Edited source" })); assert.equal(stale.state, "outdated"); assert.doesNotMatch(render({ view: stale }), /<button|Fabricated action/);
  });
  await check("select, deselect, restore and no-op preserve independent findings and original model bytes", () => {
    assert.deepEqual(initial.selections, []); assert.ok(Object.isFrozen(initial.result_identity.source_token));
    let draft = success(saveLicenseSelection(view, initial, edit()));
    assert.deepEqual(draft.selections[0], { finding_id: "test_0", status: "selected", origin: "visitor_selection" });
    const same = saveLicenseSelection(view, draft, edit()); assert.ok(same.ok && !same.changed); assert.deepEqual(same.draft, draft);
    draft = success(saveLicenseSelection(view, draft, edit("test_1"))); assert.equal(draft.selections.length, 2);
    draft = success(saveLicenseSelection(view, draft, edit("test_0", "not_selected"))); assert.equal(draft.selections[0].status, "not_selected"); assert.equal(draft.selections[1].status, "selected");
    draft = success(clearLicenseSelection(view, draft, ref())); assert.deepEqual(draft.selections.map((s) => s.finding_id), ["test_1"]);
    const noRestore = clearLicenseSelection(view, draft, ref()); assert.ok(noRestore.ok && !noRestore.changed);
    assert.equal(licenseReviewEntries(view, draft)[0].selection, null); assert.equal(JSON.stringify({ originalOutcome, view, session }), original);
  });
  await check("malformed/duplicate/foreign/stale/oversize/extra selections fail without mutating prior state", () => {
    const draft = success(saveLicenseSelection(view, initial, edit())); const before = JSON.stringify(draft);
    for (const input of [null, { ...edit(), status: "approved" }, { ...edit(), status: "unreviewed" }, { ...edit(), finding_id: licenses[0].license_id }, { ...edit(), finding_id: "foreign" },
      { ...edit(), finding_id: "x".repeat(65) }, { ...edit(), visitor_note: "x".repeat(401) }, { ...edit(), selected_savings: 0 }, { ...edit(), origin: "ai" },
      { ...edit(), result_identity: { ...ref().result_identity, input_digest: "0".repeat(64) } }, { ...edit(), result_identity: { ...ref().result_identity, prompt_version: "licenses/v2" } }]) rejected(saveLicenseSelection(view, draft, input));
    for (const input of [null, { ...draft, schema_version: "licenses/review/v2" }, { ...draft, unexpected: true }, { ...draft, selections: [...draft.selections, ...draft.selections] },
      { ...draft, selections: [{ ...draft.selections[0], finding_id: "foreign" }] }, { ...draft, selections: [{ ...draft.selections[0], status: "unreviewed" }] },
      { ...draft, selections: [{ ...draft.selections[0], origin: "model" }] }, { ...draft, selections: Array.from({ length: 101 }, () => draft.selections[0]) },
      { ...draft, result_identity: { ...draft.result_identity, source_token: { ...draft.result_identity.source_token, license_revision: 99 } } }]) assert.equal(validateLicenseSelectionDraft(view, input), null);
    rejected(clearLicenseSelection(view, draft, { ...ref(), finding_id: "foreign" })); rejected(clearLicenseSelection(view, draft, { ...ref(), status: "selected" }));
    assert.equal(JSON.stringify(draft), before); assert.equal(JSON.stringify({ originalOutcome, view, session }), original);
  });
  await check("overlapping choices remain distinct, identified by shared source IDs without resolution or arithmetic", () => {
    let draft = success(saveLicenseSelection(view, initial, edit())); draft = success(saveLicenseSelection(view, draft, edit("overlap")));
    assert.deepEqual(selectedLicenseOverlaps(view, draft), [{ license_id: licenses[0].license_id, finding_ids: ["test_0", "overlap"] }]);
    assert.equal(draft.selections.length, 2); assert.deepEqual(view.data.coverage.overlapping_license_ids, [licenses[0].license_id]);
    draft = success(saveLicenseSelection(view, draft, edit("overlap", "not_selected"))); assert.deepEqual(selectedLicenseOverlaps(view, draft), []); assert.equal(draft.selections.length, 2);
    const reordered = { ...view, data: { ...view.data, findings: [...view.data.findings].reverse() } } as LicenseResultsView;
    assert.equal(licenseReviewKey(reordered), licenseReviewKey(view));
    assert.equal(licenseReviewEntries(reordered, draft).find((r) => r.finding.original.finding_id === "test_0")!.selection!.status, "selected");
  });
  await check("incomplete/empty coverage stays visible, missing and not-evaluated records never become review controls", async () => {
    const output = specimen(); const missing = output.findings.splice(3, 1)[0]; const skipped = output.findings.splice(3, 1)[0]; output.not_evaluated.push({ license_id: skipped.license_ids[0], reason: "Fabricated missing contract evidence." });
    const partial = projectLicenseResults(await outcome(output), session, session); assert.equal(partial.state, "incomplete"); assert.ok("data" in partial);
    const empty = createLicenseSelectionDraft(partial)!; rejected(saveLicenseSelection(partial, empty, { result_identity: licenseReviewIdentity(partial), finding_id: missing.finding_id, status: "selected" }));
    assert.deepEqual(partial.data.coverage.missing_license_ids, missing.license_ids); assert.deepEqual(partial.data.coverage.not_evaluated_license_ids, skipped.license_ids);
    const markup = render({ view: partial }); assert.match(markup, /Structural coverage: incomplete/); assert.ok(markup.includes(missing.license_ids[0])); assert.match(markup, /Fabricated missing contract evidence/);
    assert.equal((markup.match(/<fieldset/g) ?? []).length, partial.data.findings.length);
    const none = projectLicenseResults(await outcome({ findings: [], not_evaluated: [] }), session, session); assert.equal(none.state, "incomplete"); const html = render({ view: none }); assert.match(html, /Empty findings do not establish zero opportunities/); assert.doesNotMatch(html, /<button/);
  });
  await check("license/app edit, publication, reset/reorder invalidate selection; new analysis drops draft, TSA-only retains it", async () => {
    const draft = success(saveLicenseSelection(view, initial, edit())); const app = source.applications[0];
    const appEdit = updateApplication(session, app.app_id, { notes: "Edited shared source" }), licenseEdit = updateLicense(session, licenses[0].license_id, { product: "Changed source" });
    const published = publishSessionApplications(session, "buyer", [...source.applications.filter((a) => a.company_side === "buyer"), { ...app, app_id: "new-test-app" }], { session_id: session.session_id, session_revision: session.session_revision });
    const reordered = structuredClone(session); reordered.current_deal.license_positions.reverse();
    for (const current of [appEdit, licenseEdit, published, createDemoSession(), reordered]) {
      const changed = projectLicenseResults(originalOutcome, session, current); assert.equal(changed.state, "outdated"); assert.equal(licenseDraftForView(changed, draft), null); rejected(saveLicenseSelection(changed, draft, edit()));
    }
    const next = projectLicenseResults(await outcome(), session, session); assert.notEqual(licenseReviewKey(next), licenseReviewKey(view)); assert.deepEqual(licenseDraftForView(next, draft)!.selections, []); rejected(saveLicenseSelection(next, draft, edit()));
    const tsa = updateTSA(session, source.tsa_services[0].tsa_id, { title: "TSA-only change" });
    const unchanged = projectLicenseResults(originalOutcome, session, tsa); assert.equal(licenseReviewKey(unchanged), licenseReviewKey(view)); assert.deepEqual(licenseDraftForView(unchanged, draft), draft);
    for (const state of ["absent", "outdated", "invalid"] as const) assert.equal(licenseDraftForView({ state }, draft), null);
    assert.deepEqual(createLicenseSelectionDraft(view)!.selections, [], "New mounts never restore ephemeral selections");
  });
  await check("SSR faithful originals/evidence/null/zero, long escaped source, advisory labels and accessible native controls", () => {
    const html = render({ view }); assert.match(html, /Original AI suggested action/); assert.match(html, /Original AI rationale/); assert.match(html, /Missing contract\/entitlement evidence/); assert.match(html, /Needs human review: Yes/);
    assert.match(html, /annual_spend: 0/); assert.match(html, /annual_spend: Unknown/); assert.match(html, /seats_entitled: Unknown/); assert.match(html, /seats_used: 0/); assert.match(html, /renewal_date: Unknown/);
    assert.match(html, /License source vendor/); assert.match(html, /&lt;script&gt;test-only&lt;\/script&gt;/); assert.doesNotMatch(html, /<script|<img|<a\b/);
    assert.ok(html.includes("A".repeat(1500))); assert.match(html, /Paid model: offline-paid/); assert.match(html, /licenses\/v1/); assert.match(html, /Source digest/);
    assert.equal((html.match(/<fieldset>/g) ?? []).length, view.data.findings.length); assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 2 * view.data.findings.length);
    assert.match(html, /<legend>Visitor selection for test_0/); assert.match(html, /aria-label="Select for further review: test_0"/); assert.match(html, /Clear selection \/ restore unreviewed/); assert.match(html, /role="status" aria-live="polite"/);
    assert.match(render({ mode: "status", status: "selected" }), /Selected for further review.*unapproved/); assert.match(render({ mode: "status", status: "not_selected" }), /Not selected.*visitor choice/); assert.match(render({ mode: "status" }), /Unreviewed/);
  });
  await check("fallback provenance remains factual and original metadata cannot be replaced by selections", async () => {
    const result = await outcome(specimen(), true), fallback = projectLicenseResults(result, session, session); assert.ok("data" in fallback);
    assert.equal(fallback.data.provenance.mode, "fallback"); assert.equal(fallback.data.provenance.routing_reason, "budget_exhausted"); assert.match(render({ view: fallback }), /Open-weight fallback: offline-fallback/);
    const draft = createLicenseSelectionDraft(fallback)!; const before = JSON.stringify(fallback);
    success(saveLicenseSelection(fallback, draft, { result_identity: licenseReviewIdentity(fallback), finding_id: "test_0", status: "selected" })); assert.equal(JSON.stringify(fallback), before);
  });
  await check("projection/consumer byte bounds, ordinary import guard, untouched public entrypoints and no writes/provider path", async () => {
    const inflated = structuredClone(session); inflated.current_deal.applications.find((a) => a.app_id === licenses[0].app_id)!.app_name = "A".repeat(80000);
    // Existing outcome no longer matches captured bytes: no oversized source can bypass the original gate.
    assert.equal(projectLicenseResults(originalOutcome, inflated, inflated).state, "invalid");
    const expandedOutput = specimen(); expandedOutput.findings = Array.from({ length: 7 }, (_, i) => ({ ...expandedOutput.findings[0], finding_id: `expanded_${i}` }));
    const expandedOutcome = await outcome(expandedOutput, false, inflated); assert.ok(expandedOutcome.status !== "error");
    assert.equal(projectLicenseResults(expandedOutcome, inflated, inflated).state, "invalid", "Bound repeated resolved source text without silently trimming any finding");
    const blocked = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/licenses/presentation.ts')"], { encoding: "utf8" }); assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /cannot be imported from a Client Component/);
    const ui = await readFile("components/license-optimizer/license-review-workspace.ts", "utf8"); assert.match(ui, /key, view/); assert.match(ui, /latest.current, \{ \.\.\.reference, status \}/); assert.match(ui, /latest.current = operation.draft/);
    assert.doesNotMatch(ui, /lib\/server|fetch\(|sessionStorage|localStorage|recordDerived|download|createLicenseAnalyzer|useEffect/);
    const helper = await readFile("lib/license-optimizer/review-selections.ts", "utf8"); assert.doesNotMatch(helper, /lib\/server|node:|fetch\(|sessionStorage|localStorage|annual_spend|annual_cost|seats_used|seats_entitled/);
    const page = await readFile("app/[module]/page.tsx", "utf8"), inventory = await readFile("components/license-optimizer/license-inventory.tsx", "utf8");
    assert.doesNotMatch(page + inventory, /LicenseReviewWorkspace|projectLicenseResults|test_0|fake-usage-store/); assert.match(inventory, /No AI license analysis has run/);
    const response = POST(); assert.equal(response.status, 503); assert.equal(response.headers.get("Cache-Control"), "no-store");
    const css = await readFile("app/globals.css", "utf8"); assert.match(css, /\.license-review-buttons \{[^}]*flex-wrap: wrap/); assert.match(css, /:where\(a, button, \[tabindex\]\):focus-visible/); assert.match(css, /\.license-review \{[^}]*overflow-wrap: anywhere/);
    assert.equal(JSON.stringify({ originalOutcome, view, session }), original); assert.deepEqual(session.derived_results, {}); assert.equal(network, 0);
  });
  console.log(`PASS: ${groups} U05.03 groups; guarded fabricated outcomes only (${calls} mock dispatches), zero real provider/network calls; immutable originals, temporary selections, SSR and public isolation. Populated interactive UAT remains pending trusted delivery.`);
} finally { globalThis.fetch = savedFetch; }
