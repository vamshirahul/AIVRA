// Adapted from the existing CSE loopback Chromium harness; never a shipped route.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import ts from "typescript";

if (process.argv.includes("--render")) {
  registerHooks({ resolve(spec, context, next) { try { return next(spec, context); } catch (error) { if (spec.startsWith(".")) for (const ext of [".ts", ".tsx"]) { try { return next(spec + ext, context); } catch {} } throw error; } }, load(url, context, next) { if (/\.tsx?$/.test(url)) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText }; return next(url, context); } });
  const { createElement: h } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server"), { ScenarioEditor, ScenarioEmptyState } = await import("../components/scenario-modeling/scenario-workspace.ts");
  let raw = ""; for await (const chunk of process.stdin) raw += chunk; const props = JSON.parse(raw); globalThis.fetch = () => { throw Error("Offline SSR forbids network"); }; process.stdout.write(renderToStaticMarkup(h(props.source ? ScenarioEditor : ScenarioEmptyState, props))); process.exit(0);
}
assert.ok(process.env.AIVRA_CHROMIUM_PATH, "Set installed AIVRA_CHROMIUM_PATH");
const fixture = JSON.parse(await readFile(".temp/u11-01/fixture.json", "utf8")), output = ".temp/u11-01"; await mkdir(output, { recursive: true });
const modules = [], ids = new Map();
function bundleModule(file, source) {
  if (ids.has(file)) return ids.get(file); const id = modules.length; ids.set(file, id); modules.push(""); let code = source ?? readFileSync(file, "utf8");
  code = file.endsWith(".json") ? `module.exports=${code};` : ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  code = code.replace(/require\(["']([^"']+)["']\)/g, (_, spec) => { let resolved; if (spec.startsWith(".")) { const p = path.resolve(path.dirname(file), spec); resolved = [p, `${p}.ts`, `${p}.tsx`, `${p}.js`, `${p}.json`].find((p) => existsSync(p) && path.extname(p)); } resolved ??= createRequire(file).resolve(spec); assert.ok(path.isAbsolute(resolved), `No browser built-in: ${spec}`); return `__r(${bundleModule(resolved)})`; });
  modules[id] = `function(module,exports,__r){${code}\n}`; return id;
}
const entry = bundleModule(path.resolve(output, "offline-entry.ts"), `
import {createElement as h,useState} from 'react';import {createRoot} from 'react-dom/client';
import {DemoSessionProvider,useDemoSession} from '../../components/demo-session-provider.tsx';
import {ScenarioWorkspace} from '../../components/scenario-modeling/scenario-workspace.ts';import {SESSION_STORAGE_KEY} from '../../lib/session/session.ts';
const fixture=${JSON.stringify(fixture)};sessionStorage.setItem(SESSION_STORAGE_KEY,JSON.stringify(fixture.session));
function Harness(){const state=useDemoSession();const [source,setSource]=useState(fixture.source);const [current,setCurrent]=useState(true);window.offlineScenario={state,source,setSource,setCurrent};return h(ScenarioWorkspace,{source,current});}
createRoot(document.getElementById('root')).render(h(DemoSessionProvider,null,h(Harness)));`);
const bundle = `(()=>{const process={env:{NODE_ENV:'production'}},m=[${modules.join(",")}],c={};function __r(i){if(c[i])return c[i].exports;const x=c[i]={exports:{}};m[i](x,x.exports,__r);return x.exports}__r(${entry});})();`;
const css = (await readFile("app/globals.css", "utf8")).replace(/@import[^;]+;/g, "").replace(/@theme inline\s*\{[^}]+\}/g, "");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fabricated offline scenario test only</title><style>${css}body{padding:20px}#root{max-width:1180px;margin:auto}</style></head><body><p>Fabricated offline test only — no genuine AI analysis</p><main id="root"></main><script src="/bundle.js"></script></body></html>`;
const server = createServer((req, res) => { if (req.url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle); } else if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end(html); } else { res.statusCode = 404; res.end(); } }); await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`, profile = await mkdtemp(path.join(tmpdir(), "aivra-scenario-"));
const browser = spawn(process.env.AIVRA_CHROMIUM_PATH, ["--headless", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true });
const evidence = { checks: [], runtimeErrors: [], externalRequests: [], screenshots: [], limitation: "Fabricated populated loopback harness only; public page is unavailable. Keyboard/DOM/AX/headless viewport checks, not a physical-device or full screen-reader/WCAG audit." };
let socket, serial = 0; const pending = new Map();
try {
  const endpoint = await new Promise((resolve, reject) => { let stderr = ""; const timer = setTimeout(() => reject(Error("Browser startup timeout")), 15000); browser.once("error", reject); browser.stderr.on("data", (chunk) => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); if (message.method === "Runtime.exceptionThrown") evidence.runtimeErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") evidence.runtimeErrors.push(message.params.args.map((a) => a.description ?? a.value).join(" ")); if (message.method === "Network.requestWillBeSent" && /^https?:/.test(message.params.request.url) && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(message.params.request.url)) evidence.externalRequests.push(message.params.request.url); if (!message.id) return; const w = pending.get(message.id); if (!w) return; pending.delete(message.id); clearTimeout(w.timer); if (message.error) w.reject(Error(JSON.stringify(message.error))); else w.resolve(message.result); });
  function send(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" }), { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }); const page = (method, params) => send(method, params, sessionId);
  async function evaluate(expression) { const r = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
  async function waitFor(expression) { for (let n = 0; n < 200; n++) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 50)); } throw Error(`Timeout: ${expression}`); }
  async function key(name, code, modifiers = 0) { for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code, modifiers, ...(name === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }); }
  async function click(text) { await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent===${JSON.stringify(text)})`); await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).focus()`); await key("Enter", 13); }
  async function enter(selector, text) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await key("a", 65, 2); await key("Backspace", 8); if (text) await page("Input.insertText", { text }); }
  async function screenshot(name, width) { await page("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"); assert.equal(await evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth"), false); const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); const file = `${name}-${width}.png`; await writeFile(`${output}/${file}`, Buffer.from(data, "base64")); evidence.screenshots.push(file); }
  const alt = "document.querySelector('[aria-label=\"Single alternative scenario\"]')";
  await page("Page.enable"); await page("Runtime.enable"); await page("Network.enable"); await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url }); await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Clone baseline')"); assert.equal(await evaluate(`${alt}!==null`), false);
  const originalSource = await evaluate("JSON.stringify(window.offlineScenario.source)"), originalStorage = await evaluate("JSON.stringify({...sessionStorage})");
  await click("Clone baseline"); await waitFor(`${alt}!==null`); assert.equal(await evaluate("[...document.querySelectorAll('button')].filter(b=>b.textContent==='Clone baseline').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('.scenario-baseline input,.scenario-baseline select,.scenario-baseline textarea').length"), 0); const baseline = await evaluate("document.querySelector('.scenario-baseline').textContent");
  assert.ok(baseline.includes("Original AI: Needs Review")); assert.ok(baseline.includes("Reviewed baseline: Retire"));
  await evaluate("document.querySelector('.scenario-action summary').focus()"); await key("Enter", 13);
  const action = ".scenario-action form:first-of-type", finances = ".scenario-action form:nth-of-type(2)";
  await evaluate(`document.querySelector('${action} select').focus()`); await key("Home", 36); await key("ArrowDown", 40); await key("ArrowDown", 40); await key("Tab", 9);
  await enter(`${action} textarea`, "Fabricated scenario justification");
  await click("Save action hypothesis"); await waitFor("[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('Select a destination'))");
  await evaluate(`document.querySelectorAll('${action} select')[1].focus()`); await key("Home", 36); await key("ArrowDown", 40); await key("Tab", 9);
  await enter(`${action} textarea`, "Fabricated scenario justification"); await click("Save action hypothesis"); await waitFor("document.querySelector('.scenario-action summary').textContent.includes('edited hypothesis')");
  assert.ok(await evaluate("document.activeElement.matches('.scenario-action summary')"));
  await enter(`${finances} input[type=text]`, "-1"); await click("Save financial assumptions"); await waitFor("document.querySelector('.scenario-action input[aria-invalid=true]')!==null");
  await enter(`${finances} input[type=text]`, "0.00"); await enter(`${finances} textarea`, "Explicit invented zero basis"); await click("Save financial assumptions");
  await waitFor(`${alt}.textContent.includes('1 financial rows changed')`); assert.ok(await evaluate("document.activeElement.matches('.scenario-action summary')"));
  await evaluate(`document.querySelector('${finances} input[type=checkbox]').focus()`); await key(" ", 32); await click("Save financial assumptions"); assert.equal(await evaluate(`document.querySelector('${finances} input[type=checkbox]').checked`), false);
  const horizon = ".scenario-panel[aria-label='Single alternative scenario'] > form input[type=text]";
  await enter(horizon, "5"); await click("Save alternative horizon"); await waitFor(`document.querySelector(${JSON.stringify(horizon)}).value==='5'`);
  assert.equal(await evaluate("document.querySelector('.scenario-baseline').textContent"), baseline); assert.equal(await evaluate("JSON.stringify(window.offlineScenario.source)"), originalSource); assert.equal(await evaluate("JSON.stringify({...sessionStorage})"), originalStorage);
  const { nodes } = await page("Accessibility.getFullAXTree"); for (const name of ["Alternative disposition", "Scenario justification (required for a change)", "Save financial assumptions"]) assert.ok(nodes.some((n) => !n.ignored && n.name?.value === name), name);
  for (const width of [1440, 390, 320]) await screenshot("populated-offline", width);
  await click("Restore baseline action"); await waitFor("!document.querySelector('.scenario-action summary').textContent.includes('edited hypothesis')"); await click("Restore baseline financial inputs"); await waitFor(`${alt}.textContent.includes('0 financial rows changed')`);
  await click("Reset alternative to baseline"); assert.equal(await evaluate("document.querySelectorAll('[aria-label=\"Single alternative scenario\"]').length"), 1); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(horizon)}).value`), "3"); assert.equal(await evaluate("document.querySelector('.scenario-baseline').textContent"), baseline);
  evidence.checks.push("Keyboard Clone creates exactly one alternative; original AI/baseline visitor/scenario layers separated; missing destination and negative amount rejected, action/zero-money/horizon saves, restores/reset/focus and source/baseline/storage isolation verified; no metrics/export.");
  await evaluate("window.offlineScenario.state.updateTSA(window.offlineScenario.state.session.current_deal.tsa_services[0].tsa_id,{title:'Offline TSA only'})"); assert.ok(await evaluate(`${alt}!==null`));
  await evaluate("window.offlineScenario.setSource({...window.offlineScenario.source,financial_draft:{...window.offlineScenario.source.financial_draft,horizon:'5'}})"); await waitFor(`${alt}===null`); await click("Clone baseline"); await waitFor(`${alt}!==null`);
  await evaluate("window.offlineScenario.state.updateLicense(window.offlineScenario.state.session.current_deal.license_positions[0].license_id,{notes:'Offline license change'})"); await waitFor(`${alt}===null`); assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Clone baseline')"), false);
  await page("Page.reload"); await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Clone baseline')"); assert.equal(await evaluate(`${alt}!==null`), false);
  await click("Clone baseline"); await evaluate("window.offlineScenario.setCurrent(false)"); await waitFor(`${alt}===null`); await evaluate("window.offlineScenario.setCurrent(true)"); await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Clone baseline')");
  evidence.checks.push("TSA-only retains scenario; changed current CSE assumptions clear it; license change removes clone/editor, refresh/currentness revocation discard all transient edits.");
  assert.ok(process.env.AIVRA_BASE_URL, "Set local public AIVRA_BASE_URL"); await page("Page.navigate", { url: `${process.env.AIVRA_BASE_URL}/scenario-modeling` }); await waitFor("document.querySelector('h1')?.textContent==='Scenario / What-if Modeling' && document.querySelector('[aria-label=\"Scenario readiness\"]')!==null");
  assert.ok(await evaluate("document.querySelector('.scenario-workspace').textContent.includes('No validated reviewed ALA/CSE baseline available')")); assert.equal(await evaluate("document.querySelectorAll('.scenario-workspace button,.scenario-workspace input,.scenario-workspace select').length"), 0); assert.equal(await evaluate("document.querySelectorAll('.scenario-links a').length"), 2);
  for (const width of [1440, 390, 320]) await screenshot("public-empty", width);
  await evaluate("document.querySelector('.scenario-links a').focus()"); await key("Enter", 13); await waitFor("location.pathname==='/application-rationalization'");
  assert.deepEqual(evidence.runtimeErrors, []); assert.deepEqual(evidence.externalRequests, []); evidence.checks.push("Real public unavailable state has prerequisite links and no populated clone/edit/metric/export controls; 1440/390/320 no page overflow; zero runtime/console errors/external page requests.");
  await writeFile(`${output}/browser-checks.json`, JSON.stringify(evidence, null, 2) + "\n"); console.log(`PASS: ${evidence.checks.length} U11.01 browser groups, six screenshots; evidence ${output}/browser-checks.json`); await send("Browser.close");
} finally { socket?.close(); browser.kill(); server.close(); }
