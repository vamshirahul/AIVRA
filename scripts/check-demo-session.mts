import assert from "node:assert/strict";
import { createDemoSessionController } from "../lib/session/controller.ts";
import { captureInputVersions, createDemoSession, DemoSessionSchema, getResultFreshness, MAX_SESSION_CHARACTERS, parseSession, recordDerivedResultMetadata, RESULT_DEPENDENCIES, ResultKindSchema, serializeSession, SESSION_STORAGE_KEY, updateApplication } from "../lib/session/session.ts";
import { loadSyntheticDealFixture } from "../lib/fixtures/synthetic-deal.ts";
import type { ApplicationPatch, DemoSession } from "../lib/session/session.ts";

class MemoryStorage {
  values = new Map<string, string>();
  writes = 0;
  denyRead = false;
  denyWrite = false;
  getItem(key: string) { if (this.denyRead) throw new Error("Denied"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.denyWrite) throw new Error("Quota"); this.writes++; this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 9, 31, 12, 0, tick++)).toISOString();
const fresh = (storage = new MemoryStorage()) => {
  const controller = createDemoSessionController(() => storage, clock);
  controller.initialize();
  return { controller, storage };
};
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS: ${name}`); }
function registerAll(controller: ReturnType<typeof createDemoSessionController>) {
  for (const kind of ResultKindSchema.options) {
    const dependencies = RESULT_DEPENDENCIES[kind];
    assert.equal(controller.recordDerivedResultMetadata(kind, dependencies, controller.captureInputVersions(dependencies)).ok, true);
  }
}
const fixture = loadSyntheticDealFixture();

check("SSR snapshot is stable and storage is not accessed before initialization", () => {
  let reads = 0;
  const controller = createDemoSessionController(() => { reads++; return new MemoryStorage(); }, clock);
  assert.equal(controller.getSnapshot(), controller.getServerSnapshot());
  assert.equal(controller.getSnapshot().session, null);
  assert.equal(reads, 0);
});
check("fresh session matches the bundled 15/15/10/5 fixture, CAD, IDs, null and zero", () => {
  const { controller, storage } = fresh();
  const state = controller.getSnapshot().session!;
  assert.deepEqual(state.current_deal, fixture);
  assert.deepEqual(state.input_revisions, { applications: 0, licenses: 0, tsa: 0 });
  assert.deepEqual(state.derived_results, {});
  assert.equal(state.session_revision, 0);
  assert.equal(storage.values.size, 1);
  assert.equal(controller.getSnapshot().storageAvailable, true);
  assert.deepEqual(parseSession(storage.values.get(SESSION_STORAGE_KEY)!), state);
  assert.equal(controller.getResultFreshness("ala"), "missing");
  const writes = storage.writes; controller.initialize(); assert.equal(storage.writes, writes);
});
check("application/license/TSA updates share one store, preserve identities, persist and notify", () => {
  const { controller, storage } = fresh();
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => notifications++);
  assert.equal(controller.updateApplication(fixture.applications[0].app_id, { app_name: "Orbit Ledger — edited synthetic label", annual_cost: null }).ok, true);
  assert.equal(controller.updateLicense(fixture.license_positions[0].license_id, { seats_used: 0 }).ok, true);
  assert.equal(controller.updateTSA(fixture.tsa_services[0].tsa_id, { owner: "Fictional handover team" }).ok, true);
  assert.equal(notifications, 3); unsubscribe();
  const state = controller.getSnapshot().session!;
  assert.deepEqual(state.input_revisions, { applications: 1, licenses: 1, tsa: 1 });
  assert.equal(state.session_revision, 3);
  assert.deepEqual(state.current_deal.applications.map((r) => [r.app_id, r.company_side]), fixture.applications.map((r) => [r.app_id, r.company_side]));
  assert.deepEqual(fresh(storage).controller.getSnapshot().session, state);
  assert.deepEqual(loadSyntheticDealFixture(), fixture);
  assert.throws(() => Object.assign(state.current_deal.applications[0], { app_name: "Bypass revisions" }), TypeError);
});
check("no-op and normalized no-op updates keep revisions, timestamps and storage unchanged", () => {
  const { controller, storage } = fresh(); registerAll(controller);
  const before = controller.getSnapshot(); const writes = storage.writes;
  assert.equal(controller.updateApplication(fixture.applications[0].app_id, { app_name: `  ${fixture.applications[0].app_name}  ` }).ok, true);
  assert.equal(controller.updateLicense(fixture.license_positions[0].license_id, {}).ok, true);
  assert.equal(controller.updateTSA(fixture.tsa_services[0].tsa_id, { owner: fixture.tsa_services[0].owner }).ok, true);
  assert.equal(controller.getSnapshot(), before); assert.equal(storage.writes, writes);
  for (const kind of ResultKindSchema.options) assert.equal(controller.getResultFreshness(kind), "current");
});
check("license changes stale only declared license consumers, retaining metadata across reload", () => {
  const { controller, storage } = fresh(); registerAll(controller);
  const oldMetadata = controller.getSnapshot().session!.derived_results;
  controller.updateLicense(fixture.license_positions[0].license_id, { seats_used: 1 });
  assert.equal(controller.getResultFreshness("ala"), "current");
  for (const kind of ResultKindSchema.options.filter((kind) => kind !== "ala")) assert.equal(controller.getResultFreshness(kind), "stale");
  assert.deepEqual(controller.getSnapshot().session!.derived_results, oldMetadata);
  assert.equal(fresh(storage).controller.getResultFreshness("playbook"), "stale");
});
check("TSA changes leave app/license estimates current and stale playbook/assistant/health", () => {
  const { controller } = fresh(); registerAll(controller);
  controller.updateTSA(fixture.tsa_services[0].tsa_id, { risk_notes: "Synthetic revised handover assumption" });
  for (const kind of ["ala", "licenses", "cost", "scenario"] as const) assert.equal(controller.getResultFreshness(kind), "current");
  for (const kind of ["playbook", "assistant", "health"] as const) assert.equal(controller.getResultFreshness(kind), "stale");
});
check("application changes stale app-based results; async old snapshots remain stale", () => {
  const { controller } = fresh(); registerAll(controller);
  const old = controller.captureInputVersions(["applications"]);
  controller.updateApplication(fixture.applications[0].app_id, { owner: "Fictional team one" });
  controller.updateApplication(fixture.applications[0].app_id, { owner: "Fictional team two" });
  for (const kind of ResultKindSchema.options) assert.equal(controller.getResultFreshness(kind), "stale");
  assert.equal(controller.recordDerivedResultMetadata("ala", ["applications"], old).ok, true);
  assert.equal(controller.getResultFreshness("ala"), "stale");
  assert.equal(controller.getSnapshot().session!.input_revisions.applications, 2);
});
check("invalid IDs, types, identity edits, cross-references and TSA dates are atomic rejections", () => {
  const { controller, storage } = fresh(); const before = controller.getSnapshot(); const writes = storage.writes;
  assert.equal(controller.updateApplication("not-present", { owner: null }).ok, false);
  assert.equal(controller.updateApplication(fixture.applications[0].app_id, { annual_cost: -1 }).ok, false);
  assert.equal(controller.updateApplication(fixture.applications[0].app_id, { app_id: "renumber" } as ApplicationPatch).ok, false);
  assert.equal(controller.updateApplication(fixture.applications[0].app_id, { company_side: "target" } as ApplicationPatch).ok, false);
  assert.equal(controller.updateLicense(fixture.license_positions[0].license_id, { app_id: "dangling" }).ok, false);
  assert.equal(controller.updateTSA(fixture.tsa_services[0].tsa_id, { related_app_ids: ["dangling"] }).ok, false);
  assert.equal(controller.updateTSA(fixture.tsa_services[0].tsa_id, { end_date: "2026-01-01" }).ok, false);
  assert.equal(controller.getSnapshot(), before); assert.equal(storage.writes, writes);
});
check("metadata rejects omitted conventions, duplicate/excess keys, and future revisions", () => {
  const { controller } = fresh(); const before = controller.getSnapshot();
  const session_id = before.session!.session_id;
  assert.equal(controller.recordDerivedResultMetadata("licenses", ["licenses"], { session_id, revisions: { licenses: 0 } }).ok, false);
  assert.equal(controller.recordDerivedResultMetadata("ala", ["applications", "applications"], { session_id, revisions: { applications: 0 } }).ok, false);
  assert.equal(controller.recordDerivedResultMetadata("ala", ["applications"], { session_id, revisions: { applications: 0, tsa: 0 } }).ok, false);
  assert.equal(controller.recordDerivedResultMetadata("ala", ["applications"], { session_id, revisions: { applications: 1 } }).ok, false);
  assert.equal(controller.getSnapshot(), before);
});
check("reset rejects delayed results from the previous session even when revisions match", () => {
  const { controller } = fresh();
  const captured = controller.captureInputVersions(["applications"]);
  controller.resetDemoSession();
  const reset = controller.getSnapshot();
  assert.notEqual(reset.session!.session_id, captured.session_id);
  assert.equal(controller.recordDerivedResultMetadata("ala", ["applications"], captured).ok, false);
  assert.equal(controller.getSnapshot(), reset);
  assert.equal(controller.getResultFreshness("ala"), "missing");
});
check("reset restores source/version, zero revisions and missing metadata; refresh cannot resurrect edits", () => {
  const { controller, storage } = fresh(); registerAll(controller);
  controller.updateApplication(fixture.applications[0].app_id, { owner: "Synthetic reset candidate" });
  controller.resetDemoSession();
  const reset = controller.getSnapshot().session!;
  assert.deepEqual(reset.current_deal, fixture); assert.deepEqual(reset.derived_results, {});
  assert.deepEqual(reset.input_revisions, { applications: 0, licenses: 0, tsa: 0 });
  assert.equal(reset.session_revision, 0);
  assert.deepEqual(fresh(storage).controller.getSnapshot().session, reset);
});
check("malformed/version-incompatible/incoherent persisted data recovers and replaces the bad value", () => {
  const valid = createDemoSession(clock());
  const cases = ["{bad json", JSON.stringify({ ...valid, session_schema_version: "0.0.1" }),
    JSON.stringify({ ...valid, fixture: { ...valid.fixture, dataset_version: "2.0.0" } }),
    JSON.stringify({ ...valid, current_deal: { ...valid.current_deal, license_positions: [{ ...fixture.license_positions[0], app_id: "dangling" }] } }),
    JSON.stringify({ ...valid, input_revisions: { ...valid.input_revisions, applications: 20 } }),
    " ".repeat(MAX_SESSION_CHARACTERS + 1),
    JSON.stringify({ ...valid, derived_results: { arbitrary_payload: { output: "not allowed" } } }),
  ];
  for (const raw of cases) {
    const storage = new MemoryStorage(); storage.values.set(SESSION_STORAGE_KEY, raw);
    const { controller } = fresh(storage);
    assert.equal(controller.getSnapshot().recovered, true);
    assert.deepEqual(controller.getSnapshot().session!.current_deal, fixture);
    assert.equal(fresh(storage).controller.getSnapshot().recovered, false);
  }
});
check("denied storage access/read and quota failures keep in-memory edits usable", () => {
  const denied = createDemoSessionController(() => { throw new Error("SecurityError"); }, clock);
  denied.initialize();
  assert.equal(denied.getSnapshot().ready, true); assert.equal(denied.getSnapshot().storageAvailable, false);
  assert.equal(denied.updateApplication(fixture.applications[0].app_id, { owner: "Memory only" }).ok, true);
  assert.equal(denied.getSnapshot().session!.current_deal.applications[0].owner, "Memory only");
  const storage = new MemoryStorage(); storage.denyRead = true;
  assert.equal(fresh(storage).controller.getSnapshot().storageAvailable, false);
  storage.denyRead = false; const { controller } = fresh(storage);
  controller.updateApplication(fixture.applications[0].app_id, { owner: "Earlier persisted edit" });
  storage.denyWrite = true;
  assert.equal(controller.updateLicense(fixture.license_positions[0].license_id, { seats_used: 2 }).ok, true);
  assert.equal(controller.getSnapshot().storageAvailable, false);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null);
  controller.resetDemoSession();
  storage.denyWrite = false;
  assert.deepEqual(fresh(storage).controller.getSnapshot().session!.current_deal, fixture);
});
check("oversized edits and unsupported session versions fail validation without replacing state", () => {
  const { controller } = fresh(); const before = controller.getSnapshot();
  assert.equal(controller.updateApplication(fixture.applications[0].app_id, { app_name: "x".repeat(MAX_SESSION_CHARACTERS) }).ok, false);
  assert.equal(controller.getSnapshot(), before);
  assert.throws(() => DemoSessionSchema.parse({ ...createDemoSession(clock()), session_schema_version: "unsupported" }));
});
check("source revision capture is explicit; missing results never imply a completed analysis", () => {
  let state: DemoSession = createDemoSession(clock());
  const captured = captureInputVersions(state, ["applications", "tsa"]);
  state = updateApplication(state, fixture.applications[0].app_id, { notes: "Synthetic source edit" }, clock());
  state = recordDerivedResultMetadata(state, "ala", ["applications", "tsa"], captured, clock());
  assert.equal(getResultFreshness(state, "ala"), "stale");
  assert.equal(getResultFreshness(state, "assistant"), "missing");
});
console.log(`PASS: ${passed} focused session groups; no fixture/U00.03/U00.04 suites or provider calls.`);
