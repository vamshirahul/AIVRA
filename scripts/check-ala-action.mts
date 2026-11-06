import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readLocalPolicy } from "../lib/server/local-ala/config.ts";
import { createLocalLedger } from "../lib/server/local-ala/ledger.ts";
import { issueLocalAuthority, localProcessEnabled } from "../lib/server/ai/local-authority.ts";
import { createLocalProviders } from "../lib/server/local-ala/providers.ts";
import { localALAPost, isLocalRequest } from "../lib/server/local-ala/http.ts";
import { projectALAResults } from "../lib/server/ala/presentation.ts";
import { buildReviewedExport } from "../lib/ala/review-export.ts";
import { createReviewDraft } from "../lib/ala/review-overrides.ts";
import { readLocalALADisplay } from "../lib/ala/local-display.ts";
import { reservationUnits } from "../lib/server/ai/control-policy.ts";
import { createAIRouter } from "../lib/server/ai/router.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { POST, runtime } from "../app/api/ai/ala/route.ts";
import { createALAAnalyzer, ALAActionErrorSchema, ALAAnalyzeOutcomeSchema } from "../lib/server/ala/analyze.ts";
import { matchesALASource, buildALARequest } from "../lib/server/ala/request.ts";
import { createFakeUsageStore } from "../lib/server/ai/fake-usage-store.ts";
import { EnabledPolicySchema } from "../lib/server/ai/control-policy.ts";
import type { EnabledPolicy } from "../lib/server/ai/control-policy.ts";
import type { StructuredTransport } from "../lib/server/ai/contracts.ts";
import { createDemoSession, updateApplication, updateLicense, publishSessionApplications } from "../lib/session/session.ts";
import { ALAResultSchema } from "../lib/server/ala/schema.ts";
import type { ALAResult } from "../lib/server/ala/schema.ts";

const session = createDemoSession();
const apps = session.current_deal.applications;
const buyer = apps.find((app) => app.company_side === "buyer")!, target = apps.find((app) => app.company_side === "target")!;
// Synthetic structured fixtures only; never provided to the public route/UI.
const data = (): ALAResult => ({ findings: apps.map((app, index) => ({ finding_id: `f_${index}`, domain: "Offline structural check", relationship: "unique",
  buyer_app_ids: app.company_side === "buyer" ? [app.app_id] : [], target_app_ids: app.company_side === "target" ? [app.app_id] : [],
  actions: [{ action_id: `a_${index}`, subject: { app_id: app.app_id, side: app.company_side }, disposition: "Needs Review", destination: null, rationale: "No real recommendation in this synthetic fixture." }],
  rationale: "Offline contract only.", evidence: [{ app_id: app.app_id, attribute: "function" }], uncertainty: { level: "unknown", reason: "No real analysis performed." } })), not_evaluated: [] });
