import { z } from "zod";
import { CSEResultSchema, MAX_MINOR, equalCSE, freezeCSE, parseCSE } from "../cost-synergy/calculation-contract.ts";
import { calculateCSE } from "../cost-synergy/calculation.ts";
import { ScenarioDraftSchema, ScenarioActionEditSchema, ScenarioFinancialLineSchema, validateCurrentScenario, scenarioChanges } from "./scenario-draft.ts";
import type { ScenarioSource } from "./scenario-draft.ts";

export const COMPARISON_VERSION = "scenario/comparison/v1" as const;
export const COMPARISON_METRICS = ["annual_recurring_savings_minor", "migration_one_time_cost_minor", "transition_overlap_cost_minor", "one_time_total_minor", "horizon_recurring_savings_minor", "illustrative_net_benefit_minor"] as const;
export type ComparisonMetric = typeof COMPARISON_METRICS[number];
const Id = ScenarioFinancialLineSchema.shape.line_id;
const delta = z.strictObject({ amount_minor: z.number().int().min(-2 * MAX_MINOR).max(2 * MAX_MINOR).nullable(), reason: z.enum(["unknown_amount", "different_horizon"]).nullable() });
export const ScenarioComparisonSchema = z.strictObject({ contract_version: z.literal(COMPARISON_VERSION), illustrative_unapproved: z.literal(true), currency: z.literal("CAD"), money_unit: z.literal("minor_units"),
  status: z.enum(["computed", "incomplete", "not_computable"]), source_binding: ScenarioDraftSchema.shape.source_binding,
  baseline_result: CSEResultSchema.refine((r) => r.status !== "invalid"), alternative_result: CSEResultSchema.refine((r) => r.status !== "invalid"),
  interpretation: z.literal("explicit_visitor_amounts_only_hypotheses_not_priced"),
  horizons: z.strictObject({ baseline: z.number().int().min(1).max(30).nullable(), alternative: z.number().int().min(1).max(30).nullable(), comparable: z.boolean() }),
  differences: z.strictObject({ annual_recurring_savings_minor: delta, migration_one_time_cost_minor: delta, transition_overlap_cost_minor: delta, one_time_total_minor: delta, horizon_recurring_savings_minor: delta, illustrative_net_benefit_minor: delta }),
  changed_actions: z.array(ScenarioActionEditSchema.extend({ baseline_effective: ScenarioActionEditSchema.pick({ disposition: true, destination: true }), interpretation: z.literal("hypothetical_not_ai_generated") })).max(200),
  changes: z.strictObject({ action_ids: z.array(Id).max(200), financial_line_ids: z.array(Id).max(200), horizon_changed: z.boolean() }),
  financial_changes: z.array(z.strictObject({ line_id: Id, baseline: ScenarioFinancialLineSchema, alternative: ScenarioFinancialLineSchema })).max(200),
  unquantified_action_ids: z.array(Id).max(200),
  warnings: z.array(z.enum(["incomplete_calculation", "unavailable_calculation", "different_horizons", "hypotheses_not_priced", "action_without_financial_adjustment", "license_aggregation_withheld"])).max(6),
});
export type ScenarioComparison = z.infer<typeof ScenarioComparisonSchema>;
type ComparisonFailure = { ok: false; code: "invalid_scenario" | "invalid_calculation" | "invalid_comparison"; message: string };
const failure = (code: ComparisonFailure["code"]): ComparisonFailure => ({ ok: false, code, message: "No valid current scenario comparison is available. Review the source and explicit financial assumptions." });
/** Exact subtraction only. Net outcomes lie within ±MAX_MINOR, so two valid
 * outcomes can differ by 2*MAX_MINOR; this does not raise any CSE input/total cap.
 */
export function subtractComparable(baseline: number | null, alternative: number | null, comparable = true) {
  if (baseline === null || alternative === null) return { amount_minor: null, reason: "unknown_amount" as const };
  if (!comparable) return { amount_minor: null, reason: "different_horizon" as const };
  if (![baseline, alternative].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= MAX_MINOR)) throw Error("Unsupported comparison input");
  const value = BigInt(alternative) - BigInt(baseline), limit = BigInt(MAX_MINOR) * BigInt(2);
  if (value > limit || value < -limit) throw Error("Difference exceeds bound");
  return { amount_minor: Number(value), reason: null };
}
/** Protected current source only. Never change context/review identity to fit a
 * hypothesis: the original calculator sees explicit amounts and original references.
 */
