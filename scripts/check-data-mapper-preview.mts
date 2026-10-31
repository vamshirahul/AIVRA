import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { INVENTORY_COLUMNS, inventoryForSide, inventoryValue } from "../lib/data-mapper/inventory-view.ts";
import { createDemoSessionController } from "../lib/session/controller.ts";
import { SESSION_STORAGE_KEY } from "../lib/session/session.ts";

const values = new Map<string, string>();
const controller = createDemoSessionController(() => ({ getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => { values.set(k, v); }, removeItem: (k) => { values.delete(k); } }));
controller.initialize();
const initial = controller.getSnapshot().session!;
const deal = initial.current_deal;
const rows = (side: "buyer" | "target") => inventoryForSide(controller.getSnapshot().session!.current_deal.applications, side);
const display = (side: "buyer" | "target") => rows(side).map((app) => INVENTORY_COLUMNS.map(([field]) => inventoryValue(app, field, deal.currency)));

if (!process.argv.includes("--browser")) {
  const fetchBefore = globalThis.fetch; let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw new Error("Inventory checks forbid network"); };
  try {
    for (const side of ["buyer", "target"] as const) {
      assert.equal(rows(side).length, 15);
      assert.deepEqual(rows(side).map((r) => r.app_id), deal.applications.filter((r) => r.company_side === side).map((r) => r.app_id));
      assert.equal(new Set(rows(side).map((r) => r.app_id)).size, rows(side).length);
    }
    assert.deepEqual(INVENTORY_COLUMNS.map(([field]) => field), ["app_id", "app_name", "function", "vendor", "annual_cost", "criticality", "deployment", "lifecycle", "owner", "notes"]);
    const sample = { ...rows("buyer")[0], annual_cost: 0, vendor: null, criticality: "critical" as const, deployment: "on_premise" as const, lifecycle: "retiring" as const, owner: null, notes: null };
    assert.match(inventoryValue(sample, "annual_cost", "CAD"), /CAD\s+0\.00/);
    assert.equal(inventoryValue({ ...sample, annual_cost: null }, "annual_cost", "CAD"), "Not provided");
    for (const field of ["vendor", "owner", "notes"] as const) assert.equal(inventoryValue(sample, field, "CAD"), "Not provided");
    assert.equal(inventoryValue(sample, "deployment", "CAD"), "On-premise");
    assert.equal(inventoryValue(sample, "criticality", "CAD"), "Critical");
    assert.equal(inventoryValue(sample, "lifecycle", "CAD"), "Retiring");
    assert.equal(inventoryValue(sample, "function", "CAD"), sample.function);
    assert.match(inventoryValue({ ...sample, annual_cost: 1234.5 }, "annual_cost", "USD"), /USD\s+1,234\.50/);
    assert.equal(inventoryForSide([], "target").length, 0);
    assert.equal(inventoryForSide([sample], "buyer").length, 1);
    console.log("PASS: both source-ordered inventories/opaque IDs, ten accurate columns, enums, empty/dynamic counts, null vs zero and session currency");

    const stored = values.get(SESSION_STORAGE_KEY);
    const snapshot = JSON.stringify(controller.getSnapshot());
    display("buyer"); display("target"); display("buyer");
    assert.equal(values.get(SESSION_STORAGE_KEY), stored); assert.equal(JSON.stringify(controller.getSnapshot()), snapshot);
    let updates = 0;
    const unsubscribe = controller.subscribe(() => { updates++; });
    const id = rows("buyer")[0].app_id;
    assert.equal(controller.updateApplication(id, { app_name: "Edited synthetic app", annual_cost: 0, notes: "<script>fictional</script>" }).ok, true);
    assert.equal(display("buyer")[0][1], "Edited synthetic app"); assert.match(display("buyer")[0][4], /0\.00/);
    assert.equal(rows("buyer")[0].app_id, id); assert.equal(updates, 1);
    const restored = createDemoSessionController(() => ({ getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: (k) => { values.delete(k); } }));
    restored.initialize(); assert.equal(restored.getSnapshot().session!.current_deal.applications.find((r) => r.app_id === id)!.app_name, "Edited synthetic app");
    controller.resetDemoSession(); assert.equal(updates, 2); assert.deepEqual(controller.getSnapshot().session!.current_deal, deal); unsubscribe();
    console.log("PASS: preview switching leaves state/storage byte-identical; existing controller update, refresh restore and reset feed fresh rows without ID changes");

    const source = await readFile("components/data-mapper/sample-inventory-preview.tsx", "utf8");
    assert.equal((source.match(/useDemoSession\(\)/g) ?? []).length, 1);
    assert.match(source, /!ready \|\| !session/); assert.match(source, /No \{title\} applications/);
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) assert.ok(source.includes(key));
    for (const role of ["tablist", "tab", "tabpanel", "region"]) assert.ok(source.includes(`role="${role}"`));
    assert.match(source, /aria-controls=/); assert.match(source, /aria-labelledby=/); assert.match(source, /scope="row"/);
    assert.doesNotMatch(source, /loadSyntheticDealFixture|fetch\(|sessionStorage|updateApplication|resetDemoSession|dangerouslySetInnerHTML|type="file"/);
    assert.equal(attempts, 0);
    console.log("PASS: shared-provider-only view, neutral not-ready/empty branches, tab/row semantics, no mutation/import/AI actions; zero network attempts");
  } finally { globalThis.fetch = fetchBefore; }
} else {
  // Existing Chromium via built-in CDP. No Playwright or other workspace dependency.
  const chrome = process.env.AIVRA_CHROMIUM_PATH;
  assert.ok(chrome, "Set AIVRA_CHROMIUM_PATH to an existing Chromium executable");
  const base = process.env.AIVRA_BASE_URL ?? "http://127.0.0.1:3000";
  assert.equal(new URL(base).hostname, "127.0.0.1");
  const profile = await mkdtemp(path.join(tmpdir(), "aivra-u0101-browser-"));
  const browser = spawn(chrome, ["--headless", "--no-first-run", "--disable-background-networking", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true });
  let socket: WebSocket | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let stderr = ""; const timeout = setTimeout(() => reject(new Error("Chromium startup timeout")), 15000);
      browser.once("error", reject);
      browser.stderr!.on("data", (chunk) => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket!.addEventListener("open", resolve, { once: true }); socket!.addEventListener("error", reject, { once: true }); });
    let serial = 0; const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const errors: string[] = []; let external = 0;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
      if (message.method === "Fetch.requestPaused") {
        const url = message.params.request.url;
        if (new URL(url).origin !== base) { external++; void send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" }, message.sessionId); }
        else void send("Fetch.continueRequest", { requestId: message.params.requestId }, message.sessionId);
      }
      const item = pending.get(message.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id); if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
    });
    function send(method: string, params: object = {}, sessionId?: string): Promise<any> {
      return new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(method)); }, 15000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
    }
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method: string, params: object = {}) => send(method, params, sessionId);
    async function evaluate(expression: string): Promise<any> {
      const response = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails)); return response.result.value;
    }
    async function until(expression: string) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error(`Not ready: ${expression}`); }
    async function navigate(route: string) { await page("Page.navigate", { url: `${base}${route}` }); await until(`location.pathname === ${JSON.stringify(route)} && document.readyState === 'complete' && !!document.querySelector('.session-controls')`); }
    async function key(name: string, code: number) { for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code }); }
    await page("Page.enable"); await page("Runtime.enable"); await page("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await navigate("/data-mapper"); await until("!!document.querySelector('[role=tab]')");
    const original = await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`);
    for (const width of [1440, 390, 320]) {
      await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const side of ["buyer", "target"] as const) {
        await evaluate(`document.querySelectorAll('[role=tab]')[${side === "buyer" ? 0 : 1}].click()`);
        await until(`document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('${side === "buyer" ? "Buyer" : "Target"}')`);
        const cells = await evaluate("[...document.querySelectorAll('tbody tr')].map(row => [...row.children].map(cell => cell.textContent))");
        assert.deepEqual(cells, inventoryForSide(deal.applications, side).map((app) => INVENTORY_COLUMNS.map(([field]) => inventoryValue(app, field, deal.currency))));
        assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
        assert.equal(await evaluate("document.querySelector('.inventory-scroll').scrollWidth > document.querySelector('.inventory-scroll').clientWidth"), true);
        assert.equal(await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`), original);
      }
      await evaluate("document.querySelector('[role=tab][aria-selected=true]').focus()");
      for (const [name, code, expected] of [["Home", 36, "Buyer"], ["ArrowRight", 39, "Target"], ["ArrowLeft", 37, "Buyer"], ["End", 35, "Target"], ["ArrowRight", 39, "Buyer"]] as const) {
        await key(name, code); await until(`document.activeElement.getAttribute('role') === 'tab' && document.activeElement.getAttribute('aria-selected') === 'true' && document.activeElement.textContent.startsWith('${expected}')`);
        assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none");
      }
      assert.equal(await evaluate("document.querySelectorAll('[role=tab][tabindex=\"0\"]').length"), 1);
      assert.equal(await evaluate("document.querySelectorAll('nav a').length"), 10);
      assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7);
      assert.equal(await evaluate("document.querySelectorAll('.future-feature a,.future-feature button,.future-feature [tabindex]').length"), 0);
    }
    // Seed a valid controller-produced edit and metadata, then verify shared hydration/persistence/reset.
    controller.updateApplication(deal.applications[0].app_id, { app_name: "Edited synthetic app", notes: "<script>fictional</script>" });
    controller.recordDerivedResultMetadata("ala", ["applications"], controller.captureInputVersions(["applications"]));
    const edited = values.get(SESSION_STORAGE_KEY)!;
    await evaluate(`sessionStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)}, ${JSON.stringify(edited)})`);
    await page("Page.reload"); await until("document.querySelector('tbody')?.textContent.includes('Edited synthetic app')");
    assert.equal(await evaluate("document.querySelector('tbody script') !== null"), false);
    assert.ok(await evaluate("document.querySelector('tbody').textContent.includes('<script>fictional</script>')"));
    await evaluate("document.querySelectorAll('[role=tab]')[1].click()"); await until("document.querySelector('[aria-selected=true]').textContent.startsWith('Target')");
    assert.equal(await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`), edited);
    await navigate("/"); await navigate("/data-mapper"); await until("document.querySelector('tbody')?.textContent.includes('Edited synthetic app')");
    assert.equal(await evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})`), edited);
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Reset demo session').click()");
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Confirm reset').click()");
    await until("!!document.querySelector('tbody') && !document.querySelector('tbody').textContent.includes('Edited synthetic app')");
    assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})).current_deal`), deal);
    const routes = ["/", "/integration-health", "/data-mapper", "/application-rationalization", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"];
    for (const route of routes) { const response = await fetch(`${base}${route}`); assert.equal(response.status, 200); if (route !== "/" && route !== "/data-mapper") assert.match(await response.text(), /Not yet implemented/); }
    assert.deepEqual(errors, []); assert.equal(external, 0);
    console.log("PASS: actual Chromium at 1440/390/320px; both inventories/all cells, tab keyboard/focus/wrap, scroll containment, unchanged storage/revisions/metadata, edited reload/navigation, escaped notes, global reset, ten routes/inert gallery; zero external requests or runtime errors");
  } finally { socket?.close(); browser.kill(); }
}
