import "server-only";
import { z } from "zod";
import { ApplicationSchema } from "../../contracts/demo.ts";
import type { Application } from "../../contracts/demo.ts";
import { MAX_OUTPUT_BYTES, SourceIdSchema } from "../ai/contracts.ts";
import type { OutputContract } from "../ai/contracts.ts";

const text = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0, "Nonblank text required");
const identity = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const AppReference = z.strictObject({ app_id: SourceIdSchema, side: ApplicationSchema.shape.company_side });
const Action = z.strictObject({
  action_id: identity, subject: AppReference,
  disposition: z.enum(["Retain", "Retire", "Migrate", "Integrate", "Needs Review"]),
  destination: AppReference.nullable(), rationale: text(400),
});
const Finding = z.strictObject({
  finding_id: identity, domain: text(120),
  relationship: z.enum(["functional_overlap", "potentially_related", "unique", "uncertain"]),
  buyer_app_ids: z.array(SourceIdSchema).max(50), target_app_ids: z.array(SourceIdSchema).max(50),
  actions: z.array(Action).min(1).max(100), rationale: text(800),
  evidence: z.array(z.strictObject({ app_id: SourceIdSchema, attribute: ApplicationSchema.keyof() })).min(1).max(100),
  uncertainty: z.strictObject({ level: z.enum(["low", "medium", "high", "unknown"]), reason: text(400) }),
});

export const ALAResultSchema = z.strictObject({
  findings: z.array(Finding).max(100),
  not_evaluated: z.array(z.strictObject({ ...AppReference.shape, reason: text(400) })).max(100),
}).superRefine((result, ctx) => {
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const findingIds = new Set<string>(), actionIds = new Set<string>(), findingMembers = new Set<string>();
  let actions = 0, evidence = 0, members = 0;
  result.findings.forEach((finding, index) => {
    const path = ["findings", index];
    if (findingIds.has(finding.finding_id)) add(path, "Duplicate finding identity");
    findingIds.add(finding.finding_id);
    const ids = [...finding.buyer_app_ids, ...finding.target_app_ids];
    actions += finding.actions.length; evidence += finding.evidence.length; members += ids.length;
    if (!ids.length || new Set(ids).size !== ids.length) add(path, "Expected unique nonempty finding members");
    if (["functional_overlap", "potentially_related"].includes(finding.relationship) && (!finding.buyer_app_ids.length || !finding.target_app_ids.length)) add(path, "Cross-side relationship requires both sides");
    if (finding.relationship === "unique" && ids.length !== 1) add(path, "Unique finding has exactly one application");
    const sideById = new Map([...finding.buyer_app_ids.map((id) => [id, "buyer"] as const), ...finding.target_app_ids.map((id) => [id, "target"] as const)]);
    ids.forEach((id) => findingMembers.add(id));
    const signatures = new Set<string>(), subjectActions = new Map<string, typeof finding.actions>();
    finding.actions.forEach((action, actionIndex) => {
      const actionPath = [...path, "actions", actionIndex];
      if (actionIds.has(action.action_id)) add(actionPath, "Duplicate action identity");
      actionIds.add(action.action_id);
      if (sideById.get(action.subject.app_id) !== action.subject.side) add(actionPath, "Subject must be a member on its declared side");
      const needsDestination = action.disposition === "Migrate" || action.disposition === "Integrate";
      if (needsDestination !== (action.destination !== null)) add(actionPath, "Disposition destination rule violated");
      if (action.destination && (action.destination.app_id === action.subject.app_id || sideById.get(action.destination.app_id) !== action.destination.side)) add(actionPath, "Destination must be another finding member on its declared side");
      const signature = JSON.stringify([action.subject, action.disposition, action.destination]);
      if (signatures.has(signature)) add(actionPath, "Duplicate subject action");
      signatures.add(signature);
      const group = subjectActions.get(action.subject.app_id) ?? []; group.push(action); subjectActions.set(action.subject.app_id, group);
    });
    for (const id of ids) if (!subjectActions.has(id)) add(path, "Each finding member requires a subject action");
    for (const group of subjectActions.values()) if (group.length > 1 && group.some((action) => ["Retire", "Migrate", "Needs Review"].includes(action.disposition))) add(path, "Contradictory same-subject actions within a finding");
    for (const pointer of finding.evidence) if (!sideById.has(pointer.app_id)) add([...path, "evidence"], "Evidence must refer to a finding member");
  });
  if (actions > 200 || evidence > 400 || members > 400) add(["findings"], "Result reference/action bounds exceeded");
  const unevaluated = new Set<string>();
  result.not_evaluated.forEach((item, index) => {
    if (unevaluated.has(item.app_id) || findingMembers.has(item.app_id)) add(["not_evaluated", index], "Duplicate or contradictory unevaluated application");
    unevaluated.add(item.app_id);
  });
});
export type ALAResult = z.infer<typeof ALAResultSchema>;

