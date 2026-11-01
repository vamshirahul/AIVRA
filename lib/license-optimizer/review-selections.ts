import { z } from "zod";
import type { LicenseResultsView } from "./results-view.ts";

const Id = z.string().min(1).max(128).regex(/^\S+$/);
const SourceToken = z.strictObject({ session_id: z.uuid(), fixture_id: Id, fixture_dataset_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  application_revision: z.number().int().nonnegative(), license_revision: z.number().int().nonnegative(), source_digest: z.string().regex(/^[a-f0-9]{64}$/) });
const Identity = z.strictObject({ request_id: z.uuid(), input_digest: z.string().regex(/^[a-f0-9]{64}$/), prompt_version: z.literal("licenses/v1"), source_token: SourceToken });
const FindingId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const Reference = z.strictObject({ result_identity: Identity, finding_id: FindingId });
const Status = z.enum(["selected", "not_selected"]);
const Edit = Reference.extend({ status: Status });
const Selection = z.strictObject({ finding_id: FindingId, status: Status, origin: z.literal("visitor_selection") });
const Draft = z.strictObject({ schema_version: z.literal("licenses/review/v1"), result_identity: Identity, selections: z.array(Selection).max(100) });
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type LicenseReviewIdentity = Immutable<z.infer<typeof Identity>>;
export type LicenseSelectionDraft = Immutable<z.infer<typeof Draft>>;
export type LicenseSelectionEdit = Immutable<z.infer<typeof Edit>>;
export type LicenseReviewOperation = { ok: true; draft: LicenseSelectionDraft; changed: boolean } | { ok: false; message: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const fail = (): LicenseReviewOperation => ({ ok: false, message: "The selection or analysis identity is invalid or no longer current." });

/** Accepts only a server-validated projection. This is not client JSON authentication. */
export function licenseReviewIdentity(view: LicenseResultsView): LicenseReviewIdentity | null {
  if (!("data" in view) || !["current", "incomplete"].includes(view.state)) return null;
  const p = view.data.provenance;
  const parsed = Identity.safeParse({ request_id: p.request_id, input_digest: p.input_digest, prompt_version: p.prompt_version, source_token: view.data.source_token });
  return parsed.success ? freeze(parsed.data) : null;
}
export function licenseReviewKey(view: LicenseResultsView): string | null {
  const identity = licenseReviewIdentity(view); return identity ? JSON.stringify(identity) : null;
}
export function createLicenseSelectionDraft(view: LicenseResultsView): LicenseSelectionDraft | null {
  const identity = licenseReviewIdentity(view);
  return identity ? freeze({ schema_version: "licenses/review/v1" as const, result_identity: identity, selections: [] }) : null;
}
function findingExists(view: LicenseResultsView, id: string): boolean {
  return "data" in view && view.data.findings.some((f) => f.original.finding_id === id);
}
export function validateLicenseSelectionDraft(view: LicenseResultsView, input: unknown): LicenseSelectionDraft | null {
  try {
    const identity = licenseReviewIdentity(view), parsed = Draft.safeParse(input);
    if (!identity || !parsed.success || !same(identity, parsed.data.result_identity)) return null;
    const ids = parsed.data.selections.map((s) => s.finding_id);
    if (new Set(ids).size !== ids.length || ids.some((id) => !findingExists(view, id))) return null;
    return freeze(parsed.data);
  } catch { return null; }
}
/** Explicit lifecycle reset; never restores an old draft after a result becomes invalid/absent. */
export function licenseDraftForView(view: LicenseResultsView, draft: unknown): LicenseSelectionDraft | null {
  return validateLicenseSelectionDraft(view, draft) ?? createLicenseSelectionDraft(view);
}
export function saveLicenseSelection(view: LicenseResultsView, inputDraft: unknown, inputEdit: unknown): LicenseReviewOperation {
  try {
    const draft = validateLicenseSelectionDraft(view, inputDraft), edit = Edit.safeParse(inputEdit);
    if (!draft || !edit.success || !same(draft.result_identity, edit.data.result_identity) || !findingExists(view, edit.data.finding_id)) return fail();
    const index = draft.selections.findIndex((s) => s.finding_id === edit.data.finding_id);
    if (index >= 0 && draft.selections[index].status === edit.data.status) return { ok: true, draft, changed: false };
    const selections = [...draft.selections], replacement = { finding_id: edit.data.finding_id, status: edit.data.status, origin: "visitor_selection" as const };
    if (index < 0) selections.push(replacement); else selections[index] = replacement;
    return { ok: true, changed: true, draft: freeze({ ...draft, selections }) };
  } catch { return fail(); }
}
export function clearLicenseSelection(view: LicenseResultsView, inputDraft: unknown, inputReference: unknown): LicenseReviewOperation {
  try {
    const draft = validateLicenseSelectionDraft(view, inputDraft), reference = Reference.safeParse(inputReference);
    if (!draft || !reference.success || !same(draft.result_identity, reference.data.result_identity) || !findingExists(view, reference.data.finding_id)) return fail();
    const selections = draft.selections.filter((s) => s.finding_id !== reference.data.finding_id);
    return { ok: true, changed: selections.length !== draft.selections.length, draft: freeze({ ...draft, selections }) };
  } catch { return fail(); }
}
export function licenseReviewEntries(view: LicenseResultsView, inputDraft: unknown) {
  const draft = validateLicenseSelectionDraft(view, inputDraft);
  if (!draft || !("data" in view)) return [];
  const selections = new Map(draft.selections.map((s) => [s.finding_id, s]));
  return freeze(view.data.findings.map((finding) => ({ finding, selection: selections.get(finding.original.finding_id) ?? null })));
}
/** Exact shared-source membership only. Does not resolve conflicts, rank findings or add financial values. */
export function selectedLicenseOverlaps(view: LicenseResultsView, inputDraft: unknown) {
  const entries = licenseReviewEntries(view, inputDraft), membership = new Map<string, string[]>();
  for (const entry of entries) if (entry.selection?.status === "selected") for (const id of entry.finding.original.license_ids) {
    const ids = membership.get(id) ?? []; ids.push(entry.finding.original.finding_id); membership.set(id, ids);
  }
  return freeze([...membership].filter(([, ids]) => ids.length > 1).map(([license_id, finding_ids]) => ({ license_id, finding_ids })));
}
