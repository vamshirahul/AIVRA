import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { DemoSessionSchema, MAX_SESSION_CHARACTERS } from "../../session/session.ts";
import { CSE_VERSION, CSERequestSchema, CSEContextSchema, MAX_CSE_BYTES, parseCSE, equalCSE } from "../../cost-synergy/calculation-contract.ts";
import type { CSEContext } from "../../cost-synergy/calculation-contract.ts";
import { calculateCSE } from "../../cost-synergy/calculation.ts";
import { matchesCSESource } from "../cost-synergy/reviewed-context.ts";
import { projectLicenseResults } from "./presentation.ts";
import { matchesLicenseSource } from "./request.ts";
import { validateLicenseSelectionDraft, licenseReviewIdentity, licenseReviewEntries } from "../../license-optimizer/review-selections.ts";
import { LICENSE_CSE_HANDOFF_VERSION, CSEOwnershipComparisonSchema, assessLicenseCandidates, licenseCostEvidence, licenseHandoffFailure, readLicenseCSEHandoff } from "../../license-optimizer/cse-handoff.ts";

const claimId = (kind: "l" | "c", identity: unknown) => `${kind}_${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 48)}`;
type ComparisonInput = { context: CSEContext; request: unknown };
/** Trusted outcomes/current contexts only. No public caller, model call, CSE mutation or result import. */
export function buildLicenseCSEHandoff(outcome: unknown, captured: unknown, current: unknown, inputReview: unknown, comparisonInput?: ComparisonInput) {
  try {
    const view = projectLicenseResults(outcome, captured, current);
    if (!("data" in view)) return licenseHandoffFailure(view.state === "outdated" ? "outdated" : view.state === "absent" ? "no_analysis" : "invalid_source");
    const review = validateLicenseSelectionDraft(view, inputReview); if (!review) return licenseHandoffFailure("invalid_selection");
    const snapshot = JSON.stringify(captured); if (typeof snapshot !== "string" || snapshot.length > MAX_SESSION_CHARACTERS) return licenseHandoffFailure("invalid_source");
    const source = DemoSessionSchema.safeParse(captured);
    if (!source.success || !equalCSE(source.data, captured) || !matchesLicenseSource(view.data.source_token, current)) return licenseHandoffFailure("invalid_source");
    const data = view.data, identity = licenseReviewIdentity(view)!;
    const byLicense = new Map(source.data.current_deal.license_positions.map((r) => [r.license_id, r]));
    const byApp = new Map(source.data.current_deal.applications.map((r) => [r.app_id, r]));
    let comparison: z.infer<typeof CSEOwnershipComparisonSchema> | null = null;
    if (comparisonInput !== undefined) {
      if (!comparisonInput || !equalCSE(Object.keys(comparisonInput).sort(), ["context", "request"])) return licenseHandoffFailure("invalid_comparison");
      const context = parseCSE(CSEContextSchema, comparisonInput.context), request = parseCSE(CSERequestSchema, comparisonInput.request);
      if (!context || !request || !context.reviewed || !context.review_digest || !matchesCSESource(context.source, current) || !equalCSE(context.source, { ...data.source_token, currency: data.currency }) || calculateCSE(request, comparisonInput.context).status === "invalid" || request.lines.some((r) => r.source_kind !== "ala")) return licenseHandoffFailure("invalid_comparison");
      comparison = { scope: "structural_whole_spend_comparison" as const, source: context.source, review_identity: context.reviewed.review.result_identity, review_digest: context.review_digest,
        claims: request.lines.filter((r) => r.included).map((r) => ({ source_line_id: r.line_id, claim: { line_id: claimId("c", [context.review_digest, r.line_id]), attribution_key: r.attribution_key, source_kind: "ala" as const, spend_app_ids: r.spend_app_ids } })) };
      if (!CSEOwnershipComparisonSchema.safeParse(comparison).success) return licenseHandoffFailure("invalid_comparison");
    }
    const candidates = licenseReviewEntries(view, review).filter((entry) => entry.selection?.status === "selected").map(({ finding, selection }) => {
      const f = finding.original;
      return { original: f, selection: selection!, claim: { line_id: claimId("l", [identity.request_id, f.finding_id]), attribution_key: `license/${identity.request_id}/${f.finding_id}`, source_kind: "license" as const, spend_app_ids: f.app_ids },
        ownership: f.license_ids.map((id) => ({ license_id: id, app_id: byLicense.get(id)!.app_id })),
        licenses: f.license_ids.map((id) => { const record = byLicense.get(id)!; return { record, annual_spend: licenseCostEvidence(record.annual_spend) }; }),
        applications: f.app_ids.map((id) => { const app = byApp.get(id)!; return { app_id: id, company_side: app.company_side, app_name: app.app_name, annual_cost: licenseCostEvidence(app.annual_cost) }; }), source_evidence: finding.source_evidence };
    });
    if (new TextEncoder().encode(JSON.stringify({ candidates, comparison })).length > MAX_CSE_BYTES) return licenseHandoffFailure("handoff_too_large");
    const assessment = assessLicenseCandidates(candidates, comparison); if (!assessment) return licenseHandoffFailure("ownership_limit_exceeded");
    return readLicenseCSEHandoff({ contract_version: LICENSE_CSE_HANDOFF_VERSION, target_contract: CSE_VERSION, source_module: "licenses", status: "provisional_unapproved", currency: data.currency,
      source_token: data.source_token, result_identity: identity, review_snapshot: review, provenance: data.provenance, coverage: data.coverage, not_evaluated: data.not_evaluated,
      selection_state: candidates.length ? "selected_opportunities" : "no_selected_opportunities", financial_aggregation: "withheld", comparison, ...assessment });
  } catch { return licenseHandoffFailure("invalid_handoff"); }
}

/** Rebuild against genuine current snapshots/review at consumption. A standalone reader is not freshness/authentication. */
export function validateCurrentLicenseCSEHandoff(input: unknown, outcome: unknown, captured: unknown, current: unknown, review: unknown, comparisonInput?: ComparisonInput) {
  const parsed = readLicenseCSEHandoff(input); if (!parsed.ok) return parsed;
  if (!matchesLicenseSource(parsed.handoff.source_token, current)) return licenseHandoffFailure("outdated");
  const expected = buildLicenseCSEHandoff(outcome, captured, current, review, comparisonInput); if (!expected.ok) return expected;
  return equalCSE(parsed.handoff, expected.handoff) ? expected : licenseHandoffFailure("invalid_handoff");
}
