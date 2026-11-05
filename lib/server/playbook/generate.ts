import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { freezeCSE } from "../../cost-synergy/calculation-contract.ts";
import { createAIRouter } from "../ai/router.ts";
import { validateInvocation } from "../ai/adapter.ts";
import { ControlPolicySchema } from "../ai/control-policy.ts";
import { failure, FailureCodeSchema, MAX_OUTPUT_BYTES, SourceIdSchema } from "../ai/contracts.ts";
import type { FailureCode, InvocationInput } from "../ai/contracts.ts";
import { matchesPlaybookInput } from "./input.ts";
import type { PlaybookInputs } from "./input.ts";
import { PlaybookInputSchema } from "./input-schema.ts";
import type { PlaybookInput } from "./input-schema.ts";
import { buildPlaybookInvocation } from "./request.ts";
import { PLAYBOOK_OUTPUT_CONTRACT, PlaybookEnvelopeSchema, PlaybookResultSchema, inspectPlaybookResult } from "./schema.ts";

import { PlaybookErrorSchema, PlaybookOutcomeSchema } from "./outcome-schema.ts";
import type { PlaybookOutcome } from "./outcome-schema.ts";
export { PlaybookErrorSchema, PlaybookOutcomeSchema } from "./outcome-schema.ts";
export type { PlaybookOutcome } from "./outcome-schema.ts";
const LocalCode = z.enum(["source_changed", "invalid_previous_draft"]);
type Accepted = Exclude<PlaybookOutcome, { status: "error" }>;
export type PlaybookSourceReader = () => PlaybookInputs | null;
const Caller = z.strictObject({ client_key: z.string().regex(/^[a-f0-9]{64}$/) });
function safeError(code: FailureCode | z.infer<typeof LocalCode>, request_id: string): z.infer<typeof PlaybookErrorSchema> {
  const message = code === "source_changed" ? "Playbook sources changed. No current draft was accepted; existing work is retained."
    : code === "invalid_previous_draft" ? "Regenerate requires a draft issued by this protected generation owner."
    : failure(code, request_id).error.message;
  return { status: "error", error: { code, request_id, message } };
}

/** Validation, not execution attestation. Used only after the guarded router;
 * no deserialized envelope becomes an issued/current draft through this function.
 */
export function validatePlaybookEnvelope(value: unknown, request: InvocationInput, captured: PlaybookInput, requestId: string, rawPolicy: unknown) {
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_OUTPUT_BYTES) return null;
    const policy = ControlPolicySchema.safeParse(rawPolicy), parsed = PlaybookEnvelopeSchema.safeParse(value), invocation = validateInvocation(request, PLAYBOOK_OUTPUT_CONTRACT);
    if (!policy.success || !policy.data.enabled || !parsed.success || !invocation.ok || !isDeepStrictEqual(parsed.data, value) || !isDeepStrictEqual(invocation.input.context.playbook, captured)) return null;
    const r = parsed.data, expected = policy.data[r.mode];
    const digest = createHash("sha256").update(JSON.stringify({ input: invocation.input, references: invocation.references })).digest("hex");
    if ((r.mode === "paid" && !policy.data.paid_enabled) || (r.mode === "fallback" && !policy.data.fallback_enabled) || r.request_id !== requestId || r.input_digest !== digest || r.model_provider !== expected.model_provider || r.model_id !== expected.model_id ||
        (r.mode === "fallback" && r.routing_reason !== (policy.data.paid_enabled ? "budget_exhausted" : "paid_unavailable"))) return null;
    const inspected = inspectPlaybookResult(r.data, captured);
    return inspected.ok ? { envelope: r, coverage: inspected.coverage } : null;
  } catch { return null; }
}

/** One protected owner; no persistence or draft editor. Readers must synchronously
 * consult the authoritative current source owner, never a recycled request argument.
 * Only explicit method calls run. All actual awaits are bracketed by fresh reads.
 */
export function createPlaybookGenerator(options: Parameters<typeof createAIRouter>[0] = {}) {
  const invoke = createAIRouter(options);
  const issued = new WeakMap<object, PlaybookInput>();
  function current(prior: unknown, readSource: PlaybookSourceReader): boolean {
    try { const captured = prior && typeof prior === "object" ? issued.get(prior) : null, latest = readSource(); return !!captured && !!latest && matchesPlaybookInput(captured, latest); }
    catch { return false; }
  }
  async function run(operation: "generate" | "regenerate", readSource: PlaybookSourceReader, caller: unknown, prior?: unknown): Promise<PlaybookOutcome> {
    const requestId = randomUUID(); // Never caller-selected or reused by regeneration.
    try {
      if (operation === "regenerate" && (!prior || typeof prior !== "object" || !issued.has(prior))) return safeError("invalid_previous_draft", requestId);
      if (typeof readSource !== "function") return safeError("invalid_input", requestId);
      const source = readSource(); if (!source) return safeError("invalid_input", requestId);
      const built = buildPlaybookInvocation(source); if (!built.ok) return safeError(built.code, requestId);
      const identity = Caller.safeParse(caller); if (!identity.success) return safeError("controls_unavailable", requestId);
      const fresh = () => { try { const latest = readSource(); return !!latest && matchesPlaybookInput(built.input, latest); } catch { return false; } };
      if (!fresh()) return safeError("source_changed", requestId);
      // Router retains all reservation/rate/concurrency/fallback/settlement checks.
      const result = await invoke(built.request, PLAYBOOK_OUTPUT_CONTRACT, { ...identity.data, request_id: requestId });
      if (!fresh()) return safeError("source_changed", requestId);
      if (!result.ok) return safeError(result.error.code, requestId);
      const validated = validatePlaybookEnvelope(result.result, built.request, built.input, requestId, options.policy);
      if (!validated) return safeError("invalid_model_output", requestId);
      const checked = PlaybookOutcomeSchema.safeParse({ status: validated.coverage.status === "complete" ? "success" : "incomplete", operation,
        ...validated, source: built.input.source });
      if (!checked.success || checked.data.status === "error") return safeError("invalid_model_output", requestId);
      const accepted = freezeCSE(checked.data) as Accepted;
      issued.set(accepted, built.input); // Failed regeneration never replaces or mutates prior.
      return accepted;
    } catch { return safeError("unexpected_error", requestId); }
  }
  return Object.freeze({
    generate: (readSource: PlaybookSourceReader, caller?: unknown) => run("generate", readSource, caller),
    regenerate: (prior: unknown, readSource: PlaybookSourceReader, caller?: unknown) => run("regenerate", readSource, caller, prior),
    isCurrent: current,
  });
}
