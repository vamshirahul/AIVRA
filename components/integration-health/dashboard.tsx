"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { useDemoSession } from "../demo-session-provider";
import { TSAHealthSummary } from "./tsa-health-summary";
import { dashboardPresentation, HEALTH_STATE_LABELS, HEALTH_STATE_COPY } from "../../lib/integration-health/dashboard-view";
import type { HealthPresentationSource } from "../../lib/integration-health/dashboard-view";
import type { HealthMetric } from "../../lib/integration-health/metrics";
import { formatCAD } from "../../lib/cost-synergy/estimate-form";
import type { CSEReason } from "../../lib/cost-synergy/calculation-contract";

const warningCopy: Record<CSEReason, string> = {
  no_included_lines: "No financial lines are included.", analysis_unavailable: "Validated analysis is unavailable.", analysis_incomplete: "Application analysis coverage is incomplete.",
  missing_horizon: "The calculation horizon is unknown.", missing_amount: "A required assumption amount is unknown.", missing_application_cost: "An application cost is unknown; related annual savings are withheld.",
  unsupported_source_cost: "A source cost cannot be represented safely; related savings are withheld.", unsupported_basis: "A financial basis is unsupported.", unsupported_license_source: "Numeric license aggregation is withheld.", cost_conflict: "Overlapping spend contributions are withheld.",
};
function Tile({ title, value, state, unit, note, tsaKey }: { title: string; value: string | number | null; state: keyof typeof HEALTH_STATE_LABELS; unit: string; note?: string; tsaKey?: string }) {
  return <div className="health-tile" data-state={state}><dt>{title}</dt><dd data-metric={tsaKey ?? title}>{value ?? "Not available"}</dd><span className="health-unit">{unit}</span><span className="health-state">{HEALTH_STATE_LABELS[state]}</span>{note && <p>{note}</p>}</div>;
}
function numericState(metric: HealthMetric<unknown>, value: unknown) { return metric.value !== null && value === null ? "not_recorded" as const : metric.state; }
/** No protected source is supplied by the public route. A function-bearing source
 * is a composition seam, not a serialized server handle or a public transport. */
