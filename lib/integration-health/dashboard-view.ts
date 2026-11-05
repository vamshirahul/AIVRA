import { z } from "zod";
import { DemoSessionSchema } from "../session/session.ts";
import type { DemoSession } from "../session/session.ts";
import { buildTSASummary, TSACountsSchema } from "../tsa-tracker/tsa-summary.ts";
import { CSEReasonSchema, MAX_MINOR, MAX_CSE_BYTES, equalCSE } from "../cost-synergy/calculation-contract.ts";
import type { HealthMetric, HealthMetrics, MissingMetricState } from "./metrics.ts";

/** Function-bearing protected composition only, never serialized authorization.
 * Production supplies none. A future approved delivery owner must implement the
 * actual U13.01 issuance/currentness checks, not client boolean assertions. */
export type HealthPresentationSource = Readonly<{
  getSnapshot: () => HealthMetrics | null;
  subscribe: (notify: () => void) => () => void;
  isCurrent: (snapshot: unknown) => boolean;
  matchesSession: (session: DemoSession) => boolean;
}>;
const Count = z.number().int().min(0).max(200), Digest = z.string().regex(/^[a-f0-9]{64}$/);
const missingStates = ["absent", "outdated", "invalid", "unavailable", "not_recorded"] as const;
const Missing = z.strictObject({ state: z.enum(missingStates), value: z.null(), reason: z.string().min(1).max(512) });
function metric<T extends z.ZodType>(value: T, source: string) {
  return z.union([Missing, z.strictObject({ state: z.enum(["current", "incomplete"]), value, trace: z.strictObject({ source: z.literal(source), request_id: z.uuid().optional(), input_digest: Digest.optional() }) })]);
}
const Minor = z.number().int().min(0).max(MAX_MINOR).nullable();
const DisplaySchema = z.strictObject({
  contract_version: z.literal("health/metrics/v1"), synthetic: z.literal(true), illustrative_unapproved: z.literal(true), source_binding_digest: Digest,
  source: z.strictObject({ session_id: DemoSessionSchema.shape.session_id, fixture: DemoSessionSchema.shape.fixture, session_revision: DemoSessionSchema.shape.session_revision, input_revisions: DemoSessionSchema.shape.input_revisions, deal_digest: Digest }),
  applications: metric(z.strictObject({ total: Count, buyer: Count, target: Count }), "session.applications"), tsa: metric(TSACountsSchema, "session.tsa"),
  ala: metric(z.strictObject({ original_action_rows: Count, visitor_overrides: Count.nullable(), missing: Count, not_evaluated: Count }), "ala.review"),
  reviewed_suggestions: Missing.extend({ state: z.literal("not_recorded") }),
  estimate: metric(z.strictObject({ currency: z.literal("CAD"), money_unit: z.literal("minor_units"), totals: z.strictObject({
    annual_recurring_savings_minor: Minor, migration_one_time_cost_minor: Minor, transition_overlap_cost_minor: Minor, one_time_total_minor: Minor,
    horizon_recurring_savings_minor: Minor, illustrative_net_benefit_minor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR).nullable(), horizon_years: z.number().int().min(1).max(30).nullable(),
  }), warnings: z.array(CSEReasonSchema).max(12) }), "cse.estimate"),
  playbook: metric(z.strictObject({ activities: Count, milestones: Count, visitor_edits: Count.nullable() }), "playbook.review"),
});
/** Supplemental display guard, not issuance/membership/financial authorization. */
export function validHealthDisplay(value: unknown): value is HealthMetrics {
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_CSE_BYTES && DisplaySchema.safeParse(value).success; } catch { return false; }
}
export const HEALTH_STATE_LABELS = { current: "Current", incomplete: "Incomplete evidence", absent: "Not generated", outdated: "Outdated", invalid: "Invalid result", unavailable: "Unavailable", not_recorded: "Not recorded" } as const;
export const HEALTH_STATE_COPY = {
  current: "Current source data.", incomplete: "Valid partial information. This is not a complete portfolio result.", absent: "No result has been generated for this source.",
  outdated: "The source changed. Previous values are withheld.", invalid: "This result could not be validated. No value is displayed.",
  unavailable: "Protected result delivery is not connected in this preview. No value is displayed.", not_recorded: "The existing workflow does not record this measure.",
} as const;
const unavailable = (state: MissingMetricState): HealthMetric<never> => ({ state, value: null, reason: state });
export function dashboardPresentation(session: DemoSession | null, ready: boolean, snapshot: unknown = null, source: HealthPresentationSource | null = null) {
  const base = { ala: unavailable("unavailable"), estimate: unavailable("unavailable"), playbook: unavailable("unavailable"), reviewed_suggestions: unavailable("not_recorded") };
  if (!ready) return { ...base, state: "loading" as const, applications: null };
  const checked = buildTSASummary(session);
  if (!checked.ok || !session) return { ...base, ala: unavailable("invalid"), estimate: unavailable("invalid"), playbook: unavailable("invalid"), state: "invalid" as const, applications: null };
  const applications = { total: session.current_deal.applications.length, buyer: session.current_deal.applications.filter(a => a.company_side === "buyer").length, target: session.current_deal.applications.filter(a => a.company_side === "target").length };
  if (!source) return { ...base, state: "current" as const, applications };
  let state: MissingMetricState | null = null;
  try {
    if (snapshot === null) state = "unavailable";
    else if (!validHealthDisplay(snapshot)) state = "invalid";
    else if (!source.isCurrent(snapshot) || !source.matchesSession(session) || !equalCSE(snapshot.source.fixture, session.fixture) || snapshot.source.session_id !== session.session_id || snapshot.source.session_revision !== session.session_revision || !equalCSE(snapshot.source.input_revisions, session.input_revisions)) state = "outdated";
    else if (!equalCSE(snapshot.applications.value, applications) || !equalCSE(snapshot.tsa.value, checked.summary.counts)) state = "invalid";
    else return { state: "current" as const, applications, ala: snapshot.ala, estimate: snapshot.estimate, playbook: snapshot.playbook, reviewed_suggestions: snapshot.reviewed_suggestions };
  } catch { state = "invalid"; }
  return { ...base, state: "current" as const, applications, ala: unavailable(state!), estimate: unavailable(state!), playbook: unavailable(state!) };
}
