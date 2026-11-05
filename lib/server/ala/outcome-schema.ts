import "server-only";
import { z } from "zod";
import { FailureCodeSchema, SourceIdSchema, resultEnvelopeSchema } from "../ai/base-contracts.ts";
import { ALASourceTokenSchema } from "./source-schema.ts";
import { ALAResultSchema } from "./schema.ts";
import { ALA_PROMPT_VERSION } from "./prompt.ts";

const SideCoverage = z.strictObject({
  source_count: z.number().int().min(0).max(50), accounted_count: z.number().int().min(0).max(50),
  missing_app_ids: z.array(SourceIdSchema).max(50), not_evaluated_app_ids: z.array(SourceIdSchema).max(50),
});
const Coverage = z.strictObject({ status: z.enum(["complete", "incomplete"]),
  reasons: z.array(z.enum(["missing_applications", "not_evaluated_applications"])).max(2), buyer: SideCoverage, target: SideCoverage });
export const ALAActionErrorSchema = z.strictObject({ status: z.literal("error"), error: z.strictObject({
  code: FailureCodeSchema, request_id: z.uuid().nullable(), message: z.string().min(1).max(160),
}) });
const Success = z.strictObject({ status: z.enum(["success", "incomplete"]),
  envelope: resultEnvelopeSchema(ALAResultSchema), coverage: Coverage, source_token: ALASourceTokenSchema });
export const ALAAnalyzeOutcomeSchema = z.union([ALAActionErrorSchema, Success]).superRefine((value, context) => {
  if (value.status !== "error" && ((value.status === "success") !== (value.coverage.status === "complete") || value.envelope.module !== "ala" || value.envelope.prompt_version !== ALA_PROMPT_VERSION)) context.addIssue({ code: "custom", message: "ALA outcome identity/coverage mismatch" });
});
export type ALAAnalyzeOutcome = z.infer<typeof ALAAnalyzeOutcomeSchema>;
