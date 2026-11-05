"use client";

import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { useDemoSession } from "../demo-session-provider";
import { createAssistantChatController, canAskChat } from "../../lib/ai-assistant/chat-controller";
import { citationLabel, SECTION_LABELS } from "../../lib/ai-assistant/chat-view";
import type { AssistantChatSource } from "../../lib/ai-assistant/chat-view";

/** Production supplies no source. No JSON/current=true grant or server owner
 * handle is accepted. Populated tests use a separate loopback harness only. */
export function AssistantWorkspace({ source = null }: { source?: AssistantChatSource | null }) {
  const { getSnapshot, session } = useDemoSession();
  // Session provider updates rerender this wrapper; the controller reads the actual
  // latest snapshot on every action/read rather than retaining a render closure.
  void session;
  const controller = useMemo(() => createAssistantChatController(source, () => getSnapshot().session), [source, getSnapshot]);
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot), id = useId(), composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const submitting = s.phase === "submitting";
  const alert = !!s.error && s.phase !== "history_limit";
  return <section className="assistant-workspace" aria-label="AI M&A Assistant workspace">
    <div className="assistant-intro"><span className="badge">Synthetic transaction · AI drafts are unapproved</span>
      <h2>Ask about the current fictional transaction</h2>
      <p>Prepare a question about the available applications, license findings, financial assumptions, TSA services or Playbook. AI responses are illustrative drafts, not transaction advice or approved decisions.</p>
      <p id={`${id}-availability`} className="assistant-availability">{s.available ? "Protected presentation controller connected. Only current owner-validated results can appear here." : source ? "Protected Ask is unavailable for this conversation. Read the status below or Reset chat; no current answer is authorized." : "AI not enabled. Protected per-tab Ask delivery is not connected in this public preview. No live request or answer is available."}</p>
      <p>Use fictional information only. Chat stays in memory for this open workspace only. Original AI findings and visitor proposals remain distinct; the Assistant cannot change transaction records or run other modules.</p>
    </div>
    <div className="assistant-status" data-chat-phase={s.phase} role={alert ? "alert" : "status"} aria-live={alert ? undefined : "polite"} aria-atomic="true">{s.message}</div>
    <section className="assistant-conversation" aria-label="Conversation" aria-busy={submitting}>
      <div className="assistant-conversation-header"><h3>Conversation</h3><span>{s.view?.turns.length ?? 0} / 4 exchanges</span></div>
      {!s.view?.turns.length ? <p className="assistant-empty">No Assistant answers have been generated in this conversation.</p> : <ol className="assistant-transcript">
        {s.view.turns.map((turn, index) => <li key={index}>
          <article className="assistant-question" aria-label={`Your question ${index + 1}`}><h4>Your question {index + 1}</h4><p>{turn.question}</p></article>
          <article className="assistant-answer" aria-label={`Assistant response ${index + 1}`}>
            <h4>Assistant · {turn.answer.status === "insufficient_evidence" ? "Insufficient evidence" : "AI-generated draft"}</h4>
            <p className="assistant-answer-text">{turn.answer.answer}</p>
            <p className="assistant-provenance">{turn.provenance.mode === "paid" ? "Paid model" : "Open-weight fallback"} · Provider: {turn.provenance.model_provider} · Model: {turn.provenance.model_id}</p>
            {turn.provenance.mode === "fallback" && <p>{turn.provenance.routing_reason === "budget_exhausted" ? "The paid allowance could not cover this request." : "The paid route was disabled by policy."} The independent fallback answered; results may differ.</p>}
            <p className="assistant-provenance">Generated {turn.provenance.generated_at} · Prompt {turn.provenance.prompt_version}</p>
            <p>Illustrative / unapproved. Citation membership does not verify narrative accuracy, confidence, legal conclusions or financial benefits.</p>
            {turn.answer.missing_context.length > 0 && <div className="assistant-warning"><h5>Missing or incomplete evidence</h5><ul>{turn.answer.missing_context.map((m, i) => <li key={i}>{SECTION_LABELS[m.section]}: {m.state}</li>)}</ul></div>}
            <h5>Source references</h5>{turn.answer.citations.length ? <ul className="assistant-citations">{turn.answer.citations.map((r, i) => <li key={i}>{citationLabel(r)}</li>)}</ul> : <p>No citations supplied for this insufficient-evidence response.</p>}
          </article>
        </li>)}
      </ol>}
    </section>
    <form className="assistant-composer" noValidate aria-label="Ask an M&A question" onSubmit={e => { e.preventDefault(); void controller.submit().then(() => { composer.current?.focus(); }); }}>
      <label htmlFor={`${id}-question`}>Your M&A question</label>
      <p id={`${id}-guidance`}>Maximum 2,000 characters. Enter adds a line; use Ask explicitly. Text over the limit is flagged, never shortened.</p>
      <textarea ref={composer} id={`${id}-question`} name="assistant_question" value={s.question} rows={5} disabled={submitting} aria-invalid={!!s.validation} aria-describedby={`${id}-guidance ${id}-count ${id}-availability${s.validation ? ` ${id}-error` : ""}`} onChange={e => controller.setQuestion(e.currentTarget.value)} />
      <p id={`${id}-count`} className="assistant-count">{s.question.length.toLocaleString("en-CA")} / 2,000 characters</p>
      {s.validation && <p id={`${id}-error`} className="assistant-validation" role="status">{s.validation}</p>}
      <div className="assistant-actions"><button type="submit" className="button button-primary" disabled={!canAskChat(s)} aria-describedby={`${id}-availability`}>{submitting ? "Asking…" : "Ask Assistant"}</button>
        <button type="button" className="button button-secondary" onClick={() => { controller.reset(); composer.current?.focus(); }}>Reset chat</button></div>
      <p className="assistant-footnote">Reset clears only this chat and prepared question. It does not reset the synthetic deal. History is limited to four exchanges and 32,000 UTF-8 bytes; larger requests may be refused by the existing gateway.</p>
    </form>
  </section>;
}
