"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useDemoSession } from "../demo-session-provider";
import { AIStatusNotice } from "../ai/ai-status-notice";
import { PlaybookReviewWorkspace } from "./playbook-review-workspace";

const Unavailable = z.strictObject({ status: z.literal("error"), error: z.strictObject({ code: z.literal("ai_controls_not_ready"), request_id: z.null(), message: z.string().min(1).max(160) }) });
type View = "not_enabled" | "checking" | "unavailable" | "failed";
export function GeneratePlaybook() {
  const { session, ready } = useDemoSession();
  const [view, setView] = useState<View>("not_enabled");
  const pending = useRef<AbortController | null>(null), generation = useRef(0);
  const source = useRef({ id: session?.session_id, revision: session?.session_revision });
  source.current = { id: session?.session_id, revision: session?.session_revision };
  useEffect(() => {
    generation.current++; pending.current?.abort(); pending.current = null; setView("not_enabled");
    return () => { generation.current++; pending.current?.abort(); pending.current = null; };
  }, [session?.session_id, session?.session_revision]);
  async function checkAvailability() {
    if (!ready || !session || pending.current) return;
    const captured = { ...source.current }, ticket = ++generation.current, abort = new AbortController(); pending.current = abort;
    const current = () => ticket === generation.current && captured.id === source.current.id && captured.revision === source.current.revision;
    const timeout = setTimeout(() => abort.abort(), 10_000); setView("checking");
    try {
      // No body, deal context, trusted-result claim, model choice or authorization.
      const response = await fetch("/api/ai/playbook", { method: "POST", cache: "no-store", credentials: "omit", signal: abort.signal });
      const text = await response.text(); const parsed = text.length <= 1024 ? Unavailable.safeParse(JSON.parse(text)) : null;
      if (current()) setView(response.status === 503 && parsed?.success ? "unavailable" : "failed");
    } catch { if (current()) setView("failed"); }
    finally { clearTimeout(timeout); if (pending.current === abort) pending.current = null; }
  }
  return <section className="ala-action" aria-label="Playbook generation readiness">
    <h2 className="section-title">Generate playbook</h2>
    <p id="playbook-readiness-guidance">Live Playbook AI is not enabled. This action checks availability only; no deal data is sent and no AI runs. No draft has been generated.</p>
    <p>Synthetic example data only. Do not use confidential transaction information. Regenerate requires an existing validated draft and is unavailable here.</p>
    <button className="button button-primary playbook-generate-button" type="button" aria-describedby="playbook-readiness-guidance" disabled={!ready || !session || view === "checking"} onClick={() => { void checkAvailability(); }}>Generate playbook</button>
    {view === "checking" ? <p role="status" className="playbook-checking">Checking Playbook availability... Repeat clicks are disabled.</p>
      : view === "unavailable" ? <p role="alert">Live Playbook AI is not enabled. No draft was generated; your session data is retained.</p>
      : view === "failed" ? <p role="alert">Playbook availability could not be verified. No draft was generated; your session data is retained.</p>
      : <AIStatusNotice state={{ status: "not_enabled" }} />}
    <PlaybookReviewWorkspace />
  </section>;
}
