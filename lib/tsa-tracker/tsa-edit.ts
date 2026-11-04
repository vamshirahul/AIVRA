import { TSAServiceSchema } from "../contracts/demo.ts";
import type { TSAService } from "../contracts/demo.ts";
import { matchesTSAEdit } from "../session/session.ts";
import type { DemoSession, TSACreateToken, TSAEditToken, TSACreateInput, TSAPatch } from "../session/session.ts";
import type { TSAInventoryRow } from "./tsa-inventory-view.ts";

export type TSAFilter = "all" | TSAService["status"];
export type TSADraft = { title: string; provider: string; recipient: string; owner: string; start_date: string; end_date: string; status: string; exit_milestone: string; risk_notes: string; relationship: "unsupplied" | "recorded"; related_app_ids: string[] };
export type TSADraftErrors = Record<string, string>;
export type TSAEditing = { mode: "create"; expected: TSACreateToken } | { mode: "edit"; expected: TSAEditToken };
export function captureTSADraft(session: DemoSession, service?: TSAService): { editing: TSAEditing; draft: TSADraft } {
  return { editing: service ? { mode: "edit", expected: { session_id: session.session_id, tsa_revision: session.input_revisions.tsa, application_revision: session.input_revisions.applications, tsa_id: service.tsa_id, record_json: JSON.stringify(service) } } : { mode: "create", expected: { session_id: session.session_id, session_revision: session.session_revision } },
    draft: { title: service?.title ?? "", provider: service?.provider ?? "", recipient: service?.recipient ?? "", owner: service?.owner ?? "", start_date: service?.start_date ?? "", end_date: service?.end_date ?? "", status: service?.status ?? "", exit_milestone: service?.exit_milestone ?? "", risk_notes: service?.risk_notes ?? "", relationship: service?.related_app_ids === undefined ? "unsupplied" : "recorded", related_app_ids: [...(service?.related_app_ids ?? [])] } };
}
export function isCurrentTSADraft(session: DemoSession, editing: TSAEditing): boolean {
  return editing.mode === "create" ? editing.expected.session_id === session.session_id && editing.expected.session_revision === session.session_revision : matchesTSAEdit(session, editing.expected.tsa_id, editing.expected);
}
const optional = (text: string) => text.trim() === "" ? null : text;
/** Validate fields with the unchanged complete schema. Existing edit identity,
 * title/provider/recipient and relationships are copied from current source only.
 */
export function prepareTSADraft(session: DemoSession, editing: TSAEditing, draft: TSADraft): { ok: true; input: TSACreateInput; patch: TSAPatch } | { ok: false; errors: TSADraftErrors } {
  try {
    if (!isCurrentTSADraft(session, editing)) return { ok: false, errors: { form: "Source changed. Reload current values or Cancel; your draft has not been saved." } };
    const original = editing.mode === "edit" ? session.current_deal.tsa_services.find((s) => s.tsa_id === editing.expected.tsa_id)! : null;
    const candidate = { tsa_id: original?.tsa_id ?? "new-service-validation", title: original?.title ?? draft.title, provider: original?.provider ?? draft.provider, recipient: original?.recipient ?? draft.recipient,
      owner: optional(draft.owner), start_date: optional(draft.start_date), end_date: optional(draft.end_date), status: draft.status, exit_milestone: optional(draft.exit_milestone), risk_notes: optional(draft.risk_notes),
      ...(original ? original.related_app_ids === undefined ? {} : { related_app_ids: original.related_app_ids } : draft.relationship === "recorded" ? { related_app_ids: draft.related_app_ids } : {}) };
    const parsed = TSAServiceSchema.safeParse(candidate), errors: TSADraftErrors = {};
    if (!parsed.success) for (const issue of parsed.error.issues) { const field = String(issue.path[0] ?? "form"); errors[field] = field === "risk_notes" ? "Use at most 500 characters of notes." : field.includes("date") ? "Use a valid YYYY-MM-DD date; end must be on or after start." : field === "related_app_ids" ? "Select at most ten distinct current applications." : field === "status" ? "Select a source status." : "Provide a nonblank source value."; }
    if (candidate.related_app_ids?.some((id) => !session.current_deal.applications.some((a) => a.app_id === id))) errors.related_app_ids = "Select only applications in the current shared inventory.";
    if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
    const { tsa_id: _id, ...input } = parsed.data;
    const patch = { owner: input.owner, start_date: input.start_date, end_date: input.end_date, status: input.status, exit_milestone: input.exit_milestone, risk_notes: input.risk_notes };
    return { ok: true, input, patch };
  } catch { return { ok: false, errors: { form: "The TSA draft could not be validated. Review the fields or Cancel." } }; }
}
export function filterTSARows(rows: readonly TSAInventoryRow[], status: TSAFilter): readonly TSAInventoryRow[] { return status === "all" ? rows : rows.filter((r) => r.service.status === status); }
export function tsaAttention(service: TSAService, reference: string): string {
  const date = TSAServiceSchema.shape.end_date.safeParse(reference); if (!date.success || date.data === null) return "Date reference unavailable";
  const label = (name: string, value: string | null) => value === null ? `${name} date unknown` : `${name} date ${value < reference ? "before" : value === reference ? "on" : "after"} reference`;
  return `${label("Start", service.start_date)}. ${label("End", service.end_date)}. ${service.exit_milestone === null ? "Exit milestone unknown" : "Exit milestone supplied; completion not verified"}.`;
}
