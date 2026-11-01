import { z } from "zod";
import { ApplicationSchema } from "../contracts/demo.ts";
import type { ALAResultsData, ALAResultsView } from "./results-view.ts";
import { createReviewDraft, effectiveReviewActions, REVIEW_DISPOSITIONS, validateReviewDraft } from "./review-overrides.ts";

export const REVIEW_EXPORT_VERSION = "ala/review-export/v1" as const;
export const MAX_EXPORT_BYTES = 1_000_000;
export const EXPORT_DISCLAIMERS = ["AI-generated draft; not transaction advice.", "Visitor-reviewed values are proposed and unapproved; unchanged AI actions are not human-reviewed approvals.", "Incomplete analysis must not be treated as a complete dataset."] as const;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every((key) => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
};
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const Id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/), SourceId = z.string().min(1).max(128).regex(/^\S+$/);
const text = (max: number) => z.string().min(1).max(max).refine((s) => !!s.trim());
const Reference = z.strictObject({ app_id: SourceId, side: z.enum(["buyer", "target"]) });
const Proposal = z.strictObject({ disposition: z.enum(REVIEW_DISPOSITIONS), destination: Reference.nullable() });
const Action = z.strictObject({ action_id: Id, subject: Reference, ...Proposal.shape, rationale: text(400) });
const Pointer = z.strictObject({ app_id: SourceId, attribute: ApplicationSchema.keyof() });
const Member = z.strictObject({ app_id: SourceId, name: z.string().min(1).refine((value) => !!value.trim() && value === value.trim()) });
const Finding = z.strictObject({ finding_id: Id, domain: text(120), relationship: z.enum(["functional_overlap", "potentially_related", "unique", "uncertain"]),
  buyer_app_ids: z.array(SourceId).max(50), target_app_ids: z.array(SourceId).max(50), actions: z.array(Action).min(1).max(100), rationale: text(800),
  evidence: z.array(Pointer).min(1).max(100), uncertainty: z.strictObject({ level: z.enum(["low", "medium", "high", "unknown"]), reason: text(400) }),
  buyer: z.array(Member).max(50), target: z.array(Member).max(50), source_evidence: z.array(Pointer.extend({ value: z.union([z.string(), z.number().finite(), z.null()]) })).min(1).max(100) });
const SideCoverage = z.strictObject({ source_count: z.number().int().min(1).max(50), accounted_count: z.number().int().min(0).max(50), missing_app_ids: z.array(SourceId).max(50), not_evaluated_app_ids: z.array(SourceId).max(50) });
const Coverage = z.strictObject({ status: z.enum(["complete", "incomplete"]), reasons: z.array(z.enum(["missing_applications", "not_evaluated_applications"])).max(2), buyer: SideCoverage, target: SideCoverage });
const Metadata = z.strictObject({ model_provider: z.string().min(1).max(64).regex(/^[a-z0-9.-]+$/), model_id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:/-]+$/), mode: z.enum(["paid", "fallback"]), routing_reason: z.enum(["budget_exhausted", "paid_unavailable"]).optional() });
const Provenance = z.strictObject({ prompt_version: z.literal("ala/v1"), generated_at: z.iso.datetime(), request_id: z.uuid(), input_digest: z.string().regex(/^[a-f0-9]{64}$/) });
const Analysis = z.strictObject({ metadata: Metadata, provenance: Provenance, source_revision: z.number().int().nonnegative(), currency: z.currencyCode(), coverage: Coverage,
  findings: z.array(Finding).max(100), missing: z.array(Reference).max(100), not_evaluated: z.array(Reference.extend({ reason: text(400) })).max(100) });
const Identity = Provenance.omit({ generated_at: true }).extend({ source_revision: z.number().int().nonnegative() });
const Override = z.strictObject({ finding_id: Id, action_id: Id, subject: Reference, proposed_disposition: z.enum(REVIEW_DISPOSITIONS), proposed_destination: Reference.nullable(), visitor_reason: text(400), origin: z.literal("visitor_override") });
const Review = z.strictObject({ result_identity: Identity, overrides: z.array(Override).max(200) });
const EffectiveAction = z.strictObject({ finding_id: Id, action_id: Id, subject: Reference, original: Proposal.extend({ rationale: text(400) }), effective: Proposal,
  origin: z.enum(["ai_suggestion", "visitor_override"]), visitor_reason: text(400).nullable() });
