import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCSVBytes } from "../lib/data-mapper/parse-csv.ts";
import { columnMappingReducer, emptySelections, initialMappingState, validateColumnMapping } from "../lib/data-mapper/column-mapping.ts";
import type { CSVSource, ColumnSelections, MappingState } from "../lib/data-mapper/column-mapping.ts";

const parse = (text: string): CSVSource => { const result = parseCSVBytes("fictional.csv", new TextEncoder().encode(text)); assert.ok(result.ok); return result; };
const source = parse('Renamed,Duplicate,Duplicate,Cost,Deploy,Critical,Life,Owner,Notes,Vendor\nopaque-A, Example , Operations ,0, CLOUD , HIGH , Active , , test , Vendor\nopaque-B,Other,Finance,,on_premise,low,legacy,Owner,,');
const mapping: ColumnSelections = { app_id: 0, app_name: 1, function: 2, annual_cost: 3, deployment: 4, criticality: 5, lifecycle: 6, owner: 7, notes: 8, vendor: 9 };
const minimal = { ...emptySelections(), app_id: 0, app_name: 1, function: 2 };
const hasIssue = (result: ReturnType<typeof validateColumnMapping>, field: string, code: string, row?: number) => assert.ok(result.issues.some((issue) => issue.field === field && issue.code === code && (row === undefined || issue.row === row)));

