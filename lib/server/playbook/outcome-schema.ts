import "server-only";
import { z } from "zod";
import { FailureCodeSchema, SourceIdSchema, resultEnvelopeSchema } from "../ai/base-contracts.ts";
import { PlaybookInputSchema } from "./input-schema.ts";
import { PlaybookResultSchema, PlaybookEnvelopeSchema } from "./schema.ts";

const Operation = z.enum(["generate", "regenerate"]);
const LocalCode = z.enum(["source_changed", "invalid_previous_draft"]);
export const PlaybookErrorSchema = z.strictObject({ status: z.literal("error"), error: z.strictObject({
  code: z.union([FailureCodeSchema, LocalCode]), request_id: z.uuid().nullable(), message: z.string().min(1).max(160),
}) });
const Coverage = z.strictObject({ status: z.enum(["complete", "incomplete"]), missing_app_ids: z.array(SourceIdSchema).max(100),
  missing_tsa_ids: z.array(SourceIdSchema).max(100), missing_action_ids: z.array(SourceIdSchema).max(200),
  not_addressed: PlaybookResultSchema.shape.not_addressed, incomplete_context: PlaybookInputSchema.shape.incomplete_context });
export const PlaybookOutcomeSchema = z.union([PlaybookErrorSchema, z.strictObject({ status: z.enum(["success", "incomplete"]),
  operation: Operation, envelope: PlaybookEnvelopeSchema, coverage: Coverage, source: PlaybookInputSchema.shape.source,
})]).superRefine((r, ctx) => {
  if (r.status !== "error" && ((r.status === "success") !== (r.coverage.status === "complete") || r.coverage.status !== r.envelope.data.coverage_status)) ctx.addIssue({ code: "custom", message: "Playbook outcome coverage mismatch" });
});
export type PlaybookOutcome = z.infer<typeof PlaybookOutcomeSchema>;
