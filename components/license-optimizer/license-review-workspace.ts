"use client";

import { createElement as h, useRef, useState } from "react";
import type { LicenseResultsView } from "../../lib/license-optimizer/results-view.ts";
import { clearLicenseSelection, createLicenseSelectionDraft, licenseReviewEntries, licenseReviewIdentity, licenseReviewKey, saveLicenseSelection, selectedLicenseOverlaps } from "../../lib/license-optimizer/review-selections.ts";
import type { LicenseSelectionDraft, LicenseReviewOperation } from "../../lib/license-optimizer/review-selections.ts";

const idsText = (ids: readonly string[]) => ids.length ? ids.join(", ") : "None";
const valueText = (value: string | number | null) => value === null ? "Unknown" : String(value);
const statusText = (status: "selected" | "not_selected" | undefined) => status === "selected" ? "Selected for further review — unapproved" : status === "not_selected" ? "Not selected — visitor choice" : "Unreviewed";

export function LicenseSelectionStatus({ status }: { status?: "selected" | "not_selected" }) {
  return h("p", { className: "license-selection-status" }, `Visitor selection: ${statusText(status)}`);
}
function ResultReview({ view }: { view: Extract<LicenseResultsView, { data: unknown }> }) {
  const [draft, setDraft] = useState(() => createLicenseSelectionDraft(view)!);
  const latest = useRef<LicenseSelectionDraft>(draft);
  const [message, setMessage] = useState("");
  const entries = licenseReviewEntries(view, draft), selectedOverlaps = selectedLicenseOverlaps(view, draft);
  const identity = licenseReviewIdentity(view)!, data = view.data, p = data.provenance;
  function commit(operation: LicenseReviewOperation, findingId: string) {
    if (!operation.ok) { setMessage(operation.message); return; }
    // Update synchronously as well as scheduling React state, so rapid independent choices cannot lose a save.
    if (operation.changed) { latest.current = operation.draft; setDraft(operation.draft); }
    setMessage(operation.changed ? `Visitor selection updated for ${findingId} in temporary memory only. Not approved.` : `No change to visitor selection for ${findingId}.`);
  }
  return h("section", { className: "license-review", "aria-label": "Provisional license recommendation review" },
    h("h2", { className: "section-title" }, "Review provisional license recommendations"),
    h("p", null, "AI-generated advisory drafts, not contractual or legal determinations. Needs human review; nothing is approved, executed or financially quantified. Original AI findings remain unchanged. Visitor selections are temporary and lost on refresh, navigation, reset or a changed/invalidated analysis."),
    h("p", { className: data.coverage.status === "incomplete" ? "license-review-warning" : undefined }, `Structural coverage: ${data.coverage.status}. Accounted ${data.coverage.accounted_count} of ${data.coverage.source_count} source licenses. Coverage is not evidence verification.`),
    h("p", null, `Missing license IDs: ${idsText(data.coverage.missing_license_ids)}`),
    h("p", null, `Not-evaluated license IDs: ${idsText(data.coverage.not_evaluated_license_ids)}`),
    ...data.not_evaluated.map((item) => h("p", { key: item.license_id }, `${item.license_id}: ${item.reason}`)),
    h("p", { className: data.coverage.overlapping_license_ids.length ? "license-review-warning" : undefined }, `Overlapping findings — shared license IDs: ${idsText(data.coverage.overlapping_license_ids)}. Findings remain distinct; selection does not imply additive savings. No overlaps are automatically resolved.`),
    selectedOverlaps.length > 0 && h("div", { className: "license-review-warning", "aria-label": "Overlapping visitor selections" },
      h("p", null, "Multiple selected findings share sources. Further human review is required; no financial totals or double-count resolution are calculated."),
      ...selectedOverlaps.map((item) => h("p", { key: item.license_id }, `${item.license_id}: ${item.finding_ids.join(", ")}`))),
    h("section", { className: "license-review-provenance", "aria-label": "Original AI provenance" },
      h("h3", null, "Original AI provenance"),
      h("p", null, `${p.mode === "fallback" ? "Open-weight fallback" : "Paid model"}: ${p.model_provider} / ${p.model_id}`),
      p.routing_reason && h("p", null, `Routing reason: ${p.routing_reason}`),
      h("p", null, `Prompt: ${p.prompt_version} · Request: ${p.request_id}`), h("p", null, "Generated: ", h("time", { dateTime: p.generated_at }, p.generated_at)),
      h("p", null, `Input digest: ${p.input_digest}`),
      h("p", null, `Fixture: ${data.source_token.fixture_id} / ${data.source_token.fixture_dataset_version} · Application revision ${data.source_token.application_revision} · License revision ${data.source_token.license_revision}`),
      h("p", null, `Source session: ${data.source_token.session_id} · Source digest: ${data.source_token.source_digest}`),
      h("p", null, `Warnings: ${p.warnings.join(", ")}`)),
    h("p", { role: "status", "aria-live": "polite", "aria-atomic": true }, message),
    !entries.length && h("p", null, "No findings are available for review. Empty findings do not establish zero opportunities; coverage and missing evidence remain as reported."),
    ...entries.map(({ finding, selection }) => {
      const f = finding.original, reference = { result_identity: identity, finding_id: f.finding_id };
      return h("article", { key: f.finding_id, className: "license-review-finding", "aria-label": `License finding ${f.finding_id}` },
        h("h3", null, `${f.finding_id} — ${f.category}`), h("p", null, `License IDs: ${idsText(f.license_ids)}`), h("p", null, `Application IDs: ${idsText(f.app_ids)}`),
        ...finding.applications.map((app) => h("p", { key: app.app_id }, `${app.side === "buyer" ? "Buyer" : "Target"} ${app.app_id}: ${app.name}`)),
        h("h4", null, "Original AI suggested action"), h("p", null, f.suggested_action), h("h4", null, "Original AI rationale"), h("p", null, f.rationale),
        h("h4", null, `Captured license evidence · Currency ${data.currency}`),
        h("ul", null, ...finding.source_evidence.map((e) => h("li", { key: JSON.stringify([e.license_id, e.attribute]) }, `${e.license_id} → ${e.app_id} · ${e.attribute}: ${valueText(e.value)}`))),
        h("h4", null, "Unknowns / missing information"), h("ul", null, ...(f.unknowns.length ? f.unknowns.map((item, i) => h("li", { key: i }, item)) : [h("li", { key: "empty" }, "None stated by the model; this is not proof of complete evidence.")])),
        h("h4", null, "Assumptions"), h("ul", null, ...(f.assumptions.length ? f.assumptions.map((item, i) => h("li", { key: i }, item)) : [h("li", { key: "empty" }, "None stated by the model.")])),
        h("p", null, `Qualitative uncertainty: ${f.uncertainty.level} — ${f.uncertainty.reason}`), h("p", null, `Needs human review: ${f.review_required ? "Yes — not approved" : "Unknown"}`),
        h("fieldset", null, h("legend", null, `Visitor selection for ${f.finding_id}`), h(LicenseSelectionStatus, { status: selection?.status }),
          h("div", { className: "license-review-buttons" },
            ...(["selected", "not_selected"] as const).map((status) => h("button", { key: status, type: "button", className: "button button-secondary", "aria-pressed": selection?.status === status,
              "aria-label": `${status === "selected" ? "Select for further review" : "Do not select"}: ${f.finding_id}`,
              onClick: () => commit(saveLicenseSelection(view, latest.current, { ...reference, status }), f.finding_id) }, status === "selected" ? "Select for further review" : "Do not select")),
            h("button", { type: "button", className: "button button-secondary", "aria-label": `Clear selection and restore unreviewed: ${f.finding_id}`,
              onClick: () => commit(clearLicenseSelection(view, latest.current, reference), f.finding_id) }, "Clear selection / restore unreviewed"))));
    }));
}

/** Owner must propagate a fresh trusted view on shared-source invalidation. No populated public source exists.
 * A keyed lifetime discards selections synchronously on identity changes and unmount/invalid/absent states.
 */
export function LicenseReviewWorkspace({ view }: { view: LicenseResultsView }) {
  const key = licenseReviewKey(view);
  if (key && "data" in view) return h(ResultReview, { key, view });
  const message = view.state === "outdated" ? "License findings are outdated. Current analysis is required before review." : view.state === "invalid" ? "License findings could not be validated. No review is available." : "No AI license analysis has run. No recommendations are available to select.";
  return h("section", { className: "license-review", "aria-label": "License review unavailable" }, h("p", { role: "status" }, message));
}
