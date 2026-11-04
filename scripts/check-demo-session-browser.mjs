// Targeted session UX check with installed Chromium and Node built-ins only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDemoSessionController } from "../lib/session/controller.ts";
import { parseSession, serializeSession, SESSION_STORAGE_KEY } from "../lib/session/session.ts";

const base = process.env.AIVRA_BASE_URL || "http://127.0.0.1:3000";
assert.ok(process.env.AIVRA_CHROMIUM_PATH, "Set AIVRA_CHROMIUM_PATH to installed Chromium");
const values = new Map();
const controller = createDemoSessionController(() => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }));
controller.initialize();
const original = controller.getSnapshot().session;
const appId = original.current_deal.applications[0].app_id;
controller.recordDerivedResultMetadata("ala", ["applications"], controller.captureInputVersions(["applications"]));
controller.updateApplication(appId, { app_name: "Fictional browser session edit" });
controller.updateLicense(original.current_deal.license_positions[0].license_id, { seats_used: 0 });
controller.updateTSA(original.current_deal.tsa_services[0].tsa_id, { owner: "Fictional browser handover team" });
const seed = parseSession(serializeSession(controller.getSnapshot().session));
// Valid future-shaped hydration verifies Home does not keep static fixture counts.
seed.current_deal.applications.push({ ...seed.current_deal.applications[0], app_id: "app-session-check-only" });
seed.current_deal.buyer_name = "Northstar — synthetic session check";
seed.input_revisions.applications++;
seed.session_revision++;
const seedJSON = serializeSession(seed);
const keyLiteral = JSON.stringify(SESSION_STORAGE_KEY);
const evidence = { checks: [], runtimeErrors: [], limitations: "Focused Chromium keyboard/DOM/AX checks; no full WCAG or physical-device test. Browser input is seeded through the real validated controller; no production test globals." };
const tsaEditChecks = process.argv.includes("--tsa-edit-browser");
const tsaChecks = tsaEditChecks || process.argv.includes("--tsa-browser");
const output = tsaEditChecks ? ".temp/u07-02" : tsaChecks ? ".temp/u07-01" : "artifacts/u00-05";
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "aivra-u05-chromium-"));
const browser = spawn(process.env.AIVRA_CHROMIUM_PATH, ["--headless", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true });
let socket;
let serial = 0;
let onLoad;
const pending = new Map();
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error("Chromium startup timed out")), 15000);
    browser.once("error", reject);
    browser.stderr.on("data", (chunk) => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Page.loadEventFired") onLoad?.();
    if (message.method === "Runtime.exceptionThrown") evidence.runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") evidence.runtimeErrors.push(message.params.args.map((arg) => arg.description ?? arg.value).join(" "));
    if (!message.id) return;
    const waiting = pending.get(message.id); if (!waiting) return;
    pending.delete(message.id); clearTimeout(waiting.timeout);
    if (message.error) waiting.reject(new Error(JSON.stringify(message.error))); else waiting.resolve(message.result);
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  async function evaluate(expression) {
    const result = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 150; attempt++) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
    throw new Error(`Condition timed out: ${expression}`);
  }
  async function load(method = "Page.reload", params = {}) {
    const loaded = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("Page load timeout")), 15000); onLoad = () => { clearTimeout(timeout); onLoad = undefined; resolve(); }; });
    await page(method, params); await loaded;
    await waitFor("document.querySelector('[data-session-ready=\"true\"]') !== null");
  }
  async function key(name, code) {
    for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code, ...(name === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  }
  const readSaved = () => evaluate(`JSON.parse(sessionStorage.getItem(${keyLiteral}))`);
  const putSeed = () => evaluate(`sessionStorage.setItem(${keyLiteral}, ${JSON.stringify(seedJSON)})`);
  async function confirmReset(cancel = false) {
    await evaluate("[...document.querySelectorAll('button')].find(el=>el.textContent==='Reset demo session').focus()");
    await key("Enter", 13);
    await waitFor("document.activeElement.textContent === 'Confirm reset'");
    if (cancel) { await key("Tab", 9); assert.equal(await evaluate("document.activeElement.textContent"), "Cancel"); }
    const { nodes } = await page("Accessibility.getFullAXTree");
    for (const name of ["Confirm reset", "Cancel"]) assert.equal(nodes.filter((node) => !node.ignored && node.role?.value === "button" && node.name?.value === name).length, 1);
    await key("Enter", 13);
    await waitFor("!document.querySelector('.session-confirmation') && document.activeElement.textContent==='Reset demo session'");
  }
  await page("Page.enable"); await page("Runtime.enable");
  if (tsaChecks) {
    if (tsaEditChecks) {
      const { checkTSAEditBrowser } = await import("./check-tsa-edit.mts");
      await checkTSAEditBrowser({ page, evaluate, waitFor, load, key, base, output, evidence });
    } else {
    const { checkTSAInventoryBrowser } = await import("./check-tsa-inventory.mts");
    await checkTSAInventoryBrowser({ page, evaluate, waitFor, load, key, base, output, evidence });
    }
    assert.deepEqual(evidence.runtimeErrors, []);
    await writeFile(`${output}/browser-checks.json`, JSON.stringify(evidence, null, 2) + "\n");
    console.log(`PASS: ${evidence.checks.length} ${tsaEditChecks ? "U07.02" : "U07.01"} browser groups; public TSA workflow, source identity, keyboard/viewport and session lifecycle.`);
  } else {
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await load("Page.navigate", { url: base });
  const initial = parseSession(JSON.stringify(await readSaved()));
  assert.deepEqual(initial.current_deal, original.current_deal);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('dl dd')].map(el=>el.textContent)"), ["15", "15", "10", "5"]);
  evidence.checks.push("Fresh tab: valid synthetic 15/15/10/5 source, CAD and empty registry");

  await putSeed(); await load();
  assert.deepEqual(await evaluate("[...document.querySelectorAll('dl dd')].map(el=>el.textContent)"), ["16", "15", "10", "5"]);
  assert.ok(await evaluate("document.querySelector('main').textContent.includes('Northstar — synthetic session check')"));
  const restored = parseSession(JSON.stringify(await readSaved()));
  assert.equal(restored.current_deal.applications[0].app_name, "Fictional browser session edit");
  assert.equal(restored.current_deal.license_positions[0].seats_used, 0);
  assert.equal(restored.current_deal.tsa_services[0].owner, "Fictional browser handover team");
  await evaluate("document.querySelector('nav a[href=\"/data-mapper\"]').click()");
  await waitFor("location.pathname === '/data-mapper' && document.querySelector('h1')?.textContent === 'Data Mapper Engine'");
  assert.equal((await readSaved()).created_at, seed.created_at);
  await evaluate("document.querySelector('nav a[href=\"/\"]').click()");
  await waitFor("location.pathname === '/' && document.querySelector('dl dd')?.textContent === '16'");
  await load();
  assert.deepEqual(parseSession(JSON.stringify(await readSaved())), seed);
  evidence.checks.push("Shared context restores controller-updated app/license/TSA records; live counts/names, SPA navigation and refresh preserve state");

  await confirmReset(true);
  assert.deepEqual(parseSession(JSON.stringify(await readSaved())), seed);
  await confirmReset();
  const reset = parseSession(JSON.stringify(await readSaved()));
  assert.deepEqual(reset.current_deal, original.current_deal);
  assert.deepEqual(reset.derived_results, {}); assert.equal(reset.session_revision, 0);
  await load(); assert.deepEqual(parseSession(JSON.stringify(await readSaved())), reset);
  evidence.checks.push("Keyboard confirmation/cancel names and focus; Cancel preserves edits, Confirm reset restores and persists empty analysis state");

  for (const raw of ["{bad JSON", JSON.stringify({ ...reset, session_schema_version: "unsupported" }), JSON.stringify({ ...reset, current_deal: { ...reset.current_deal, license_positions: [{ ...reset.current_deal.license_positions[0], app_id: "dangling" }] } })]) {
    await evaluate(`sessionStorage.setItem(${keyLiteral}, ${JSON.stringify(raw)})`); await load();
    assert.ok(await evaluate("document.querySelector('.session-status').textContent.includes('could not be restored')"));
    assert.deepEqual(parseSession(JSON.stringify(await readSaved())).current_deal, original.current_deal);
  }
  evidence.checks.push("Bad JSON, incompatible schema and dangling reference recover to fixture with non-sensitive notice");

  await putSeed();
  const quota = await page("Page.addScriptToEvaluateOnNewDocument", { source: `const originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key,value){ if(key===${keyLiteral}) throw new DOMException('Blocked test write','QuotaExceededError'); return originalSetItem.call(this,key,value); };` });
  await load();
  assert.ok(await evaluate("document.querySelector('.session-status').textContent.includes('may be lost on refresh')"));
  await confirmReset(); assert.equal(await readSaved(), null);
  await page("Page.removeScriptToEvaluateOnNewDocument", { identifier: quota.identifier });
  await load(); assert.deepEqual(parseSession(JSON.stringify(await readSaved())).current_deal, original.current_deal);
  evidence.checks.push("Quota failure shows memory-only notice; reset removes old persisted edit and cannot resurrect it on refresh");

  const denied = await page("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Blocked test access','SecurityError')}});" });
  await load();
  assert.ok(await evaluate("document.querySelector('.session-status').textContent.includes('may be lost on refresh')"));
  await confirmReset();
  await evaluate("document.querySelector('nav a[href=\"/data-mapper\"]').click()");
  await waitFor("location.pathname === '/data-mapper'");
  await page("Page.removeScriptToEvaluateOnNewDocument", { identifier: denied.identifier });
  await load("Page.navigate", { url: base });
  evidence.checks.push("Denied sessionStorage does not break session, reset or navigation");

  for (const width of [1440, 320, 390]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await evaluate("[...document.querySelectorAll('button')].find(el=>el.textContent==='Reset demo session').click()");
    await waitFor("document.querySelector('.session-confirmation') !== null");
    assert.equal(await evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth"), false);
    await evaluate("document.activeElement.blur();window.scrollTo(0,0)");
    const clip = await evaluate("(()=>{const r=document.querySelector('.session-controls').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()");
    const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
    await writeFile(`${output}/reset-${width}.png`, Buffer.from(data, "base64"));
    await evaluate("[...document.querySelectorAll('button')].find(el=>el.textContent==='Cancel').click()");
  }
  assert.equal(await evaluate("document.querySelectorAll('nav a').length"), 10);
  assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"), 7);
  assert.equal(await evaluate("document.querySelectorAll('.future-features a,.future-features button,.future-features [tabindex]').length"), 0);
  for (const route of ["/", "/integration-health", "/data-mapper", "/application-rationalization", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"]) assert.equal((await fetch(base + route)).status, 200);
  assert.deepEqual(evidence.runtimeErrors, []);
  evidence.checks.push("Ten public routes; seven inert placeholders; confirmation wraps at 320/390px; zero hydration/console/runtime errors");
  await writeFile(`${output}/browser-checks.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`PASS: ${evidence.checks.length} focused browser groups; navigation/refresh/reset/recovery/storage faults and accessibility/overflow checks.`);
  }
  await send("Browser.close");
} finally { socket?.close(); browser.kill(); }
