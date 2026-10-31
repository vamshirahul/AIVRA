import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CSV_ERRORS, MAX_CSV_BYTES, csvDraftReducer, initialCSVDrafts, parseCSVBytes, readCSVFile } from "../lib/data-mapper/parse-csv.ts";
import type { CSVDrafts, CSVResult } from "../lib/data-mapper/parse-csv.ts";

const encoder = new TextEncoder();
const parse = (text: string, name = "fictional.csv") => parseCSVBytes(name, encoder.encode(text));
function valid(result: CSVResult) { assert.equal(result.ok, true); if (!result.ok) throw new Error("Expected valid synthetic CSV"); return result; }
function invalid(result: CSVResult, code: keyof typeof CSV_ERRORS, row?: number) { assert.equal(result.ok, false); if (result.ok) throw new Error("Expected rejected synthetic CSV"); assert.equal(result.error.code, code); if (row !== undefined) assert.equal(result.error.row, row); }

if (!process.argv.includes("--csv-browser")) {
  const savedFetch = globalThis.fetch; let network = 0;
  globalThis.fetch = async () => { network++; throw new Error("CSV checks forbid network"); };
  try {
    assert.equal(valid(parse("Name,Cost\nExample,0")).row_count, 1);
    const fifty = "Name\n" + Array.from({ length: 50 }, (_, i) => `Synthetic ${i}`).join("\n");
    assert.equal(valid(parse(fifty)).row_count, 50); invalid(parse(`${fifty}\nExtra`), "too_many_rows", 51);
    const boundary = encoder.encode("Header\n" + "x".repeat(MAX_CSV_BYTES - 7));
    assert.equal(boundary.byteLength, MAX_CSV_BYTES); assert.equal(valid(parseCSVBytes("BOUNDARY.CSV", boundary)).file_size_bytes, MAX_CSV_BYTES);
    const tooLarge = new Uint8Array(MAX_CSV_BYTES + 1); invalid(parseCSVBytes("large.csv", tooLarge), "too_large");
    let reads = 0;
    const largeFile = { name: "large.csv", size: MAX_CSV_BYTES + 1, arrayBuffer: async () => { reads++; return tooLarge.buffer; } };
    invalid(await readCSVFile(largeFile), "too_large"); assert.equal(reads, 0);
    invalid(await readCSVFile({ ...largeFile, size: 1 }), "too_large");
    invalid(await readCSVFile({ name: "bad.csv", size: 2, arrayBuffer: async () => new ArrayBuffer(1) }), "read_failed");
    invalid(await readCSVFile({ name: "bad.csv", size: 2, arrayBuffer: async () => { throw new Error("PRIVATE_READ_CANARY"); } }), "read_failed");
    console.log("PASS: 1/50/51 records, exact 500000/500001-byte bounds, overlimit files never read, actual buffer/read failures safe");

    const quoted = valid(parse('\uFEFFRaw header,Notes,Empty\r\n"Équipe, 東京","first\r\nsecond ""quoted""",\r\n'));
    assert.deepEqual(quoted.headers, ["Raw header", "Notes", "Empty"]);
    assert.deepEqual(quoted.rows, [["Équipe, 東京", 'first\r\nsecond "quoted"', ""]]);
    assert.deepEqual(valid(parse(" Header ,Header\ra,b\r")).headers, [" Header ", "Header"]);
    assert.deepEqual(valid(parse('h\n""\n\n')).rows, [[""]]);
    assert.equal(valid(parse("\n\r\nHeader\n\nitem\n\r\n")).row_count, 1);
    invalid(parse(`${fifty}\n\n\n""`), "too_many_rows", 51);
    invalid(parse(`${fifty}\n `), "too_many_rows", 51);
    invalid(parse(`${fifty}\n,`), "too_many_rows", 51);
    assert.equal(valid(parse("Header")).row_count, 0);
    const dangerous = valid(parse('Header\n"<img src=x onerror=alert(1)>"\n=SUM(A1:A2)'));
    assert.deepEqual(dangerous.rows, [["<img src=x onerror=alert(1)>"], ["=SUM(A1:A2)"]]);
    console.log("PASS: BOM/Unicode, comma/escaped quotes/embedded newlines, CRLF/LF/CR, raw spaces/empty cells, explicit blank-line policy, header-only and inert HTML/formula source");

    invalid(parse(""), "empty_file");
    for (const text of ["\n\r\n", "\uFEFF", "   \nvalue", ",Header\na,b", '""\nvalue']) invalid(parse(text), "missing_header", 0);
    invalid(parse("a,b\n1\n"), "wrong_width", 1); invalid(parse('a,b\n"one\nline",two\n1,2,3'), "wrong_width", 2);
    for (const text of ['h\n"unfinished', 'h\na"b', 'h\n"a"x', 'h\n"a" ']) invalid(parse(text), "malformed_quotes", 1);
    invalid(parse('"bad'), "malformed_quotes", 0);
    for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xff, 0xfe, 65, 0]), encoder.encode("h\0\nx\0")]) invalid(parseCSVBytes("encoding.csv", bytes), "invalid_utf8");
    for (const name of ["", ".csv", "a.csv.exe", "a.xlsx", "a.xls", "a.tsv", "a.json", "a.csv ", "path/a.csv"]) invalid(parse("h\nx", name), "invalid_file");
    assert.ok(valid(parse("h\nx", "x".repeat(200) + ".csv")).file_name.length <= 120);
    assert.ok(!JSON.stringify(await readCSVFile({ name: "a.csv", size: 1, arrayBuffer: async () => { throw new Error("PRIVATE_READ_CANARY"); } })).includes("PRIVATE_READ_CANARY"));
    console.log("PASS: finite safe errors for headers, row-indexed widths/quotes, malformed UTF-8/UTF-16/NUL, unsupported extensions and bounded filenames; no raw exception text");

    let drafts: CSVDrafts = initialCSVDrafts;
    const ready = parse("Header\nFictional");
    drafts = csvDraftReducer(drafts, { type: "begin", side: "buyer", generation: 1 });
    drafts = csvDraftReducer(drafts, { type: "complete", side: "buyer", generation: 1, result: ready });
    const buyer = drafts.buyer;
    drafts = csvDraftReducer(drafts, { type: "begin", side: "target", generation: 2 });
    drafts = csvDraftReducer(drafts, { type: "complete", side: "target", generation: 2, result: ready });
    assert.equal(drafts.buyer, buyer); const target = drafts.target;
    drafts = csvDraftReducer(drafts, { type: "begin", side: "buyer", generation: 3 });
    drafts = csvDraftReducer(drafts, { type: "begin", side: "buyer", generation: 4 });
    assert.equal(csvDraftReducer(drafts, { type: "complete", side: "buyer", generation: 3, result: ready }), drafts);
    drafts = csvDraftReducer(drafts, { type: "clear", side: "buyer", generation: 5 });
    assert.equal(csvDraftReducer(drafts, { type: "complete", side: "buyer", generation: 4, result: ready }), drafts);
    drafts = csvDraftReducer(drafts, { type: "begin", side: "buyer", generation: 6 });
    drafts = csvDraftReducer(drafts, { type: "complete", side: "buyer", generation: 6, result: parse("bad\n1,2") });
    assert.equal(drafts.buyer.status, "error");
    drafts = csvDraftReducer(drafts, { type: "begin", side: "buyer", generation: 7 });
    drafts = csvDraftReducer(drafts, { type: "complete", side: "buyer", generation: 7, result: ready });
    assert.equal(drafts.buyer.status, "ready"); assert.equal(drafts.target, target);
    assert.equal(initialCSVDrafts.buyer.status, "not_selected"); assert.equal(network, 0);
    console.log("PASS: immutable independent side drafts, replacement/clear/stale completion/error recovery, zero network attempts; no session dependency");
  } finally { globalThis.fetch = savedFetch; }
}

