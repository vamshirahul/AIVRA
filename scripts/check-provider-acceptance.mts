import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./check-license-findings.mts";
import { setup, specimen } from "./check-playbook-contract.mts";
import { createALAAnalyzer } from "../lib/server/ala/analyze.ts";
import { createReviewDraft, saveReviewOverride } from "../lib/ala/review-overrides.ts";
import { projectLicenseResults } from "../lib/server/licenses/presentation.ts";
import { createLicenseSelectionDraft, saveLicenseSelection, licenseReviewIdentity } from "../lib/license-optimizer/review-selections.ts";
import { createPlaybookReviewSource } from "../lib/server/playbook/review-source.ts";
import { createPlaybookReviewDraft, projectPlaybookReview, savePlaybookEdit } from "../lib/playbook-generator/review-draft.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { createLicenseAnalyzer, inspectLicenseOutcome } from "../lib/server/licenses/analyze.ts";
import { createPlaybookGenerator } from "../lib/server/playbook/generate.ts";
import { preparePlaybookContract } from "../lib/server/playbook/contract.ts";
import { createAssistantAskOwner } from "../lib/server/assistant/ask.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { reservationUnits, EnabledPolicySchema } from "../lib/server/ai/control-policy.ts";
import { presentAIState } from "../lib/ai/ai-view-state.ts";
import { TransportFailure } from "../lib/server/ai/contracts.ts";
import type { InvocationInput, StructuredTransport } from "../lib/server/ai/contracts.ts";
import type { UsageStore } from "../lib/server/ai/usage-store.ts";

