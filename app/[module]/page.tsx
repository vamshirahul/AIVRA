import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Arrow, Badge, ButtonLink, Card } from "../../components/ui";
import { workspaceModules } from "../../lib/workspace/routes";
import { AIStatusNotice } from "../../components/ai/ai-status-notice";
import { SampleInventoryPreview } from "../../components/data-mapper/sample-inventory-preview";

export const dynamicParams = false;

export function generateStaticParams() {
  return workspaceModules.map((item) => ({ module: item.href.slice(1) }));
}

async function getModule(params: Promise<{ module: string }>) {
  const { module: slug } = await params;
  return workspaceModules.find((item) => item.href === `/${slug}`);
}

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }): Promise<Metadata> {
  const module = await getModule(params);
  return { title: module ? `${module.title} | AIVRA Public Preview` : "Page not found | AIVRA" };
}

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const module = await getModule(params);
  if (!module) notFound();
  const related = workspaceModules.filter((item) => item.href !== module.href && item.group === module.group);
  const next = related[0] ?? workspaceModules.find((item) => item.href === "/data-mapper")!;

  return (
    <div className="page-container">
      <p className="breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span>{module.group}</span></p>
      <p className="eyebrow">{module.group}</p>
      <h1 className="page-title">{module.title}</h1>
      <p className="page-description">{module.purpose}</p>
      {["/application-rationalization", "/license-optimizer", "/playbook-generator", "/ai-assistant"].includes(module.href) && <AIStatusNotice state={{ status: "not_enabled" }} />}

      {module.href === "/data-mapper" ? <SampleInventoryPreview /> : <>
      <Card className="mt-9 px-6 py-9 sm:p-10">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-background text-muted" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></svg>
        </div>
        <Badge>Not yet implemented</Badge>
        <h2 className="mt-5 mb-3 text-xl font-semibold tracking-tight">A place for the next part of your workflow</h2>
        <p className="max-w-xl text-sm leading-7 text-muted">This module currently provides an introduction only. Its tools, interactions and results are not yet implemented. No analysis has been run and no output is available.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/" secondary>Back to overview</ButtonLink>
          {next.href !== module.href && <ButtonLink href={next.href}>Explore {next.title} <Arrow /></ButtonLink>}
        </div>
      </Card>
      <p className="mt-5 text-xs leading-6 text-muted">You can explore the other module introductions from the workspace navigation. AI integration is planned.</p>
      </>}
    </div>
  );
}
