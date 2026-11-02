"use client";

import { createElement as h, useEffect, useId, useState } from "react";
import type { FormEvent, ChangeEvent } from "react";
import { useDemoSession } from "../demo-session-provider.tsx";
import { CSEContextSchema, parseCSE } from "../../lib/cost-synergy/calculation-contract.ts";
import type { CSEContext, CSEResult, CSEReason } from "../../lib/cost-synergy/calculation-contract.ts";
import { calculateCSE, sourceCostMinor } from "../../lib/cost-synergy/calculation.ts";
import { MONEY_FIELDS, buildEstimateRequest, createEstimateDraft, editorIdentity, editorSessionStamp, formatCAD, matchesEditorSession, verifyEditorDigest } from "../../lib/cost-synergy/estimate-form.ts";
import type { EstimateDraft, FormErrors, MoneyField } from "../../lib/cost-synergy/estimate-form.ts";

const labels: Record<MoneyField, string> = { annual_run_rate: "Annual recurring savings", migration_one_time_cost: "One-time migration cost", transition_overlap_cost: "One-time transition overlap cost" };
const reasons: Record<CSEReason, string> = {
  no_included_lines: "No financial assumption lines are included.", analysis_unavailable: "Validated application analysis is unavailable.", analysis_incomplete: "ALA coverage is incomplete; this is not a complete portfolio estimate.",
  missing_horizon: "Calculation horizon is unknown.", missing_amount: "A required assumption amount is unknown.", missing_application_cost: "Source application annual cost is unknown; annual savings are withheld.",
  unsupported_source_cost: "Source annual cost has unsupported precision or magnitude; annual savings are withheld.", unsupported_basis: "The financial basis is unsupported.", unsupported_license_source: "License financial contributions are withheld in calculation v1.", cost_conflict: "Whole-application spend overlaps; conflicting contributions are withheld." };

export function CSEEmptyState({ checking = false }: { checking?: boolean }) {
  return h("section", { className: "cse-workspace", "aria-label": "Cost estimate readiness" },
    h("div", { className: "cse-panel cse-empty" },
      h("span", { className: "badge" }, "Illustrative estimates · unapproved"),
      h("h2", { className: "section-title" }, checking ? "Checking source freshness" : "No validated ALA analysis available"),
      h("p", { role: "status" }, checking ? "Checking this session against the supplied reviewed result. Financial inputs remain unavailable." : "The cost estimator is not yet available for this session."),
      h("p", null, "A current validated Application Rationalization result is required before entering financial assumptions. No AI analysis or savings estimate is shown here."),
      h("a", { href: "/application-rationalization", className: "text-link" }, "View Application Rationalization")),
    h("div", { className: "cse-readiness" },
      h("div", { className: "cse-panel" }, h("h3", null, "Explicit financial assumptions"), h("p", null, "When a validated reviewed result is available, choose individual actions and supply CAD savings, migration and transition costs with a supporting basis.")),
      h("div", { className: "cse-panel" }, h("h3", null, "Transparent calculation"), h("p", null, "Annual recurring savings across a chosen whole-year horizon, less one-time costs once. Missing inputs stay unknown; overlapping spend is withheld."))),
    h("p", { className: "cse-muted" }, "Synthetic source data only. License cost impacts remain advisory; numeric license aggregation is withheld. Estimates are not approvals, forecasts or verified savings."));
}

/** Only a protected result owner may supply context/current. The public route supplies neither.
 * Currentness checks protect integrity, not model authenticity. No result import or persistence.
 */
export function CostSynergyEstimateWorkspace({ context = null, current = false }: { context?: CSEContext | null; current?: boolean }) {
  const { session, ready } = useDemoSession();
  const identity = context ? editorIdentity(context) : "";
  const stamp = session ? editorSessionStamp(session) : "";
  const key = JSON.stringify([identity, stamp, current]);
  const eligible = current && context !== null && ready && session !== null && !!parseCSE(CSEContextSchema, context) && context.reviewed !== null && matchesEditorSession(context, session);
  const [verified, setVerified] = useState<{ key: string; ok: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    if (eligible && context && session) void verifyEditorDigest(context, session).then((ok) => { if (active) setVerified({ key, ok }); });
    else setVerified(null);
    return () => { active = false; };
  }, [key, eligible, context, session]);
  // A changed key hides AND unmounts the old editor synchronously, before async digest checks.
  if (!eligible || verified?.key !== key || !verified.ok || !context) return h(CSEEmptyState, { checking: eligible && verified?.key !== key });
  return h(CSEEditor, { key, context });
}