if (!process.argv.includes("--mapping-browser")) {
  const originalFetch = globalThis.fetch; let network = 0;
  globalThis.fetch = async () => { network++; throw new Error("Mapping checks forbid network"); };
  try {
    const snapshot = JSON.stringify(source);
    const checked = validateColumnMapping(source, "buyer", mapping);
    assert.ok(checked.valid); assert.deepEqual(checked.rows.map((row) => row.app_id), ["opaque-A", "opaque-B"]);
    assert.equal(checked.rows[0].app_name, "Example"); assert.equal(checked.rows[0].function, "Operations");
    assert.equal(checked.rows[0].annual_cost, 0); assert.equal(checked.rows[1].annual_cost, null);
    assert.equal(checked.rows[0].deployment, "cloud"); assert.equal(checked.rows[0].criticality, "high"); assert.equal(checked.rows[0].lifecycle, "active");
    assert.equal(checked.rows[0].owner, null); assert.equal(checked.rows[1].notes, null);
    assert.ok(validateColumnMapping(source, "target", mapping).rows.every((row) => row.company_side === "target"));
    const optional = validateColumnMapping(source, "buyer", minimal); assert.ok(optional.valid);
    assert.ok(optional.rows.every((row) => row.vendor === null && row.annual_cost === null && row.notes === null));
    assert.equal(JSON.stringify(source), snapshot);
    console.log("PASS: renamed/duplicate headers mapped by position, exact IDs/order/side, schema text/enums/null/zero and immutable raw source");

    for (const field of ["app_id", "app_name", "function"] as const) hasIssue(validateColumnMapping(source, "buyer", { ...minimal, [field]: null }), field, "required_mapping");
    hasIssue(validateColumnMapping(source, "buyer", { ...minimal, function: 1 }), "function", "reused_column");
    for (const index of [-1, 99, .5, NaN]) hasIssue(validateColumnMapping(source, "buyer", { ...minimal, vendor: index }), "vendor", "invalid_column");
    hasIssue(validateColumnMapping(source, "buyer", { ...minimal, company_side: 3 } as ColumnSelections), "mapping", "unknown_field");
    hasIssue(validateColumnMapping(parse("one,two,three"), "buyer", minimal), "mapping", "empty_rows");
    console.log("PASS: all required fields, no reused/out-of-range/fractional indexes, unknown targets and header-only confirmation rejection");

    const invalid = parse('ID,Name,Function,Cost,Enum,Notes\n bad-id, , , -1 ,SAAS,' + "x".repeat(501) + '\nrepeat,A,F,"1,000",cloud,\nrepeat,B,F,1e3,cloud,');
    const invalidMap = { ...minimal, annual_cost: 3, deployment: 4, notes: 5 };
    const bad = validateColumnMapping(invalid, "buyer", invalidMap);
    assert.equal(bad.valid, false); assert.deepEqual(bad.rows, []);
    for (const [field, code] of [["app_id", "invalid_id"], ["app_name", "required_value"], ["function", "required_value"], ["annual_cost", "invalid_cost"], ["deployment", "invalid_enum"], ["notes", "text_too_long"]]) hasIssue(bad, field, code, 1);
    hasIssue(bad, "app_id", "duplicate_id", 3);
    for (const amount of ["-1", "+1", "$1", "1,000", "1e3", "NaN", "Infinity", ".5", "1.", "1%", "9007199254740993", "0.10000000000000001", "0." + "0".repeat(400) + "1"]) {
      hasIssue(validateColumnMapping(parse(`ID,Name,Function,Cost\nx,A,F,"${amount}"`), "buyer", { ...minimal, annual_cost: 3 }), "annual_cost", "invalid_cost", 1);
    }
    for (const amount of ["0", " 01.2500 ", "0.0000001", "1234.56"]) assert.ok(validateColumnMapping(parse(`ID,Name,Function,Cost\nx,A,F,${amount}`), "buyer", { ...minimal, annual_cost: 3 }).valid);
    const many = validateColumnMapping(parse("ID,Name,Function\n" + Array(50).fill(", , ").join("\n")), "buyer", minimal);
    assert.equal(many.total_issues, 150); assert.equal(many.issues.length, 40);
    assert.ok(!JSON.stringify(bad.issues).includes("bad-id"));
    console.log("PASS: row/field required/ID/duplicate/cost/enum/notes failures, strict lossless decimal policy, bounded 40 issues plus total; no partial candidate or raw-value notices");

    let state: MappingState = initialMappingState;
    const load = (side: "buyer" | "target", generation: number, preview = source) => {
      state = columnMappingReducer(state, { type: "csv", action: { type: "begin", side, generation } });
      state = columnMappingReducer(state, { type: "csv", action: { type: "complete", side, generation, result: preview } });
    };
    const map = (side: "buyer" | "target", generation: number) => { for (const [field, index] of Object.entries(minimal)) if (index !== null) state = columnMappingReducer(state, { type: "map", side, generation, field: field as keyof ColumnSelections, index }); };
    const confirm = (side: "buyer" | "target", generation: number) => { state = columnMappingReducer(state, { type: "confirm", side, generation, revision: state.mapping[side]!.revision }); };
    load("buyer", 1); confirm("buyer", 1); assert.equal(state.mapping.buyer!.confirmed, null);
    map("buyer", 1); confirm("buyer", 1); assert.equal(state.mapping.buyer!.confirmed!.status, "confirmed_draft");
    load("target", 2); map("target", 2); confirm("target", 2); const target = state.mapping.target;
    const raw = JSON.stringify(state.csv);
    const oldRevision = state.mapping.buyer!.revision;
    state = columnMappingReducer(state, { type: "map", side: "buyer", generation: 1, field: "vendor", index: 9 });
    assert.equal(state.mapping.buyer!.confirmed, null); assert.equal(state.mapping.target, target); assert.equal(JSON.stringify(state.csv), raw);
    assert.equal(columnMappingReducer(state, { type: "confirm", side: "buyer", generation: 1, revision: oldRevision }), state);
    confirm("buyer", 1); assert.ok(state.mapping.buyer!.confirmed);
    state = columnMappingReducer(state, { type: "csv", action: { type: "begin", side: "buyer", generation: 3 } }); assert.equal(state.mapping.buyer, null);
    assert.equal(columnMappingReducer(state, { type: "csv", action: { type: "complete", side: "buyer", generation: 1, result: source } }), state);
    state = columnMappingReducer(state, { type: "csv", action: { type: "complete", side: "buyer", generation: 3, result: { ok: false, error: { code: "read_failed" } } } }); assert.equal(state.mapping.buyer, null);
    load("buyer", 4); assert.deepEqual(state.mapping.buyer!.mappings, emptySelections()); map("buyer", 4); confirm("buyer", 4);
    state = columnMappingReducer(state, { type: "csv", action: { type: "clear", side: "buyer", generation: 5 } }); assert.equal(state.mapping.buyer, null); assert.equal(state.mapping.target, target);
    assert.equal(initialMappingState.mapping.buyer, null); assert.equal(network, 0);
    console.log("PASS: confirmation revalidates exact source/revision; independent sides, map/replace/error/clear invalidation and stale source/action guards; no network/session/store use");
  } finally { globalThis.fetch = originalFetch; }
}

