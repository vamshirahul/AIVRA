import { z } from "zod";
import { ApplicationSchema, LicensePositionSchema } from "../contracts/demo.ts";
import { CSE_VERSION, CSESourceSchema, CSEReviewIdentitySchema, CostClaimSchema, CostConflictSchema, MinorSchema, MAX_CSE_BYTES, equalCSE, freezeCSE, parseCSE } from "../cost-synergy/calculation-contract.ts";
import { inspectCostClaims, sourceCostMinor } from "../cost-synergy/calculation.ts";
import type { LicenseResult } from "../server/licenses/schema.ts";

export const LICENSE_CSE_HANDOFF_VERSION = "licenses/cse-handoff/v1" as const;
const Id = z.string().min(1).max(128).regex(/^\S+$/), FindingId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const text = (max: number) => z.string().min(1).max(max).refine((v) => !!v.trim());
const Token = CSESourceSchema.omit({ currency: true });
const Identity = z.strictObject({ request_id: z.uuid(), input_digest: z.string().regex(/^[a-f0-9]{64}$/), prompt_version: z.literal("licenses/v1"), source_token: Token });
const Selection = z.strictObject({ finding_id: FindingId, status: z.enum(["selected", "not_selected"]), origin: z.literal("visitor_selection") });
const Review = z.strictObject({ schema_version: z.literal("licenses/review/v1"), result_identity: Identity, selections: z.array(Selection).max(100) });
// Client serialization shapes mirror licenses/v1. The server still uses the original inspector.
const OriginalFinding: z.ZodType<LicenseResult["findings"][number]> = z.strictObject({ finding_id: FindingId, category: text(120),
  license_ids: z.array(Id).min(1).max(200), app_ids: z.array(Id).min(1).max(100), suggested_action: text(400), rationale: text(800),
  evidence: z.array(z.strictObject({ license_id: Id, attribute: LicensePositionSchema.keyof() })).min(1).max(200),
  unknowns: z.array(text(200)).max(10), assumptions: z.array(text(200)).max(10),
  uncertainty: z.strictObject({ level: z.enum(["low", "medium", "high", "unknown"]), reason: text(400) }), review_required: z.literal(true) });
const Coverage = z.strictObject({ status: z.enum(["complete", "incomplete"]), reasons: z.array(z.enum(["missing_licenses", "not_evaluated_licenses"])).max(2),
  source_count: z.number().int().min(1).max(200), accounted_count: z.number().int().min(0).max(200),
  missing_license_ids: z.array(Id).max(200), not_evaluated_license_ids: z.array(Id).max(200), overlapping_license_ids: z.array(Id).max(200) });
const Provenance = z.strictObject({ module: z.literal("licenses"), model_provider: z.string().min(1).max(64).regex(/^[a-z0-9.-]+$/), model_id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:/-]+$/),
  request_id: z.uuid(), input_digest: z.string().regex(/^[a-f0-9]{64}$/), prompt_version: z.literal("licenses/v1"), generated_at: z.iso.datetime(), mode: z.enum(["paid", "fallback"]), routing_reason: z.enum(["budget_exhausted", "paid_unavailable"]).optional(),
  usage_estimate: z.strictObject({ input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(), total_tokens: z.number().int().nonnegative().nullable(), cost_usd: z.null() }),
  warnings: z.array(z.enum(["ai_generated_draft", "references_not_narrative_verification"])).max(2) });
export const CostEvidenceSchema = z.strictObject({ major_units: z.number().finite().nonnegative().nullable(), minor_units: MinorSchema.nullable(), state: z.enum(["known", "unknown", "unsupported_precision"]) })
  .superRefine((value, ctx) => { if (!equalCSE(value, licenseCostEvidence(value.major_units))) ctx.addIssue({ code: "custom", message: "Inconsistent source cost evidence" }); });
