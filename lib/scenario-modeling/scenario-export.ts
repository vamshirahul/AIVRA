import { z } from "zod";
import { MAX_CSE_BYTES, freezeCSE, parseCSE } from "../cost-synergy/calculation-contract.ts";
import { CSEEstimateExportSchema, CSE_EXPORT_UNITS } from "../cost-synergy/estimate-export.ts";
import type { DownloadPort } from "../ala/review-export.ts";
import { ScenarioDraftSchema, validateCurrentScenario, scenarioSourceKey } from "./scenario-draft.ts";
import type { ScenarioSource } from "./scenario-draft.ts";
import { ScenarioComparisonSchema, validateCurrentComparison, COMPARISON_METRICS } from "./scenario-comparison.ts";

export const SCENARIO_EXPORT_VERSION = "scenario/comparison-export/v1" as const;
export const SCENARIO_DISCLOSURES = [
  "Synthetic/test data; hypothetical, illustrative and unapproved. Not transaction advice or verified savings.",
  "Original LLM findings and reviewed visitor overrides remain separate from alternative visitor hypotheses and financial assumptions. No new AI analysis occurred.",
  "Unknowns, incomplete coverage, exclusions, conflicts and incompatible horizons remain qualified. Dispositions do not generate savings; numeric license aggregation is withheld.",
] as const;
export const ScenarioExportSchema = z.strictObject({
  contract_version: z.literal(SCENARIO_EXPORT_VERSION), artifact_kind: z.literal("scenario_comparison"), illustrative_unapproved: z.literal(true),
  disclosures: z.tuple([z.literal(SCENARIO_DISCLOSURES[0]), z.literal(SCENARIO_DISCLOSURES[1]), z.literal(SCENARIO_DISCLOSURES[2])]),
  units: CSEEstimateExportSchema.shape.units,
  scenario: ScenarioDraftSchema,
  comparison: ScenarioComparisonSchema.refine((c) => c.status === "computed" || c.status === "incomplete"),
});
export type ScenarioExport = z.infer<typeof ScenarioExportSchema>;
export type ScenarioExportFormat = "json" | "csv";
type Failure = { ok: false; code: "export_unavailable" | "export_too_large" | "download_unavailable"; message: string };
const failure = (code: Failure["code"] = "export_unavailable"): Failure => ({ ok: false, code, message: code === "export_too_large" ? "The scenario exceeds the download size limit. No file was created." : code === "download_unavailable" ? "The browser could not initiate the download. Your scenario inputs are retained." : "Save or restore inputs, then compare a valid current scenario before downloading. No file was created." });
const bytes = (s: string) => new TextEncoder().encode(s).length;
const sourceKey = (s: ScenarioSource) => JSON.stringify([scenarioSourceKey(s), s.view]);
declare const permitBrand: unique symbol;
export type ScenarioExportPermit = { readonly [permitBrand]: true };
const permits = new WeakMap<ScenarioExportPermit, { artifact: ScenarioExport; source: string; scenario: string; comparison: string }>();
export function revokeScenarioExport(permit: ScenarioExportPermit | null): void { if (permit) permits.delete(permit); }

/** Protected owner calls only after explicit successful Compare. Validation may
 * recalculate at CAPTURE, never at download. Schema/digest equality is not inference
 * authentication; the owner must supply genuine source and currentness authority.
 */
export function captureScenarioExport(source: ScenarioSource, scenario: unknown, comparison: unknown, authorized: boolean, unsaved: boolean): ScenarioExportPermit | null {
  if (authorized !== true || unsaved !== false) return null;
  try {
    const s = validateCurrentScenario(source, scenario), c = s && validateCurrentComparison(source, s, comparison);
    if (!s || !c || c.status === "not_computable") return null;
    const artifact = parseCSE(ScenarioExportSchema, { contract_version: SCENARIO_EXPORT_VERSION, artifact_kind: "scenario_comparison", illustrative_unapproved: true, disclosures: SCENARIO_DISCLOSURES, units: CSE_EXPORT_UNITS, scenario: s, comparison: c });
    if (!artifact) return null;
    const permit = Object.freeze({}) as ScenarioExportPermit;
    permits.set(permit, { artifact: freezeCSE(artifact), source: sourceKey(source), scenario: JSON.stringify(scenario), comparison: JSON.stringify(comparison) }); return permit;
  } catch { return null; }
}

/** Serializes the captured snapshot only. No recalculation, source promotion or
 * import. Mismatch/authority failure destroys the permit, even if inputs revert.
 */
