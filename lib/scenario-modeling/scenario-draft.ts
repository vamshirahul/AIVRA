import { z } from "zod";
import { DEMO_SCHEMA_VERSION } from "../contracts/demo.ts";
import { CSEContextSchema, CSERequestSchema, CSESourceSchema, CSEReviewIdentitySchema, CSEActionReferenceSchema, CSELineSchema, equalCSE, freezeCSE, parseCSE } from "../cost-synergy/calculation-contract.ts";
import type { CSEContext } from "../cost-synergy/calculation-contract.ts";
import { buildEstimateRequest } from "../cost-synergy/estimate-form.ts";
import type { EstimateDraft } from "../cost-synergy/estimate-form.ts";
import { ReviewedALAExportSchema, buildReviewedExport } from "../ala/review-export.ts";
import { REVIEW_DISPOSITIONS, validateReviewDraft, saveReviewOverride, reviewActionKey } from "../ala/review-overrides.ts";
import type { ReviewDraft, ReviewErrors } from "../ala/review-overrides.ts";
import type { ALAResultsView } from "../ala/results-view.ts";

export const SCENARIO_VERSION = "scenario/draft/v1" as const;
const MoneyDraft = z.strictObject({ amount: z.string().max(32), note: z.string().max(400) });
export const ScenarioFinancialLineSchema = z.strictObject({ line_id: CSELineSchema.shape.line_id, included: z.boolean(), annual_run_rate: MoneyDraft, migration_one_time_cost: MoneyDraft, transition_overlap_cost: MoneyDraft });
export const ScenarioFinancialDraftSchema = z.strictObject({ horizon: z.string().max(3), actions: z.array(ScenarioFinancialLineSchema).max(200) });
export const ScenarioActionEditSchema = CSEActionReferenceSchema.extend({ disposition: z.enum(REVIEW_DISPOSITIONS), destination: CSEActionReferenceSchema.shape.subject.nullable(), scenario_reason: z.string().max(400) });
export const ScenarioDraftSchema = z.strictObject({ contract_version: z.literal(SCENARIO_VERSION), status: z.literal("provisional_unapproved"),
  source_binding: z.strictObject({ source: CSESourceSchema, fixture_schema_version: z.literal(DEMO_SCHEMA_VERSION), review_identity: CSEReviewIdentitySchema, review_digest: z.string().regex(/^[a-f0-9]{64}$/) }),
  baseline: z.strictObject({ actions: ReviewedALAExportSchema.shape.effective_actions, financial_draft: ScenarioFinancialDraftSchema, financial_request: CSERequestSchema }),
  alternative: z.strictObject({ action_edits: z.array(ScenarioActionEditSchema).max(200), financial_draft: ScenarioFinancialDraftSchema, financial_request: CSERequestSchema }),
});
export type ScenarioDraft = z.infer<typeof ScenarioDraftSchema>;
export type ScenarioActionEdit = z.infer<typeof ScenarioActionEditSchema>;
/** Protected in-memory inputs, never imported files or a new trusted projection.
 * The original ALA projection is supplied alongside its matching CSE context so
 * existing review validators can be reused without casting JSON into trusted views.
 */
export type ScenarioSource = { context: CSEContext; view: ALAResultsView; financial_draft: EstimateDraft };
export type ScenarioOperation = { ok: true; scenario: ScenarioDraft } | { ok: false; errors: Record<string, string> };
const fail = (errors: Record<string, string> = { form: "No valid current reviewed baseline or scenario draft is available." }): ScenarioOperation => ({ ok: false, errors });

function sourceBaseline(input: ScenarioSource) {
  const context = parseCSE(CSEContextSchema, input.context), raw = parseCSE(ScenarioFinancialDraftSchema, input.financial_draft);
  if (!context?.reviewed || !context.review_digest || !raw) return null;
  const reviewed = buildReviewedExport(input.view, context.reviewed.review);
  if (!reviewed.ok || !equalCSE(reviewed.artifact, context.reviewed)) return null;
  const request = buildEstimateRequest(input.context, raw); if (!request.ok) return null;
  return { source_binding: { source: context.source, fixture_schema_version: DEMO_SCHEMA_VERSION, review_identity: context.reviewed.review.result_identity, review_digest: context.review_digest },
    baseline: { actions: context.reviewed.effective_actions, financial_draft: raw, financial_request: request.request } };
}
export function scenarioSourceKey(input: ScenarioSource): string { return JSON.stringify({ context: input.context, financial_draft: input.financial_draft }); }
export function isScenarioSource(input: ScenarioSource): boolean { try { return sourceBaseline(input) !== null; } catch { return false; } }