export function HealthDashboard({ source = null }: { source?: HealthPresentationSource | null }) {
  const { session, ready } = useDemoSession();
  // An owner can revoke the same issued object. Subscribe to notifications, not
  // only object identity, so revocation cannot leave an old tile on screen.
  const delivery = useMemo(() => {
    let revision = 0;
    return { getSnapshot: () => revision, getServerSnapshot: () => 0,
      subscribe: (notify: () => void) => source?.subscribe(() => { revision++; notify(); }) ?? (() => {}) };
  }, [source]);
  useSyncExternalStore(delivery.subscribe, delivery.getSnapshot, delivery.getServerSnapshot);
  let snapshot: unknown = null;
  try { snapshot = source?.getSnapshot() ?? null; } catch { snapshot = {}; }
  const view = dashboardPresentation(session, ready, snapshot, source), a = view.ala, e = view.estimate, p = view.playbook;
  return <section className="health-dashboard" aria-label="Integration Health summary">
    <div className="health-intro"><span className="badge">Fictional transaction · Illustrative measures</span><h2>Current session at a glance</h2><p>Source observations and unapproved drafts, not verified real-world KPIs. Counts do not establish approval, integration progress or completion.</p></div>
    <p className="health-availability" role="status">{view.state === "loading" ? "Loading current session. Counts are not available yet." : view.state === "invalid" ? "The current session could not be validated. Counts are unavailable." : source ? "Protected values are shown only while their source remains current." : "Application and TSA inventory counts are available. Protected analysis, estimates and Playbook results are not connected in this public preview."}</p>
    <div className="health-panels">
      <section className="health-panel" aria-label="Application Landscape"><h2>Application Landscape</h2><p>Saved Buyer and Target inventory in the current browser session.</p><dl className="health-tiles">
        {([['Total applications', 'total'], ['Buyer applications', 'buyer'], ['Target applications', 'target']] as const).map(([title, key]) => <Tile key={key} title={title} value={view.applications?.[key] ?? null} state={view.applications ? "current" : "unavailable"} unit="applications" />)}
      </dl><Link className="text-link" href="/data-mapper">Open Data Mapper</Link></section>
      <section className="health-panel" aria-label="Application Rationalization"><h2>Application Rationalization</h2><p className="health-message">{HEALTH_STATE_COPY[a.state]}</p><dl className="health-tiles">
        <Tile title="Original AI actions" value={a.value?.original_action_rows ?? null} state={a.state} unit="action rows" />
        <Tile title="Recorded visitor overrides" value={a.value?.visitor_overrides ?? null} state={numericState(a, a.value?.visitor_overrides)} unit="proposed overrides" note="Overrides are not approvals or proof all suggestions were reviewed." />
        <Tile title="Missing coverage" value={a.value?.missing ?? null} state={a.state} unit="applications" />
        <Tile title="Not evaluated" value={a.value?.not_evaluated ?? null} state={a.state} unit="applications" />
        <Tile title="All suggestions reviewed" value={null} state="not_recorded" unit="review count unavailable" note="This workflow does not record review of every unchanged suggestion." />
      </dl><Link className="text-link" href="/application-rationalization">Open Application Rationalization</Link></section>
      <section className="health-panel" aria-label="Cost Synergy"><h2>Cost Synergy</h2><p className="health-message">{HEALTH_STATE_COPY[e.state]}</p><p>Explicit visitor assumptions only. No savings are inferred from application or license spending.</p><dl className="health-tiles">
        {([['Annual recurring savings', 'annual_recurring_savings_minor', 'CAD per year'], ['Migration cost', 'migration_one_time_cost_minor', 'CAD once'], ['Transition overlap cost', 'transition_overlap_cost_minor', 'CAD once'], ['Total one-time costs', 'one_time_total_minor', 'CAD once'], ['Horizon recurring savings', 'horizon_recurring_savings_minor', 'CAD over horizon'], ['Illustrative net benefit', 'illustrative_net_benefit_minor', 'CAD over horizon']] as const).map(([title, key, unit]) => <Tile key={key} title={title} value={e.value ? formatCAD(e.value.totals[key]) : null} state={e.state} unit={unit} />)}
      </dl>{e.value && <><p>Calculation horizon: {e.value.totals.horizon_years ?? "Unknown"} {e.value.totals.horizon_years === 1 ? "year" : "years"}.</p>{e.value.warnings.length > 0 && <div className="health-warning"><h3>Estimate limitations</h3><ul>{e.value.warnings.map(w => <li key={w}>{warningCopy[w]}</li>)}</ul></div>}</>}
        <div className="health-links"><Link className="text-link" href="/cost-synergy">Open Cost Synergy Estimator</Link><Link className="text-link" href="/license-optimizer">Open License Optimizer</Link><Link className="text-link" href="/scenario-modeling">Open Scenario Modeling</Link></div>
      </section>
      <div className="health-panel health-tsa"><TSAHealthSummary /></div>
      <section className="health-panel" aria-label="Playbook"><h2>Playbook</h2><p className="health-message">{HEALTH_STATE_COPY[p.state]}</p><dl className="health-tiles">
        <Tile title="Original activities" value={p.value?.activities ?? null} state={p.state} unit="draft activities" />
        <Tile title="Original milestones" value={p.value?.milestones ?? null} state={p.state} unit="draft milestones" />
        <Tile title="Recorded visitor edits" value={p.value?.visitor_edits ?? null} state={numericState(p, p.value?.visitor_edits)} unit="proposed edits" />
      </dl><p>Draft counts are not implementation progress or completion.</p><Link className="text-link" href="/playbook-generator">Open Playbook Generator</Link></section>
    </div>
  </section>;
}