/** Evidence conversion only. No saving, assumption, horizon or aggregate is generated. */
export function licenseCostEvidence(value: number | null): { major_units: number | null; minor_units: number | null; state: "known" | "unknown" | "unsupported_precision" } {
  const minor = sourceCostMinor(value);
  return { major_units: value, minor_units: minor, state: value === null ? "unknown" : minor === null ? "unsupported_precision" : "known" };
}
export const LicenseCandidateCoreSchema = z.strictObject({
  original: OriginalFinding, selection: Selection.extend({ status: z.literal("selected") }), claim: CostClaimSchema.extend({ source_kind: z.literal("license") }),
  ownership: z.array(z.strictObject({ license_id: Id, app_id: Id })).min(1).max(200),
  licenses: z.array(z.strictObject({ record: LicensePositionSchema, annual_spend: CostEvidenceSchema })).min(1).max(200),
  applications: z.array(z.strictObject({ app_id: Id, company_side: z.enum(["buyer", "target"]), app_name: ApplicationSchema.shape.app_name.max(128000), annual_cost: CostEvidenceSchema })).min(1).max(100),
  source_evidence: z.array(z.strictObject({ license_id: Id, app_id: Id, attribute: LicensePositionSchema.keyof(), value: z.union([z.string(), z.number().finite(), z.null()]) })).min(1).max(200),
});
export const CSEOwnershipComparisonSchema = z.strictObject({ scope: z.literal("structural_whole_spend_comparison"), source: CSESourceSchema,
  review_identity: CSEReviewIdentitySchema, review_digest: z.string().regex(/^[a-f0-9]{64}$/),
  claims: z.array(z.strictObject({ source_line_id: FindingId, claim: CostClaimSchema.extend({ source_kind: z.literal("ala") }) })).max(200) });
const Withholding = z.enum(["withheld_overlap", "withheld_unknown_amount", "withheld_no_supported_assumption", "withheld_cse_license_source_unsupported"]);
const Candidate = LicenseCandidateCoreSchema.extend({ financial_eligibility: Withholding, withholding_reasons: z.array(Withholding).min(2).max(4) });
const SharedLicense = z.strictObject({ license_id: Id, finding_ids: z.array(FindingId).min(2).max(100) });
type Core = z.infer<typeof LicenseCandidateCoreSchema>;
type Comparison = z.infer<typeof CSEOwnershipComparisonSchema>;

/** Bounded ID membership assessment through the unchanged CSE guard. Not financial authorization. */
export function assessLicenseCandidates(input: unknown, compare: unknown = null) {
  const candidates = parseCSE(z.array(LicenseCandidateCoreSchema).max(100), input);
  const comparison = compare === null ? null : parseCSE(CSEOwnershipComparisonSchema, compare);
  if (!candidates || (compare !== null && !comparison)) return null;
  const conflicts = inspectCostClaims([...candidates.map((c) => c.claim), ...(comparison?.claims.map((c) => c.claim) ?? [])]);
  if (!conflicts) return null; // Existing combined <=200 claims / <=100 roots; never shrink or raise the guard.
  const membership = new Map<string, string[]>();
  for (const c of candidates) for (const id of c.original.license_ids) { const ids = membership.get(id) ?? []; ids.push(c.original.finding_id); membership.set(id, ids); }
  const shared = [...membership].filter(([, ids]) => ids.length > 1).map(([license_id, finding_ids]) => ({ license_id, finding_ids }));
  const implicated = new Set(conflicts.flatMap((c) => c.line_ids));
  const rows = candidates.map((c) => {
    const overlap = implicated.has(c.claim.line_id) || shared.some((s) => s.finding_ids.includes(c.original.finding_id));
    const unknown = [...c.licenses.map((r) => r.annual_spend), ...c.applications.map((r) => r.annual_cost)].some((e) => e.state !== "known");
    const reasons = [...(overlap ? ["withheld_overlap" as const] : []), ...(unknown ? ["withheld_unknown_amount" as const] : []), "withheld_no_supported_assumption" as const, "withheld_cse_license_source_unsupported" as const];
    return { ...c, financial_eligibility: overlap ? "withheld_overlap" as const : unknown ? "withheld_unknown_amount" as const : "withheld_cse_license_source_unsupported" as const, withholding_reasons: reasons };
  });
  return freezeCSE({ candidates: rows, ownership_conflicts: conflicts, selected_license_overlap: shared });
}

