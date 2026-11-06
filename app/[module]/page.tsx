import { localPageEnabled } from "../../lib/server/local-ala/page-availability";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { workspaceModules } from "../../lib/workspace/routes";
import { AIStatusNotice } from "../../components/ai/ai-status-notice";
import { SampleInventoryPreview } from "../../components/data-mapper/sample-inventory-preview";
import { AnalyzeApplications } from "../../components/ala/analyze-applications";
import { LicenseInventory } from "../../components/license-optimizer/license-inventory";
import { CostSynergyEstimateWorkspace } from "../../components/cost-synergy/estimate-workspace";
import { ScenarioWorkspace } from "../../components/scenario-modeling/scenario-workspace";
import { TSAInventory } from "../../components/tsa-tracker/tsa-inventory";
import { HealthDashboard } from "../../components/integration-health/dashboard";
import { AssistantWorkspace } from "../../components/ai-assistant/assistant-workspace";
import { GeneratePlaybook } from "../../components/playbook-generator/generate-playbook";

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
  return (
    <div className="page-container">
      <p className="breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span>{module.group}</span></p>
      <p className="eyebrow">{module.group}</p>
      <h1 className="page-title">{module.title}</h1>
      <p className="page-description">{module.purpose}</p>
      {["/license-optimizer"].includes(module.href) && <AIStatusNotice state={{ status: "not_enabled" }} />}

      {module.href === "/integration-health" ? <HealthDashboard /> : module.href === "/data-mapper" ? <SampleInventoryPreview /> : module.href === "/application-rationalization" ? <AnalyzeApplications localDemo={localPageEnabled()} /> : module.href === "/license-optimizer" ? <LicenseInventory /> : module.href === "/cost-synergy" ? <CostSynergyEstimateWorkspace /> : module.href === "/scenario-modeling" ? <ScenarioWorkspace /> : module.href === "/tsa-tracker" ? <TSAInventory /> : module.href === "/playbook-generator" ? <GeneratePlaybook /> : module.href === "/ai-assistant" ? <AssistantWorkspace /> : null}
    </div>
  );
}
