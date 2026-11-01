import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ApplicationSchema, LicensePositionSchema } from "../../contracts/demo.ts";
import { MAX_OUTPUT_BYTES, SourceIdSchema } from "../ai/contracts.ts";
import type { OutputContract } from "../ai/contracts.ts";

const text = (max: number) => z.string().min(1).max(max).refine((v) => v.trim().length > 0, "Nonblank text required");
const Finding = z.strictObject({
  finding_id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  category: text(120), license_ids: z.array(SourceIdSchema).min(1).max(200), app_ids: z.array(SourceIdSchema).min(1).max(100),
  suggested_action: text(400), rationale: text(800),
  evidence: z.array(z.strictObject({ license_id: SourceIdSchema, attribute: LicensePositionSchema.keyof() })).min(1).max(200),
  unknowns: z.array(text(200)).max(10), assumptions: z.array(text(200)).max(10),
  uncertainty: z.strictObject({ level: z.enum(["low", "medium", "high", "unknown"]), reason: text(400) }), review_required: z.literal(true),
});
export const LicenseResultSchema = z.strictObject({
  findings: z.array(Finding).max(100),
  not_evaluated: z.array(z.strictObject({ license_id: SourceIdSchema, reason: text(400) })).max(200),
}).superRefine((result, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const findings = new Set<string>(), members = new Set<string>();
  let licenses = 0, apps = 0, evidence = 0;
  for (const finding of result.findings) {
    if (findings.has(finding.finding_id)) issue("Duplicate finding identity");
    findings.add(finding.finding_id);
    if (new Set(finding.license_ids).size !== finding.license_ids.length || new Set(finding.app_ids).size !== finding.app_ids.length) issue("Duplicate finding source reference");
    const pointers = new Set<string>();
    for (const pointer of finding.evidence) {
      const key = JSON.stringify([pointer.license_id, pointer.attribute]);
      if (!finding.license_ids.includes(pointer.license_id) || pointers.has(key)) issue("Foreign or duplicate evidence pointer");
      pointers.add(key);
    }
    for (const id of finding.license_ids) {
      members.add(id);
      if (!finding.evidence.some((pointer) => pointer.license_id === id)) issue("Every finding license requires evidence");
    }
    licenses += finding.license_ids.length; apps += finding.app_ids.length; evidence += finding.evidence.length;
  }
  if (licenses > 400 || apps > 400 || evidence > 400) issue("Total reference bounds exceeded");
  const unevaluated = new Set<string>();
  for (const item of result.not_evaluated) {
    if (members.has(item.license_id) || unevaluated.has(item.license_id)) issue("Duplicate or contradictory not-evaluated license");
    unevaluated.add(item.license_id);
  }
});
export type LicenseResult = z.infer<typeof LicenseResultSchema>;
export const LicenseCoverageSchema = z.strictObject({
  status: z.enum(["complete", "incomplete"]),
  reasons: z.array(z.enum(["missing_licenses", "not_evaluated_licenses"])).max(2),
  source_count: z.number().int().min(1).max(200), accounted_count: z.number().int().min(0).max(200),
  missing_license_ids: z.array(SourceIdSchema).max(200), not_evaluated_license_ids: z.array(SourceIdSchema).max(200),
  overlapping_license_ids: z.array(SourceIdSchema).max(200),
});

/** Integrity/coverage only. No categories, recommendations or numerical impacts are derived. */
export function inspectLicenseResult(output: unknown, licenses: unknown, applications: unknown):
  | { ok: true; data: LicenseResult; coverage: z.infer<typeof LicenseCoverageSchema> }
  | { ok: false; code: "invalid_model_output" } {
  const invalid = { ok: false, code: "invalid_model_output" } as const;
  try {
    if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_OUTPUT_BYTES) return invalid;
    const parsed = LicenseResultSchema.safeParse(output);
    const source = z.array(LicensePositionSchema).min(1).max(200).safeParse(licenses);
    const apps = z.array(ApplicationSchema).min(2).max(100).safeParse(applications);
    if (!parsed.success || !source.success || !apps.success || !isDeepStrictEqual(parsed.data, output) ||
        !isDeepStrictEqual(source.data, licenses) || !isDeepStrictEqual(apps.data, applications)) return invalid;
    const allIds = [...source.data.map((r) => r.license_id), ...apps.data.map((r) => r.app_id)];
    if (!z.array(SourceIdSchema).safeParse(allIds).success || new Set(allIds).size !== allIds.length ||
        ["buyer", "target"].some((side) => !apps.data.some((app) => app.company_side === side) || apps.data.filter((app) => app.company_side === side).length > 50)) return invalid;
    const byId = new Map(source.data.map((r) => [r.license_id, r])), appIds = new Set(apps.data.map((r) => r.app_id));
    if (source.data.some((r) => !appIds.has(r.app_id))) return invalid;
    const occurrences = new Map<string, number>();
    for (const finding of parsed.data.findings) {
      if (finding.license_ids.some((id) => !byId.has(id))) return invalid;
      const linked = new Set(finding.license_ids.map((id) => byId.get(id)!.app_id));
      if (linked.size !== finding.app_ids.length || finding.app_ids.some((id) => !linked.has(id))) return invalid;
      for (const pointer of finding.evidence) {
        const record = byId.get(pointer.license_id)!;
        if (!Object.hasOwn(record, pointer.attribute) || record[pointer.attribute] === undefined) return invalid;
      }
      for (const id of finding.license_ids) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    }
    const notEvaluated = new Set(parsed.data.not_evaluated.map((r) => r.license_id));
    if ([...notEvaluated].some((id) => !byId.has(id))) return invalid;
    const ids = source.data.map((r) => r.license_id);
    const missing = ids.filter((id) => !occurrences.has(id) && !notEvaluated.has(id));
    const skipped = ids.filter((id) => notEvaluated.has(id));
    const coverage = LicenseCoverageSchema.parse({
      status: missing.length || skipped.length ? "incomplete" : "complete",
      reasons: [...(missing.length ? ["missing_licenses"] : []), ...(skipped.length ? ["not_evaluated_licenses"] : [])],
      source_count: ids.length, accounted_count: ids.length - missing.length,
      missing_license_ids: missing, not_evaluated_license_ids: skipped, overlapping_license_ids: ids.filter((id) => (occurrences.get(id) ?? 0) > 1),
    });
    return { ok: true, data: parsed.data, coverage };
  } catch { return invalid; }
}

export const LICENSE_OUTPUT_CONTRACT: OutputContract<LicenseResult> = {
  schema: LicenseResultSchema,
  references: { allow_empty: true, duplicates: "reject", extract: (data) => [...new Set([
    ...data.findings.flatMap((f) => [...f.license_ids, ...f.app_ids, ...f.evidence.map((p) => p.license_id)]),
    ...data.not_evaluated.map((r) => r.license_id),
  ])] },
};
