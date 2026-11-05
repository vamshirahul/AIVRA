import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AssistantContextSchema, AssistantReferencesSchema } from "./schema.ts";
import { resultEnvelopeSchema } from "../ai/base-contracts.ts";

export const ASSISTANT_PROMPT_VERSION = "assistant/v1" as const;
export const MAX_ASSISTANT_TURNS = 4;
export const MAX_ASSISTANT_HISTORY_BYTES = 32_000;
const Question = z.string().min(1).max(2_000).refine(v => !!v.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), "A nonblank bounded question is required");
export const AssistantAskRequestSchema = z.strictObject({ contract_version: z.literal("assistant/ask/v1"), question: Question });
const Answer = z.string().min(1).max(4_000).refine(v => !!v.trim());
export const AssistantAnswerSchema = z.strictObject({ contract_version: z.literal("assistant/answer/v1"), status: z.enum(["answered", "insufficient_evidence"]),
  answer: Answer, citations: AssistantReferencesSchema.max(20),
  missing_context: AssistantContextSchema.shape.missing_context,
  illustrative_unapproved: z.literal(true), narrative_not_verified: z.literal(true),
}).superRefine((v, ctx) => { if (v.status === "answered" && !v.citations.length) ctx.addIssue({ code: "custom", message: "An answer requires supported citations" }); });
export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;
export const AssistantEnvelopeSchema = resultEnvelopeSchema(AssistantAnswerSchema).superRefine((v, ctx) => {
  if (v.module !== "assistant" || v.prompt_version !== ASSISTANT_PROMPT_VERSION) ctx.addIssue({ code: "custom", message: "Assistant provenance mismatch" });
});
export const AssistantHistorySchema = z.strictObject({ contract_version: z.literal("assistant/history/v1"), conversation_id: z.uuid(),
  session_id: z.uuid(), context_digest: z.string().regex(/^[a-f0-9]{64}$/),
  turns: z.array(z.strictObject({ question: Question, envelope: AssistantEnvelopeSchema })).max(MAX_ASSISTANT_TURNS),
});
export const AssistantAskPayloadSchema = z.strictObject({ contract_version: z.literal("assistant/ask/v1"), context: AssistantContextSchema,
  question: Question, history: AssistantHistorySchema,
}).refine(v => v.history.turns.length < MAX_ASSISTANT_TURNS, "Conversation history is full");
export type AssistantAskPayload = z.infer<typeof AssistantAskPayloadSchema>;
/** Structured membership only; issued context ownership is independently checked
 * by the protected Ask owner before/after the guarded router await. */
export function inspectAssistantAnswer(answer: unknown, context: z.infer<typeof AssistantContextSchema>): boolean {
  const p = AssistantAnswerSchema.safeParse(answer); if (!p.success || !isDeepStrictEqual(p.data, answer) || !isDeepStrictEqual(p.data.missing_context, context.missing_context)) return false;
  const known = context.allowed_references, refs = p.data.citations;
  return refs.every((r, i) => known.some(k => isDeepStrictEqual(k, r)) && !refs.slice(0, i).some(k => isDeepStrictEqual(k, r)));
}
