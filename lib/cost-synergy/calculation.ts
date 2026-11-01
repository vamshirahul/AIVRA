import { z } from "zod";
import { CSEContextSchema, CSERequestSchema, CSEResultSchema, CostClaimSchema, MAX_MINOR, CSE_VERSION, equalCSE, freezeCSE, parseCSE } from "./calculation-contract.ts";
import type { CSEContext, CSERequest, CSEResult, CSEReason, CostConflictSchema } from "./calculation-contract.ts";

/** Exact decimal-to-cents validation for source context only; never rounds or infers savings. */
export function sourceCostMinor(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value)); if (!match) return null;
  const cents = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents <= BigInt(MAX_MINOR) ? Number(cents) : null;
}
/** Generic whole-application spend ownership guard, reusable by a future validated license adapter. */
export function inspectCostClaims(input: unknown): readonly z.infer<typeof CostConflictSchema>[] | null {
  const claims = parseCSE(z.array(CostClaimSchema).max(200), input);
  if (!claims || new Set(claims.map((c) => c.line_id)).size !== claims.length ||
      new Set(claims.flatMap((c) => c.spend_app_ids)).size > 100 || claims.some((c) => new Set(c.spend_app_ids).size !== c.spend_app_ids.length)) return null;
  const attributes = new Map<string, string[]>(), spend = new Map<string, string[]>();
  for (const claim of claims) {
    const ids = attributes.get(claim.attribution_key) ?? []; ids.push(claim.line_id); attributes.set(claim.attribution_key, ids);
    for (const app of claim.spend_app_ids) { const owners = spend.get(app) ?? []; owners.push(claim.line_id); spend.set(app, owners); }
  }
  const conflicts: z.infer<typeof CostConflictSchema>[] = [
    ...[...attributes].filter(([, ids]) => ids.length > 1).map(([key, line_ids]) => ({ reason: "duplicate_attribution" as const, key, line_ids })),
    ...[...spend].filter(([, ids]) => ids.length > 1).map(([key, line_ids]) => ({ reason: "overlapping_spend" as const, key, line_ids })),
  ];
  return freezeCSE(conflicts);
}
const invalid = (code: Extract<CSEResult, { status: "invalid" }>["code"]): CSEResult => ({ contract_version: CSE_VERSION, status: "invalid", code, message: "The calculation inputs or current source contract could not be validated." });
const unknown = (reason: CSEReason) => ({ amount_minor: null, reason });
function checked(value: bigint): number {
  if (value > BigInt(MAX_MINOR) || value < -BigInt(MAX_MINOR)) throw new RangeError("Numeric bound"); return Number(value);
}

/** Pure illustration only. Context must come from current trusted server composition, not imported JSON.
 * Future owner must refresh that context when shared source/review changes; no state is written here.
 */
