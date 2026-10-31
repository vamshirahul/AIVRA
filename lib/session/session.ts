import { z } from "zod";
import { ApplicationSchema, LicensePositionSchema, SyntheticDealFixtureSchema, TSAServiceSchema } from "../contracts/demo.ts";
import { loadSyntheticDealFixture } from "../fixtures/synthetic-deal.ts";

export const SESSION_SCHEMA_VERSION = "1.0.0" as const;
export const SESSION_STORAGE_KEY = "aivra:r0:demo-session:v1";
export const MAX_SESSION_CHARACTERS = 512_000;
const bundled = loadSyntheticDealFixture();
const Counter = z.number().int().nonnegative();
export const InputDependencySchema = z.enum(["applications", "licenses", "tsa"]);
export const ResultKindSchema = z.enum(["ala", "licenses", "cost", "scenario", "playbook", "assistant", "health"]);
export type InputDependency = z.infer<typeof InputDependencySchema>;
export type ResultKind = z.infer<typeof ResultKindSchema>;
export const RESULT_DEPENDENCIES: Record<ResultKind, readonly InputDependency[]> = {
  ala: ["applications"],
  licenses: ["applications", "licenses"],
  cost: ["applications", "licenses"],
  scenario: ["applications", "licenses"],
  playbook: ["applications", "licenses", "tsa"],
  assistant: ["applications", "licenses", "tsa"],
  health: ["applications", "licenses", "tsa"],
};
const RevisionsSchema = z.strictObject({ applications: Counter, licenses: Counter, tsa: Counter });
const CapturedVersionsSchema = z.strictObject({ session_id: z.uuid(), revisions: z.partialRecord(InputDependencySchema, Counter) });
export type CapturedVersions = z.infer<typeof CapturedVersionsSchema>;
const MetadataSchema = z.strictObject({
  dependencies: z.array(InputDependencySchema).min(1).max(3),
  captured_versions: CapturedVersionsSchema,
  recorded_at: z.iso.datetime(),
}).superRefine((metadata, ctx) => {
  if (new Set(metadata.dependencies).size !== metadata.dependencies.length ||
    Object.keys(metadata.captured_versions.revisions).length !== metadata.dependencies.length ||
    metadata.dependencies.some((tag) => metadata.captured_versions.revisions[tag] === undefined)) {
    ctx.addIssue({ code: "custom", message: "Dependencies must be unique and match captured version keys exactly" });
  }
});
const DerivedRegistrySchema = z.strictObject({
  ala: MetadataSchema.optional(), licenses: MetadataSchema.optional(), cost: MetadataSchema.optional(),
  scenario: MetadataSchema.optional(), playbook: MetadataSchema.optional(), assistant: MetadataSchema.optional(), health: MetadataSchema.optional(),
});

export const DemoSessionSchema = z.strictObject({
  session_schema_version: z.literal(SESSION_SCHEMA_VERSION),
  session_id: z.uuid(),
  fixture: z.strictObject({ fixture_id: z.literal(bundled.fixture_id), schema_version: z.literal(bundled.schema_version), dataset_version: z.literal(bundled.dataset_version) }),
  created_at: z.iso.datetime(), modified_at: z.iso.datetime(),
  session_revision: Counter,
  input_revisions: RevisionsSchema,
  current_deal: SyntheticDealFixtureSchema,
  derived_results: DerivedRegistrySchema,
}).superRefine((session, ctx) => {
  const deal = session.current_deal;
  if (deal.fixture_id !== session.fixture.fixture_id || deal.schema_version !== session.fixture.schema_version || deal.dataset_version !== session.fixture.dataset_version || deal.currency !== bundled.currency) {
    ctx.addIssue({ code: "custom", path: ["current_deal"], message: "Incompatible fixture identity, version or currency" });
  }
  if (Date.parse(session.created_at) > Date.parse(session.modified_at)) ctx.addIssue({ code: "custom", path: ["modified_at"], message: "Modified time precedes creation" });
  if (deal.applications.length > 100 || ["buyer", "target"].some((side) => deal.applications.filter((app) => app.company_side === side).length > 50) || deal.license_positions.length > 200 || deal.tsa_services.length > 100) {
    ctx.addIssue({ code: "custom", path: ["current_deal"], message: "Session record limits exceeded" });
  }
  for (const tag of InputDependencySchema.options) {
    if (session.input_revisions[tag] > session.session_revision) ctx.addIssue({ code: "custom", path: ["input_revisions", tag], message: "Input revision exceeds session revision" });
  }
  for (const kind of ResultKindSchema.options) {
    const metadata = session.derived_results[kind];
    if (!metadata) continue;
    if (metadata.captured_versions.session_id !== session.session_id) ctx.addIssue({ code: "custom", path: ["derived_results", kind], message: "Captured versions belong to a different session lifetime" });
    if (RESULT_DEPENDENCIES[kind].some((tag) => !metadata.dependencies.includes(tag))) ctx.addIssue({ code: "custom", path: ["derived_results", kind], message: "Required source dependencies are missing" });
    if (Date.parse(metadata.recorded_at) < Date.parse(session.created_at) || Date.parse(metadata.recorded_at) > Date.parse(session.modified_at)) ctx.addIssue({ code: "custom", path: ["derived_results", kind], message: "Metadata time is outside session lifetime" });
    for (const tag of metadata.dependencies) {
      if (metadata.captured_versions.revisions[tag]! > session.input_revisions[tag]) ctx.addIssue({ code: "custom", path: ["derived_results", kind, "captured_versions", "revisions", tag], message: "Captured revision is in the future" });
    }
  }
});
export type DemoSession = z.infer<typeof DemoSessionSchema>;
export type Freshness = "missing" | "current" | "stale";

