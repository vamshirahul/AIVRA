import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createAIRouter } from "../ai/router.ts";
import { failure, FailureCodeSchema, MAX_OUTPUT_BYTES, resultEnvelopeSchema } from "../ai/contracts.ts";
import type { FailureCode, InvocationInput } from "../ai/contracts.ts";
import { LICENSE_PROMPT_VERSION } from "./prompt.ts";
import { buildLicenseRequest, LicenseSourceTokenSchema, matchesLicenseSource } from "./request.ts";
import { LICENSE_OUTPUT_CONTRACT, LicenseCoverageSchema, LicenseResultSchema, inspectLicenseResult } from "./schema.ts";

import { LicenseAnalyzeOutcomeSchema } from "./outcome-schema.ts";
import type { LicenseAnalyzeOutcome } from "./outcome-schema.ts";
export { LicenseAnalyzeOutcomeSchema } from "./outcome-schema.ts";
export type { LicenseAnalyzeOutcome } from "./outcome-schema.ts";
function safeError(code: FailureCode, requestId: string | null = null): Extract<LicenseAnalyzeOutcome, { status: "error" }> {
  const safe = failure(code, requestId ?? "00000000-0000-4000-8000-000000000000");
  return { status: "error", error: { ...safe.error, request_id: requestId } };
}
function digestFor(input: InvocationInput): string {
  return createHash("sha256").update(JSON.stringify({ input, references: { allow_empty: true, duplicates: "reject" } })).digest("hex");
}

/** Trusted server seam only. No public endpoint imports this or supplies router options. */
export function createLicenseAnalyzer(options: Parameters<typeof createAIRouter>[0] = {}) {
  const invoke = createAIRouter(options);
  return async function analyze(session: unknown, caller?: Parameters<ReturnType<typeof createAIRouter>>[2]): Promise<LicenseAnalyzeOutcome> {
    try {
      const built = buildLicenseRequest(session);
      if (!built.ok) return safeError(built.code);
      const result = await invoke(built.request, LICENSE_OUTPUT_CONTRACT, caller);
      if (!result.ok) return safeError(result.error.code, result.error.request_id);
      const envelope = resultEnvelopeSchema(LicenseResultSchema).safeParse(result.result);
      if (!envelope.success || !isDeepStrictEqual(envelope.data, result.result) || Buffer.byteLength(JSON.stringify(result.result), "utf8") > MAX_OUTPUT_BYTES ||
          envelope.data.module !== "licenses" || envelope.data.prompt_version !== LICENSE_PROMPT_VERSION || envelope.data.input_digest !== digestFor(built.request)) return safeError("invalid_model_output", result.result.request_id);
      const inspected = inspectLicenseResult(envelope.data.data, built.request.context.deal.license_positions, built.request.context.deal.applications);
      if (!inspected.ok) return safeError("invalid_model_output", envelope.data.request_id);
      const outcome = LicenseAnalyzeOutcomeSchema.safeParse({ status: inspected.coverage.status === "complete" ? "success" : "incomplete",
        envelope: envelope.data, coverage: inspected.coverage, source_token: built.source_token });
      return outcome.success ? outcome.data : safeError("invalid_model_output", envelope.data.request_id);
    } catch { return safeError("unexpected_error"); }
  };
}

/** Structural consumer gate, not authentication. Use only outcomes from trusted server composition. */
export function inspectLicenseOutcome(input: unknown, captured: unknown, current: unknown):
  | { status: "current"; outcome: Exclude<LicenseAnalyzeOutcome, { status: "error" }> }
  | { status: "invalid" | "outdated" } {
  try {
    const parsed = LicenseAnalyzeOutcomeSchema.safeParse(input), built = buildLicenseRequest(captured);
    if (!parsed.success || !isDeepStrictEqual(parsed.data, input) || parsed.data.status === "error" || !built.ok ||
        Buffer.byteLength(JSON.stringify(parsed.data.envelope), "utf8") > MAX_OUTPUT_BYTES) return { status: "invalid" };
    const value = parsed.data;
    const inspected = inspectLicenseResult(value.envelope.data, built.request.context.deal.license_positions, built.request.context.deal.applications);
    if (!inspected.ok || !isDeepStrictEqual(value.coverage, inspected.coverage) || !isDeepStrictEqual(value.source_token, built.source_token) ||
        value.envelope.input_digest !== digestFor(built.request)) return { status: "invalid" };
    if (!matchesLicenseSource(value.source_token, current)) return { status: "outdated" };
    return { status: "current", outcome: value };
  } catch { return { status: "invalid" }; }
}
