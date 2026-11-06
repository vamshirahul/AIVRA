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
import { createReviewDraft, effectiveReviewActions, restoreAIRecommendation, REVIEW_DISPOSITIONS, reviewActionKey, reviewDraftForView, reviewIdentity, reviewResultKey, saveReviewOverride, validateReviewDraft } from "../lib/ala/review-overrides.ts";
import type { ReviewDraft, ReviewEdit, ReviewOperation } from "../lib/ala/review-overrides.ts";
import { createDemoSession, updateApplication, updateLicense, publishSessionApplications } from "../lib/session/session.ts";
import { POST } from "../app/api/ai/ala/route.ts";

// Fabricated structured testing specimens ONLY. No model execution or founder-approved model IDs.
const session = createDemoSession("2026-11-01T05:00:00Z"), apps = session.current_deal.applications;
const [b0, b1] = apps.filter((a) => a.company_side === "buyer"), [t0, t1] = apps.filter((a) => a.company_side === "target");
const ref = (app: typeof b0) => ({ app_id: app.app_id, side: app.company_side });
type Action = ALAResult["findings"][number]["actions"][number];
function specimen(): ALAResult {
  const action = (action_id: string, app: typeof b0, disposition: Action["disposition"], destination: Action["destination"] = null): Action => ({ action_id, subject: ref(app), disposition, destination, rationale: `Invented original rationale ${action_id}.` });
  const finding = (finding_id: string, members: typeof apps, actions: Action[], relationship: "functional_overlap" | "unique" = "functional_overlap") => ({ finding_id, domain: "Invented test domain", relationship,
    buyer_app_ids: members.filter((a) => a.company_side === "buyer").map((a) => a.app_id), target_app_ids: members.filter((a) => a.company_side === "target").map((a) => a.app_id), actions,
    rationale: "Invented original finding rationale.", evidence: members.map((a) => ({ app_id: a.app_id, attribute: "notes" as const })), uncertainty: { level: "unknown" as const, reason: "Fabricated specimen, not actual analysis." } });
  return { findings: [finding("group", [b0, b1, t0, t1], [action("keep", b0, "Retain"), action("connect0", b0, "Integrate", ref(t0)), action("connect1", b0, "Integrate", ref(t1)), action("review", b1, "Needs Review"), action("target0", t0, "Retain"), action("target1", t1, "Retire")]),
    finding("repeated", [b0, t0], [action("repeat_b", b0, "Needs Review"), action("repeat_t", t0, "Retain")]),
    ...apps.filter((app) => ![b0, b1, t0, t1].includes(app)).map((app, i) => finding(`unique_${i}`, [app], [action(`unique_action_${i}`, app, "Needs Review")], "unique"))], not_evaluated: [] };
}
function outcome(data = specimen(), source = session, request_id = "73dbce5b-3594-414a-9302-804d93f397c0") {
  const built = buildALARequest(source), inspected = inspectALAResult(data, source.current_deal.applications); assert.ok(built.ok && inspected.ok);
  return ALAAnalyzeOutcomeSchema.parse({ status: inspected.coverage.status === "complete" ? "success" : "incomplete", source_token: built.source_token, coverage: inspected.coverage,
    envelope: { module: "ala", request_id, input_digest: createHash("sha256").update(JSON.stringify({ input: built.request, references: { allow_empty: true, duplicates: "reject" } })).digest("hex"),
      model_provider: "fabricated-test-only", model_id: "invented-review-specimen/v1", mode: "paid", prompt_version: "ala/v1", generated_at: "2026-11-01T05:00:00Z",
      usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data } });
}
const originalOutcome = outcome(), view = projectALAResults(originalOutcome, session, session);
assert.ok("data" in view); const original = JSON.stringify({ view, originalOutcome, session });
const empty = createReviewDraft(view)!;
function edit(action_id = "review", disposition: Action["disposition"] = "Retain", destination: Action["destination"] = null, reason = "Visitor-supplied test justification.", finding_id = "group"): ReviewEdit {
  assert.ok("data" in view); const action = view.data.findings.find((f) => f.finding_id === finding_id)!.actions.find((a) => a.action_id === action_id)!;
  return { result_identity: reviewIdentity(view)!, finding_id, action_id, subject: action.subject, proposed_disposition: disposition, proposed_destination: destination, visitor_reason: reason };
}
function success(result: ReviewOperation) { assert.ok(result.ok, JSON.stringify(result)); return result.draft; }
function failure(result: ReviewOperation, field?: string) { assert.equal(result.ok, false); if (!result.ok && field) assert.ok(Object.hasOwn(result.errors, field)); assert.ok(!JSON.stringify(result).includes("private-canary")); }
function reference(input: ReviewEdit) { const { proposed_disposition: _, proposed_destination: __, visitor_reason: ___, ...value } = input; return value; }
function parity(draft: ReviewDraft) {
  assert.ok("data" in view); const effective = effectiveReviewActions(view, draft);
  const candidate = { findings: view.data.findings.map((f) => ({ finding_id: f.finding_id, domain: f.domain, relationship: f.relationship,
    buyer_app_ids: [...f.buyer_app_ids], target_app_ids: [...f.target_app_ids], rationale: f.rationale, evidence: f.evidence, uncertainty: f.uncertainty,
    actions: f.actions.map((a) => ({ ...a, ...effective.find((e) => e.finding_id === f.finding_id && e.original.action_id === a.action_id)!.effective })) })), not_evaluated: [] };
  assert.equal(ALAResultSchema.safeParse(candidate).success, true, "Client-side structural rules must match frozen ala/v1");
}
const renderCode = `import {createElement as h} from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
import {ALAReviewWorkspace,ALAReviewComparison,ALAReviewForm} from './components/ala/ala-review-workspace.ts';
globalThis.fetch=()=>{throw Error('Review SSR forbids network')}; let text=''; for await(const chunk of process.stdin)text+=chunk;
const p=JSON.parse(text), Component=p.mode==='comparison'?ALAReviewComparison:p.mode==='form'?ALAReviewForm:ALAReviewWorkspace;
process.stdout.write(renderToStaticMarkup(h(Component,{...p,onSave:()=>{throw Error('SSR must not save')},onCancel:()=>{throw Error('SSR must not cancel')}})));`;
function render(props: object) { const child = spawnSync(process.execPath, ["--input-type=module", "-e", renderCode], { input: JSON.stringify(props), encoding: "utf8", timeout: 10000 }); assert.equal(child.status, 0, child.stderr); return child.stdout; }
let groups = 0, attempts = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); groups++; console.log(`PASS: ${name}`); }
const fetchBefore = globalThis.fetch; globalThis.fetch = async () => { attempts++; throw Error("Review tests forbid provider/network requests"); };
try {
  await check("trust/identity: only current or incomplete trusted projections allow local review; notices have zero controls", () => {
    assert.deepEqual(empty.overrides, []); assert.ok(Object.isFrozen(empty) && Object.isFrozen(empty.result_identity));
    for (const state of ["absent", "invalid", "outdated"] as const) {
      const absent: ALAResultsView = { state }; assert.equal(createReviewDraft(absent), null); assert.equal(reviewDraftForView(absent, empty), null);
      assert.deepEqual(effectiveReviewActions(absent, empty), []); const html = render({ view: absent }); assert.doesNotMatch(html, /<button|<select|<textarea|<table|fabricated-test-only/);
      failure(saveReviewOverride(absent, empty, edit()));
    }
    assert.equal(reviewActionKey("a_b", "c"), '["a_b","c"]'); assert.notEqual(reviewActionKey("a_b", "c"), reviewActionKey("a", "b_c"));
  });
  await check("all five dispositions, explicit destinations, nonblank 400-character justification, no-op original and reason-only policy", () => {
    for (const disposition of REVIEW_DISPOSITIONS) {
      const destination = ["Migrate", "Integrate"].includes(disposition) ? ref(b0) : null;
      const saved = success(saveReviewOverride(view, empty, edit("review", disposition, destination, "x".repeat(400))));
      assert.equal(saved.overrides.length, disposition === "Needs Review" ? 0 : 1); parity(saved);
    }
    for (const reason of ["", "  \n\t"]) failure(saveReviewOverride(view, empty, edit("review", "Retain", null, reason)), "reason");
    failure(saveReviewOverride(view, empty, edit("review", "Retain", null, "x".repeat(401))), "reason");
    const unchanged = saveReviewOverride(view, empty, edit("review", "Needs Review", null, "Comment only is discarded")); assert.ok(unchanged.ok && !unchanged.changed); assert.equal(unchanged.draft.overrides.length, 0);
    const whitespace = success(saveReviewOverride(view, empty, edit("review", "Retain", null, "  Keep CASE\nvisitor reason  "))); assert.equal(whitespace.overrides[0].visitor_reason, "  Keep CASE\nvisitor reason  ");
  });
  await check("malformed/foreign identities, subjects, destinations, enums, unknown fields, duplicate overlays fail safely", () => {
    const badEdits = [{ ...edit(), finding_id: "unknown" }, { ...edit(), action_id: "unknown" }, { ...edit(), subject: ref(t0) },
      { ...edit(), proposed_disposition: "AutoPick" }, { ...edit(), source_rationale: "private-canary" },
      { ...edit("review", "Migrate"), proposed_destination: ref(b1) }, { ...edit("review", "Migrate"), proposed_destination: { app_id: t0.app_id, side: "buyer" } },
      { ...edit("review", "Migrate"), proposed_destination: { app_id: apps[5].app_id, side: apps[5].company_side } },
      { ...edit("review", "Migrate"), proposed_destination: { app_id: "unknown", side: "buyer" } },
      edit("review", "Migrate", null), edit("review", "Integrate", null), edit("review", "Retain", ref(b0)), edit("review", "Retire", ref(b0)), edit("review", "Needs Review", ref(b0)),
      { ...edit(), result_identity: { ...reviewIdentity(view), request_id: "00000000-0000-4000-8000-000000000000" } }, null];
    for (const input of badEdits) failure(saveReviewOverride(view, empty, input));
    const saved = success(saveReviewOverride(view, empty, edit()));
    for (const bad of [{ ...saved, overrides: [...saved.overrides, ...saved.overrides] }, { ...saved, overrides: [{ ...saved.overrides[0], origin: "ai_suggestion" }] },
      { ...saved, overrides: [{ ...saved.overrides[0], subject: ref(t0) }] }, { ...saved, extra: true }, { ...saved, overrides: Array(201).fill(saved.overrides[0]) }]) {
      assert.equal(validateReviewDraft(view, bad), null); failure(saveReviewOverride(view, bad, edit()));
    }
    const hostile = new Proxy({}, { get() { throw Error("private-canary"); } }); failure(saveReviewOverride(view, empty, hostile)); failure(restoreAIRecommendation(view, empty, hostile));
  });
  await check("per-finding/action independence, repeated apps, structural conflicts and ala/v1 parity", () => {
    let draft = success(saveReviewOverride(view, empty, edit()));
    draft = success(saveReviewOverride(view, draft, edit("target0", "Retire")));
    draft = success(saveReviewOverride(view, draft, edit("repeat_b", "Retain", null, "Other finding", "repeated"))); assert.equal(draft.overrides.length, 3); parity(draft);
    assert.equal(effectiveReviewActions(view, draft).find((a) => a.original.action_id === "keep")!.effective.disposition, "Retain");
    for (const disposition of ["Retire", "Migrate", "Needs Review"] as const) failure(saveReviewOverride(view, empty, edit("keep", disposition, disposition === "Migrate" ? ref(b1) : null)), "form");
    failure(saveReviewOverride(view, empty, edit("keep", "Integrate", ref(t0))), "form");
    draft = success(saveReviewOverride(view, empty, edit("keep", "Integrate", ref(b1)))); parity(draft);
    draft = success(saveReviewOverride(view, draft, edit("connect0", "Retain"))); parity(draft);
    failure(restoreAIRecommendation(view, draft, reference(edit("keep"))), "form"); // Would duplicate the other effective Retain action.
    draft = success(restoreAIRecommendation(view, draft, reference(edit("connect0")))); parity(draft);
    draft = success(restoreAIRecommendation(view, draft, reference(edit("keep")))); assert.equal(draft.overrides.length, 0); parity(draft);
  });
  await check("save/no-op/restore leave original frozen result, evidence/provenance and shared session byte-identical", () => {
    assert.ok("data" in view && Object.isFrozen(view.data.findings[0].actions[0]));
    let draft = success(saveReviewOverride(view, empty, edit()));
    const repeated = saveReviewOverride(view, draft, edit()); assert.ok(repeated.ok && !repeated.changed); assert.deepEqual(repeated.draft, draft);
    draft = success(saveReviewOverride(view, draft, edit("review", "Needs Review", null, ""))); assert.equal(draft.overrides.length, 0);
    draft = success(saveReviewOverride(view, empty, edit())); draft = success(restoreAIRecommendation(view, draft, reference(edit()))); assert.equal(draft.overrides.length, 0);
    const noRestore = restoreAIRecommendation(view, draft, reference(edit())); assert.ok(noRestore.ok && !noRestore.changed);
    failure(restoreAIRecommendation(view, draft, { ...reference(edit()), action_id: "not_here" }));
    assert.equal(JSON.stringify({ view, originalOutcome, session }), original);
    assert.ok(effectiveReviewActions(view, success(saveReviewOverride(view, empty, edit()))).some((a) => a.origin === "visitor_override" && a.visitor_reason));
  });
  await check("lifecycle: new request/digest/revision, invalid/outdated/absent and reset clear drafts; license/re-render keep identity", () => {
    const draft = success(saveReviewOverride(view, empty, edit()));
    const next = projectALAResults(outcome(specimen(), session, "a4df40e9-332f-4070-a12b-3388d2b9b414"), session, session);
    assert.notEqual(reviewResultKey(next), reviewResultKey(view)); assert.equal(reviewDraftForView(next, draft)!.overrides.length, 0); failure(saveReviewOverride(next, draft, edit()));
    const changed = updateApplication(session, b0.app_id, { notes: "Changed source" });
    const published = publishSessionApplications(session, "buyer", changed.current_deal.applications.filter((a) => a.company_side === "buyer"), { session_id: session.session_id, session_revision: 0 });
    for (const current of [changed, published, createDemoSession()]) assert.equal(reviewDraftForView(projectALAResults(originalOutcome, session, current), draft), null);
    const nextSource = projectALAResults(outcome(specimen(), changed), changed, changed); assert.notEqual(reviewResultKey(nextSource), reviewResultKey(view)); assert.equal(reviewDraftForView(nextSource, draft)!.overrides.length, 0);
    const license = updateLicense(session, session.current_deal.license_positions[0].license_id, { notes: "License only" });
    const sameView = projectALAResults(originalOutcome, session, license); assert.equal(reviewResultKey(sameView), reviewResultKey(view)); assert.deepEqual(reviewDraftForView(sameView, draft), draft);
    const bad = structuredClone(originalOutcome); assert.ok(bad.status !== "error"); bad.envelope.prompt_version = "ala/v2";
    assert.equal(reviewDraftForView(projectALAResults(bad, session, session), draft), null);
    assert.equal(createReviewDraft(view)!.overrides.length, 0, "A fresh mount starts a fresh draft");
  });
  await check("SSR transparency and native editor semantics: original/visitor comparison, exact IDs, safe text and explicit destination placeholder", () => {
    const page = render({ view }); assert.match(page, /<caption>AI draft findings/); assert.match(page, /Original AI suggestion/); assert.match(page, /AI suggestion — not changed/);
    assert.match(page, /not human approvals/); assert.match(page, /lost on refresh, navigation/); assert.match(page, /Visitor overrides: 0/); assert.equal((page.match(/>Edit suggestion<\/button>/g) ?? []).length, effectiveReviewActions(view, empty).length);
    const saved = success(saveReviewOverride(view, empty, edit("review", "Migrate", ref(b0), '<script>private-canary</script> & Keep CASE')));
    const entry = effectiveReviewActions(view, saved).find((a) => a.original.action_id === "review")!;
    const comparison = render({ mode: "comparison", entry }); assert.match(comparison, /Visitor override — not approved/); assert.match(comparison, /Visitor-changed draft/); assert.match(comparison, /Needs Review/); assert.match(comparison, /Migrate/);
    assert.match(comparison, /Invented original rationale review/); assert.match(comparison, /&lt;script&gt;private-canary/); assert.doesNotMatch(comparison, /<script|<a\b|<img/);
    const form = render({ mode: "form", view, entry }); assert.match(form, /<fieldset>/); assert.match(form, /<legend>Edit group \/ review/); assert.match(form, /Select a destination/);
    assert.match(form, /<label for="[^"]+">Proposed disposition/); assert.match(form, /<label for="[^"]+">Destination application/); assert.match(form, /<label for="[^"]+">Change justification/);
    assert.match(form, /maxLength="400"/); assert.match(form, /aria-describedby=/); assert.match(form, /type="submit"[^>]*>Save override/); assert.match(form, /type="button"[^>]*>Cancel/);
    assert.doesNotMatch(form, new RegExp(`value="[^"<>]*${b1.app_id}`), "Subject must not be a destination option");
  });
  await check("incomplete stays incomplete; missing/not-evaluated records remain visible without editable actions", () => {
    const data = specimen(); const omitted = data.findings.pop()!; const notEvaluated = data.findings.pop()!;
    data.not_evaluated.push({ app_id: notEvaluated.actions[0].subject.app_id, side: notEvaluated.actions[0].subject.side, reason: "Fabricated missing evidence reason." });
    const incomplete = projectALAResults(outcome(data), session, session); assert.equal(incomplete.state, "incomplete");
    const draft = success(saveReviewOverride(incomplete, createReviewDraft(incomplete), { ...edit(), result_identity: reviewIdentity(incomplete)! }));
    assert.ok("data" in incomplete); assert.equal(incomplete.data.coverage.status, "incomplete");
    assert.ok(!effectiveReviewActions(incomplete, draft).some((a) => [omitted.actions[0].subject.app_id, notEvaluated.actions[0].subject.app_id].includes(a.original.subject.app_id)));
    const html = render({ view: incomplete }); assert.match(html, /Incomplete analysis/); assert.match(html, /No AI finding returned/); assert.match(html, /Fabricated missing evidence reason/);
  });
  await check("public route and client isolation: no body/provider calls, literal absent wrapper, no result imports/storage/export/bypass", async () => {
    let reads = 0; const response = (POST as (...args: unknown[]) => Response)(new Proxy({}, { get() { reads++; throw Error("read"); } })); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(reads, 0);
    const action = await readFile("components/ala/analyze-applications.tsx", "utf8"); assert.match(action, /ALAReviewWorkspace view=\{\{ state: "absent" \}\}/); assert.doesNotMatch(action, /body:|JSON\.stringify|server\/ala|mock|fixture/);
    for (const file of ["lib/ala/review-overrides.ts", "components/ala/ala-review-workspace.ts"]) {
      const source = await readFile(file, "utf8"); assert.doesNotMatch(source, /server-only|server\/ala|server\/ai|fetch\(|sessionStorage|localStorage|indexedDB|recordDerivedResultMetadata|dangerouslySetInnerHTML|process\.env|setInterval|setTimeout|Date\(|console\./);
    }
    const ui = await readFile("components/ala/ala-review-workspace.ts", "utf8"); assert.match(ui, /key, view/); assert.match(ui, /onCancel: closeEditor/); assert.match(ui, /const closeEditor = \(\) => \{ focusAfterClose.current = true; setEditing\(false\); \}/); assert.match(ui, /editButton\.current\?\.focus\(\)/); assert.match(ui, /setDestination\(""\)/); assert.match(ui, /latest\.current = result\.draft/); assert.match(ui, /aria-live": "polite"/);
    const css = await readFile("app/globals.css", "utf8"); assert.match(css, /minmax\(min\(100%, 240px\), 1fr\)/); assert.match(css, /\.ala-review-form :is\(select, textarea\):focus-visible/); assert.match(css, /\.ala-results-scroll \{ max-width: 100%; overflow-x: auto/);
    const api = (await readdir("app", { recursive: true })).map((s) => s.replaceAll("\\", "/")).filter((s) => /^api(?:\/|$)/.test(s)).sort(); assert.deepEqual(api, ["api", "api/ai", "api/ai/ala", "api/ai/ala/route.ts", "api/ai/playbook", "api/ai/playbook/route.ts", "api/local-ala", "api/local-ala/route.ts"]);
    assert.equal(attempts, 0); assert.equal(JSON.stringify({ view, originalOutcome, session }), original);
  });
  console.log(`PASS: ${groups} U02.04 groups; fabricated specimens only, frozen originals retained; zero network/provider attempts. Populated-edit browser/manual UAT remains pending protected integration.`);
} finally { globalThis.fetch = fetchBefore; }
