import "server-only";
import { z } from "zod";
import { MAX_INPUT_BYTES } from "../ai/contracts.ts";
import { buildPlaybookInput } from "./input.ts";
import type { PlaybookInputs } from "./input.ts";
import { PlaybookResultSchema } from "./schema.ts";
import { PLAYBOOK_SYSTEM_PROMPT } from "./prompt.ts";

/** Domain contract preflight, NOT gateway invocation or a public result authority.
 * Include schema/prompt bytes now so a future transport cannot silently truncate.
 */
export function preparePlaybookContract(source: PlaybookInputs) {
  const built = buildPlaybookInput(source);
  if (!built.ok) return built;
  try {
    const bytes = Buffer.byteLength(JSON.stringify({ input: built.input, system: PLAYBOOK_SYSTEM_PROMPT, schema: z.toJSONSchema(PlaybookResultSchema) }), "utf8");
    if (bytes > MAX_INPUT_BYTES) return { ok: false as const, code: "request_too_large" as const, message: "The playbook context and output schema exceed the existing AI input limit." };
    return built;
  } catch { return { ok: false as const, code: "invalid_input" as const, message: "The playbook contract could not be prepared." }; }
}
