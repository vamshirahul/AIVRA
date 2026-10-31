import Link from "next/link";
import { Arrow, Badge, ButtonLink, Card } from "../components/ui";
import { loadSyntheticDealFixture } from "../lib/fixtures/synthetic-deal";

const workflow = [
  { step: "01", title: "Prepare", text: "Start with consistent Buyer and Target application inventories.", href: "/data-mapper", link: "Data Mapper Engine" },
  { step: "02", title: "Analyze", text: "Review application overlap and advisory license opportunities.", href: "/application-rationalization", link: "Application Rationalization" },
  { step: "03", title: "Model", text: "Explore cost assumptions and compare an alternative scenario.", href: "/cost-synergy", link: "Cost Synergy Estimator" },
  { step: "04", title: "Plan", text: "Develop a draft playbook and follow transition service milestones.", href: "/playbook-generator", link: "Playbook Generator" },
];

export default function HomePage() {
  const fixture = loadSyntheticDealFixture();
  const counts = [
    { label: "Buyer applications", count: fixture.applications.filter((app) => app.company_side === "buyer").length },
    { label: "Target applications", count: fixture.applications.filter((app) => app.company_side === "target").length },
    { label: "License positions", count: fixture.license_positions.length },
    { label: "TSA services", count: fixture.tsa_services.length },
  ];

  return (
    <div className="page-container">
      <p className="breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><span>Overview</span></p>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">AIVRA Public Preview</p>
          <h1 className="page-title">M&A integration workspace</h1>
          <p className="page-description">A connected view of application analysis, cost modelling and integration planning. Explore the intended workflow with fictional example data.</p>
        </div>
        <ButtonLink href="/data-mapper">Explore Data Mapper <Arrow /></ButtonLink>
      </div>

      <div className="mb-9 grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <h2 className="section-title">The example deal</h2><Badge>Synthetic data</Badge>
          </div>
          <div className="flex items-center gap-6 px-6 py-6 sm:gap-10">
            <div className="min-w-0"><p className="mb-1 text-xs text-muted">Buyer</p><p className="text-xl font-semibold tracking-tight">{fixture.buyer_name}</p></div>
            <span className="text-muted" aria-hidden="true"><Arrow /></span>
            <div className="min-w-0"><p className="mb-1 text-xs text-muted">Target</p><p className="text-xl font-semibold tracking-tight">{fixture.target_name}</p></div>
          </div>
          <dl className="grid grid-cols-2 gap-y-6 border-t border-border bg-background px-6 py-5 sm:grid-cols-4">
            {counts.map((item) => <div key={item.label}><dt className="text-[11px] text-muted">{item.label}</dt><dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{item.count}</dd></div>)}
          </dl>
          <p className="px-6 py-3 text-[11px] text-muted">Bundled source records only · Dataset {fixture.dataset_version} · No analysis has been run</p>
        </Card>
        <Card className="flex flex-col items-start p-6">
          <Badge>Workspace shell</Badge>
          <h2 className="section-title mt-5 mb-3">Explore what’s taking shape</h2>
          <p className="text-sm leading-7 text-muted">The navigation and example dataset are ready to explore. Business-module tools and AI integration are not yet implemented.</p>
          <p className="mt-5 border-t border-border pt-4 text-xs leading-6 text-muted">No account is needed. All companies, records and amounts in the bundled example are fictional.</p>
        </Card>
      </div>

      <section aria-labelledby="workflow-heading" className="mb-8">
        <div className="mb-5"><h2 id="workflow-heading" className="section-title">From source data to an integration plan</h2><p className="mt-1 text-xs text-muted">The intended workflow. Each destination currently contains an introductory shell.</p></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {workflow.map((step) => (
            <Link key={step.step} href={step.href} className="workflow-card rounded-xl border border-border bg-surface">
              <span className="step-number">{step.step} <span aria-hidden="true">/</span> WORKFLOW</span>
              <h3 className="mb-2 text-base font-semibold">{step.title}</h3>
              <p className="mb-6 text-xs leading-6 text-muted">{step.text}</p>
              <span className="mt-auto flex items-center justify-between gap-3 text-[11px] font-semibold text-accent">{step.link}<span className="shrink-0"><Arrow /></span></span>
            </Link>
          ))}
        </div>
      </section>

      <Card className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div><h2 className="text-sm font-semibold">Explore at your own pace</h2><p className="mt-1 text-xs text-muted">Visit any module introduction from the sidebar. There is no required sequence.</p></div>
        <Link className="text-link text-xs" href="/integration-health">View Integration Health <span aria-hidden="true">→</span></Link>
      </Card>
    </div>
  );
}
