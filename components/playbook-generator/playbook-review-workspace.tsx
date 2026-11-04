"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { useDemoSession } from "../demo-session-provider";
import { ABSENT_PLAYBOOK, readPlaybookSource, playbookReviewKey, createPlaybookReviewDraft, playbookReviewBinding,
  projectPlaybookReview, savePlaybookEdit, restorePlaybookRow, validatePlaybookEdit, matchesPlaybookReviewSession, verifyPlaybookReviewSession } from "../../lib/playbook-generator/review-draft";
import type { PlaybookReviewSource, PlaybookReviewDraft, PlaybookReviewErrors } from "../../lib/playbook-generator/review-draft";

export function PlaybookReviewUnavailable({ stale = false, checking = false }: { stale?: boolean; checking?: boolean }) {
  return <section className="playbook-review-empty" aria-label="Playbook review availability"><h2 className="section-title">Playbook review</h2>
    <p role={stale ? "alert" : "status"}>{stale ? "Stale or unverified Playbook. Editing is unavailable and previous saved and unsaved edits have been revoked. A current protected result is required." : checking ? "Checking the protected result against this browser session. Editing remains unavailable." : "No current validated Playbook is available to review. Live AI is disabled; no activities or milestones have been generated."}</p></section>;
}
/** No public source is supplied. There is no current=true prop or JSON import.
 * A future protected owner must deliver a genuine source and notify all revocations.
 */
export function PlaybookReviewWorkspace({ source = null }: { source?: PlaybookReviewSource | null }) {
  const { session, ready, getSnapshot } = useDemoSession();
  const subscribe = useCallback((notify: () => void) => { try { return typeof source?.subscribe === "function" ? source.subscribe(notify) : () => {}; } catch { return () => {}; } }, [source]);
  const snapshot = useCallback(() => readPlaybookSource(source), [source]);
  const view = useSyncExternalStore(subscribe, snapshot, () => ABSENT_PLAYBOOK);
  const bindingKey = playbookReviewKey(source);
  const sessionKey = session ? JSON.stringify([session.session_id, session.session_revision, session.input_revisions, session.fixture, session.current_deal]) : "";
  const key = JSON.stringify([bindingKey, sessionKey]);
  const eligible = ready && session && "data" in view && matchesPlaybookReviewSession(source, session);
  const [verified, setVerified] = useState<{ key: string; valid: boolean } | null>(null);
  useEffect(() => { let active = true; if (eligible && session) void verifyPlaybookReviewSession(source, session).then(valid => { if (active) setVerified({ key, valid }); }); else setVerified(null); return () => { active = false; }; }, [eligible, key, source, session]);
  if (!eligible || !("data" in view) || !source || verified?.key !== key || !verified.valid) return <PlaybookReviewUnavailable checking={!!eligible && verified?.key !== key} stale={!!source && (!eligible || verified?.key === key && !verified.valid)} />;
  const guard = () => matchesPlaybookReviewSession(source, getSnapshot().session) && JSON.stringify(getSnapshot().session?.current_deal) === JSON.stringify(session.current_deal) && playbookReviewKey(source) === bindingKey;
  return <PlaybookReviewEditor key={key} source={source} guard={guard} />;
}

