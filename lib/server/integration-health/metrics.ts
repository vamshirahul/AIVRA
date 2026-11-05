import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DemoSessionSchema } from "../../session/session.ts";
import { buildTSASummary } from "../../tsa-tracker/tsa-summary.ts";
import { projectALAResults } from "../ala/presentation.ts";
import { buildReviewedExport } from "../../ala/review-export.ts";
import { prepareCSEContext } from "../cost-synergy/reviewed-context.ts";
import { CSEResultSchema, MAX_CSE_BYTES, parseCSE, freezeCSE, equalCSE } from "../../cost-synergy/calculation-contract.ts";
import { calculateCSE } from "../../cost-synergy/calculation.ts";
import { buildEstimateRequest } from "../../cost-synergy/estimate-form.ts";
import type { EstimateDraft } from "../../cost-synergy/estimate-form.ts";
import { readPlaybookSource, matchesPlaybookReviewSession, projectPlaybookReview } from "../../playbook-generator/review-draft.ts";
import type { PlaybookReviewSource } from "../../playbook-generator/review-draft.ts";
import { HEALTH_METRICS_VERSION } from "../../integration-health/metrics.ts";
import type { HealthMetric, HealthMetrics, MissingMetricState } from "../../integration-health/metrics.ts";

/** Trusted module-owner composition only. Not an import/HTTP/JSON authority grant.
 * ALA/CSE consistency validation is not authentication of model execution. */
export type HealthSources = {
  session: unknown;
  ala?: { outcome: unknown; captured_session: unknown; review?: unknown } | null;
  estimate?: { result: unknown; draft: EstimateDraft } | null;
  playbook?: { source: PlaybookReviewSource; review?: unknown } | null;
};
export type HealthSourceReader = () => HealthSources | null;
const missing = (state: MissingMetricState, reason: string = state): HealthMetric<never> => ({ state, value: null, reason });
const hash = (v: unknown) => { const json = JSON.stringify(v); if (Buffer.byteLength(json, "utf8") > MAX_CSE_BYTES) throw Error("Source bound"); return createHash("sha256").update(json).digest("hex"); };