export function calculateCSE(input: unknown, trusted: CSEContext | null): CSEResult {
  try {
    const context = parseCSE(CSEContextSchema, trusted); if (!context) return invalid("invalid_context");
    const request = parseCSE(CSERequestSchema, input); if (!request) return invalid("invalid_input");
    if (!equalCSE(context.source, request.expected_source) || !equalCSE(request.review_identity, context.reviewed?.review.result_identity ?? null) || request.expected_review_digest !== context.review_digest) return invalid("source_mismatch");
    const byId = new Map(context.applications.map((a) => [a.app_id, a]));
    for (const line of request.lines) {
      if (line.spend_app_ids.some((id) => !byId.has(id))) return invalid("invalid_action_reference");
      if (!context.reviewed || line.source_kind !== "ala") continue;
      const ref = line.action_reference!;
      const action = context.reviewed.effective_actions.find((a) => a.finding_id === ref.finding_id && a.action_id === ref.action_id);
      const finding = context.reviewed.analysis.findings.find((f) => f.finding_id === ref.finding_id);
      if (!action || !finding || !equalCSE(action.subject, ref.subject) || !line.spend_app_ids.includes(ref.subject.app_id) ||
          line.spend_app_ids.some((id) => ![...finding.buyer_app_ids, ...finding.target_app_ids].includes(id))) return invalid("invalid_action_reference");
    }
    const included = request.lines.filter((l) => l.included);
    const conflicts = inspectCostClaims(included.map(({ line_id, attribution_key, source_kind, spend_app_ids }) => ({ line_id, attribution_key, source_kind, spend_app_ids })))!;
    const conflicted = new Set(conflicts.flatMap((c) => c.line_ids));
    const available = context.reviewed !== null;
    const lines = request.lines.map((line) => {
      const source_costs = line.spend_app_ids.map((id) => ({ app_id: id, annual_cost_major: byId.get(id)!.annual_cost, annual_cost_minor: sourceCostMinor(byId.get(id)!.annual_cost) }));
      const blocked: CSEReason | null = !available ? "analysis_unavailable" : line.source_kind === "license" ? "unsupported_license_source" : conflicted.has(line.line_id) ? "cost_conflict" : null;
      function component(value: { amount_minor: number | null; basis: string } | null | undefined, annual = false) {
        if (!line.included) return { amount_minor: null, reason: null };
        if (blocked) return unknown(blocked);
        if (!value || value.amount_minor === null) return unknown("missing_amount");
        if (value.basis !== "visitor_assumption") return unknown("unsupported_basis");
        if (annual && source_costs.some((c) => c.annual_cost_major === null)) return unknown("missing_application_cost");
        if (annual && source_costs.some((c) => c.annual_cost_minor === null)) return unknown("unsupported_source_cost");
        return { amount_minor: value.amount_minor, reason: null };
      }
      const annual = component(line.annual_run_rate, true), migration = component(line.migration_one_time_cost), transition = component(line.transition_overlap_cost);
      const reasons = [...new Set([annual.reason, migration.reason, transition.reason].filter((r): r is CSEReason => r !== null))];
      return { line_id: line.line_id, state: !line.included ? "excluded" as const : blocked === "cost_conflict" ? "conflicting" as const : blocked ? "unsupported" as const : reasons.length ? "unknown" as const : "included" as const,
        reasons, annual, migration, transition, source_costs };
    });
    const selected = lines.filter((l) => request.lines.find((r) => r.line_id === l.line_id)!.included);
    const aggregate = (key: "annual" | "migration" | "transition"): number | null => {
      if (!selected.length || selected.some((l) => l[key].amount_minor === null)) return null;
      return checked(selected.reduce((sum, l) => sum + BigInt(l[key].amount_minor!), BigInt(0)));
    };
    const annual = aggregate("annual"), migration = aggregate("migration"), transition = aggregate("transition");
    const oneTime = migration === null || transition === null ? null : checked(BigInt(migration) + BigInt(transition));
    const horizon = request.horizon_years ?? null;
    const horizonSavings = annual === null || horizon === null ? null : checked(BigInt(annual) * BigInt(horizon));
    const net = horizonSavings === null || oneTime === null ? null : checked(BigInt(horizonSavings) - BigInt(oneTime));
    const warnings: CSEReason[] = [...new Set([
      ...(!selected.length ? ["no_included_lines" as const] : []), ...(!available ? ["analysis_unavailable" as const] : []),
      ...(context.analysis_state === "incomplete" ? ["analysis_incomplete" as const] : []), ...(horizon === null ? ["missing_horizon" as const] : []), ...selected.flatMap((l) => l.reasons),
    ])];
    const status = [annual, migration, transition].every((n) => n === null) ? "not_computable" : warnings.length ? "incomplete" : "computed";
    const result = { contract_version: CSE_VERSION, status, illustrative_unapproved: true, currency: "CAD", money_unit: "minor_units", assumptions: request, context,
      lines, conflicts, warnings, totals: { annual_recurring_savings_minor: annual, migration_one_time_cost_minor: migration, transition_overlap_cost_minor: transition,
        one_time_total_minor: oneTime, horizon_recurring_savings_minor: horizonSavings, illustrative_net_benefit_minor: net, horizon_years: horizon } };
    const parsed = parseCSE(CSEResultSchema, result); return parsed ? freezeCSE(parsed) : invalid("invalid_input");
  } catch (error) { return invalid(error instanceof RangeError ? "numeric_overflow" : "invalid_input"); }
}
