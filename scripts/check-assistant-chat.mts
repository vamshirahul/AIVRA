import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fixture as licenseFixture } from "./check-license-findings.mts";
import { fixture as playbookFixture } from "./check-playbook-review.mts";
import { createDemoSession, updateTSA } from "../lib/session/session.ts";
import { prepareCSEContext } from "../lib/server/cost-synergy/reviewed-context.ts";
import { createAssistantAskOwner } from "../lib/server/assistant/ask.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { createAssistantChatSource } from "../lib/server/assistant/chat-presenter.ts";
import { createAssistantChatController, canAskChat } from "../lib/ai-assistant/chat-controller.ts";
import { validChatView, validChatCitation, citationLabel, questionError } from "../lib/ai-assistant/chat-view.ts";
import type { AssistantSources } from "../lib/server/assistant/context.ts";
import type { EnabledPolicy } from "../lib/server/ai/control-policy.ts";
import type { UsageStore } from "../lib/server/ai/usage-store.ts";
import type { InvocationInput } from "../lib/server/ai/contracts.ts";
import type { StructuredTransport } from "../lib/server/ai/base-contracts.ts";
import type { AssistantChatSource, ChatAvailability, ChatView } from "../lib/ai-assistant/chat-view.ts";

// Fake providers and delivery views only in this offline script and loopback harness.
export async function chatFixture(rich = false, fallback = false, configure: { policy?: Partial<EnabledPolicy>; store?: (store: UsageStore) => UsageStore } = {}) {
  const base = licenseFixture(), p = { ...base.p, paid_enabled: !fallback, ...configure.policy };
  let inputs: AssistantSources = { session: createDemoSession() };
  if (rich) {
    const playbook = await playbookFixture(true), original = playbook.read(), session = original.current_session;
    const license = await base.analyze(session, { client_key: "a".repeat(64) }); assert.notEqual(license.status, "error");
    const context = prepareCSEContext(original.outcome, original.captured_session, session, original.review); assert.ok(context?.review_digest);
    inputs = { session, ala: { outcome: original.outcome, captured_session: original.captured_session, review: original.review }, licenses: { outcome: license, captured_session: session },
      assumptions: { captured_session: session, draft: original.financial_draft, expected_review_digest: context.review_digest }, playbook: { source: playbook.source, review: playbook.draft } };
  }
  const requests: InvocationInput[] = []; let outputTransform: ((output: unknown, input: InvocationInput) => unknown) | null = null;
  let providerHook: (() => void | Promise<void>) | null = null;
  const listeners = new Set<() => void>(); let calls = 0, hold: Promise<void> | null = null, release: (() => void) | null = null, insufficient = false, failure = false;
  const send: StructuredTransport["generate"] = async call => {
    calls++; requests.push(call.input); await providerHook?.(); if (hold) await hold; if (failure) throw Error("PRIVATE_PROVIDER_EXCEPTION");
    const c = call.input.context.assistant!.context, seen = new Set<string>();
    const citations = c.allowed_references.filter(r => { if (seen.has(r.kind)) return false; seen.add(r.kind); return true; });
    const target = c.allowed_references.find(r => r.kind === "application" && r.side === "target"); if (target) citations.push(target);
    for (const section of ["ala_review", "playbook_review"] as const) { const r = c.allowed_references.find(r => r.kind === "section" && r.section === section); if (r) citations.push(r); }
    const output = { contract_version: "assistant/answer/v1", status: insufficient ? "insufficient_evidence" : "answered",
      answer: insufficient ? "Offline test only: evidence is unavailable; do not infer a real answer." : 'Fabricated offline answer only. <script>window.__xss=1</script> [not a link](https://example.invalid)\nUnapproved illustration, never public analysis.',
      citations: insufficient ? [] : citations, missing_context: c.missing_context, illustrative_unapproved: true, narrative_not_verified: true };
    return { output: outputTransform ? outputTransform(output, call.input) : output, usage: { inputTokens: 10, outputTokens: 5 } };
  };
  let elapsed = 0; const clock = () => base.clock() + elapsed;
  const rawStore = createFakeUsageStore(clock), store = configure.store ? configure.store(rawStore) : rawStore;
  const owner = createAssistantAskOwner({ policy: p, execution: "offline-test", store, clock,
    paid: { model_provider: p.paid.model_provider, model_id: p.paid.model_id, generate: send }, fallback: { model_provider: p.fallback.model_provider, model_id: p.fallback.model_id, generate: send } });
  const source = createAssistantChatSource(owner, () => inputs, { client_key: "a".repeat(64) }, n => { listeners.add(n); return () => { listeners.delete(n); }; });
  return { source, owner, p, store, requests, advance: () => { elapsed += Math.max(p.lease_ms, p.client_window_ms, p.global_window_ms) + 1; }, read: () => inputs, replace: (next: AssistantSources) => { inputs = next; listeners.forEach(n => n()); },
    transform: (fn: typeof outputTransform) => { outputTransform = fn; }, providerHook: (fn: typeof providerHook) => { providerHook = fn; }, session: () => inputs.session as ReturnType<typeof createDemoSession>, calls: () => calls,
    change: () => { const s = inputs.session as ReturnType<typeof createDemoSession>; inputs = { ...inputs, session: updateTSA(s, s.current_deal.tsa_services[0].tsa_id, { status: "active" }) }; listeners.forEach(n => n()); },
    hold: () => { hold = new Promise<void>(r => { release = r; }); }, release: () => { hold = null; release?.(); },
    insufficient: () => { insufficient = true; }, fail: () => { failure = true; } };
}
function view(source: AssistantChatSource) { const s = source.getSnapshot(); assert.equal(s.state, "ready", JSON.stringify(s)); if (s.state !== "ready") throw Error(); return s.view; }
const question1 = '<img src=x onerror="window.__xss=1"> Offline question 1';
async function run() {
  let groups = 0, network = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { network++; throw Error("Offline chat tests forbid external requests"); };
  async function check(name: string, test: () => unknown | Promise<unknown>) { await test(); groups++; console.log(`PASS: ${name}`); }
  try {
    await check("public absent source has an honest disabled composer, no answer/network; question bounds never truncate", async () => {
      const session = createDemoSession(), c = createAssistantChatController(null, () => session); c.activate(); assert.equal(c.getSnapshot().phase, "ai_disabled"); assert.equal(c.getSnapshot().view, null);
      for (const q of ["", " ", "bad\u0000control", "x".repeat(2001)]) { c.setQuestion(q); assert.ok(c.getSnapshot().validation); assert.equal(c.getSnapshot().question, q); assert.equal(canAskChat(c.getSnapshot()), false); assert.equal(await c.submit(), false); }
      c.setQuestion("Prepared fictional question"); assert.equal(canAskChat(c.getSnapshot()), false); assert.equal(await c.submit(), false); c.reset(); assert.equal(c.getSnapshot().phase, "reset_completed"); assert.equal(c.getSnapshot().question, ""); c.dispose();
      assert.ok(questionError("x".repeat(2001))); assert.equal(questionError("x".repeat(2000)), null); assert.equal(network, 0);
    });
    await check("real guarded owner/presenter projection, readable exact citation categories, original/visitor labels and no internal data", async () => {
      const f = await chatFixture(true, true), c = createAssistantChatController(f.source, f.session), before = JSON.stringify(f.session()); assert.equal(f.calls(), 0); assert.ok(canAskChat({ ...c.getSnapshot(), question: question1 })); c.setQuestion(question1); assert.equal(await c.submit(), true);
      const snapshot = c.getSnapshot(); assert.equal(snapshot.phase, "answered"); assert.equal(snapshot.view?.turns.length, 1); const turn = snapshot.view!.turns[0]; assert.equal(turn.provenance.mode, "fallback"); assert.equal(turn.provenance.routing_reason, "paid_unavailable"); assert.ok(validChatView(snapshot.view));
      const labels = turn.answer.citations.map(citationLabel).join("\n"); for (const label of ["Buyer application", "Target application", "License", "TSA service", "ALA finding", "ALA action", "License finding", "Financial assumption", "Playbook phase", "Playbook activity", "Playbook milestone", "Playbook risk", "Visitor ALA review", "Visitor Playbook review"]) assert.ok(labels.includes(label), label);
      assert.equal(JSON.stringify(f.session()), before); const json = JSON.stringify(snapshot.view); for (const secret of ["client_key", "context_digest", "conversation_id", "session_id", "request_id", "input_digest", "system", "PRIVATE_PROVIDER_EXCEPTION"]) assert.ok(!json.includes(`"${secret}"`), secret);
      assert.equal(f.source.isCurrent(structuredClone(view(f.source))), false); c.dispose(); assert.equal(view(f.source).turns.length, 0);
      await mkdir(".temp/u10-03", { recursive: true }); await writeFile(".temp/u10-03/rich.json", JSON.stringify({ session: f.session(), view: snapshot.view }));
    });
    await check("submit duplicates blocked; Reset clears only chat and revokes pending reply; next Ask issues fresh conversation", async () => {
      const f = await chatFixture(), c = createAssistantChatController(f.source, f.session), before = JSON.stringify(f.session()); c.setQuestion("Offline question 1"); f.hold(); const pending = c.submit(); assert.equal(c.getSnapshot().phase, "submitting"); assert.equal(await c.submit(), false); for (let i=0;i<100&&f.calls()===0;i++) await new Promise(r=>setTimeout(r,0)); assert.equal(f.calls(), 1); c.reset(); assert.equal(c.getSnapshot().question, ""); assert.equal(c.getSnapshot().view?.turns.length, 0); f.release(); assert.equal(await pending, false); assert.equal(c.getSnapshot().phase, "reset_completed");
      c.setQuestion("Offline question 2"); assert.equal(await c.submit(), true); assert.equal(c.getSnapshot().view?.turns.length, 1); assert.equal(JSON.stringify(f.session()), before); c.dispose();
    });
    await check("source/session/Reset/navigation/unmount changes suppress old answers and async completion, without business mutations", async () => {
      const f = await chatFixture(), c = createAssistantChatController(f.source, f.session), unsubscribe = c.subscribe(() => {}); c.setQuestion("Offline question 1"); assert.equal(await c.submit(), true); f.hold(); c.setQuestion("Offline question 2"); const pending = c.submit(); f.change(); assert.equal(c.getSnapshot().phase, "stale"); assert.equal(c.getSnapshot().view, null); assert.equal(c.getSnapshot().question, ""); f.release(); assert.equal(await pending, false); assert.equal(c.getSnapshot().phase, "stale"); c.reset(); c.setQuestion("New source question"); assert.equal(await c.submit(), true); unsubscribe();
      f.hold(); c.setQuestion("Unmounted question"); const old = c.submit(); c.dispose(); f.release(); assert.equal(await old, false); assert.equal(c.getSnapshot().view, null);
    });
    await check("four-exchange/history-limit and insufficient-evidence states use actual owner limits, preserve ordered questions and empty citations", async () => {
      const f = await chatFixture(), c = createAssistantChatController(f.source, f.session), views = [view(f.source)];
      for (let i = 1; i <= 4; i++) { c.setQuestion(i === 1 ? question1 : `Offline question ${i}`); assert.equal(await c.submit(), true); views.push(view(f.source)); }
      assert.equal(c.getSnapshot().phase, "history_limit"); assert.equal(canAskChat({ ...c.getSnapshot(), question: "fifth" }), false); assert.equal(await c.submit(), false); assert.equal(f.calls(), 4); assert.deepEqual(c.getSnapshot().view?.turns.map(t => t.question), [question1, "Offline question 2", "Offline question 3", "Offline question 4"]);
      c.reset(); f.insufficient(); c.setQuestion("Missing evidence question"); assert.equal(await c.submit(), true); assert.equal(c.getSnapshot().phase, "insufficient_evidence"); const insufficient = view(f.source); assert.deepEqual(insufficient.turns[0].answer.citations, []);
      await writeFile(".temp/u10-03/fixture.json", JSON.stringify({ session: f.session(), views, insufficient })); c.dispose();
    });
    await check("safe error vocabulary, disabled/rate/budget/fallback/provider states; raw exceptions never displayed", async () => {
      for (const code of ["ai_disabled", "provider_unavailable", "paid_budget_exhausted", "fallback_unavailable", "rate_limited", "history_limit", "source_changed"] as const) {
        const f = await chatFixture(), source = { ...f.source, ask: async () => ({ status: "error" as const, code, message: "PRIVATE_PROVIDER_EXCEPTION" }) } as AssistantChatSource, c = createAssistantChatController(source, f.session); c.setQuestion("Offline question"); assert.equal(await c.submit(), false); assert.ok(!c.getSnapshot().message.includes("PRIVATE_PROVIDER_EXCEPTION")); assert.equal(c.getSnapshot().error, code); if (["ai_disabled", "history_limit", "source_changed"].includes(code)) assert.equal(canAskChat(c.getSnapshot()), false); c.dispose();
      }
      const f = await chatFixture(), c = createAssistantChatController(f.source, f.session); c.setQuestion("First"); assert.equal(await c.submit(), true); const previous = c.getSnapshot().view; f.fail(); c.setQuestion("Retained on failure"); assert.equal(await c.submit(), false); assert.equal(c.getSnapshot().question, "Retained on failure"); assert.equal(c.getSnapshot().view, previous); assert.equal(c.getSnapshot().error, "provider_unavailable"); c.dispose();
    });
    await check("malformed/unsupported/oversized/secret-bearing DTOs and forged flags cannot authorize presentation", async () => {
      const f = await chatFixture(); await f.source.ask(question1); const original = view(f.source), turn = original.turns[0];
      const invalid = [{ ...original, context: {} }, { ...original, history_bytes: 32001 }, { ...original, turns: Array(5).fill(turn) }, { ...original, turns: [{ ...turn, answer: { ...turn.answer, answer: "x".repeat(4001) } }] }, { ...original, turns: [{ ...turn, answer: { ...turn.answer, citations: [{ kind: "url", url: "https://example.invalid" }] } }] }, { ...original, turns: [{ ...turn, provenance: { ...turn.provenance, client_key: "secret" } }] }];
      for (const v of invalid) { assert.equal(validChatView(v), false); const s = { ...f.source, getSnapshot: () => ({ state: "ready", view: v }), isCurrent: () => true } as AssistantChatSource; assert.equal(createAssistantChatController(s, f.session).getSnapshot().view, null); }
      assert.equal(validChatCitation({ kind: "application", app_id: "known", side: "wrong" }), false); assert.equal(validChatCitation({ kind: "license", license_id: "x", app_id: " " }), false);
      const c = createAssistantChatController({ authorized: true } as never, f.session); assert.equal(c.getSnapshot().available, false); assert.equal(c.getSnapshot().view, null);
    });
    await check("public source absent, server-only seam, no browser backend imports/network/storage/HTML/actions", async () => {
      for (const path of ["lib/ai-assistant/chat-view.ts", "lib/ai-assistant/chat-controller.ts", "components/ai-assistant/assistant-workspace.tsx"]) { const code = (await readFile(path, "utf8")).replace(/^import type .*$/gm, ""); assert.doesNotMatch(code, /from ["'][^"']*server\/|server-only|fetch\(|sessionStorage|localStorage|document\.cookie|dangerouslySetInnerHTML|process\.env|console\./); }
      const page = await readFile("app/[module]/page.tsx", "utf8"); assert.match(page, /module.href === "\/ai-assistant" \? <AssistantWorkspace \/>/); assert.doesNotMatch(page, /<AssistantWorkspace source|server\/assistant/);
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./lib/server/assistant/chat-presenter.ts')"], { encoding: "utf8", timeout: 5000 }); assert.notEqual(child.status, 0); assert.match(child.stderr, /server-only|Client Component/); assert.equal(network, 0);
    });
    console.log(`PASS: ${groups} U10.03 groups; actual protected mocked-owner projections, presentation/Reset/stale guards; zero external requests.`);
  } finally { globalThis.fetch = originalFetch; }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await run();
