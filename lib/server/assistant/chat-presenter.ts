import "server-only";
import { isDeepStrictEqual } from "node:util";
import { buildAssistantContext, isCurrentAssistantContext } from "./context.ts";
import type { AssistantSourceReader } from "./context.ts";
import type { createAssistantAskOwner, AssistantConversation, AssistantAskSuccess } from "./ask.ts";
import { AssistantHistorySchema } from "./ask-schema.ts";
import { freezeCSE } from "../../cost-synergy/calculation-contract.ts";
import { validChatView } from "../../ai-assistant/chat-view.ts";
import type { AssistantChatSource, ChatAvailability, ChatView, ChatErrorCode } from "../../ai-assistant/chat-view.ts";

/** Additive in-memory presenter seam, not an endpoint/serialized bridge. Caller
 * identity and actual opaque conversation handles NEVER leave this closure. */
export function createAssistantChatSource(owner: ReturnType<typeof createAssistantAskOwner>, read: AssistantSourceReader,
  caller: { client_key: string }, subscribe: (notify: () => void) => () => void): AssistantChatSource {
  let binding = buildAssistantContext(read), conversation: AssistantConversation | null = null, results: AssistantAskSuccess[] = [], generation = 0, busy = false;
  let snapshot: ChatAvailability = binding.ok ? issue({ turns: [], history_bytes: 2 }) : Object.freeze({ state: "unavailable" });
  function issue(view: ChatView): ChatAvailability { return freezeCSE({ state: "ready" as const, view: structuredClone(view) }); }
  function stale() { generation++; conversation = null; results = []; busy = false; snapshot = Object.freeze({ state: "outdated" }); }
  function getSnapshot(): ChatAvailability {
    try {
      if (snapshot.state === "ready" && (!binding.ok || !isCurrentAssistantContext(binding.context) || results.some(r => !owner.isCurrent(r)))) stale();
      if (snapshot.state === "ready" && conversation && !owner.getHistory(conversation)) stale();
    } catch { stale(); }
    return snapshot;
  }
  function isCurrent(view: unknown) { const now = getSnapshot(); return now.state === "ready" && now.view === view && validChatView(view); }
  return Object.freeze({ getSnapshot, isCurrent,
    subscribe: (notify: () => void) => subscribe(() => { getSnapshot(); notify(); }),
    matchesSession: (session: unknown) => { try { return getSnapshot().state === "ready" && !!session && isDeepStrictEqual(read()?.session, session); } catch { return false; } },
    reset: () => { generation++; conversation = null; results = []; busy = false; binding = buildAssistantContext(read); snapshot = binding.ok ? issue({ turns: [], history_bytes: 2 }) : Object.freeze({ state: "unavailable" }); },
    ask: async (question: string): Promise<{ status: "success" } | { status: "error"; code: ChatErrorCode }> => {
      if (getSnapshot().state !== "ready") return { status: "error", code: "source_changed" };
      if (busy) return { status: "error", code: "capacity_reached" }; busy = true; const ticket = generation;
      try {
        if (!conversation) { const opened = owner.createConversation(read); if (opened.status !== "ready") return { status: "error", code: opened.error.code }; conversation = opened.conversation; }
        const current = conversation, result = await owner.ask(current, { contract_version: "assistant/ask/v1", question }, caller);
        if (ticket !== generation || current !== conversation || getSnapshot().state !== "ready") return { status: "error", code: "source_changed" };
        if (result.status === "error") return { status: "error", code: result.error.code };
        const history = owner.getHistory(current), parsed = AssistantHistorySchema.safeParse(history);
        if (!owner.isCurrent(result) || !parsed.success || !isDeepStrictEqual(parsed.data, history) || !isDeepStrictEqual(history, result.history)) return { status: "error", code: "invalid_model_output" };
        const view: ChatView = { history_bytes: new TextEncoder().encode(JSON.stringify(history)).length,
          turns: parsed.data.turns.map(t => ({ question: t.question, answer: t.envelope.data,
            provenance: { model_provider: t.envelope.model_provider, model_id: t.envelope.model_id, mode: t.envelope.mode, ...(t.envelope.routing_reason ? { routing_reason: t.envelope.routing_reason } : {}), generated_at: t.envelope.generated_at, prompt_version: t.envelope.prompt_version } })) };
        if (!validChatView(view)) return { status: "error", code: "invalid_model_output" };
        results.push(result); snapshot = issue(view); return { status: "success" };
      } catch { return { status: "error", code: "unexpected_error" }; }
      finally { if (ticket === generation) busy = false; }
    },
  }) as AssistantChatSource;
}
