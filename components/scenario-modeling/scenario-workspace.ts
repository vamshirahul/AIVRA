"use client";

import { createElement as h, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useDemoSession } from "../demo-session-provider.tsx";
import { editorSessionStamp, matchesEditorSession, verifyEditorDigest, MONEY_FIELDS, formatCAD } from "../../lib/cost-synergy/estimate-form.ts";
import { REVIEW_DISPOSITIONS } from "../../lib/ala/review-overrides.ts";
import { cloneBaseline, isScenarioSource, scenarioSourceKey, validateCurrentScenario, editAlternativeAction, restoreAlternativeAction, editAlternativeFinancialInput, restoreAlternativeFinancialInput, editAlternativeHorizon, resetAlternative, scenarioChanges } from "../../lib/scenario-modeling/scenario-draft.ts";
import type { ScenarioSource, ScenarioDraft, ScenarioOperation, ScenarioActionEdit } from "../../lib/scenario-modeling/scenario-draft.ts";
import type { ActionDraft, MoneyField } from "../../lib/cost-synergy/estimate-form.ts";
import { compareScenarios, COMPARISON_METRICS } from "../../lib/scenario-modeling/scenario-comparison.ts";
import type { ScenarioComparison, ComparisonMetric } from "../../lib/scenario-modeling/scenario-comparison.ts";

const labels: Record<MoneyField, string> = { annual_run_rate: "Annual recurring savings", migration_one_time_cost: "One-time migration cost", transition_overlap_cost: "One-time transition overlap cost" };
const boundary = "Comparisons use explicit visitor financial assumptions only. Changing a disposition does not automatically change savings. Scenario exports are not available.";
export function ScenarioEmptyState({ checking = false }: { checking?: boolean }) {
  return h("section", { className: "scenario-workspace", "aria-label": "Scenario readiness" }, h("div", { className: "scenario-panel" },
    h("span", { className: "badge" }, "Draft / illustrative / unapproved"), h("h2", { className: "section-title" }, checking ? "Checking baseline source" : "No validated reviewed ALA/CSE baseline available"),
    h("p", { role: "status" }, checking ? "The supplied baseline is being checked against this session. Scenario controls remain unavailable." : "A current reviewed Application Rationalization result and validated Cost Synergy assumptions are required before cloning a scenario."),
    h("div", { className: "scenario-links" }, h("a", { className: "text-link", href: "/application-rationalization" }, "View Application Rationalization"), h("a", { className: "text-link", href: "/cost-synergy" }, "View Cost Synergy")), h("p", { className: "scenario-muted" }, boundary)));
}
/** No public source supplied. A protected owner must provide the original validated
 * projection/context plus current CSE draft; no JSON export becomes trusted here.
 */
