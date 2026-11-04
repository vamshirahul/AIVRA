import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createDemoSession, DemoSessionSchema, SESSION_STORAGE_KEY } from "../lib/session/session.ts";
import { createDemoSessionController } from "../lib/session/controller.ts";
import { TSAServiceSchema } from "../lib/contracts/demo.ts";
import { tsaInventoryRows, tsaInventoryCells, TSA_COLUMNS, TSA_STATUS_LABELS } from "../lib/tsa-tracker/tsa-inventory-view.ts";

const initial = createDemoSession(), deal = initial.current_deal;
const display = (s = initial) => tsaInventoryRows(s.current_deal.tsa_services, s.current_deal.applications).rows.map(tsaInventoryCells);
if (!process.argv.includes("--tsa-browser")) {
  let groups = 0, network = 0; const fetchBefore = globalThis.fetch; globalThis.fetch = async () => { network++; throw Error("TSA inventory checks forbid network"); };
  async function check(name: string, run: () => unknown | Promise<unknown>) { await run(); groups++; console.log(`PASS: ${name}`); }
  try {
    const original = JSON.stringify(initial);
    await check("five real source services, all eleven fields and exact Buyer/Target application joins", () => {
      const projected = tsaInventoryRows(deal.tsa_services, deal.applications); assert.equal(projected.rows.length, 5); assert.deepEqual(projected.issues, []); assert.equal(TSA_COLUMNS.length, 11);
      for (const [i, row] of projected.rows.entries()) {
        const s = deal.tsa_services[i]; assert.deepEqual(row.service, s);
        const expectedLinks = s.related_app_ids!.map((id) => { const a = deal.applications.find((a) => a.app_id === id)!; return `${id} · ${a.company_side === "buyer" ? "Buyer" : "Target"} · ${a.app_name}`; }).join("\n");
        assert.deepEqual(tsaInventoryCells(row), [s.tsa_id, s.title, s.provider, s.recipient, s.owner ?? "Unknown", s.start_date ?? "Unknown", s.end_date ?? "Unknown", "Planned", s.exit_milestone ?? "Unknown / not supplied", s.risk_notes ?? "Unknown / not supplied", expectedLinks]);
        assert.deepEqual(row.applications.map((a) => a.app_id), s.related_app_ids);
      }
      const reordered = tsaInventoryRows([...deal.tsa_services].reverse(), [...deal.applications].reverse()); assert.deepEqual(reordered.rows.map((r) => r.service.tsa_id), [...deal.tsa_services].reverse().map((s) => s.tsa_id)); assert.deepEqual(reordered.rows.map(tsaInventoryCells).reverse(), display());
    });
    await check("all source status labels, exact ISO dates, unknowns and omitted-versus-empty relationships", () => {
      for (const status of TSAServiceSchema.shape.status.options) { const s = { ...deal.tsa_services[0], status, start_date: "2000-02-29", end_date: "2035-01-01" }; const r = tsaInventoryRows([s], deal.applications); assert.equal(r.issues.length, 0); assert.equal(tsaInventoryCells(r.rows[0])[7], TSA_STATUS_LABELS[status]); assert.deepEqual(tsaInventoryCells(r.rows[0]).slice(5, 7), [s.start_date, s.end_date]); }
      assert.deepEqual(TSA_STATUS_LABELS, { planned: "Planned", active: "Active", at_risk: "At risk", completed: "Completed" });
      const absent = { ...deal.tsa_services[0], owner: null, start_date: null, end_date: null, exit_milestone: null, risk_notes: null }; delete absent.related_app_ids;
      const values = tsaInventoryCells(tsaInventoryRows([absent], deal.applications).rows[0]); assert.deepEqual(values.slice(4, 7), ["Unknown", "Unknown", "Unknown"]); assert.deepEqual(values.slice(8), ["Unknown / not supplied", "Unknown / not supplied", "Relationship information not supplied"]);
      assert.equal(tsaInventoryCells(tsaInventoryRows([{ ...absent, related_app_ids: [] }], deal.applications).rows[0])[10], "No application links recorded"); assert.deepEqual(tsaInventoryRows([], deal.applications), { rows: [], issues: [] });
    });
    await check("malformed/duplicate/oversized records and ambiguous/unresolved links fail without invented identities", () => {
      const base = deal.tsa_services[0];
      for (const bad of [null, "text", { ...base, status: "overdue" }, { ...base, start_date: "2027-02-30" }, { ...base, end_date: "2026-01-01" }, { ...base, owner: " " }, { ...base, title: " trimmed " }, { ...base, related_app_ids: [base.related_app_ids![0], base.related_app_ids![0]] }, { ...base, extra: true }]) { const r = tsaInventoryRows([bad], deal.applications); assert.equal(r.rows.length, 0); assert.equal(r.issues[0].code, "invalid_service"); assert.ok(r.issues[0].message.length < 200); }
      assert.equal(tsaInventoryRows([base, base], deal.applications).rows.length, 0);
      for (const apps of [[], [deal.applications[0], deal.applications[0]], [{ ...deal.applications[0], app_name: " " }]]) { const r = tsaInventoryRows([{ ...base, related_app_ids: [deal.applications[0].app_id] }], apps); assert.equal(r.rows[0].service.tsa_id, base.tsa_id); assert.equal(r.rows[0].applications[0].application, null); assert.equal(tsaInventoryCells(r.rows[0])[10], `${deal.applications[0].app_id} · Unresolved application reference`); assert.ok(r.issues.some((i) => i.code === "unresolved_reference")); }
      for (const input of [undefined, {}, Array(101).fill(base), [{ ...base, title: "x".repeat(2_000_001) }]]) assert.equal(tsaInventoryRows(input, deal.applications).issues[0].code, "invalid_inventory");
      const cyclic: unknown[] = []; cyclic.push(cyclic); assert.equal(tsaInventoryRows(cyclic, []).issues[0].code, "invalid_inventory");
      const invalidSession = structuredClone(initial); invalidSession.current_deal.tsa_services[0].related_app_ids = ["unknown-app"]; assert.equal(DemoSessionSchema.safeParse(invalidSession).success, false);
    });
    await check("shared-controller live TSA/app updates, passive reads, refresh/reset and dynamic 0/1/100 rows", () => {
      const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
      const c = createDemoSessionController(() => storage); c.initialize(); const before = values.get(SESSION_STORAGE_KEY); let notifications = 0; const observed: string[][][] = []; const unsubscribe = c.subscribe(() => { notifications++; observed.push(display(c.getSnapshot().session!)); });
      for (let i = 0; i < 3; i++) display(c.getSnapshot().session!); assert.equal(notifications, 0); assert.equal(values.get(SESSION_STORAGE_KEY), before);
      const service = deal.tsa_services[0], appId = service.related_app_ids![0]; assert.ok(c.updateTSA(service.tsa_id, { owner: null, status: "at_risk", risk_notes: "Fictional source note", end_date: "2027-07-01" }).ok); assert.equal(observed[0][0][4], "Unknown"); assert.equal(observed[0][0][6], "2027-07-01"); assert.equal(observed[0][0][7], "At risk");
      assert.ok(c.updateApplication(appId, { app_name: "Renamed linked application" }).ok); assert.ok(observed[1][0][10].includes(`${appId} · Target · Renamed linked application`)); assert.equal(observed[1][0][0], service.tsa_id); const changed = c.getSnapshot().session!; assert.equal(changed.input_revisions.tsa, 1); assert.equal(changed.input_revisions.applications, 1); assert.deepEqual(changed.current_deal.license_positions, deal.license_positions); assert.deepEqual(changed.derived_results, {});
      const restored = createDemoSessionController(() => storage); restored.initialize(); assert.deepEqual(display(restored.getSnapshot().session!), display(changed)); assert.equal(notifications, 2); c.resetDemoSession(); assert.deepEqual(display(c.getSnapshot().session!), display()); unsubscribe();
      for (const n of [0, 1, 100]) { const s = structuredClone(initial); s.current_deal.tsa_services = Array.from({ length: n }, (_, i) => ({ ...service, tsa_id: `tsa-test-${i}` })); assert.ok(DemoSessionSchema.safeParse(s).success); assert.equal(display(s).length, n); }
      assert.equal(JSON.stringify(initial), original);
    });
    await check("actual SSR loading/unavailable/empty/source text, accessible inventory and read-only public wiring", async () => {
      registerHooks({ resolve(spec, context, next) { try { return next(spec, context); } catch (error) { if (spec.startsWith(".")) for (const ext of [".ts", ".tsx"]) { try { return next(spec + ext, context); } catch {} } throw error; } }, load(url, context, next) { if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(awaitSource(url), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText }; return next(url, context); } });
      const { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server"), { TSAInventoryView } = await import("../components/tsa-tracker/tsa-inventory.tsx");
      const render = (s: typeof initial | null, ready = true) => renderToStaticMarkup(createElement(TSAInventoryView, { session: s, ready }));
      assert.match(render(null, false), /role="status"[^>]*>Preparing/); assert.match(render(null), /unavailable/); const empty = structuredClone(initial); empty.current_deal.tsa_services = []; assert.match(render(empty), /No TSA services are present/); assert.doesNotMatch(render(empty), /<table/);
      const text = structuredClone(initial); text.current_deal.tsa_services[0].risk_notes = '<script>fictional</script> Ω "notes"'; const html = render(text); assert.ok(html.includes("&lt;script&gt;fictional&lt;/script&gt;")); assert.doesNotMatch(html, /<script|<button|<input|<select|<a\b/); assert.equal((html.match(/scope="col"/g) ?? []).length, 11); assert.equal((html.match(/scope="row"/g) ?? []).length, 5); assert.match(html, /<caption>/); assert.match(html, /role="region"/); assert.match(html, /tabindex="0"/);
      const ui = await readFile("components/tsa-tracker/tsa-inventory.tsx", "utf8"), helper = await readFile("lib/tsa-tracker/tsa-inventory-view.ts", "utf8"), page = await readFile("app/[module]/page.tsx", "utf8");
      assert.match(page, /module.href === "\/tsa-tracker" \? <TSAInventory/); for (const code of [ui, helper]) assert.doesNotMatch(code, /fetch\(|updateTSA|updateApplication|sessionStorage|localStorage|recordDerived|Date\(|Date\.now|DateTimeFormat|dangerouslySetInnerHTML/); assert.equal(network, 0);
    });
    console.log(`PASS: ${groups} U07.01 groups; exact read-only TSA source fields, current session links and zero network/provider calls.`);
  } finally { globalThis.fetch = fetchBefore; }
}

// Synchronous loader hook for the actual TSX renderer; no app/test dependency added.
import { readFileSync } from "node:fs";
function awaitSource(url: string) { return readFileSync(fileURLToPath(url), "utf8"); }

type Browser = { page: (method: string, params?: object) => Promise<any>; evaluate: (expression: string) => Promise<any>; waitFor: (expression: string) => Promise<void>; load: (method?: string, params?: object) => Promise<void>; key: (name: string, code: number) => Promise<void>; base: string; output: string; evidence: { checks: string[] } };
export async function checkTSAInventoryBrowser({ page, evaluate, waitFor, load, key, base, output, evidence }: Browser) {
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{const original=window.fetch.bind(window);window.__tsaAPICalls=[];window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.pathname.startsWith('/api/')||url.origin!==location.origin)window.__tsaAPICalls.push(url.href);return original(input,init)}})()` });
  await load("Page.navigate", { url: base + "/tsa-tracker" }); await waitFor("document.querySelectorAll('.tsa-inventory tbody tr').length===5");
  const original = await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`), actual = () => evaluate("[...document.querySelectorAll('.tsa-inventory tbody tr')].map(r=>[...r.children].slice(0,11).map(c=>c.textContent))");
  for (const width of [1440, 390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    assert.deepEqual(await actual(), display()); assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"), false); assert.equal(await evaluate("document.querySelectorAll('.tsa-inventory thead th[scope=col]').length"), 12); assert.equal(await evaluate("document.querySelectorAll('.tsa-inventory tbody th[scope=row]').length"), 5);
    assert.equal(await evaluate("document.querySelectorAll('.tsa-inventory input,.tsa-inventory select,.tsa-inventory a').length"), 0); assert.equal(await evaluate("document.querySelectorAll('.tsa-inventory button').length"), 5);
    await page("Page.bringToFront"); await evaluate("document.querySelector('.tsa-inventory .inventory-scroll').focus();document.querySelector('.tsa-inventory .inventory-scroll').scrollLeft=0"); await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"); assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none"); await key("ArrowRight", 39); await waitFor("document.querySelector('.tsa-inventory .inventory-scroll').scrollLeft>0");
    for (const edge of ["source", "links"]) { await evaluate(`document.querySelector('.tsa-inventory .inventory-scroll').scrollLeft=${edge === "source" ? "0" : "99999"}`); const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await writeFile(`${output}/${edge}-${width}.png`, Buffer.from(data, "base64")); }
    assert.equal(await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`), original); assert.equal(await evaluate("window.__tsaAPICalls.length"), 0);
  }
  const { nodes } = await page("Accessibility.getFullAXTree"); assert.ok(nodes.some((n: any) => !n.ignored && n.role?.value === "region" && n.name?.value === "TSA inventory source fields"));
  evidence.checks.push("Actual public TSA route: all five current rows/eleven unchanged source fields/exact links plus U07.02 action/attention column; 1440/390/320 keyboard scrolling and focus, six source/link screenshots, no overflow/API calls or inline mutation controls.");
  const values = new Map([[SESSION_STORAGE_KEY, original as string]]), c = createDemoSessionController(() => ({ getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: (k) => { values.delete(k); } })); c.initialize(); const first = deal.tsa_services[0];
  assert.ok(c.updateTSA(first.tsa_id, { title: "Edited fictional TSA " + "T".repeat(180), owner: null, status: "at_risk", start_date: null, exit_milestone: null, risk_notes: '<script>fictional</script> "TSA" Ω ' + "R".repeat(350), related_app_ids: [] }).ok); assert.ok(c.updateApplication(deal.tsa_services[2].related_app_ids![0], { app_name: "Edited linked application " + "A".repeat(250) }).ok); const changed = c.getSnapshot().session!;
  await evaluate(`sessionStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)},${JSON.stringify(values.get(SESSION_STORAGE_KEY)!)})`); await load(); await waitFor("document.querySelector('.tsa-inventory tbody')?.textContent.includes('Edited fictional TSA')"); assert.deepEqual(await actual(), display(changed)); assert.equal(await evaluate("document.querySelectorAll('.tsa-inventory tbody script').length"), 0); assert.ok(await evaluate("document.querySelector('.tsa-inventory tbody').textContent.includes('<script>fictional</script>')")); assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"), false);
  assert.match(await evaluate("document.querySelector('.tsa-source-summary').textContent"), /TSA source revision 1.*Application source revision 1/);
  await evaluate("document.querySelector('nav a[href=\"/\"]').click()"); await waitFor("location.pathname==='/'"); await evaluate("document.querySelector('nav a[href=\"/tsa-tracker\"]').click()"); await waitFor("!!document.querySelector('.tsa-inventory tbody')"); assert.deepEqual(await actual(), display(changed));
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Reset demo session').focus()"); await key("Enter", 13); await waitFor("document.activeElement.textContent==='Confirm reset'"); await key("Enter", 13); await waitFor("!document.querySelector('.tsa-inventory tbody').textContent.includes('Edited fictional TSA')"); assert.deepEqual(await actual(), display()); assert.ok(await evaluate("document.activeElement.textContent==='Reset demo session'"));
  const empty = createDemoSession(); empty.current_deal.tsa_services = []; assert.ok(DemoSessionSchema.safeParse(empty).success); await evaluate(`sessionStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)},${JSON.stringify(JSON.stringify(empty))})`); await load(); await waitFor("document.querySelector('.tsa-inventory')?.textContent.includes('No TSA services are present')"); assert.equal(await evaluate("document.querySelectorAll('.tsa-inventory tbody tr').length"), 0); assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7); assert.equal(await evaluate("document.querySelectorAll('.future-features a,.future-features button,.future-features [tabindex]').length"), 0); assert.equal(await evaluate("window.__tsaAPICalls.length"), 0);
  evidence.checks.push("Real controller-edited source reload/navigation, null/empty links and long escaped Unicode text, source revisions, keyboard live Reset and empty inventory; inert seven placeholders preserved. Node subscription checks cover immediate app/TSA updates without reload.");
}