function assemble(input: HealthSources | null) {
  if (!input || Object.keys(input).some(k => !["session", "ala", "estimate", "playbook"].includes(k))) return null;
  for (const key of ["ala", "estimate", "playbook"] as const) {
    const value = input[key]; if (value != null && (typeof value !== "object" || Array.isArray(value))) return null;
  }
  // Reuse full bounded session/reference validation, not a dropping count parser.
  const tsa = buildTSASummary(input.session); if (!tsa.ok) return null;
  const s = DemoSessionSchema.parse(input.session), apps = s.current_deal.applications;
  const view = projectALAResults(input.ala?.outcome, input.ala?.captured_session, s);
  let ala: HealthMetrics["ala"] = missing("absent");
  if ("data" in view) {
    const reviewed = input.ala?.review == null ? null : buildReviewedExport(view, input.ala.review);
    ala = reviewed && !reviewed.ok ? missing("invalid", "invalid_saved_review") : {
      state: view.state, trace: { source: "ala.review", request_id: view.data.provenance.request_id, input_digest: view.data.provenance.input_digest },
      value: { original_action_rows: view.data.findings.reduce((n, f) => n + f.actions.length, 0), visitor_overrides: reviewed?.ok ? reviewed.artifact.counts.visitor_overrides : null, missing: view.data.missing.length, not_evaluated: view.data.not_evaluated.length },
    };
  }
  else ala = missing(view.state);
  let estimate: HealthMetrics["estimate"] = missing("absent", "no_calculated_estimate");
  if (input.estimate) {
    try {
      const result = parseCSE(CSEResultSchema, input.estimate.result), a = input.ala;
      const context = a ? prepareCSEContext(a.outcome, a.captured_session, s, a.review) : null;
      if (!result || result.status === "invalid") estimate = missing("invalid");
      else if (!context || !equalCSE(context, result.context)) estimate = missing("outdated", "source_or_saved_review_changed");
      else {
        const built = buildEstimateRequest(context, input.estimate.draft);
        if (!built.ok) estimate = missing("invalid", "invalid_financial_draft");
        else if (!equalCSE(built.request, result.assumptions)) estimate = missing("outdated", "uncalculated_assumption_changes");
        else if (!equalCSE(calculateCSE(built.request, context), result)) estimate = missing("invalid", "inconsistent_calculated_result");
        else if (result.status === "not_computable") estimate = missing("unavailable", "estimate_not_computable");
        else estimate = { state: result.status === "computed" ? "current" : "incomplete", trace: { source: "cse.estimate", request_id: result.context.reviewed!.analysis.provenance.request_id, input_digest: result.context.reviewed!.analysis.provenance.input_digest }, value: { currency: result.currency, money_unit: result.money_unit, totals: result.totals, warnings: result.warnings } };
      }
    } catch { estimate = missing("invalid", "invalid_estimate_input"); }
  }
  let playbook: HealthMetrics["playbook"] = missing("absent"); let playbookBinding: unknown = null;
  if (input.playbook) {
    const p = input.playbook, v = readPlaybookSource(p.source); playbookBinding = v;
    if (!("data" in v)) playbook = missing(v.state);
    else if (!matchesPlaybookReviewSession(p.source, s) || v.data.original.source.deal_digest !== hash(s.current_deal)) playbook = missing("outdated");
    else {
      const reviewed = p.review == null ? null : projectPlaybookReview(p.source, p.review);
      if (p.review != null && !reviewed) playbook = missing("invalid", "invalid_saved_review");
      else playbook = { state: v.state, trace: { source: "playbook.review", request_id: v.data.original.envelope.request_id, input_digest: v.data.original.envelope.input_digest }, value: { activities: v.data.original.envelope.data.actions.length, milestones: v.data.original.envelope.data.milestones.length, visitor_edits: reviewed?.visitor_edit_count ?? null } };
    }
  }
  const binding = hash({ input, playbookBinding });
  const metrics: HealthMetrics = { contract_version: HEALTH_METRICS_VERSION, synthetic: true, illustrative_unapproved: true, source_binding_digest: binding,
    source: { session_id: s.session_id, fixture: s.fixture, session_revision: s.session_revision, input_revisions: s.input_revisions, deal_digest: hash(s.current_deal) },
    applications: { state: "current", trace: { source: "session.applications" }, value: { total: apps.length, buyer: apps.filter(a => a.company_side === "buyer").length, target: apps.filter(a => a.company_side === "target").length } },
    tsa: { state: "current", trace: { source: "session.tsa" }, value: tsa.summary.counts }, ala,
    reviewed_suggestions: missing("not_recorded", "existing_review_records_overrides_not_all_reviewed_suggestions"), estimate, playbook };
  // Full source binding detects changes even when aggregate counts stay equal.
  return { metrics, binding };
}
const issued = new WeakMap<object, { read: HealthSourceReader; binding: string; revoked: boolean }>();
export function buildHealthMetrics(read: HealthSourceReader): { ok: true; metrics: HealthMetrics } | { ok: false; code: "invalid_source" | "source_changed" } {
  try {
    const first = assemble(read()), second = assemble(read());
    if (!first || !second) return { ok: false, code: "invalid_source" };
    if (first.binding !== second.binding || !isDeepStrictEqual(first.metrics, second.metrics)) return { ok: false, code: "source_changed" };
    const metrics = freezeCSE(structuredClone(first.metrics)); issued.set(metrics, { read, binding: first.binding, revoked: false }); return { ok: true, metrics };
  } catch { return { ok: false, code: "invalid_source" }; }
}
export function isCurrentHealthMetrics(metrics: unknown): metrics is HealthMetrics {
  const state = metrics && typeof metrics === "object" ? issued.get(metrics) : null; if (!state || state.revoked) return false;
  try { const now = assemble(state.read()); if (!now || now.binding !== state.binding || !isDeepStrictEqual(now.metrics, metrics)) state.revoked = true; }
  catch { state.revoked = true; } return !state.revoked;
}
