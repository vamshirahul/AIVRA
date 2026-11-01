import { z } from "zod";
import type { ALAResultsData, ALAResultsView } from "./results-view.ts";

type Finding = ALAResultsData["findings"][number];
type Action = Finding["actions"][number];
export const REVIEW_DISPOSITIONS = ["Retain", "Retire", "Migrate", "Integrate", "Needs Review"] as const satisfies readonly Action["disposition"][];
export const MAX_REVIEW_REASON = 400;
const Id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const Reference = z.strictObject({ app_id: z.string().min(1).max(128).regex(/^\S+$/), side: z.enum(["buyer", "target"]) });
const Identity = z.strictObject({ request_id: z.uuid(), input_digest: z.string().regex(/^[a-f0-9]{64}$/), prompt_version: z.literal("ala/v1"), source_revision: z.number().int().nonnegative() });
const ActionReference = z.strictObject({ result_identity: Identity, finding_id: Id, action_id: Id, subject: Reference });
const Proposed = { proposed_disposition: z.enum(REVIEW_DISPOSITIONS), proposed_destination: Reference.nullable(), visitor_reason: z.string().max(MAX_REVIEW_REASON) };
const Edit = ActionReference.extend(Proposed);
const Override = z.strictObject({ finding_id: Id, action_id: Id, subject: Reference, ...Proposed, origin: z.literal("visitor_override") });
const Draft = z.strictObject({ result_identity: Identity, overrides: z.array(Override).max(200) });
export type ReviewIdentity = Readonly<z.infer<typeof Identity>>;
export type ReviewActionReference = Readonly<z.infer<typeof ActionReference>>;
export type ReviewEdit = Readonly<z.infer<typeof Edit>>;
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type ReviewOverride = Immutable<z.infer<typeof Override>>;
export type ReviewDraft = Readonly<{ result_identity: ReviewIdentity; overrides: readonly ReviewOverride[] }>;
export type ReviewErrors = Readonly<Partial<Record<"form" | "disposition" | "destination" | "reason", string>>>;
export type ReviewOperation = { ok: true; draft: ReviewDraft; changed: boolean } | { ok: false; errors: ReviewErrors };
export type ReviewDisplayAction = Readonly<{ finding_id: string; original: Action;
  effective: Readonly<{ disposition: Action["disposition"]; destination: Action["destination"] }>;
  origin: "ai_suggestion" | "visitor_override"; visitor_reason: string | null }>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const reviewActionKey = (finding_id: string, action_id: string) => JSON.stringify([finding_id, action_id]);
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const fail = (field: keyof ReviewErrors, message: string): ReviewOperation => ({ ok: false, errors: { [field]: message } });
export function reviewIdentity(view: ALAResultsView): ReviewIdentity | null {
  if (!("data" in view) || !["current", "incomplete"].includes(view.state)) return null;
  // Select exact identity fields; provenance itself remains untouched in the original grid.
  const identity = Identity.safeParse({ request_id: view.data.provenance.request_id, input_digest: view.data.provenance.input_digest,
    prompt_version: view.data.provenance.prompt_version, source_revision: view.data.source_revision });
  return identity.success ? freeze(identity.data) : null;
}
export function reviewResultKey(view: ALAResultsView): string | null { const identity = reviewIdentity(view); return identity ? JSON.stringify(identity) : null; }
export function createReviewDraft(view: ALAResultsView): ReviewDraft | null {
  const identity = reviewIdentity(view); return identity ? freeze({ result_identity: identity, overrides: [] }) : null;
}
function actionAt(view: ALAResultsView, finding_id: string, action_id: string) {
  if (!("data" in view)) return null;
  const finding = view.data.findings.find((item) => item.finding_id === finding_id);
  const action = finding?.actions.find((item) => item.action_id === action_id);
  return finding && action ? { finding, action } : null;
}
function unchanged(action: Action, override: Pick<ReviewOverride, "proposed_disposition" | "proposed_destination">) {
  return action.disposition === override.proposed_disposition && same(action.destination, override.proposed_destination);
}
function checkProposal(finding: Finding, action: Action, proposal: Pick<ReviewOverride, "proposed_disposition" | "proposed_destination" | "visitor_reason">): ReviewErrors | null {
  const needsDestination = proposal.proposed_disposition === "Migrate" || proposal.proposed_disposition === "Integrate";
  const destination = proposal.proposed_destination;
  if (needsDestination && !destination) return { destination: "Select a destination application in this finding." };
  if (!needsDestination && destination) return { destination: "This disposition requires no destination." };
  if (destination && (destination.app_id === action.subject.app_id || !(destination.side === "buyer" ? finding.buyer_app_ids : finding.target_app_ids).includes(destination.app_id))) return { destination: "Select another member of this finding on its correct side." };
  if (!unchanged(action, proposal) && !proposal.visitor_reason.trim()) return { reason: "Give a nonblank justification for the visitor change." };
  return null;
}
/** Frozen ala/v1 same-subject integrity only; never chooses a disposition or destination. */
function structurallyConsistent(view: ALAResultsView, overrides: readonly ReviewOverride[]): boolean {
  if (!("data" in view)) return false;
  const byKey = new Map(overrides.map((item) => [reviewActionKey(item.finding_id, item.action_id), item]));
  return view.data.findings.every((finding) => {
    const signatures = new Set<string>(), groups = new Map<string, Action["disposition"][]>();
    for (const action of finding.actions) {
      const override = byKey.get(reviewActionKey(finding.finding_id, action.action_id));
      const disposition = override?.proposed_disposition ?? action.disposition, destination = override ? override.proposed_destination : action.destination;
      const signature = JSON.stringify([action.subject, disposition, destination]);
      if (signatures.has(signature)) return false;
      signatures.add(signature);
      const group = groups.get(action.subject.app_id) ?? []; group.push(disposition); groups.set(action.subject.app_id, group);
    }
    return [...groups.values()].every((group) => group.length === 1 || !group.some((d) => ["Retire", "Migrate", "Needs Review"].includes(d)));
  });
}
export function validateReviewDraft(view: ALAResultsView, input: unknown): ReviewDraft | null {
  try {
    const identity = reviewIdentity(view), parsed = Draft.safeParse(input);
    if (!identity || !parsed.success || !same(identity, parsed.data.result_identity)) return null;
    const keys = new Set<string>();
    for (const item of parsed.data.overrides) {
      const key = reviewActionKey(item.finding_id, item.action_id), found = actionAt(view, item.finding_id, item.action_id);
      if (keys.has(key) || !found || !same(found.action.subject, item.subject) || unchanged(found.action, item) || checkProposal(found.finding, found.action, item)) return null;
      keys.add(key);
    }
    return structurallyConsistent(view, parsed.data.overrides) ? freeze(parsed.data) : null;
  } catch { return null; }
}
/** Explicit lifecycle reset. It does not promote an overlay into trusted AI content. */
export function reviewDraftForView(view: ALAResultsView, draft: unknown): ReviewDraft | null {
  return validateReviewDraft(view, draft) ?? createReviewDraft(view);
}
function updateDraft(view: ALAResultsView, draft: ReviewDraft, overrides: ReviewOverride[]): ReviewOperation {
  if (!structurallyConsistent(view, overrides)) return fail("form", "This change conflicts with another action for the same subject. Edit the other action explicitly first.");
  return { ok: true, changed: !same(draft.overrides, overrides), draft: freeze({ result_identity: draft.result_identity, overrides }) };
}
export function saveReviewOverride(view: ALAResultsView, inputDraft: unknown, inputEdit: unknown): ReviewOperation {
  try {
  const draft = validateReviewDraft(view, inputDraft), edit = Edit.safeParse(inputEdit);
  if (!draft) return fail("form", "The review draft no longer matches this analysis.");
  if (!edit.success) {
    const path = edit.error.issues[0]?.path[0];
    return path === "visitor_reason" ? fail("reason", "Use at most 400 characters for the justification.") : path === "proposed_disposition" ? fail("disposition", "Choose one of the five supported dispositions.") : fail("form", "The proposed edit could not be validated.");
  }
  const item = edit.data, found = actionAt(view, item.finding_id, item.action_id);
  if (!same(draft.result_identity, item.result_identity) || !found || !same(found.action.subject, item.subject)) return fail("form", "The action or analysis identity does not match this review.");
  const errors = checkProposal(found.finding, found.action, item); if (errors) return { ok: false, errors };
  const key = reviewActionKey(item.finding_id, item.action_id);
  const overrides = draft.overrides.filter((entry) => reviewActionKey(entry.finding_id, entry.action_id) !== key);
  if (!unchanged(found.action, item)) {
    const replacement: ReviewOverride = { finding_id: item.finding_id, action_id: item.action_id, subject: item.subject,
      proposed_disposition: item.proposed_disposition, proposed_destination: item.proposed_destination, visitor_reason: item.visitor_reason, origin: "visitor_override" };
    // Preserve collection order when editing an existing override.
    const index = draft.overrides.findIndex((entry) => reviewActionKey(entry.finding_id, entry.action_id) === key);
    overrides.splice(index < 0 ? overrides.length : index, 0, replacement);
  }
  return updateDraft(view, draft, overrides);
  } catch { return fail("form", "The proposed edit could not be validated."); }
}
export function restoreAIRecommendation(view: ALAResultsView, inputDraft: unknown, inputReference: unknown): ReviewOperation {
  try {
  const draft = validateReviewDraft(view, inputDraft), reference = ActionReference.safeParse(inputReference);
  if (!draft || !reference.success || !same(draft.result_identity, reference.data.result_identity)) return fail("form", "The action or analysis identity does not match this review.");
  const item = reference.data, found = actionAt(view, item.finding_id, item.action_id);
  if (!found || !same(found.action.subject, item.subject)) return fail("form", "The action or analysis identity does not match this review.");
  return updateDraft(view, draft, draft.overrides.filter((entry) => reviewActionKey(entry.finding_id, entry.action_id) !== reviewActionKey(item.finding_id, item.action_id)));
  } catch { return fail("form", "The action or analysis identity does not match this review."); }
}
export function effectiveReviewActions(view: ALAResultsView, inputDraft: unknown): readonly ReviewDisplayAction[] {
  const draft = validateReviewDraft(view, inputDraft); if (!draft || !("data" in view)) return [];
  const byKey = new Map(draft.overrides.map((item) => [reviewActionKey(item.finding_id, item.action_id), item]));
  return Object.freeze(view.data.findings.flatMap((finding) => finding.actions.map((original): ReviewDisplayAction => {
    const override = byKey.get(reviewActionKey(finding.finding_id, original.action_id));
    return freeze({ finding_id: finding.finding_id, original, effective: { disposition: override?.proposed_disposition ?? original.disposition,
      destination: override ? override.proposed_destination : original.destination }, origin: override ? "visitor_override" : "ai_suggestion", visitor_reason: override?.visitor_reason ?? null });
  })));
}
