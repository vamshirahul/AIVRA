import { createPlaybookReviewDraft, freezePlaybook, matchesPlaybookReviewSession, projectPlaybookReview, readPlaybookSource, verifyPlaybookReviewSession } from "./review-draft.ts";
import type { PlaybookReviewDraft, PlaybookReviewSource } from "./review-draft.ts";
import type { DemoSession } from "../session/session.ts";
import type { DownloadPort } from "../ala/review-export.ts";

export const PLAYBOOK_EXPORT_VERSION = "playbook/review-export/v1" as const;
export const MAX_PLAYBOOK_EXPORT_BYTES = 1_500_000;
export const PLAYBOOK_EXPORT_DISCLOSURES = [
  "AI-generated / visitor-reviewed / illustrative / NOT APPROVED. No work, obligation, assignment or financial benefit is approved by this document.",
  "Proposed functional roles are not assigned people; proposed dates and their bases are unverified and not contractual. Unknown values remain unknown.",
  "Structural coverage does not verify model narrative quality, evidence accuracy, risk, decision quality or completeness of real integration work. Visitor edits do not complete missing analysis.",
] as const;
type Projection = NonNullable<ReturnType<typeof projectPlaybookReview>>;
/** Strict construction-only dictionary. There is deliberately no import-to-trust
 * parser: original is supplied solely by the protected U04.03 source owner. */
export type PlaybookReviewExport = Readonly<{
  contract_version: typeof PLAYBOOK_EXPORT_VERSION; artifact_kind: "reviewed_playbook"; illustrative_unapproved: true;
  disclosures: typeof PLAYBOOK_EXPORT_DISCLOSURES;
  original: Projection["data"]["original"]; review: PlaybookReviewDraft;
  effective: { phases: readonly { phase: Projection["data"]["original"]["envelope"]["data"]["phases"][number]; activities: Projection["activities"]; milestones: Projection["milestones"] }[] };
  source_identity: { selected_scenario: Projection["data"]["selected_scenario"]; source: Projection["data"]["original"]["source"]; coverage: Projection["data"]["original"]["coverage"] };
}>;
export type PlaybookExportState = { source: PlaybookReviewSource | null; draft: PlaybookReviewDraft | null; session: DemoSession | null; editing: boolean; revision: number };
export type PlaybookExportReader = () => PlaybookExportState | null;
export type PlaybookExportFormat = "json" | "md";
type Failure = { ok: false; code: "export_unavailable" | "export_too_large" | "download_unavailable"; message: string };
const failure = (code: Failure["code"] = "export_unavailable"): Failure => ({ ok: false, code, message: code === "export_too_large" ? "The reviewed Playbook exceeds the download size limit. No file was created." : code === "download_unavailable" ? "The browser could not initiate the download. Your saved review is retained." : "Save or cancel the open edit and use a current validated Playbook review before downloading. No file was created." });
const bytes = (v: string) => new TextEncoder().encode(v).length;
declare const permitBrand: unique symbol;
export type PlaybookExportPermit = { readonly [permitBrand]: true };
type Capture = { read: PlaybookExportReader; state: PlaybookExportState; view: ReturnType<typeof readPlaybookSource>; session: string; draft: string; artifact: PlaybookReviewExport; unsubscribe: () => void };
const permits = new WeakMap<PlaybookExportPermit, Capture>();
export function revokePlaybookExport(permit: PlaybookExportPermit | null): void {
  if (!permit) return; const captured = permits.get(permit); permits.delete(permit);
  try { captured?.unsubscribe(); } catch { /* Authority is already revoked. */ }
}
function matches(c: Capture): boolean {
  const now = c.read();
  return !!now && now.editing === false && now.revision === c.state.revision && now.source === c.state.source && now.draft === c.state.draft &&
    JSON.stringify(now.draft) === c.draft && JSON.stringify(now.session) === c.session && readPlaybookSource(now.source) === c.view &&
    matchesPlaybookReviewSession(now.source, now.session);
}
/** Explicit click capture only. Async local digest adds integrity, never authority.
 * Reader is mounted owner composition, not a serialized authorized=true flag. */
