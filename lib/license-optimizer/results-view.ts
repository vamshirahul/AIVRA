// Display-only imports are erased. No server runtime, hashing or AI execution in clients.
import type { LicenseResult, LicenseCoverageSchema } from "../server/licenses/schema.ts";
import type { LicenseSourceToken } from "../server/licenses/request.ts";
import type { ResultEnvelope } from "../server/ai/contracts.ts";
import type { z } from "zod";

export const MAX_LICENSE_VIEW_BYTES = 512_000;

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
declare const trustedProjection: unique symbol;
export type LicenseResultsData = Immutable<{
  [trustedProjection]: true;
  provenance: Omit<ResultEnvelope<LicenseResult>, "data">;
  source_token: LicenseSourceToken;
  currency: string;
  coverage: z.infer<typeof LicenseCoverageSchema>;
  findings: {
    original: LicenseResult["findings"][number];
    applications: { app_id: string; name: string; side: "buyer" | "target" }[];
    source_evidence: { license_id: string; app_id: string; attribute: string; value: string | number | null }[];
  }[];
  not_evaluated: LicenseResult["not_evaluated"];
}>;
export type LicenseResultsView =
  | { readonly state: "absent" | "invalid" | "outdated" }
  | { readonly state: "current" | "incomplete"; readonly data: LicenseResultsData };