export function compareScenarios(source: ScenarioSource, input: unknown): { ok: true; comparison: ScenarioComparison } | ComparisonFailure {
  try {
    const scenario = validateCurrentScenario(source, input); if (!scenario) return failure("invalid_scenario");
    const baseline = calculateCSE(scenario.baseline.financial_request, source.context), alternative = calculateCSE(scenario.alternative.financial_request, source.context);
    if (baseline.status === "invalid" || alternative.status === "invalid") return failure("invalid_calculation");
    const comparable = baseline.totals.horizon_years !== null && baseline.totals.horizon_years === alternative.totals.horizon_years;
    const differences = Object.fromEntries(COMPARISON_METRICS.map((key) => [key, subtractComparable(baseline.totals[key], alternative.totals[key], key === "horizon_recurring_savings_minor" || key === "illustrative_net_benefit_minor" ? comparable : true)]));
    const changes = scenarioChanges(scenario), changed_actions = scenario.alternative.action_edits.map((e) => ({ ...e, baseline_effective: scenario.baseline.actions.find((a) => a.action_id === e.action_id)!.effective, interpretation: "hypothetical_not_ai_generated" as const }));
    const financial_changes = changes.financial_line_ids.map((line_id) => ({ line_id, baseline: scenario.baseline.financial_draft.actions.find((a) => a.line_id === line_id)!, alternative: scenario.alternative.financial_draft.actions.find((a) => a.line_id === line_id)! }));
    const amounts = (line: typeof scenario.baseline.financial_request.lines[number]) => ({ included: line.included, annual: line.annual_run_rate?.amount_minor ?? null, migration: line.migration_one_time_cost?.amount_minor ?? null, transition: line.transition_overlap_cost?.amount_minor ?? null });
    const unquantified_action_ids = changed_actions.filter((e) => equalCSE(amounts(scenario.baseline.financial_request.lines.find((l) => l.line_id === e.action_id)!), amounts(scenario.alternative.financial_request.lines.find((l) => l.line_id === e.action_id)!))).map((e) => e.action_id);
    const unavailable = baseline.status === "not_computable" || alternative.status === "not_computable", incomplete = baseline.status === "incomplete" || alternative.status === "incomplete";
    const value = { contract_version: COMPARISON_VERSION, illustrative_unapproved: true, currency: "CAD", money_unit: "minor_units", status: unavailable ? "not_computable" : incomplete || !comparable ? "incomplete" : "computed", source_binding: scenario.source_binding,
      baseline_result: baseline, alternative_result: alternative, interpretation: "explicit_visitor_amounts_only_hypotheses_not_priced", horizons: { baseline: baseline.totals.horizon_years, alternative: alternative.totals.horizon_years, comparable }, differences, changed_actions, changes, financial_changes, unquantified_action_ids,
      warnings: [...(incomplete ? ["incomplete_calculation"] : []), ...(unavailable ? ["unavailable_calculation"] : []), ...(!comparable ? ["different_horizons"] : []), ...(changed_actions.length ? ["hypotheses_not_priced"] : []), ...(unquantified_action_ids.length ? ["action_without_financial_adjustment"] : []), "license_aggregation_withheld"] };
    const checked = parseCSE(ScenarioComparisonSchema, value); return checked ? { ok: true, comparison: freezeCSE(checked) } : failure("invalid_comparison");
  } catch { return failure("invalid_comparison"); }
}
/** Future internal consumption check only; no file reader or trust promotion. */
export function validateCurrentComparison(source: ScenarioSource, scenario: unknown, value: unknown): ScenarioComparison | null {
  const checked = parseCSE(ScenarioComparisonSchema, value); if (!checked) return null;
  const expected = compareScenarios(source, scenario); return expected.ok && equalCSE(expected.comparison, checked) ? expected.comparison : null;
}
