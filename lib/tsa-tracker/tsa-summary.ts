import { z } from "zod";
import { ApplicationSchema, TSAServiceSchema } from "../contracts/demo.ts";
import { DemoSessionSchema, MAX_SESSION_CHARACTERS } from "../session/session.ts";

export const TSA_SUMMARY_VERSION = "tsa/summary/v1" as const;
export const TSACountsSchema = z.strictObject({ total: z.number().int().min(0).max(100), planned: z.number().int().min(0).max(100), active: z.number().int().min(0).max(100), at_risk: z.number().int().min(0).max(100), completed: z.number().int().min(0).max(100) });
const CountsSource = z.strictObject({ session_id: DemoSessionSchema.shape.session_id, fixture: DemoSessionSchema.shape.fixture, session_revision: DemoSessionSchema.shape.session_revision, tsa_revision: DemoSessionSchema.shape.session_revision, application_revision: DemoSessionSchema.shape.session_revision });
const LinkedApp = ApplicationSchema.pick({ app_id: true, company_side: true, app_name: true });
export const TSASummarySchema = z.strictObject({ contract_version: z.literal(TSA_SUMMARY_VERSION), source: CountsSource, scope: z.literal("all_current_tsa_services"), synthetic: z.literal(true), unapproved: z.literal(true), counts: TSACountsSchema, services: z.array(TSAServiceSchema).max(100), linked_applications: z.array(LinkedApp).max(100) }).superRefine((s, ctx) => {
  const expected = countTSA(s.services), ids = new Set(s.services.map((r) => r.tsa_id)), apps = new Set(s.linked_applications.map((a) => a.app_id)), references = new Set(s.services.flatMap((r) => r.related_app_ids ?? []));
  if (!sameTSAValue(expected, s.counts) || ids.size !== s.services.length || apps.size !== s.linked_applications.length || references.size !== apps.size || [...references].some((id) => !apps.has(id))) ctx.addIssue({ code: "custom", message: "Inconsistent TSA count or relationship summary" });
});
export type TSASummary = z.infer<typeof TSASummarySchema>;
export function sameTSAValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameTSAValue(Reflect.get(a, key), Reflect.get(b, key)));
}
function countTSA(services: readonly z.infer<typeof TSAServiceSchema>[]) {
  const counts = { total: services.length, planned: 0, active: 0, at_risk: 0, completed: 0 }; for (const r of services) counts[r.status]++; return counts;
}
export function freezeTSA<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freezeTSA); Object.freeze(value); } return value; }
/** Complete original session validation, never a permissive/dropping table projection.
 * Summary carries only TSA records and the exact referenced app identities/names/sides.
 */
export function buildTSASummary(input: unknown): { ok: true; summary: TSASummary } | { ok: false; message: string } {
  try {
    const json = JSON.stringify(input); if (typeof json !== "string" || json.length > MAX_SESSION_CHARACTERS) throw Error("Source bound");
    const parsed = DemoSessionSchema.safeParse(input); if (!parsed.success || !sameTSAValue(parsed.data, input)) throw Error("Source validation");
    const s = parsed.data, services = s.current_deal.tsa_services, references = new Set(services.flatMap((r) => r.related_app_ids ?? []));
    const summary = TSASummarySchema.parse({ contract_version: TSA_SUMMARY_VERSION, source: { session_id: s.session_id, fixture: s.fixture, session_revision: s.session_revision, tsa_revision: s.input_revisions.tsa, application_revision: s.input_revisions.applications }, scope: "all_current_tsa_services", synthetic: true, unapproved: true, counts: countTSA(services), services, linked_applications: s.current_deal.applications.filter((a) => references.has(a.app_id)).map(({ app_id, company_side, app_name }) => ({ app_id, company_side, app_name })) });
    return { ok: true, summary: freezeTSA(summary) };
  } catch { return { ok: false, message: "The current TSA source is unavailable or invalid. No complete summary can be shown or downloaded." }; }
}