const Counts = z.strictObject({ source_applications: z.number().int().min(2).max(100), findings: z.number().int().min(0).max(100), original_action_rows: z.number().int().min(0).max(200), visitor_overrides: z.number().int().min(0).max(200), missing: z.number().int().min(0).max(100), not_evaluated: z.number().int().min(0).max(100) });
const Shape = z.strictObject({ contract_version: z.literal(REVIEW_EXPORT_VERSION), artifact_kind: z.literal("ala_review_export"), status: z.literal("exported_unapproved"), source_module: z.literal("ala"),
  disclaimers: z.tuple([z.literal(EXPORT_DISCLAIMERS[0]), z.literal(EXPORT_DISCLAIMERS[1]), z.literal(EXPORT_DISCLAIMERS[2])]),
  analysis: Analysis, review: Review, effective_actions: z.array(EffectiveAction).max(200), counts: Counts });
type Artifact = z.infer<typeof Shape>;
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type ReviewedALAExport = Immutable<Artifact>;
export type ExportError = { readonly ok: false; readonly code: "invalid_export" | "export_too_large"; readonly message: string };
const invalid = (): ExportError => ({ ok: false, code: "invalid_export", message: "No valid current reviewed result is available for export." });
const oversized = (): ExportError => ({ ok: false, code: "export_too_large", message: "The reviewed export exceeds the permitted file size. No data was truncated." });
// Shape validation is not authentication. This internal view is used only for existing
// review validators; imported files never become trusted runtime AI projections.
function validationView(analysis: z.infer<typeof Analysis>): ALAResultsView {
  return { state: analysis.coverage.status === "complete" ? "current" : "incomplete", data: analysis as unknown as ALAResultsData };
}
function displayActions(view: ALAResultsView, review: unknown) {
  return effectiveReviewActions(view, review).map((entry) => ({ finding_id: entry.finding_id, action_id: entry.original.action_id, subject: entry.original.subject,
    original: { disposition: entry.original.disposition, destination: entry.original.destination, rationale: entry.original.rationale }, effective: entry.effective, origin: entry.origin, visitor_reason: entry.visitor_reason }));
}
function counts(analysis: z.infer<typeof Analysis>, review: z.infer<typeof Review>) {
  return { source_applications: analysis.coverage.buyer.source_count + analysis.coverage.target.source_count, findings: analysis.findings.length,
    original_action_rows: analysis.findings.reduce((sum, f) => sum + f.actions.length, 0), visitor_overrides: review.overrides.length, missing: analysis.missing.length, not_evaluated: analysis.not_evaluated.length };
}
function consistent(value: Artifact): boolean {
  const a = value.analysis, known = new Map<string, { side: "buyer" | "target"; name?: string }>();
  const findingIds = new Set<string>(), actionIds = new Set<string>(), assessed = new Set<string>();
  const capturedValues = new Map<string, unknown>();
  let members = 0, evidence = 0, actions = 0;
  const add = (id: string, side: "buyer" | "target", name?: string) => {
    const prior = known.get(id); if (prior && (prior.side !== side || (prior.name !== undefined && name !== undefined && prior.name !== name))) return false;
    known.set(id, { side, ...(name === undefined ? prior?.name === undefined ? {} : { name: prior.name } : { name }) }); return true;
  };
  for (const f of a.findings) {
    if (findingIds.has(f.finding_id)) return false; findingIds.add(f.finding_id);
    const ids = [...f.buyer_app_ids, ...f.target_app_ids]; members += ids.length; evidence += f.evidence.length; actions += f.actions.length;
    if (!ids.length || new Set(ids).size !== ids.length || (f.relationship === "unique" && ids.length !== 1) || (["functional_overlap", "potentially_related"].includes(f.relationship) && (!f.buyer_app_ids.length || !f.target_app_ids.length))) return false;
    for (const side of ["buyer", "target"] as const) {
      if (!equal(f[side].map((app) => app.app_id), side === "buyer" ? f.buyer_app_ids : f.target_app_ids)) return false;
      for (const app of f[side]) if (!add(app.app_id, side, app.name)) return false;
    }
    ids.forEach((id) => assessed.add(id));
    const sideById = new Map([...f.buyer_app_ids.map((id) => [id, "buyer"] as const), ...f.target_app_ids.map((id) => [id, "target"] as const)]);
    for (const action of f.actions) {
      if (actionIds.has(action.action_id) || sideById.get(action.subject.app_id) !== action.subject.side) return false; actionIds.add(action.action_id);
      const destination = action.destination, required = ["Migrate", "Integrate"].includes(action.disposition);
      if (required !== (destination !== null) || (destination && (destination.app_id === action.subject.app_id || sideById.get(destination.app_id) !== destination.side))) return false;
    }
    if (ids.some((id) => !f.actions.some((action) => action.subject.app_id === id)) || !equal(f.evidence, f.source_evidence.map(({ value: _, ...pointer }) => pointer))) return false;
    for (const pointer of f.source_evidence) {
      const parsed = ApplicationSchema.shape[pointer.attribute].safeParse(pointer.value), key = JSON.stringify([pointer.app_id, pointer.attribute]);
      if (!sideById.has(pointer.app_id) || !parsed.success || !equal(parsed.data, pointer.value) || (capturedValues.has(key) && !equal(capturedValues.get(key), pointer.value))) return false;
      capturedValues.set(key, pointer.value);
      if (pointer.attribute === "app_id" && pointer.value !== pointer.app_id) return false;
      if (pointer.attribute === "company_side" && pointer.value !== sideById.get(pointer.app_id)) return false;
      if (pointer.attribute === "app_name" && pointer.value !== known.get(pointer.app_id)!.name) return false;
    }
  }
  if (actions > 200 || evidence > 400 || members > 400) return false;
  // Preserve the frozen generated-data cap separately from the larger derived file cap.
  if (bytes(JSON.stringify({ findings: a.findings.map(({ buyer: _, target: __, source_evidence: ___, ...finding }) => finding), not_evaluated: a.not_evaluated })) > 64_000) return false;
  const unassessed = new Set<string>();
  for (const item of [...a.missing, ...a.not_evaluated]) {
    if (assessed.has(item.app_id) || unassessed.has(item.app_id) || !add(item.app_id, item.side)) return false; unassessed.add(item.app_id);
  }
  const reasons = [...(a.missing.length ? ["missing_applications"] : []), ...(a.not_evaluated.length ? ["not_evaluated_applications"] : [])];
  if (!equal(a.coverage.reasons, reasons) || a.coverage.status !== (reasons.length ? "incomplete" : "complete") || known.size > 100) return false;
  for (const side of ["buyer", "target"] as const) {
    const c = a.coverage[side], missing = a.missing.filter((item) => item.side === side).map((item) => item.app_id), unevaluated = a.not_evaluated.filter((item) => item.side === side).map((item) => item.app_id);
    if (c.source_count !== [...known.values()].filter((item) => item.side === side).length || c.accounted_count !== c.source_count - missing.length || !equal(c.missing_app_ids, missing) || !equal(c.not_evaluated_app_ids, unevaluated)) return false;
  }
  if ((a.metadata.mode === "fallback") !== (a.metadata.routing_reason !== undefined)) return false;
  const view = validationView(a), originalDraft = createReviewDraft(view);
  return !!originalDraft && !!validateReviewDraft(view, originalDraft) && !!validateReviewDraft(view, value.review) && equal(value.effective_actions, displayActions(view, value.review)) && equal(value.counts, counts(a, value.review));
}
export const ReviewedALAExportSchema = Shape.superRefine((value, context) => {
  if (bytes(JSON.stringify(value)) > MAX_EXPORT_BYTES || !consistent(value)) context.addIssue({ code: "custom", message: "Invalid reviewed result structure, references, coverage or identity" });
});
/** Bounded validation only; never an import-to-session/AI-result operation. */
export function readReviewedExport(input: unknown): { ok: true; artifact: ReviewedALAExport } | ExportError {
  try {
    const serialized = typeof input === "string" ? input : JSON.stringify(input);
    if (typeof serialized !== "string") return invalid(); if (bytes(serialized) > MAX_EXPORT_BYTES) return oversized();
    const raw = typeof input === "string" ? JSON.parse(input) : input, parsed = ReviewedALAExportSchema.safeParse(raw);
    return parsed.success && equal(parsed.data, raw) ? { ok: true, artifact: freeze(parsed.data) } : invalid();
  } catch { return invalid(); }
}
/** Trusted current projection + latest local review only; no new provenance is invented. */
export function buildReviewedExport(view: ALAResultsView, draft: unknown): ReturnType<typeof readReviewedExport> {
  try {
    if (!["current", "incomplete"].includes(view.state) || !("data" in view)) return invalid();
    const analysis = Analysis.safeParse(view.data); if (!analysis.success || !equal(analysis.data, view.data) || view.state !== (analysis.data.coverage.status === "complete" ? "current" : "incomplete")) return invalid();
    const review = validateReviewDraft(view, draft); if (!review) return invalid();
    return readReviewedExport({ contract_version: REVIEW_EXPORT_VERSION, artifact_kind: "ala_review_export", status: "exported_unapproved", source_module: "ala", disclaimers: [...EXPORT_DISCLAIMERS],
      analysis: analysis.data, review, effective_actions: displayActions(view, review), counts: counts(analysis.data, review as z.infer<typeof Review>) });
  } catch { return invalid(); }
}
/** Explicit future consumption adapter: use effective values, retain full originals and incompleteness. */
export function consumeReviewedExport(input: unknown) {
  const result = readReviewedExport(input); return result.ok ? { ok: true as const, data: freeze({ contract_version: result.artifact.contract_version,
    status: result.artifact.status, coverage: result.artifact.analysis.coverage, provenance: result.artifact.analysis.provenance, metadata: result.artifact.analysis.metadata,
    actions: result.artifact.effective_actions, original_analysis: result.artifact.analysis }) } : result;
}

