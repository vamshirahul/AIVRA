import "server-only";
import { DemoSessionSchema } from "../../session/session.ts";
import type { LicenseResultsData, LicenseResultsView } from "../../license-optimizer/results-view.ts";
import { MAX_LICENSE_VIEW_BYTES } from "../../license-optimizer/results-view.ts";
import { inspectLicenseOutcome } from "./analyze.ts";

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
/** Trusted server composition ONLY. Hashes/brands are not execution attestation.
 * No current public route accepts or delivers populated license results.
 */
export function projectLicenseResults(outcome: unknown, captured: unknown, current: unknown): LicenseResultsView {
  if (outcome == null) return Object.freeze({ state: "absent" });
  try {
    const checked = inspectLicenseOutcome(outcome, captured, current);
    if (checked.status !== "current") return Object.freeze({ state: checked.status });
    const source = DemoSessionSchema.parse(captured).current_deal;
    const licenses = new Map(source.license_positions.map((r) => [r.license_id, r]));
    const apps = new Map(source.applications.map((r) => [r.app_id, r]));
    const { data: original, ...provenance } = checked.outcome.envelope;
    const data = immutable({ provenance, source_token: checked.outcome.source_token, currency: source.currency,
      coverage: checked.outcome.coverage, not_evaluated: original.not_evaluated,
      findings: original.findings.map((finding) => ({ original: finding,
        applications: finding.app_ids.map((id) => { const app = apps.get(id)!; return { app_id: id, name: app.app_name, side: app.company_side }; }),
        source_evidence: finding.evidence.map((pointer) => {
          const record = licenses.get(pointer.license_id)!;
          const value = record[pointer.attribute];
          // Existing inspection rejects missing attributes; never fabricate a source value.
          if (value === undefined) throw new Error("Missing captured evidence");
          return { ...pointer, app_id: record.app_id, value };
        }),
      })),
    }) as unknown as LicenseResultsData;
    if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_LICENSE_VIEW_BYTES) return Object.freeze({ state: "invalid" });
    return Object.freeze({ state: checked.outcome.status === "success" ? "current" : "incomplete", data });
  } catch { return Object.freeze({ state: "invalid" }); }
}
