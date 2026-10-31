import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDemoSessionController } from "../lib/session/controller.ts";
import { DemoSessionSchema, parseSession, serializeSession, SESSION_STORAGE_KEY, RESULT_DEPENDENCIES } from "../lib/session/session.ts";
import { INVENTORY_COLUMNS } from "../lib/data-mapper/inventory-view.ts";
import { parseCSVBytes } from "../lib/data-mapper/parse-csv.ts";
import { columnMappingReducer, initialMappingState } from "../lib/data-mapper/column-mapping.ts";
import { currentConfirmedApplications, prepareApplicationPublication } from "../lib/data-mapper/publish-applications.ts";
import type { Application } from "../lib/contracts/demo.ts";

function fixture() {
  const values = new Map<string, string>(); let writes = 0, denied = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (denied) throw new Error("Synthetic quota denial"); writes++; values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const controller = createDemoSessionController(() => storage); controller.initialize();
  return { controller, storage, values, writes: () => writes, deny: () => { denied = true; } };
}
const token = (f: ReturnType<typeof fixture>) => { const s = f.controller.getSnapshot().session!; return { session_id: s.session_id, session_revision: s.session_revision }; };
const sideRows = (f: ReturnType<typeof fixture>, side: "buyer" | "target") => f.controller.getSnapshot().session!.current_deal.applications.filter((row) => row.company_side === side);
const csvText = (rows: readonly Application[]) => [INVENTORY_COLUMNS.map(([key]) => key).join(","), ...rows.map((row) => INVENTORY_COLUMNS.map(([field]) => `"${String(row[field] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
function confirmed(rows: readonly Application[], side: "buyer" | "target") {
  const preview = parseCSVBytes("synthetic.csv", new TextEncoder().encode(csvText(rows))); assert.ok(preview.ok);
  let state = columnMappingReducer(initialMappingState, { type: "csv", action: { type: "begin", side, generation: 1 } });
  state = columnMappingReducer(state, { type: "csv", action: { type: "complete", side, generation: 1, result: preview } });
  for (const [index, [field]] of INVENTORY_COLUMNS.entries()) state = columnMappingReducer(state, { type: "map", side, generation: 1, field, index });
  state = columnMappingReducer(state, { type: "confirm", side, generation: 1, revision: state.mapping[side]!.revision });
  assert.ok(state.mapping[side]!.confirmed); return { source: state.csv[side], mapping: state.mapping[side]! };
}

if (!process.argv.includes("--publish-browser")) {
  const savedFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Publication checks forbid network"); };
  try {
    const f = fixture(); const before = f.controller.getSnapshot().session!;
    for (const [kind, dependencies] of Object.entries(RESULT_DEPENDENCIES)) assert.equal(f.controller.recordDerivedResultMetadata(kind as keyof typeof RESULT_DEPENDENCIES, dependencies, f.controller.captureInputVersions(dependencies)).ok, true);
    const old = f.controller.getSnapshot().session!; const oldStorage = f.values.get(SESSION_STORAGE_KEY); const oldWrites = f.writes();
    const unchanged = f.controller.publishApplications("buyer", sideRows(f, "buyer"), token(f));
    assert.ok(unchanged.ok && !unchanged.changed); assert.equal(f.controller.getSnapshot().session, old); assert.equal(f.writes(), oldWrites); assert.equal(f.values.get(SESSION_STORAGE_KEY), oldStorage);
    const rows = sideRows(f, "buyer").map((row, i) => i === 0 ? { ...row, app_name: "Published synthetic application" } : row);
    const draft = confirmed(rows, "buyer"); const verified = currentConfirmedApplications(draft.source, draft.mapping, "buyer"); assert.ok(verified.ok);
    let notifications = 0; const unsubscribe = f.controller.subscribe(() => { notifications++; });
    const published = f.controller.publishApplications("buyer", verified.applications, token(f)); assert.ok(published.ok && published.changed); unsubscribe();
    const current = f.controller.getSnapshot().session!;
    assert.equal(notifications, 1); assert.equal(f.writes(), oldWrites + 1);
    assert.equal(current.input_revisions.applications, old.input_revisions.applications + 1); assert.equal(current.session_revision, old.session_revision + 1);
    assert.equal(current.input_revisions.licenses, old.input_revisions.licenses); assert.equal(current.input_revisions.tsa, old.input_revisions.tsa);
    assert.deepEqual(current.current_deal.license_positions, old.current_deal.license_positions); assert.deepEqual(current.current_deal.tsa_services, old.current_deal.tsa_services);
    assert.deepEqual(current.current_deal.applications.filter((r) => r.company_side === "target"), old.current_deal.applications.filter((r) => r.company_side === "target"));
    assert.deepEqual(current.derived_results, old.derived_results); for (const kind of Object.keys(RESULT_DEPENDENCIES)) assert.equal(f.controller.getResultFreshness(kind as keyof typeof RESULT_DEPENDENCIES), "stale");
    assert.equal(current.session_id, old.session_id); assert.equal(current.current_deal.dataset_version, "1.0.0"); assert.deepEqual(current.fixture, old.fixture); assert.ok(current.modified_at >= old.modified_at);
    assert.ok(DemoSessionSchema.safeParse(current).success); assert.deepEqual(parseSession(serializeSession(current)), current);
    const reload = createDemoSessionController(() => f.storage); reload.initialize(); assert.deepEqual(reload.getSnapshot().session, current);
    f.controller.resetDemoSession(); assert.deepEqual(f.controller.getSnapshot().session!.current_deal, before.current_deal); assert.equal(f.controller.getSnapshot().session!.input_revisions.applications, 0);
    console.log("PASS: confirmed compatible publication, exact IDs/other side/links preserved, one atomic write/notification/revision, retained stale metadata, fixed fixture version, true no-op, reload and reset");

    const g = fixture();
    const reject = (rows: Application[], expectedCode: string, expected = token(g)) => {
      const snapshot = g.controller.getSnapshot(), persisted = g.values.get(SESSION_STORAGE_KEY), writes = g.writes();
      const result = g.controller.publishApplications("buyer", rows, expected); assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, expectedCode);
      assert.equal(g.controller.getSnapshot(), snapshot); assert.equal(g.values.get(SESSION_STORAGE_KEY), persisted); assert.equal(g.writes(), writes);
    };
    const buyer = sideRows(g, "buyer"), target = sideRows(g, "target"), deal = g.controller.getSnapshot().session!.current_deal;
    for (const id of [target[0].app_id, deal.license_positions[0].license_id, deal.tsa_services[0].tsa_id]) reject(buyer.map((row, i) => i === 0 ? { ...row, app_id: id } : row), "id_collision");
    reject([...buyer, buyer[0]], "id_collision"); reject([], "invalid_candidate"); reject(Array(51).fill(buyer[0]), "invalid_candidate");
    reject(buyer.map((row) => ({ ...row, company_side: "target" })), "invalid_candidate");
    reject(buyer.map((row) => ({ ...row, annual_cost: -1 })), "invalid_candidate");
    reject(buyer.map((row, i) => ({ ...row, app_id: `incompatible-${i}` })), "orphaned_links");
    const licenseId = deal.license_positions.find((row) => buyer.some((app) => app.app_id === row.app_id))!.app_id;
    reject(buyer.filter((row) => row.app_id !== licenseId), "orphaned_links");
    const tsaId = deal.tsa_services.flatMap((row) => row.related_app_ids ?? []).find((id) => buyer.some((app) => app.app_id === id))!;
    reject(buyer.filter((row) => row.app_id !== tsaId), "orphaned_links");
    const stale = token(g); g.controller.updateLicense(deal.license_positions[0].license_id, { product: "Unrelated synthetic change" }); reject(buyer, "stale_session", stale);
    const resetToken = token(g); g.controller.resetDemoSession(); reject(buyer, "stale_session", resetToken);
    const compatible = sideRows(g, "buyer").map((row, i) => i === 0 ? { ...row, app_name: "Oversized" + "\\".repeat(260_000) } : row);
    reject(compatible, "invalid_session");
    g.values.set(SESSION_STORAGE_KEY, "{malformed saved data"); reject(buyer, "invalid_storage");
    console.log("PASS: cross-side/cross-type/duplicate IDs, license and TSA orphans, wholesale incompatible IDs, bad/overlimit candidates, stale edit/reset tokens, oversized serialization and invalid saved JSON reject with zero mutation");

    const h = fixture(); const d = confirmed(sideRows(h, "target"), "target");
    assert.equal(currentConfirmedApplications(d.source, null, "target").ok, false);
    assert.equal(currentConfirmedApplications(d.source, { ...d.mapping, revision: d.mapping.revision + 1 }, "target").ok, false);
    assert.equal(currentConfirmedApplications({ ...d.source, generation: 99 }, d.mapping, "target").ok, false);
    assert.equal(currentConfirmedApplications(d.source, d.mapping, "buyer").ok, false);
    assert.equal(currentConfirmedApplications(d.source, { ...d.mapping, confirmed: { ...d.mapping.confirmed!, rows: [] } }, "target").ok, false);
    if (d.source.status === "ready") assert.equal(currentConfirmedApplications({ ...d.source, preview: { ...d.source.preview, rows: [] } }, d.mapping, "target").ok, false);
    assert.equal(currentConfirmedApplications({ side: "target", generation: 2, status: "not_selected" }, d.mapping, "target").ok, false);
    const targetRows = sideRows(h, "target").map((row, i) => i === 0 ? { ...row, app_name: "Memory-only synthetic edit" } : row);
    h.deny(); assert.equal(h.controller.publishApplications("target", targetRows, token(h)).ok, true); assert.equal(h.controller.getSnapshot().storageAvailable, false); assert.equal(h.values.has(SESSION_STORAGE_KEY), false);
    assert.equal(h.controller.getSnapshot().session!.current_deal.applications.find((row) => row.app_id === targetRows[0].app_id)!.app_name, targetRows[0].app_name);
    const rejected = prepareApplicationPublication(deal, "buyer", buyer.map((row, i) => ({ ...row, app_id: `new-${i}` })));
    assert.ok(!rejected.ok && rejected.code === "orphaned_links" && (rejected.licenses ?? 0) > 0 && (rejected.tsa ?? 0) > 0);
    assert.equal(requests, 0);
    console.log("PASS: absent/stale/tampered confirmation/source/map/side/clear rejected; denied persistence retains memory with existing warning; safe blocker counts and zero network/provider attempts");
  } finally { globalThis.fetch = savedFetch; }
}

export async function checkPublishBrowser({ page, evaluate, until, key, base }: Parameters<typeof import("./check-csv-preview.mts").checkCSVBrowser>[0]) {
  const original = JSON.parse(await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')"));
  const directory = await mkdtemp(path.join(tmpdir(), "aivra-u0104-publish-"));
  const rows: Application[] = original.current_deal.applications.filter((row: Application) => row.company_side === "buyer");
  const changed = rows.map((row, index) => index === 0 ? { ...row, app_name: "Published browser synthetic application" } : row);
  changed.push({ ...rows[0], app_id: "new-unlinked-synthetic", app_name: "Additional synthetic application" });
  const file = path.join(directory, "compatible.csv"); await writeFile(file, csvText(changed));
  const blockedFile = path.join(directory, "blocked.csv"); await writeFile(blockedFile, csvText([{ ...rows[0], app_id: "incompatible-browser-id" }]));
  async function choose(filePath: string) {
    const { root } = await page("DOM.getDocument"); const { nodeId } = await page("DOM.querySelector", { nodeId: root.nodeId, selector: ".csv-preview section:nth-child(1) input" });
    await page("DOM.setFileInputFiles", { nodeId, files: [filePath] }); await until("!!document.querySelector('.csv-preview section:not([hidden]) .column-mapping')");
    for (const [index, [field]] of INVENTORY_COLUMNS.entries()) await evaluate(`(() => { const select = document.querySelector('.csv-preview section:not([hidden]) [data-mapping-field="${field}"]'); select.value = '${index}'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await until("!document.querySelector('.csv-preview section:not([hidden]) .mapping-confirm').disabled");
    await evaluate("document.querySelector('.csv-preview section:not([hidden]) .mapping-confirm').click()"); await until("!!document.querySelector('.publication-review')");
  }
  await choose(blockedFile); await evaluate("document.querySelector('.publication-review').click()");
  assert.equal(await evaluate("document.querySelector('.publication-submit').disabled"), true);
  assert.match(await evaluate("document.querySelector('.publication-block').textContent"), /orphan.*license.*TSA/);
  await choose(file);
  for (const width of [1440, 390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.querySelector('.publication-review').click()"); await until("document.activeElement.classList.contains('publication-submit')");
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.publication-impact dd')].map(e=>Number(e.textContent))"), [15, 16, 1, 0, 15]);
    await evaluate("document.querySelector('.publication-cancel').focus()"); await key("Enter", 13); // Fall back to native click below if the harness does not encode Enter text.
    if (await evaluate("!!document.querySelector('.publication-impact')")) await evaluate("document.querySelector('.publication-cancel').click()");
    await until("document.activeElement.classList.contains('publication-review')");
  }
  await evaluate("document.querySelector('.publication-review').click()"); await evaluate("document.querySelectorAll('[role=tab]')[1].click()");
  await until("document.querySelector('[aria-selected=true]').textContent.startsWith('Target')");
  await evaluate("document.querySelectorAll('[role=tab]')[0].click()"); await until("document.querySelector('[aria-selected=true]').textContent.startsWith('Buyer')");
  assert.equal(await evaluate("document.querySelector('.publication-submit') === null"), true);
  // Reset while review is open expires its lifetime/revision token; no automatic republish.
  await evaluate("document.querySelector('.publication-review').click()");
  await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Reset demo session').click()");
  await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Confirm reset').click()");
  await until("!!document.querySelector('.publication') && !document.querySelector('.publication-submit')");
  const reset = await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')");
  await evaluate("document.querySelector('.publication-review').click()"); await evaluate("document.querySelector('.publication-submit').click()");
  await until("document.querySelector('.publication-success')?.textContent.includes('source revision 1')");
  const published = JSON.parse(await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')"));
  assert.equal(published.current_deal.applications.filter((row: Application) => row.company_side === "buyer").length, 16);
  assert.deepEqual(published.current_deal.license_positions, original.current_deal.license_positions); assert.deepEqual(published.current_deal.tsa_services, original.current_deal.tsa_services);
  assert.equal(published.current_deal.dataset_version, "1.0.0");
  // A second explicit publish is a no-op, including persisted bytes.
  const stored = JSON.stringify(published); await evaluate("document.querySelector('.publication-review').click()"); await evaluate("document.querySelector('.publication-submit').click()");
  await until("document.querySelector('.publication-success')?.textContent.includes('No changes to publish')");
  assert.equal(await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')"), stored);
  await page("Page.reload"); await until("document.querySelector('tbody')?.textContent.includes('Published browser synthetic application')");
  assert.equal(await evaluate("document.querySelector('.publication-submit') === null"), true);
  await page("Page.navigate", { url: `${base}/` }); await until("location.pathname==='/' && !!document.querySelector('dl dd')");
  await until("document.querySelector('dl dd').textContent === '16'");
  assert.equal(await evaluate("document.querySelector('dl dd').textContent"), "16");
  await page("Page.navigate", { url: `${base}/data-mapper` }); await until("document.querySelector('tbody')?.textContent.includes('Published browser synthetic application')");
  await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Reset demo session').click()"); await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Confirm reset').click()");
  await until("!!document.querySelector('tbody') && !document.querySelector('tbody').textContent.includes('Published browser synthetic application')");
  const final = JSON.parse(await evaluate("sessionStorage.getItem('aivra:r0:demo-session:v1')")); assert.deepEqual(final.current_deal, original.current_deal); assert.equal(final.input_revisions.applications, 0);
  assert.ok(reset); console.log("PASS: real compatible/blocked publication, explicit impact/Publish/Cancel/focus at 1440/390/320px, tab/reset review invalidation, source revision/success/no-op, Home counts, reload/navigation and global reset without republish");
}