export type ExportFormat = "json" | "csv";
export function prepareReviewedDownload(view: ALAResultsView, draft: unknown, format: ExportFormat): { ok: true; content: string; mime: string; filename: string } | ExportError {
  const built = buildReviewedExport(view, draft); if (!built.ok) return built;
  if (format === "json") return { ok: true, content: JSON.stringify(built.artifact), mime: "application/json;charset=utf-8", filename: "aivra-ala-reviewed-draft.json" };
  if (format !== "csv") return invalid();
  try {
    const a = built.artifact, columns = ["record_type", "contract_version", "status", "request_id", "provenance_json", "metadata_json", "source_revision", "currency", "coverage_json", "counts_json", "missing_json", "not_evaluated_json", "disclaimers_json", "finding_id", "domain", "relationship", "buyer_json", "target_json", "finding_rationale", "evidence_json", "source_evidence_json", "uncertainty_json", "action_id", "subject_app_id", "subject_side", "original_disposition", "original_destination_json", "original_action_rationale", "effective_disposition", "effective_destination_json", "origin", "visitor_reason"];
    const rows: string[][] = [["analysis", a.contract_version, a.status, a.analysis.provenance.request_id, JSON.stringify(a.analysis.provenance), JSON.stringify(a.analysis.metadata), String(a.analysis.source_revision), a.analysis.currency, JSON.stringify(a.analysis.coverage), JSON.stringify(a.counts), JSON.stringify(a.analysis.missing), JSON.stringify(a.analysis.not_evaluated), JSON.stringify(a.disclaimers), ...Array(19).fill("")]];
    for (const f of a.analysis.findings) for (const original of f.actions) {
      const action = a.effective_actions.find((item) => item.finding_id === f.finding_id && item.action_id === original.action_id)!;
      rows.push(["action", a.contract_version, a.status, a.analysis.provenance.request_id, ...Array(9).fill(""), f.finding_id, f.domain, f.relationship, JSON.stringify(f.buyer), JSON.stringify(f.target), f.rationale, JSON.stringify(f.evidence), JSON.stringify(f.source_evidence), JSON.stringify(f.uncertainty), action.action_id, action.subject.app_id, action.subject.side, action.original.disposition, JSON.stringify(action.original.destination), action.original.rationale, action.effective.disposition, JSON.stringify(action.effective.destination), action.origin, action.visitor_reason ?? ""]);
    }
    const cell = (value: string) => {
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error("Unsupported CSV control");
      const safe = /^[\s\u200b-\u200f\u2060\uFEFF]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const content = [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
    return bytes(content) > MAX_EXPORT_BYTES ? oversized() : { ok: true, content, mime: "text/csv;charset=utf-8", filename: "aivra-ala-reviewed-draft.csv" };
  } catch { return invalid(); }
}

type Anchor = Pick<HTMLAnchorElement, "href" | "download" | "click" | "remove">;
export type DownloadPort = { createURL: (blob: Blob) => string; revokeURL: (url: string) => void; createAnchor: () => Anchor; appendAnchor: (anchor: Anchor) => void; deferCleanup: (cleanup: () => void) => void };
const browserPort = (): DownloadPort => ({ createURL: (blob) => URL.createObjectURL(blob), revokeURL: (url) => URL.revokeObjectURL(url),
  createAnchor: () => document.createElement("a"), appendAnchor: (anchor) => document.body.appendChild(anchor as HTMLAnchorElement), deferCleanup: (cleanup) => { setTimeout(cleanup, 0); } });
/** Deliberate click only. Object URL cleanup is the only scheduled work; no network/storage. */
export function downloadReviewedResults(view: ALAResultsView, draft: unknown, format: ExportFormat, port: DownloadPort = browserPort()): { ok: true; status: "initiated" } | ExportError | { ok: false; code: "download_unavailable"; message: string } {
  const prepared = prepareReviewedDownload(view, draft, format); if (!prepared.ok) return prepared;
  let url: string | undefined, anchor: Anchor | undefined, initiated = false;
  try {
    url = port.createURL(new Blob([prepared.content], { type: prepared.mime })); anchor = port.createAnchor(); anchor.href = url; anchor.download = prepared.filename;
    port.appendAnchor(anchor); anchor.click(); initiated = true;
  } catch { initiated = false; }
  finally {
    try { anchor?.remove(); } catch { initiated = false; }
    if (url !== undefined) {
      const revoke = () => { try { port.revokeURL(url!); } catch { /* Best-effort native resource cleanup; no provider/error text. */ } };
      try { if (initiated) port.deferCleanup(revoke); else revoke(); } catch { revoke(); initiated = false; }
    }
  }
  return initiated ? { ok: true, status: "initiated" } : { ok: false, code: "download_unavailable", message: "The browser could not initiate the download. Your review draft is retained." };
}
