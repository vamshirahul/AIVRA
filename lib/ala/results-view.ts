// Display-only types. Server imports below are erased; no client hashing or AI execution.
import type { ALAResult, ALACoverage } from "../server/ala/schema.ts";
import type { AIResultMetadata } from "../ai/ai-view-state.ts";

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
declare const trustedProjection: unique symbol;
export type ALAResultsData = Immutable<{
  [trustedProjection]: true;
  metadata: AIResultMetadata;
  provenance: { prompt_version: string; generated_at: string; request_id: string; input_digest: string };
  source_revision: number;
  currency: string;
  coverage: ALACoverage;
  findings: (ALAResult["findings"][number] & {
    buyer: { app_id: string; name: string }[];
    target: { app_id: string; name: string }[];
    source_evidence: { app_id: string; attribute: string; value: string | number | null }[];
  })[];
  missing: { app_id: string; side: "buyer" | "target" }[];
  not_evaluated: ALAResult["not_evaluated"];
}>;
export type ALAResultsView =
  | { readonly state: "absent" | "invalid" | "outdated" }
  | { readonly state: "current" | "incomplete"; readonly data: ALAResultsData };