/** Internal controlled surface. Direct mounting is for protected composition/offline tests only. */
export function CSEEditor({ context }: { context: CSEContext }) {
  const [draft, setDraft] = useState<EstimateDraft>(() => createEstimateDraft(context));
  const [latest, setLatest] = useState<CSEResult | null>(null);
  const [previous, setPrevious] = useState<CSEResult | null>(null);
  const [calculatedDraft, setCalculatedDraft] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const id = useId();
  const validation = buildEstimateRequest(context, draft);
  const errors: FormErrors = validation.ok ? {} : validation.errors;
  const dirty = latest !== null && calculatedDraft !== JSON.stringify(draft);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitted(true);
    if (!validation.ok) return;
    const next = calculateCSE(validation.request, context);
    // Invalid output is never compared to, or retained as, a valid estimate.
    setPrevious(next.status !== "invalid" && latest?.status !== "invalid" && calculatedDraft !== JSON.stringify(draft) ? latest : previous);
    if (next.status === "invalid") setPrevious(null);
    setLatest(next); setCalculatedDraft(JSON.stringify(draft));
  }
  function edit(index: number, field: MoneyField, part: "amount" | "note", value: string) {
    setDraft((d) => ({ ...d, actions: d.actions.map((a, i) => i === index ? { ...a, [field]: { ...a[field], [part]: value } } : a) }));
  }
  const reviewed = context.reviewed!;
  return h("section", { className: "cse-workspace", "aria-label": "Editable cost assumptions" },
    h("div", { className: "cse-panel cse-context" }, h("span", { className: "badge" }, "Illustrative · unapproved · synthetic source data"),
      h("h2", { className: "section-title" }, "Financial assumptions"),
      h("p", null, "Choose which reviewed actions to include. Supply your own assumptions; source application costs are evidence only and never become savings automatically."),
      h("p", { className: "cse-muted" }, `CAD · application revision ${context.source.application_revision} · license revision ${context.source.license_revision} · fixture ${context.source.fixture_id} / ${context.source.fixture_dataset_version}`),
      h("p", null, `ALA coverage: ${reviewed.analysis.coverage.status}. Missing: ${reviewed.counts.missing}; not evaluated: ${reviewed.counts.not_evaluated}.`),
      context.analysis_state === "incomplete" && h("p", { className: "cse-warning", role: "status" }, reasons.analysis_incomplete),
      h("details", null, h("summary", null, "Source, coverage and AI provenance"),
        h("p", null, `${reviewed.analysis.metadata.model_provider} / ${reviewed.analysis.metadata.model_id} · ${reviewed.analysis.metadata.mode}${reviewed.analysis.metadata.routing_reason ? ` · ${reviewed.analysis.metadata.routing_reason}` : ""}`),
        h("p", null, `${reviewed.analysis.provenance.prompt_version} · ${reviewed.analysis.provenance.generated_at} · request ${reviewed.analysis.provenance.request_id}`),
        h("p", null, `Input digest: ${reviewed.analysis.provenance.input_digest}. Source digest: ${context.source.source_digest}. Review digest: ${context.review_digest}.`),
        ...reviewed.analysis.missing.map((a) => h("p", { key: `m${a.app_id}` }, `No AI finding: ${a.side} / ${a.app_id}`)),
        ...reviewed.analysis.not_evaluated.map((a) => h("p", { key: `n${a.app_id}` }, `Not evaluated: ${a.side} / ${a.app_id}: ${a.reason}`)))),
    h("form", { noValidate: true, onSubmit: submit },
      h("p", { className: "cse-muted", id: `${id}-hint` }, "All amounts are CAD. Blank means unknown. Enter explicit zero with a basis note when intended. Drafts and estimates are lost on refresh, navigation, reset or source/review change."),
      ...reviewed.effective_actions.map((a, index) => {
        const row = draft.actions[index], app = context.applications.find((r) => r.app_id === a.subject.app_id)!;
        const finding = reviewed.analysis.findings.find((f) => f.finding_id === a.finding_id)!;
        return h("fieldset", { className: "cse-panel cse-action", key: a.action_id },
          h("legend", null, `${app.company_side === "buyer" ? "Buyer" : "Target"} · ${app.app_name}`),
          h("details", { className: "cse-action-details" },
          h("summary", null, `Edit financial assumptions for ${a.action_id} — ${row.included ? "included" : "excluded"}`),
          h("p", { className: "cse-muted" }, `Application ${app.app_id} · finding ${a.finding_id} · action ${a.action_id}`),
          h("div", { className: "cse-action-comparison" },
            h("p", null, h("strong", null, "Original AI recommendation: "), `${a.original.disposition}${a.original.destination ? ` → ${a.original.destination.side} / ${a.original.destination.app_id}` : ""}. ${a.original.rationale}`),
            h("p", null, h("strong", null, a.origin === "visitor_override" ? "Visitor override — unapproved: " : "Effective recommendation — unchanged AI: "), `${a.effective.disposition}${a.effective.destination ? ` → ${a.effective.destination.side} / ${a.effective.destination.app_id}` : ""}${a.visitor_reason ? `. ${a.visitor_reason}` : ""}`)),
          h("p", null, `Source annual cost (evidence only): ${app.annual_cost === null ? "Unknown" : sourceCostMinor(app.annual_cost) === null ? `${app.annual_cost} CAD — unsupported precision or magnitude` : formatCAD(sourceCostMinor(app.annual_cost))}. Whole-app spend owner: ${app.app_id}.`),
          h("details", null, h("summary", null, "Original evidence, relationship and uncertainty"),
            h("p", null, `${finding.domain} · ${finding.relationship}. ${finding.rationale}`),
            ...finding.source_evidence.map((e, i) => h("p", { key: i }, `${e.app_id} / ${e.attribute}: ${e.value === null ? "Unknown" : String(e.value)}`)),
            h("p", null, `Uncertainty: ${finding.uncertainty.level}. ${finding.uncertainty.reason}`)),
          h("label", { className: "cse-include" }, h("input", { type: "checkbox", checked: row.included, "aria-describedby": `${id}-hint`,
            onChange: (event) => { const included = event.currentTarget.checked; setDraft((d) => ({ ...d, actions: d.actions.map((r, i) => i === index ? { ...r, included } : r) })); } }), `Include ${a.action_id} in this estimate (not approval)`),
          h("div", { className: "cse-fields" }, ...MONEY_FIELDS.map((field) => {
            const prefix = `${id}-${a.action_id}-${field}`, amountError = errors[`${a.action_id}.${field}.amount`], noteError = errors[`${a.action_id}.${field}.note`];
            return h("div", { key: field },
              h("label", { htmlFor: prefix }, `${labels[field]} (CAD)`),
              h("input", { id: prefix, type: "text", inputMode: "decimal", maxLength: 32, value: row[field].amount, "aria-invalid": !!amountError, "aria-describedby": `${id}-hint${amountError ? ` ${prefix}-error` : ""}`, onChange: (e) => edit(index, field, "amount", e.currentTarget.value) }),
              amountError && h("p", { id: `${prefix}-error`, className: "cse-error" }, amountError),
              h("label", { htmlFor: `${prefix}-note` }, `Basis note for ${labels[field].toLowerCase()} (required when supplied)`),
              h("textarea", { id: `${prefix}-note`, rows: 2, maxLength: 400, value: row[field].note, "aria-invalid": !!noteError, "aria-describedby": `${id}-hint${noteError ? ` ${prefix}-note-error` : ""}`, onChange: (e: ChangeEvent<HTMLTextAreaElement>) => edit(index, field, "note", e.currentTarget.value) }),
              noteError && h("p", { id: `${prefix}-note-error`, className: "cse-error" }, noteError));
          }))));
      }),
      h("div", { className: "cse-panel cse-controls" },
        h("label", { htmlFor: `${id}-horizon` }, "Calculation horizon (whole years, 1–30)"),
        h("input", { id: `${id}-horizon`, type: "text", inputMode: "numeric", maxLength: 3, value: draft.horizon, "aria-invalid": !!errors.horizon, "aria-describedby": `${id}-hint${errors.horizon ? ` ${id}-horizon-error` : ""}`, onChange: (e: ChangeEvent<HTMLInputElement>) => { const horizon = e.currentTarget.value; setDraft((d) => ({ ...d, horizon })); } }),
        errors.horizon && h("p", { id: `${id}-horizon-error`, className: "cse-error" }, errors.horizon),
        h("p", null, `${draft.actions.filter((a) => a.included).length} explicitly included; ${draft.actions.filter((a) => !a.included).length} excluded.`),
        (errors.form || (submitted && !validation.ok)) && h("p", { className: "cse-error", role: "alert" }, errors.form ?? "Check the highlighted financial inputs and basis notes. No new estimate was calculated."),
        h("div", { className: "cse-buttons" }, h("button", { type: "submit", className: "button button-primary" }, latest ? "Recalculate estimate" : "Calculate estimate"),
          h("button", { type: "button", className: "button button-secondary", onClick: () => { setDraft(createEstimateDraft(context)); setLatest(null); setPrevious(null); setCalculatedDraft(null); setSubmitted(false); } }, "Reset financial inputs")))),
    h("div", { "aria-live": "polite", "aria-atomic": true }, dirty ? h("p", { className: "cse-warning", role: "status" }, "Inputs changed — recalculation required. Previous totals are hidden until you calculate again.") : latest && h(EstimateSummary, { result: latest, title: "Current illustrative estimate" })),
    !dirty && latest?.status !== "invalid" && previous && h(EstimateSummary, { result: previous, title: "Previous calculation — previous visitor assumptions" }),
    h("p", { className: "cse-muted" }, "Financial assumptions are separate from AI recommendations and visitor disposition overrides. License financial aggregation remains withheld. No unrelated AI calls are made. This is an illustrative, undiscounted estimate, not a forecast, formal approval or verified saving."));
}

