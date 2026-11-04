import { z } from "zod";
import { DemoSessionSchema } from "../session/session.ts";
import type { DemoSession } from "../session/session.ts";
import type { PlaybookOutcome } from "../server/playbook/generate.ts";

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
type Accepted = Exclude<PlaybookOutcome, { status: "error" }>;
declare const protectedSource: unique symbol;
/** An in-memory protected owner, NOT a serializable current=true grant. Only a
 * server composition seam (or isolated offline harness) supplies this interface.
 */
export type PlaybookReviewSource = Readonly<{ [protectedSource]: true; getSnapshot: () => PlaybookReviewView; subscribe: (notify: () => void) => () => void }>;
export type PlaybookReviewView = { readonly state: "absent" | "invalid" | "outdated" } | { readonly state: "current" | "incomplete"; readonly data: Immutable<{ original: Accepted; selected_scenario: "baseline" | "alternative" }> };
export const ABSENT_PLAYBOOK: PlaybookReviewView = Object.freeze({ state: "absent" });
const INVALID_PLAYBOOK: PlaybookReviewView = Object.freeze({ state: "invalid" });
export const MAX_PLAYBOOK_REVIEW_BYTES = 64_000;
export const PLAYBOOK_REVIEW_VERSION = "playbook/review-draft/v1" as const;
const Id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const text = (max: number) => z.string().min(1).max(max).refine(v => !!v.trim(), "Nonblank text required");
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Source = z.strictObject({ session_id: z.uuid(), fixture: DemoSessionSchema.shape.fixture, session_revision: DemoSessionSchema.shape.session_revision,
  input_revisions: DemoSessionSchema.shape.input_revisions, deal_digest: Digest, review_digest: Digest, scenario_digest: Digest });
export const PlaybookReviewBindingSchema = z.strictObject({ request_id: z.uuid(), input_digest: Digest, prompt_version: z.literal("playbook/v1"), source: Source });
const Activity = z.strictObject({ title: text(120), description: text(800), ownership_role: text(120).nullable() });
const Milestone = z.strictObject({ title: text(120), proposed_date: z.iso.date().nullable(), date_assumption: text(400).nullable() });
const Reason = text(400);
const Override = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("activity"), id: Id, changes: Activity.partial(), visitor_reason: Reason, origin: z.literal("visitor_edit") }),
  z.strictObject({ kind: z.literal("milestone"), id: Id, changes: Milestone.partial(), visitor_reason: Reason, origin: z.literal("visitor_edit") }),
]);
export const PlaybookReviewDraftSchema = z.strictObject({ contract_version: z.literal(PLAYBOOK_REVIEW_VERSION), status: z.literal("visitor_draft_unapproved"),
  binding: PlaybookReviewBindingSchema, overrides: z.array(Override).max(140) });