// Called only by the existing optional Data Mapper Chromium harness.
export async function checkCSVBrowser({ page, evaluate, until, navigate, key, base }: {
  page: (method: string, params?: object) => Promise<any>; evaluate: (expression: string) => Promise<any>;
  until: (expression: string) => Promise<void>; navigate: (route: string) => Promise<void>; key: (name: string, code: number) => Promise<void>; base: string;
}) {
  const directory = await mkdtemp(path.join(tmpdir(), "aivra-u0102-csv-"));
  const files = { buyer: "buyer.csv", target: "target.csv", bad: "bad.csv", slow: "slow.csv", newer: "newer.csv" };
  for (const [name, file] of Object.entries(files)) await writeFile(path.join(directory, file), name === "bad" ? 'Header\n"unfinished' : `Original,Notes\n${name},"<img src=x onerror=alert(1)>"\n=SUM(A1:A2),"quoted, source"`);
  async function select(side: "buyer" | "target", file: string) {
    const { root } = await page("DOM.getDocument");
    const { nodeId } = await page("DOM.querySelector", { nodeId: root.nodeId, selector: `.csv-preview section:nth-child(${side === "buyer" ? 1 : 2}) input` });
    await page("DOM.setFileInputFiles", { nodeId, files: [path.join(directory, file)] });
  }
  async function switchSide(side: "Buyer" | "Target") { await evaluate(`document.querySelectorAll('[role=tab]')[${side === "Buyer" ? 0 : 1}].click()`); await until(`document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('${side}')`); }
  const storage = "sessionStorage.getItem('aivra:r0:demo-session:v1')";
  const before = await evaluate(storage);
  const sample = await evaluate("document.querySelector('.inventory-table tbody').innerText");
  assert.equal(await evaluate("document.querySelector('.csv-preview section:not([hidden]) label').textContent"), "Choose Buyer CSV");
  await select("buyer", files.buyer); await until("document.querySelector('.csv-preview section:not([hidden]) .csv-metadata')?.textContent.includes('buyer.csv')");
  await switchSide("Target"); await select("target", files.target); await until("document.querySelector('.csv-preview section:not([hidden]) .csv-metadata')?.textContent.includes('target.csv')");
  for (const width of [1440, 390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const side of ["Buyer", "Target"] as const) {
      await switchSide(side);
      assert.equal(await evaluate("document.querySelector('.csv-preview section:not([hidden]) label').control.type"), "file");
      const cells = await evaluate("[...document.querySelectorAll('.csv-preview section:not([hidden]) .csv-table tbody tr')].map(r => [...r.children].map(c => c.textContent))");
      assert.deepEqual(cells, [[side.toLowerCase(), "<img src=x onerror=alert(1)>"], ["=SUM(A1:A2)", "quoted, source"]]);
      assert.equal(await evaluate("document.querySelectorAll('.csv-table img, .csv-table script').length"), 0);
      assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
      await evaluate("document.querySelector('.csv-preview section:not([hidden]) input').focus()");
      assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none");
    }
    await evaluate("document.querySelector('[role=tab][aria-selected=true]').focus()");
    await key("Home", 36); await until("document.activeElement.textContent.startsWith('Buyer')");
    await key("End", 35); await until("document.activeElement.textContent.startsWith('Target')");
  }
  await switchSide("Buyer"); await select("buyer", files.bad); await until("!!document.querySelector('.csv-preview section:not([hidden]) [role=alert]')");
  assert.equal(await evaluate("document.querySelector('.csv-preview section:not([hidden]) .csv-table') === null"), true);
  await switchSide("Target"); assert.ok(await evaluate("document.querySelector('.csv-preview section:not([hidden]) .csv-metadata').textContent.includes('target.csv')"));
  await switchSide("Buyer"); await select("buyer", files.buyer); await until("!!document.querySelector('.csv-preview section:not([hidden]) .csv-metadata')");
  // Real component race: delay an actual File read, replace/clear/unmount, then release it.
  await evaluate("window.__originalCSVRead = File.prototype.arrayBuffer; File.prototype.arrayBuffer = function() { if(this.name === 'slow.csv') return new Promise(resolve => { window.__releaseCSVRead = () => window.__originalCSVRead.call(this).then(resolve); }); return window.__originalCSVRead.call(this); }");
  await select("buyer", files.slow); await until("document.querySelector('.csv-preview section:not([hidden]) [role=status]')?.textContent.includes('Reading')");
  await select("buyer", files.newer); await until("document.querySelector('.csv-preview section:not([hidden]) .csv-metadata')?.textContent.includes('newer.csv')");
  await evaluate("window.__releaseCSVRead()");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.ok(await evaluate("document.querySelector('.csv-preview section:not([hidden]) .csv-metadata').textContent.includes('newer.csv')"));
  await select("buyer", files.slow); await until("!!document.querySelector('.csv-preview section:not([hidden]) [role=status]')");
  await evaluate("document.querySelector('.csv-preview section:not([hidden]) button').click(); window.__releaseCSVRead()");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.ok(await evaluate("document.querySelector('.csv-preview section:not([hidden])').textContent.includes('No Buyer CSV selected')"));
  await select("buyer", files.slow); await until("!!document.querySelector('.csv-preview section:not([hidden]) [role=status]')");
  await evaluate("document.querySelector('nav a[href=\"/\"]').click()"); await until("location.pathname === '/'");
  await evaluate("window.__releaseCSVRead(); File.prototype.arrayBuffer = window.__originalCSVRead; delete window.__originalCSVRead; delete window.__releaseCSVRead");
  await evaluate("document.querySelector('nav a[href=\"/data-mapper\"]').click()"); await until("location.pathname === '/data-mapper' && !!document.querySelector('.csv-preview')");
  assert.ok(await evaluate("document.querySelector('.csv-preview section:not([hidden])').textContent.includes('No Buyer CSV selected')"));
  await switchSide("Target"); assert.ok(await evaluate("document.querySelector('.csv-preview section:not([hidden])').textContent.includes('No Target CSV selected')"));
  await switchSide("Buyer");
  assert.equal(await evaluate("document.querySelector('.inventory-table tbody').innerText"), sample);
  assert.equal(await evaluate(storage), before);
  await page("Page.reload"); await until("!!document.querySelector('.csv-preview')");
  assert.equal(await evaluate(storage), before);
  assert.equal(await evaluate("document.querySelectorAll('nav a').length"), 10);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature a,.future-feature button,.future-feature [tabindex]').length"), 0);
  for (const route of ["/", "/integration-health", "/data-mapper", "/application-rationalization", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"]) {
    const response = await fetch(`${base}${route}`); assert.equal(response.status, 200);
    if (["/application-rationalization", "/license-optimizer", "/playbook-generator", "/ai-assistant"].includes(route)) assert.match(await response.text(), /AI not enabled/);
  }
  console.log("PASS: actual CSV file selection/side isolation/replacement/error/clear, real delayed-read races including unmount, raw safe cells, sample/session preservation, 1440/390/320px keyboard/layout, ten routes and disabled notices/inert gallery; loopback only");
}
