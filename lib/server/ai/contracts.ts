import "server-only";
import { z } from "zod";
import { SyntheticDealFixtureSchema } from "../../contracts/demo.ts";

export const MAX_INPUT_BYTES = 128_000;
export const MAX_OUTPUT_BYTES = 64_000;
export const SourceIdSchema = z.string().min(1).max(128).regex(/^\S+$/);
export const ModuleSchema = z.enum(["ala", "licenses", "playbook", "assistant"]);
export const ModelIdentitySchema = z.strictObject({
  model_provider: z.string().min(1).max(64).regex(/^[a-z0-9.-]+$/),
  model_id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:/-]+$/),
});
export const InvocationSchema = z.strictObject({
  module: ModuleSchema,
  prompt_version: z.string().max(64).regex(/^[a-z][a-z0-9_-]{0,31}\/v[1-9][0-9]{0,3}$/),
  system: z.string().trim().min(1).max(4_000),
  context: z.strictObject({ deal: SyntheticDealFixtureSchema, user_text: z.string().max(2_000).optional() }),
  allowed_source_ids: z.array(SourceIdSchema).min(1).max(400),
}).superRefine((input, ctx) => {
  const deal = input.context.deal;
  if (deal.applications.length > 100 || ["buyer", "target"].some((side) => deal.applications.filter((app) => app.company_side === side).length > 50) || deal.license_positions.length > 200 || deal.tsa_services.length > 100) {
    ctx.addIssue({ code: "too_big", origin: "array", maximum: 100, inclusive: true, message: "Source record limit exceeded" });
  }
  const known = new Set([...deal.applications.map((r) => r.app_id), ...deal.license_positions.map((r) => r.license_id), ...deal.tsa_services.map((r) => r.tsa_id)]);
  if (new Set(input.allowed_source_ids).size !== input.allowed_source_ids.length || input.allowed_source_ids.some((id) => !known.has(id))) {
    ctx.addIssue({ code: "custom", path: ["allowed_source_ids"], message: "Expected unique source IDs present in context" });
  }
});
export type InvocationInput = z.infer<typeof InvocationSchema>;
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
  mode: z.literal("paid"),
  prompt_version: InvocationSchema.shape.prompt_version,
  generated_at: z.iso.datetime(),
  usage_estimate: UsageEstimateSchema,
  warnings: z.array(z.enum(["ai_generated_draft", "references_not_narrative_verification"])).max(2),
});
export function resultEnvelopeSchema<T>(schema: z.ZodType<T>) { return EnvelopeMetadataSchema.extend({ data: schema }); }
export type ResultEnvelope<T> = z.infer<typeof EnvelopeMetadataSchema> & { data: T };
export const FailureCodeSchema = z.enum(["invalid_input", "invalid_model_output", "provider_unavailable", "request_too_large", "unexpected_error", "ai_not_enabled", "ai_controls_not_ready"]);
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
};
export function failure(code: FailureCode, request_id: string) { return FailureSchema.parse({ ok: false, error: { code, request_id, message: messages[code] } }); }
export class TransportFailure extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) { super(messages[code]); this.name = "TransportFailure"; this.code = code; }
}
export type TransportCall = { input: InvocationInput; schema: z.ZodType; signal: AbortSignal };
export type TransportResult = { output: unknown; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };
export type StructuredTransport = {
  model_provider: string;
  model_id: string;
  disabled_reason?: FailureCode;
  generate: (call: TransportCall) => Promise<TransportResult>;
};
