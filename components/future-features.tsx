const futureFeatures = [
  { id: "M08", label: "Data Migration Readiness Checker", path: "M4 5c0-3 12-3 12 0s-12 3-12 0Zm0 0v10c0 2 5 3 9 2M4 10c0 2 6 3 12 1M16 7V5m-2 15h7m-3-3 3 3-3 3" },
  { id: "M09", label: "System Dependency Mapper", path: "M9 4h6v5H9Zm-6 11h6v5H3Zm12 0h6v5h-6ZM12 9v3M6 15v-3h12v3" },
  { id: "M12", label: "Synergy Realization Tracker", path: "M4 20V10h4v10m4 0v-7h4v7M3 20h18M6 6l5-3 5 4 5-5m-5 0h5v5" },
  { id: "M14", label: "Predictive Risk Assessment", path: "m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6Zm0 4v6m0 3v1" },
  { id: "M15", label: "Portfolio Analytics/Reporting", path: "M4 3h12l4 4v14H4Zm12 0v5h4M8 17v-4m4 4v-7m4 7v-3" },
  { id: "M17", label: "Governance/Approval Workflow", path: "M9 4h6v4H9ZM8 6H5v15h14V6h-3M8 13l2 2 5-5M8 18h8" },
  { id: "M18", label: "Enterprise Connectors", path: "M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0Zm6 10v4M3 10h3m12 0h3" },
] as const;

/** Display-only content. Keep separate from active module navigation/routes. */
export function FutureFeatures() {
  return (
    <section className="future-features" aria-labelledby="future-features-heading">
      <h2 id="future-features-heading">Future Features</h2>
      <p className="future-features-legend">Planned capabilities. Not available yet.</p>
      <ul>
        {futureFeatures.map((feature) => (
          <li className="future-feature" key={feature.id} data-feature-id={feature.id}>
            <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={feature.path} /></svg>
            <div><span className="future-feature-label">{feature.label}</span><span className="future-feature-status">Planned</span></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
