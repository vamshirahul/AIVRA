// Client-safe presentation only. These imports are erased; never import server runtime code.
import type { FailureCode, ResultEnvelope } from "../server/ai/contracts.ts";

declare const validatedMetadata: unique symbol;
type Identity = Readonly<{ model_provider: string; model_id: string; [validatedMetadata]: true }>;
export type AIResultMetadata = Identity & (
  | { readonly mode: "paid"; readonly routing_reason?: never }
  | { readonly mode: "fallback"; readonly routing_reason: "budget_exhausted" | "paid_unavailable" }
);
export type AIViewState =
  | { readonly status: "not_enabled" | "idle" | "loading" }
  | { readonly status: "completed"; readonly resultMetadata: AIResultMetadata; readonly freshness?: "current" | "stale" }
  | { readonly status: "error"; readonly safeErrorCode: FailureCode };

/** Trusted caller only: supply a server-validated envelope, never raw provider/visitor JSON.
 * This projects bounded metadata; it does not validate result data or authorize a model.
 */
export function metadataFromValidatedResult(result: ResultEnvelope<unknown>): AIResultMetadata | null {
  return boundedMetadata(result);
}
function boundedMetadata(result: Pick<ResultEnvelope<unknown>, "model_provider" | "model_id" | "mode" | "routing_reason">): AIResultMetadata | null {
  if (!result || typeof result.model_provider !== "string" || typeof result.model_id !== "string" ||
      !/^[a-z0-9.-]{1,64}$/.test(result.model_provider) || !/^[a-zA-Z0-9._:/-]{1,128}$/.test(result.model_id)) return null;
  if (result.mode === "paid" && result.routing_reason !== undefined) return null;
  if (result.mode !== "paid" && (result.mode !== "fallback" || !["budget_exhausted", "paid_unavailable"].includes(result.routing_reason ?? ""))) return null;
  return Object.freeze({ model_provider: result.model_provider, model_id: result.model_id, mode: result.mode,
    ...(result.mode === "fallback" ? { routing_reason: result.routing_reason } : {}) }) as AIResultMetadata;
}

export const AI_ERROR_COPY = {
  invalid_input: "The request could not be validated. Check the supplied inputs.",
  invalid_model_output: "No valid AI result is available from this request.",
  provider_unavailable: "The AI provider could not complete the request. No fallback result was generated.",
  request_too_large: "The request exceeds the supported input size. Reduce the supplied inputs.",
  unexpected_error: "The AI request could not be completed.",
  ai_not_enabled: "AI requests are currently disabled.",
  ai_controls_not_ready: "AI integration is not ready for live requests.",
  ai_disabled: "AI requests are currently disabled.",
  controls_unavailable: "AI usage protections are unavailable, so further requests are paused.",
  rate_limited: "The AI request limit has been reached. Availability may change later.",
  capacity_reached: "AI request capacity is currently full. Availability may change later.",
  paid_budget_exhausted: "The paid AI allowance is exhausted. No fallback result is available for this request.",
  fallback_unavailable: "Open-weight fallback is unavailable or its independent allowance is exhausted. No AI result is available.",
  duplicate_request: "This request has already been handled or reserved. No additional request was started.",
} as const satisfies Record<FailureCode, string>;

export type AINoticePresentation = Readonly<{
  title: string; message: string; tone: "neutral" | "activity" | "complete" | "fallback" | "error";
  role?: "status" | "alert"; modelLabel?: string; stale?: string;
}>;
export function presentAIState(state: AIViewState): AINoticePresentation {
  switch (state.status) {
    case "not_enabled": return { title: "AI not enabled", message: "AI integration is planned. No AI request has been made on this page.", tone: "neutral" };
    case "idle": return { title: "No AI analysis yet", message: "Analysis starts only after an explicit action. Synthetic example data is not an AI result.", tone: "neutral" };
    case "loading": return { title: "Analyzing with AI...", message: "The request is pending. No completed result is available yet.", tone: "activity", role: "status" };
    case "error": return { title: "AI unavailable", message: `${Object.hasOwn(AI_ERROR_COPY, state.safeErrorCode) ? AI_ERROR_COPY[state.safeErrorCode] : AI_ERROR_COPY.unexpected_error} Your synthetic session data is retained.`, tone: "error", role: "alert" };
    case "completed": {
      const result = boundedMetadata(state.resultMetadata);
      if (!result) return presentAIState({ status: "error", safeErrorCode: "invalid_model_output" });
      const fallback = result.mode === "fallback";
      return { title: fallback ? "AI draft · Open-weight AI fallback" : "AI draft · Paid model", tone: fallback ? "fallback" : "complete", role: "status",
        message: `${fallback ? (result.routing_reason === "budget_exhausted" ? "The paid AI allowance could not cover this request." : "The paid AI path was disabled by policy.") + " Results may differ from the paid model. " : ""}Review this provisional AI draft. It is not transaction advice or human approval.`,
        modelLabel: `Provider: ${result.model_provider} · Model: ${result.model_id}`,
        ...(state.freshness === "stale" ? { stale: "Outdated: source data changed after this result. Review it against the current inputs." } : {}) };
    }
  }
}
