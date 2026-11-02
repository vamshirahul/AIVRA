import { CSE_VERSION, CSEContextSchema, CSERequestSchema, MAX_MINOR, parseCSE, equalCSE } from "./calculation-contract.ts";
import type { CSEContext, CSERequest } from "./calculation-contract.ts";
import type { DemoSession } from "../session/session.ts";

export const MONEY_FIELDS = ["annual_run_rate", "migration_one_time_cost", "transition_overlap_cost"] as const;
export type MoneyField = typeof MONEY_FIELDS[number];
export type MoneyDraft = { amount: string; note: string };
export type ActionDraft = { line_id: string; included: boolean } & Record<MoneyField, MoneyDraft>;
export type EstimateDraft = { horizon: string; actions: ActionDraft[] };
export type FormErrors = Record<string, string>;

/** User input only; no floating point monetary conversion, rounding or inferred defaults. */
export function parseCADInput(raw: string): { ok: true; minor: number | null } | { ok: false; error: string } {
  if (raw === "") return { ok: true, minor: null };
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match || raw.length > 14) return { ok: false, error: "Enter a nonnegative CAD amount with at most two decimal places, without symbols or separators." };
  const minor = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
  return minor <= BigInt(MAX_MINOR) ? { ok: true, minor: Number(minor) } : { ok: false, error: "Amount exceeds CAD 10,000,000,000.00." };
}
export function formatCAD(minor: number | null): string {
  if (minor === null) return "Unknown / Not computable";
  const value = BigInt(minor), absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "−" : ""}CAD ${(absolute / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}
export function editorIdentity(context: CSEContext): string { return JSON.stringify(context); }
export function createEstimateDraft(context: CSEContext): EstimateDraft {
  return { horizon: "", actions: (context.reviewed?.effective_actions ?? []).map((a) => ({ line_id: a.action_id, included: false,
    annual_run_rate: { amount: "", note: "" }, migration_one_time_cost: { amount: "", note: "" }, transition_overlap_cost: { amount: "", note: "" } })) };
}

/** Structural validation only. The protected owner must supply genuine, current reviewed context. */
export function buildEstimateRequest(context: CSEContext, draft: EstimateDraft): { ok: true; request: CSERequest } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const checked = parseCSE(CSEContextSchema, context), actions = context.reviewed?.effective_actions;
  if (!checked || !actions || !["current", "incomplete"].includes(context.analysis_state)) return { ok: false, errors: { form: "No current validated application analysis is available." } };
  if (draft.actions.length !== actions.length || draft.actions.some((d, i) => d.line_id !== actions[i].action_id) || new Set(actions.map((a) => a.action_id)).size !== actions.length) return { ok: false, errors: { form: "The reviewed action identities no longer match. Reset the input screen." } };
  const horizon = draft.horizon === "" ? null : /^(?:[1-9]|[12]\d|30)$/.test(draft.horizon) ? Number(draft.horizon) : null;
  if (draft.horizon !== "" && horizon === null) errors.horizon = "Enter a whole number of years from 1 to 30, or leave blank for unknown.";
  const lines = draft.actions.map((d, i) => {
    const action = actions[i];
    const money = (field: MoneyField) => {
      const value = d[field], parsed = parseCADInput(value.amount), key = `${d.line_id}.${field}`;
      if (!parsed.ok) errors[`${key}.amount`] = parsed.error;
      if (value.note.length > 400 || (value.amount !== "" && !value.note.trim())) errors[`${key}.note`] = "Supply a basis note (1–400 characters) for this amount, including zero.";
      if (!parsed.ok || parsed.minor === null) return null;
      return { amount_minor: parsed.minor, currency: "CAD" as const, unit: field === "annual_run_rate" ? "minor_units_per_year" as const : "minor_units_once" as const, basis: "visitor_assumption" as const, basis_note: value.note };
    };
    return { line_id: action.action_id, attribution_key: `ala/${action.action_id}`, source_kind: "ala" as const,
      spend_app_ids: [action.subject.app_id], included: d.included,
      action_reference: { finding_id: action.finding_id, action_id: action.action_id, subject: action.subject },
      annual_run_rate: money("annual_run_rate"), migration_one_time_cost: money("migration_one_time_cost"), transition_overlap_cost: money("transition_overlap_cost") };
  });
  if (Object.keys(errors).length) return { ok: false, errors };
  const request = CSERequestSchema.safeParse({ contract_version: CSE_VERSION, expected_source: context.source, review_identity: context.reviewed!.review.result_identity,
    expected_review_digest: context.review_digest, horizon_years: horizon, lines });
  return request.success ? { ok: true, request: request.data } : { ok: false, errors: { form: "The financial input contract could not be validated." } };
}

/** Synchronous invalidation key deliberately excludes TSA, which is not a CSE dependency. */
export function editorSessionStamp(s: DemoSession): string {
  return JSON.stringify({ session: s.session_id, fixture: s.fixture, applications: s.input_revisions.applications, licenses: s.input_revisions.licenses,
    currency: s.current_deal.currency, records: { applications: s.current_deal.applications, license_positions: s.current_deal.license_positions } });
}
export function matchesEditorSession(context: CSEContext, s: DemoSession): boolean {
  const a = context.source;
  return a.session_id === s.session_id && a.fixture_id === s.fixture.fixture_id && a.fixture_dataset_version === s.fixture.dataset_version && a.currency === s.current_deal.currency &&
    a.application_revision === s.input_revisions.applications && a.license_revision === s.input_revisions.licenses && equalCSE(context.applications, s.current_deal.applications);
}
export async function verifyEditorDigest(context: CSEContext, s: DemoSession): Promise<boolean> {
  if (!matchesEditorSession(context, s)) return false;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify({ applications: s.current_deal.applications, license_positions: s.current_deal.license_positions }));
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("") === context.source.source_digest;
  } catch { return false; }
}
