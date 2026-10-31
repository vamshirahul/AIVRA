import type { Application } from "../contracts/demo.ts";

export const INVENTORY_COLUMNS = [
  ["app_id", "Application ID"], ["app_name", "Application name"], ["function", "Business function"],
  ["vendor", "Vendor"], ["annual_cost", "Annual cost"], ["criticality", "Criticality"],
  ["deployment", "Deployment"], ["lifecycle", "Lifecycle"], ["owner", "Owner"], ["notes", "Notes"],
] as const;
export type InventorySide = Application["company_side"];
const labels = { low: "Low", medium: "Medium", high: "High", critical: "Critical", cloud: "Cloud",
  on_premise: "On-premise", hybrid: "Hybrid", active: "Active", legacy: "Legacy", retiring: "Retiring" } as const;
export function inventoryForSide(applications: readonly Application[], side: InventorySide) {
  return applications.filter((app) => app.company_side === side);
}
export function inventoryValue(app: Application, field: typeof INVENTORY_COLUMNS[number][0], currency: string): string {
  const value = app[field];
  if (value === null) return "Not provided";
  if (field === "annual_cost") return new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(value as number);
  if (field === "criticality" || field === "deployment" || field === "lifecycle") return labels[value as keyof typeof labels];
  return String(value);
}
