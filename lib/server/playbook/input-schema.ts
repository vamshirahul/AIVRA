import "server-only";
import { z } from "zod";
import { ApplicationSchema, TSAServiceSchema } from "../../contracts/demo.ts";
import { DemoSessionSchema } from "../../session/session.ts";
import { ReviewedALAExportSchema } from "../../ala/review-export.ts";
import { ScenarioDraftSchema } from "../../scenario-modeling/scenario-draft.ts";
import { CSEResultSchema } from "../../cost-synergy/calculation-contract.ts";

// Unchanged U04.01 schema extracted from input.ts so gateway validation has no
// dependency on ALA orchestration -> router -> adapter (no runtime import cycle).
export const PLAYBOOK_INPUT_VERSION = "playbook/input/v1" as const;
export const PLAYBOOK_PROMPT_VERSION = "playbook/v1" as const;
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Summary = CSEResultSchema.options[1].pick({ status: true, currency: true, money_unit: true, totals: true, warnings: true, conflicts: true });
export const PlaybookInputSchema = z.strictObject({
  contract_version: z.literal(PLAYBOOK_INPUT_VERSION), prompt_version: z.literal(PLAYBOOK_PROMPT_VERSION),
  illustrative_unapproved: z.literal(true),
  source: z.strictObject({ session_id: z.uuid(), fixture: DemoSessionSchema.shape.fixture,
    session_revision: DemoSessionSchema.shape.session_revision, input_revisions: DemoSessionSchema.shape.input_revisions,
    deal_digest: Digest, review_digest: Digest, scenario_digest: Digest }),
  applications: z.array(ApplicationSchema).min(2).max(100), tsa_services: z.array(TSAServiceSchema).max(100),
  reviewed_ala: ReviewedALAExportSchema,
  selected_scenario: z.enum(["baseline", "alternative"]), scenario: ScenarioDraftSchema,
  financial_summary: Summary,
  incomplete_context: z.array(z.enum(["ala_incomplete", "financial_incomplete"])).max(2),
});
export type PlaybookInput = z.infer<typeof PlaybookInputSchema>;
