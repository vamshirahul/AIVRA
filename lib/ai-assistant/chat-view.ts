// Browser-safe presentation only. Backend contract imports are erased.
import type { AssistantAnswer } from "../server/assistant/ask-schema.ts";
import type { AssistantAskSuccess } from "../server/assistant/ask.ts";
import type { DemoSession } from "../session/session.ts";
import type { FailureCode } from "../server/ai/base-contracts.ts";

export type ChatTurn = Readonly<{ question: string; answer: AssistantAnswer;
  provenance: Pick<AssistantAskSuccess["envelope"], "model_provider" | "model_id" | "mode" | "routing_reason" | "generated_at" | "prompt_version"> }>;
export type ChatView = Readonly<{ turns: readonly ChatTurn[]; history_bytes: number }>;
export type ChatAvailability = Readonly<{ state: "ready"; view: ChatView } | { state: "unavailable" | "outdated" | "invalid" }>;
export type ChatErrorCode = FailureCode | "source_changed" | "invalid_conversation" | "history_limit";
declare const protectedChatSource: unique symbol;
/** In-memory protected composition, NOT serialized authorization or a browser
 * bridge. Only an authoritative owner (or isolated offline harness) supplies it. */
export type AssistantChatSource = Readonly<{ [protectedChatSource]: true;
  getSnapshot: () => ChatAvailability; subscribe: (notify: () => void) => () => void;
  isCurrent: (view: unknown) => boolean; matchesSession: (session: DemoSession | null) => boolean;
  ask: (question: string) => Promise<{ status: "success" } | { status: "error"; code: ChatErrorCode }>;
  reset: () => void;
}>;
export const SECTION_LABELS = { deal: "Synthetic deal", ala: "Original AI ALA findings", ala_review: "Visitor ALA review", license_findings: "Original AI license findings",
  assumptions: "Visitor financial assumptions", playbook: "Original AI Playbook", playbook_review: "Visitor Playbook review" } as const;
export function questionError(value: string): string | null {
  return value.length > 2000 ? "Use at most 2,000 characters. Your text has not been shortened." : !value.trim() ? "Enter a question about the fictional transaction."
    : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? "Remove unsupported control characters from the question." : null;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const sourceId = (v: unknown) => typeof v === "string" && /^\S{1,128}$/.test(v);
const localId = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
export function validChatCitation(v: unknown): v is AssistantAnswer["citations"][number] {
  if (!object(v)) return false;
  switch (v.kind) {
    case "section": return keys(v, ["kind", "section"]) && typeof v.section === "string" && Object.hasOwn(SECTION_LABELS, v.section);
    case "application": return keys(v, ["kind", "app_id", "side"]) && sourceId(v.app_id) && typeof v.side === "string" && ["buyer", "target"].includes(v.side);
    case "license": return keys(v, ["kind", "license_id", "app_id"]) && sourceId(v.license_id) && sourceId(v.app_id);
    case "tsa": return keys(v, ["kind", "tsa_id"]) && sourceId(v.tsa_id);
    case "ala_finding": case "license_finding": return keys(v, ["kind", "finding_id"]) && localId(v.finding_id);
    case "ala_action": return keys(v, ["kind", "finding_id", "action_id"]) && localId(v.finding_id) && localId(v.action_id);
    case "assumption": return keys(v, ["kind", "line_id"]) && localId(v.line_id);
    case "playbook_phase": case "playbook_activity": case "playbook_milestone": case "playbook_risk": return keys(v, ["kind", "id"]) && localId(v.id);
    default: return false;
  }
}
export function citationLabel(r: AssistantAnswer["citations"][number]): string {
  switch (r.kind) {
    case "section": return SECTION_LABELS[r.section];
    case "application": return `${r.side === "buyer" ? "Buyer" : "Target"} application · ${r.app_id}`;
    case "license": return `License · ${r.license_id} · Application ${r.app_id}`;
    case "tsa": return `TSA service · ${r.tsa_id}`;
    case "ala_finding": return `ALA finding · ${r.finding_id}`;
    case "ala_action": return `ALA action · ${r.action_id} · Finding ${r.finding_id}`;
    case "license_finding": return `License finding · ${r.finding_id}`;
    case "assumption": return `Financial assumption · ${r.line_id}`;
    default: return `${r.kind.replace("playbook_", "Playbook ")} · ${r.id}`;
  }
}
/** Supplemental display rejection only; shape/bytes NEVER grant source authority.
 * Owner issuance, membership/currentness and original history remain server-owned. */
export function validChatView(value: unknown): value is ChatView {
  try {
    if (!object(value) || !keys(value, ["turns", "history_bytes"]) || !Number.isInteger(value.history_bytes) || Number(value.history_bytes) < 0 || Number(value.history_bytes) > 32000 || !Array.isArray(value.turns) || value.turns.length > 4) return false;
    if (new TextEncoder().encode(JSON.stringify(value.turns)).length > Number(value.history_bytes)) return false;
    return value.turns.every(t => {
      if (!object(t) || !keys(t, ["question", "answer", "provenance"]) || typeof t.question !== "string" || questionError(t.question) || !object(t.answer) || !object(t.provenance)) return false;
      const a = t.answer, p = t.provenance;
      if (!keys(a, ["contract_version", "status", "answer", "citations", "missing_context", "illustrative_unapproved", "narrative_not_verified"]) || a.contract_version !== "assistant/answer/v1" || typeof a.status !== "string" || !["answered", "insufficient_evidence"].includes(a.status) || typeof a.answer !== "string" || !a.answer.trim() || a.answer.length > 4000 || a.illustrative_unapproved !== true || a.narrative_not_verified !== true || !Array.isArray(a.citations) || a.citations.length > 20 || !a.citations.every(validChatCitation) || a.status === "answered" && !a.citations.length) return false;
      const canonical = a.citations.map(c => JSON.stringify(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)))); if (new Set(canonical).size !== canonical.length) return false;
      if (!Array.isArray(a.missing_context) || a.missing_context.length > 7 || !a.missing_context.every(m => object(m) && keys(m, ["section", "state"]) && typeof m.section === "string" && Object.hasOwn(SECTION_LABELS, m.section) && typeof m.state === "string" && ["absent", "outdated", "invalid", "unavailable", "incomplete"].includes(m.state))) return false;
      return keys(p, ["model_provider", "model_id", "mode", "generated_at", "prompt_version", ...(p.mode === "fallback" ? ["routing_reason"] : [])]) && typeof p.model_provider === "string" && /^[a-z0-9.-]{1,64}$/.test(p.model_provider) && typeof p.model_id === "string" && /^[a-zA-Z0-9._:/-]{1,128}$/.test(p.model_id) && p.prompt_version === "assistant/v1" && typeof p.generated_at === "string" && /^\d{4}-\d\d-\d\dT.*Z$/.test(p.generated_at) && Number.isFinite(Date.parse(p.generated_at)) &&
        (p.mode === "paid" || p.mode === "fallback" && ["budget_exhausted", "paid_unavailable"].includes(String(p.routing_reason)));
    });
  } catch { return false; }
}
