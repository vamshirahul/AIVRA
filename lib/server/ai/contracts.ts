import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { SyntheticDealFixtureSchema } from "../../contracts/demo.ts";
import { PlaybookInputSchema, PLAYBOOK_PROMPT_VERSION } from "../playbook/input-schema.ts";
import { PLAYBOOK_SYSTEM_PROMPT } from "../playbook/prompt.ts";

import { AssistantAskPayloadSchema, ASSISTANT_PROMPT_VERSION, inspectAssistantAnswer } from "../assistant/ask-schema.ts";
import { ASSISTANT_SYSTEM_PROMPT } from "../assistant/prompt.ts";
import { SourceIdSchema, ModuleSchema } from "./base-contracts.ts";
export * from "./base-contracts.ts";
export const InvocationSchema = z.strictObject({
  module: ModuleSchema,
  prompt_version: z.string().max(64).regex(/^[a-z][a-z0-9_-]{0,31}\/v[1-9][0-9]{0,3}$/),
  system: z.string().trim().min(1).max(4_000),
  context: z.strictObject({ deal: SyntheticDealFixtureSchema, user_text: z.string().max(2_000).optional(), playbook: PlaybookInputSchema.optional(), assistant: AssistantAskPayloadSchema.optional() }),
  allowed_source_ids: z.array(SourceIdSchema).max(400),
}).superRefine((input, ctx) => {
  const deal = input.context.deal;
  const assistant = input.context.assistant;
  if (Object.hasOwn(input.context, "assistant") || input.prompt_version === ASSISTANT_PROMPT_VERSION) {
    const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
    if (!assistant || input.module !== "assistant" || input.prompt_version !== ASSISTANT_PROMPT_VERSION || input.system !== ASSISTANT_SYSTEM_PROMPT || input.allowed_source_ids.length !== 0 || Object.hasOwn(input.context, "user_text") || Object.hasOwn(input.context, "playbook") ||
        !isDeepStrictEqual(assistant.context.deal, deal) || assistant.context.source.deal_digest !== digest(deal) ||
        !isDeepStrictEqual(assistant.context.source.fixture,{fixture_id:deal.fixture_id,schema_version:deal.schema_version,dataset_version:deal.dataset_version}) ||
        assistant.history.turns.some(t => !inspectAssistantAnswer(t.envelope.data, assistant.context)) ||
        assistant.history.session_id !== assistant.context.source.session_id || assistant.history.context_digest !== digest(assistant.context) ||
        Buffer.byteLength(JSON.stringify(assistant.history),"utf8") > 32_000) ctx.addIssue({code:"custom",message:"Invalid typed Assistant context, history or server instructions"});
  } else if (!input.allowed_source_ids.length) ctx.addIssue({code:"custom",message:"Legacy invocations require known source IDs"});

  const playbook = input.context.playbook;
  if (input.module === "playbook") {
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const expectedIds = [...deal.applications.map((a) => a.app_id), ...deal.tsa_services.map((t) => t.tsa_id)];
    if (!playbook || input.prompt_version !== PLAYBOOK_PROMPT_VERSION || input.system !== PLAYBOOK_SYSTEM_PROMPT || Object.hasOwn(input.context, "user_text") ||
        !isDeepStrictEqual(input.allowed_source_ids, expectedIds) || !isDeepStrictEqual(playbook.applications, deal.applications) || !isDeepStrictEqual(playbook.tsa_services, deal.tsa_services) ||
        playbook.source.deal_digest !== hash(deal) || !isDeepStrictEqual(playbook.source.fixture, { fixture_id: deal.fixture_id, schema_version: deal.schema_version, dataset_version: deal.dataset_version }) ||
        playbook.source.scenario_digest !== hash({ scenario: playbook.scenario, selected_scenario: playbook.selected_scenario }) ||
        playbook.source.review_digest !== playbook.scenario.source_binding.review_digest ||
        playbook.source.review_digest !== hash({ review: playbook.reviewed_ala.review, effective_actions: playbook.reviewed_ala.effective_actions })) {
      ctx.addIssue({ code: "custom", message: "Invalid Playbook structured context, source binding or server instructions" });
    }
  } else if (Object.hasOwn(input.context, "playbook") || input.prompt_version === PLAYBOOK_PROMPT_VERSION) {
    ctx.addIssue({ code: "custom", message: "Playbook context is restricted to its own module" });
  }
  if (deal.applications.length > 100 || ["buyer", "target"].some((side) => deal.applications.filter((app) => app.company_side === side).length > 50) || deal.license_positions.length > 200 || deal.tsa_services.length > 100) {
    ctx.addIssue({ code: "too_big", origin: "array", maximum: 100, inclusive: true, message: "Source record limit exceeded" });
  }
  const known = new Set([...deal.applications.map((r) => r.app_id), ...deal.license_positions.map((r) => r.license_id), ...deal.tsa_services.map((r) => r.tsa_id)]);
  if (new Set(input.allowed_source_ids).size !== input.allowed_source_ids.length || input.allowed_source_ids.some((id) => !known.has(id))) {
    ctx.addIssue({ code: "custom", path: ["allowed_source_ids"], message: "Expected unique source IDs present in context" });
  }
});
export type InvocationInput = z.infer<typeof InvocationSchema>;
