import type { DemoSession } from "../session/session.ts";
import type { TSASummary } from "../tsa-tracker/tsa-summary.ts";
import type { CSEResult } from "../cost-synergy/calculation-contract.ts";

export const HEALTH_METRICS_VERSION = "health/metrics/v1" as const;
export type MissingMetricState = "absent" | "outdated" | "invalid" | "unavailable" | "not_recorded";
export type MetricTrace = Readonly<{ source: "session.applications" | "session.tsa" | "ala.review" | "cse.estimate" | "playbook.review"; request_id?: string; input_digest?: string }>;
export type HealthMetric<T> = Readonly<
  { state: "current" | "incomplete"; value: T; trace: MetricTrace } |
  { state: MissingMetricState; value: null; reason: string }
>;
type ValidEstimate = Exclude<CSEResult, { status: "invalid" }>;
export type HealthMetrics = Readonly<{
  contract_version: typeof HEALTH_METRICS_VERSION;
  synthetic: true; illustrative_unapproved: true; source_binding_digest: string;
  source: Pick<DemoSession, "session_id" | "fixture" | "session_revision" | "input_revisions"> & { deal_digest: string };
  applications: HealthMetric<{ total: number; buyer: number; target: number }>;
  tsa: HealthMetric<TSASummary["counts"]>;
  ala: HealthMetric<{ original_action_rows: number; visitor_overrides: number | null; missing: number; not_evaluated: number }>;
  reviewed_suggestions: HealthMetric<number>;
  estimate: HealthMetric<{ currency: "CAD"; money_unit: "minor_units"; totals: ValidEstimate["totals"]; warnings: ValidEstimate["warnings"] }>;
  playbook: HealthMetric<{ activities: number; milestones: number; visitor_edits: number | null }>;
}>;