export function ScenarioWorkspace({ source = null, current = false }: { source?: ScenarioSource | null; current?: boolean }) {
  const { session, ready } = useDemoSession();
  const key = JSON.stringify([source ? scenarioSourceKey(source) : "", session ? editorSessionStamp(session) : "", current]);
  const eligible = !!(source && current && ready && session && isScenarioSource(source) && matchesEditorSession(source.context, session));
  const [verified, setVerified] = useState<{ key: string; ok: boolean } | null>(null);
  useEffect(() => { let active = true; if (eligible && source && session) void verifyEditorDigest(source.context, session).then((ok) => { if (active) setVerified({ key, ok }); }); else setVerified(null); return () => { active = false; }; }, [key, eligible, source, session]);
  if (!eligible || !source || verified?.key !== key || !verified.ok) return h(ScenarioEmptyState, { checking: eligible && verified?.key !== key });
  return h(ScenarioEditor, { key, source });
}
export function ScenarioEditor({ source }: { source: ScenarioSource }) {
  const [scenario, setScenario] = useState<ScenarioDraft | null>(null), [errors, setErrors] = useState<Record<string, string>>({});
  const [comparison, setComparison] = useState<ScenarioComparison | null>(null), [comparisonMessage, setComparisonMessage] = useState("");
  const [dirtyForms, setDirtyForms] = useState<string[]>([]), [formVersions, setFormVersions] = useState<Record<string, number>>({}), [resetVersion, setResetVersion] = useState(0);
  function invalidate() { setComparison(null); setComparisonMessage("Inputs changed — compare again after saving or restoring unsaved inputs."); }
  function markDirty(key: string) { invalidate(); setDirtyForms((keys) => keys.includes(key) ? keys : [...keys, key]); }
  const latest = useRef(scenario), focus = useRef<string | null>(null); latest.current = scenario;
  const id = useId();
  useEffect(() => { if (focus.current) { document.getElementById(focus.current)?.focus(); focus.current = null; } }, [scenario]);
  function apply(operation: (s: ScenarioDraft) => ScenarioOperation, target: string, formKey = ""): ScenarioOperation {
    invalidate();
    const value = latest.current, result: ScenarioOperation = value ? operation(value) : { ok: false, errors: { form: "Clone a current baseline first." } };
    if (result.ok) { latest.current = result.scenario; focus.current = target; setScenario(result.scenario); setDirtyForms((keys) => keys.filter((k) => k !== formKey)); setFormVersions((versions) => ({ ...versions, [formKey]: (versions[formKey] ?? 0) + 1 })); } return result;
  }
  const c = source.context, reviewed = c.reviewed!;
  const valid = scenario ? validateCurrentScenario(source, scenario) : null;
  if (scenario && !valid) return h(ScenarioEmptyState);
  return h("section", { className: "scenario-workspace", "aria-label": "Baseline and one alternative" },
    h("div", { className: "scenario-panel" }, h("span", { className: "badge" }, "Draft / illustrative / synthetic source data"),
      h("h2", { className: "section-title" }, "Baseline source"),
      h("p", null, `Application revision ${c.source.application_revision}; license revision ${c.source.license_revision}. ${reviewed.effective_actions.length} reviewed action rows. Coverage: ${reviewed.analysis.coverage.status}.`),
      h("p", { className: "scenario-muted" }, `Reviewed analysis ${reviewed.review.result_identity.request_id}. Missing applications: ${reviewed.counts.missing}; not evaluated: ${reviewed.counts.not_evaluated}.`),
      h("p", { className: "scenario-muted" }, "Blank monetary assumptions and horizon remain unknown. No savings are inferred. Financial inclusion is independent of AI advice and is not approval."),
      !scenario && h("button", { type: "button", className: "button button-primary", onClick: () => { const result = cloneBaseline(source, latest.current); if (result.ok) { latest.current = result.scenario; focus.current = `${id}-alternative`; setScenario(result.scenario); } else setErrors(result.errors); } }, "Clone baseline"),
      Object.keys(errors).length > 0 && h("p", { role: "alert", className: "scenario-error" }, Object.values(errors).join(" "))),
    scenario && h("div", null,
      h("section", { className: "scenario-panel scenario-baseline", "aria-label": "Immutable baseline" },
        h("h2", { className: "section-title" }, "Baseline — read-only"), h("p", null, `Horizon assumption: ${scenario.baseline.financial_draft.horizon || "Unknown"} whole years. CAD inputs; no comparative calculation.`),
        h("details", null, h("summary", null, "Inspect immutable baseline actions and financial assumptions"), ...scenario.baseline.actions.map((a) => {
          const line = scenario.baseline.financial_request.lines.find((r) => r.line_id === a.action_id)!;
          return h("div", { className: "scenario-baseline-row", key: a.action_id },
            h("h3", null, `${a.subject.side} / ${a.subject.app_id} · ${a.finding_id} / ${a.action_id}`),
            h("p", null, `Original AI: ${a.original.disposition}${a.original.destination ? ` → ${a.original.destination.side} / ${a.original.destination.app_id}` : ""}. ${a.original.rationale}`),
            h("p", null, `Reviewed baseline: ${a.effective.disposition}${a.effective.destination ? ` → ${a.effective.destination.side} / ${a.effective.destination.app_id}` : ""}. ${a.origin === "visitor_override" ? `Existing visitor override — unapproved. ${a.visitor_reason}` : "Unchanged AI suggestion — unapproved."}`),
            h("p", null, `Financial inclusion: ${line.included ? "Included" : "Excluded"}. Spend owner: ${line.spend_app_ids.join(", ")}.`),
            ...MONEY_FIELDS.map((field) => h("p", { key: field }, `${labels[field]} assumption: ${formatCAD(line[field]?.amount_minor ?? null)}. Basis: ${scenario.baseline.financial_draft.actions.find((r) => r.line_id === a.action_id)![field].note || "Not supplied"}.`)));
        }))),
      h("section", { className: "scenario-panel", "aria-label": "Single alternative scenario" }, h("h2", { id: `${id}-alternative`, tabIndex: -1, className: "section-title" }, "Alternative scenario — hypothetical and unapproved"),
        h("p", { role: "status", "aria-live": "polite" }, `${scenarioChanges(scenario).action_ids.length} action hypotheses; ${scenarioChanges(scenario).financial_line_ids.length} financial rows changed. Exactly one alternative.`),
        h("p", { className: "scenario-muted" }, "Save changes explicitly. Invalid input leaves the last valid alternative unchanged. No AI is called and nothing is written to the shared ALA review, CSE editor or session. Drafts are lost on navigation or refresh."),
        ...scenario.baseline.actions.map((a) => {
          const target = `${id}-${a.action_id}`, edit = scenario.alternative.action_edits.find((r) => r.action_id === a.action_id), row = scenario.alternative.financial_draft.actions.find((r) => r.line_id === a.action_id)!;
          return h("details", { className: "scenario-action", key: a.action_id },
            h("summary", { id: target }, `${a.subject.side === "buyer" ? "Buyer" : "Target"} · ${a.subject.app_id} · ${a.action_id}${edit ? " — edited hypothesis" : " — baseline disposition"}`),
            h("p", null, `Original AI: ${a.original.disposition}. Reviewed baseline: ${a.effective.disposition}${a.visitor_reason ? `. Existing visitor reason: ${a.visitor_reason}` : ""}. Alternative: ${edit?.disposition ?? a.effective.disposition}.`),
            h(ActionForm, { key: `${resetVersion}-${formVersions[`action:${a.action_id}`] ?? 0}-${JSON.stringify(edit ?? null)}`, source, baseline: a, edit, onDirty: () => markDirty(`action:${a.action_id}`), save: (proposal: ScenarioActionEdit) => apply((s) => editAlternativeAction(source, s, proposal), target, `action:${a.action_id}`), restore: () => apply((s) => restoreAlternativeAction(source, s, { finding_id: a.finding_id, action_id: a.action_id, subject: a.subject }), target, `action:${a.action_id}`) }),
            h(FinancialForm, { key: `${resetVersion}-${formVersions[`money:${a.action_id}`] ?? 0}-${JSON.stringify(row)}`, row, onDirty: () => markDirty(`money:${a.action_id}`), save: (next: ActionDraft) => apply((s) => editAlternativeFinancialInput(source, s, next), target, `money:${a.action_id}`), restore: () => apply((s) => restoreAlternativeFinancialInput(source, s, a.action_id), target, `money:${a.action_id}`) }));
        }),
        h(HorizonForm, { key: `${resetVersion}-${formVersions.horizon ?? 0}-${scenario.alternative.financial_draft.horizon}`, value: scenario.alternative.financial_draft.horizon, onDirty: () => markDirty("horizon"), save: (value: string) => apply((s) => editAlternativeHorizon(source, s, value), `${id}-alternative`, "horizon"), restore: () => apply((s) => editAlternativeHorizon(source, s, s.baseline.financial_draft.horizon), `${id}-alternative`, "horizon") }),
        h("button", { className: "button button-secondary", type: "button", onClick: () => { const r = apply((s) => resetAlternative(source, s), `${id}-alternative`); if (!r.ok) setErrors(r.errors); else { setDirtyForms([]); setResetVersion((v) => v + 1); } } }, "Reset alternative to baseline"),
        h("div", { className: "scenario-compare-controls" }, h("button", { className: "button button-primary", type: "button", disabled: dirtyForms.length > 0, onClick: () => { const r = compareScenarios(source, latest.current); setComparison(r.ok ? r.comparison : null); setComparisonMessage(r.ok ? "Comparison calculated from explicit visitor amounts." : r.message); } }, "Compare scenarios"), h("p", { role: "status", "aria-live": "polite", className: "scenario-muted" }, dirtyForms.length ? "Save or restore unsaved inputs before comparing." : comparisonMessage)))),
    comparison && h(ScenarioComparisonView, { comparison }),
    h("p", { className: "scenario-muted" }, boundary));
}

