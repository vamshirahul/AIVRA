"use client";

import { Arrow, Badge, Card } from "./ui";
import { useDemoSession } from "./demo-session-provider";

export function DemoDealSummary() {
  const { session } = useDemoSession();
  const deal = session?.current_deal;
  const counts = [
    { label: "Buyer applications", count: deal?.applications.filter((app) => app.company_side === "buyer").length },
    { label: "Target applications", count: deal?.applications.filter((app) => app.company_side === "target").length },
    { label: "License positions", count: deal?.license_positions.length },
    { label: "TSA services", count: deal?.tsa_services.length },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 className="section-title">The example deal</h2><Badge>Synthetic data</Badge>
      </div>
      <div className="flex items-center gap-6 px-6 py-6 sm:gap-10">
        <div className="min-w-0"><p className="mb-1 text-xs text-muted">Buyer</p><p className="text-xl font-semibold tracking-tight">{deal?.buyer_name ?? "Preparing…"}</p></div>
        <span className="text-muted" aria-hidden="true"><Arrow /></span>
        <div className="min-w-0"><p className="mb-1 text-xs text-muted">Target</p><p className="text-xl font-semibold tracking-tight">{deal?.target_name ?? "Preparing…"}</p></div>
      </div>
      <dl className="grid grid-cols-2 gap-y-6 border-t border-border bg-background px-6 py-5 sm:grid-cols-4">
        {counts.map((item) => <div key={item.label}><dt className="text-[11px] text-muted">{item.label}</dt><dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{item.count ?? "—"}</dd></div>)}
      </dl>
      <p className="px-6 py-3 text-[11px] text-muted">Bundled synthetic source records · Dataset {deal?.dataset_version ?? "…"} · Source state only; no analysis is displayed here</p>
    </Card>
  );
}
