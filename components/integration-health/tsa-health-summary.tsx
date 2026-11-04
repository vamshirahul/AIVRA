"use client";

import Link from "next/link";
import { useDemoSession } from "../demo-session-provider";
import { buildTSASummary } from "../../lib/tsa-tracker/tsa-summary";
import type { DemoSession } from "../../lib/session/session";

export function TSAHealthSummary() { const { session, ready } = useDemoSession(); return <TSAHealthSummaryView session={session} ready={ready} />; }
export function TSAHealthSummaryView({ session, ready }: { session: DemoSession | null; ready: boolean }) {
  if (!ready) return <p role="status" className="inventory-loading">Preparing current TSA counts...</p>;
  const built = buildTSASummary(session);
  if (!built.ok) return <section className="tsa-health-summary" aria-label="TSA summary"><h2>Current TSA service counts</h2><p role="status">Unavailable — the current TSA source could not be validated.</p><Link className="text-link" href="/tsa-tracker">View TSA services</Link></section>;
  const s = built.summary, labels = { total: "Total", planned: "Planned", active: "Active", at_risk: "At Risk", completed: "Completed" } as const;
  return <section className="tsa-health-summary" aria-label="TSA summary">
    <p className="badge">Synthetic source inventory</p><h2 className="section-title">Current TSA service counts</h2>
    <p className="inventory-disclosure">All saved TSA services, independent of list filters. At Risk counts source-labeled at_risk records; these are not predicted risks or verified integration outcomes.</p>
    <dl aria-label="TSA service counts" className="tsa-count-grid">{(Object.keys(labels) as (keyof typeof labels)[]).map((key) => <div key={key}><dt>{labels[key]}</dt><dd data-tsa-count={key}>{s.counts[key]}</dd></div>)}</dl>
    <p className="inventory-disclosure tsa-health-source">Fixture dataset {s.source.fixture.dataset_version} · TSA source revision {s.source.tsa_revision} · Application source revision {s.source.application_revision}</p>
    <Link className="text-link" href="/tsa-tracker">View and edit TSA services</Link>
  </section>;
}
