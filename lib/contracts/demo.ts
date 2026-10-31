import { z } from "zod";

export const DEMO_SCHEMA_VERSION = "1.0.0" as const;

// Opaque identity: no display-name, side, or array-position semantics.
const idSchema = z.string().min(1).regex(/^\S+$/, "ID must not contain whitespace");
const textSchema = z.string().trim().min(1);
const notesSchema = textSchema.max(500).nullable();
const amountSchema = z.number().nonnegative().nullable();
const seatsSchema = z.number().int().nonnegative().nullable();
const dateSchema = z.iso.date();

export const ApplicationSchema = z.strictObject({
  app_id: idSchema,
  company_side: z.enum(["buyer", "target"]),
  app_name: textSchema,
  function: textSchema,
  vendor: textSchema.nullable(),
  annual_cost: amountSchema,
  deployment: z.enum(["cloud", "on_premise", "hybrid"]).nullable(),
  criticality: z.enum(["low", "medium", "high", "critical"]).nullable(),
  lifecycle: z.enum(["active", "legacy", "retiring"]).nullable(),
  owner: textSchema.nullable(),
  notes: notesSchema,
});

export const LicensePositionSchema = z.strictObject({
  license_id: idSchema,
  app_id: idSchema,
  vendor: textSchema.nullable(),
  product: textSchema,
  seats_entitled: seatsSchema,
  seats_used: seatsSchema,
  annual_spend: amountSchema,
  renewal_date: dateSchema.nullish(),
  notes: notesSchema,
});

export const TSAServiceSchema = z.strictObject({
  tsa_id: idSchema,
  title: textSchema,
  provider: textSchema,
  recipient: textSchema,
  owner: textSchema.nullable(),
  start_date: dateSchema.nullable(),
  end_date: dateSchema.nullable(),
  status: z.enum(["planned", "active", "at_risk", "completed"]),
  exit_milestone: textSchema.nullable(),
  risk_notes: notesSchema,
  related_app_ids: z.array(idSchema).max(10).optional(),
}).superRefine((service, ctx) => {
  if (service.start_date && service.end_date && service.end_date < service.start_date) {
    ctx.addIssue({
      code: "custom",
      path: ["end_date"],
      message: "TSA end_date must be on or after start_date",
    });
  }
  const seen = new Set<string>();
  service.related_app_ids?.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({ code: "custom", path: ["related_app_ids", index], message: `Duplicate app reference: ${id}` });
    }
    seen.add(id);
  });
});

export const SyntheticDealFixtureSchema = z.strictObject({
  fixture_id: idSchema,
  schema_version: z.literal(DEMO_SCHEMA_VERSION),
  dataset_version: z.string().regex(/^\d+\.\d+\.\d+$/, "Expected dataset version major.minor.patch"),
  synthetic: z.literal(true),
  disclosure: textSchema,
  buyer_name: textSchema,
  target_name: textSchema,
  currency: z.currencyCode(),
  applications: z.array(ApplicationSchema).min(2),
  license_positions: z.array(LicensePositionSchema),
  tsa_services: z.array(TSAServiceSchema),
}).superRefine((fixture, ctx) => {
  const seen = new Map<string, string>();
  const identities = [
    ...fixture.applications.map((record, index) => ({ id: record.app_id, path: ["applications", index, "app_id"] })),
    ...fixture.license_positions.map((record, index) => ({ id: record.license_id, path: ["license_positions", index, "license_id"] })),
    ...fixture.tsa_services.map((record, index) => ({ id: record.tsa_id, path: ["tsa_services", index, "tsa_id"] })),
  ];
  for (const { id, path } of identities) {
    const previous = seen.get(id);
    if (previous) {
      ctx.addIssue({ code: "custom", path, message: `Duplicate record ID ${id}; first used at ${previous}` });
    } else {
      seen.set(id, path.join("."));
    }
  }

  for (const side of ["buyer", "target"] as const) {
    if (!fixture.applications.some((app) => app.company_side === side)) {
      ctx.addIssue({ code: "custom", path: ["applications"], message: `Missing ${side} applications` });
    }
  }

  const appIds = new Set(fixture.applications.map((app) => app.app_id));
  fixture.license_positions.forEach((license, index) => {
    if (!appIds.has(license.app_id)) {
      ctx.addIssue({ code: "custom", path: ["license_positions", index, "app_id"], message: `Unknown application ID: ${license.app_id}` });
    }
  });
  fixture.tsa_services.forEach((service, index) => {
    service.related_app_ids?.forEach((appId, appIndex) => {
      if (!appIds.has(appId)) {
        ctx.addIssue({ code: "custom", path: ["tsa_services", index, "related_app_ids", appIndex], message: `Unknown application ID: ${appId}` });
      }
    });
  });
});

export type Application = z.infer<typeof ApplicationSchema>;
export type LicensePosition = z.infer<typeof LicensePositionSchema>;
export type TSAService = z.infer<typeof TSAServiceSchema>;
export type SyntheticDealFixture = z.infer<typeof SyntheticDealFixtureSchema>;
