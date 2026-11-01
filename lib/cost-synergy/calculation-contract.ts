import { z } from "zod";
import { ApplicationSchema } from "../contracts/demo.ts";
import { ReviewedALAExportSchema } from "../ala/review-export.ts";

export const CSE_VERSION = "cse/calculation/v1" as const;
export const MAX_CSE_BYTES = 1_500_000;
export const MAX_MINOR = 1_000_000_000_000; // CAD cents; bounds apply to inputs AND every aggregate.
const Id = z.string().min(1).max(128).regex(/^\S+$/);
const ActionId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const note = z.string().min(1).max(400).refine((v) => !!v.trim());
export const MinorSchema = z.number().int().min(0).max(MAX_MINOR);
export const CSESourceSchema = z.strictObject({
  session_id: z.uuid(), fixture_id: Id, fixture_dataset_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  application_revision: z.number().int().nonnegative(), license_revision: z.number().int().nonnegative(),
  source_digest: z.string().regex(/^[a-f0-9]{64}$/), currency: z.literal("CAD"),
});
export const CSEReviewIdentitySchema = ReviewedALAExportSchema.shape.review.shape.result_identity;
export const CSEContextSchema = z.strictObject({
  contract_version: z.literal(CSE_VERSION), source: CSESourceSchema,
  analysis_state: z.enum(["current", "incomplete", "absent", "outdated", "invalid"]),
  applications: z.array(ApplicationSchema).min(2).max(100), reviewed: ReviewedALAExportSchema.nullable(), review_digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).superRefine((c, ctx) => {
  const issue = () => ctx.addIssue({ code: "custom", message: "Inconsistent CSE source/review context" });
  if (new Set(c.applications.map((a) => a.app_id)).size !== c.applications.length || c.applications.some((a) => !Id.safeParse(a.app_id).success) ||
      ["buyer", "target"].some((side) => !c.applications.some((a) => a.company_side === side) || c.applications.filter((a) => a.company_side === side).length > 50)) issue();
  if (["current", "incomplete"].includes(c.analysis_state) !== (c.reviewed !== null)) issue();
  if ((c.reviewed !== null) !== (c.review_digest !== null)) issue();
  if (!c.reviewed) return;
  const a = c.reviewed.analysis, byId = new Map(c.applications.map((r) => [r.app_id, r]));
  if (a.source_revision !== c.source.application_revision || a.currency !== c.source.currency || c.analysis_state !== (a.coverage.status === "complete" ? "current" : "incomplete")) issue();
  const members = [...a.findings.flatMap((f) => [...f.buyer.map((r) => ({ ...r, side: "buyer" })), ...f.target.map((r) => ({ ...r, side: "target" }))]), ...a.missing, ...a.not_evaluated];
  if (new Set(members.map((r) => r.app_id)).size !== c.applications.length) issue();
  for (const r of members) { const app = byId.get(r.app_id); if (!app || app.company_side !== r.side || ("name" in r && app.app_name !== r.name)) issue(); }
  for (const f of a.findings) for (const e of f.source_evidence) if (!equalCSE(byId.get(e.app_id)?.[e.attribute], e.value)) issue();
});
declare const trustedContext: unique symbol;
/** Granted by the server composition seam only; neither schema nor brand authenticates inference. */
export type CSEContext = Readonly<z.infer<typeof CSEContextSchema>> & { readonly [trustedContext]: true };
export const CSEActionReferenceSchema = z.strictObject({ finding_id: ActionId, action_id: ActionId,
  subject: z.strictObject({ app_id: Id, side: z.enum(["buyer", "target"]) }) });
const money = (unit: "minor_units_per_year" | "minor_units_once") => z.strictObject({
  amount_minor: MinorSchema.nullable(), currency: z.literal("CAD"), unit: z.literal(unit),
  basis: z.enum(["visitor_assumption", "unsupported"]), basis_note: note,
});
export const AnnualSavingsSchema = money("minor_units_per_year");
export const OneTimeCostSchema = money("minor_units_once");
export const CostClaimSchema = z.strictObject({ line_id: ActionId, attribution_key: Id,
  source_kind: z.enum(["ala", "license"]), spend_app_ids: z.array(Id).min(1).max(100) });
export const CSELineSchema = CostClaimSchema.extend({
  included: z.boolean(), action_reference: CSEActionReferenceSchema.nullable(),
  annual_run_rate: AnnualSavingsSchema.nullish(), migration_one_time_cost: OneTimeCostSchema.nullish(), transition_overlap_cost: OneTimeCostSchema.nullish(),
});
export const CSERequestSchema = z.strictObject({ contract_version: z.literal(CSE_VERSION), expected_source: CSESourceSchema,
  review_identity: CSEReviewIdentitySchema.nullable(), expected_review_digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  horizon_years: z.number().int().min(1).max(30).nullish(), lines: z.array(CSELineSchema).max(200),
}).superRefine((r, ctx) => {
  if (new Set(r.lines.map((l) => l.line_id)).size !== r.lines.length || r.lines.some((l) => new Set(l.spend_app_ids).size !== l.spend_app_ids.length || (l.source_kind === "ala" ? !l.action_reference : l.action_reference !== null))) ctx.addIssue({ code: "custom", message: "Duplicate line/source identity or unsupported reference shape" });
});
export type CSERequest = z.infer<typeof CSERequestSchema>;
export const CSEReasonSchema = z.enum(["no_included_lines", "analysis_unavailable", "analysis_incomplete", "missing_horizon", "missing_amount", "missing_application_cost", "unsupported_source_cost", "unsupported_basis", "unsupported_license_source", "cost_conflict"]);
export const CostConflictSchema = z.strictObject({ reason: z.enum(["duplicate_attribution", "overlapping_spend"]), key: Id, line_ids: z.array(ActionId).min(2).max(200) });
const Component = z.strictObject({ amount_minor: MinorSchema.nullable(), reason: CSEReasonSchema.nullable() });
const Totals = z.strictObject({ annual_recurring_savings_minor: MinorSchema.nullable(), migration_one_time_cost_minor: MinorSchema.nullable(),
  transition_overlap_cost_minor: MinorSchema.nullable(), one_time_total_minor: MinorSchema.nullable(),
  horizon_recurring_savings_minor: MinorSchema.nullable(),
  illustrative_net_benefit_minor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR).nullable(), horizon_years: z.number().int().min(1).max(30).nullable() });
