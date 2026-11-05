import "server-only";
import { z } from "zod";
import { SourceIdSchema } from "../ai/base-contracts.ts";

export const ALASourceTokenSchema = z.strictObject({
  session_id: z.uuid(), application_revision: z.number().int().nonnegative(),
  fixture_id: z.string().min(1), fixture_dataset_version: z.string().min(1), applications_digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ALASourceToken = Readonly<z.infer<typeof ALASourceTokenSchema>>;
