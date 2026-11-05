import "server-only";
import { z } from "zod";
import { SyntheticDealFixtureSchema } from "../../contracts/demo.ts";
import { DemoSessionSchema } from "../../session/session.ts";
import { ReviewedALAExportSchema } from "../../ala/review-export.ts";
import { CSERequestSchema } from "../../cost-synergy/calculation-contract.ts";
import { ScenarioFinancialDraftSchema } from "../../scenario-modeling/scenario-draft.ts";
import { PlaybookReviewDraftSchema } from "../../playbook-generator/review-draft.ts";
import { ALAAnalyzeOutcomeSchema } from "../ala/outcome-schema.ts";
import { LicenseAnalyzeOutcomeSchema } from "../licenses/outcome-schema.ts";
import { PlaybookOutcomeSchema } from "../playbook/outcome-schema.ts";
import { SourceIdSchema } from "../ai/base-contracts.ts";

export const ASSISTANT_CONTEXT_VERSION = "assistant/context/v1" as const;
const LocalId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
export const AssistantSectionSchema = z.enum(["deal", "ala", "ala_review", "license_findings", "assumptions", "playbook", "playbook_review"]);
/** Namespaced references, never free-text URLs, names, JSON paths or inferred IDs. */
export const AssistantReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("section"), section: AssistantSectionSchema }),
  z.strictObject({ kind: z.literal("application"), app_id: SourceIdSchema, side: z.enum(["buyer", "target"]) }),
  z.strictObject({ kind: z.literal("license"), license_id: SourceIdSchema, app_id: SourceIdSchema }),
  z.strictObject({ kind: z.literal("tsa"), tsa_id: SourceIdSchema }),
  z.strictObject({ kind: z.literal("ala_finding"), finding_id: LocalId }),
  z.strictObject({ kind: z.literal("ala_action"), finding_id: LocalId, action_id: LocalId }),
  z.strictObject({ kind: z.literal("license_finding"), finding_id: LocalId }),
  z.strictObject({ kind: z.literal("assumption"), line_id: LocalId }),
  ...(["phase", "activity", "milestone", "risk"] as const).map(kind => z.strictObject({ kind: z.literal(`playbook_${kind}`), id: LocalId })),
]);
export type AssistantReference = z.infer<typeof AssistantReferenceSchema>;
export const AssistantReferencesSchema = z.array(AssistantReferenceSchema).max(400);
export const AssistantMissingStateSchema = z.enum(["absent", "outdated", "invalid", "unavailable"]);
const Missing = z.strictObject({ state: AssistantMissingStateSchema });
const available = <T extends z.ZodType>(schema: T) => z.union([Missing, z.strictObject({ state: z.enum(["current", "incomplete"]), data: schema })]);
export const ASSISTANT_DISCLOSURES = [
  "Synthetic current-session context only; original AI drafts, visitor edits and assumptions remain separate and unapproved.",
  "Missing or stale sections are unavailable evidence, not zero values or permission to invent facts. Citations validate membership, not narrative truth or confidence.",
  "This contract does not run AI or produce an answer. Ask, bounded history and chat presentation belong to later units; live AI remains disabled.",
] as const;
export const AssistantContextSchema = z.strictObject({
  contract_version: z.literal(ASSISTANT_CONTEXT_VERSION), illustrative_unapproved: z.literal(true),
  disclosures: z.tuple([z.literal(ASSISTANT_DISCLOSURES[0]), z.literal(ASSISTANT_DISCLOSURES[1]), z.literal(ASSISTANT_DISCLOSURES[2])]),
  source: z.strictObject({ session_id: z.uuid(), fixture: DemoSessionSchema.shape.fixture, session_revision: DemoSessionSchema.shape.session_revision,
    input_revisions: DemoSessionSchema.shape.input_revisions, deal_digest: z.string().regex(/^[a-f0-9]{64}$/) }),
  deal: SyntheticDealFixtureSchema,
  ala: available(z.strictObject({ original: ALAAnalyzeOutcomeSchema.refine(v => v.status !== "error"), reviewed: ReviewedALAExportSchema.nullable() })),
  license_findings: available(LicenseAnalyzeOutcomeSchema.refine(v => v.status !== "error")),
  assumptions: available(z.strictObject({ visitor_draft: ScenarioFinancialDraftSchema, normalized_request: CSERequestSchema })),
  playbook: available(z.strictObject({ original: PlaybookOutcomeSchema.refine(v => v.status !== "error"), selected_scenario: z.enum(["baseline", "alternative"]), review: PlaybookReviewDraftSchema.nullable() })),
  missing_context: z.array(z.strictObject({ section: AssistantSectionSchema, state: z.union([AssistantMissingStateSchema, z.literal("incomplete")]) })).max(7),
  allowed_references: AssistantReferencesSchema,
});
export type AssistantContext = z.infer<typeof AssistantContextSchema>;
