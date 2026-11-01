import type { Application, LicensePosition } from "../contracts/demo.ts";

export const LICENSE_COLUMNS = ["License ID", "Application ID / side / name", "Vendor", "Product", "Entitled quantity", "Estimated usage", "Annual license spend", "Renewal date (YYYY-MM-DD)", "Notes"] as const;
export function licenseInventoryRows(licenses: readonly LicensePosition[], applications: readonly Application[]) {
  const byId = new Map<string, Application | null>();
  for (const app of applications) byId.set(app.app_id, byId.has(app.app_id) ? null : app);
  return licenses.map((license) => ({ license, application: byId.get(license.app_id) ?? null }));
}
export type LicenseInventoryRow = ReturnType<typeof licenseInventoryRows>[number];
function spend(value: number | null, currency: string): string {
  if (value === null) return "Unknown";
  // Do not turn a genuine tiny nonzero amount into a displayed currency zero.
  if (value > 0 && value < 1e-20) return `${currency} ${String(value)}`;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 20 }).format(value);
}
export function licenseInventoryCells({ license, application }: LicenseInventoryRow, currency: string): readonly string[] {
  return [license.license_id,
    application ? `${license.app_id} · ${application.company_side === "buyer" ? "Buyer" : "Target"} · ${application.app_name}` : `${license.app_id} · Unresolved application reference`,
    license.vendor ?? "Unknown", license.product, license.seats_entitled === null ? "Unknown" : String(license.seats_entitled),
    license.seats_used === null ? "Unknown" : String(license.seats_used), spend(license.annual_spend, currency), license.renewal_date ?? "Unknown", license.notes ?? "Unknown"];
}
