import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { DemoSessionSchema, MAX_SESSION_CHARACTERS } from "../../session/session.ts";
import type { DemoSession } from "../../session/session.ts";
import { InvocationSchema, MAX_INPUT_BYTES, SourceIdSchema } from "../ai/contracts.ts";
import type { InvocationInput } from "../ai/contracts.ts";
import { LICENSE_PROMPT_VERSION, LICENSE_SYSTEM_PROMPT } from "./prompt.ts";
import { LicenseResultSchema } from "./schema.ts";

import { LicenseSourceTokenSchema } from "./source-schema.ts";
import type { LicenseSourceToken } from "./source-schema.ts";
export { LicenseSourceTokenSchema } from "./source-schema.ts";
export type { LicenseSourceToken } from "./source-schema.ts";
function validatedSession(input: unknown): DemoSession | null {
  try {
    const json = JSON.stringify(input);
    if (typeof json !== "string" || json.length > MAX_SESSION_CHARACTERS) return null;
    const parsed = DemoSessionSchema.safeParse(input);
    return parsed.success && isDeepStrictEqual(parsed.data, input) ? parsed.data : null;
  } catch { return null; }
}
function tokenFor(session: DemoSession): LicenseSourceToken {
  return Object.freeze({ session_id: session.session_id, fixture_id: session.fixture.fixture_id, fixture_dataset_version: session.fixture.dataset_version,
    application_revision: session.input_revisions.applications, license_revision: session.input_revisions.licenses,
    source_digest: createHash("sha256").update(JSON.stringify({ applications: session.current_deal.applications, license_positions: session.current_deal.license_positions })).digest("hex") });
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function buildLicenseRequest(input: unknown):
  | { ok: true; request: InvocationInput; source_token: LicenseSourceToken }
  | { ok: false; code: "invalid_input" | "request_too_large" } {
  try {
    const session = validatedSession(input);
    // No-data is explicitly unsupported inference, never a successful zero-opportunities result.
    if (!session || !session.current_deal.license_positions.length) return { ok: false, code: "invalid_input" };
    const deal = session.current_deal;
    const linked = new Set(deal.license_positions.map((r) => r.app_id));
    const ids = [...deal.license_positions.map((r) => r.license_id), ...deal.applications.filter((app) => linked.has(app.app_id)).map((app) => app.app_id)];
    if (!z.array(SourceIdSchema).min(1).max(300).safeParse([...deal.license_positions.map((r) => r.license_id), ...deal.applications.map((r) => r.app_id)]).success ||
        !SourceIdSchema.safeParse(session.fixture.fixture_id).success) return { ok: false, code: "invalid_input" };
    const candidate = { module: "licenses", prompt_version: LICENSE_PROMPT_VERSION, system: LICENSE_SYSTEM_PROMPT, context: { deal }, allowed_source_ids: ids };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_INPUT_BYTES) return { ok: false, code: "request_too_large" };
    const parsed = InvocationSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, code: "invalid_input" };
    if (Buffer.byteLength(JSON.stringify({ input: parsed.data, schema: z.toJSONSchema(LicenseResultSchema) }), "utf8") > MAX_INPUT_BYTES) return { ok: false, code: "request_too_large" };
    return { ok: true, request: freeze(parsed.data), source_token: tokenFor(session) };
  } catch { return { ok: false, code: "invalid_input" }; }
}
export function matchesLicenseSource(token: unknown, current: unknown): boolean {
  const checked = LicenseSourceTokenSchema.safeParse(token), session = validatedSession(current);
  return !!session && checked.success && isDeepStrictEqual(token, checked.data) && isDeepStrictEqual(checked.data, tokenFor(session));
}
