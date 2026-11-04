import { z } from "zod";
import { MAX_SESSION_CHARACTERS } from "../session/session.ts";
import type { DownloadPort } from "../ala/review-export.ts";
import { TSASummarySchema, buildTSASummary, sameTSAValue, freezeTSA } from "./tsa-summary.ts";

export const TSA_EXPORT_VERSION = "tsa/summary-export/v1" as const;
// Conservative existing source ceiling, applied to complete UTF-8 output bytes.
export const MAX_TSA_EXPORT_BYTES = MAX_SESSION_CHARACTERS;
export const TSA_DISCLOSURE = "Synthetic, fictional TSA source inventory; unapproved. Source statuses and dates are not verified contractual obligations, risk predictions or proof of exit completion.";
export const TSAExportSchema = z.strictObject({ contract_version: z.literal(TSA_EXPORT_VERSION), disclosure: z.literal(TSA_DISCLOSURE), summary: TSASummarySchema });
export type TSAExportFormat = "csv" | "json";
type Failure = { ok: false; code: "export_unavailable" | "export_too_large" | "download_unavailable"; message: string };
const failure = (code: Failure["code"] = "export_unavailable"): Failure => ({ ok: false, code, message: code === "export_too_large" ? "The TSA summary exceeds the download size limit. No file was created." : code === "download_unavailable" ? "The browser could not initiate the TSA download. Your saved source records are retained." : "Save or Cancel the draft and use a valid current TSA source before downloading. No file was created." });
export function prepareTSADownload(session: unknown, format: TSAExportFormat) {
  try {
    const built = buildTSASummary(session); if (!built.ok) return failure();
    const artifact = freezeTSA(TSAExportSchema.parse({ contract_version: TSA_EXPORT_VERSION, disclosure: TSA_DISCLOSURE, summary: built.summary }));
    let content: string;
    if (format === "json") content = JSON.stringify(artifact);
    else if (format === "csv") {
      const headers = ["record_type", "export_version", "source_json", "disclosure", "counts_json", "tsa_id", "title", "provider", "recipient", "owner", "start_date", "end_date", "source_status", "exit_milestone", "risk_notes", "relationship_state", "related_app_ids_json", "linked_applications_json", "source_record_json"];
      const s = artifact.summary, json = (v: unknown) => JSON.stringify(v ?? null);
      const rows: string[][] = [["summary", artifact.contract_version, json(s.source), artifact.disclosure, json(s.counts), ...Array(14).fill("")]];
      for (const r of s.services) { const links = r.related_app_ids?.map((id) => s.linked_applications.find((a) => a.app_id === id)!); rows.push(["service", artifact.contract_version, "", "", "", r.tsa_id, r.title, r.provider, r.recipient, r.owner ?? "Unknown", r.start_date ?? "Unknown", r.end_date ?? "Unknown", r.status, r.exit_milestone ?? "Unknown / not supplied", r.risk_notes ?? "Unknown / not supplied", r.related_app_ids === undefined ? "not_supplied" : r.related_app_ids.length ? "recorded_links" : "recorded_empty", r.related_app_ids === undefined ? "not_supplied" : json(r.related_app_ids), links === undefined ? "not_supplied" : json(links), json(r)]); }
      const cell = (value: string) => {
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error("Unsupported raw CSV control");
        const safe = /^[\s\p{Cf}]*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`;
      };
      content = [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
    } else return failure();
    if (new TextEncoder().encode(content).length > MAX_TSA_EXPORT_BYTES) return failure("export_too_large");
    return { ok: true as const, content, summary: artifact.summary, filename: `aivra-tsa-summary-v1.${format}`, mime: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" };
  } catch { return failure(); }
}
export type TSAExportSource = { session: unknown; current: boolean; unsaved: boolean };
const browserPort = (): DownloadPort => ({ createURL: (blob) => URL.createObjectURL(blob), revokeURL: (url) => URL.revokeObjectURL(url), createAnchor: () => document.createElement("a"), appendAnchor: (a) => document.body.appendChild(a as HTMLAnchorElement), deferCleanup: (cleanup) => { setTimeout(cleanup, 0); } });
/** Fresh synchronous click-time capture; revalidate before resource allocation and
 * immediately before dispatch. No cached permit, storage, computation or async work.
 */
export function downloadTSASummary(readCurrent: () => TSAExportSource, format: TSAExportFormat, port: DownloadPort = browserPort()): { ok: true; status: "initiated" } | Failure {
  let url: string | undefined, anchor: ReturnType<DownloadPort["createAnchor"]> | undefined, initiated = false, unavailable = false;
  try {
    const source = readCurrent(); if (source.current !== true || source.unsaved !== false) return failure();
    const prepared = prepareTSADownload(source.session, format); if (!prepared.ok) return prepared;
    const fresh = () => { const current = readCurrent(); if (current.current !== true || current.unsaved !== false) return false; const rebuilt = buildTSASummary(current.session); return rebuilt.ok && sameTSAValue(rebuilt.summary, prepared.summary); };
    if (!fresh()) return failure();
    url = port.createURL(new Blob([prepared.content], { type: prepared.mime })); anchor = port.createAnchor(); anchor.href = url; anchor.download = prepared.filename; port.appendAnchor(anchor);
    if (!fresh()) { unavailable = true; } else { anchor.click(); initiated = true; }
  } catch { initiated = false; }
  finally {
    try { anchor?.remove(); } catch { initiated = false; }
    if (url !== undefined) { const revoke = () => { try { port.revokeURL(url!); } catch { /* Best-effort browser cleanup. */ } }; try { if (initiated) port.deferCleanup(revoke); else revoke(); } catch { revoke(); initiated = false; } }
  }
  return initiated ? { ok: true, status: "initiated" } : failure(unavailable ? "export_unavailable" : "download_unavailable");
}