export async function checkMappingBrowser({ page, evaluate, until, key, base }: Parameters<typeof import("./check-csv-preview.mts").checkCSVBrowser>[0]) {
  const directory = await mkdtemp(path.join(tmpdir(), "aivra-u0103-mapping-"));
  const file = path.join(directory, "synthetic.csv");
  await writeFile(file, 'Alias,Repeated,Repeated,Money,Platform\ncandidate-A, Example , Business ,0,CLOUD\ncandidate-B,Other,Finance,,hybrid');
  async function select(side: "buyer" | "target") {
    const { root } = await page("DOM.getDocument");
    const { nodeId } = await page("DOM.querySelector", { nodeId: root.nodeId, selector: `.csv-preview section:nth-child(${side === "buyer" ? 1 : 2}) input` });
    await page("DOM.setFileInputFiles", { nodeId, files: [file] });
    await until("!!document.querySelector('.csv-preview section:not([hidden]) .column-mapping')");
  }
  const active = ".csv-preview section:not([hidden])";
  const storage = "sessionStorage.getItem('aivra:r0:demo-session:v1')";
  const before = await evaluate(storage);
  const sample = await evaluate("document.querySelector('.inventory-table tbody').innerText");
  async function set(field: string, index: string) { await evaluate(`(() => { const select = document.querySelector('${active} [data-mapping-field="${field}"]'); select.value = ${JSON.stringify(index)}; select.dispatchEvent(new Event('change', {bubbles:true})); })()`); }
  async function switchSide(side: string) { await evaluate(`document.querySelectorAll('[role=tab]')[${side === "buyer" ? 0 : 1}].click()`); await until(`document.querySelector('[aria-selected=true]').textContent.startsWith('${side === "buyer" ? "Buyer" : "Target"}')`); }
  for (const side of ["buyer", "target"] as const) {
    await switchSide(side); await select(side);
    assert.equal(await evaluate(`document.querySelector('${active} .mapping-confirm').disabled`), true);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('${active} [data-mapping-field="function"] option')].map(o=>o.textContent).slice(1,4)`), ["Column 1: Alias", "Column 2: Repeated", "Column 3: Repeated"]);
    await set("app_id", "0"); await set("app_name", "1"); await set("function", "2"); await set("annual_cost", "3"); await set("deployment", "4");
    await until(`document.querySelector('${active} .mapping-confirm').disabled === false`);
    assert.equal(await evaluate(`document.querySelectorAll('${active} .mapping-scroll tbody tr').length`), 2);
    await evaluate(`document.querySelector('${active} .mapping-confirm').click()`); await until(`!!document.querySelector('${active} .mapping-confirmed')`);
    assert.match(await evaluate(`document.querySelector('${active} .mapping-confirmed').textContent`), /Mapping confirmed \(draft only\).*Not imported\/published/);
    assert.equal(await evaluate(storage), before);
  }
  for (const width of [1440, 390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const side of ["buyer", "target"]) {
      await switchSide(side); assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
      await evaluate(`document.querySelector('${active} select').focus()`); assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none");
      await key("Tab", 9); assert.equal(await evaluate("document.activeElement.tagName"), "SELECT");
      assert.ok(await evaluate(`!!document.querySelector('${active} .mapping-confirmed')`));
    }
  }
  await switchSide("buyer"); await set("function", ""); await until(`!document.querySelector('${active} .mapping-confirmed')`);
  assert.equal(await evaluate(`document.querySelector('${active} .mapping-confirm').disabled`), true);
  await switchSide("target"); assert.ok(await evaluate(`!!document.querySelector('${active} .mapping-confirmed')`));
  await switchSide("buyer"); await select("buyer");
  assert.equal(await evaluate(`document.querySelector('${active} [data-mapping-field="app_id"]').value`), "");
  assert.equal(await evaluate(`document.querySelector('${active} .mapping-confirmed') === null`), true);
  await evaluate(`document.querySelector('${active} .csv-clear').click()`); await until(`!document.querySelector('${active} .column-mapping')`);
  assert.equal(await evaluate("document.querySelector('.inventory-table tbody').innerText"), sample);
  assert.equal(await evaluate(storage), before);
  // Real delayed read must discard confirmation and cannot reinstate it after clear.
  await switchSide("target");
  await evaluate("window.__mappingRead = File.prototype.arrayBuffer; File.prototype.arrayBuffer = function() { return new Promise(resolve => { window.__finishMappingRead = () => window.__mappingRead.call(this).then(resolve); }); }");
  const { root } = await page("DOM.getDocument"); const { nodeId } = await page("DOM.querySelector", { nodeId: root.nodeId, selector: ".csv-preview section:nth-child(2) input" });
  await page("DOM.setFileInputFiles", { nodeId, files: [file] }); await until(`!!document.querySelector('${active} [role=status]')`);
  assert.equal(await evaluate(`document.querySelector('${active} .mapping-confirmed') === null`), true);
  await evaluate(`document.querySelector('${active} .csv-clear').click(); window.__finishMappingRead()`);
  await evaluate("File.prototype.arrayBuffer = window.__mappingRead; delete window.__mappingRead; delete window.__finishMappingRead");
  assert.equal(await evaluate(`document.querySelector('${active} .column-mapping') === null`), true);
  assert.equal(await evaluate(storage), before);
  await page("Page.reload"); await until("!!document.querySelector('.csv-preview')"); assert.equal(await evaluate("document.querySelector('.column-mapping') === null"), true);
  for (const route of ["/", "/integration-health", "/data-mapper", "/application-rationalization", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"]) assert.equal((await fetch(`${base}${route}`)).status, 200);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7);
  console.log("PASS: real CSV/manual duplicate-header mapping/confirm, independent sides, keyboard selects, 1440/390/320px containment, map/file/clear/stale-read invalidation, refresh, unchanged sample/session and ten routes/gallery");
}
