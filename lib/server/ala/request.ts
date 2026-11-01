import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { DemoSessionSchema, MAX_SESSION_CHARACTERS } from "../../session/session.ts";
import type { DemoSession } from "../../session/session.ts";
import { InvocationSchema, MAX_INPUT_BYTES, SourceIdSchema } from "../ai/contracts.ts";
import type { InvocationInput } from "../ai/contracts.ts";
import { ALA_PROMPT_VERSION, ALA_SYSTEM_PROMPT } from "./prompt.ts";
import { ALAResultSchema } from "./schema.ts";

export const ALASourceTokenSchema = z.strictObject({
  session_id: z.uuid(), application_revision: z.number().int().nonnegative(),
  fixture_id: z.string().min(1), fixture_dataset_version: z.string().min(1), applications_digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ALASourceToken = Readonly<z.infer<typeof ALASourceTokenSchema>>;
function validatedSession(input: unknown): DemoSession | null {
  try {
    const serialized = JSON.stringify(input);
    if (typeof serialized !== "string" || serialized.length > MAX_SESSION_CHARACTERS) return null;
    const parsed = DemoSessionSchema.safeParse(input);
    // Validate existing source; never silently normalize/strip a submitted snapshot.
    return parsed.success && isDeepStrictEqual(parsed.data, input) ? parsed.data : null;
  } catch { return null; }
}
function sourceToken(session: DemoSession): ALASourceToken {
  return Object.freeze({ session_id: session.session_id, application_revision: session.input_revisions.applications,
    fixture_id: session.fixture.fixture_id, fixture_dataset_version: session.fixture.dataset_version,
    applications_digest: createHash("sha256").update(JSON.stringify(session.current_deal.applications)).digest("hex") });
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function buildALARequest(input: unknown):
  | { ok: true; request: InvocationInput; source_token: ALASourceToken }
  | { ok: false; code: "invalid_input" | "request_too_large"; message: string } {
  const invalid = { ok: false, code: "invalid_input", message: "A valid current synthetic session with Buyer and Target applications is required." } as const;
  const oversized = { ok: false, code: "request_too_large", message: "The ALA context and schema exceed the existing request limits." } as const;
  try {
    const session = validatedSession(input); if (!session) return invalid;
    const ids = session.current_deal.applications.map((app) => app.app_id);
    if (!z.array(SourceIdSchema).min(2).max(100).safeParse(ids).success) return invalid;
    const candidate = { module: "ala", prompt_version: ALA_PROMPT_VERSION, system: ALA_SYSTEM_PROMPT,
      context: { deal: session.current_deal }, allowed_source_ids: ids };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_INPUT_BYTES) return oversized;
    const parsed = InvocationSchema.safeParse(candidate); if (!parsed.success) return invalid;
    // Match the guarded router's context+JSON-schema byte accounting as well as adapter preflight.
    if (Buffer.byteLength(JSON.stringify({ input: parsed.data, schema: z.toJSONSchema(ALAResultSchema) }), "utf8") > MAX_INPUT_BYTES) return oversized;
    return { ok: true, request: freeze(parsed.data), source_token: sourceToken(session) };
  } catch { return invalid; }
}
export function matchesALASource(token: ALASourceToken, current: unknown): boolean {
  const parsed = ALASourceTokenSchema.safeParse(token), session = validatedSession(current);
  return !!session && parsed.success && isDeepStrictEqual(parsed.data, sourceToken(session));
}
