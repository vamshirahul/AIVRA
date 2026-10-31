import { createElement as h } from "react";
import { presentAIState } from "../../lib/ai/ai-view-state.ts";
import type { AIViewState } from "../../lib/ai/ai-view-state.ts";

/** Read-only and usable from server shells or future client callers. No effects or actions. */
export function AIStatusNotice({ state }: { state: AIViewState }) {
  const notice = presentAIState(state);
  return h("div", { className: `ai-notice ai-notice--${notice.tone}`, role: notice.role,
    "aria-live": notice.role === "status" ? "polite" : undefined,
    "aria-atomic": notice.role ? true : undefined },
  h("p", { className: "ai-notice-title" }, notice.title),
  h("p", null, notice.message),
  notice.modelLabel && h("p", { className: "ai-notice-model" }, notice.modelLabel),
  notice.stale && h("p", { className: "ai-notice-stale" }, notice.stale));
}