export const LicenseCSEHandoffSchema = z.strictObject({ contract_version: z.literal(LICENSE_CSE_HANDOFF_VERSION), target_contract: z.literal(CSE_VERSION), source_module: z.literal("licenses"), status: z.literal("provisional_unapproved"),
  source_token: Token, currency: z.literal("CAD"), result_identity: Identity, review_snapshot: Review, provenance: Provenance, coverage: Coverage,
  not_evaluated: z.array(z.strictObject({ license_id: Id, reason: text(400) })).max(200),
  selection_state: z.enum(["selected_opportunities", "no_selected_opportunities"]), financial_aggregation: z.literal("withheld"),
  comparison: CSEOwnershipComparisonSchema.nullable(), candidates: z.array(Candidate).max(100), ownership_conflicts: z.array(CostConflictSchema).max(300), selected_license_overlap: z.array(SharedLicense).max(200),
}).superRefine((h, ctx) => {
  const issue = () => ctx.addIssue({ code: "custom", message: "Inconsistent selected license handoff" });
  if (new TextEncoder().encode(JSON.stringify(h)).length > MAX_CSE_BYTES || !equalCSE(h.source_token, h.result_identity.source_token) || !equalCSE(h.result_identity, h.review_snapshot.result_identity) ||
      h.provenance.request_id !== h.result_identity.request_id || h.provenance.input_digest !== h.result_identity.input_digest || (h.provenance.mode === "fallback") !== (h.provenance.routing_reason !== undefined)) issue();
  const selections = h.review_snapshot.selections, selected = selections.filter((s) => s.status === "selected"), byFinding = new Map(h.candidates.map((c) => [c.original.finding_id, c]));
  if (new Set(selections.map((s) => s.finding_id)).size !== selections.length || byFinding.size !== h.candidates.length || selected.length !== h.candidates.length || selected.some((s) => !equalCSE(s, byFinding.get(s.finding_id)?.selection)) ||
      h.selection_state !== (selected.length ? "selected_opportunities" : "no_selected_opportunities")) issue();
  const allLicense = new Map<string, unknown>(), allApp = new Map<string, unknown>();
  let licenseReferences = 0, appReferences = 0, pointers = 0;
  for (const c of h.candidates) {
    const f = c.original, records = new Map(c.licenses.map((r) => [r.record.license_id, r]));
    if (!equalCSE(f.license_ids, c.licenses.map((r) => r.record.license_id)) || records.size !== f.license_ids.length || new Set(f.app_ids).size !== f.app_ids.length ||
        !equalCSE(f.app_ids, c.applications.map((r) => r.app_id)) || !equalCSE(c.claim.spend_app_ids, f.app_ids) || c.claim.attribution_key !== `license/${h.result_identity.request_id}/${f.finding_id}` || c.selection.finding_id !== f.finding_id) issue();
    const linked = new Set(c.licenses.map((r) => r.record.app_id));
    if (linked.size !== f.app_ids.length || f.app_ids.some((id) => !linked.has(id)) || !equalCSE(c.ownership, c.licenses.map((r) => ({ license_id: r.record.license_id, app_id: r.record.app_id })))) issue();
    for (const r of c.licenses) {
      if (r.record.annual_spend !== r.annual_spend.major_units || (allLicense.has(r.record.license_id) && !equalCSE(allLicense.get(r.record.license_id), r))) issue(); allLicense.set(r.record.license_id, r);
      if (!f.evidence.some((p) => p.license_id === r.record.license_id)) issue();
    }
    for (const a of c.applications) { if (allApp.has(a.app_id) && !equalCSE(allApp.get(a.app_id), a)) issue(); allApp.set(a.app_id, a); }
    if (!equalCSE(f.evidence, c.source_evidence.map(({ app_id: _, value: __, ...p }) => p)) || new Set(f.evidence.map((p) => JSON.stringify(p))).size !== f.evidence.length) issue();
    for (const e of c.source_evidence) { const r = records.get(e.license_id)?.record; if (!r || !Object.hasOwn(r, e.attribute) || r[e.attribute] === undefined || !equalCSE(r[e.attribute], e.value) || e.app_id !== r.app_id) issue(); }
    licenseReferences += f.license_ids.length; appReferences += f.app_ids.length; pointers += f.evidence.length;
  }
  if (licenseReferences > 400 || appReferences > 400 || pointers > 400 || allLicense.size > 200 || allApp.size > 100 || [...allLicense.keys()].some((id) => allApp.has(id))) issue();
  const missing = h.coverage.missing_license_ids, skipped = h.coverage.not_evaluated_license_ids;
  if (new Set([...missing, ...skipped]).size !== missing.length + skipped.length || new Set(h.coverage.overlapping_license_ids).size !== h.coverage.overlapping_license_ids.length ||
      [...missing, ...skipped].some((id) => allLicense.has(id)) || h.coverage.source_count - missing.length !== h.coverage.accounted_count || allLicense.size > h.coverage.accounted_count - skipped.length ||
      !equalCSE(skipped, h.not_evaluated.map((r) => r.license_id)) || h.coverage.status !== (missing.length || skipped.length ? "incomplete" : "complete") ||
      !equalCSE(h.coverage.reasons, [...(missing.length ? ["missing_licenses"] : []), ...(skipped.length ? ["not_evaluated_licenses"] : [])])) issue();
  if (h.comparison && (!equalCSE(h.comparison.source, { ...h.source_token, currency: h.currency }) || h.comparison.review_identity.source_revision !== h.source_token.application_revision || new Set(h.comparison.claims.map((c) => c.source_line_id)).size !== h.comparison.claims.length)) issue();
  const assessment = assessLicenseCandidates(h.candidates.map(({ financial_eligibility: _, withholding_reasons: __, ...c }) => c), h.comparison);
  if (!assessment || !equalCSE(assessment.candidates, h.candidates) || !equalCSE(assessment.ownership_conflicts, h.ownership_conflicts) || !equalCSE(assessment.selected_license_overlap, h.selected_license_overlap) || h.selected_license_overlap.some((s) => !h.coverage.overlapping_license_ids.includes(s.license_id))) issue();
});
export type LicenseCSEHandoff = Readonly<z.infer<typeof LicenseCSEHandoffSchema>>;
export type LicenseHandoffErrorCode = "no_analysis" | "invalid_source" | "outdated" | "invalid_selection" | "invalid_comparison" | "ownership_limit_exceeded" | "handoff_too_large" | "invalid_handoff";
export const licenseHandoffFailure = (code: LicenseHandoffErrorCode) => ({ ok: false as const, code, message: "No current validated provisional license handoff is available." });
/** Structural reader/consumer only, never an AI-authentication or import-to-session operation. */
export function readLicenseCSEHandoff(input: unknown) {
  try {
    const json = JSON.stringify(input); if (typeof json !== "string" || new TextEncoder().encode(json).length > MAX_CSE_BYTES) return licenseHandoffFailure("handoff_too_large");
    const value = parseCSE(LicenseCSEHandoffSchema, input); return value ? { ok: true as const, handoff: freezeCSE(value) } : licenseHandoffFailure("invalid_handoff");
  } catch { return licenseHandoffFailure("invalid_handoff"); }
}