export function EstimateSummary({ result, title }: { result: CSEResult; title: string }) {
  if (result.status === "invalid") return h("div", { className: "cse-panel cse-error", role: "alert" }, result.message, ` (${result.code})`);
  const totals = result.totals;
  const metrics = [
    ["Annual recurring savings", totals.annual_recurring_savings_minor], ["One-time migration cost", totals.migration_one_time_cost_minor], ["One-time transition overlap cost", totals.transition_overlap_cost_minor],
    ["One-time total cost (deducted once)", totals.one_time_total_minor], ["Horizon recurring savings", totals.horizon_recurring_savings_minor], ["Illustrative net benefit", totals.illustrative_net_benefit_minor],
  ] as const;
  return h("section", { className: "cse-panel cse-summary", "aria-label": title },
    h("h2", { className: "section-title" }, title),
    h("p", { className: result.status === "computed" ? "cse-muted" : "cse-warning" }, `${result.status === "computed" ? "Computed illustration — unapproved" : result.status === "incomplete" ? "Incomplete estimate — not a complete portfolio estimate" : "Not computable — no supported monetary estimate"}. Horizon: ${totals.horizon_years ?? "Unknown"} whole years. CAD.`),
    result.status !== "not_computable" && h("dl", { className: "cse-metrics" }, ...metrics.map(([label, amount]) => h("div", { key: label }, h("dt", null, label), h("dd", null, formatCAD(amount))))),
    result.warnings.length > 0 && h("ul", { className: "cse-warning" }, ...result.warnings.map((reason) => h("li", { key: reason }, reasons[reason]))),
    ...result.conflicts.map((c, i) => h("p", { key: i, className: "cse-warning" }, `Conflict: ${c.reason} / ${c.key}. Lines: ${c.line_ids.join(", ")}. No automatic resolution or double counting.`)),
    h("details", null, h("summary", null, "Included, excluded and unknown assumptions"), ...result.lines.map((line) => {
      const input = result.assumptions.lines.find((r) => r.line_id === line.line_id)!;
      return h("div", { key: line.line_id, className: "cse-line-summary" }, h("h3", null, `${line.line_id}: ${line.state}`),
        ...MONEY_FIELDS.map((field) => h("p", { key: field }, `${labels[field]}: ${formatCAD(input[field]?.amount_minor ?? null)}. Basis: ${input[field]?.basis_note ?? "Not supplied"}.`)),
        ...line.reasons.map((r) => h("p", { key: r }, reasons[r])));
    })));
}
