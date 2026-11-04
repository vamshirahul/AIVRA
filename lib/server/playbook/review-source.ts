import "server-only";
import { isDeepStrictEqual } from "node:util";
import { PlaybookOutcomeSchema } from "./generate.ts";
import type { createPlaybookGenerator, PlaybookSourceReader } from "./generate.ts";
import { freezePlaybook } from "../../playbook-generator/review-draft.ts";
import type { PlaybookReviewSource, PlaybookReviewView } from "../../playbook-generator/review-draft.ts";

/** Protected in-memory composition ONLY. No endpoint or serialized grant. A real
 * owner must notify for every review/scenario/source/result change, not just revisions.
 */
export function createPlaybookReviewSource(owner: Pick<ReturnType<typeof createPlaybookGenerator>, "isCurrent">, outcome: unknown,
  readSource: PlaybookSourceReader, subscribe: (notify: () => void) => () => void): PlaybookReviewSource {
  let snapshot: PlaybookReviewView = Object.freeze({ state: "invalid" });
  try {
    if (typeof subscribe === "function" && owner.isCurrent(outcome, readSource)) {
      const parsed = PlaybookOutcomeSchema.safeParse(outcome), latest = readSource();
      if (parsed.success && parsed.data.status !== "error" && isDeepStrictEqual(parsed.data, outcome) && latest && owner.isCurrent(outcome, readSource)) snapshot = freezePlaybook({ state: parsed.data.status === "success" ? "current" : "incomplete", data: { original: parsed.data, selected_scenario: latest.selected_scenario } });
    }
  } catch { /* Invalid protected composition never grants an editor. */ }
  function getSnapshot(): PlaybookReviewView {
    try { if ("data" in snapshot && !owner.isCurrent(outcome, readSource)) snapshot = Object.freeze({ state: "outdated" }); }
    catch { snapshot = Object.freeze({ state: "invalid" }); }
    return snapshot;
  }
  return Object.freeze({ getSnapshot, subscribe: (notify: () => void) => subscribe(() => { getSnapshot(); notify(); }) }) as PlaybookReviewSource;
}
