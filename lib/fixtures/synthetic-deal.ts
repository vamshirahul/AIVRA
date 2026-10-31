import { DEMO_SCHEMA_VERSION, SyntheticDealFixtureSchema } from "../contracts/demo.ts";
import type { SyntheticDealFixture } from "../contracts/demo.ts";

// Entirely invented source records, not recommendations or model output.
// IDs are assigned literals and must survive renames and array reordering.
const source: SyntheticDealFixture = {
  fixture_id: "deal-6c2e97ab",
  schema_version: DEMO_SCHEMA_VERSION,
  dataset_version: "1.0.0",
  synthetic: true,
  disclosure: "Northstar, Meridian, all vendors, products, roles, amounts and dates are fictional examples for the AIVRA public preview. No actual transaction or verified pricing is represented.",
  buyer_name: "Northstar",
  target_name: "Meridian",
  currency: "CAD",
  applications: [
    {
      app_id: "app-8c31e7a2", company_side: "buyer", app_name: "Orbit Ledger", function: "ERP",
      vendor: "Cobalt Finch Software", annual_cost: 180000, deployment: "hybrid", criticality: "critical",
      lifecycle: "active", owner: "Northstar Finance Systems", notes: "Purchase orders, general ledger and inventory for three fictional operating units.",
    },
    {
      app_id: "app-f62a409d", company_side: "buyer", app_name: "Lantern Sales", function: "CRM",
      vendor: "Amber Quill Systems", annual_cost: 72000, deployment: "cloud", criticality: "high",
      lifecycle: "active", owner: "Northstar Revenue Operations", notes: "Account contacts and sales opportunities; 120 named seats.",
    },
    {
      app_id: "app-1b74d6e8", company_side: "buyer", app_name: "Meadow People", function: "HR",
      vendor: "Meadowglass Labs", annual_cost: 54000, deployment: "cloud", criticality: "high",
      lifecycle: "active", owner: "Northstar People Operations", notes: "Employee records and leave requests; payroll handled separately.",
    },
    {
      app_id: "app-d9a205fc", company_side: "buyer", app_name: "Harbor Rooms", function: "Collaboration",
      vendor: "Paper Harbor Software", annual_cost: 36000, deployment: "cloud", criticality: "medium",
      lifecycle: "active", owner: "Northstar Workplace IT", notes: "Team messaging, shared documents and meeting spaces.",
    },
    {
      app_id: "app-3e91b8a6", company_side: "buyer", app_name: "Quartz Gate", function: "Identity",
      vendor: "Quartz Badger Security", annual_cost: 48000, deployment: "cloud", criticality: "critical",
      lifecycle: "active", owner: "Northstar Security Operations", notes: "Workforce sign-on and access groups for office applications.",
    },
    {
      app_id: "app-a7f452c0", company_side: "buyer", app_name: "Birch Service", function: "IT Service Management",
      vendor: "Birch Circuit Tools", annual_cost: 30000, deployment: "cloud", criticality: "high",
      lifecycle: "active", owner: "Northstar Workplace IT", notes: "Service tickets, change requests and a small asset catalogue.",
    },
    {
      app_id: "app-5d20ce93", company_side: "buyer", app_name: "Lumen Reports", function: "Analytics",
      vendor: "Lumen Otter Analytics", annual_cost: 24000, deployment: "cloud", criticality: "medium",
      lifecycle: "active", owner: "Northstar Data Office", notes: "Operational reporting from scheduled ERP extracts.",
    },
    {
      app_id: "app-b8146f2e", company_side: "buyer", app_name: "Pebble Payables", function: "Finance",
      vendor: "Pebble Kite Software", annual_cost: 18000, deployment: "on_premise", criticality: "high",
      lifecycle: "legacy", owner: "Northstar Finance Systems", notes: "Invoice approval register with a nightly ledger export.",
    },
    {
      app_id: "app-72e9a50b", company_side: "buyer", app_name: "Fern Supplier", function: "Procurement",
      vendor: "Fernwheel Systems", annual_cost: 16000, deployment: "cloud", criticality: "medium",
      lifecycle: "active", owner: "Northstar Supply Operations", notes: "Supplier onboarding forms and purchasing requests.",
    },
    {
      app_id: "app-c0a36d71", company_side: "buyer", app_name: "Rook Stock", function: "Warehouse",
      vendor: "Rook Compass Tools", annual_cost: 42000, deployment: "on_premise", criticality: "critical",
      lifecycle: "active", owner: "Northstar Supply Operations", notes: "Warehouse receiving, bin locations and shipment labels.",
    },
    {
      app_id: "app-49f8b213", company_side: "buyer", app_name: "Cloudberry Vault", function: "Backup",
      vendor: "Cloudberry Loom Systems", annual_cost: 22000, deployment: "hybrid", criticality: "high",
      lifecycle: "active", owner: "Northstar Infrastructure", notes: "Scheduled backups of office servers and document stores.",
    },
    {
      app_id: "app-e65c091a", company_side: "buyer", app_name: "Copper Learning", function: "Learning",
      vendor: "Copper Wren Learning", annual_cost: 12000, deployment: "cloud", criticality: "low",
      lifecycle: "active", owner: "Northstar People Operations", notes: "Internal training catalogue and course completion records.",
    },
    {
      app_id: "app-06b7e4d9", company_side: "buyer", app_name: "Moss Archive", function: "Document Management",
      vendor: null, annual_cost: null, deployment: "on_premise", criticality: "medium",
      lifecycle: "legacy", owner: null, notes: "Scanned purchase records; vendor, owner and annual support cost are not supplied.",
    },
    {
      app_id: "app-91d3f06c", company_side: "buyer", app_name: "Sparrow Tasks", function: "Project Management",
      vendor: "Sparrow Spindle Tools", annual_cost: 0, deployment: "cloud", criticality: "low",
      lifecycle: "active", owner: "Northstar Delivery Office", notes: "Fictional no-charge community edition; zero is a known source amount.",
    },
    {
      app_id: "app-2af65c80", company_side: "buyer", app_name: "Aster Watch", function: "Security",
      vendor: "Aster Anchor Security", annual_cost: 56000, deployment: "hybrid", criticality: "critical",
      lifecycle: "active", owner: "Northstar Security Operations", notes: "Endpoint event collection and security alert triage.",
    },
    {
      app_id: "app-7b2e9c41", company_side: "target", app_name: "Cedar Ledger", function: "ERP",
      vendor: "Cedar Lantern Software", annual_cost: 135000, deployment: "on_premise", criticality: "critical",
      lifecycle: "legacy", owner: "Meridian Finance Systems", notes: "General ledger, order processing and stock balances for two fictional sites.",
    },
    {
      app_id: "app-da048f67", company_side: "target", app_name: "Lantern Sales Regional", function: "CRM",
      vendor: "Amber Quill Systems", annual_cost: 42000, deployment: "cloud", criticality: "high",
      lifecycle: "active", owner: "Meridian Revenue Operations", notes: "Regional accounts and opportunity tracking; separately configured tenant with 70 seats.",
    },
    {
      app_id: "app-4f93a0be", company_side: "target", app_name: "Willow People", function: "HR",
      vendor: "Willow Thimble Labs", annual_cost: 32000, deployment: "cloud", criticality: "high",
      lifecycle: "active", owner: "Meridian People Operations", notes: "Employee records, leave approvals and payroll file preparation.",
    },
    {
      app_id: "app-ec625819", company_side: "target", app_name: "Harbor Rooms Regional", function: "Collaboration",
      vendor: "Paper Harbor Software", annual_cost: 21000, deployment: "cloud", criticality: "medium",
      lifecycle: "active", owner: "Meridian Workplace IT", notes: "Messaging and shared documents in a separate regional workspace.",
    },
    {
      app_id: "app-15ac7d90", company_side: "target", app_name: "Juniper Access", function: "Identity",
      vendor: "Juniper Acorn Security", annual_cost: 18000, deployment: "hybrid", criticality: "critical",
      lifecycle: "active", owner: "Meridian Security Operations", notes: "Directory-backed workforce authentication and application access groups.",
    },
    {
      app_id: "app-86d0b3fa", company_side: "target", app_name: "Birch Help", function: "IT Service Management",
      vendor: "Birch Circuit Tools", annual_cost: 14000, deployment: "cloud", criticality: "high",
      lifecycle: "active", owner: "Meridian Workplace IT", notes: "Regional incident queue and equipment support records.",
    },
    {
      app_id: "app-f3c41e72", company_side: "target", app_name: "Reed Metrics", function: "Analytics",
      vendor: "Reed Marble Analytics", annual_cost: 15000, deployment: "on_premise", criticality: "medium",
      lifecycle: "active", owner: "Meridian Data Office", notes: "Sales and warehouse reports from local database extracts.",
    },
    {
      app_id: "app-20e8a65d", company_side: "target", app_name: "Finch Expenses", function: "Finance",
      vendor: "Finch Trestle Software", annual_cost: 10000, deployment: "cloud", criticality: "medium",
      lifecycle: "active", owner: "Meridian Finance Systems", notes: "Employee expense approvals and reimbursement exports.",
    },
    {
      app_id: "app-b7a912cf", company_side: "target", app_name: "Maple Purchase", function: "Procurement",
      vendor: "Maple Bobbin Systems", annual_cost: 9000, deployment: "cloud", criticality: "medium",
      lifecycle: "active", owner: "Meridian Supply Operations", notes: "Purchase request routing and supplier contact register.",
    },
    {
      app_id: "app-63f0d4a8", company_side: "target", app_name: "Dune Dispatch", function: "Warehouse",
      vendor: "Dune Button Tools", annual_cost: 28000, deployment: "on_premise", criticality: "critical",
      lifecycle: "active", owner: "Meridian Supply Operations", notes: "Pick lists, dispatch labels and shipment status recording.",
    },
    {
      app_id: "app-a09c528e", company_side: "target", app_name: "Cloudberry Vault Regional", function: "Backup",
      vendor: "Cloudberry Loom Systems", annual_cost: 13000, deployment: "hybrid", criticality: "high",
      lifecycle: "active", owner: "Meridian Infrastructure", notes: "Regional server backups with an independent retention schedule.",
    },
    {
      app_id: "app-3d6b18f4", company_side: "target", app_name: "Larch Courses", function: "Learning",
      vendor: "Larch Basket Learning", annual_cost: 6000, deployment: "cloud", criticality: "low",
      lifecycle: "active", owner: "Meridian People Operations", notes: "Safety induction and role-specific training records.",
    },
    {
      app_id: "app-d5e70a29", company_side: "target", app_name: "Clover Records", function: "Document Management",
      vendor: "Clover Bell Software", annual_cost: null, deployment: null, criticality: "medium",
      lifecycle: null, owner: "Meridian Workplace IT", notes: "Scanned supplier records; hosting, lifecycle and annual cost are not supplied.",
    },
    {
      app_id: "app-98a2c1e6", company_side: "target", app_name: "Thistle Plans", function: "Project Management",
      vendor: "Thistle Lantern Tools", annual_cost: 7000, deployment: "cloud", criticality: "low",
      lifecycle: "retiring", owner: "Meridian Delivery Office", notes: "Source inventory marks this local project tracker as retiring; no deal disposition is implied.",
    },
    {
      app_id: "app-0c4fd873", company_side: "target", app_name: "Mica Shield", function: "Security",
      vendor: "Mica Nest Security", annual_cost: 29000, deployment: "hybrid", criticality: "critical",
      lifecycle: "active", owner: "Meridian Security Operations", notes: "Endpoint protection and analyst alert queue.",
    },
  ],
  license_positions: [
    {
      license_id: "lic-81f5c0ad", app_id: "app-f62a409d", vendor: "Amber Quill Systems", product: "Lantern Sales named seats",
      seats_entitled: 120, seats_used: 96, annual_spend: 72000, renewal_date: "2027-06-30", notes: "Fictional seat allocation and illustrative annual spend; no contract evidence.",
    },
    {
      license_id: "lic-c63a74e9", app_id: "app-da048f67", vendor: "Amber Quill Systems", product: "Lantern Sales Regional named seats",
      seats_entitled: 70, seats_used: 54, annual_spend: 42000, renewal_date: "2027-09-30", notes: "Independent regional subscription; no consolidation entitlement is asserted.",
    },
    {
      license_id: "lic-2a97d4b0", app_id: "app-d9a205fc", vendor: "Paper Harbor Software", product: "Harbor Rooms workspace seats",
      seats_entitled: 300, seats_used: 265, annual_spend: 36000, renewal_date: "2027-04-30", notes: "Illustrative workplace subscription; spend is included in application annual_cost.",
    },
    {
      license_id: "lic-5e10b8fc", app_id: "app-ec625819", vendor: "Paper Harbor Software", product: "Harbor Rooms Regional workspace seats",
      seats_entitled: 175, seats_used: 151, annual_spend: 21000, renewal_date: null, notes: "Renewal date is not supplied; spend is included in application annual_cost.",
    },
    {
      license_id: "lic-b4d78026", app_id: "app-a7f452c0", vendor: "Birch Circuit Tools", product: "Birch Service agent seats",
      seats_entitled: 25, seats_used: 21, annual_spend: 30000, renewal_date: "2027-03-31", notes: "Service agent quantities, not the number of employees served.",
    },
    {
      license_id: "lic-09ac6e31", app_id: "app-86d0b3fa", vendor: "Birch Circuit Tools", product: "Birch Help agent seats",
      seats_entitled: 14, seats_used: 12, annual_spend: 14000, notes: "Renewal date absent in source; quantities are illustrative.",
    },
    {
      license_id: "lic-e84715a2", app_id: "app-5d20ce93", vendor: "Lumen Otter Analytics", product: "Lumen Reports analyst seats",
      seats_entitled: 40, seats_used: null, annual_spend: 24000, renewal_date: "2027-08-31", notes: "Usage estimate is unavailable; it must not be treated as zero.",
    },
    {
      license_id: "lic-7c2e93d6", app_id: "app-91d3f06c", vendor: "Sparrow Spindle Tools", product: "Sparrow Tasks community seats",
      seats_entitled: 30, seats_used: 0, annual_spend: 0, renewal_date: null, notes: "Known zero annual charge and zero active seats in the fictional snapshot.",
    },
    {
      license_id: "lic-36f8a091", app_id: "app-06b7e4d9", vendor: null, product: "Moss Archive support allocation",
      seats_entitled: null, seats_used: null, annual_spend: null, renewal_date: null, notes: "Support agreement and quantities are not supplied.",
    },
    {
      license_id: "lic-a0d5297b", app_id: "app-98a2c1e6", vendor: "Thistle Lantern Tools", product: "Thistle Plans project seats",
      seats_entitled: 35, seats_used: 28, annual_spend: 7000, renewal_date: "2027-02-28", notes: "Source license snapshot only; no legal compliance conclusion.",
    },
  ],
  tsa_services: [
    {
      tsa_id: "tsa-4b81d9a0", title: "Regional ledger access", provider: "Meridian", recipient: "Northstar", owner: "Meridian Finance Systems",
      start_date: "2027-01-01", end_date: "2027-06-30", status: "planned", exit_milestone: "Fictional finance team confirms replacement access",
      risk_notes: "Illustrative access dependency; ledger extraction date is not agreed.", related_app_ids: ["app-7b2e9c41", "app-8c31e7a2"],
    },
    {
      tsa_id: "tsa-f62a1c39", title: "Regional collaboration administration", provider: "Meridian", recipient: "Northstar", owner: "Meridian Workplace IT",
      start_date: "2027-01-01", end_date: "2027-04-30", status: "planned", exit_milestone: "Workspace administrators accept handover checklist",
      risk_notes: null, related_app_ids: ["app-ec625819"],
    },
    {
      tsa_id: "tsa-92c0e6b7", title: "Directory support coverage", provider: "Northstar", recipient: "Meridian", owner: "Northstar Security Operations",
      start_date: "2027-01-01", end_date: "2027-09-30", status: "planned", exit_milestone: "Service owners confirm independent access support",
      risk_notes: "Role ownership requires confirmation in this fictional plan.", related_app_ids: ["app-3e91b8a6", "app-15ac7d90"],
    },
    {
      tsa_id: "tsa-0ad37f85", title: "Regional backup operations", provider: "Meridian", recipient: "Northstar", owner: "Meridian Infrastructure",
      start_date: "2027-02-01", end_date: "2027-08-31", status: "planned", exit_milestone: "Receiving team signs fictional restore exercise record",
      risk_notes: "Retention schedule details remain illustrative.", related_app_ids: ["app-a09c528e"],
    },
    {
      tsa_id: "tsa-c7158e24", title: "Warehouse dispatch support", provider: "Meridian", recipient: "Northstar", owner: "Meridian Supply Operations",
      start_date: "2027-01-01", end_date: "2027-05-31", status: "planned", exit_milestone: "Receiving support team accepts dispatch runbook",
      risk_notes: "Fictional warehouse coverage window still needs confirmation.", related_app_ids: ["app-63f0d4a8"],
    },
  ],
};

/** Parse and return a fresh graph; consumers cannot mutate the bundled source. */
export function loadSyntheticDealFixture(): SyntheticDealFixture {
  return SyntheticDealFixtureSchema.parse(source);
}
