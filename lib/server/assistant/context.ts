import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { DemoSessionSchema, MAX_SESSION_CHARACTERS } from "../../session/session.ts";
import { freezeCSE } from "../../cost-synergy/calculation-contract.ts";
import { buildEstimateRequest } from "../../cost-synergy/estimate-form.ts";
import { ScenarioFinancialDraftSchema } from "../../scenario-modeling/scenario-draft.ts";
import { buildReviewedExport, ReviewedALAExportSchema } from "../../ala/review-export.ts";
import { projectALAResults } from "../ala/presentation.ts";
import { prepareCSEContext } from "../cost-synergy/reviewed-context.ts";
import { ALAAnalyzeOutcomeSchema } from "../ala/analyze.ts";
import { PlaybookOutcomeSchema } from "../playbook/generate.ts";
import { inspectLicenseOutcome } from "../licenses/analyze.ts";
import { readPlaybookSource, matchesPlaybookReviewSession, validatePlaybookReviewDraft, PlaybookReviewDraftSchema } from "../../playbook-generator/review-draft.ts";
import type { PlaybookReviewSource } from "../../playbook-generator/review-draft.ts";
import { MAX_INPUT_BYTES, SourceIdSchema } from "../ai/contracts.ts";
import { AssistantContextSchema, ASSISTANT_CONTEXT_VERSION, ASSISTANT_DISCLOSURES, AssistantReferencesSchema } from "./schema.ts";
import type { AssistantContext, AssistantReference } from "./schema.ts";
import { ASSISTANT_CONTEXT_INSTRUCTIONS } from "./prompt.ts";

/** Trusted server composition only. ALA/license outcomes must originate from their
 * protected owners; existing validators are consistency checks, not file attestation.
 * Readers must consult latest authoritative state, not a recycled snapshot. */
export type AssistantSources = {
  session: unknown;
  ala?: { outcome: unknown; captured_session: unknown; review?: unknown } | null;
  licenses?: { outcome: unknown; captured_session: unknown } | null;
  assumptions?: { captured_session: unknown; draft: unknown; expected_review_digest: string } | null;
  playbook?: { source: PlaybookReviewSource; review?: unknown } | null;
};
export type AssistantSourceReader = () => AssistantSources | null;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
const fail = (code: "invalid_input" | "request_too_large" | "source_changed" = "invalid_input") => ({ ok: false as const, code,
  message: code === "request_too_large" ? "The Assistant context exceeds the existing AI input limit. No data was truncated." : code === "source_changed" ? "The Assistant source changed or is unavailable. No current context was accepted." : "The current synthetic session or Assistant context could not be validated." });