type BaselineAction = ScenarioDraft["baseline"]["actions"][number];
const metricLabels: Record<ComparisonMetric, string> = { annual_recurring_savings_minor: "Annual recurring savings / year", migration_one_time_cost_minor: "One-time migration cost", transition_overlap_cost_minor: "One-time transition overlap cost", one_time_total_minor: "Total one-time cost (deducted once)", horizon_recurring_savings_minor: "Recurring savings over horizon", illustrative_net_benefit_minor: "Illustrative net benefit over horizon" };
export function ScenarioComparisonView({ comparison: c }: { comparison: ScenarioComparison }) {
  const b = c.baseline_result, a = c.alternative_result;
  return h("section", { className: "scenario-panel scenario-comparison", "aria-label": "Scenario financial comparison" },
    h("h2", { className: "section-title" }, "Baseline versus alternative — illustrative and unapproved"),
    h("p", { role: "status" }, `Comparison: ${c.status.replaceAll("_", " ")}. Baseline: ${b.status.replaceAll("_", " ")}; alternative: ${a.status.replaceAll("_", " ")}.`),
    h("p", null, `Horizon assumptions: baseline ${c.horizons.baseline ?? "Unknown"}; alternative ${c.horizons.alternative ?? "Unknown"} whole years. CAD amounts.`),
    h("p", { className: "scenario-muted" }, "Alternative amounts are explicit visitor assumptions. Disposition hypotheses do not generate financial effects or new AI recommendations. A positive cost difference means a larger cost, not a better outcome."),
    !c.horizons.comparable && h("p", { className: "scenario-comparison-warning" }, "Different or unknown horizons: horizon savings and net-benefit differences are not comparable and are withheld."),
    h("table", { className: "scenario-comparison-table" }, h("caption", null, "Explicit financial assumptions calculated by the existing CSE engine. Difference = alternative minus baseline."),
      h("thead", null, h("tr", null, ...["Metric", "Baseline", "Alternative — hypothetical", "Alternative minus baseline"].map((name) => h("th", { key: name, scope: "col" }, name)))),
      h("tbody", null, ...COMPARISON_METRICS.map((key) => {
        const d = c.differences[key];
        return h("tr", { key }, h("th", { scope: "row" }, metricLabels[key]),
          ...[["Baseline", formatCAD(b.totals[key])], ["Alternative — hypothetical", formatCAD(a.totals[key])], ["Alternative minus baseline", d.amount_minor === null ? d.reason === "different_horizon" ? "Not comparable" : "Unknown / Not computable" : `${d.amount_minor >= 0 ? "+" : ""}${formatCAD(d.amount_minor)}`]].map(([label, value]) => h("td", { key: label }, h("span", { className: "scenario-mobile-label", "aria-hidden": true }, label), value)));
      }))),
    h("h3", null, "Coverage and missing-data warnings"), h("p", null, `ALA coverage: ${b.context.reviewed!.analysis.coverage.status}. Missing applications: ${b.context.reviewed!.counts.missing}; not evaluated: ${b.context.reviewed!.counts.not_evaluated}. Incomplete values are not a complete portfolio estimate.`),
    ...[["Baseline", b], ["Alternative", a]].map(([label, result]) => { const r = result as typeof b; return h("div", { key: String(label) }, ...r.warnings.map((w) => h("p", { key: w, className: "scenario-comparison-warning" }, `${label}: ${w.replaceAll("_", " ")}.`)), ...r.conflicts.map((conflict, i) => h("p", { key: i, className: "scenario-comparison-warning" }, `${label} conflict: ${conflict.reason.replaceAll("_", " ")} / ${conflict.key}; lines ${conflict.line_ids.join(", ")}. Contributions are withheld.`))); }),
    h("p", { className: "scenario-muted" }, "Numeric license aggregation remains withheld. Source identity and original reviewed recommendations are unchanged."),
    h("h3", null, "Disposition differences — hypotheses, not AI-generated"),
    c.changed_actions.length === 0 ? h("p", null, "No disposition hypotheses changed.") : c.changed_actions.map((e) => h("p", { key: e.action_id }, `${e.finding_id} / ${e.action_id} / ${e.subject.side} / ${e.subject.app_id}: baseline ${e.baseline_effective.disposition}${e.baseline_effective.destination ? ` → ${e.baseline_effective.destination.side} / ${e.baseline_effective.destination.app_id}` : ""}; hypothetical ${e.disposition}${e.destination ? ` → ${e.destination.side} / ${e.destination.app_id}` : ""}. Scenario reason: ${e.scenario_reason}`)),
    c.unquantified_action_ids.length > 0 && h("p", { className: "scenario-comparison-warning" }, `No corresponding amount/inclusion adjustment for: ${c.unquantified_action_ids.join(", ")}. The financial effect of these hypotheses has not been modeled.`),
    h("details", null, h("summary", null, "Explicit financial assumption differences"), c.financial_changes.length === 0 ? h("p", null, "No financial rows changed.") : c.financial_changes.map((row) => h("div", { key: row.line_id, className: "scenario-baseline-row" }, h("h3", null, row.line_id), h("p", null, `Included: baseline ${row.baseline.included}; alternative ${row.alternative.included}.`), ...MONEY_FIELDS.map((field) => h("p", { key: field }, `${labels[field]}: baseline CAD ${row.baseline[field].amount || "Unknown"} (basis: ${row.baseline[field].note || "Not supplied"}); alternative CAD ${row.alternative[field].amount || "Unknown"} (basis: ${row.alternative[field].note || "Not supplied"}).`))))));
}
function ActionForm({ source, baseline, edit, save, restore, onDirty }: { source: ScenarioSource; baseline: BaselineAction; edit?: ScenarioActionEdit; save: (e: ScenarioActionEdit) => ScenarioOperation; restore: () => ScenarioOperation; onDirty: () => void }) {
  const [disposition, setDisposition] = useState(edit?.disposition ?? baseline.effective.disposition), [destination, setDestination] = useState(edit?.destination?.app_id ?? baseline.effective.destination?.app_id ?? ""), [reason, setReason] = useState(edit?.scenario_reason ?? ""), [errors, setErrors] = useState<Record<string, string>>({});
  const id = useId(), finding = source.context.reviewed!.analysis.findings.find((f) => f.finding_id === baseline.finding_id)!;
  const members = [...finding.buyer.map((a) => ({ ...a, side: "buyer" as const })), ...finding.target.map((a) => ({ ...a, side: "target" as const }))].filter((a) => a.app_id !== baseline.subject.app_id);
  const needsDestination = disposition === "Migrate" || disposition === "Integrate";
  function submit(e: FormEvent) { e.preventDefault(); const target = members.find((a) => a.app_id === destination); const r = save({ finding_id: baseline.finding_id, action_id: baseline.action_id, subject: baseline.subject, disposition, destination: needsDestination && target ? { app_id: target.app_id, side: target.side } : null, scenario_reason: reason }); if (!r.ok) setErrors(r.errors); }
  return h("form", { className: "scenario-form", onSubmit: submit, noValidate: true }, h("fieldset", null, h("legend", null, `Action hypothesis ${baseline.action_id}`),
    h("label", { htmlFor: `${id}-disposition` }, "Alternative disposition"), h("select", { id: `${id}-disposition`, value: disposition, onChange: (e: ChangeEvent<HTMLSelectElement>) => { onDirty(); setDisposition(e.currentTarget.value as ScenarioActionEdit["disposition"]); setDestination(""); }, "aria-describedby": `${id}-errors` }, ...REVIEW_DISPOSITIONS.map((d) => h("option", { key: d, value: d }, d))),
    h("label", { htmlFor: `${id}-destination` }, "Alternative destination"), h("select", { id: `${id}-destination`, value: needsDestination ? destination : "", disabled: !needsDestination, onChange: (e: ChangeEvent<HTMLSelectElement>) => { onDirty(); setDestination(e.currentTarget.value); }, "aria-invalid": !!errors.destination, "aria-describedby": `${id}-errors` }, h("option", { value: "" }, needsDestination ? "Select a destination" : "Not applicable"), ...(needsDestination ? members.map((a) => h("option", { key: a.app_id, value: a.app_id }, `${a.side} / ${a.app_id} · ${a.name}`)) : [])),
    h("label", { htmlFor: `${id}-reason` }, "Scenario justification (required for a change)"), h("textarea", { id: `${id}-reason`, rows: 2, maxLength: 400, value: reason, onChange: (e: ChangeEvent<HTMLTextAreaElement>) => { onDirty(); setReason(e.currentTarget.value); }, "aria-invalid": !!errors.reason, "aria-describedby": `${id}-errors` }),
    h("p", { id: `${id}-errors`, role: Object.keys(errors).length ? "alert" : undefined, className: "scenario-error" }, Object.values(errors).join(" ")),
    h("div", { className: "scenario-buttons" }, h("button", { className: "button button-secondary", type: "submit" }, "Save action hypothesis"), h("button", { className: "button button-secondary", type: "button", onClick: () => { const r = restore(); if (!r.ok) setErrors(r.errors); } }, "Restore baseline action"))));
}
function FinancialForm({ row, save, restore, onDirty }: { row: ActionDraft; save: (r: ActionDraft) => ScenarioOperation; restore: () => ScenarioOperation; onDirty: () => void }) {
  const [draft, setDraft] = useState(() => structuredClone(row)), [errors, setErrors] = useState<Record<string, string>>({}); const id = useId();
  function submit(e: FormEvent) { e.preventDefault(); const r = save(draft); if (!r.ok) setErrors(r.errors); }
  return h("form", { className: "scenario-form", onSubmit: submit, noValidate: true }, h("fieldset", null, h("legend", null, `Financial assumptions ${row.line_id}`),
    h("label", { className: "scenario-include" }, h("input", { type: "checkbox", checked: draft.included, onChange: (e) => { onDirty(); const included = e.currentTarget.checked; setDraft((d) => ({ ...d, included })); } }), "Include in alternative (not approval)"),
    h("div", { className: "scenario-fields" }, ...MONEY_FIELDS.map((field) => {
      const key = `${row.line_id}.${field}`, amountError = errors[`${key}.amount`], noteError = errors[`${key}.note`];
      return h("div", { key: field }, h("label", { htmlFor: `${id}-${field}` }, `${labels[field]} (CAD)`),
        h("input", { id: `${id}-${field}`, type: "text", inputMode: "decimal", maxLength: 32, value: draft[field].amount, "aria-invalid": !!amountError, "aria-describedby": `${id}-errors`, onChange: (e) => { onDirty(); const amount = e.currentTarget.value; setDraft((d) => ({ ...d, [field]: { ...d[field], amount } })); } }),
        amountError && h("p", { className: "scenario-error" }, amountError), h("label", { htmlFor: `${id}-${field}-note` }, `Basis note for ${labels[field].toLowerCase()}`),
        h("textarea", { id: `${id}-${field}-note`, rows: 2, maxLength: 400, value: draft[field].note, "aria-invalid": !!noteError, "aria-describedby": `${id}-errors`, onChange: (e: ChangeEvent<HTMLTextAreaElement>) => { onDirty(); const note = e.currentTarget.value; setDraft((d) => ({ ...d, [field]: { ...d[field], note } })); } }), noteError && h("p", { className: "scenario-error" }, noteError));
    })), h("p", { id: `${id}-errors`, role: Object.keys(errors).length ? "alert" : undefined, className: "scenario-error" }, Object.values(errors).join(" ")),
    h("div", { className: "scenario-buttons" }, h("button", { className: "button button-secondary", type: "submit" }, "Save financial assumptions"), h("button", { className: "button button-secondary", type: "button", onClick: () => { const r = restore(); if (!r.ok) setErrors(r.errors); } }, "Restore baseline financial inputs"))));
}
function HorizonForm({ value, save, restore, onDirty }: { value: string; save: (v: string) => ScenarioOperation; restore: () => ScenarioOperation; onDirty: () => void }) {
  const [horizon, setHorizon] = useState(value), [errors, setErrors] = useState<Record<string, string>>({}); const id = useId();
  return h("form", { className: "scenario-form", noValidate: true, onSubmit: (e: FormEvent) => { e.preventDefault(); const r = save(horizon); if (!r.ok) setErrors(r.errors); } },
    h("label", { htmlFor: id }, "Alternative horizon (whole years, 1–30; blank is unknown)"), h("input", { id, type: "text", inputMode: "numeric", maxLength: 3, value: horizon, onChange: (e: ChangeEvent<HTMLInputElement>) => { onDirty(); setHorizon(e.currentTarget.value); }, "aria-describedby": `${id}-errors`, "aria-invalid": !!errors.horizon }),
    h("p", { id: `${id}-errors`, role: Object.keys(errors).length ? "alert" : undefined, className: "scenario-error" }, Object.values(errors).join(" ")), h("div", { className: "scenario-buttons" }, h("button", { className: "button button-secondary", type: "submit" }, "Save alternative horizon"), h("button", { className: "button button-secondary", type: "button", onClick: () => { const r = restore(); if (!r.ok) setErrors(r.errors); } }, "Restore baseline horizon")));
}