// Cross-module qualification only. Existing control suites retain detailed store,
// race, quota and hard-stop tests; no second routing implementation is introduced.
const caller = { client_key: "a".repeat(64) }, seed = setup(), session = seed.inputs.current_session;
const question = { contract_version: "assistant/ask/v1", question: "Describe available fictional evidence only." };
const canary = "PRIVATE_FAKE_CREDENTIAL_AND_PROVIDER_BODY";
const evidence: { module: string; scenario: string; result: string }[] = [];
let network = 0; const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { network++; throw Error("External requests forbidden in U90.02"); };
try {
  const licenseSeed = fixture(), license = await licenseSeed.analyze(session, caller); assert.notEqual(license.status, "error"); if (license.status === "error") throw Error();
  const prepared = preparePlaybookContract(seed.inputs); assert.ok(prepared.ok);
  const output = (module: string, input: InvocationInput): unknown => {
    if (module === "ala") return structuredClone(seed.inputs.outcome.envelope.data);
    if (module === "licenses") return structuredClone(license.envelope.data);
    if (module === "playbook") return specimen(prepared.input);
    const context = input.context.assistant!.context;
    return { contract_version: "assistant/answer/v1", status: "answered", answer: "Fabricated offline draft, not genuine model analysis.", citations: [context.allowed_references.find(r => r.kind === "application")!], missing_context: context.missing_context, illustrative_unapproved: true, narrative_not_verified: true };
  };
  type Scenario = "healthy" | "exception" | "unavailable" | "timeout" | "malformed" | "citation" | "invalid_usage" | "missing_usage" | "authorize" | "settle";
  for (const module of ["ala", "licenses", "playbook", "assistant"] as const) {
    const successfulData: unknown[] = [];
    for (const route of ["paid", "budget_fallback", "disabled_paid_fallback"] as const) {
      const base = fixture(), p = EnabledPolicySchema.parse({ ...base.p, timeout_ms: 5, ...(route === "budget_fallback" ? { paid: { ...base.p.paid, monthly_budget_units: 1 } } : {}), ...(route === "disabled_paid_fallback" ? { paid_enabled: false } : {}) });
      let scenario: Scenario = "healthy", paid = 0, fallback = 0, elapsed = 0;
      const clock = () => base.clock() + elapsed, rawStore = createFakeUsageStore(clock);
      const store: UsageStore = { ...rawStore,
        authorizeAndReserve: async r => { if (scenario === "authorize") throw Error(canary); return rawStore.authorizeAndReserve(r); },
        settle: async r => { if (scenario === "settle") throw Error(canary); return rawStore.settle(r); } };
      const send: StructuredTransport["generate"] = async call => {
        if (scenario === "exception") throw Error(canary);
        if (scenario === "unavailable") throw new TransportFailure("provider_unavailable");
        if (scenario === "timeout") return new Promise(() => {});
        let data = output(module, call.input);
        if (scenario === "malformed") data = { private_extra_key: canary };
        if (scenario === "citation") data = JSON.parse(JSON.stringify(data).replaceAll((module === "licenses" ? session.current_deal.license_positions[0].app_id : session.current_deal.applications[0].app_id), "invented_source_reference"));
        return { output: data, ...(scenario === "missing_usage" ? {} : { usage: { inputTokens: scenario === "invalid_usage" ? -1 : 10, outputTokens: 5 } }) };
      };
      const options = { policy: p, execution: "offline-test" as const, store, clock,
        paid: { model_provider: p.paid.model_provider, model_id: p.paid.model_id, generate: async (c: Parameters<typeof send>[0]) => { paid++; return send(c); } },
        fallback: { model_provider: p.fallback.model_provider, model_id: p.fallback.model_id, generate: async (c: Parameters<typeof send>[0]) => { fallback++; return send(c); } } };
      const ala = createALAAnalyzer(options), licenses = createLicenseAnalyzer(options), plan = createPlaybookGenerator(options), assistant = createAssistantAskOwner(options);
      const readPlan = () => seed.inputs, conversation = assistant.createConversation(() => ({ session })); assert.equal(conversation.status, "ready"); if (conversation.status !== "ready") throw Error();
      const run = () => module === "ala" ? ala(session, caller) : module === "licenses" ? licenses(session, caller) : module === "playbook" ? plan.generate(readPlan, caller) : assistant.ask(conversation.conversation, question, caller);
      const before = JSON.stringify(seed.inputs), accepted = await run(); assert.notEqual(accepted.status, "error", JSON.stringify(accepted)); if (accepted.status === "error") throw Error();
      const mode = route === "paid" ? "paid" : "fallback"; assert.equal(accepted.envelope.mode, mode); assert.equal(accepted.envelope.model_provider, p[mode].model_provider); assert.equal(accepted.envelope.model_id, p[mode].model_id);
      assert.equal(accepted.envelope.routing_reason, route === "paid" ? undefined : route === "budget_fallback" ? "budget_exhausted" : "paid_unavailable");
      assert.deepEqual({ paid, fallback }, mode === "paid" ? { paid: 1, fallback: 0 } : { paid: 0, fallback: 1 });
      successfulData.push(accepted.envelope.data);
      evidence.push({ module, scenario: route, result: "PASS: same specimen, exact server-selected provenance, one dispatch" });
      if (route === "disabled_paid_fallback") continue;
      let visitorReview: unknown = null;
      if (module === "ala") {
        const view = projectALAResults(accepted, session, session); assert.ok("data" in view); const draft = createReviewDraft(view); assert.ok(draft); const f = view.data.findings[0], a = f.actions[0];
        const saved = saveReviewOverride(view, draft, { result_identity: draft.result_identity, finding_id: f.finding_id, action_id: a.action_id, subject: a.subject, proposed_disposition: "Retain", proposed_destination: null, visitor_reason: "Explicit offline visitor proposal" }); assert.ok(saved.ok); visitorReview = saved.draft;
      }
      if (module === "licenses") {
        const view = projectLicenseResults(accepted, session, session); assert.ok("data" in view); const draft = createLicenseSelectionDraft(view); assert.ok(draft);
        const saved = saveLicenseSelection(view, draft, { result_identity: licenseReviewIdentity(view), finding_id: view.data.findings[0].original.finding_id, status: "selected" }); assert.ok(saved.ok); visitorReview = saved.draft;
      }
      if (module === "playbook") {
        // This isolated source is immutable for the whole failure matrix.
        const source = createPlaybookReviewSource(plan, accepted, readPlan, () => () => {}), draft = createPlaybookReviewDraft(source); assert.ok(draft); const view = projectPlaybookReview(source, draft)!; const row = view.activities[0];
        const saved = savePlaybookEdit(source, draft, { binding: draft.binding, kind: "activity", id: row.id, values: { ...row.values, title: "Visitor provisional wording" }, visitor_reason: "Explicit offline proposal" }); assert.ok(saved.ok); visitorReview = saved.draft;
      }
      const reviewJSON = JSON.stringify(visitorReview), acceptedJSON = JSON.stringify(accepted), history = assistant.getHistory(conversation.conversation);
      // Same owner retains the accepted result. Advancing only the fake clock
      // clears rate windows/leases without clearing accounted exposure.
      for (const next of ["exception", "unavailable", "timeout", "malformed", "citation", "invalid_usage", "authorize", "settle"] as const) {
        // Existing base policy permits ten requests and three active route leases;
        // independently authorize each row by clearing leases/rate windows using
        // the reference store's server clock, never clearing its ledger.
        scenario = next;
        const prior = await rawStore.getSafeUsageStatus({ namespace: p.namespace, period_key: p.period_key });
        const oldCalls = paid + fallback, result = await run(); assert.equal(result.status, "error", `${module}/${next}: ${JSON.stringify(result)}`); if (result.status !== "error") throw Error();
        const expected = next === "authorize" || next === "settle" ? "controls_unavailable" : next === "exception" || next === "unavailable" || next === "timeout" ? "provider_unavailable" : "invalid_model_output";
        assert.equal(result.error.code, expected); assert.ok(JSON.stringify(result).length < 600); assert.ok(!JSON.stringify(result).includes(canary)); assert.ok(!("envelope" in result));
        assert.equal(paid + fallback - oldCalls, next === "authorize" ? 0 : 1); assert.equal(mode === "paid" ? fallback : paid, 0);
        const after = await rawStore.getSafeUsageStatus({ namespace: p.namespace, period_key: p.period_key });
        assert.equal(after[mode].requests_month - prior[mode].requests_month, next === "authorize" ? 0 : 1);
        assert.equal(after[mode].in_flight - prior[mode].in_flight, next === "authorize" ? 0 : 1);
        assert.equal(after[mode].accounted_units - prior[mode].accounted_units, next === "authorize" ? 0 : reservationUnits(p, mode));
        assert.equal(JSON.stringify(seed.inputs), before); assert.equal(JSON.stringify(accepted), acceptedJSON); assert.equal(JSON.stringify(visitorReview), reviewJSON); assert.equal(assistant.getHistory(conversation.conversation), history);
        if (module === "ala") assert.equal(projectALAResults(accepted, session, session).state, "current");
        if (module === "licenses") assert.equal(inspectLicenseOutcome(accepted, session, session).status, "current");
        if (module === "playbook") assert.ok(plan.isCurrent(accepted, readPlan));
        if (module === "assistant") assert.ok(assistant.isCurrent(accepted));
        const notice = presentAIState({ status: "error", safeErrorCode: result.error.code }); assert.equal(notice.role, "alert"); assert.match(notice.message, /session data is retained/); assert.ok(!JSON.stringify(notice).includes(canary));
        elapsed += Math.max(p.lease_ms, p.global_window_ms, p.client_window_ms) + 1;
        evidence.push({ module, scenario: route + "/" + next, result: "PASS: bounded safe error, prior result/session retained, no failover/retry, conservative exposure" });
      }
      scenario = "missing_usage";
      const beforeUnknown = await rawStore.getSafeUsageStatus({ namespace: p.namespace, period_key: p.period_key }), unknown = await run();
      assert.notEqual(unknown.status, "error", JSON.stringify(unknown)); if (unknown.status === "error") throw Error();
      assert.equal(unknown.envelope.usage_estimate.input_tokens, null);
      const afterUnknown = await rawStore.getSafeUsageStatus({ namespace: p.namespace, period_key: p.period_key });
      assert.equal(afterUnknown[mode].accounted_units - beforeUnknown[mode].accounted_units, reservationUnits(p, mode));
      assert.equal(JSON.stringify(seed.inputs), before); assert.equal(mode === "paid" ? fallback : paid, 0);
      evidence.push({ module, scenario: route + "/missing_usage", result: "PASS: valid output allowed, usage unknown, full exposure retained without refund" });
    }
    assert.deepEqual(successfulData[0], successfulData[1]); assert.deepEqual(successfulData[1], successfulData[2]);
  }
  assert.equal(network, 0); await mkdir(".temp/u90-02", { recursive: true }); await writeFile(".temp/u90-02/provider-acceptance.json", JSON.stringify({ evidence, external_requests: network, live_model_execution: "NOT RUN / UNAUTHORIZED" }, null, 2));
  console.log(`PASS: ${evidence.length} U90.02 cross-module route/failure rows; same fixtures, no external calls.`);
} finally { globalThis.fetch = oldFetch; }