export function prepareScenarioDownload(permit: ScenarioExportPermit | null, source: ScenarioSource, scenario: unknown, comparison: unknown, authorized: boolean, unsaved: boolean, format: ScenarioExportFormat): { ok: true; content: string; filename: string; mime: string } | Failure {
  try {
    const captured = permit ? permits.get(permit) : undefined;
    if (authorized !== true || unsaved !== false || !captured || captured.source !== sourceKey(source) || captured.scenario !== JSON.stringify(scenario) || captured.comparison !== JSON.stringify(comparison)) { revokeScenarioExport(permit); return failure(); }
    const a = captured.artifact;
    let content: string;
    if (format === "json") content = JSON.stringify(a);
    else if (format === "csv") {
      const columns = ["record_type", "layer", "key", "status", "unit", "amount_minor", "reason", "id", "detail_json", "description"] as const;
      type Row = Partial<Record<typeof columns[number], string>>;
      const json = (v: unknown) => JSON.stringify(v ?? null), c = a.comparison;
      const { baseline_result, alternative_result, ...comparisonDetail } = c;
      const { scenario: s, comparison: _comparison, ...metadata } = a;
      const rows: Row[] = [
        { record_type: "metadata", status: c.status, detail_json: json(metadata), description: "Synthetic, hypothetical, illustrative and unapproved; preserve every typed row and JSON field." },
        { record_type: "scenario", detail_json: json(s), description: "Both raw/canonical financial assumptions; immutable reviewed baseline and one visitor alternative." },
        { record_type: "baseline_result", layer: "baseline", status: baseline_result.status, detail_json: json(baseline_result), description: "Unchanged original CSE result, original LLM evidence and baseline visitor overrides." },
        { record_type: "alternative_result", layer: "alternative", status: alternative_result.status, detail_json: json(alternative_result), description: "Unchanged CSE result using explicit alternative visitor amounts; hypotheses are not priced." },
        { record_type: "comparison", status: c.status, detail_json: json(comparisonDetail), description: "Comparison fields other than the two result rows above; source identity, differences, limitations and warnings." },
      ];
      for (const metric of COMPARISON_METRICS) {
        const unit = metric === "annual_recurring_savings_minor" ? "CAD cents per year" : metric === "horizon_recurring_savings_minor" || metric === "illustrative_net_benefit_minor" ? "CAD cents over explicit horizon" : "CAD cents once";
        for (const [layer, r] of [["baseline", baseline_result], ["alternative", alternative_result]] as const) rows.push({ record_type: "metric", layer, key: metric, status: r.status, unit, amount_minor: json(r.totals[metric]), reason: r.totals[metric] === null ? "unknown_in_original_result" : "", description: "See original result row for horizon, warnings, component reasons and exclusions." });
        rows.push({ record_type: "metric", layer: "alternative_minus_baseline", key: metric, status: c.status, unit, amount_minor: json(c.differences[metric].amount_minor), reason: c.differences[metric].reason ?? "", description: "Exact signed cents; positive cost difference means larger cost, not a better outcome." });
      }
      for (const e of c.changed_actions) rows.push({ record_type: "hypothesis", layer: "alternative", key: e.disposition, id: e.subject.app_id, detail_json: json(e), description: "Visitor hypothesis, not a new AI recommendation or an inferred monetary benefit." });
      const cell = (value: string, column: number) => {
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error("Unsupported CSV control");
        const numeric = column === 5 && /^(?:-?\d+|null)$/.test(value);
        const safe = !numeric && (/^[\s\p{Cf}]*[=+@-]|^[\t\r\n]/u.test(value)) ? `'${value}` : value;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      content = [columns.map((v) => v), ...rows.map((r) => columns.map((k) => r[k] ?? ""))].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
    } else return failure();
    return bytes(content) > MAX_CSE_BYTES ? failure("export_too_large") : { ok: true, content, filename: `aivra-scenario-comparison-v1.${format}`, mime: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" };
  } catch { revokeScenarioExport(permit); return failure(); }
}

const browserPort = (): DownloadPort => ({ createURL: (blob) => URL.createObjectURL(blob), revokeURL: (url) => URL.revokeObjectURL(url), createAnchor: () => document.createElement("a"), appendAnchor: (anchor) => document.body.appendChild(anchor as HTMLAnchorElement), deferCleanup: (cleanup) => { setTimeout(cleanup, 0); } });
/** Existing CSE/ALA Blob/temporary-anchor pattern, using the same DownloadPort. */
export function downloadScenarioComparison(permit: ScenarioExportPermit | null, source: ScenarioSource, scenario: unknown, comparison: unknown, authorized: boolean, unsaved: boolean, format: ScenarioExportFormat, port: DownloadPort = browserPort()): { ok: true; status: "initiated" } | Failure {
  const prepared = prepareScenarioDownload(permit, source, scenario, comparison, authorized, unsaved, format); if (!prepared.ok) return prepared;
  let url: string | undefined, anchor: ReturnType<DownloadPort["createAnchor"]> | undefined, initiated = false;
  try { url = port.createURL(new Blob([prepared.content], { type: prepared.mime })); anchor = port.createAnchor(); anchor.href = url; anchor.download = prepared.filename; port.appendAnchor(anchor); anchor.click(); initiated = true; }
  catch { initiated = false; }
  finally {
    try { anchor?.remove(); } catch { initiated = false; }
    if (url !== undefined) { const revoke = () => { try { port.revokeURL(url!); } catch { /* Best-effort browser cleanup. */ } }; try { if (initiated) port.deferCleanup(revoke); else revoke(); } catch { revoke(); initiated = false; } }
  }
  return initiated ? { ok: true, status: "initiated" } : failure("download_unavailable");
}
