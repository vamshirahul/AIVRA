import { z } from "zod";
import { CSEResultSchema, MAX_CSE_BYTES, equalCSE, freezeCSE, parseCSE } from "./calculation-contract.ts";
import type { CSEContext, CSEResult } from "./calculation-contract.ts";
import { calculateCSE } from "./calculation.ts";
import { buildEstimateRequest, editorIdentity } from "./estimate-form.ts";
import type { EstimateDraft } from "./estimate-form.ts";
import type { DownloadPort } from "../ala/review-export.ts";

export const CSE_EXPORT_VERSION = "cse/estimate-export/v1" as const;
export const CSE_EXPORT_DISCLOSURES = ["Illustrative, unapproved estimate; not a forecast or verified savings.", "Synthetic/test data only. Amounts are visitor assumptions, not AI-generated financial facts.", "Incomplete coverage and unknown or conflicting amounts must not be treated as complete portfolio savings."] as const;
export const CSE_EXPORT_UNITS = { annual: "CAD cents per year", migration: "CAD cents once", transition: "CAD cents once", one_time_total: "CAD cents once, deducted once", horizon_savings: "CAD cents over horizon", net_benefit: "CAD cents over horizon", horizon: "whole years" } as const;
export const CSEEstimateExportSchema = z.strictObject({
  contract_version: z.literal(CSE_EXPORT_VERSION), artifact_kind: z.literal("cse_estimate"), illustrative_unapproved: z.literal(true),
  disclosures: z.tuple([z.literal(CSE_EXPORT_DISCLOSURES[0]), z.literal(CSE_EXPORT_DISCLOSURES[1]), z.literal(CSE_EXPORT_DISCLOSURES[2])]),
  units: z.strictObject({ annual: z.literal(CSE_EXPORT_UNITS.annual), migration: z.literal(CSE_EXPORT_UNITS.migration), transition: z.literal(CSE_EXPORT_UNITS.transition), one_time_total: z.literal(CSE_EXPORT_UNITS.one_time_total), horizon_savings: z.literal(CSE_EXPORT_UNITS.horizon_savings), net_benefit: z.literal(CSE_EXPORT_UNITS.net_benefit), horizon: z.literal(CSE_EXPORT_UNITS.horizon) }),
  estimate: CSEResultSchema.refine((r) => r.status === "computed" || r.status === "incomplete"),
});
export type CSEEstimateExport = z.infer<typeof CSEEstimateExportSchema>;
export type CSEExportFormat = "json" | "csv";
type Failure = { ok: false; code: "export_unavailable" | "export_too_large" | "download_unavailable"; message: string };
const failure = (code: Failure["code"] = "export_unavailable"): Failure => ({ ok: false, code, message: code === "export_too_large" ? "The estimate exceeds the download size limit. No file was created." : code === "download_unavailable" ? "The browser could not initiate the download. Your financial inputs are retained." : "Calculate a valid current estimate before downloading. No file was created." });
const bytes = (value: string) => new TextEncoder().encode(value).length;

declare const exportPermit: unique symbol;
export type CSEExportPermit = { readonly [exportPermit]: true };
const permits = new WeakMap<CSEExportPermit, { artifact: CSEEstimateExport; context: string; draft: string }>();
export function revokeEstimateExport(permit: CSEExportPermit | null): void { if (permit) permits.delete(permit); }

/** Called only after explicit Calculate by the protected mounted editor. Consistency
 * recalculation is at capture time, never at download; the original output is retained.
 * A permit is in-memory authority from that owner, not authentication of model execution.
 */
export function captureEstimateExport(result: CSEResult, context: CSEContext, draft: EstimateDraft, authorized: boolean): CSEExportPermit | null {
  if (!authorized || (result.status !== "computed" && result.status !== "incomplete")) return null;
  try {
    const built = buildEstimateRequest(context, draft);
    if (!built.ok || !equalCSE(result.context, context) || !equalCSE(result.assumptions, built.request) || !equalCSE(result, calculateCSE(built.request, context))) return null;
    const artifact = parseCSE(CSEEstimateExportSchema, { contract_version: CSE_EXPORT_VERSION, artifact_kind: "cse_estimate", illustrative_unapproved: true, disclosures: CSE_EXPORT_DISCLOSURES, units: CSE_EXPORT_UNITS, estimate: result });
    if (!artifact) return null;
    const permit = Object.freeze({}) as CSEExportPermit;
    permits.set(permit, { artifact: freezeCSE(artifact), context: editorIdentity(context), draft: JSON.stringify(draft) }); return permit;
  } catch { return null; }
}

