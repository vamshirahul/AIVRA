import "server-only";
import { z } from "zod";
import { FailureCodeSchema, SourceIdSchema, resultEnvelopeSchema } from "../ai/base-contracts.ts";
import { LicenseSourceTokenSchema } from "./source-schema.ts";
import { LicenseResultSchema, LicenseCoverageSchema } from "./schema.ts";
import { LICENSE_PROMPT_VERSION } from "./prompt.ts";

const ErrorOutcome = z.strictObject({ status: z.literal("error"), error: z.strictObject({ code: FailureCodeSchema, request_id: z.uuid().nullable(), message: z.string().min(1).max(160) }) });
export const LicenseAnalyzeOutcomeSchema = z.union([ErrorOutcome, z.strictObject({
  status: z.enum(["success", "incomplete"]), envelope: resultEnvelopeSchema(LicenseResultSchema),
  coverage: LicenseCoverageSchema, source_token: LicenseSourceTokenSchema,
})]).superRefine((value, ctx) => {
  if (value.status !== "error" && ((value.status === "success") !== (value.coverage.status === "complete") ||
      value.envelope.module !== "licenses" || value.envelope.prompt_version !== LICENSE_PROMPT_VERSION)) ctx.addIssue({ code: "custom", message: "License outcome identity/coverage mismatch" });
});
export type LicenseAnalyzeOutcome = z.infer<typeof LicenseAnalyzeOutcomeSchema>;