const Invalid = z.strictObject({ contract_version: z.literal(CSE_VERSION), status: z.literal("invalid"),
  code: z.enum(["invalid_input", "invalid_context", "source_mismatch", "invalid_action_reference", "numeric_overflow"]), message: z.literal("The calculation inputs or current source contract could not be validated.") });
const Valid = z.strictObject({ contract_version: z.literal(CSE_VERSION), status: z.enum(["computed", "incomplete", "not_computable"]),
  illustrative_unapproved: z.literal(true), currency: z.literal("CAD"), money_unit: z.literal("minor_units"),
  assumptions: CSERequestSchema, context: CSEContextSchema,
  lines: z.array(z.strictObject({ line_id: ActionId, state: z.enum(["included", "excluded", "unknown", "conflicting", "unsupported"]),
    reasons: z.array(CSEReasonSchema).max(12), annual: Component, migration: Component, transition: Component,
    source_costs: z.array(z.strictObject({ app_id: Id, annual_cost_major: z.number().finite().nonnegative().nullable(), annual_cost_minor: MinorSchema.nullable() })).max(100),
  })).max(200), conflicts: z.array(CostConflictSchema).max(300), warnings: z.array(CSEReasonSchema).max(12), totals: Totals,
});
export const CSEResultSchema = z.union([Invalid, Valid]).superRefine((r, ctx) => {
  if (r.status !== "invalid" && ((r.status === "computed" && (r.context.analysis_state !== "current" || r.totals.illustrative_net_benefit_minor === null || r.warnings.length > 0)) ||
      (r.status === "not_computable" && Object.entries(r.totals).some(([key, value]) => key !== "horizon_years" && value !== null)))) ctx.addIssue({ code: "custom", message: "Invalid calculation result state" });
});
export type CSEResult = z.infer<typeof CSEResultSchema>;
export type CSEReason = z.infer<typeof CSEReasonSchema>;
export function equalCSE(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && equalCSE((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
export function freezeCSE<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freezeCSE); Object.freeze(value); } return value;
}
export function parseCSE<T>(schema: z.ZodType<T>, input: unknown): T | null {
  try {
    const json = JSON.stringify(input); if (typeof json !== "string" || new TextEncoder().encode(json).length > MAX_CSE_BYTES) return null;
    const result = schema.safeParse(input); return result.success && equalCSE(result.data, input) ? result.data : null;
  } catch { return null; }
}
