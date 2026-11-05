import { AI_ERROR_COPY } from "../ai/ai-view-state.ts";
import { questionError, validChatView } from "./chat-view.ts";
import type { AssistantChatSource, ChatView, ChatErrorCode } from "./chat-view.ts";
import type { DemoSession } from "../session/session.ts";

export type ChatPhase = "initial" | "ready" | "invalid_question" | "submitting" | "answered" | "insufficient_evidence" | "error" | "ai_disabled" | "stale" | "history_limit" | "reset_completed";
export type ChatState = Readonly<{ phase: ChatPhase; question: string; validation: string | null; available: boolean; view: ChatView | null; message: string; error: ChatErrorCode | null }>;
const unavailable = "Ask is unavailable: protected per-tab delivery is not connected and live AI is disabled. You can prepare a question; no request is sent.";
const initial = (): ChatState => ({ phase: "initial", question: "", validation: null, available: false, view: null, message: unavailable, error: null });
function safeError(code: ChatErrorCode): string {
  return code === "source_changed" ? "Context changed. Previous answers are no longer current. Reset chat before asking about the current transaction."
    : code === "invalid_conversation" ? "This conversation is unavailable. Reset chat to require a new protected conversation."
    : code === "history_limit" ? "Conversation limit reached. Reset chat to start a new protected conversation; no history is truncated."
    : Object.hasOwn(AI_ERROR_COPY, code) ? AI_ERROR_COPY[code as keyof typeof AI_ERROR_COPY] : AI_ERROR_COPY.unexpected_error;
}
export function canAskChat(s: ChatState): boolean {
  return s.available && !questionError(s.question) && !["submitting", "stale", "history_limit", "ai_disabled"].includes(s.phase) && !["history_limit", "ai_disabled", "ai_not_enabled", "ai_controls_not_ready", "controls_unavailable"].includes(s.error ?? "") && (s.view?.turns.length ?? 0) < 4;
}
/** Mounted presentation state only. No network, persistence, inference or source
 * mutation. Source functions are protected composition, not visitor JSON flags. */
