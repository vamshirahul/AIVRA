import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DemoSessionSchema, MAX_SESSION_CHARACTERS } from "../../session/session.ts";
import { metadataFromValidatedResult } from "../../ai/ai-view-state.ts";
import type { ALAResultsData, ALAResultsView } from "../../ala/results-view.ts";
import { ALAAnalyzeOutcomeSchema } from "./analyze.ts";
import { buildALARequest, matchesALASource } from "./request.ts";
import { ALA_OUTPUT_CONTRACT, inspectALAResult } from "./schema.ts";
import { MAX_OUTPUT_BYTES, ReferencePolicySchema } from "../ai/contracts.ts";

function snapshot(value: unknown) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string" || serialized.length > MAX_SESSION_CHARACTERS) return null;
  const parsed = DemoSessionSchema.safeParse(value);
  return parsed.success && isDeepStrictEqual(parsed.data, value) ? parsed.data : null;
}
function immutable<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}

/** Trusted server handoff ONLY, not execution attestation or an HTTP/client JSON entrypoint.
 * Future callers must obtain outcomes from an approved protected production path.
 * There is no such public successful-result source today.
 */
export function projectALAResults(outcome: unknown, capturedSource: unknown, currentSource: unknown): ALAResultsView {
  if (outcome === null || outcome === undefined) return Object.freeze({ state: "absent" });
  try {
    const serialized = JSON.stringify(outcome);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) return { state: "invalid" };
    const parsed = ALAAnalyzeOutcomeSchema.safeParse(outcome);
    if (!parsed.success || parsed.data.status === "error" || !isDeepStrictEqual(parsed.data, outcome)) return { state: "invalid" };
    const result = parsed.data, captured = snapshot(capturedSource), current = snapshot(currentSource);
    if (!captured || !current || !matchesALASource(result.source_token, captured)) return { state: "invalid" };
    const inspection = inspectALAResult(result.envelope.data, captured.current_deal.applications);
    if (!inspection.ok || !isDeepStrictEqual(inspection.coverage, result.coverage)) return { state: "invalid" };
    // Same full-input/reference-policy digest as the existing adapter, using captured input.
    const built = buildALARequest(captured);
    if (!built.ok) return { state: "invalid" };
    const references = ReferencePolicySchema.parse({ allow_empty: ALA_OUTPUT_CONTRACT.references.allow_empty, duplicates: ALA_OUTPUT_CONTRACT.references.duplicates });
    const digest = createHash("sha256").update(JSON.stringify({ input: built.request, references })).digest("hex");
    if (digest !== result.envelope.input_digest) return { state: "invalid" };
    if (!matchesALASource(result.source_token, current)) return Object.freeze({ state: "outdated" });
    const metadata = metadataFromValidatedResult(result.envelope);
    if (!metadata) return { state: "invalid" };
    const apps = captured.current_deal.applications, byId = new Map(apps.map((app) => [app.app_id, app]));
    const member = (app_id: string) => ({ app_id, name: byId.get(app_id)!.app_name });
    const unevaluated = new Map(inspection.data.not_evaluated.map((item) => [item.app_id, item]));
    const missing = new Set([...inspection.coverage.buyer.missing_app_ids, ...inspection.coverage.target.missing_app_ids]);
    const envelope = result.envelope;
    const data = immutable({ metadata, provenance: { prompt_version: envelope.prompt_version, generated_at: envelope.generated_at,
      request_id: envelope.request_id, input_digest: envelope.input_digest }, source_revision: result.source_token.application_revision,
      currency: captured.current_deal.currency, coverage: inspection.coverage,
      findings: inspection.data.findings.map((finding) => ({ ...finding,
        buyer: finding.buyer_app_ids.map(member), target: finding.target_app_ids.map(member),
        source_evidence: finding.evidence.map((pointer) => ({ ...pointer, value: byId.get(pointer.app_id)![pointer.attribute] })),
      })),
      missing: apps.filter((app) => missing.has(app.app_id)).map((app) => ({ app_id: app.app_id, side: app.company_side })),
      not_evaluated: apps.filter((app) => unevaluated.has(app.app_id)).map((app) => unevaluated.get(app.app_id)!),
    // The opaque compile-time brand is granted only here, after every validation above.
    // It is not serialized authentication or proof of model execution.
    }) as unknown as ALAResultsData;
    return Object.freeze({ state: inspection.coverage.status === "complete" ? "current" : "incomplete", data });
  } catch { return Object.freeze({ state: "invalid" }); }
}
