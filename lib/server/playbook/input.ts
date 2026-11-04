import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DemoSessionSchema, MAX_SESSION_CHARACTERS } from "../../session/session.ts";
import { ScenarioFinancialDraftSchema, validateCurrentScenario } from "../../scenario-modeling/scenario-draft.ts";
import { compareScenarios } from "../../scenario-modeling/scenario-comparison.ts";
import { freezeCSE } from "../../cost-synergy/calculation-contract.ts";
import { prepareCSEContext } from "../cost-synergy/reviewed-context.ts";
import { projectALAResults } from "../ala/presentation.ts";
import { MAX_INPUT_BYTES, SourceIdSchema } from "../ai/contracts.ts";

import { PLAYBOOK_INPUT_VERSION, PLAYBOOK_PROMPT_VERSION, PlaybookInputSchema } from "./input-schema.ts";
import type { PlaybookInput } from "./input-schema.ts";
export { PLAYBOOK_INPUT_VERSION, PLAYBOOK_PROMPT_VERSION, PlaybookInputSchema } from "./input-schema.ts";
export type { PlaybookInput } from "./input-schema.ts";
export type PlaybookInputs = {
  // Trusted protected server composition only, never a browser export/file attestation.
  outcome: unknown; captured_session: unknown; current_session: unknown; review: unknown;
  financial_draft: unknown; scenario: unknown; selected_scenario: "baseline" | "alternative";
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code: "invalid_input" | "request_too_large" = "invalid_input") => ({ ok: false as const, code,
  message: code === "request_too_large" ? "The playbook context exceeds the existing AI input limit." : "Current validated ALA, review and scenario sources are required for the playbook contract." });

/** Strict detached domain input. This is NOT InvocationInput and never dispatches AI.
 * U04.02 must separately integrate bounded structured context through the gateway.
 */
export function buildPlaybookInput(input: PlaybookInputs): { ok: true; input: PlaybookInput } | ReturnType<typeof fail> {
  try {
    const json = JSON.stringify(input.current_session);
    if (typeof json !== "string" || json.length > MAX_SESSION_CHARACTERS) return fail();
    const parsed = DemoSessionSchema.safeParse(input.current_session);
    if (!parsed.success || !isDeepStrictEqual(parsed.data, input.current_session)) return fail();
    const session = parsed.data;
    if (![...session.current_deal.applications.map((a) => a.app_id), ...session.current_deal.tsa_services.map((t) => t.tsa_id)].every((id) => SourceIdSchema.safeParse(id).success)) return fail();
    const context = prepareCSEContext(input.outcome, input.captured_session, session, input.review);
    if (!context?.reviewed || !context.review_digest) return fail();
    const view = projectALAResults(input.outcome, input.captured_session, session);
    const financial = ScenarioFinancialDraftSchema.safeParse(input.financial_draft);
    if (!financial.success || !isDeepStrictEqual(financial.data, input.financial_draft)) return fail();
    const source = { context, view, financial_draft: financial.data };
    const scenario = validateCurrentScenario(source, input.scenario);
    if (!scenario) return fail();
    const compared = compareScenarios(source, scenario);
    if (!compared.ok || !["baseline", "alternative"].includes(input.selected_scenario)) return fail();
    const result = input.selected_scenario === "baseline" ? compared.comparison.baseline_result : compared.comparison.alternative_result;
    const candidate = { contract_version: PLAYBOOK_INPUT_VERSION, prompt_version: PLAYBOOK_PROMPT_VERSION, illustrative_unapproved: true,
      source: { session_id: session.session_id, fixture: session.fixture, session_revision: session.session_revision,
        input_revisions: session.input_revisions, deal_digest: digest(session.current_deal), review_digest: context.review_digest,
        scenario_digest: digest({ scenario, selected_scenario: input.selected_scenario }) },
      applications: session.current_deal.applications, tsa_services: session.current_deal.tsa_services,
      reviewed_ala: context.reviewed, selected_scenario: input.selected_scenario, scenario,
      financial_summary: { status: result.status, currency: result.currency, money_unit: result.money_unit, totals: result.totals, warnings: result.warnings, conflicts: result.conflicts },
      incomplete_context: [...(context.analysis_state === "incomplete" ? ["ala_incomplete"] : []), ...(result.status !== "computed" ? ["financial_incomplete"] : [])] };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_INPUT_BYTES) return fail("request_too_large");
    const checked = PlaybookInputSchema.safeParse(candidate);
    return checked.success && isDeepStrictEqual(checked.data, candidate) ? { ok: true, input: freezeCSE(checked.data) } : fail();
  } catch { return fail(); }
}

/** Rebuild from latest protected inputs, including review/hypothesis/raw assumption
 * changes. Call before and after any future await; no asynchronous work in U04.01.
 */
export function matchesPlaybookInput(captured: unknown, current: PlaybookInputs): boolean {
  const built = buildPlaybookInput(current);
  return built.ok && isDeepStrictEqual(captured, built.input);
}