type Projection = NonNullable<ReturnType<typeof projectPlaybookReview>>;
type Row = Projection["activities"][number];
type Editing = { kind: "activity" | "milestone"; row: Row };
function PlaybookReviewEditor({ source, guard }: { source: PlaybookReviewSource; guard: () => boolean }) {
  const [draft, setDraft] = useState<PlaybookReviewDraft | null>(() => createPlaybookReviewDraft(source));
  const latest = useRef(draft); latest.current = draft;
  const [editing, setEditing] = useState<Editing | null>(null), [message, setMessage] = useState("");
  const focus = useRef<string | null>(null), prefix = useId();
  useLayoutEffect(() => { if (!editing && focus.current) { document.getElementById(focus.current)?.focus(); focus.current = null; } }, [editing, draft]);
  const projection = projectPlaybookReview(source, draft);
  if (!projection || !guard()) return <PlaybookReviewUnavailable stale />;
  const original = projection.data.original, plan = original.envelope.data, meta = original.envelope;
  const buttonId = (kind: string, id: string) => `${prefix}-${kind}-${id}`;
  function close() { if (editing) focus.current = buttonId(editing.kind, editing.row.id); setEditing(null); }
  const apply = (result: ReturnType<typeof savePlaybookEdit>) => { if (result.ok) { latest.current = result.draft; setDraft(result.draft); close(); setMessage(result.changed ? "Visitor draft saved. Original AI content is unchanged; nothing is approved or assigned." : "No change to the saved review."); } return result; };
  function renderRow(row: Row, kind: Editing["kind"]) {
    const values = row.values as Record<string, string | null>;
    return <article key={`${kind}:${row.id}`} className="playbook-review-row" data-playbook-row={`${kind}:${row.id}`}>
      <p className="playbook-review-label">{kind === "activity" ? "Activity" : "Milestone"} · {row.id} · {row.origin === "visitor_edit" ? "Visitor edit — unapproved" : "Original AI-generated unapproved draft"}</p>
      <h4>{values.title}</h4>
      {kind === "activity" ? <><p>{values.description}</p><p>Proposed role: {values.ownership_role ?? "Unassigned / unknown"}. Roles are suggestions, not assignments to people.</p></>
        : <><p>Proposed date: {values.proposed_date ?? "Unknown / not proposed"}</p><p>Date basis: {values.date_assumption ?? "Unknown / not supplied"}. No contractual commitment.</p></>}
      {row.visitor_reason && <p className="playbook-review-reason">Visitor justification: {row.visitor_reason}</p>}
      <details><summary>Original AI fields and read-only context</summary>
        <p>Original title: {row.original.title}</p>
        {"description" in row.original ? <><p>Original description: {row.original.description}</p><p>Original proposed role: {row.original.ownership_role ?? "Unassigned / unknown"}</p><p>Read-only activity dependencies: {row.original.depends_on_activity_ids.join(", ") || "None supplied"}</p><p>Uncertainty: {row.original.uncertainty.level} — {row.original.uncertainty.reason}</p><p>Assumptions: {row.original.assumptions.join("; ") || "None supplied"}</p></>
          : <><p>Original proposed date: {row.original.proposed_date ?? "Unknown / not proposed"}</p><p>Original date basis: {row.original.date_assumption ?? "Unknown / not supplied"}</p><p>Read-only milestone activity links: {row.original.after_activity_ids.join(", ")}</p></>}
        <p>Read-only source references:</p><pre>{JSON.stringify(row.original.source_refs, null, 2)}</pre>
      </details>
      <div className="playbook-review-buttons"><button id={buttonId(kind, row.id)} type="button" className="button button-secondary" disabled={!!editing} onClick={() => { if (!guard()) { setMessage("The protected source is no longer current."); return; } setMessage(""); setEditing({ kind, row }); }}>Edit {kind} {row.id}</button>
        {row.origin === "visitor_edit" && <button type="button" className="button button-secondary" disabled={!!editing} onClick={() => { if (!guard()) { setMessage("The protected source is no longer current."); return; } const result = restorePlaybookRow(source, latest.current, kind, row.id); if (result.ok) { latest.current = result.draft; setDraft(result.draft); focus.current = buttonId(kind, row.id); setMessage("Original AI fields restored. No source record was changed."); } else setMessage(result.errors.form ?? "Restore was rejected."); }}>Restore AI fields</button>}</div>
    </article>;
  }
  return <section className="playbook-review" aria-label="Temporary Playbook review">
    <span className="badge">AI-generated draft · illustrative · unapproved</span><h2 className="section-title">Review activities and milestones</h2>
    <p>Selected scenario: {projection.data.selected_scenario}. Provider: {meta.model_provider} · Model: {meta.model_id} · Mode: {meta.mode}{meta.routing_reason ? ` / ${meta.routing_reason}` : ""}.</p>
    <p className="playbook-review-source">Generated {meta.generated_at} · Analysis {meta.request_id} · Prompt {meta.prompt_version} · Input digest {meta.input_digest}</p>
    <p className="playbook-review-source">Fixture {original.source.fixture.fixture_id} / {original.source.fixture.dataset_version} · Application/license/TSA revisions {Object.values(original.source.input_revisions).join(" / ")} · Review {original.source.review_digest} · Scenario {original.source.scenario_digest}</p>
    <p>Changes are temporary visitor proposals for this open workspace. Saving does not approve a plan, assign people, verify risks or change source obligations. Leaving this workspace or refreshing discards its review.</p>
    <p role="status" aria-live="polite">{projection.visitor_edit_count} saved visitor edits. {message}</p>
    {original.status === "incomplete" && <p className="playbook-review-warning" role="status">Incomplete Playbook / evidence. Missing applications: {original.coverage.missing_app_ids.join(", ") || "None"}; TSA: {original.coverage.missing_tsa_ids.join(", ") || "None"}; ALA actions: {original.coverage.missing_action_ids.join(", ") || "None"}. Context: {original.coverage.incomplete_context.join(", ") || "No additional codes"}. Visitor edits do not complete the analysis.</p>}
    {editing && <PlaybookReviewForm key={`${editing.kind}:${editing.row.id}`} source={source} editing={editing} onCancel={() => { close(); setMessage("Unsaved edit cancelled; the last saved review is unchanged."); }} onSave={proposal => guard() ? apply(savePlaybookEdit(source, latest.current, proposal)) : { ok: false, errors: { form: "The protected source changed. No edit was saved." } }} />}
    {plan.phases.map(phase => <section key={phase.phase_id} className="playbook-review-phase" aria-label={`Phase ${phase.sequence}: ${phase.title}`}><h3>Phase {phase.sequence} · {phase.title}</h3><p>Phase assumptions (read-only): {phase.assumptions.join("; ") || "None supplied"}</p>
      <div className="playbook-review-grid">{projection.activities.filter(r => r.original.phase_id === phase.phase_id).map(r => renderRow(r, "activity"))}{projection.milestones.filter(r => r.original.phase_id === phase.phase_id).map(r => renderRow(r, "milestone"))}</div></section>)}
    <details><summary>Original phases, risks, omissions, limitations and provenance</summary><pre>{JSON.stringify({ phases: plan.phases, risks: plan.risks, not_addressed: plan.not_addressed, limitations: plan.limitations, coverage: original.coverage, source: original.source, provenance: { ...meta, data: undefined } }, null, 2)}</pre></details>
    {draft && draft.overrides.length > 0 && <button type="button" className="button button-secondary" disabled={!!editing} onClick={() => { if (!guard()) { setMessage("The protected source changed."); return; } const reset = createPlaybookReviewDraft(source); latest.current = reset; setDraft(reset); setMessage("All saved visitor edits restored to original AI fields."); }}>Restore all AI fields</button>}
  </section>;
}