function section(state: "absent" | "invalid" | "outdated" | "unavailable") { return { state }; }
function references(c: Pick<AssistantContext, "deal" | "ala" | "license_findings" | "assumptions" | "playbook">): AssistantReference[] {
  const refs: AssistantReference[] = [{ kind: "section", section: "deal" }, ...c.deal.applications.map(a => ({ kind: "application" as const, app_id: a.app_id, side: a.company_side })),
    ...c.deal.license_positions.map(l => ({ kind: "license" as const, license_id: l.license_id, app_id: l.app_id })), ...c.deal.tsa_services.map(t => ({ kind: "tsa" as const, tsa_id: t.tsa_id }))];
  if ("data" in c.ala) {
    refs.push({ kind: "section", section: "ala" });
    for (const f of c.ala.data.original.envelope.data.findings) { refs.push({ kind: "ala_finding", finding_id: f.finding_id }); for (const a of f.actions) refs.push({ kind: "ala_action", finding_id: f.finding_id, action_id: a.action_id }); }
    if (c.ala.data.reviewed) refs.push({ kind: "section", section: "ala_review" });
  }
  if ("data" in c.license_findings) { refs.push({ kind: "section", section: "license_findings" }); for (const f of c.license_findings.data.envelope.data.findings) refs.push({ kind: "license_finding", finding_id: f.finding_id }); }
  if ("data" in c.assumptions) { refs.push({ kind: "section", section: "assumptions" }); c.assumptions.data.normalized_request.lines.forEach(l => refs.push({ kind: "assumption", line_id: l.line_id })); }
  if ("data" in c.playbook) {
    refs.push({ kind: "section", section: "playbook" }); const p = c.playbook.data.original.envelope.data;
    p.phases.forEach(p => refs.push({ kind: "playbook_phase", id: p.phase_id })); p.actions.forEach(a => refs.push({ kind: "playbook_activity", id: a.activity_id }));
    p.milestones.forEach(m => refs.push({ kind: "playbook_milestone", id: m.milestone_id })); p.risks.forEach(r => refs.push({ kind: "playbook_risk", id: r.risk_id }));
    if (c.playbook.data.review) refs.push({ kind: "section", section: "playbook_review" });
  }
  return refs;
}
function assemble(input: AssistantSources): { ok: true; context: AssistantContext } | ReturnType<typeof fail> {
  try {
    if (!input || typeof input !== "object" || Object.keys(input).some(k => !["session", "ala", "licenses", "assumptions", "playbook"].includes(k))) return fail();
    const sessionJSON = JSON.stringify(input.session); if (typeof sessionJSON !== "string" || sessionJSON.length > MAX_SESSION_CHARACTERS) return fail();
    const parsed = DemoSessionSchema.safeParse(input.session); if (!parsed.success || !isDeepStrictEqual(parsed.data, input.session)) return fail();
    const s = parsed.data, ids = [...s.current_deal.applications.map(a => a.app_id), ...s.current_deal.license_positions.map(l => l.license_id), ...s.current_deal.tsa_services.map(t => t.tsa_id)];
    if (!z.array(SourceIdSchema).max(400).safeParse(ids).success) return fail();
    let ala: AssistantContext["ala"] = section("absent"), license_findings: AssistantContext["license_findings"] = section("absent"), assumptions: AssistantContext["assumptions"] = section("absent"), playbook: AssistantContext["playbook"] = section("absent");
    let alaReviewState: "absent" | "invalid" | null = "absent";
    if (input.ala) {
      const a = input.ala; const view = projectALAResults(a.outcome, a.captured_session, s);
      if (a.outcome && typeof a.outcome === "object" && Reflect.get(a.outcome, "status") === "error") ala = section("unavailable");
      else if (!("data" in view)) ala = section(view.state);
      else { const reviewed = a.review == null ? null : buildReviewedExport(view, a.review); alaReviewState = reviewed ? reviewed.ok ? null : "invalid" : "absent";
        const original = ALAAnalyzeOutcomeSchema.parse(a.outcome); if (original.status === "error") return fail();
        ala = { state: view.state, data: { original, reviewed: reviewed?.ok ? ReviewedALAExportSchema.parse(reviewed.artifact) : null } }; }
    }
    if (input.licenses) {
      const l = input.licenses, checked = inspectLicenseOutcome(l.outcome, l.captured_session, s);
      license_findings = l.outcome && typeof l.outcome === "object" && Reflect.get(l.outcome, "status") === "error" ? section("unavailable") : checked.status === "current" ? { state: checked.outcome.status === "success" ? "current" : "incomplete", data: checked.outcome } : section(checked.status);
    }
    if (input.assumptions) {
      const a = input.assumptions, raw = ScenarioFinancialDraftSchema.safeParse(a.draft), sameSession = isDeepStrictEqual(a.captured_session, s);
      const context = input.ala && prepareCSEContext(input.ala.outcome, input.ala.captured_session, s, input.ala.review);
      const built = context && raw.success && isDeepStrictEqual(raw.data, a.draft) && a.expected_review_digest === context.review_digest && buildEstimateRequest(context, raw.data);
      assumptions = !sameSession ? section("outdated") : built && built.ok && raw.success ? { state: built.request.horizon_years === null || built.request.lines.some(l => l.annual_run_rate === null || l.migration_one_time_cost === null || l.transition_overlap_cost === null) ? "incomplete" : "current", data: { visitor_draft: raw.data, normalized_request: built.request } } : section("invalid");
    }
    if (input.playbook) {
      const p = input.playbook, view = readPlaybookSource(p.source);
      if (!("data" in view)) playbook = section(view.state);
      else if (!matchesPlaybookReviewSession(p.source, s) || view.data.original.source.deal_digest !== hash(s.current_deal)) playbook = section("outdated");
      else { const review = p.review == null ? null : validatePlaybookReviewDraft(p.source, p.review);
        // An invalid proposed overlay never travels as a valid reviewed plan.
        const original = PlaybookOutcomeSchema.parse(view.data.original); if (original.status === "error") return fail();
        playbook = p.review != null && !review ? section("invalid") : { state: view.state, data: { original, selected_scenario: view.data.selected_scenario, review: review ? PlaybookReviewDraftSchema.parse(review) : null } }; }
    }
    const missing_context: AssistantContext["missing_context"] = [];
    for (const [name, value] of Object.entries({ ala, license_findings, assumptions, playbook }) as ["ala" | "license_findings" | "assumptions" | "playbook", typeof ala][]) if (value.state !== "current") missing_context.push({ section: name, state: value.state });
    if (alaReviewState) missing_context.push({ section: "ala_review", state: alaReviewState });
    if (!("data" in playbook) || !playbook.data.review) missing_context.push({ section: "playbook_review", state: "absent" });
    const body = { contract_version: ASSISTANT_CONTEXT_VERSION, illustrative_unapproved: true as const, disclosures: ASSISTANT_DISCLOSURES,
      source: { session_id: s.session_id, fixture: s.fixture, session_revision: s.session_revision, input_revisions: s.input_revisions, deal_digest: hash(s.current_deal) },
      deal: s.current_deal, ala, license_findings, assumptions, playbook, missing_context };
    const allowed_references = references(body);
    if (allowed_references.length > 400 || size({ context: body, allowed_references, system: ASSISTANT_CONTEXT_INSTRUCTIONS }) > MAX_INPUT_BYTES) return fail("request_too_large");
    const checked = AssistantContextSchema.safeParse({ ...body, allowed_references });
    return checked.success && isDeepStrictEqual(checked.data, { ...body, allowed_references }) ? { ok: true, context: freezeCSE(checked.data) } : fail();
  } catch { return fail(); }
}
const issued = new WeakMap<object, { read: AssistantSourceReader; revoked: boolean }>();
/** Domain context only, NOT an InvocationInput; never dispatches through any layer. */
export function buildAssistantContext(read: AssistantSourceReader): { ok: true; context: AssistantContext } | ReturnType<typeof fail> {
  try { if (typeof read !== "function") return fail(); const first = read(); if (!first) return fail("source_changed"); const built = assemble(first); if (!built.ok) return built;
    const latest = read(), again = latest && assemble(latest); if (!again || !again.ok || !isDeepStrictEqual(built.context, again.context)) return fail("source_changed");
    issued.set(built.context, { read, revoked: false }); return built;
  } catch { return fail("source_changed"); }
}
/** Call before/after every future await. Imported JSON cannot acquire ownership. */
export function isCurrentAssistantContext(context: unknown): context is AssistantContext {
  try { const owner = context && typeof context === "object" ? issued.get(context) : null; if (!owner || owner.revoked) return false;
    const latest = owner.read(), rebuilt = latest && assemble(latest); if (!rebuilt || !rebuilt.ok || !isDeepStrictEqual(context, rebuilt.context)) { owner.revoked = true; return false; } return true;
  } catch { if (context && typeof context === "object") { const owner = issued.get(context); if (owner) owner.revoked = true; } return false; }
}
/** Pure structured citation integrity, not answer/narrative validation. No repair. */
export function validateAssistantReferences(context: unknown, value: unknown): { ok: true; references: AssistantReference[] } | { ok: false; code: "invalid_source_references" } {
  const failRefs = { ok: false, code: "invalid_source_references" } as const;
  try { if (!isCurrentAssistantContext(context)) return failRefs;
    const parsed = AssistantReferencesSchema.safeParse(value); if (!parsed.success || !isDeepStrictEqual(parsed.data, value)) return failRefs;
    const keys = parsed.data.map(r => JSON.stringify(r)), known = new Set(context.allowed_references.map(r => JSON.stringify(r)));
    // Object key order is not semantic; compare strict structured objects.
    if (new Set(keys).size !== keys.length || parsed.data.some(r => !context.allowed_references.some(k => isDeepStrictEqual(k, r)))) return failRefs;
    if (!known.size || !isCurrentAssistantContext(context)) return failRefs;
    return { ok: true, references: freezeCSE(parsed.data) };
  } catch { return failRefs; }
}
