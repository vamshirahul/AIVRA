import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { failure, InvocationSchema, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, ModelIdentitySchema, ReferencePolicySchema, resultEnvelopeSchema, SourceIdSchema, TransportFailure, UsageEstimateSchema } from "./contracts.ts";
import type { AdapterResult, InvocationInput, OutputContract, StructuredTransport } from "./contracts.ts";

/** Trusted server composition only. Injection is for offline tests/future providers. */
export function createAIAdapter(transport: StructuredTransport, options: { timeoutMs?: number } = {}) {
  return async function invoke<T>(request: InvocationInput, contract: OutputContract<T>): Promise<AdapterResult<T>> {
    const requestId = randomUUID();
    try {
      let serialized: string;
      try { serialized = JSON.stringify(request); } catch { return failure("invalid_input", requestId); }
      if (typeof serialized !== "string") return failure("invalid_input", requestId);
      if (Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES) return failure("request_too_large", requestId);
      const parsed = InvocationSchema.safeParse(request);
      if (!parsed.success) return failure(parsed.error.issues.some((issue) => issue.code === "too_big") ? "request_too_large" : "invalid_input", requestId);
      if (!(contract?.schema instanceof z.ZodType) || typeof contract.references?.extract !== "function") return failure("invalid_input", requestId);
      const policy = ReferencePolicySchema.safeParse({ allow_empty: contract.references.allow_empty, duplicates: contract.references.duplicates });
      const timeout = z.number().int().min(1).max(15_000).safeParse(options.timeoutMs ?? 10_000);
      if (!policy.success || !timeout.success) return failure("invalid_input", requestId);
      if (transport.disabled_reason) return failure(transport.disabled_reason, requestId);
      const identity = ModelIdentitySchema.safeParse({ model_provider: transport.model_provider, model_id: transport.model_id });
      if (!identity.success || typeof transport.generate !== "function") return failure("invalid_input", requestId);
      const input = parsed.data;
      // Commit normalized provenance before awaiting; transport gets its own copy.
      const inputDigest = createHash("sha256").update(JSON.stringify({ input, references: policy.data })).digest("hex");
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let generated;
      try {
        generated = await Promise.race([
          transport.generate({ input: structuredClone(input), schema: contract.schema, signal: abort.signal }),
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
      if (!references.success || (!policy.data.allow_empty && references.data.length === 0) ||
        (policy.data.duplicates === "reject" && new Set(references.data).size !== references.data.length) ||
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
        mode: "paid", prompt_version: input.prompt_version, generated_at: new Date().toISOString(),
        usage_estimate: usage.data, warnings: ["ai_generated_draft", "references_not_narrative_verification"], data: output.data,
      });
      if (!envelope.success) return failure("invalid_model_output", requestId);
      return { ok: true, result: envelope.data };
    } catch { return failure("unexpected_error", requestId); }
  };
}
