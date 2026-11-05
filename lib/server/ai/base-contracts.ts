import "server-only";
import { z } from "zod";
import type { InvocationInput } from "./contracts.ts";

export const MAX_INPUT_BYTES = 128_000;
export const MAX_OUTPUT_BYTES = 64_000;
export const SourceIdSchema = z.string().min(1).max(128).regex(/^\S+$/);
export const ModuleSchema = z.enum(["ala", "licenses", "playbook", "assistant"]);
export const ModelIdentitySchema = z.strictObject({
  model_provider: z.string().min(1).max(64).regex(/^[a-z0-9.-]+$/),
  model_id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:/-]+$/),
});
export const PromptVersionSchema = z.string().max(64).regex(/^[a-z][a-z0-9_-]{0,31}\/v[1-9][0-9]{0,3}$/);
export const ReferencePolicySchema = z.strictObject({ allow_empty: z.boolean(), duplicates: z.enum(["reject", "allow"]) });
export type OutputContract<T> = {
  schema: z.ZodType<T>;
  references: z.infer<typeof ReferencePolicySchema> & { extract: (data: T) => unknown };
};
const TokenCount = z.number().int().nonnegative().nullable();
export const UsageEstimateSchema = z.strictObject({ input_tokens: TokenCount, output_tokens: TokenCount, total_tokens: TokenCount, cost_usd: z.null() });
export const EnvelopeMetadataSchema = ModelIdentitySchema.extend({
  module: ModuleSchema,
  request_id: z.uuid(),
  input_digest: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["paid", "fallback"]),
  routing_reason: z.enum(["budget_exhausted", "paid_unavailable"]).optional(),
  prompt_version: PromptVersionSchema,
  generated_at: z.iso.datetime(),
  usage_estimate: UsageEstimateSchema,
  warnings: z.array(z.enum(["ai_generated_draft", "references_not_narrative_verification"])).max(2),
});
export function resultEnvelopeSchema<T>(schema: z.ZodType<T>) { return EnvelopeMetadataSchema.extend({ data: schema }).superRefine((envelope, ctx) => {
  if ((envelope.mode === "fallback") !== (envelope.routing_reason !== undefined)) ctx.addIssue({ code: "custom", path: ["routing_reason"], message: "Only fallback results require a routing reason" });
}); }
export type ResultEnvelope<T> = z.infer<typeof EnvelopeMetadataSchema> & { data: T };
export const FailureCodeSchema = z.enum(["invalid_input", "invalid_model_output", "provider_unavailable", "request_too_large", "unexpected_error", "ai_not_enabled", "ai_controls_not_ready", "ai_disabled", "controls_unavailable", "rate_limited", "capacity_reached", "paid_budget_exhausted", "fallback_unavailable", "duplicate_request"]);
export type FailureCode = z.infer<typeof FailureCodeSchema>;
export const FailureSchema = z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: FailureCodeSchema, request_id: z.uuid(), message: z.string().max(160) }) });
export type AdapterResult<T> = { ok: true; result: ResultEnvelope<T> } | z.infer<typeof FailureSchema>;
const messages: Record<FailureCode, string> = {
  invalid_input: "The AI request or server configuration is invalid.",
  invalid_model_output: "The model returned an invalid structured result or source reference.",
  provider_unavailable: "The AI provider is unavailable or the request timed out.",
  request_too_large: "The AI request exceeds the permitted input limits.",
  unexpected_error: "The AI request could not be completed.",
  ai_not_enabled: "AI requests are disabled.",
  ai_controls_not_ready: "Live AI requests require budget and rate-limit authorization that is not implemented yet.",
  ai_disabled: "AI routing is disabled.",
  controls_unavailable: "AI usage controls are unavailable. No further request is authorized.",
  rate_limited: "The anonymous AI request limit has been reached.",
  capacity_reached: "AI request capacity is currently full.",
  paid_budget_exhausted: "The paid AI request allowance is exhausted.",
  fallback_unavailable: "The independently controlled fallback is unavailable.",
  duplicate_request: "This AI request has already been handled or reserved.",
};
export function failure(code: FailureCode, request_id: string) { return FailureSchema.parse({ ok: false, error: { code, request_id, message: messages[code] } }); }
export class TransportFailure extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) { super(messages[code]); this.name = "TransportFailure"; this.code = code; }
}
export type TransportCall = { input: InvocationInput; schema: z.ZodType; signal: AbortSignal; max_output_tokens?: number };
export type TransportResult = { output: unknown; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };
export type StructuredTransport = {
  model_provider: string;
  model_id: string;
  disabled_reason?: FailureCode;
  generate: (call: TransportCall) => Promise<TransportResult>;
};