/** Compose a disposable validation overlay only. Never publish scenario hypotheses
 * into original ALA review or manufacture a new CSE review digest.
 */
function composedReview(input: ScenarioSource, edits: ScenarioActionEdit[]): ReviewDraft | null {
  const reviewed = input.context.reviewed; if (!reviewed) return null;
  const overrides = [...reviewed.review.overrides];
  const keys = new Set<string>();
  for (const edit of edits) {
    const key = reviewActionKey(edit.finding_id, edit.action_id), action = reviewed.effective_actions.find((a) => a.finding_id === edit.finding_id && a.action_id === edit.action_id);
    if (keys.has(key) || !action || !equalCSE(action.subject, edit.subject) || !edit.scenario_reason.trim() || equalCSE(action.effective, { disposition: edit.disposition, destination: edit.destination })) return null;
    keys.add(key);
    const index = overrides.findIndex((o) => reviewActionKey(o.finding_id, o.action_id) === key); if (index >= 0) overrides.splice(index, 1);
    if (!equalCSE({ disposition: action.original.disposition, destination: action.original.destination }, { disposition: edit.disposition, destination: edit.destination })) overrides.push({ finding_id: edit.finding_id, action_id: edit.action_id, subject: edit.subject, proposed_disposition: edit.disposition, proposed_destination: edit.destination, visitor_reason: edit.scenario_reason, origin: "visitor_override" });
  }
  return validateReviewDraft(input.view, { result_identity: reviewed.review.result_identity, overrides });
}

/** Rebuild source binding and baseline before any read/update. Structural schema
 * parsing alone is not source validation or authentication of an AI execution.
 */