export async function capturePlaybookExport(read: PlaybookExportReader): Promise<{ ok: true; permit: PlaybookExportPermit } | Failure> {
  let permit: PlaybookExportPermit | null = null;
  try {
    const state = read(); if (!state?.source || !state.session || !state.draft || state.editing !== false) return failure();
    const view = readPlaybookSource(state.source), projection = projectPlaybookReview(state.source, state.draft);
    if (!("data" in view) || !projection || !matchesPlaybookReviewSession(state.source, state.session) || !createPlaybookReviewDraft(state.source)) return failure();
    const plan = projection.data.original.envelope.data;
    const artifact: PlaybookReviewExport = freezePlaybook(structuredClone({ contract_version: PLAYBOOK_EXPORT_VERSION, artifact_kind: "reviewed_playbook", illustrative_unapproved: true,
      disclosures: PLAYBOOK_EXPORT_DISCLOSURES, original: projection.data.original, review: projection.draft,
      effective: { phases: [...plan.phases].sort((a, b) => a.sequence - b.sequence).map(phase => ({ phase, activities: projection.activities.filter(r => r.original.phase_id === phase.phase_id), milestones: projection.milestones.filter(r => r.original.phase_id === phase.phase_id) })) },
      source_identity: { selected_scenario: projection.data.selected_scenario, source: projection.data.original.source, coverage: projection.data.original.coverage } } as const));
    if (bytes(JSON.stringify(artifact)) > MAX_PLAYBOOK_EXPORT_BYTES) return failure("export_too_large");
    permit = Object.freeze({}) as PlaybookExportPermit;
    const captured: Capture = { read, state: { ...state }, view, session: JSON.stringify(state.session), draft: JSON.stringify(state.draft), artifact, unsubscribe: () => {} };
    permits.set(permit, captured);
    const token = permit; captured.unsubscribe = state.source.subscribe(() => revokePlaybookExport(token));
    if (!permits.has(permit)) captured.unsubscribe();
    if (!matches(captured) || !await verifyPlaybookReviewSession(state.source, structuredClone(state.session)) || !permits.has(permit) || !matches(captured)) { revokePlaybookExport(permit); return failure(); }
    return { ok: true, permit };
  } catch { revokePlaybookExport(permit); return failure(); }
}

/** All model/visitor strings are literal data. Numeric entities prevent Markdown
 * constructs/HTML before parsing; controls/bidi are made visible, never executed.
 * JSON remains authoritative for exact whitespace/control round-trip semantics. */
