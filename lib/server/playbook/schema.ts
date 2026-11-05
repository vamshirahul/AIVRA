import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, SourceIdSchema, resultEnvelopeSchema } from "../ai/base-contracts.ts";
import type { OutputContract } from "../ai/base-contracts.ts";
import { PlaybookInputSchema, PLAYBOOK_PROMPT_VERSION } from "./input-schema.ts";
import type { PlaybookInput } from "./input-schema.ts";

export const PLAYBOOK_OUTPUT_VERSION = "playbook/output/v1" as const;
const Id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const text = (max: number) => z.string().min(1).max(max).refine((s) => !!s.trim(), "Nonblank text required");
const App = { app_id: SourceIdSchema, side: z.enum(["buyer", "target"]) };
export const PlaybookReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("application"), ...App }),
  z.strictObject({ kind: z.literal("tsa"), tsa_id: SourceIdSchema }),
  z.strictObject({ kind: z.literal("ala_action"), finding_id: Id, action_id: Id, ...App }),
]);
type Reference = z.infer<typeof PlaybookReferenceSchema>;
const Refs = z.array(PlaybookReferenceSchema).min(1).max(20);
const Assumptions = z.array(text(400)).max(10);
const Uncertainty = z.strictObject({ level: z.enum(["low", "medium", "high", "unknown"]), reason: text(400) });
export const PlaybookResultSchema = z.strictObject({
  contract_version: z.literal(PLAYBOOK_OUTPUT_VERSION), status: z.literal("ai_generated_unapproved_draft"),
  coverage_status: z.enum(["complete", "incomplete"]),
  phases: z.array(z.strictObject({ phase_id: Id, sequence: z.number().int().min(1).max(12), title: text(120), assumptions: Assumptions, source_refs: Refs })).max(12),
  actions: z.array(z.strictObject({ activity_id: Id, phase_id: Id, title: text(120), description: text(800),
    ownership_role: text(120).nullable(), depends_on_activity_ids: z.array(Id).max(20), assumptions: Assumptions, uncertainty: Uncertainty, source_refs: Refs })).max(100),
  milestones: z.array(z.strictObject({ milestone_id: Id, phase_id: Id, title: text(120), after_activity_ids: z.array(Id).min(1).max(20),
    proposed_date: z.iso.date().nullable(), date_assumption: text(400).nullable(), source_refs: Refs })).max(40),
  risks: z.array(z.strictObject({ risk_id: Id, description: text(800), assumptions: Assumptions, uncertainty: Uncertainty, source_refs: Refs })).max(40),
  not_addressed: z.array(z.strictObject({ source: PlaybookReferenceSchema, reason: text(400) })).max(400),
  limitations: z.array(text(400)).max(20),
}).superRefine((r, ctx) => {
  const issue = () => ctx.addIssue({ code: "custom", message: "Invalid playbook identity, sequence, dependency or reference structure" });
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  const ids = [...r.phases.map((p) => p.phase_id), ...r.actions.map((a) => a.activity_id), ...r.milestones.map((m) => m.milestone_id), ...r.risks.map((k) => k.risk_id)];
  if (!unique(ids) || !unique(r.phases.map((p) => String(p.sequence))) || r.phases.some((p) => p.sequence > r.phases.length)) issue();
  const phases = new Map(r.phases.map((p) => [p.phase_id, p.sequence])), actions = new Map(r.actions.map((a) => [a.activity_id, a]));
  for (const a of r.actions) {
    if (!phases.has(a.phase_id) || !unique(a.depends_on_activity_ids) || a.depends_on_activity_ids.some((id) => id === a.activity_id || !actions.has(id) || (phases.get(actions.get(id)!.phase_id) ?? Infinity) > (phases.get(a.phase_id) ?? -1))) issue();
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const acyclic = (id: string): boolean => { if (visiting.has(id)) return false; if (visited.has(id)) return true; visiting.add(id); for (const dep of actions.get(id)?.depends_on_activity_ids ?? []) if (!acyclic(dep)) return false; visiting.delete(id); visited.add(id); return true; };
  if (r.actions.some((a) => !acyclic(a.activity_id))) issue();
  for (const m of r.milestones) if (!phases.has(m.phase_id) || !unique(m.after_activity_ids) || m.after_activity_ids.some((id) => !actions.has(id) || (phases.get(actions.get(id)!.phase_id) ?? Infinity) > (phases.get(m.phase_id) ?? -1)) || (m.proposed_date !== null) !== (m.date_assumption !== null)) issue();
  const lists = [...r.phases, ...r.actions, ...r.milestones, ...r.risks].map((item) => item.source_refs);
  if (lists.some((refs) => !unique(refs.map(referenceKey))) || !unique(r.not_addressed.map((item) => referenceKey(item.source))) || lists.reduce((n, refs) => n + refs.length, r.not_addressed.length) > 400) issue();
  // Empty or wholly unaddressed output can only be incomplete, never a valid plan.
  if ((!r.phases.length || !r.actions.length || !r.milestones.length || r.not_addressed.length > 0) && r.coverage_status === "complete") issue();
});
export type PlaybookResult = z.infer<typeof PlaybookResultSchema>;
// Metadata is server/adapter-owned, never fields authored by the model itself.
export const PlaybookEnvelopeSchema = resultEnvelopeSchema(PlaybookResultSchema).superRefine((r, ctx) => {
  if (r.module !== "playbook" || r.prompt_version !== PLAYBOOK_PROMPT_VERSION) ctx.addIssue({ code: "custom", message: "Playbook provenance identity mismatch" });
});
function referenceKey(ref: Reference): string { return ref.kind === "tsa" ? JSON.stringify([ref.kind, ref.tsa_id]) : ref.kind === "application" ? JSON.stringify([ref.kind, ref.app_id, ref.side]) : JSON.stringify([ref.kind, ref.finding_id, ref.action_id, ref.app_id, ref.side]); }
function references(r: PlaybookResult): Reference[] { return [...r.phases, ...r.actions, ...r.milestones, ...r.risks].flatMap((row) => row.source_refs); }
/** Enumerate every structured source-ID path; generated activity IDs are local,
 * not source IDs. Repeated citations across activities are valid.
 */
export function extractPlaybookReferences(r: PlaybookResult): string[] {
  return [...new Set([...references(r), ...r.not_addressed.map((i) => i.source)].map((ref) => ref.kind === "tsa" ? ref.tsa_id : ref.app_id))];
}
export const PLAYBOOK_OUTPUT_CONTRACT: OutputContract<PlaybookResult> = {
  schema: PlaybookResultSchema, references: { allow_empty: true, duplicates: "reject", extract: extractPlaybookReferences },
};
const fail = () => ({ ok: false as const, code: "invalid_model_output" as const, message: "The playbook structure, source references or coverage could not be validated." });

/** Structural/source validation only. Trusted captured input from buildPlaybookInput
 * is mandatory at composition; shape/digests never authenticate an imported file.
 */
export function inspectPlaybookResult(output: unknown, capturedInput: PlaybookInput) {
  try {
    if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_OUTPUT_BYTES || Buffer.byteLength(JSON.stringify(capturedInput), "utf8") > MAX_INPUT_BYTES) return fail();
    const input = PlaybookInputSchema.safeParse(capturedInput), parsed = PlaybookResultSchema.safeParse(output);
    if (!input.success || !parsed.success || !isDeepStrictEqual(input.data, capturedInput) || !isDeepStrictEqual(parsed.data, output)) return fail();
    const s = input.data, r = parsed.data, apps = new Map(s.applications.map((a) => [a.app_id, a.company_side])), tsas = new Set(s.tsa_services.map((t) => t.tsa_id));
    const knownActions = s.reviewed_ala.effective_actions;
    const valid = (ref: Reference) => ref.kind === "tsa" ? tsas.has(ref.tsa_id) : apps.get(ref.app_id) === ref.side && (ref.kind === "application" || knownActions.some((a) => a.finding_id === ref.finding_id && a.action_id === ref.action_id && a.subject.app_id === ref.app_id && a.subject.side === ref.side));
    const cited = references(r), skipped = r.not_addressed.map((i) => i.source);
    if ([...cited, ...skipped].some((ref) => !valid(ref))) return fail();
    const keys = new Set(cited.map(referenceKey));
    if (skipped.some((ref) => keys.has(referenceKey(ref)))) return fail();
    const rootKeys = new Set(cited.map((ref) => ref.kind === "tsa" ? `tsa:${ref.tsa_id}` : `app:${ref.app_id}`));
    const missing_app_ids = s.applications.filter((a) => !rootKeys.has(`app:${a.app_id}`)).map((a) => a.app_id);
    const missing_tsa_ids = s.tsa_services.filter((t) => !rootKeys.has(`tsa:${t.tsa_id}`)).map((t) => t.tsa_id);
    const missing_action_ids = knownActions.filter((a) => !keys.has(referenceKey({ kind: "ala_action", finding_id: a.finding_id, action_id: a.action_id, ...a.subject }))).map((a) => a.action_id);
    const incomplete = !!(missing_app_ids.length || missing_tsa_ids.length || missing_action_ids.length || skipped.length || s.incomplete_context.length || !r.actions.length || !r.milestones.length || !r.phases.length);
    if (r.coverage_status !== (incomplete ? "incomplete" : "complete")) return fail();
    return { ok: true as const, data: r, coverage: { status: r.coverage_status, missing_app_ids, missing_tsa_ids, missing_action_ids, not_addressed: r.not_addressed, incomplete_context: s.incomplete_context } };
  } catch { return fail(); }
}