export function prepareCSEDownload(permit: CSEExportPermit | null, context: CSEContext, draft: EstimateDraft, authorized: boolean, format: CSEExportFormat): { ok: true; content: string; mime: string; filename: string } | Failure {
  try {
    const captured = permit ? permits.get(permit) : undefined;
    if (!authorized || !captured || captured.context !== editorIdentity(context) || captured.draft !== JSON.stringify(draft)) return failure();
    const a = captured.artifact, r = a.estimate;
    if (r.status === "invalid" || r.status === "not_computable") return failure();
    let content: string;
    if (format === "json") content = JSON.stringify(a);
    else if (format === "csv") {
      const columns = ["record_type", "export_version", "calculation_version", "status", "illustrative_unapproved", "currency", "money_unit", "units_json", "disclosures_json", "source_json", "review_identity_json", "review_digest", "context_json", "warnings_json", "conflicts_json", "horizon_years", "annual_recurring_savings_minor", "migration_one_time_cost_minor", "transition_overlap_cost_minor", "one_time_total_minor", "horizon_recurring_savings_minor", "illustrative_net_benefit_minor", "line_id", "included", "request_line_json", "calculated_line_json"];
      const text = (value: unknown) => JSON.stringify(value ?? null);
      const t = r.totals;
      const rows: string[][] = [["summary", a.contract_version, r.contract_version, r.status, "true", r.currency, r.money_unit, text(a.units), text(a.disclosures), text(r.context.source), text(r.assumptions.review_identity), r.assumptions.expected_review_digest!, text(r.context), text(r.warnings), text(r.conflicts), text(t.horizon_years), text(t.annual_recurring_savings_minor), text(t.migration_one_time_cost_minor), text(t.transition_overlap_cost_minor), text(t.one_time_total_minor), text(t.horizon_recurring_savings_minor), text(t.illustrative_net_benefit_minor), "", "", "", ""]];
      for (const line of r.assumptions.lines) {
        const calculated = r.lines.find((l) => l.line_id === line.line_id)!;
        rows.push(["line", a.contract_version, r.contract_version, r.status, "true", r.currency, r.money_unit, ...Array(15).fill(""), line.line_id, String(line.included), text(line), text(calculated)]);
      }
      const cell = (value: string, column: number) => {
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error("Unsupported CSV control");
        const numeric = column >= 15 && column <= 21 && /^(?:-?\d+|null)$/.test(value);
        const safe = !numeric && (/^[\s\u200b-\u200f\u2060\uFEFF]*[=+@-]|^[\t\r\n]/.test(value)) ? `'${value}` : value;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      content = [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
    } else return failure();
    return bytes(content) > MAX_CSE_BYTES ? failure("export_too_large") : { ok: true, content, mime: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8", filename: `aivra-cse-estimate-v1.${format}` };
  } catch { return failure(); }
}

const browserPort = (): DownloadPort => ({ createURL: (blob) => URL.createObjectURL(blob), revokeURL: (url) => URL.revokeObjectURL(url), createAnchor: () => document.createElement("a"), appendAnchor: (anchor) => document.body.appendChild(anchor as HTMLAnchorElement), deferCleanup: (cleanup) => { setTimeout(cleanup, 0); } });
/** Deliberate click, prepared captured result only; no recalculation, IO or storage. */
export function downloadCSEEstimate(permit: CSEExportPermit | null, context: CSEContext, draft: EstimateDraft, authorized: boolean, format: CSEExportFormat, port: DownloadPort = browserPort()): { ok: true; status: "initiated" } | Failure {
  const prepared = prepareCSEDownload(permit, context, draft, authorized, format); if (!prepared.ok) return prepared;
  let url: string | undefined, anchor: ReturnType<DownloadPort["createAnchor"]> | undefined, initiated = false;
  try {
    url = port.createURL(new Blob([prepared.content], { type: prepared.mime })); anchor = port.createAnchor(); anchor.href = url; anchor.download = prepared.filename; port.appendAnchor(anchor); anchor.click(); initiated = true;
  } catch { initiated = false; }
  finally {
    try { anchor?.remove(); } catch { initiated = false; }
    if (url !== undefined) {
      const revoke = () => { try { port.revokeURL(url!); } catch { /* Best-effort browser resource cleanup. */ } };
      try { if (initiated) port.deferCleanup(revoke); else revoke(); } catch { revoke(); initiated = false; }
    }
  }
  return initiated ? { ok: true, status: "initiated" } : failure("download_unavailable");
}