function PlaybookReviewForm({ source, editing, onSave, onCancel }: { source: PlaybookReviewSource; editing: Editing; onSave: (proposal: unknown) => ReturnType<typeof savePlaybookEdit>; onCancel: () => void }) {
  const id = useId(), initial = editing.row.values as Record<string, string | null>;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ?? ""])));
  const [reason, setReason] = useState(editing.row.visitor_reason ?? ""), [failure, setFailure] = useState<PlaybookReviewErrors>({});
  const first = useRef<HTMLInputElement>(null), summary = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { first.current?.focus(); }, []);
  const proposal = { binding: playbookReviewBinding(source), kind: editing.kind, id: editing.row.id, visitor_reason: reason, values: editing.kind === "activity"
    ? { title: values.title, description: values.description, ownership_role: values.ownership_role === "" ? null : values.ownership_role }
    : { title: values.title, proposed_date: values.proposed_date === "" ? null : values.proposed_date, date_assumption: values.date_assumption === "" ? null : values.date_assumption } };
  const errors = { ...validatePlaybookEdit(source, proposal), ...failure };
  function submit(e: FormEvent) { e.preventDefault(); if (Object.keys(errors).length) return; const r = onSave(proposal); if (!r.ok) { setFailure(r.errors); requestAnimationFrame(() => summary.current?.focus()); } }
  function field(name: string, label: string, max: number, area = false) {
    const error = errors[name as keyof PlaybookReviewErrors], props = { id: `${id}-${name}`, name, value: values[name] ?? "", maxLength: max, "aria-invalid": !!error, "aria-describedby": error ? `${id}-${name}-error` : undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const value = e.currentTarget.value; setValues(v => ({ ...v, [name]: value })); setFailure({}); } };
    return <div><label htmlFor={props.id}>{label}</label>{area ? <textarea {...props} rows={4} /> : <input {...props} type="text" ref={name === "title" ? first : undefined} />}{error && <p id={`${id}-${name}-error`} className="playbook-review-error">{error}</p>}</div>;
  }
  return <form className="playbook-review-form" aria-label={`Edit ${editing.kind} ${editing.row.id}`} onSubmit={submit} noValidate>
    <h3>Edit {editing.kind} {editing.row.id}</h3><p>Visitor proposal only. Dependencies, source references and original uncertainty remain read-only.</p>
    {errors.form && <p role="alert" tabIndex={-1} ref={summary} className="playbook-review-error">{errors.form}</p>}
    {field("title", "Title", 120)}
    {editing.kind === "activity" ? <>{field("description", "Activity description", 800, true)}{field("ownership_role", "Proposed functional role (blank means unassigned / unknown)", 120)}</> : <>{field("proposed_date", "Proposed date (YYYY-MM-DD, blank means unknown)", 10)}{field("date_assumption", "Proposed date basis (clear when date is unknown)", 400, true)}</>}
    <label htmlFor={`${id}-reason`}>Visitor justification (required for a change)</label><textarea id={`${id}-reason`} name="visitor_reason" maxLength={400} rows={3} value={reason} aria-invalid={!!errors.visitor_reason} aria-describedby={errors.visitor_reason ? `${id}-reason-error` : undefined} onChange={e => { setReason(e.currentTarget.value); setFailure({}); }} />
    {errors.visitor_reason && <p id={`${id}-reason-error`} className="playbook-review-error">{errors.visitor_reason}</p>}
    <div className="playbook-review-buttons"><button className="button button-primary" type="submit" disabled={Object.keys(errors).length > 0}>Save visitor edit</button><button className="button button-secondary" type="button" onClick={onCancel}>Cancel edit</button></div>
  </form>;
}