/** Enumerate EVERY structured application-ID path; identities are checked before deduplication. */
export function extractALAReferences(result: ALAResult): string[] {
  return [...new Set([
    ...result.findings.flatMap((finding) => [...finding.buyer_app_ids, ...finding.target_app_ids,
      ...finding.actions.flatMap((action) => [action.subject.app_id, ...(action.destination ? [action.destination.app_id] : [])]),
      ...finding.evidence.map((pointer) => pointer.app_id)]),
    ...result.not_evaluated.map((item) => item.app_id),
  ])];
}
export const ALA_OUTPUT_CONTRACT: OutputContract<ALAResult> = {
  schema: ALAResultSchema,
  // Zero references means wholly incomplete, never complete. Coverage inspection is mandatory.
  references: { allow_empty: true, duplicates: "reject", extract: extractALAReferences },
};
export type ALACoverage = {
  status: "complete" | "incomplete";
  reasons: ("missing_applications" | "not_evaluated_applications")[];
  buyer: { source_count: number; accounted_count: number; missing_app_ids: string[]; not_evaluated_app_ids: string[] };
  target: { source_count: number; accounted_count: number; missing_app_ids: string[]; not_evaluated_app_ids: string[] };
};
type InvalidOutput = { ok: false; code: "invalid_model_output"; issues: ("invalid_shape" | "invalid_source" | "unknown_id" | "wrong_side" | "invalid_attribute")[] };
export type ALAInspection = { ok: true; data: ALAResult; coverage: ALACoverage } | InvalidOutput;

/** Structural integrity only. Never compares businesses, chooses dispositions or fills missing results. */
export function inspectALAResult(output: unknown, applications: readonly Application[]): ALAInspection {
  try {
    const serialized = JSON.stringify(output);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) return { ok: false, code: "invalid_model_output", issues: ["invalid_shape"] };
    const source = ApplicationSchema.array().min(2).max(100).safeParse(applications);
    if (!source.success || new Set(source.data.map((app) => app.app_id)).size !== source.data.length || ["buyer", "target"].some((side) => !source.data.some((app) => app.company_side === side) || source.data.filter((app) => app.company_side === side).length > 50)) return { ok: false, code: "invalid_model_output", issues: ["invalid_source"] };
    const parsed = ALAResultSchema.safeParse(output);
    if (!parsed.success) return { ok: false, code: "invalid_model_output", issues: ["invalid_shape"] };
    const data = parsed.data;
    const byId = new Map(source.data.map((app) => [app.app_id, app]));
    const issues = new Set<InvalidOutput["issues"][number]>();
    for (const id of extractALAReferences(data)) if (!byId.has(id)) issues.add("unknown_id");
    const checkSide = (id: string, side: string) => { if (byId.has(id) && byId.get(id)!.company_side !== side) issues.add("wrong_side"); };
    for (const finding of data.findings) {
      finding.buyer_app_ids.forEach((id) => checkSide(id, "buyer")); finding.target_app_ids.forEach((id) => checkSide(id, "target"));
      for (const action of finding.actions) { checkSide(action.subject.app_id, action.subject.side); if (action.destination) checkSide(action.destination.app_id, action.destination.side); }
      for (const pointer of finding.evidence) if (byId.has(pointer.app_id) && !Object.hasOwn(byId.get(pointer.app_id)!, pointer.attribute)) issues.add("invalid_attribute");
    }
    for (const item of data.not_evaluated) checkSide(item.app_id, item.side);
    if (issues.size) return { ok: false, code: "invalid_model_output", issues: [...issues] };
    const inFindings = new Set(data.findings.flatMap((finding) => [...finding.buyer_app_ids, ...finding.target_app_ids]));
    const unevaluated = new Set(data.not_evaluated.map((item) => item.app_id));
    const sideCoverage = (side: "buyer" | "target") => {
      const ids = source.data.filter((app) => app.company_side === side).map((app) => app.app_id);
      return { source_count: ids.length, accounted_count: ids.filter((id) => inFindings.has(id) || unevaluated.has(id)).length,
        missing_app_ids: ids.filter((id) => !inFindings.has(id) && !unevaluated.has(id)), not_evaluated_app_ids: ids.filter((id) => unevaluated.has(id)) };
    };
    const buyer = sideCoverage("buyer"), target = sideCoverage("target");
    const reasons: ALACoverage["reasons"] = [];
    if (buyer.missing_app_ids.length || target.missing_app_ids.length) reasons.push("missing_applications");
    if (unevaluated.size) reasons.push("not_evaluated_applications");
    return { ok: true, data, coverage: { status: reasons.length ? "incomplete" : "complete", reasons, buyer, target } };
  } catch { return { ok: false, code: "invalid_model_output", issues: ["invalid_shape"] }; }
}
export function checkALACoverage(output: unknown, applications: readonly Application[]): { ok: true; coverage: ALACoverage } | InvalidOutput {
  const checked = inspectALAResult(output, applications);
  return checked.ok ? { ok: true, coverage: checked.coverage } : checked;
}
