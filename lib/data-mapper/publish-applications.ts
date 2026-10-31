import { ApplicationSchema, SyntheticDealFixtureSchema } from "../contracts/demo.ts";
import type { Application, SyntheticDealFixture } from "../contracts/demo.ts";
import { MAPPING_VERSION, validateColumnMapping } from "./column-mapping.ts";
import type { MappingDraft } from "./column-mapping.ts";
import type { CSVDraft, CSVSide } from "./parse-csv.ts";

export const PUBLICATION_MESSAGES = {
  unconfirmed: "Confirm the current mapping before reviewing publication.",
  stale_draft: "The CSV or mapping changed. Validate and confirm the current mapping again.",
  invalid_candidate: "The candidate must contain 1–50 valid applications for the selected side.",
  id_collision: "Application IDs conflict within the candidate, with the other side or with license/TSA IDs. Supply a compatible inventory; IDs are never rewritten.",
  orphaned_links: "This replacement would orphan existing license or TSA references. Supply an inventory retaining the referenced IDs. Linked records are never deleted or rewritten.",
  invalid_deal: "The complete proposed deal does not meet the shared data contract.",
  stale_session: "The session changed or was reset. Review publication again against the current session.",
  invalid_storage: "Saved session data changed or is invalid. Publication was rejected without replacing it.",
  invalid_session: "The complete session could not be validated or exceeds its size limit. No changes were published.",
} as const;
export type PublicationCode = keyof typeof PUBLICATION_MESSAGES;
export type PublicationImpact = { current_count: number; proposed_count: number; added: number; removed: number; retained: number };
export type PublicationBlock = { ok: false; code: PublicationCode; impact?: PublicationImpact; collisions?: number; licenses?: number; tsa?: number };
export type PublicationToken = { session_id: string; session_revision: number };
export type PublicationResult = { ok: true; changed: boolean; source_revision: number; session_id: string } | PublicationBlock;
export class PublicationFailure extends Error {
  readonly block: PublicationBlock;
  constructor(block: PublicationBlock) { super(PUBLICATION_MESSAGES[block.code]); this.block = block; }
}
export function currentConfirmedApplications(source: CSVDraft, mapping: MappingDraft | null, side: CSVSide):
  { ok: true; applications: Application[] } | PublicationBlock {
  const confirmed = mapping?.confirmed;
  if (source.status !== "ready" || !mapping || !confirmed) return { ok: false, code: "unconfirmed" };
  if (source.side !== side || confirmed.side !== side || confirmed.status !== "confirmed_draft" || confirmed.validation_version !== MAPPING_VERSION ||
      source.generation !== mapping.source_generation || confirmed.source_generation !== source.generation || confirmed.mapping_revision !== mapping.revision ||
      confirmed.file_name !== source.preview.file_name || confirmed.file_size_bytes !== source.preview.file_size_bytes ||
      JSON.stringify(confirmed.mappings) !== JSON.stringify(mapping.mappings)) return { ok: false, code: "stale_draft" };
  const validated = validateColumnMapping(source.preview, side, mapping.mappings);
  if (!validated.valid || JSON.stringify(validated.rows) !== JSON.stringify(confirmed.rows)) return { ok: false, code: "stale_draft" };
  return { ok: true, applications: validated.rows };
}

export function prepareApplicationPublication(deal: SyntheticDealFixture, side: CSVSide, applications: readonly Application[]):
  { ok: true; deal: SyntheticDealFixture; no_op: boolean; impact: PublicationImpact } | PublicationBlock {
  if (!ApplicationSchema.shape.company_side.safeParse(side).success) return { ok: false, code: "invalid_candidate" };
  const checked = ApplicationSchema.array().min(1).max(50).safeParse(applications);
  if (!checked.success || checked.data.some((row) => row.company_side !== side)) return { ok: false, code: "invalid_candidate" };
  const current = deal.applications.filter((row) => row.company_side === side);
  const other = deal.applications.filter((row) => row.company_side !== side);
  const oldIds = new Set(current.map((row) => row.app_id)), ids = new Set(checked.data.map((row) => row.app_id));
  const impact = { current_count: current.length, proposed_count: checked.data.length,
    added: [...ids].filter((id) => !oldIds.has(id)).length, removed: [...oldIds].filter((id) => !ids.has(id)).length,
    retained: [...ids].filter((id) => oldIds.has(id)).length };
  const protectedIds = new Set([...other.map((row) => row.app_id), ...deal.license_positions.map((row) => row.license_id), ...deal.tsa_services.map((row) => row.tsa_id)]);
  const collisions = checked.data.length - ids.size + [...ids].filter((id) => protectedIds.has(id)).length;
  if (collisions) return { ok: false, code: "id_collision", impact, collisions };
  const finalIds = new Set([...ids, ...other.map((row) => row.app_id)]);
  const licenses = deal.license_positions.filter((row) => !finalIds.has(row.app_id)).length;
  const tsa = deal.tsa_services.filter((row) => row.related_app_ids?.some((id) => !finalIds.has(id))).length;
  if (licenses || tsa) return { ok: false, code: "orphaned_links", impact, licenses, tsa };
  // Compare canonical content/order, independent of object key insertion order.
  const no_op = JSON.stringify(ApplicationSchema.array().parse(current)) === JSON.stringify(checked.data);
  const combined = side === "buyer" ? [...checked.data, ...other] : [...other, ...checked.data];
  const final = SyntheticDealFixtureSchema.safeParse({ ...deal, applications: no_op ? deal.applications : combined });
  if (!final.success || final.data.applications.length > 100 || ["buyer", "target"].some((value) => final.data.applications.filter((row) => row.company_side === value).length > 50)) return { ok: false, code: "invalid_deal", impact };
  return { ok: true, deal: no_op ? deal : final.data, no_op, impact };
}
