import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DemoSessionSchema, MAX_SESSION_CHARACTERS } from "../../session/session.ts";
import type { DemoSession } from "../../session/session.ts";
import { projectALAResults } from "../ala/presentation.ts";
import { buildReviewedExport } from "../../ala/review-export.ts";
import { CSE_VERSION, CSEContextSchema, CSESourceSchema, freezeCSE, parseCSE, equalCSE } from "../../cost-synergy/calculation-contract.ts";
import type { CSEContext } from "../../cost-synergy/calculation-contract.ts";
import { calculateCSE } from "../../cost-synergy/calculation.ts";

function session(value: unknown): DemoSession | null {
  try {
    const json = JSON.stringify(value); if (typeof json !== "string" || json.length > MAX_SESSION_CHARACTERS) return null;
    const parsed = DemoSessionSchema.safeParse(value); return parsed.success && isDeepStrictEqual(parsed.data, value) ? parsed.data : null;
  } catch { return null; }
}
function source(s: DemoSession) {
  return { session_id: s.session_id, fixture_id: s.fixture.fixture_id, fixture_dataset_version: s.fixture.dataset_version,
    application_revision: s.input_revisions.applications, license_revision: s.input_revisions.licenses, currency: s.current_deal.currency,
    source_digest: createHash("sha256").update(JSON.stringify({ applications: s.current_deal.applications, license_positions: s.current_deal.license_positions })).digest("hex") };
}
export function matchesCSESource(identity: unknown, current: unknown): boolean {
  const checked = parseCSE(CSESourceSchema, identity), s = session(current); return !!checked && !!s && equalCSE(checked, source(s));
}
/** Outcomes must originate in trusted server composition. No file/HTTP import or model invocation.
 * Reuse existing ALA projection/review consumer validation; never invent an ALA parser.
 */
export function prepareCSEContext(outcome: unknown, captured: unknown, current: unknown, review: unknown): CSEContext | null {
  const s = session(current); if (!s) return null;
  const view = projectALAResults(outcome, captured, current);
  const reviewed = "data" in view ? buildReviewedExport(view, review) : null;
  const state = reviewed && !reviewed.ok ? "invalid" : view.state;
  const candidate = { contract_version: CSE_VERSION, source: source(s), applications: s.current_deal.applications,
    analysis_state: state, reviewed: reviewed?.ok ? reviewed.artifact : null,
    review_digest: reviewed?.ok ? createHash("sha256").update(JSON.stringify({ review: reviewed.artifact.review, effective_actions: reviewed.artifact.effective_actions })).digest("hex") : null };
  const checked = parseCSE(CSEContextSchema, candidate); return checked ? freezeCSE(checked) as CSEContext : null;
}
export function calculateFromReviewedALA(outcome: unknown, captured: unknown, current: unknown, review: unknown, request: unknown) {
  const context = prepareCSEContext(outcome, captured, current, review);
  return calculateCSE(request, context);
}
