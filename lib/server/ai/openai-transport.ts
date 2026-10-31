import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { ModelIdentitySchema, TransportFailure } from "./contracts.ts";
import type { FailureCode, StructuredTransport } from "./contracts.ts";
import { createSDKTransport } from "./sdk-transport.ts";

/** Only environment-configured live factory. U00.07 must replace these hard stops. */
export function createOpenAITransport(env: NodeJS.ProcessEnv = process.env): StructuredTransport {
  const modelId = env.AIVRA_PAID_MODEL_ID ?? "";
  let reason: FailureCode = "ai_not_enabled";
  if (env.AIVRA_AI_ENABLED === "true") {
    reason = env.OPENAI_API_KEY?.trim() && ModelIdentitySchema.safeParse({ model_provider: "openai", model_id: modelId }).success ? "ai_controls_not_ready" : "invalid_input";
  }
  const blocked = async (): Promise<never> => { throw new TransportFailure(reason); };
  if (reason !== "ai_controls_not_ready") return { model_provider: "openai", model_id: modelId, disabled_reason: reason, generate: blocked };
  // Construction performs no I/O. Fetch itself also fails closed, independently
  // of the pre-dispatch guard: an env flag never authorizes a billable request.
  const provider = createOpenAI({ apiKey: env.OPENAI_API_KEY!, fetch: async () => { throw new TransportFailure("ai_controls_not_ready"); } });
  const transport = createSDKTransport(provider.responses(modelId), "openai");
  return { ...transport, disabled_reason: "ai_controls_not_ready", generate: blocked };
}
