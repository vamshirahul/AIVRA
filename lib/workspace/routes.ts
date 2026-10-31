export const navigationGroups = [
  { label: "Overview", items: [
    { href: "/", title: "Home", purpose: "Explore the public preview workspace." },
    { href: "/integration-health", title: "Integration Health Dashboard", purpose: "Bring application, TSA and planning progress into one view when those tools are available." },
  ] },
  { label: "Prepare", items: [
    { href: "/data-mapper", title: "Data Mapper Engine", purpose: "Prepare Buyer and Target application inventories for a consistent analysis." },
  ] },
  { label: "Analyze", items: [
    { href: "/application-rationalization", title: "Application Rationalization", purpose: "Review AI-assisted application overlap and disposition suggestions when analysis is implemented." },
    { href: "/license-optimizer", title: "License Optimizer", purpose: "Explore advisory license opportunities grounded in the available inventory and evidence." },
  ] },
  { label: "Model", items: [
    { href: "/cost-synergy", title: "Cost Synergy Estimator", purpose: "Explore illustrative costs and potential savings using transparent assumptions." },
    { href: "/scenario-modeling", title: "Scenario / What-if Modeling", purpose: "Compare a baseline with an alternative once reviewed inputs and calculations are available." },
  ] },
  { label: "Execute", items: [
    { href: "/playbook-generator", title: "Playbook Generator", purpose: "Organize reviewed findings into a draft integration plan when generation is available." },
    { href: "/tsa-tracker", title: "TSA Tracker", purpose: "Track illustrative transition services, responsibilities and exit milestones." },
  ] },
  { label: "Ask AIVRA", items: [
    { href: "/ai-assistant", title: "AI M&A Assistant", purpose: "Ask questions grounded in the current example deal when AI integration is implemented." },
  ] },
] as const;

export const workspaceModules = navigationGroups.flatMap((group) =>
  group.items.filter((item) => item.href !== "/").map((item) => ({ ...item, group: group.label })),
);