export function createDemoSession(now = new Date().toISOString()): DemoSession {
  return DemoSessionSchema.parse({
    session_schema_version: SESSION_SCHEMA_VERSION,
    session_id: crypto.randomUUID(),
    fixture: { fixture_id: bundled.fixture_id, schema_version: bundled.schema_version, dataset_version: bundled.dataset_version },
    created_at: now, modified_at: now, session_revision: 0,
    input_revisions: { applications: 0, licenses: 0, tsa: 0 },
    current_deal: loadSyntheticDealFixture(), derived_results: {},
  });
}

export function serializeSession(session: DemoSession): string {
  const json = JSON.stringify(DemoSessionSchema.parse(session));
  if (json.length > MAX_SESSION_CHARACTERS) throw new Error("Session size limit exceeded");
  return json;
}

export function parseSession(json: string): DemoSession {
  if (json.length > MAX_SESSION_CHARACTERS) throw new Error("Session size limit exceeded");
  return DemoSessionSchema.parse(JSON.parse(json));
}

export function captureInputVersions(session: DemoSession, dependencies: readonly InputDependency[]): CapturedVersions {
  return { session_id: session.session_id, revisions: Object.fromEntries(dependencies.map((tag) => [tag, session.input_revisions[tag]])) };
}

export function getResultFreshness(session: DemoSession, kind: ResultKind): Freshness {
  const metadata = session.derived_results[kind];
  if (!metadata) return "missing";
  return metadata.captured_versions.session_id === session.session_id && metadata.dependencies.every((tag) => metadata.captured_versions.revisions[tag] === session.input_revisions[tag]) ? "current" : "stale";
}

function nextTime(session: DemoSession, now: string) {
  return Date.parse(now) > Date.parse(session.modified_at) ? now : session.modified_at;
}

export function recordDerivedResultMetadata(session: DemoSession, kind: ResultKind, dependencies: readonly InputDependency[], captured_versions: CapturedVersions, now = new Date().toISOString()): DemoSession {
  ResultKindSchema.parse(kind);
  const timestamp = nextTime(session, now);
  return DemoSessionSchema.parse({ ...session, modified_at: timestamp, session_revision: session.session_revision + 1,
    derived_results: { ...session.derived_results, [kind]: { dependencies, captured_versions, recorded_at: timestamp } },
  });
}

const ApplicationPatchSchema = ApplicationSchema.omit({ app_id: true, company_side: true }).partial();
const LicensePatchSchema = LicensePositionSchema.omit({ license_id: true }).partial();
// Refinements remain on the complete TSA record and fixture, not on partial input.
const TSAPatchSchema = z.strictObject(TSAServiceSchema.shape).omit({ tsa_id: true }).partial();
export type ApplicationPatch = z.infer<typeof ApplicationPatchSchema>;
export type LicensePatch = z.infer<typeof LicensePatchSchema>;
export type TSAPatch = z.infer<typeof TSAPatchSchema>;

function updateRecord(session: DemoSession, dependency: InputDependency, id: string, patch: unknown, now: string): DemoSession {
  const field = dependency === "applications" ? "applications" : dependency === "licenses" ? "license_positions" : "tsa_services";
  const records = session.current_deal[field];
  const index = records.findIndex((record) => ("app_id" in record && "company_side" in record ? record.app_id : "license_id" in record ? record.license_id : "tsa_id" in record ? record.tsa_id : undefined) === id);
  if (index === -1) throw new Error("Record ID not found");
  const candidate = DemoSessionSchema.parse({ ...session, current_deal: { ...session.current_deal, [field]: records.map((record, i) => i === index ? { ...record, ...(patch as object) } : record) } });
  if (JSON.stringify(candidate.current_deal) === JSON.stringify(session.current_deal)) return session;
  return DemoSessionSchema.parse({ ...candidate, modified_at: nextTime(session, now), session_revision: session.session_revision + 1,
    input_revisions: { ...session.input_revisions, [dependency]: session.input_revisions[dependency] + 1 },
  });
}

export function updateApplication(session: DemoSession, id: string, patch: ApplicationPatch, now = new Date().toISOString()) {
  return updateRecord(session, "applications", id, ApplicationPatchSchema.parse(patch), now);
}
export function updateLicense(session: DemoSession, id: string, patch: LicensePatch, now = new Date().toISOString()) {
  return updateRecord(session, "licenses", id, LicensePatchSchema.parse(patch), now);
}
export function updateTSA(session: DemoSession, id: string, patch: TSAPatch, now = new Date().toISOString()) {
  return updateRecord(session, "tsa", id, TSAPatchSchema.parse(patch), now);
}
