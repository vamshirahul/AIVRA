import { createElement as h } from "react";
import { AIStatusNotice } from "../ai/ai-status-notice.ts";
import type { ALAResultsView } from "../../lib/ala/results-view.ts";

const relationships = { functional_overlap: "Functional overlap", potentially_related: "Potentially related", unique: "Unique", uncertain: "Uncertain" };
const attributes: Record<string, string> = { app_id: "Application ID", company_side: "Company side", app_name: "Application name", function: "Business function", vendor: "Vendor", annual_cost: "Annual cost", deployment: "Deployment", criticality: "Criticality", lifecycle: "Lifecycle", owner: "Owner", notes: "Notes" };
const side = (value: "buyer" | "target") => value === "buyer" ? "Buyer" : "Target";
const detail = (label: string, text: string) => h("details", null, h("summary", null, label), h("p", null, text));
const members = (apps: readonly { readonly app_id: string; readonly name: string }[]) => apps.length
  ? h("ul", null, ...apps.map((app) => h("li", { key: app.app_id }, h("strong", null, app.app_id), h("p", null, app.name)))) : "None / Not applicable";

/** Pure display of a trusted immutable projection; no fetch, state, parsing, edits or persistence. */
export function ALAResultsGrid({ view }: { view: ALAResultsView }) {
  if (view.state === "absent") return h("section", { className: "ala-results", "aria-label": "Application rationalization results" },
    h("h3", { className: "section-title" }, "Application rationalization results"),
    h("p", null, "No AI analysis has been run. No findings are available. Results require a separately approved protected AI integration."));
  if (view.state === "invalid") return h(AIStatusNotice, { state: { status: "error", safeErrorCode: "invalid_model_output" } });
  if (view.state === "outdated") return h("div", { className: "ala-results ala-coverage-warning", role: "status" },
    "Outdated: application source data or session changed. No analysis rows are shown. A current validated result is required.");
  // Closed union: notices never carry data or stale attributes.
  if (!("data" in view)) return null;
  const data = view.data;
  const actionCount = data.findings.reduce((sum, finding) => sum + finding.actions.length, 0);
  return h("section", { className: "ala-results", "aria-label": "Application rationalization results" },
    h("h2", { className: "section-title" }, "Application rationalization results"),
    h(AIStatusNotice, { state: { status: "completed", resultMetadata: data.metadata, freshness: "current" } }),
    h("p", { className: "ala-draft-disclaimer" }, "AI-generated draft — review required; not transaction advice or approved decision."),
    h("p", { className: view.state === "incomplete" ? "ala-coverage-warning" : undefined, role: "status" },
      view.state === "incomplete" ? "Incomplete analysis — not all source applications were assessed." : "Complete source coverage — structural accounting only, not verification of recommendations."),
    h("dl", { className: "ala-grid-summary" },
      ...(["buyer", "target"] as const).map((key) => h("div", { key }, h("dt", null, `${side(key)} applications accounted / source`), h("dd", null, `${data.coverage[key].accounted_count} / ${data.coverage[key].source_count}`))),
      ...[["Findings", data.findings.length], ["Action rows", actionCount], ["Not evaluated", data.not_evaluated.length], ["Missing", data.missing.length], ["Application source revision", data.source_revision]].map(([label, count]) => h("div", { key: label }, h("dt", null, label), h("dd", null, count)))),
    h("p", null, "Application counts are unique source records. Findings and action rows may repeat an application. Explicit not-evaluated records are accounted but remain unassessed."),
    h("details", { className: "ala-provenance" }, h("summary", null, "AI provenance"),
      h("dl", null, ...Object.entries({ "Provider": data.metadata.model_provider, "Model": data.metadata.model_id, "Mode": data.metadata.mode,
        "Routing reason": data.metadata.mode === "fallback" ? data.metadata.routing_reason : "None / Not applicable",
        "Prompt version": data.provenance.prompt_version, "Generated at (UTC)": data.provenance.generated_at,
        "Request ID": data.provenance.request_id, "Input digest": data.provenance.input_digest }).map(([label, value]) => h("div", { key: label }, h("dt", null, label), h("dd", null, value))))),
    (data.missing.length > 0 || data.not_evaluated.length > 0) && h("section", { className: "ala-coverage-warning", "aria-label": "Unassessed source applications" },
      h("h3", null, "Unassessed source applications"), h("ul", null,
        ...data.missing.map((item) => h("li", { key: item.app_id }, `${side(item.side)} ${item.app_id}: No AI finding returned — Not assessed.`)),
        ...data.not_evaluated.map((item) => h("li", { key: item.app_id }, `${side(item.side)} ${item.app_id}: Not evaluated — ${item.reason}`)))),
    h("p", null, "Evidence pointers identify captured source attributes; they do not independently verify LLM reasoning. Uncertainty is qualitative, not a calibrated probability. Null source values are Unknown; zero remains zero."),
    h("p", null, "Scroll the table horizontally on narrow screens. Expand each rationale to read its full text."),
    h("div", { className: "ala-results-scroll", role: "region", "aria-label": "Application rationalization findings, horizontally scrollable", tabIndex: 0 },
      h("table", { className: "ala-results-table" }, h("caption", null, "AI draft findings and original per-application actions"),
        h("thead", null, h("tr", null, ...["Finding / domain / relationship", "Buyer applications", "Target applications", "AI action / destination / rationale", "Finding rationale", "Captured source evidence", "Qualitative uncertainty"].map((label) => h("th", { key: label, scope: "col" }, label)))),
        ...data.findings.map((finding) => h("tbody", { key: finding.finding_id }, ...finding.actions.map((action, index) => h("tr", { key: action.action_id },
          index === 0 && h("th", { scope: "rowgroup", rowSpan: finding.actions.length }, finding.finding_id, h("p", null, finding.domain), h("p", null, relationships[finding.relationship])),
          index === 0 && h("td", { rowSpan: finding.actions.length }, members(finding.buyer)),
          index === 0 && h("td", { rowSpan: finding.actions.length }, members(finding.target)),
          h("td", null, h("strong", null, action.action_id), h("p", null, `${side(action.subject.side)} ${action.subject.app_id}`), h("p", null, action.disposition),
            h("p", null, "Destination: ", action.destination ? `${side(action.destination.side)} ${action.destination.app_id}` : "None / Not applicable"), detail("Action rationale", action.rationale)),
          index === 0 && h("td", { rowSpan: finding.actions.length }, detail("Finding rationale", finding.rationale)),
          index === 0 && h("td", { rowSpan: finding.actions.length }, h("ul", null, ...finding.source_evidence.map((pointer, i) => h("li", { key: i },
            h("strong", null, `${pointer.app_id} · ${attributes[pointer.attribute] ?? pointer.attribute}${pointer.attribute === "annual_cost" ? ` (${data.currency})` : ""}`),
            h("p", null, pointer.value === null ? "Unknown" : String(pointer.value)))))),
          index === 0 && h("td", { rowSpan: finding.actions.length }, h("p", null, finding.uncertainty.level), h("p", null, finding.uncertainty.reason)))))))),
    data.findings.length === 0 && h("p", null, "No AI findings returned. See source coverage above."));
}
