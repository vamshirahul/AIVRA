import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createAIRouter } from "../ai/router.ts";
import { InvocationSchema } from "../ai/contracts.ts";
import type { InvocationInput, OutputContract } from "../ai/contracts.ts";
import { ControlPolicySchema } from "../ai/control-policy.ts";
import { failure, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from "../ai/base-contracts.ts";
import type { FailureCode } from "../ai/base-contracts.ts";
import { freezeCSE } from "../../cost-synergy/calculation-contract.ts";
import { buildAssistantContext, isCurrentAssistantContext, validateAssistantReferences } from "./context.ts";
import type { AssistantSourceReader } from "./context.ts";
import type { AssistantContext } from "./schema.ts";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt.ts";
import { AssistantAnswerSchema, AssistantAskRequestSchema, AssistantAskPayloadSchema, AssistantEnvelopeSchema, AssistantHistorySchema,
  ASSISTANT_PROMPT_VERSION, MAX_ASSISTANT_TURNS, MAX_ASSISTANT_HISTORY_BYTES, inspectAssistantAnswer } from "./ask-schema.ts";
import type { AssistantAnswer } from "./ask-schema.ts";

const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
export const ASSISTANT_OUTPUT_CONTRACT: OutputContract<AssistantAnswer> = {
  schema: AssistantAnswerSchema, references: { allow_empty: true, duplicates: "reject", extract: answer => answer.citations },
};
type LocalCode = "source_changed" | "invalid_conversation" | "history_limit";
const error = (code: FailureCode | LocalCode, id: string) => ({ status: "error" as const, error: { code, request_id: id,
  message: code === "source_changed" ? "The Assistant context changed. This conversation is no longer current; no answer was released."
    : code === "invalid_conversation" ? "A current conversation issued by this Assistant owner is required."
    : code === "history_limit" ? "This conversation reached its bounded history limit. Start a new current conversation explicitly."
    : failure(code, id).error.message } });
type History = z.infer<typeof AssistantHistorySchema>;
export type AssistantAskSuccess = Readonly<{ status: "success"; envelope: z.infer<typeof AssistantEnvelopeSchema>; source: AssistantContext["source"]; context_digest: string; history: History }>;
declare const conversationBrand: unique symbol;
export type AssistantConversation = { readonly [conversationBrand]: true };

/** Strict builder: real current issued context; original owner-supplied history.
 * No HTTP/import input or unsafe cast into InvocationInput. */
function prepareAssistantAsk(context: AssistantContext, history: unknown, questionInput: unknown): { ok: true; request: InvocationInput } | { ok: false; code: FailureCode | LocalCode } {
  try {
    if (!isCurrentAssistantContext(context)) return { ok: false, code: "source_changed" };
    const q = AssistantAskRequestSchema.safeParse(questionInput), h = AssistantHistorySchema.safeParse(history);
    if (!q.success || !h.success || !isDeepStrictEqual(q.data, questionInput) || !isDeepStrictEqual(h.data, history) || h.data.session_id !== context.source.session_id || h.data.context_digest !== digest(context) || bytes(history) > MAX_ASSISTANT_HISTORY_BYTES) return { ok: false, code: "invalid_input" };
    if (h.data.turns.length >= MAX_ASSISTANT_TURNS) return { ok: false, code: "history_limit" };
    if (h.data.turns.some(t => !inspectAssistantAnswer(t.envelope.data, context))) return { ok: false, code: "invalid_input" };
    const payload = AssistantAskPayloadSchema.safeParse({ ...q.data, context, history: h.data }); if (!payload.success) return { ok: false, code: "invalid_input" };
    const built = InvocationSchema.safeParse({ module: "assistant", prompt_version: ASSISTANT_PROMPT_VERSION, system: ASSISTANT_SYSTEM_PROMPT,
      context: { deal: context.deal, assistant: payload.data }, allowed_source_ids: [] });
    if (!built.success) return { ok: false, code: "invalid_input" };
    if (bytes({ input: built.data, schema: z.toJSONSchema(AssistantAnswerSchema) }) > MAX_INPUT_BYTES) return { ok: false, code: "request_too_large" };
    return isCurrentAssistantContext(context) ? { ok: true, request: freezeCSE(built.data) } : { ok: false, code: "source_changed" };
  } catch { return { ok: false, code: "invalid_input" }; }
}

/** Validation only, never a provenance/ownership grant. Router metadata must match
 * server UUID, exact request+reference digest and configured route identity. */
export function validateAssistantEnvelope(value: unknown, request: InvocationInput, context: AssistantContext, requestId: string, rawPolicy: unknown) {
  try {
    if (!isCurrentAssistantContext(context) || bytes(value) > MAX_OUTPUT_BYTES) return null;
    const p = AssistantEnvelopeSchema.safeParse(value), policy = ControlPolicySchema.safeParse(rawPolicy);
    if (!p.success || !isDeepStrictEqual(p.data, value) || !policy.success || !policy.data.enabled || !request.context.assistant ||
      !isDeepStrictEqual(request.context.assistant.context, context) || p.data.request_id !== requestId ||
      p.data.input_digest !== digest({ input: request, references: { allow_empty: true, duplicates: "reject" } })) return null;
    const r = p.data, configured = policy.data[r.mode];
    if ((r.mode === "paid" && !policy.data.paid_enabled) || (r.mode === "fallback" && !policy.data.fallback_enabled) ||
      r.model_provider !== configured.model_provider || r.model_id !== configured.model_id ||
      (r.mode === "fallback" && r.routing_reason !== (policy.data.paid_enabled ? "budget_exhausted" : "paid_unavailable")) ||
      !inspectAssistantAnswer(r.data, context) || !validateAssistantReferences(context, r.data.citations).ok) return null;
    return isCurrentAssistantContext(context) ? freezeCSE(r) : null;
  } catch { return null; }
}

/** Protected per-tab/session owner. Explicit ask() is the only dispatch path;
 * no public route, storage, tool actions, effects, retries or automatic invocation. */
export function createAssistantAskOwner(options: Parameters<typeof createAIRouter>[0] = {}) {
  const invoke = createAIRouter(options);
  type State = { read: AssistantSourceReader; context: AssistantContext; history: History; revoked: boolean; busy: boolean };
  const conversations = new WeakMap<AssistantConversation, State>(), results = new WeakMap<object, State>();
  function current(s: State): boolean {
    if (s.revoked) return false;
    try { const latest = buildAssistantContext(s.read); if (!latest.ok || !isCurrentAssistantContext(s.context) || !isDeepStrictEqual(latest.context, s.context)) { s.revoked = true; return false; } return true; }
    catch { s.revoked = true; return false; }
  }
  function createConversation(read: AssistantSourceReader) {
    const id = randomUUID(), built = buildAssistantContext(read); if (!built.ok) return error(built.code, id);
    const history = AssistantHistorySchema.parse({ contract_version: "assistant/history/v1", conversation_id: id, session_id: built.context.source.session_id, context_digest: digest(built.context), turns: [] });
    const conversation = Object.freeze({}) as AssistantConversation;
    conversations.set(conversation, { read, context: built.context, history: freezeCSE(history), revoked: false, busy: false });
    return { status: "ready" as const, conversation, history };
  }
  async function ask(conversation: AssistantConversation, request: unknown, caller: unknown): Promise<AssistantAskSuccess | ReturnType<typeof error>> {
    const requestId = randomUUID(), s = conversation && conversations.get(conversation);
    if (!s) return error("invalid_conversation", requestId); if (!current(s)) return error("source_changed", requestId);
    if (s.busy) return error("capacity_reached", requestId);
    const identity = z.strictObject({ client_key: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(caller); if (!identity.success) return error("controls_unavailable", requestId);
    const built = prepareAssistantAsk(s.context, s.history, request); if (!built.ok) return error(built.code, requestId);
    const wire = built.request.context.assistant; if (!wire) return error("invalid_input", requestId);
    s.busy = true;
    try {
      if (!current(s)) return error("source_changed", requestId);
      const result = await invoke(built.request, ASSISTANT_OUTPUT_CONTRACT, { ...identity.data, request_id: requestId });
      if (!current(s)) return error("source_changed", requestId); // Bracket router's entire provider/store/settlement await.
      if (!result.ok) return error(result.error.code, requestId);
      const envelope = validateAssistantEnvelope(result.result, built.request, s.context, requestId, options.policy);
      if (!envelope) return error("invalid_model_output", requestId);
      const next = AssistantHistorySchema.safeParse({ ...s.history, turns: [...s.history.turns, { question: wire.question, envelope }] });
      if (!next.success || bytes(next.data) > MAX_ASSISTANT_HISTORY_BYTES) return error("history_limit", requestId);
      if (!current(s)) return error("source_changed", requestId);
      s.history = freezeCSE(next.data);
      const accepted = freezeCSE({ status: "success" as const, envelope, source: structuredClone(s.context.source), context_digest: digest(s.context), history: s.history });
      results.set(accepted, s); return accepted;
    } catch { return error("unexpected_error", requestId); }
    finally { s.busy = false; }
  }
  return Object.freeze({ createConversation, ask,
    getHistory: (conversation: AssistantConversation) => { const s = conversation && conversations.get(conversation); return s && current(s) ? s.history : null; },
    isCurrent: (result: unknown) => { const s = result && typeof result === "object" ? results.get(result) : null; return !!s && current(s); },
  });
}
