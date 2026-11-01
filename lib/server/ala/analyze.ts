import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createAIRouter } from "../ai/router.ts";
import { failure, FailureCodeSchema, MAX_OUTPUT_BYTES, resultEnvelopeSchema, SourceIdSchema } from "../ai/contracts.ts";
import type { FailureCode } from "../ai/contracts.ts";
import { ALA_PROMPT_VERSION } from "./prompt.ts";
import { ALASourceTokenSchema, buildALARequest } from "./request.ts";
import { ALA_OUTPUT_CONTRACT, ALAResultSchema, inspectALAResult } from "./schema.ts";

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
function safeError(code: FailureCode, requestId: string | null = null): z.infer<typeof ALAActionErrorSchema> {
  // Existing server-owned fixed messages, never an injected router/provider message.
  const safe = failure(code, requestId ?? "00000000-0000-4000-8000-000000000000");
  return { status: "error", error: { ...safe.error, request_id: requestId } };
}

/** Trusted server composition seam only; the inert public route never imports/calls this. */
export function createALAAnalyzer(options: Parameters<typeof createAIRouter>[0] = {}) {
  const invoke = createAIRouter(options);
  return async function analyze(session: unknown, caller?: Parameters<ReturnType<typeof createAIRouter>>[2]): Promise<ALAAnalyzeOutcome> {
    try {
      const built = buildALARequest(session);
      if (!built.ok) return safeError(built.code);
      const result = await invoke(built.request, ALA_OUTPUT_CONTRACT, caller);
      if (!result.ok) return safeError(result.error.code, result.error.request_id);
      const envelope = resultEnvelopeSchema(ALAResultSchema).safeParse(result.result);
      if (!envelope.success || !isDeepStrictEqual(envelope.data, result.result) || Buffer.byteLength(JSON.stringify(result.result), "utf8") > MAX_OUTPUT_BYTES ||
          envelope.data.module !== "ala" || envelope.data.prompt_version !== ALA_PROMPT_VERSION) return safeError("invalid_model_output", result.result.request_id);
      const inspected = inspectALAResult(envelope.data.data, built.request.context.deal.applications);
      if (!inspected.ok) return safeError("invalid_model_output", envelope.data.request_id);
      const outcome = { status: inspected.coverage.status === "complete" ? "success" as const : "incomplete" as const,
        envelope: envelope.data, coverage: inspected.coverage, source_token: built.source_token };
      // Source token is captured before await. Only a later caller can compare it to current browser state.
      const checked = ALAAnalyzeOutcomeSchema.safeParse(outcome);
      return checked.success ? checked.data : safeError("invalid_model_output", envelope.data.request_id);
    } catch { return safeError("unexpected_error"); }
  };
}