export function validateCurrentScenario(input: ScenarioSource, value: unknown): ScenarioDraft | null {
  try {
    const expected = sourceBaseline(input), s = parseCSE(ScenarioDraftSchema, value);
    if (!expected || !s || !equalCSE(expected.source_binding, s.source_binding) || !equalCSE(expected.baseline, s.baseline) || !composedReview(input, s.alternative.action_edits)) return null;
    const financial = buildEstimateRequest(input.context, s.alternative.financial_draft);
    return financial.ok && equalCSE(financial.request, s.alternative.financial_request) ? freezeCSE(s) : null;
  } catch { return null; }
}
export function cloneBaseline(input: ScenarioSource, existing: unknown = null): ScenarioOperation {
  try {
    if (existing !== null) { const current = validateCurrentScenario(input, existing); return current ? { ok: true, scenario: current } : fail(); }
    const base = sourceBaseline(input); if (!base) return fail();
    const detached = structuredClone({ contract_version: SCENARIO_VERSION, status: "provisional_unapproved", ...base,
      alternative: { action_edits: [], financial_draft: base.baseline.financial_draft, financial_request: base.baseline.financial_request } });
    // structuredClone preserves aliases within one object graph; explicitly detach
    // alternative nested collections from the immutable baseline as well.
    detached.alternative = structuredClone(detached.alternative);
    const checked = validateCurrentScenario(input, detached); return checked ? { ok: true, scenario: checked } : fail();
  } catch { return fail(); }
}
function commit(input: ScenarioSource, scenario: ScenarioDraft): ScenarioOperation { const checked = validateCurrentScenario(input, scenario); return checked ? { ok: true, scenario: checked } : fail(); }
export function editAlternativeAction(input: ScenarioSource, value: unknown, proposal: unknown): ScenarioOperation {
  const current = validateCurrentScenario(input, value), parsed = ScenarioActionEditSchema.safeParse(proposal);
  if (!current || !parsed.success) return fail({ form: "The alternative action/reference or bounded justification is invalid." });
  const edit = parsed.data, baseline = current.baseline.actions.find((a) => a.finding_id === edit.finding_id && a.action_id === edit.action_id);
  if (!baseline || !equalCSE(baseline.subject, edit.subject)) return fail();
  const restore = equalCSE(baseline.effective, { disposition: edit.disposition, destination: edit.destination });
  if (!restore && !edit.scenario_reason.trim()) return fail({ reason: "Give a nonblank scenario justification (at most 400 characters)." });
  const validation = saveReviewOverride(input.view, composedReview(input, current.alternative.action_edits), { result_identity: current.source_binding.review_identity, finding_id: edit.finding_id, action_id: edit.action_id, subject: edit.subject, proposed_disposition: edit.disposition, proposed_destination: edit.destination, visitor_reason: restore ? baseline.visitor_reason ?? "" : edit.scenario_reason });
  if (!validation.ok) return fail(validation.errors as Record<string, string>);
  const next = structuredClone(current), key = reviewActionKey(edit.finding_id, edit.action_id);
  const index = next.alternative.action_edits.findIndex((e) => reviewActionKey(e.finding_id, e.action_id) === key);
  if (index >= 0) next.alternative.action_edits.splice(index, 1);
  if (!restore) next.alternative.action_edits.splice(index < 0 ? next.alternative.action_edits.length : index, 0, edit);
  return commit(input, next);
}
export function restoreAlternativeAction(input: ScenarioSource, value: unknown, reference: unknown): ScenarioOperation {
  const current = validateCurrentScenario(input, value), ref = CSEActionReferenceSchema.safeParse(reference); if (!current || !ref.success) return fail();
  const baseline = current.baseline.actions.find((a) => a.finding_id === ref.data.finding_id && a.action_id === ref.data.action_id && equalCSE(a.subject, ref.data.subject)); if (!baseline) return fail();
  return editAlternativeAction(input, current, { ...ref.data, ...baseline.effective, scenario_reason: "" });
}
export function editAlternativeFinancialInput(input: ScenarioSource, value: unknown, line: unknown): ScenarioOperation {
  const current = validateCurrentScenario(input, value), row = ScenarioFinancialLineSchema.safeParse(line); if (!current || !row.success) return fail();
  const next = structuredClone(current), index = next.alternative.financial_draft.actions.findIndex((a) => a.line_id === row.data.line_id); if (index < 0) return fail();
  next.alternative.financial_draft.actions[index] = row.data;
  const built = buildEstimateRequest(input.context, next.alternative.financial_draft); if (!built.ok) return fail(built.errors);
  next.alternative.financial_request = built.request; return commit(input, next);
}
export function restoreAlternativeFinancialInput(input: ScenarioSource, value: unknown, line_id: string): ScenarioOperation {
  const current = validateCurrentScenario(input, value), row = current?.baseline.financial_draft.actions.find((a) => a.line_id === line_id); return row ? editAlternativeFinancialInput(input, current, row) : fail();
}
export function editAlternativeHorizon(input: ScenarioSource, value: unknown, horizon: string): ScenarioOperation {
  const current = validateCurrentScenario(input, value); if (!current) return fail();
  const next = structuredClone(current); next.alternative.financial_draft.horizon = horizon;
  const built = buildEstimateRequest(input.context, next.alternative.financial_draft); if (!built.ok) return fail(built.errors);
  next.alternative.financial_request = built.request; return commit(input, next);
}
export function resetAlternative(input: ScenarioSource, value: unknown): ScenarioOperation { return validateCurrentScenario(input, value) ? cloneBaseline(input) : fail(); }
export function scenarioChanges(s: ScenarioDraft) {
  return { action_ids: s.alternative.action_edits.map((e) => e.action_id), financial_line_ids: s.alternative.financial_draft.actions.filter((r, i) => !equalCSE(r, s.baseline.financial_draft.actions[i])).map((r) => r.line_id), horizon_changed: s.baseline.financial_draft.horizon !== s.alternative.financial_draft.horizon };
}
