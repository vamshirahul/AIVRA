import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LICENSE_COLUMNS, licenseInventoryCells, licenseInventoryRows } from "../lib/license-optimizer/license-inventory-view.ts";
import { createDemoSessionController } from "../lib/session/controller.ts";
import { createDemoSession, DemoSessionSchema, SESSION_STORAGE_KEY } from "../lib/session/session.ts";

const initial = createDemoSession(), deal = initial.current_deal;
const display = (session = initial) => licenseInventoryRows(session.current_deal.license_positions, session.current_deal.applications).map((row) => licenseInventoryCells(row, session.current_deal.currency));
if (!process.argv.includes("--license-browser")) {
  let attempts = 0; const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { attempts++; throw Error("License inventory tests forbid network/provider calls"); };
  try {
    const rows = licenseInventoryRows(deal.license_positions, deal.applications), before = JSON.stringify(initial);
    assert.equal(rows.length, 10); assert.equal(LICENSE_COLUMNS.length, 9);
    for (const [index, row] of rows.entries()) {
      const license = deal.license_positions[index], app = deal.applications.find((app) => app.app_id === license.app_id)!;
      assert.equal(row.license, license); assert.equal(row.application, app);
      const cells = licenseInventoryCells(row, deal.currency);
      assert.deepEqual(cells.slice(0, 6), [license.license_id, `${license.app_id} · ${app.company_side === "buyer" ? "Buyer" : "Target"} · ${app.app_name}`, license.vendor ?? "Unknown", license.product,
        license.seats_entitled === null ? "Unknown" : String(license.seats_entitled), license.seats_used === null ? "Unknown" : String(license.seats_used)]);
      assert.deepEqual(cells.slice(7), [license.renewal_date ?? "Unknown", license.notes ?? "Unknown"]);
      assert.equal(cells[6], license.annual_spend === null ? "Unknown" : new Intl.NumberFormat("en-CA", { style: "currency", currency: deal.currency, currencyDisplay: "code" }).format(license.annual_spend));
    }
    assert.deepEqual(licenseInventoryRows([...deal.license_positions].reverse(), [...deal.applications].reverse()).map((r) => r.license.license_id), [...deal.license_positions].reverse().map((r) => r.license_id));
    assert.ok(rows.some((r) => r.application?.company_side === "buyer") && rows.some((r) => r.application?.company_side === "target"));
    console.log("PASS: all ten source-ordered licenses/nine columns, exact IDs/current Buyer-Target app joins, independent source fields, reorder stable");

    const base = deal.license_positions[0], app = deal.applications.find((a) => a.app_id === base.app_id)!;
    const custom = { ...base, vendor: null, seats_entitled: 0, seats_used: 0, annual_spend: 0, notes: null, renewal_date: undefined };
    const cells = licenseInventoryCells(licenseInventoryRows([custom], [app])[0], deal.currency); assert.deepEqual(cells.slice(2), ["Unknown", base.product, "0", "0", "CAD\u00a00.00", "Unknown", "Unknown"]);
    for (const renewal_date of [undefined, null]) assert.equal(licenseInventoryCells({ license: { ...custom, seats_entitled: null, seats_used: null, annual_spend: null, renewal_date }, application: app }, deal.currency)[7], "Unknown");
    assert.equal(licenseInventoryCells({ license: { ...custom, annual_spend: 0.004 }, application: app }, "CAD")[6], "CAD\u00a00.004");
    assert.equal(licenseInventoryCells({ license: { ...custom, annual_spend: 1e-30 }, application: app }, "CAD")[6], "CAD 1e-30");
    assert.equal(licenseInventoryCells({ license: { ...base, annual_spend: 123.45 }, application: { ...app, annual_cost: 999999 } }, "CAD")[6], "CAD\u00a0123.45");
    const orphan = licenseInventoryRows([base], [])[0]; assert.equal(orphan.application, null); assert.match(licenseInventoryCells(orphan, "CAD")[1], /Unresolved application reference/);
    assert.equal(licenseInventoryRows([base], [app, { ...app, app_name: "Conflicting duplicate" }])[0].application, null);
    const bad = structuredClone(initial); bad.current_deal.license_positions[0].app_id = "unknown"; assert.equal(DemoSessionSchema.safeParse(bad).success, false);
    assert.equal(JSON.stringify(initial), before);
    console.log("PASS: zero/unknown/absent dates and tiny nonzero spending, license-versus-app cost, no source mutations or invented broken-link repair");

    const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    const controller = createDemoSessionController(() => storage); controller.initialize(); let notifications = 0; const unsubscribe = controller.subscribe(() => notifications++);
    const start = values.get(SESSION_STORAGE_KEY)!;
    for (let i = 0; i < 3; i++) display(controller.getSnapshot().session!); assert.equal(values.get(SESSION_STORAGE_KEY), start); assert.equal(notifications, 0);
    assert.ok(controller.updateLicense(base.license_id, { product: "Edited synthetic product", seats_entitled: 0, seats_used: 0, annual_spend: 0, renewal_date: null, notes: "<script>fictional</script>" }).ok);
    assert.ok(controller.updateApplication(base.app_id, { app_name: "Edited linked application" }).ok);
    const edited = controller.getSnapshot().session!, editedJSON = values.get(SESSION_STORAGE_KEY)!; assert.equal(notifications, 2);
    assert.equal(display(edited)[0][3], "Edited synthetic product"); assert.match(display(edited)[0][1], /Edited linked application/); assert.equal(display(edited)[0][0], base.license_id);
    assert.equal(edited.input_revisions.licenses, 1); assert.equal(edited.input_revisions.applications, 1);
    const restored = createDemoSessionController(() => storage); restored.initialize(); assert.deepEqual(display(restored.getSnapshot().session!), display(edited)); assert.equal(values.get(SESSION_STORAGE_KEY), editedJSON);
    controller.resetDemoSession(); assert.equal(notifications, 3); assert.deepEqual(controller.getSnapshot().session!.current_deal, deal); unsubscribe();
    for (const count of [0, 1, 200]) {
      const varied = structuredClone(initial); varied.current_deal.license_positions = Array.from({ length: count }, (_, i) => ({ ...base, license_id: `test-license-${i}` }));
      assert.ok(DemoSessionSchema.safeParse(varied).success); assert.equal(display(varied).length, count);
    }
    console.log("PASS: shared controller updates, passive reads/storage unchanged, hydration/refresh/reset, dynamic valid 0/1/200-position inventories");

    const source = await readFile("components/license-optimizer/license-inventory.tsx", "utf8");
    assert.equal((source.match(/useDemoSession\(\)/g) ?? []).length, 1); assert.match(source, /if \(!ready\)/); assert.match(source, /if \(!session\)/); assert.match(source, /rows.length === 0/);
    for (const required of [/role="region"/, /tabIndex=\{0\}/, /aria-describedby=/, /<caption>/, /scope="col"/, /scope="row"/, /key=\{row.license.license_id\}/, /session.fixture.dataset_version/, /input_revisions.licenses/, /input_revisions.applications/]) assert.match(source, required);
    assert.match(source, /No AI license analysis has run/); assert.match(source, /not contract evidence or verified entitlements/);
    assert.doesNotMatch(source, /loadSyntheticDealFixture|fetch\(|sessionStorage|localStorage|useState|useEffect|updateLicense|updateApplication|recordDerivedResultMetadata|dangerouslySetInnerHTML|<button|<input|<select|<a\b/);
    const page = await readFile("app/[module]/page.tsx", "utf8"); assert.match(page, /module.href === "\/license-optimizer" \? <LicenseInventory/); assert.match(page, /AIStatusNotice state=\{\{ status: "not_enabled" \}\}/);
    const css = await readFile("app/globals.css", "utf8"); assert.match(css, /\.inventory-scroll \{ max-width: 100%; overflow-x: auto/); assert.match(css, /\.license-inventory-table th, \.license-inventory-table td \{ white-space: pre-wrap/);
    assert.equal(attempts, 0);
    console.log("PASS: shared-provider-only read-only view, loading/unavailable/empty semantics, honest AI/synthetic disclosures, table/focus/wrapping; zero network/provider attempts");
  } finally { globalThis.fetch = savedFetch; }
}

export async function checkLicenseInventoryBrowser({ page, evaluate, until, navigate, key, base }: Parameters<typeof import("./check-csv-preview.mts").checkCSVBrowser>[0]) {
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{const original=window.fetch.bind(window);window.__licenseAPICalls=[];window.fetch=(input,init)=>{if(String(input).includes('/api/'))window.__licenseAPICalls.push(String(input));return original(input,init)}})()` });
  await navigate("/license-optimizer"); await until("document.querySelectorAll('.license-inventory tbody tr').length===10");
  const original = await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`);
  const actual = () => evaluate("[...document.querySelectorAll('.license-inventory tbody tr')].map(row=>[...row.children].map(cell=>cell.textContent))");
  for (const width of [1440, 390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.deepEqual(await actual(), display()); assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"), false);
    assert.equal(await evaluate("document.querySelector('.license-inventory .inventory-scroll').scrollWidth>document.querySelector('.license-inventory .inventory-scroll').clientWidth"), true);
    assert.equal(await evaluate("document.querySelectorAll('.license-inventory thead th[scope=col]').length"), 9);
    assert.equal(await evaluate("document.querySelectorAll('.license-inventory tbody th[scope=row]').length"), 10);
    assert.match(await evaluate("document.querySelector('.license-source-summary').textContent"), /10 license positions.*Currency CAD.*1.0.0.*License source revision 0.*Application source revision 0/);
    assert.equal(await evaluate("document.querySelectorAll('.ai-notice').length"), 1); assert.equal(await evaluate("document.querySelector('.ai-notice-title').textContent"), "AI not enabled");
    assert.equal(await evaluate("document.querySelectorAll('.license-inventory button,.license-inventory input,.license-inventory select,.license-inventory a,.ai-notice-model').length"), 0);
    await evaluate("document.querySelector('.license-inventory .inventory-scroll').focus(); document.querySelector('.license-inventory .inventory-scroll').scrollLeft=0");
    assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none"); await key("ArrowRight", 39); await until("document.querySelector('.license-inventory .inventory-scroll').scrollLeft>0");
    assert.equal(await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`), original); assert.equal(await evaluate("window.__licenseAPICalls.length"), 0);
  }
  const values = new Map([[SESSION_STORAGE_KEY, original as string]]), controller = createDemoSessionController(() => ({ getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: (k) => { values.delete(k); } }));
  controller.initialize(); const first = controller.getSnapshot().session!.current_deal.license_positions[0];
  controller.updateLicense(first.license_id, { product: "Edited synthetic license", seats_entitled: 0, seats_used: 0, annual_spend: 0, renewal_date: null, notes: '<script>fictional</script> "license" ' + "L".repeat(400) });
  controller.updateApplication(first.app_id, { app_name: "Edited linked application " + "A".repeat(300) });
  const edited = values.get(SESSION_STORAGE_KEY)!, editedSession = controller.getSnapshot().session!;
  await evaluate(`sessionStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)},${JSON.stringify(edited)})`); await page("Page.reload"); await until("document.querySelector('.license-inventory tbody')?.textContent.includes('Edited synthetic license')");
  assert.deepEqual(await actual(), display(editedSession)); assert.equal(await evaluate("document.querySelector('.license-inventory tbody script')===null"), true);
  assert.ok(await evaluate("document.querySelector('.license-inventory tbody').textContent.includes('<script>fictional</script>')")); assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"), false);
  assert.match(await evaluate("document.querySelector('.license-source-summary').textContent"), /License source revision 1.*Application source revision 1/);
  await evaluate("document.querySelector('nav a[href=\"/\"]').click()"); await until("location.pathname==='/'"); await evaluate("document.querySelector('nav a[href=\"/license-optimizer\"]').click()"); await until("!!document.querySelector('.license-inventory tbody')");
  assert.deepEqual(await actual(), display(editedSession)); assert.equal(await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`), edited);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Reset demo session').click()"); await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm reset').click()");
  await until("!!document.querySelector('.license-inventory tbody') && !document.querySelector('.license-inventory tbody').textContent.includes('Edited synthetic license')"); assert.deepEqual(await actual(), display());
  const empty = createDemoSession(); empty.current_deal.license_positions = []; assert.ok(DemoSessionSchema.safeParse(empty).success);
  await evaluate(`sessionStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)},${JSON.stringify(JSON.stringify(empty))})`); await page("Page.reload"); await until("!!document.querySelector('.license-inventory .inventory-empty')");
  assert.equal(await evaluate("document.querySelectorAll('.license-inventory table').length"), 0); assert.match(await evaluate("document.querySelector('.license-source-summary').textContent"), /0 license positions/);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Reset demo session').click()"); await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm reset').click()"); await until("document.querySelectorAll('.license-inventory tbody tr').length===10");
  assert.equal(await evaluate("window.__licenseAPICalls.length"), 0);
  const response = await fetch(`${base}/api/ai/ala`, { method: "POST" }); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal((await fetch(`${base}/api/ai/ala`)).status, 405);
  for (const route of ["/", "/integration-health", "/data-mapper", "/application-rationalization", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"]) assert.equal((await fetch(`${base}${route}`)).status, 200);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7); assert.equal(await evaluate("document.querySelectorAll('.future-feature a,.future-feature button,.future-feature [tabindex]').length"), 0);
  console.log("PASS: actual populated license inventory Chromium 1440/390/320: all ten rows/all nine fields, current exact joins, zero/unknown, keyboard scroll/focus, no overflow, edited app/license hydration and navigation, escaped full notes, empty/reset, one AI-disabled notice, no API auto-calls, ten routes/seven inert icons; ALA 503/no-store and GET 405");
}