const start = Date.UTC(2026, 10, 1, 12), caller = { client_key: "a".repeat(64) };
function policy(patch: Partial<EnabledPolicy> = {}): EnabledPolicy {
  const paid = { model_provider: "offline-paid", model_id: "ala-paid-fixture", approved: true as const, approval_ref: "invented-offline-only-not-approval",
    monthly_budget_units: 10_000_000, per_request_ceiling_units: 1_000_000, input_units_per_token: 2, output_units_per_token: 3, concurrency: 3, credential_slot: "paid" as const };
  return EnabledPolicySchema.parse({ enabled: true, live_dispatch_enabled: false, namespace: "ala-action-offline", period_key: "2026-11", paid_enabled: true, fallback_enabled: true,
    paid, fallback: { ...paid, model_provider: "offline-fallback", model_id: "ala-open-fixture", credential_slot: "fallback", open_weight_verified: true, open_weight_evidence: "https://example.invalid/test-only", daily_requests: 50, monthly_requests: 100 },
    client_window_ms: 60_000, client_requests: 10, global_window_ms: 60_000, global_requests: 20, global_concurrency: 5, client_concurrency: 3,
    max_input_bytes: 64_000, max_output_tokens: 256, input_overhead_tokens: 512, lease_ms: 5000, timeout_ms: 1000, store_timeout_ms: 50, ...patch });
}
function fixture(output: unknown = data(), p = policy(), generate?: StructuredTransport["generate"]) {
  let paidCalls = 0, fallbackCalls = 0;
  const clock = () => start, store = createFakeUsageStore(clock);
  const paid: StructuredTransport = { model_provider: p.paid.model_provider, model_id: p.paid.model_id, generate: async (call) => { paidCalls++; return generate ? generate(call) : { output, usage: { inputTokens: 10, outputTokens: 5 } }; } };
  const fallback: StructuredTransport = { model_provider: p.fallback.model_provider, model_id: p.fallback.model_id, generate: async () => { fallbackCalls++; return { output, usage: { inputTokens: 10, outputTokens: 5 } }; } };
  return { p, store, clock, paid, fallback, analyze: createALAAnalyzer({ policy: p, execution: "offline-test", store, clock, paid, fallback }), calls: () => ({ paid: paidCalls, fallback: fallbackCalls }) };
}
let groups = 0, network = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); groups++; console.log(`PASS: ${name}`); }
if (!process.argv.includes("--ala-browser")) {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { network++; throw new Error("ALA action checks forbid external network"); };
  try {
    await check("actual POST is unconditional 503/no-store, with no request access or env/header/model activation", async () => {
      assert.equal(runtime, "nodejs"); let reads = 0;
      const hostile = new Proxy({}, { get() { reads++; throw new Error("Body must not be touched"); } });
      const previous = process.env.AIVRA_AI_ENABLED; process.env.AIVRA_AI_ENABLED = "true";
      try { for (let i = 0; i < 3; i++) {
        const response = (POST as (request?: unknown) => Response)(hostile);
        assert.equal(response.status, 503); assert.equal(response.headers.get("Cache-Control"), "no-store");
        const text = await response.text(); assert.ok(text.length <= 256); const result = ALAActionErrorSchema.parse(JSON.parse(text));
        assert.equal(result.error.code, "ai_controls_not_ready"); assert.equal(result.error.request_id, null);
      } } finally { if (previous === undefined) delete process.env.AIVRA_AI_ENABLED; else process.env.AIVRA_AI_ENABLED = previous; }
      assert.equal(reads, 0);
      const source = await readFile("app/api/ai/ala/route.ts", "utf8"); assert.doesNotMatch(source, /\bimport\s|process\.env|createAI|\.headers|\.body|\.json\(request/);
    });
    await check("complete/incomplete outcomes use actual guarded router and validated ALA envelope/source snapshot", async () => {
      const f = fixture(), before = JSON.stringify(session); const result = await f.analyze(session, caller);
      assert.equal(result.status, "success"); ALAAnalyzeOutcomeSchema.parse(result);
      if (result.status === "error") throw new Error("Expected offline structured outcome");
      assert.equal(result.envelope.prompt_version, "ala/v1"); assert.equal(result.envelope.module, "ala"); assert.equal(result.envelope.model_provider, "offline-paid");
      assert.equal(result.envelope.mode, "paid"); assert.equal(result.coverage.status, "complete"); assert.ok(matchesALASource(result.source_token, session));
      assert.deepEqual(f.calls(), { paid: 1, fallback: 0 }); assert.equal(JSON.stringify(session), before);
      const omitted = data(); const removed = omitted.findings.pop()!;
      const partial = await fixture(omitted).analyze(session, caller); assert.equal(partial.status, "incomplete");
      if (partial.status !== "error") { assert.deepEqual(partial.coverage.target.missing_app_ids, removed.target_app_ids); assert.equal(partial.envelope.data.findings.length, apps.length - 1); }
      omitted.not_evaluated.push({ app_id: removed.target_app_ids[0], side: "target", reason: "Offline unassessed example." });
      const notEvaluated = await fixture(omitted).analyze(session, caller); assert.equal(notEvaluated.status, "incomplete");
      if (notEvaluated.status !== "error") assert.deepEqual(notEvaluated.coverage.reasons, ["not_evaluated_applications"]);
    });
    await check("disabled/invalid/caller/store/rate/budget failures stay guarded; independently eligible fallback only", async () => {
      const disabled = await createALAAnalyzer()(session, caller); assert.ok(disabled.status === "error" && disabled.error.code === "ai_disabled");
      const invalid = fixture(); assert.equal((await invalid.analyze(null, caller)).status, "error"); assert.deepEqual(invalid.calls(), { paid: 0, fallback: 0 });
      assert.equal((await invalid.analyze(session)).status, "error"); assert.deepEqual(invalid.calls(), { paid: 0, fallback: 0 });
      const outage = fixture(); const badStore = { ...outage.store, authorizeAndReserve: async () => { throw new Error("private-store-canary"); } };
      const denied = await createALAAnalyzer({ policy: outage.p, execution: "offline-test", store: badStore, clock: outage.clock, paid: outage.paid, fallback: outage.fallback })(session, caller);
      assert.ok(denied.status === "error" && denied.error.code === "controls_unavailable"); assert.deepEqual(outage.calls(), { paid: 0, fallback: 0 });
      const rate = fixture(data(), policy({ client_requests: 1 })); await rate.analyze(session, caller); const limited = await rate.analyze(session, caller);
      assert.ok(limited.status === "error" && limited.error.code === "rate_limited"); assert.deepEqual(rate.calls(), { paid: 1, fallback: 0 });
      const original = policy(); const fallback = fixture(data(), policy({ paid: { ...original.paid, monthly_budget_units: 1 } }));
      const routed = await fallback.analyze(session, caller); assert.equal(routed.status, "success");
      if (routed.status !== "error") { assert.equal(routed.envelope.mode, "fallback"); assert.equal(routed.envelope.routing_reason, "budget_exhausted"); }
      assert.deepEqual(fallback.calls(), { paid: 0, fallback: 1 });
    });
    await check("wrong sides/IDs/foreign citations/destinations/conflicts/spoofed/oversized data produce no draft", async () => {
      const wrongSide = data(); wrongSide.findings[0].buyer_app_ids = []; wrongSide.findings[0].target_app_ids = [buyer.app_id]; wrongSide.findings[0].actions[0].subject.side = "target";
      const destination = data(); destination.findings[0].actions[0].disposition = "Migrate";
      const contradictory = data(); contradictory.findings[0].actions.push({ ...contradictory.findings[0].actions[0], action_id: "conflict", disposition: "Retire" });
      for (const output of [wrongSide, destination, contradictory, { ...data(), model_id: "spoofed" }, null, { pad: "x".repeat(64_001) },
        ...["unknown-id", session.current_deal.license_positions[0].license_id, session.current_deal.tsa_services[0].tsa_id].map((app_id) => ({ findings: [], not_evaluated: [{ app_id, side: "buyer", reason: "Foreign typed reference fixture." }] }))]) {
        const f = fixture(output), result = await f.analyze(session, caller); assert.ok(result.status === "error" && result.error.code === "invalid_model_output");
        assert.equal("envelope" in result, false); assert.deepEqual(f.calls(), { paid: 1, fallback: 0 });
      }
    });
    await check("pending source edit/publish/reset invalidates snapshot; license edit retains application freshness", async () => {
      let release!: () => void; const deferred = new Promise<void>((resolve) => { release = resolve; });
      const f = fixture(data(), policy(), async () => { await deferred; return { output: data() }; });
      const pending = f.analyze(session, caller);
      await new Promise((resolve) => setImmediate(resolve));
      const appEdit = updateApplication(session, buyer.app_id, { app_name: "Changed synthetic source" });
      const licenseEdit = updateLicense(session, session.current_deal.license_positions[0].license_id, { product: "License-only source edit" });
      const published = publishSessionApplications(session, "buyer", [...apps.filter((app) => app.company_side === "buyer"), { ...buyer, app_id: "new-source-while-pending" }], { session_id: session.session_id, session_revision: session.session_revision });
      release(); const result = await pending; assert.equal(result.status, "success");
      if (result.status === "error") throw new Error("Expected offline snapshot result");
      assert.equal(matchesALASource(result.source_token, appEdit), false); assert.equal(matchesALASource(result.source_token, published), false);
      assert.equal(matchesALASource(result.source_token, createDemoSession()), false); assert.equal(matchesALASource(result.source_token, licenseEdit), true);
      assert.equal(result.coverage.buyer.source_count, 15); assert.deepEqual(result.envelope.data, data());
    });
    await check("capacity/provider error/timeout are safe and never dispatch fallback or retry", async () => {
      let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
      const base = policy(); const p = policy({ global_concurrency: 1, client_concurrency: 1, paid: { ...base.paid, concurrency: 1 }, fallback: { ...base.fallback, concurrency: 1 } });
      const busy = fixture(data(), p, async () => { await waiting; return { output: data() }; });
      const first = busy.analyze(session, caller); await new Promise((resolve) => setImmediate(resolve)); const blocked = await busy.analyze(session, caller);
      assert.ok(blocked.status === "error" && blocked.error.code === "capacity_reached"); release(); await first; assert.deepEqual(busy.calls(), { paid: 1, fallback: 0 });
      const failed = fixture(data(), policy(), async () => { throw new Error("private-provider-canary"); });
      const error = await failed.analyze(session, caller); assert.ok(error.status === "error" && error.error.code === "provider_unavailable"); assert.ok(!JSON.stringify(error).includes("private-provider-canary")); assert.deepEqual(failed.calls(), { paid: 1, fallback: 0 });
      const timeout = fixture(data(), policy({ timeout_ms: 5 }), async () => new Promise(() => {})); const timed = await timeout.analyze(session, caller);
      assert.ok(timed.status === "error" && timed.error.code === "provider_unavailable"); assert.deepEqual(timeout.calls(), { paid: 1, fallback: 0 });
    });
    await check("local-only origin/config guards and disabled dummy fallback cannot grant public execution", async () => {
      const names=["NODE_ENV","AIVRA_AI_ENABLED","AIVRA_LOCAL_DEMO_ONLY","AIVRA_LOCAL_ALA_LAUNCHER","VERCEL","CI","AIVRA_LOCAL_ALA_PORT","AIVRA_LOCAL_PAID_ENABLED","AIVRA_LOCAL_FALLBACK_ENABLED"] as const;
      const prior=Object.fromEntries(names.map(n=>[n,process.env[n]]));
      try {
        const localEnv={AIVRA_LOCAL_PAID_ENABLED:"false",AIVRA_LOCAL_FALLBACK_ENABLED:"false",AIVRA_LOCAL_ALA_PORT:"3000",NODE_ENV:"development",AIVRA_AI_ENABLED:"true",AIVRA_LOCAL_DEMO_ONLY:"true",AIVRA_LOCAL_ALA_LAUNCHER:"a".repeat(64)};
        Object.assign(process.env,localEnv);delete process.env.VERCEL;delete process.env.CI;
        const headers={host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000","x-aivra-local-demo":"1"};
        const request=(h:Record<string,string>=headers,url="http://127.0.0.1:3000/api/local-ala")=>new Request(url,{method:"POST",headers:h});
        assert.ok(isLocalRequest(request()));assert.ok(isLocalRequest(request({...headers,host:"localhost:3000",origin:"http://localhost:3000"},"http://localhost:3000/api/local-ala")));
        for(const h of [{...headers,host:"localhost:3000"},{...headers,origin:"https://evil.invalid"},{...headers,host:"evil.invalid"},{...headers,"x-forwarded-for":"203.0.113.1"},{...headers,forwarded:"host=evil"},{...headers,"x-aivra-local-demo":""}])assert.equal(isLocalRequest(request(h)),false);
        for(const patch of [{NODE_ENV:"production"},{AIVRA_AI_ENABLED:"false"},{AIVRA_LOCAL_DEMO_ONLY:"false"},{AIVRA_LOCAL_ALA_LAUNCHER:""},{VERCEL:"1"},{CI:"1"}])assert.equal(localProcessEnabled({...localEnv,...patch}),false);
        const env={AIVRA_PAID_MODEL_ID:"local-approved-id",AIVRA_LOCAL_PAID_BUDGET_USD:"1",AIVRA_LOCAL_PAID_INPUT_MICRO_USD:"1",AIVRA_LOCAL_PAID_OUTPUT_MICRO_USD:"1",AIVRA_LOCAL_FALLBACK_ENABLED:"false",OPENAI_API_KEY:"local-credential-canary-never-bill"};
        assert.equal(readLocalPolicy({AIVRA_LOCAL_PAID_ENABLED:"false",AIVRA_LOCAL_FALLBACK_ENABLED:"false"}).paid_enabled,false);
        const p=readLocalPolicy(env),directory=await mkdtemp(path.join(tmpdir(),"aivra-local-ledger-")),store=createLocalLedger(directory),authority=issueLocalAuthority(store);
        const providers=createLocalProviders(authority,store,p,new Proxy(env,{get(target,key){if(key==="AIVRA_FALLBACK_API_KEY")throw Error("Disabled key must never be read");return Reflect.get(target,key);}}));assert.equal(providers.fallback,undefined);
        const simulated=fixture(data(),p),owner=createALAAnalyzer({policy:p,execution:"local-demo",localAuthority:authority,store,paid:simulated.paid,clock:Date.now});
        assert.equal((await owner(session,caller)).status,"success");assert.deepEqual(simulated.calls(),{paid:1,fallback:0});
        const builtLocal=buildALARequest(session);assert.ok(builtLocal.ok);
        const denied=await createAIRouter({policy:p,execution:"local-demo",store,paid:simulated.paid})(builtLocal.request,{schema:ALAResultSchema,references:{allow_empty:true,duplicates:"reject",extract:()=>[]}},caller);assert.equal(denied.ok,false);assert.deepEqual(simulated.calls(),{paid:1,fallback:0});
        const wrongModule=await createAIRouter({policy:p,execution:"local-demo",localAuthority:authority,store,paid:simulated.paid})({...builtLocal.request,module:"licenses"},{schema:ALAResultSchema,references:{allow_empty:true,duplicates:"reject",extract:()=>[]}},caller);assert.equal(wrongModule.ok,false);assert.deepEqual(simulated.calls(),{paid:1,fallback:0});
        const exhaustedP={...p,paid:{...p.paid,monthly_budget_units:1}};const exhausted=fixture(data(),exhaustedP);
        const capped=await createALAAnalyzer({policy:exhaustedP,execution:"local-demo",localAuthority:authority,store,paid:exhausted.paid,clock:Date.now})(session,caller);assert.ok(capped.status==="error"&&capped.error.code==="fallback_unavailable");assert.deepEqual(exhausted.calls(),{paid:0,fallback:0});

        assert.throws(()=>readLocalPolicy({...env,AIVRA_LOCAL_PAID_BUDGET_USD:""}));assert.throws(()=>readLocalPolicy({...env,AIVRA_LOCAL_FALLBACK_ENABLED:"true"}));
        assert.throws(()=>createLocalProviders(authority,store,p,{...env,OPENAI_API_KEY:"dummy-placeholder-key"}));
        // Capture real SDK wire construction without network or a completion fixture.
        const old=globalThis.fetch,seen:{url:string;body:Record<string,unknown>}[]=[];
        globalThis.fetch=async(input,init)=>{seen.push({url:String(input),body:JSON.parse(String(init?.body))});throw Error("Intercepted SDK request only");};
        try {
          const built=buildALARequest(session);assert.ok(built.ok);
          const model=providers.paid!;await assert.rejects(()=>model.generate({input:built.request,schema:(ALAResultSchema),signal:new AbortController().signal}));
          assert.equal(seen.length,1);assert.equal(seen[0].url,"https://api.openai.com/v1/responses");assert.equal(seen[0].body.store,false);assert.match(JSON.stringify(seen[0].body.text),/json_schema/);
          const fallbackEnv={...env,AIVRA_LOCAL_FALLBACK_ENABLED:"true",AIVRA_FALLBACK_PROVIDER:"openrouter",AIVRA_FALLBACK_MODEL_ID:"vendor/explicit-open-model",AIVRA_FALLBACK_API_KEY:"local-router-credential-canary",AIVRA_LOCAL_FALLBACK_BUDGET_USD:"1",AIVRA_LOCAL_FALLBACK_INPUT_MICRO_USD:"1",AIVRA_LOCAL_FALLBACK_OUTPUT_MICRO_USD:"1",AIVRA_LOCAL_OPEN_WEIGHT_APPROVED:"true",AIVRA_LOCAL_OPEN_WEIGHT_EVIDENCE:"https://example.invalid/offline-evidence",AIVRA_LOCAL_OPENROUTER_UPSTREAM:"offline-upstream"};
          const fp=readLocalPolicy(fallbackEnv);
          assert.throws(()=>createLocalProviders(authority,store,fp,{...fallbackEnv,AIVRA_FALLBACK_API_KEY:"dummy-placeholder-key"}));
          const fallbackPolicy={...fp,paid_enabled:false},fallbackFixture=fixture(data(),fallbackPolicy);
          const fallbackOwner=createALAAnalyzer({policy:fallbackPolicy,execution:"local-demo",localAuthority:authority,store,paid:fallbackFixture.paid,fallback:fallbackFixture.fallback,clock:Date.now});
          const fallbackResult=await fallbackOwner(session,caller);assert.notEqual(fallbackResult.status,"error");if(fallbackResult.status!=="error"){assert.equal(fallbackResult.envelope.mode,"fallback");assert.equal(fallbackResult.envelope.routing_reason,"paid_unavailable");}assert.deepEqual(fallbackFixture.calls(),{paid:0,fallback:1});
          const f=createLocalProviders(authority,store,fp,fallbackEnv).fallback!;
          await assert.rejects(()=>f.generate({input:built.request,schema:ALAResultSchema,signal:new AbortController().signal}));assert.equal(seen.length,2);assert.equal(seen[1].url,"https://openrouter.ai/api/v1/chat/completions");assert.match(JSON.stringify(seen[1].body.response_format),/json_schema/);assert.deepEqual(seen[1].body.provider,{only:["offline-upstream"],allow_fallbacks:false,require_parameters:true});
        }finally{globalThis.fetch=old;}
        const changed=structuredClone(session);changed.current_deal.applications[0].notes="Unapproved source text must not reach providers";
        const invalid=new Request("http://127.0.0.1:3000/api/local-ala",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({session:changed,synthetic_only:true,nonce:randomUUID()})});assert.equal((await localALAPost(invalid)).status,503);
        const oversized=new Request("http://127.0.0.1:3000/api/local-ala",{method:"POST",headers:{...headers,"content-type":"application/json"},body:"x".repeat(128001)});assert.equal((await localALAPost(oversized)).status,503);
        const slowBody=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({session,synthetic_only:true,nonce:randomUUID()})));}});
        const slowInit:RequestInit & {duplex:"half"}={method:"POST",headers:{...headers,"content-type":"application/json"},body:slowBody,duplex:"half"};
        const slowReply=await localALAPost(new Request("http://127.0.0.1:3000/api/local-ala",slowInit));assert.equal(slowReply.status,503);assert.equal((await slowReply.json()).error.code,"ai_controls_not_ready");

        process.env.NODE_ENV="production";assert.equal((await localALAPost(request())).status,503);
      }finally{for(const n of names){if(prior[n]===undefined)delete process.env[n];else process.env[n]=prior[n];}}
    });
    await check("local ledger reserves once, persists exposure, excludes concurrent processes and never substitutes test billing", async () => {
      const directory=await mkdtemp(path.join(tmpdir(),"aivra-local-cost-")),store=createLocalLedger(directory),p=readLocalPolicy({AIVRA_PAID_MODEL_ID:"local-approved-id",AIVRA_LOCAL_PAID_BUDGET_USD:"1",AIVRA_LOCAL_PAID_INPUT_MICRO_USD:"1",AIVRA_LOCAL_PAID_OUTPUT_MICRO_USD:"1"});
      const reserve=()=>({request_id:randomUUID(),input_digest:"a".repeat(64),client_key:caller.client_key,issued_at_ms:Date.now(),mode:"paid" as const,policy:p});
      const first=reserve();assert.equal((await store.authorizeAndReserve(first)).authorized,true);assert.deepEqual(await createLocalLedger(directory).authorizeAndReserve(reserve()),{authorized:false,code:"capacity_reached"});
      await store.settle({namespace:p.namespace,request_id:first.request_id,actual_units:1,usage_overflow:false});await store.settle({namespace:p.namespace,request_id:first.request_id,actual_units:1,usage_overflow:false});
      assert.equal((await createLocalLedger(directory).getSafeUsageStatus({namespace:p.namespace,period_key:p.period_key})).paid.accounted_units,reservationUnits(p,"paid"));
      const second=reserve();assert.equal((await store.authorizeAndReserve(second)).authorized,true);await store.settle({namespace:p.namespace,request_id:second.request_id,actual_units:null,usage_overflow:false});assert.equal((await createLocalLedger(directory).authorizeAndReserve(reserve())).authorized,false);
      await unlink(path.join(directory,"ledger.json"));await assert.rejects(()=>createLocalLedger(directory).authorizeAndReserve(reserve()));
      const f=fixture();const built=buildALARequest(session);assert.ok(built.ok);
      const result=await createAIRouter({policy:f.p,store,execution:"offline-test",paid:f.paid,fallback:f.fallback,clock:f.clock})(built.request,{schema:ALAResultSchema,references:{allow_empty:true,duplicates:"reject",extract:()=>[]}},caller);assert.equal(result.ok,false);assert.deepEqual(f.calls(),{paid:0,fallback:0});
    });
    await check("local response reuses reviewed contract and current source bindings without importing fake analysis", async () => {
      const f=fixture(),outcome=await f.analyze(session,caller);assert.notEqual(outcome.status,"error");const view=projectALAResults(outcome,session,session),draft=createReviewDraft(view),exported=buildReviewedExport(view,draft);assert.ok(exported.ok);
      const nonce=randomUUID(),wire={status:"success",nonce,session_id:session.session_id,revision:session.input_revisions.applications,artifact:exported.artifact};assert.equal(readLocalALADisplay(wire,session,nonce).state,"current");assert.equal(readLocalALADisplay(wire,session,randomUUID()).state,"invalid");assert.equal(readLocalALADisplay(wire,createDemoSession(),nonce).state,"invalid");assert.equal(readLocalALADisplay({...wire,extra:"bad"},session,nonce).state,"invalid");
    });
    await check("public UI has no dataset transport/success rendering; composition has no provider bypass or writes", async () => {
      const ui = await readFile("components/ala/analyze-applications.tsx", "utf8");
      assert.doesNotMatch(ui, /body:|JSON\.stringify|metadataFromValidatedResult|setView\(\{ status: "completed"|recordDerivedResultMetadata|sessionStorage/);
      const analyze = await readFile("lib/server/ala/analyze.ts", "utf8");
      assert.match(analyze, /createAIRouter\(options\)/); assert.match(analyze, /buildALARequest\(session\)/); assert.match(analyze, /inspectALAResult\(/);
      assert.doesNotMatch(analyze, /createAIAdapter|sdk-transport|openai-transport|fake-usage-store|recordDerivedResultMetadata|process\.env/);
      assert.equal(network, 0);
    });
    console.log(`PASS: ${groups} U02.02 offline groups; real guarded router, fake test-only providers/store; public POST never reads data; zero external/provider attempts.`);
  } finally { globalThis.fetch = savedFetch; }
}

export async function checkALAActionBrowser({ page, evaluate, until, base }: Parameters<typeof import("./check-csv-preview.mts").checkCSVBrowser>[0]) {
  if(process.env.AIVRA_LOCAL_ALA_BROWSER==="1") {
    await page("Page.navigate",{url:base+"/application-rationalization"});await until("!!document.querySelector('[aria-label=\"Local application analysis\"]') && !!document.querySelector('[data-session-ready=\"true\"]')");
    const before=await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')");
    await evaluate("(()=>{const original=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await original(...args);if(args[0]==='/api/local-ala')window.__localALAError=(await response.clone().json()).error?.code;return response;};})()");
    for(const width of [1440,390,320]){
      await page("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:false});
      await evaluate("document.querySelector('.ala-analyze-button').focus()");await page("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",windowsVirtualKeyCode:13,text:"\r"});await page("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",windowsVirtualKeyCode:13});
      await until("!!document.querySelector('.ai-notice--error') && !document.querySelector('.ala-analyze-button').disabled");
      assert.equal(await evaluate("window.__localALAError"),"fallback_unavailable");
      assert.match(await evaluate("document.querySelector('.ai-notice--error').textContent"),/unavailable|not ready/);assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false);
      assert.equal(await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')"),before);assert.equal(await evaluate("document.querySelectorAll('.ala-results-table tbody tr').length"),0);
    }
    const bad=await fetch(base+"/api/local-ala",{method:"POST",headers:{origin:"https://evil.invalid","Content-Type":"application/json","x-aivra-local-demo":"1"},body:"{}"});assert.equal(bad.status,503);
    assert.equal((await fetch(base+"/api/ai/ala",{method:"POST"})).status,503);
    console.log("PASS: local UI 1440/390/320, explicit keyboard action, both providers forcibly disabled, controlled unavailable, unchanged session, nonlocal-origin refusal and original public hard stop; zero live calls.");return;
  }
  const tracker = `(() => {
    const original = window.fetch.bind(window); window.__alaCalls = []; window.__holdALA = false;
    window.fetch = (input, init) => {
      if (String(input) !== '/api/ai/ala') return original(input, init);
      window.__alaCalls.push({method:init?.method,bodyAbsent:init?.body===undefined,credentials:init?.credentials});
      if (window.__holdALA) return new Promise((resolve,reject) => { window.__releaseALA = () => original(input,init).then(resolve,reject); });
      return original(input,init);
    };
  })()`;
  await page("Page.addScriptToEvaluateOnNewDocument", { source: tracker });
  await page("Page.navigate", { url: `${base}/application-rationalization` });
  await until("!!document.querySelector('.ala-analyze-button') && document.querySelector('.session-controls').dataset.sessionReady === 'true'");
  assert.equal(await evaluate("window.__alaCalls.length"), 0);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.ala-source-summary dd')].map(e=>e.textContent)"), ["15", "15", "0"]);
  const original = await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')");
  for (const width of [1440, 390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const before = await evaluate("window.__alaCalls.length");
    await evaluate("window.__holdALA=true; document.querySelector('.ala-analyze-button').focus()");
    assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none");
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until("document.querySelector('.ala-analyze-button').disabled && !!document.querySelector('.ala-checking')");
    await evaluate("document.querySelector('.ala-analyze-button').click(); document.querySelector('.ala-analyze-button').click()");
    assert.equal(await evaluate("window.__alaCalls.length"), before + 1);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    await evaluate("window.__holdALA=false; window.__releaseALA()");
    await until("!!document.querySelector('.ai-notice--error') && !document.querySelector('.ala-analyze-button').disabled");
    assert.match(await evaluate("document.querySelector('.ai-notice--error').textContent"), /not ready for live requests/);
    assert.equal(await evaluate("document.querySelector('.ai-notice-model') === null"), true);
    assert.equal(await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')"), original);
  }
  // Reset during an actual pending readiness fetch: old completion is ignored, no automatic request.
  await evaluate("window.__holdALA=true; document.querySelector('.ala-analyze-button').click()"); await until("!!document.querySelector('.ala-checking')");
  const beforeReset = await evaluate("window.__alaCalls.length");
  await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Reset demo session').click()"); await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Confirm reset').click()");
  await until("!document.querySelector('.ala-checking') && !document.querySelector('.ala-analyze-button').disabled");
  await evaluate("window.__holdALA=false; window.__releaseALA().catch(()=>{})");
  assert.equal(await evaluate("window.__alaCalls.length"), beforeReset); assert.equal(await evaluate("document.querySelector('.ai-notice-title').textContent"), "AI not enabled");
  // Client navigation unmounts and aborts; remount/refresh do not invoke AI.
  await evaluate("window.__holdALA=true; document.querySelector('.ala-analyze-button').click()"); await until("!!document.querySelector('.ala-checking')");
  const beforeNavigate = await evaluate("window.__alaCalls.length");
  await evaluate("document.querySelector('nav a[href=\"/\"]').click()"); await until("location.pathname==='/'");
  await evaluate("window.__holdALA=false; window.__releaseALA().catch(()=>{})");
  await evaluate("document.querySelector('nav a[href=\"/application-rationalization\"]').click()"); await until("!!document.querySelector('.ala-analyze-button')");
  assert.equal(await evaluate("window.__alaCalls.length"), beforeNavigate);
  assert.equal(await evaluate("document.querySelector('.ai-notice-title').textContent"), "AI not enabled");
  assert.ok(await evaluate("window.__alaCalls.every(c=>c.method==='POST' && c.bodyAbsent && c.credentials==='omit')"));
  await page("Page.reload"); await until("!!document.querySelector('.ala-analyze-button') && !document.querySelector('.ala-analyze-button').disabled");
  assert.equal(await evaluate("window.__alaCalls.length"), 0);
  assert.equal((await fetch(`${base}/api/ai/ala`, { method: "GET" })).status, 405);
  const response = await fetch(`${base}/api/ai/ala`, { method: "POST", body: "synthetic rejected body", headers: { "x-aivra-test-mode": "enabled" } });
  assert.equal(response.status, 503); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.ok(ALAActionErrorSchema.safeParse(await response.json()).success);
  for (const route of ["/", "/data-mapper", "/integration-health", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"]) assert.equal((await fetch(`${base}${route}`)).status, 200);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature a,.future-feature button,.future-feature [tabindex]').length"), 0);
  console.log("PASS: Chromium 1440/390/320; no mount/reset/navigation/refresh AI calls, one body-free POST per keyboard action, pending double-click block, truthful unavailable/no result, stale reset/unmount cancellation, unchanged source, 503/no-store and GET 405");
}
