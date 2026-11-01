"use client";

import { createElement as h, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { ALAResultsView } from "../../lib/ala/results-view.ts";
import { createReviewDraft, effectiveReviewActions, MAX_REVIEW_REASON, restoreAIRecommendation, REVIEW_DISPOSITIONS, reviewActionKey, reviewIdentity, reviewResultKey, saveReviewOverride } from "../../lib/ala/review-overrides.ts";
import type { ReviewActionReference, ReviewDisplayAction, ReviewEdit, ReviewErrors, ReviewOperation } from "../../lib/ala/review-overrides.ts";
import { ALAResultsGrid } from "./ala-results-grid.ts";

const destinationText = (destination: ReviewDisplayAction["effective"]["destination"]) => destination ? `${destination.side === "buyer" ? "Buyer" : "Target"} ${destination.app_id}` : "None / Not applicable";
const targetKey = (destination: ReviewDisplayAction["effective"]["destination"]) => destination ? JSON.stringify([destination.app_id, destination.side]) : "";

export function ALAReviewComparison({ entry }: { entry: ReviewDisplayAction }) {
  return h("div", { className: "ala-review-comparison" },
    h("section", { "aria-label": "Original AI suggestion" }, h("h4", null, "Original AI suggestion"),
      h("p", null, entry.original.disposition), h("p", null, `Destination: ${destinationText(entry.original.destination)}`), h("p", null, entry.original.rationale)),
    h("section", { "aria-label": "Visitor review draft" }, h("h4", null, entry.origin === "visitor_override" ? "Visitor override — not approved" : "AI suggestion — not changed"),
      entry.origin === "visitor_override" && h("div", null, h("p", null, "Visitor-changed draft"), h("p", null, entry.effective.disposition),
        h("p", null, `Destination: ${destinationText(entry.effective.destination)}`), h("p", null, "Visitor justification: ", entry.visitor_reason))));
}

type FormProps = { view: ALAResultsView; entry: ReviewDisplayAction; onSave: (edit: ReviewEdit) => ReviewOperation; onCancel: () => void };
/** Native controlled form; no automatic candidate selection or external side effects. */
export function ALAReviewForm({ view, entry, onSave, onCancel }: FormProps) {
  const prefix = useId();
  const [disposition, setDisposition] = useState(entry.effective.disposition);
  const [destination, setDestination] = useState(targetKey(entry.effective.destination));
  const [reason, setReason] = useState(entry.visitor_reason ?? "");
  const [errors, setErrors] = useState<ReviewErrors>({});
  const identity = reviewIdentity(view);
  if (!identity || !("data" in view)) return null;
  const finding = view.data.findings.find((item) => item.finding_id === entry.finding_id);
  if (!finding) return null;
  const candidates = [...finding.buyer.map((app) => ({ ...app, side: "buyer" as const })), ...finding.target.map((app) => ({ ...app, side: "target" as const }))].filter((app) => app.app_id !== entry.original.subject.app_id);
  const needsDestination = disposition === "Migrate" || disposition === "Integrate";
  const proposedDestination = needsDestination ? candidates.find((app) => targetKey(app) === destination) : null;
  const changed = disposition !== entry.original.disposition || (needsDestination ? destination : "") !== targetKey(entry.original.destination);
  function submit(event: FormEvent) {
    event.preventDefault();
    const result = onSave({ result_identity: identity!, finding_id: entry.finding_id, action_id: entry.original.action_id,
      subject: entry.original.subject, proposed_disposition: disposition,
      proposed_destination: proposedDestination ? { app_id: proposedDestination.app_id, side: proposedDestination.side } : null, visitor_reason: reason });
    if (!result.ok) setErrors(result.errors);
  }
  const fieldError = (field: keyof ReviewErrors) => errors[field] ? h("p", { id: `${prefix}-${field}-error`, className: "ala-review-error" }, errors[field]) : null;
  return h("form", { className: "ala-review-form", "aria-label": `Edit suggestion ${entry.finding_id} / ${entry.original.action_id}`, onSubmit: submit },
    h("fieldset", null, h("legend", null, `Edit ${entry.finding_id} / ${entry.original.action_id}`),
      errors.form && h("p", { role: "alert", className: "ala-review-error" }, errors.form),
      h("label", { htmlFor: `${prefix}-disposition` }, "Proposed disposition"),
      h("select", { id: `${prefix}-disposition`, value: disposition, "aria-invalid": !!errors.disposition, "aria-describedby": errors.disposition ? `${prefix}-disposition-error` : undefined,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => { setDisposition(event.currentTarget.value as typeof disposition); setDestination(""); setErrors({}); } },
        ...REVIEW_DISPOSITIONS.map((value) => h("option", { key: value, value }, value))), fieldError("disposition"),
      needsDestination ? h("div", null, h("label", { htmlFor: `${prefix}-destination` }, "Destination application"),
        h("select", { id: `${prefix}-destination`, value: destination, required: true, "aria-invalid": !!errors.destination,
          "aria-describedby": errors.destination ? `${prefix}-destination-error` : undefined, onChange: (event: ChangeEvent<HTMLSelectElement>) => { setDestination(event.currentTarget.value); setErrors({}); } },
          h("option", { value: "" }, "Select a destination"), ...candidates.map((app) => h("option", { key: targetKey(app), value: targetKey(app) }, `${app.side === "buyer" ? "Buyer" : "Target"} ${app.app_id} — ${app.name}`))), fieldError("destination")) : h("p", null, "Destination: None / Not applicable"),
      h("label", { htmlFor: `${prefix}-reason` }, "Change justification"),
      h("p", { id: `${prefix}-reason-hint` }, "Required for a changed action; at most 400 characters. This is visitor commentary, not the AI rationale."),
      h("textarea", { id: `${prefix}-reason`, value: reason, maxLength: MAX_REVIEW_REASON, required: changed, rows: 3, "aria-invalid": !!errors.reason,
        "aria-describedby": `${prefix}-reason-hint${errors.reason ? ` ${prefix}-reason-error` : ""}`, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { setReason(event.currentTarget.value); setErrors({}); } }), fieldError("reason"),
      Object.keys(errors).length > 0 && !errors.form && h("p", { role: "alert", className: "ala-review-error" }, "The override was not saved. Check the indicated fields."),
      h("div", { className: "ala-review-buttons" }, h("button", { type: "submit", className: "button button-secondary" }, "Save override"),
        h("button", { type: "button", className: "button button-secondary", onClick: onCancel }, "Cancel"))));
}

type RowProps = { view: ALAResultsView; entry: ReviewDisplayAction; onSave: FormProps["onSave"]; onRestore: (reference: ReviewActionReference) => ReviewOperation };
function ReviewActionRow({ view, entry, onSave, onRestore }: RowProps) {
  const [editing, setEditing] = useState(false), [restoreError, setRestoreError] = useState("");
  const editButton = useRef<HTMLButtonElement>(null), focusAfterClose = useRef(false);
  useEffect(() => { if (!editing && focusAfterClose.current) { editButton.current?.focus(); focusAfterClose.current = false; } }, [editing]);
  const closeEditor = () => { focusAfterClose.current = true; setEditing(false); };
  const identity = reviewIdentity(view); if (!identity) return null;
  return h("article", { className: "ala-review-row", "aria-label": `Review ${entry.finding_id} / ${entry.original.action_id}` },
    h("h3", null, `${entry.finding_id} / ${entry.original.action_id}`), h("p", null, `${entry.original.subject.side === "buyer" ? "Buyer" : "Target"} ${entry.original.subject.app_id}`),
    h(ALAReviewComparison, { entry }),
    editing ? h(ALAReviewForm, { view, entry, onCancel: closeEditor, onSave: (edit) => { const result = onSave(edit); if (result.ok) closeEditor(); return result; } }) :
      h("div", { className: "ala-review-buttons" }, h("button", { ref: editButton, type: "button", className: "button button-secondary", onClick: () => { setRestoreError(""); setEditing(true); } }, "Edit suggestion"),
        entry.origin === "visitor_override" && h("button", { type: "button", className: "button button-secondary", onClick: () => {
          const result = onRestore({ result_identity: identity, finding_id: entry.finding_id, action_id: entry.original.action_id, subject: entry.original.subject });
          setRestoreError(result.ok ? "" : result.errors.form ?? "The AI suggestion could not be restored.");
          if (result.ok) editButton.current?.focus();
        } }, "Restore AI suggestion")),
    restoreError && h("p", { role: "alert", className: "ala-review-error" }, restoreError));
}

function ResultReview({ view }: { view: ALAResultsView }) {
  const [draft, setDraft] = useState(() => createReviewDraft(view)!);
  const latest = useRef(draft); // Synchronous updates prevent rapid edits to different rows losing a save.
  const [message, setMessage] = useState("");
  const entries = effectiveReviewActions(view, draft), changed = draft.overrides.length;
  function commit(result: ReviewOperation, restored = false): ReviewOperation {
    if (result.ok) {
      if (result.changed) { latest.current = result.draft; setDraft(result.draft); }
      setMessage(result.changed ? restored ? "AI suggestion restored in this local draft. No approval or source change." : "Visitor override saved to this temporary local draft only — not approved." : "No change to the local draft.");
    }
    return result;
  }
  return h("div", null, h(ALAResultsGrid, { view }), h("section", { className: "ala-review", "aria-label": "Visitor recommendation review" },
    h("h2", { className: "section-title" }, "Review recommendations"),
    h("p", null, "These are temporary visitor drafts of unapproved AI suggestions, not human approvals. They are not saved durably or exported and are lost on refresh, navigation or a changed analysis. The original AI results remain unchanged above."),
    h("p", null, `Original AI actions not changed: ${entries.length - changed}. Visitor overrides: ${changed}.`),
    h("p", { role: "status", "aria-live": "polite", "aria-atomic": true }, message),
    ...entries.map((entry) => h(ReviewActionRow, { key: reviewActionKey(entry.finding_id, entry.original.action_id), view, entry,
      onSave: (edit) => commit(saveReviewOverride(view, latest.current, edit)), onRestore: (reference) => commit(restoreAIRecommendation(view, latest.current, reference), true) }))));
}

/** Only trusted projection props may populate review. No public successful result source exists today.
 * Keyed lifetime resets all saved/unsaved state synchronously, without an effect or storage.
 */
export function ALAReviewWorkspace({ view }: { view: ALAResultsView }) {
  const key = reviewResultKey(view);
  return key ? h(ResultReview, { key, view }) : h(ALAResultsGrid, { view });
}
