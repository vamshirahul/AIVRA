import { ApplicationSchema, TSAServiceSchema } from "../contracts/demo.ts";
import type { Application, TSAService } from "../contracts/demo.ts";
import { MAX_SESSION_CHARACTERS } from "../session/session.ts";

export const TSA_COLUMNS = ["TSA ID", "Service title", "Provider", "Recipient", "Owner / role", "Start date (YYYY-MM-DD)", "End date (YYYY-MM-DD)", "Source status", "Exit milestone", "Risk / dependency notes", "Linked applications: ID / side / name"] as const;
export const TSA_STATUS_LABELS: Record<TSAService["status"], string> = { planned: "Planned", active: "Active", at_risk: "At risk", completed: "Completed" };
export type TSAInventoryRow = { service: TSAService; applications: { app_id: string; application: Application | null }[] };
type Issue = { code: "invalid_inventory" | "invalid_service" | "invalid_application" | "unresolved_reference"; row: number | null; message: string };
type Inventory = { rows: TSAInventoryRow[]; issues: Issue[] };
const invalidInventory = (): Inventory => ({ rows: [], issues: [{ code: "invalid_inventory", row: null, message: "The TSA inventory source could not be validated. No service rows are displayed." }] });
// The shared schema trims text. A read-only view must not silently normalize a
// malformed isolated input; accept only records whose source strings are unchanged.
const unchangedText = (source: object, parsed: object) => Object.entries(parsed).every(([key, value]) => typeof value !== "string" || Reflect.get(source, key) === value);

/** Current session is authoritative. This defensive isolated projection does not
 * repair source data, derive relationships, change statuses or consult a clock.
 */
export function tsaInventoryRows(services: unknown, applications: unknown): Inventory {
  try {
    if (!Array.isArray(services) || !Array.isArray(applications) || services.length > 100 || applications.length > 100 || JSON.stringify({ services, applications }).length > MAX_SESSION_CHARACTERS) return invalidInventory();
    const issues: Issue[] = [], rows: TSAInventoryRow[] = [], byId = new Map<string, Application | null>();
    for (const [index, candidate] of applications.entries()) {
      const parsed = ApplicationSchema.safeParse(candidate);
      const id = candidate && typeof candidate === "object" ? ApplicationSchema.shape.app_id.safeParse(candidate.app_id) : null;
      if (!parsed.success || !unchangedText(candidate, parsed.data)) issues.push({ code: "invalid_application", row: index + 1, message: "An application source record is invalid; its links cannot be resolved." });
      if (id?.success) byId.set(id.data, byId.has(id.data) || !parsed.success || !unchangedText(candidate, parsed.data) ? null : parsed.data);
    }
    const ids = services.map((s) => s && typeof s === "object" && typeof s.tsa_id === "string" ? s.tsa_id : null);
    for (const [index, candidate] of services.entries()) {
      const parsed = TSAServiceSchema.safeParse(candidate);
      if (!parsed.success || !unchangedText(candidate, parsed.data) || ids.filter((id) => id === parsed.data.tsa_id).length !== 1) { issues.push({ code: "invalid_service", row: index + 1, message: "A TSA service record is invalid or duplicated; this source row is not displayed." }); continue; }
      const linked = (parsed.data.related_app_ids ?? []).map((app_id) => ({ app_id, application: byId.get(app_id) ?? null }));
      if (linked.some((a) => !a.application)) issues.push({ code: "unresolved_reference", row: index + 1, message: "A linked application is missing, invalid or ambiguous. Its source ID is shown without an invented name or side." });
      rows.push({ service: parsed.data, applications: linked });
    }
    return { rows, issues };
  } catch { return invalidInventory(); }
}

export function tsaInventoryCells({ service: s, applications }: TSAInventoryRow): readonly string[] {
  const links = s.related_app_ids === undefined ? "Relationship information not supplied" : s.related_app_ids.length === 0 ? "No application links recorded" : applications.map(({ app_id, application: a }) => a ? `${app_id} · ${a.company_side === "buyer" ? "Buyer" : "Target"} · ${a.app_name}` : `${app_id} · Unresolved application reference`).join("\n");
  return [s.tsa_id, s.title, s.provider, s.recipient, s.owner ?? "Unknown", s.start_date ?? "Unknown", s.end_date ?? "Unknown", TSA_STATUS_LABELS[s.status], s.exit_milestone ?? "Unknown / not supplied", s.risk_notes ?? "Unknown / not supplied", links];
}