export function createAssistantChatController(source: AssistantChatSource | null, readSession: () => DemoSession | null) {
  let state = initial(), epoch = 0, disposed = false, blocked = false, stamp: string | null = null, unsubscribeSource: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(n => n());
  function invalidate(code: "source_changed" | "invalid_model_output") {
    if (!blocked) { epoch++; blocked = true; state = { ...state, phase: code === "source_changed" ? "stale" : "error", question: "", validation: null, available: false, view: null, error: code, message: safeError(code) }; }
  }
  function refresh() {
    if (disposed || blocked) return;
    try {
      const session = readSession(), nextStamp = session ? JSON.stringify(session) : null;
      if (stamp !== null && nextStamp !== stamp) { invalidate("source_changed"); return; } if (nextStamp !== null) stamp = nextStamp;
      if (!source) { if (state.phase === "initial") state = { ...state, phase: "ai_disabled", message: unavailable }; return; }
      if (!session) return;
      const snapshot = source.getSnapshot();
      if (snapshot.state === "outdated") { invalidate("source_changed"); return; }
      if (snapshot.state === "invalid") { invalidate("invalid_model_output"); return; }
      if (snapshot.state === "unavailable") { if (state.available || state.phase === "initial") state = { ...state, phase: "ai_disabled", available: false, view: null, message: unavailable }; return; }
      if (snapshot.state !== "ready") { invalidate("invalid_model_output"); return; }
      if (!validChatView(snapshot.view) || !source.isCurrent(snapshot.view)) { invalidate("invalid_model_output"); return; }
      if (!source.matchesSession(session)) { invalidate("source_changed"); return; }
      if (state.view !== snapshot.view || !state.available) {
        const phase = state.phase === "initial" ? "ready" : state.phase;
        state = { ...state, available: true, view: snapshot.view, phase, message: phase === "ready" ? "Protected presentation source connected. Ask starts only with your explicit action; AI drafts remain unapproved." : state.message };
      }
    } catch { invalidate("invalid_model_output"); }
  }
  function connect() { if (!unsubscribeSource && source) try { unsubscribeSource = source.subscribe(() => { refresh(); emit(); }); } catch { invalidate("invalid_model_output"); } }
  const getSnapshot = () => { refresh(); return state; };
  return {
    getSnapshot, getServerSnapshot: () => state,
    subscribe: (notify: () => void) => { listeners.add(notify); connect(); return () => { listeners.delete(notify); if (!listeners.size) { unsubscribeSource?.(); unsubscribeSource = null; } }; },
    activate: () => { if (disposed) { disposed = false; blocked = false; stamp = null; state = initial(); refresh(); emit(); } },
    setQuestion: (question: string) => { refresh(); if (disposed || state.phase === "submitting") return;
      const validation = questionError(question); state = { ...state, question, validation, phase: blocked ? state.phase : validation ? "invalid_question" : state.available ? "ready" : "ai_disabled" }; emit(); },
    submit: async (): Promise<boolean> => {
      refresh(); if (disposed || blocked || state.phase === "submitting") return false;
      const validation = questionError(state.question); if (validation) { state = { ...state, phase: "invalid_question", validation }; emit(); return false; }
      if (!canAskChat(state) || !source) return false;
      const ticket = ++epoch, question = state.question, previous = state.view; state = { ...state, phase: "submitting", validation: null, message: "Submitting your explicit question through the protected owner. No answer is available yet.", error: null }; emit();
      try {
        const result = await source.ask(question); if (disposed || ticket !== epoch) return false;
        refresh(); if (blocked || ticket !== epoch) { emit(); return false; }
        if (!result || result.status !== "success") {
          const code = result?.status === "error" && typeof result.code === "string" && (Object.hasOwn(AI_ERROR_COPY, result.code) || ["source_changed", "invalid_conversation", "history_limit"].includes(result.code)) ? result.code : "unexpected_error";
          if (code === "source_changed" || code === "invalid_conversation") { invalidate("source_changed"); emit(); return false; }
          state = { ...state, phase: code === "history_limit" ? "history_limit" : ["ai_disabled", "ai_not_enabled", "ai_controls_not_ready", "controls_unavailable"].includes(code) ? "ai_disabled" : "error", message: safeError(code), error: code }; emit(); return false;
        }
        const view = state.view, last = view?.turns.at(-1);
        if (!view || !last || view.turns.length !== (previous?.turns.length ?? 0) + 1 || JSON.stringify(view.turns.slice(0, -1)) !== JSON.stringify(previous?.turns ?? []) || last.question !== question || !source.isCurrent(view)) { invalidate("invalid_model_output"); emit(); return false; }
        state = { ...state, question: "", validation: null, phase: view.turns.length >= 4 ? "history_limit" : last.answer.status,
          message: view.turns.length >= 4 ? safeError("history_limit") : last.answer.status === "insufficient_evidence" ? "Insufficient evidence. Read the unavailable information and limitations in this AI draft." : "Answer received. This unapproved AI draft is not transaction advice.", error: null }; emit(); return true;
      } catch { if (!disposed && ticket === epoch) { state = { ...state, phase: "error", error: "unexpected_error", message: AI_ERROR_COPY.unexpected_error }; emit(); } return false; }
    },
    reset: () => {
      if (disposed) return; epoch++; blocked = false; stamp = null;
      try { source?.reset(); state = { ...initial(), phase: "reset_completed", message: "Conversation cleared. A new protected conversation is required for the next Ask. Transaction data is unchanged." }; refresh(); }
      catch { state = { ...initial(), phase: "error", message: AI_ERROR_COPY.unexpected_error, error: "unexpected_error" }; blocked = true; }
      emit();
    },
    dispose: () => { if (disposed) return; epoch++; disposed = true; unsubscribeSource?.(); unsubscribeSource = null; try { source?.reset(); } catch { /* No answer survives unmount. */ } state = initial(); listeners.clear(); },
  };
}