export function playbookMarkdownText(value: unknown): string {
  if (value === null) return "Unknown / not supplied";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return [...text].map(c => {
    const n = c.codePointAt(0)!;
    if (n < 32 || n === 127 || /[\u0080-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(c)) return `&#92;u${n.toString(16).padStart(4, "0")}`;
    return /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(c) ? `&#${n};` : c;
  }).join("");
}
function markdown(a: PlaybookReviewExport): string {
  const t = playbookMarkdownText, o = a.original, p = o.envelope.data, { data: _data, ...meta } = o.envelope;
  const lines = ["# Reviewed integration Playbook", "", ...a.disclosures.map(d => `**${d}**\n`),
    `Selected scenario: ${t(a.source_identity.selected_scenario)}`, "", "## Original AI provenance", ""];
  const field = (label: string, v: unknown) => { lines.push(`- ${label}: ${t(v)}`); };
  Object.entries(meta).forEach(([k, v]) => field(k, v));
  lines.push("", "## Captured source and coverage", "");
  field("Source identity", a.source_identity.source); field("Original generation operation", o.operation); field("Original result status", o.status); field("Coverage (structural only)", o.coverage);
  lines.push("", "Incomplete evidence and unknown values remain qualified. A complete structural result is not verification of narrative quality.", "", "## Reviewed phases", "");
  const list = (label: string, values: readonly unknown[]) => { field(label, values.length ? values : "None supplied"); };
  for (const phase of a.effective.phases) {
    lines.push(`### Phase ${phase.phase.sequence}: ${t(phase.phase.title)}`, ""); field("Phase ID", phase.phase.phase_id); list("Original phase assumptions", phase.phase.assumptions); list("Original phase source references", phase.phase.source_refs);
    for (const r of phase.activities) {
      const v = r.values as Record<string, string | null>;
      lines.push("", `#### Activity: ${t(v.title)}`, ""); field("Activity ID", r.id); field("Origin", r.origin); field("Effective description", v.description); field("Effective proposed functional role (not an assignment)", v.ownership_role);
      list("Original dependency activity IDs", "depends_on_activity_ids" in r.original ? r.original.depends_on_activity_ids : []); field("Original AI activity fields and read-only evidence", r.original); field("Visitor justification (unapproved)", r.visitor_reason);
    }
    for (const r of phase.milestones) {
      const v = r.values as Record<string, string | null>;
      lines.push("", `#### Milestone: ${t(v.title)}`, ""); field("Milestone ID", r.id); field("Origin", r.origin); field("Effective proposed date (not contractual)", v.proposed_date); field("Effective date basis", v.date_assumption);
      list("Original after-activity IDs", "after_activity_ids" in r.original ? r.original.after_activity_ids : []); field("Original AI milestone fields and read-only source references", r.original); field("Visitor justification (unapproved)", r.visitor_reason);
    }
  }
  lines.push("", "## Original risk proposals", ""); if (!p.risks.length) lines.push("None supplied."); p.risks.forEach(r => field("Risk (advisory, unverified)", r));
  lines.push("", "## Not addressed and limitations", ""); list("Original not-addressed sources", p.not_addressed); list("Original limitations", p.limitations);
  lines.push("", "## Saved visitor review", ""); field("Review version", a.review.contract_version); field("Review status", a.review.status); field("Review binding", a.review.binding); list("Separate visitor overrides", a.review.overrides);
  lines.push("", "JSON is the authoritative structured contract for exact text, nulls, order and reconstruction. This document is not an approved action list or new AI analysis.", ""); return lines.join("\n");
}
export function preparePlaybookDownload(permit: PlaybookExportPermit | null, format: PlaybookExportFormat): { ok: true; content: string; filename: string; mime: string } | Failure {
  try {
    const c = permit ? permits.get(permit) : null;
    if (!c || !matches(c) || (format !== "json" && format !== "md")) { revokePlaybookExport(permit); return failure(); }
    const content = format === "json" ? JSON.stringify(c.artifact) : markdown(c.artifact);
    if (bytes(content) > MAX_PLAYBOOK_EXPORT_BYTES) { revokePlaybookExport(permit); return failure("export_too_large"); }
    if (!permits.has(permit!) || !matches(c)) { revokePlaybookExport(permit); return failure(); }
    return { ok: true, content, filename: `aivra-playbook-reviewed-v1.${format}`, mime: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" };
  } catch { revokePlaybookExport(permit); return failure(); }
}
const browserPort = (): DownloadPort => ({ createURL: b => URL.createObjectURL(b), revokeURL: u => URL.revokeObjectURL(u), createAnchor: () => document.createElement("a"), appendAnchor: a => document.body.appendChild(a as HTMLAnchorElement), deferCleanup: f => { setTimeout(f, 0); } });
export function downloadReviewedPlaybook(permit: PlaybookExportPermit | null, format: PlaybookExportFormat, port: DownloadPort = browserPort()): { ok: true; status: "initiated" } | Failure {
  const prepared = preparePlaybookDownload(permit, format); if (!prepared.ok) return prepared;
  let url: string | undefined, anchor: ReturnType<DownloadPort["createAnchor"]> | undefined, initiated = false;
  const current = () => { const c = permit ? permits.get(permit) : null; return !!c && matches(c); };
  try {
    url = port.createURL(new Blob([prepared.content], { type: prepared.mime })); if (!current()) throw Error();
    anchor = port.createAnchor(); anchor.href = url; anchor.download = prepared.filename; port.appendAnchor(anchor); if (!current()) throw Error();
    anchor.click(); initiated = true;
  } catch { initiated = false; revokePlaybookExport(permit); }
  finally {
    try { anchor?.remove(); } catch { initiated = false; }
    if (url !== undefined) { const cleanup = () => { try { port.revokeURL(url!); } catch { /* Best-effort browser resource cleanup. */ } }; try { if (initiated) port.deferCleanup(cleanup); else cleanup(); } catch { cleanup(); initiated = false; } }
  }
  if (!initiated) revokePlaybookExport(permit);
  return initiated ? { ok: true, status: "initiated" } : failure("download_unavailable");
}
