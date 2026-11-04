import "server-only";
import { isDeepStrictEqual } from "node:util";
import { DemoSessionSchema } from "../../session/session.ts";
import { freezeCSE } from "../../cost-synergy/calculation-contract.ts";
import { validateInvocation } from "../ai/adapter.ts";
import { preparePlaybookContract } from "./contract.ts";
import type { PlaybookInputs } from "./input.ts";
import { PLAYBOOK_PROMPT_VERSION } from "./input-schema.ts";
import { PLAYBOOK_SYSTEM_PROMPT } from "./prompt.ts";
import { PLAYBOOK_OUTPUT_CONTRACT } from "./schema.ts";

/** Trusted server builder only. No caller-selected prompt, schema or allowlist. */
export function buildPlaybookInvocation(source: PlaybookInputs) {
  const prepared = preparePlaybookContract(source);
  if (!prepared.ok) return prepared;
  try {
    const session = DemoSessionSchema.safeParse(source.current_session);
    if (!session.success || !isDeepStrictEqual(session.data, source.current_session)) return { ok: false as const, code: "invalid_input" as const };
    const deal = session.data.current_deal;
    const candidate = { module: "playbook" as const, prompt_version: PLAYBOOK_PROMPT_VERSION, system: PLAYBOOK_SYSTEM_PROMPT,
      context: { deal, playbook: prepared.input }, allowed_source_ids: [...deal.applications.map((a) => a.app_id), ...deal.tsa_services.map((t) => t.tsa_id)] };
    // Accounts for the duplicated full deal AND the output schema at the unchanged cap.
    const checked = validateInvocation(candidate, PLAYBOOK_OUTPUT_CONTRACT);
    return checked.ok ? { ok: true as const, request: freezeCSE(checked.input), input: prepared.input } : { ok: false as const, code: checked.code };
  } catch { return { ok: false as const, code: "invalid_input" as const }; }
}
