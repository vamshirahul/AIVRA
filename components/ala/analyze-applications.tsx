"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useDemoSession } from "../demo-session-provider";
import { AIStatusNotice } from "../ai/ai-status-notice";
import { AI_ERROR_COPY } from "../../lib/ai/ai-view-state";
import type { AIViewState } from "../../lib/ai/ai-view-state";
import { ALAReviewWorkspace } from "./ala-review-workspace";

type SafeCode = keyof typeof AI_ERROR_COPY;
const ErrorReply = z.strictObject({ status: z.literal("error"), error: z.strictObject({
  code: z.enum(Object.keys(AI_ERROR_COPY) as [SafeCode, ...SafeCode[]]), request_id: z.uuid().nullable(), message: z.string().min(1).max(160),
}) });
type View = Exclude<AIViewState, { status: "completed" }> | { status: "checking" };

export function AnalyzeApplications() {
  const { session, ready } = useDemoSession();
  const [view, setView] = useState<View>({ status: "not_enabled" });
  const inFlight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const current = useRef({ id: session?.session_id, revision: session?.input_revisions.applications });
  current.current = { id: session?.session_id, revision: session?.input_revisions.applications };
  useEffect(() => {
    generation.current++; inFlight.current?.abort(); inFlight.current = null; setView({ status: "not_enabled" });
    return () => { generation.current++; inFlight.current?.abort(); inFlight.current = null; };
  }, [session?.session_id, session?.input_revisions.applications]);
  async function analyze() {
    if (!ready || !session || inFlight.current) return;
    const captured = { ...current.current }, ticket = ++generation.current;
    const controller = new AbortController(); inFlight.current = controller;
    const isCurrent = () => ticket === generation.current && captured.id === current.current.id && captured.revision === current.current.revision;
    const timer = setTimeout(() => controller.abort(), 10_000);
    setView({ status: "checking" });
    try {
      // Disabled public route gets NO body, dataset, source token, model choice or test switches.
      const response = await fetch("/api/ai/ala", { method: "POST", cache: "no-store", credentials: "omit", signal: controller.signal });
      const text = await response.text();
      const parsed = text.length <= 1024 ? ErrorReply.safeParse(JSON.parse(text)) : null;
      if (isCurrent()) setView({ status: "error", safeErrorCode: parsed?.success ? parsed.data.error.code : "invalid_model_output" });
    } catch { if (isCurrent()) setView({ status: "error", safeErrorCode: "unexpected_error" }); }
    finally { clearTimeout(timer); if (inFlight.current === controller) inFlight.current = null; }
  }
  return <section className="ala-action" aria-label="Application analysis readiness">
    <h2 className="section-title">Analyze applications</h2>
    <p>Synthetic example data only. Do not use confidential transaction information.</p>
    <dl className="ala-source-summary">
      <div><dt>Buyer applications</dt><dd>{session ? session.current_deal.applications.filter((app) => app.company_side === "buyer").length : "—"}</dd></div>
      <div><dt>Target applications</dt><dd>{session ? session.current_deal.applications.filter((app) => app.company_side === "target").length : "—"}</dd></div>
      <div><dt>Application source revision</dt><dd>{session?.input_revisions.applications ?? "—"}</dd></div>
    </dl>
    <p id="ala-readiness-guidance">Live AI is not enabled. This action currently checks readiness only: no application data is sent and AI does not run. No analysis has been run. Review controls require a current validated AI result.</p>
    <button type="button" className="button button-primary ala-analyze-button" aria-describedby="ala-readiness-guidance" disabled={!ready || !session || view.status === "checking"} onClick={() => { void analyze(); }}>Analyze applications</button>
    {view.status === "checking" ? <p className="ala-checking" role="status" aria-live="polite">Checking AI readiness... The availability request is pending; repeat clicks are disabled.</p> : <AIStatusNotice state={view} />}
    <ALAReviewWorkspace view={{ state: "absent" }} />
  </section>;
}
