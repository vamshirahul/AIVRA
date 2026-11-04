import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { failure, InvocationSchema, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, ModelIdentitySchema, ReferencePolicySchema, resultEnvelopeSchema, SourceIdSchema, TransportFailure, UsageEstimateSchema } from "./contracts.ts";
import type { AdapterResult, FailureCode, InvocationInput, OutputContract, StructuredTransport } from "./contracts.ts";

/** Same preflight for the adapter and guarded router; never reserves invalid work. */
export function validateInvocation<T>(request: InvocationInput, contract: OutputContract<T>) {
  try {
    const serialized = JSON.stringify(request);
    if (typeof serialized !== "string") return { ok: false, code: "invalid_input" as FailureCode } as const;
    if (Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES) return { ok: false, code: "request_too_large" as FailureCode } as const;
    const parsed = InvocationSchema.safeParse(request);
    if (!parsed.success) return { ok: false, code: (parsed.error.issues.some((issue) => issue.code === "too_big") ? "request_too_large" : "invalid_input") as FailureCode } as const;
    if (request.module === "playbook" && !isDeepStrictEqual(parsed.data, request)) return { ok: false, code: "invalid_input" as FailureCode } as const;
    if (!(contract?.schema instanceof z.ZodType) || typeof contract.references?.extract !== "function") return { ok: false, code: "invalid_input" as FailureCode } as const;
    const policy = ReferencePolicySchema.safeParse({ allow_empty: contract.references.allow_empty, duplicates: contract.references.duplicates });
    if (!policy.success) return { ok: false, code: "invalid_input" as FailureCode } as const;
    if (request.module === "playbook" && Buffer.byteLength(JSON.stringify({ input: parsed.data, schema: z.toJSONSchema(contract.schema) }), "utf8") > MAX_INPUT_BYTES) return { ok: false, code: "request_too_large" as FailureCode } as const;
    return { ok: true, input: parsed.data, references: policy.data } as const;
  } catch { return { ok: false, code: "invalid_input" as FailureCode } as const; }
}

/** Trusted server composition only. Injection is for offline tests/future providers. */
export function createAIAdapter(transport: StructuredTransport, options: { timeoutMs?: number; requestId?: string; mode?: "paid" | "fallback"; routingReason?: "budget_exhausted" | "paid_unavailable"; maxOutputTokens?: number } = {}) {
  return async function invoke<T>(request: InvocationInput, contract: OutputContract<T>): Promise<AdapterResult<T>> {
    const requestId = options.requestId && z.uuid().safeParse(options.requestId).success ? options.requestId : randomUUID();
    try {
      const parsed = validateInvocation(request, contract);
      if (!parsed.ok) return failure(parsed.code, requestId);
      const timeout = z.number().int().min(1).max(15_000).safeParse(options.timeoutMs ?? 10_000);
      const maxOutput = z.number().int().min(1).max(2048).safeParse(options.maxOutputTokens ?? 2048);
      const mode = z.enum(["paid", "fallback"]).safeParse(options.mode ?? "paid");
      if (!timeout.success || !maxOutput.success || !mode.success || (options.requestId !== undefined && !z.uuid().safeParse(options.requestId).success)) return failure("invalid_input", requestId);
      if ((mode.data === "fallback") !== (options.routingReason !== undefined) || (options.routingReason !== undefined && !z.enum(["budget_exhausted", "paid_unavailable"]).safeParse(options.routingReason).success)) return failure("invalid_input", requestId);
      if (transport.disabled_reason) return failure(transport.disabled_reason, requestId);
      const identity = ModelIdentitySchema.safeParse({ model_provider: transport.model_provider, model_id: transport.model_id });
      if (!identity.success || typeof transport.generate !== "function") return failure("invalid_input", requestId);
      const input = parsed.input;
      // Commit normalized provenance before awaiting; transport gets its own copy.
      const inputDigest = createHash("sha256").update(JSON.stringify({ input, references: parsed.references })).digest("hex");
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let generated;
      try {
        generated = await Promise.race([
          transport.generate({ input: structuredClone(input), schema: contract.schema, signal: abort.signal, max_output_tokens: maxOutput.data }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new TransportFailure("provider_unavailable")); }, timeout.data); }),
        ]);
      } catch (error) {
        return failure(error instanceof TransportFailure ? error.code : "provider_unavailable", requestId);
      } finally { clearTimeout(timer); }
      if (!generated || generated.output == null) return failure("invalid_model_output", requestId);
      let outputJson: string;
      try { outputJson = JSON.stringify(generated.output); } catch { return failure("invalid_model_output", requestId); }
      if (typeof outputJson !== "string" || Buffer.byteLength(outputJson, "utf8") > MAX_OUTPUT_BYTES) return failure("invalid_model_output", requestId);
      const output = contract.schema.safeParse(generated.output);
      // Reject stripping, coercion, defaults or transformation of generated data.
      if (!output.success || !isDeepStrictEqual(output.data, generated.output)) return failure("invalid_model_output", requestId);
      const references = z.array(SourceIdSchema).max(400).safeParse(contract.references.extract(output.data));
      if (!references.success || (!parsed.references.allow_empty && references.data.length === 0) ||
        (parsed.references.duplicates === "reject" && new Set(references.data).size !== references.data.length) ||
        references.data.some((id) => !input.allowed_source_ids.includes(id))) return failure("invalid_model_output", requestId);
      const usage = UsageEstimateSchema.safeParse({
        input_tokens: generated.usage?.inputTokens ?? null,
        output_tokens: generated.usage?.outputTokens ?? null,
        total_tokens: generated.usage?.totalTokens ?? null,
        cost_usd: null,
      });
      if (!usage.success) return failure("invalid_model_output", requestId);
      const envelope = resultEnvelopeSchema(contract.schema).safeParse({
        ...identity.data, module: input.module, request_id: requestId, input_digest: inputDigest,
        mode: mode.data, ...(options.routingReason ? { routing_reason: options.routingReason } : {}), prompt_version: input.prompt_version, generated_at: new Date().toISOString(),
        usage_estimate: usage.data, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data: output.data,
      });
      if (!envelope.success) return failure("invalid_model_output", requestId);
      return { ok: true, result: envelope.data };
    } catch { return failure("unexpected_error", requestId); }
  };
}