export const PlaybookEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({ binding: PlaybookReviewBindingSchema, kind: z.literal("activity"), id: Id, values: Activity, visitor_reason: z.string().max(400) }),
  z.strictObject({ binding: PlaybookReviewBindingSchema, kind: z.literal("milestone"), id: Id, values: Milestone, visitor_reason: z.string().max(400) }),
]);
export type PlaybookReviewDraft = Immutable<z.infer<typeof PlaybookReviewDraftSchema>>;
export type PlaybookEdit = z.infer<typeof PlaybookEditSchema>;
export type PlaybookReviewErrors = Partial<Record<"form" | "title" | "description" | "ownership_role" | "proposed_date" | "date_assumption" | "visitor_reason", string>>;
type Operation = { ok: true; draft: PlaybookReviewDraft; changed: boolean } | { ok: false; errors: PlaybookReviewErrors };
export function samePlaybookValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && samePlaybookValue(Reflect.get(a, k), Reflect.get(b, k)));
}
export function freezePlaybook<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freezePlaybook); Object.freeze(v); } return v; }
export function readPlaybookSource(source: PlaybookReviewSource | null | undefined): PlaybookReviewView {
  try { if (!source || typeof source.getSnapshot !== "function" || typeof source.subscribe !== "function") return ABSENT_PLAYBOOK; const v = source.getSnapshot(); return v && typeof v === "object" && ["absent", "invalid", "outdated", "current", "incomplete"].includes(v.state) ? v : INVALID_PLAYBOOK; } catch { return INVALID_PLAYBOOK; }
}
function dataAt(source: PlaybookReviewSource | null | undefined) { const v = readPlaybookSource(source); return "data" in v && (v.state === "current" || v.state === "incomplete") ? v.data : null; }
function bindingOf(data: NonNullable<ReturnType<typeof dataAt>>) { const r = data.original; return PlaybookReviewBindingSchema.safeParse({ request_id: r.envelope.request_id, input_digest: r.envelope.input_digest, prompt_version: r.envelope.prompt_version, source: r.source }); }
export function playbookReviewBinding(source: PlaybookReviewSource | null | undefined) {
  try { const data = dataAt(source); if (!data) return null; const parsed = bindingOf(data); return parsed.success ? freezePlaybook(parsed.data) : null; } catch { return null; }
}
export function playbookReviewKey(source: PlaybookReviewSource | null | undefined): string | null { const b = playbookReviewBinding(source); return b ? JSON.stringify(b) : null; }
export function createPlaybookReviewDraft(source: PlaybookReviewSource | null | undefined): PlaybookReviewDraft | null {
  const binding = playbookReviewBinding(source); return binding ? freezePlaybook({ contract_version: PLAYBOOK_REVIEW_VERSION, status: "visitor_draft_unapproved", binding, overrides: [] }) : null;
}
function rowAt(source: PlaybookReviewSource | null | undefined, kind: "activity" | "milestone", id: string) {
  return rowIn(dataAt(source), kind, id);
}
function rowIn(data: ReturnType<typeof dataAt>, kind: "activity" | "milestone", id: string) {
  if (!data) return null;
  return kind === "activity" ? data.original.envelope.data.actions.find(a => a.activity_id === id) ?? null : data.original.envelope.data.milestones.find(m => m.milestone_id === id) ?? null;
}
function valuesOf(row: NonNullable<ReturnType<typeof rowAt>>, kind: "activity" | "milestone") {
  return kind === "activity" && "description" in row ? { title: row.title, description: row.description, ownership_role: row.ownership_role }
    : "proposed_date" in row ? { title: row.title, proposed_date: row.proposed_date, date_assumption: row.date_assumption } : null;
}
function paired(value: Record<string, unknown>): boolean { return !("proposed_date" in value) || (value.proposed_date !== null) === (value.date_assumption !== null); }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
export function validatePlaybookReviewDraft(source: PlaybookReviewSource | null | undefined, value: unknown): PlaybookReviewDraft | null {
  try {
    if (bytes(value) > MAX_PLAYBOOK_REVIEW_BYTES) return null;
    const data = dataAt(source), binding = data && bindingOf(data), parsed = PlaybookReviewDraftSchema.safeParse(value);
    if (!data || !binding?.success || !parsed.success || !samePlaybookValue(parsed.data, value) || !samePlaybookValue(binding.data, parsed.data.binding)) return null;
    const keys = new Set<string>();
    for (const o of parsed.data.overrides) {
      const key = `${o.kind}:${o.id}`, row = rowIn(data, o.kind, o.id), original = row && valuesOf(row, o.kind);
      if (!original || keys.has(key) || !Object.keys(o.changes).length || Object.keys(o.changes).some(k => Reflect.get(o.changes, k) === undefined || samePlaybookValue(Reflect.get(original, k), Reflect.get(o.changes, k))) || !paired({ ...original, ...o.changes })) return null;
      keys.add(key);
    }
    return samePlaybookValue(binding.data, playbookReviewBinding(source)) ? freezePlaybook(parsed.data) : null;
  } catch { return null; }
}
export function validatePlaybookEdit(source: PlaybookReviewSource | null | undefined, value: unknown): PlaybookReviewErrors {
  const errors: PlaybookReviewErrors = {};
  const parsed = PlaybookEditSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] === "values" ? issue.path[1] : issue.path[0];
      const field = (["title", "description", "ownership_role", "proposed_date", "date_assumption", "visitor_reason"].includes(String(key)) ? key : "form") as keyof PlaybookReviewErrors;
      errors[field] = field === "form" ? "Use a valid current activity or milestone and its permitted fields." : `Enter a valid ${String(field).replaceAll("_", " ")} within its field limit.`;
    }
    return errors;
  }
  const edit = parsed.data, binding = playbookReviewBinding(source), row = rowAt(source, edit.kind, edit.id), original = row && valuesOf(row, edit.kind);
  if (!samePlaybookValue(edit, value) || !binding || !samePlaybookValue(binding, edit.binding) || !original) return { form: "This draft is stale, unverified or belongs to another result. No edit was saved." };
  if (!paired(edit.values)) errors.date_assumption = "A proposed date requires a nonblank basis; clear both fields to leave the date unknown.";
  if (!samePlaybookValue(original, edit.values) && !edit.visitor_reason.trim()) errors.visitor_reason = "Explain this proposed visitor change (at most 400 characters).";
  return errors;
}
export function savePlaybookEdit(source: PlaybookReviewSource | null | undefined, value: unknown, proposal: unknown): Operation {
  const current = validatePlaybookReviewDraft(source, value), errors = validatePlaybookEdit(source, proposal);
  if (!current || Object.keys(errors).length) return { ok: false, errors: current ? errors : { form: "A valid current saved review is required. No edit was saved." } };
  const edit = PlaybookEditSchema.parse(proposal), row = rowAt(source, edit.kind, edit.id)!, original = valuesOf(row, edit.kind)!;
  const changes = Object.fromEntries(Object.entries(edit.values).filter(([k, v]) => !samePlaybookValue(Reflect.get(original, k), v)));
  const overrides = current.overrides.filter(o => o.kind !== edit.kind || o.id !== edit.id);
  if (Object.keys(changes).length) overrides.push({ kind: edit.kind, id: edit.id, changes, visitor_reason: edit.visitor_reason, origin: "visitor_edit" } as typeof overrides[number]);
  const candidate = { ...current, overrides }, checked = validatePlaybookReviewDraft(source, candidate);
  return checked ? { ok: true, draft: checked, changed: !samePlaybookValue(current, checked) } : { ok: false, errors: { form: "The review exceeds its size limit or source authorization changed. Nothing was saved." } };
}
export function restorePlaybookRow(source: PlaybookReviewSource | null | undefined, value: unknown, kind: "activity" | "milestone", id: string): Operation {
  const current = validatePlaybookReviewDraft(source, value); if (!current || !["activity", "milestone"].includes(kind) || !rowAt(source, kind, id)) return { ok: false, errors: { form: "A valid current row is required before restoring." } };
  const checked = validatePlaybookReviewDraft(source, { ...current, overrides: current.overrides.filter(o => o.kind !== kind || o.id !== id) });
  return checked ? { ok: true, draft: checked, changed: !samePlaybookValue(current, checked) } : { ok: false, errors: { form: "The result is no longer current." } };
}
/** Effective visitor fields only; original model data and provenance remain intact. */
export function projectPlaybookReview(source: PlaybookReviewSource | null | undefined, value: unknown) {
  const draft = validatePlaybookReviewDraft(source, value), data = dataAt(source); if (!draft || !data) return null;
  const binding = bindingOf(data); if (!binding.success || !samePlaybookValue(draft.binding, binding.data)) return null;
  const entries = (kind: "activity" | "milestone") => (kind === "activity" ? data.original.envelope.data.actions : data.original.envelope.data.milestones).map(original => {
    const id = "activity_id" in original ? original.activity_id : original.milestone_id, o = draft.overrides.find(o => o.kind === kind && o.id === id);
    return { id, original, values: { ...valuesOf(original, kind), ...o?.changes }, origin: o ? "visitor_edit" as const : "ai_generated_unapproved_draft" as const, visitor_reason: o?.visitor_reason ?? null };
  });
  return freezePlaybook({ data, draft, activities: entries("activity"), milestones: entries("milestone"), visitor_edit_count: draft.overrides.length });
}
export function matchesPlaybookReviewSession(source: PlaybookReviewSource | null | undefined, session: DemoSession | null): boolean {
  const b = playbookReviewBinding(source); return !!b && !!session && b.source.session_id === session.session_id && b.source.session_revision === session.session_revision && samePlaybookValue(b.source.fixture, session.fixture) && samePlaybookValue(b.source.input_revisions, session.input_revisions);
}
/** Additional local integrity check only, never a server authorization grant. */
export async function verifyPlaybookReviewSession(source: PlaybookReviewSource | null | undefined, session: DemoSession): Promise<boolean> {
  try { const b = playbookReviewBinding(source); if (!b || !matchesPlaybookReviewSession(source, session)) return false;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(session.current_deal)));
    const hex = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
    return hex === b.source.deal_digest && samePlaybookValue(b, playbookReviewBinding(source));
  } catch { return false; }
}
