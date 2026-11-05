import "server-only";
import { z } from "zod";
import { SourceIdSchema } from "../ai/base-contracts.ts";

export const LicenseSourceTokenSchema = z.strictObject({
  session_id: z.uuid(), fixture_id: SourceIdSchema, fixture_dataset_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  application_revision: z.number().int().nonnegative(), license_revision: z.number().int().nonnegative(),
  source_digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type LicenseSourceToken = Readonly<z.infer<typeof LicenseSourceTokenSchema>>;
