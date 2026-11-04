"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentType, FormEvent } from "react";
import type { DemoSession } from "../../lib/session/session";
import type { DemoSessionController } from "../../lib/session/controller";
import { TSA_STATUS_LABELS } from "../../lib/tsa-tracker/tsa-inventory-view";
import { captureTSADraft, prepareTSADraft, isCurrentTSADraft } from "../../lib/tsa-tracker/tsa-edit";
import type { TSADraft, TSADraftErrors, TSAFilter } from "../../lib/tsa-tracker/tsa-edit";
import type { TSAInventoryViewProps } from "./tsa-inventory";
import { buildTSASummary } from "../../lib/tsa-tracker/tsa-summary";
import { downloadTSASummary } from "../../lib/tsa-tracker/tsa-export";
import type { TSAExportFormat } from "../../lib/tsa-tracker/tsa-export";

type Active = ReturnType<typeof captureTSADraft>;
export function TSATracker({ session, controller, View }: { session: DemoSession; controller: DemoSessionController; View: ComponentType<TSAInventoryViewProps> }) {
  const [active, setActive] = useState<Active | null>(null), [filter, setFilter] = useState<TSAFilter>("all"), [errors, setErrors] = useState<TSADraftErrors>({}), [message, setMessage] = useState(""), [reference, setReference] = useState<string | null>(null);
  const latest = useRef(active), returnTo = useRef<string | null>(null), panel = useRef<HTMLHeadingElement>(null), errorSummary = useRef<HTMLParagraphElement>(null), filterControl = useRef<HTMLSelectElement>(null);
  latest.current = active; const id = useId();
  const mounted = useRef(true), summary = buildTSASummary(session);
  useEffect(() => { setReference(new Date().toISOString().slice(0, 10)); }, []);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; latest.current = null; }; }, []);
  useLayoutEffect(() => { if (active) panel.current?.focus(); else if (returnTo.current) { const target = document.getElementById(returnTo.current); (target ?? filterControl.current)?.focus(); returnTo.current = null; } }, [active?.editing]);
  useLayoutEffect(() => { if (Object.keys(errors).length) errorSummary.current?.focus(); }, [errors]);
  const stale = !!active && !isCurrentTSADraft(session, active.editing);
  function open(tsaId?: string) {
    const current = controller.getSnapshot().session; if (!current) return;
    const service = tsaId ? current.current_deal.tsa_services.find((s) => s.tsa_id === tsaId) : undefined;
    if (tsaId && !service) { setMessage("This service is no longer available. Review the current list."); return; }
    const next = captureTSADraft(current, service); latest.current = next; setActive(next); setErrors({}); setMessage(""); returnTo.current = tsaId ? `tsa-edit-${tsaId}` : `${id}-add`;
  }
  function close() { latest.current = null; setActive(null); setErrors({}); }
  function change<K extends keyof TSADraft>(key: K, value: TSADraft[K]) { setActive((previous) => { if (!previous) return previous; const next = { ...previous, draft: { ...previous.draft, [key]: value } }; latest.current = next; return next; }); }
  function submit(e: FormEvent) {
    e.preventDefault(); const draft = latest.current, current = controller.getSnapshot().session;
    if (!draft || !current) return;
    const prepared = prepareTSADraft(current, draft.editing, draft.draft); if (!prepared.ok) { setErrors(prepared.errors); return; }
    const result = draft.editing.mode === "create" ? controller.createTSA(prepared.input, draft.editing.expected) : controller.updateTSA(draft.editing.expected.tsa_id, prepared.patch, draft.editing.expected);
    if (!result.ok) { setErrors({ form: "Save was rejected. Review the fields and current source, or Cancel. Your draft is retained." }); return; }
    const after = controller.getSnapshot(); close(); setMessage(after.storageAvailable ? "TSA saved in this browser session." : "TSA saved in memory only. Browser storage is unavailable; changes may be lost on refresh.");
  }
  function download(format: TSAExportFormat) {
    const result = downloadTSASummary(() => ({ session: controller.getSnapshot().session, current: mounted.current, unsaved: latest.current !== null }), format);
    setMessage(result.ok ? `Download initiated for all saved TSA services.${controller.getSnapshot().storageAvailable ? "" : " Source is memory only and may be lost on refresh."}` : result.message);
  }
  const textField = (key: "title" | "provider" | "recipient" | "owner" | "start_date" | "end_date" | "exit_milestone" | "risk_notes", label: string, area = false) => {
    if (!active) return null;
    const props = { id: `${id}-${key}`, name: key, value: active.draft[key], "aria-invalid": !!errors[key], "aria-describedby": `${id}-${key}-error`, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(key, e.currentTarget.value) };
    return <div key={key}><label htmlFor={props.id}>{label}</label>{area ? <textarea {...props} rows={3} maxLength={key === "risk_notes" ? 500 : undefined} /> : <input {...props} type="text" placeholder={key.endsWith("date") ? "YYYY-MM-DD; blank is unknown" : undefined} />}<p id={`${id}-${key}-error`} className="tsa-error">{errors[key]}</p></div>;
  };
  return <section className="tsa-tracker" aria-label="TSA session workspace">
    <div className="tsa-toolbar"><button id={`${id}-add`} className="button button-primary" type="button" disabled={!!active} onClick={() => open()}>Add TSA</button><div><label htmlFor={`${id}-filter`}>Source status filter</label><select ref={filterControl} id={`${id}-filter`} value={filter} disabled={!!active} onChange={(e) => setFilter(e.currentTarget.value as TSAFilter)}><option value="all">All statuses</option>{Object.entries(TSA_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
    <p className="tsa-help">{active ? "Save or Cancel before changing the list filter." : "Filters affect this view only and reset on refresh or session Reset."}</p>
    <p role="status" aria-live="polite">{message}</p>
    <p className="tsa-help">{reference ? `Date reference: ${reference} (UTC, captured when this workspace opened).` : "Preparing date reference."} Attention compares known dates with this reference and reports milestone presence. It does not predict risk, verify milestone completion or change source status.</p>
    {active && <form className="tsa-edit-panel" onSubmit={submit} noValidate aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} ref={panel} tabIndex={-1}>{active.editing.mode === "create" ? "Add synthetic TSA service" : "Edit synthetic TSA service"}</h2>
      {active.editing.mode === "edit" && <p>TSA ID: {active.editing.expected.tsa_id}. Title: {active.draft.title}. Provider: {active.draft.provider}. Recipient: {active.draft.recipient}. Existing application relationships are preserved.</p>}
      <p className="tsa-help">Blank optional fields mean unknown. Status is an explicit source choice. Changes are saved only when you select Save.</p>
      {stale && <p className="tsa-error" role="alert">Source changed while this draft was open. Reload current values or Cancel; nothing has been overwritten.</p>}
      <p ref={errorSummary} tabIndex={-1} role={Object.keys(errors).length ? "alert" : "status"} className="tsa-error">{Object.values(errors).join(" ")}</p>
      <div className="tsa-form-grid">
        {active.editing.mode === "create" && <>{textField("title", "Service title (required)")}{textField("provider", "Provider (required)")}{textField("recipient", "Recipient (required)")}</>}
        <div><label htmlFor={`${id}-status`}>Source status (required)</label><select id={`${id}-status`} name="status" value={active.draft.status} onChange={(e) => change("status", e.currentTarget.value)} aria-invalid={!!errors.status} aria-describedby={`${id}-status-error`}><option value="">Select a status</option>{Object.entries(TSA_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><p id={`${id}-status-error`} className="tsa-error">{errors.status}</p></div>
        {textField("owner", "Owner / role (optional)")}{textField("start_date", "Start date (YYYY-MM-DD, optional)")}{textField("end_date", "End date (YYYY-MM-DD, optional)")}{textField("exit_milestone", "Exit milestone (optional)", true)}{textField("risk_notes", "Risk / dependency notes (optional)", true)}
      </div>
      {active.editing.mode === "create" && <fieldset><legend>Application relationship information</legend><label htmlFor={`${id}-relationship`}>Relationship information</label><select id={`${id}-relationship`} value={active.draft.relationship} onChange={(e) => change("relationship", e.currentTarget.value as TSADraft["relationship"])}><option value="unsupplied">Not supplied (unknown)</option><option value="recorded">Recorded links (empty means no links)</option></select>
        {active.draft.relationship === "recorded" && <div className="tsa-application-choices">{session.current_deal.applications.map((a) => <label key={a.app_id}><input type="checkbox" checked={active.draft.related_app_ids.includes(a.app_id)} onChange={(e) => change("related_app_ids", e.currentTarget.checked ? [...active.draft.related_app_ids, a.app_id] : active.draft.related_app_ids.filter((v) => v !== a.app_id))} />{a.app_id} · {a.company_side === "buyer" ? "Buyer" : "Target"} · {a.app_name}</label>)}</div>}<p className="tsa-error">{errors.related_app_ids}</p></fieldset>}
      <div className="tsa-toolbar"><button type="submit" className="button button-primary" disabled={stale}>Save</button><button type="button" className="button button-secondary" onClick={() => { close(); setMessage("Draft cancelled; shared TSA records unchanged."); }}>Cancel</button>{stale && <button type="button" className="button button-secondary" onClick={() => open(active.editing.mode === "edit" ? active.editing.expected.tsa_id : undefined)}>Reload current values (discard draft)</button>}</div>
    </form>}
    <View session={session} ready={true} filter={filter} onEdit={open} editing={!!active} reference={reference} />
    <section className="tsa-downloads" aria-label="TSA summary downloads"><h2 className="section-title">Download TSA summary</h2><p className="tsa-help">Includes all saved TSA services, regardless of the status filter. Synthetic and unapproved source records only.{active ? " Save or Cancel the open draft before downloading." : " Unsaved drafts are never included."}</p>{!summary.ok && <p role="status" className="tsa-error">{summary.message}</p>}<div className="tsa-toolbar">{(["csv", "json"] as const).map((format) => <button key={format} type="button" className="button button-secondary" disabled={!!active || !summary.ok} onClick={() => download(format)}>Download TSA {format.toUpperCase()}</button>)}</div></section>
  </section>;
}
