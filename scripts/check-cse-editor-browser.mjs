// Optional offline-only React/browser harness. No production route or dependency.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import ts from "typescript";

if (process.argv.includes("--render")) {
  registerHooks({
    resolve(spec, context, next) {
      try { return next(spec, context); } catch (error) {
        if (spec.startsWith(".")) for (const ext of [".ts", ".tsx"]) { try { return next(spec + ext, context); } catch { /* next candidate */ } }
        throw error;
      }
    },
    load(url, context, next) {
      if (/\.tsx?$/.test(url)) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
      return next(url, context);
    },
  });
  const { createElement: h } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const { CSEEditor, CSEEmptyState, EstimateSummary } = await import("../components/cost-synergy/estimate-workspace.ts");
  let raw = ""; for await (const chunk of process.stdin) raw += chunk;
  const props = JSON.parse(raw); globalThis.fetch = () => { throw Error("Offline render forbids network"); };
  process.stdout.write(renderToStaticMarkup(h(props.mode === "editor" ? CSEEditor : props.mode === "empty" ? CSEEmptyState : EstimateSummary, { ...props, title: "Offline illustrative estimate" })));
  process.exit(0);
}

assert.ok(process.env.AIVRA_CHROMIUM_PATH, "Set AIVRA_CHROMIUM_PATH to installed Chromium");
const fixture = JSON.parse(await readFile(".temp/u03-02/fixture.json", "utf8"));
const exportChecks = process.env.AIVRA_CSE_EXPORT_BROWSER === "1";
const output = exportChecks ? ".temp/u03-03" : ".temp/u03-02"; await mkdir(output, { recursive: true });
const downloadDirectory = exportChecks ? await mkdtemp(path.resolve(output, "downloads-")) : null;
// Small CommonJS module bundler for installed React/Zod and local TS sources only.
// Served by this process on loopback; never added to Next's app/public directories.
const root = process.cwd(), modules = [], ids = new Map();
function bundleModule(file, source) {
  if (ids.has(file)) return ids.get(file);
  const id = modules.length; ids.set(file, id); modules.push("");
  let code = source ?? readFileSync(file, "utf8");
  if (file.endsWith(".json")) code = `module.exports=${code};`;
  else code = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  code = code.replace(/require\(["']([^"']+)["']\)/g, (_, spec) => {
    const require = createRequire(file); let resolved;
    if (spec.startsWith(".")) { const candidate = path.resolve(path.dirname(file), spec); resolved = [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, `${candidate}.json`].find((p) => existsSync(p) && path.extname(p)); }
    resolved ??= require.resolve(spec);
    assert.ok(!resolved.startsWith("node:") && path.isAbsolute(resolved), `No built-in in browser bundle: ${spec}`);
    return `__r(${bundleModule(resolved)})`;
  });
  modules[id] = `function(module,exports,__r){${code}\n}`; return id;
}
const entry = bundleModule(path.join(root, ".temp/u03-02/offline-entry.ts"), `
import {createElement as h,useState} from 'react'; import {createRoot} from 'react-dom/client';
import {DemoSessionProvider,useDemoSession} from '../../components/demo-session-provider.tsx';
import {CostSynergyEstimateWorkspace} from '../../components/cost-synergy/estimate-workspace.ts';
import {SESSION_STORAGE_KEY} from '../../lib/session/session.ts';
const fixture=${JSON.stringify(fixture)};
sessionStorage.setItem(SESSION_STORAGE_KEY,JSON.stringify(fixture.session));
function Harness(){const state=useDemoSession(); const [current,setCurrent]=useState(true); const [context,setContext]=useState(fixture.context);
window.offlineTest={state,setCurrent,setContext,context};
return h(CostSynergyEstimateWorkspace,{context,current});}
createRoot(document.getElementById('root')).render(h(DemoSessionProvider,null,h(Harness)));
`);
const bundle = `(()=>{const process={env:{NODE_ENV:'production'}};const m=[${modules.join(",")}],c={};function __r(i){if(c[i])return c[i].exports;const x=c[i]={exports:{}};m[i](x,x.exports,__r);return x.exports;}__r(${entry});})();`;
let css = await readFile("app/globals.css", "utf8"); css = css.replace(/@import[^;]+;/g, "").replace(/@theme inline\s*\{[^}]+\}/g, "");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fabricated offline CSE test only</title><style>${css}body{padding:24px}#root{max-width:1180px;margin:auto}.button{max-width:100%}</style></head><body><p>Fabricated offline test only — not real AI analysis</p><main id="root"></main><script src="/bundle.js"></script></body></html>`;
const server = createServer((req, res) => { if (req.url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle); } else if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end(html); } else { res.statusCode = 404; res.end(); } });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const offlineURL = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(path.join(tmpdir(), "aivra-cse-browser-"));
const browser = spawn(process.env.AIVRA_CHROMIUM_PATH, ["--headless", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true });
const evidence = { checks: [], runtimeErrors: [], externalRequests: [], screenshots: [], limitation: "Installed Chromium headless DOM/AX/keyboard/viewport checks, no physical-device or full screen-reader audit. Populated path is fabricated and isolated from the public app." };
const downloads = [], completedDownloads = new Set();
let socket, serial = 0; const pending = new Map();
try {
  const endpoint = await new Promise((resolve, reject) => { let stderr = ""; const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 15000); browser.once("error", reject); browser.stderr.on("data", (chunk) => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Browser.downloadWillBegin") downloads.push(message.params);
    if (message.method === "Browser.downloadProgress" && message.params.state === "completed") completedDownloads.add(message.params.guid);
    if (message.method === "Runtime.exceptionThrown") evidence.runtimeErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") evidence.runtimeErrors.push(message.params.args.map((a) => a.description ?? a.value).join(" "));
    if (message.method === "Network.requestWillBeSent" && /^https?:/.test(message.params.request.url) && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(message.params.request.url)) evidence.externalRequests.push(message.params.request.url);
    if (!message.id) return; const wait = pending.get(message.id); if (!wait) return; pending.delete(message.id); clearTimeout(wait.timer); if (message.error) wait.reject(Error(JSON.stringify(message.error))); else wait.resolve(message.result);
  });
  function send(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" }), { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  async function evaluate(expression) { const r = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
  async function waitFor(expression) { for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw Error(`Condition timeout: ${expression}`); }
  async function key(name, code, modifiers = 0) { for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code, modifiers, ...(name === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }); }
  async function enter(selector, text) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await key("a", 65, 2); await key("Backspace", 8); if (text) await page("Input.insertText", { text }); }
  async function clickButton(text) { await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).focus()`); await key("Enter", 13); }
  async function screenshot(name, width) { await page("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"); assert.equal(await evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth"), false, name); const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); const filename = `${name}-${width}.png`; await writeFile(`${output}/${filename}`, Buffer.from(data, "base64")); evidence.screenshots.push(filename); }
  await page("Page.enable"); await page("Runtime.enable"); await page("Network.enable");
  if (exportChecks) await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });
  const exportCount = () => evaluate("[...document.querySelectorAll('button')].filter(b=>b.textContent.startsWith('Download estimate')).length");
  async function downloaded(index) { for (let n = 0; n < 200; n++) { if (downloads[index] && completedDownloads.has(downloads[index].guid)) return readFile(path.join(downloadDirectory, downloads[index].suggestedFilename), "utf8"); await new Promise((r) => setTimeout(r, 50)); } throw Error("Download completion timeout"); }
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: offlineURL }); await waitFor("document.querySelectorAll('fieldset').length===30");
  assert.equal(await evaluate("document.querySelectorAll('input:checked').length"), 0);
  assert.ok(await evaluate("[...document.querySelectorAll('input[type=text],textarea')].every(i=>i.value==='')"));
  await evaluate("document.querySelector('.cse-action-details > summary').focus()"); await key("Enter", 13);
  await waitFor("document.querySelector('.cse-action-details').open");
  const firstInput = "fieldset:first-of-type input[type=text]:first-of-type";
  await enter(firstInput, "1e3"); await clickButton("Calculate estimate"); await waitFor("document.querySelector('[role=alert]')!==null");
  assert.ok(await evaluate("document.querySelector('input[aria-invalid=true]')!==null")); assert.equal(await evaluate("document.querySelector('.cse-summary')!==null"), false);
  await enter(firstInput, "100"); await waitFor("[...document.querySelectorAll('textarea')].some(x=>x.getAttribute('aria-invalid')==='true')");
  const amountSelectors = await evaluate("[...document.querySelector('fieldset').querySelectorAll('input[type=text]')].map(x=>'[id='+JSON.stringify(x.id)+']')");
  const noteSelectors = await evaluate("[...document.querySelector('fieldset').querySelectorAll('textarea')].map(x=>'[id='+JSON.stringify(x.id)+']')");
  for (let i = 0; i < 3; i++) { await enter(amountSelectors[i], ["100", "20", "30"][i]); await enter(noteSelectors[i], "Fabricated browser assumption only."); }
  await enter(".cse-controls input", "1");
  await evaluate("document.querySelector('input[type=checkbox]').focus()"); await key(" ", 32);
  await waitFor("document.querySelector('input[type=checkbox]').checked");
  const { nodes } = await page("Accessibility.getFullAXTree");
  for (const name of ["Annual recurring savings (CAD)", "Calculation horizon (whole years, 1–30)", "Calculate estimate"]) assert.ok(nodes.some((n) => !n.ignored && n.name?.value === name), name);
  await clickButton("Calculate estimate"); await waitFor("document.querySelector('.cse-summary')?.textContent.includes('CAD 50.00')");
  if (exportChecks) {
    assert.equal(await exportCount(), 2); await clickButton("Download estimate JSON");
    const saved = JSON.parse(await downloaded(0)); assert.equal(saved.contract_version, "cse/estimate-export/v1"); assert.equal(saved.estimate.totals.illustrative_net_benefit_minor, 5000); assert.equal(saved.estimate.assumptions.lines[0].annual_run_rate.amount_minor, 10000);
    assert.ok(await evaluate("document.body.textContent.includes('Download initiated (JSON)')"));
  }
  await enter(amountSelectors[0], "200"); await waitFor("document.body.textContent.includes('recalculation required')"); assert.equal(await evaluate("document.querySelector('.cse-summary')!==null"), false);
  if (exportChecks) assert.equal(await exportCount(), 0);
  await clickButton("Recalculate estimate"); await waitFor("document.querySelectorAll('.cse-summary').length===2");
  assert.ok(await evaluate("document.querySelector('.cse-summary').textContent.includes('CAD 150.00')"));
  assert.ok(await evaluate("document.querySelectorAll('.cse-summary')[1].textContent.includes('CAD 50.00')"));
  if (exportChecks) {
    assert.equal(await exportCount(), 2, "Previous snapshot must not have its own downloads"); await clickButton("Download estimate CSV");
    const saved = await downloaded(1); assert.ok(saved.includes('"illustrative_net_benefit_minor"')); assert.ok(saved.includes('"15000"')); assert.ok(saved.includes("Fabricated browser assumption only.")); assert.equal(downloads[0].suggestedFilename, "aivra-cse-estimate-v1.json"); assert.equal(downloads[1].suggestedFilename, "aivra-cse-estimate-v1.csv");
    // Every financial edit revokes export, even after restoring the original raw input.
    for (const [selector, changed, restored] of [[amountSelectors[1], "21", "20"], [amountSelectors[2], "31", "30"], [noteSelectors[0], "Changed basis note", "Fabricated browser assumption only."], [".cse-controls input", "3", "1"]]) {
      await enter(selector, changed); assert.equal(await exportCount(), 0); await enter(selector, restored); assert.equal(await exportCount(), 0); await clickButton("Recalculate estimate"); assert.equal(await exportCount(), 2);
    }
    await evaluate("document.querySelector('input[type=checkbox]').focus()"); await key(" ", 32); assert.equal(await exportCount(), 0);
    await clickButton("Recalculate estimate"); assert.equal(await exportCount(), 0, "Not-computable result has no downloads");
    await evaluate("document.querySelector('input[type=checkbox]').focus()"); await key(" ", 32); await clickButton("Recalculate estimate");
    await enter(amountSelectors[0], "10000000000"); await enter(".cse-controls input", "2"); await clickButton("Recalculate estimate"); assert.equal(await exportCount(), 0, "Invalid overflow cannot export a previous success");
    await enter(amountSelectors[0], "200"); await enter(".cse-controls input", "1"); await clickButton("Recalculate estimate"); assert.equal(await exportCount(), 2);
    evidence.checks.push("Actual keyboard JSON/CSV downloads completed and exact saved bytes inspected; every amount/note/inclusion/horizon edit revokes export, restored input still requires Calculate, invalid/not-computable/previous snapshots cannot download.");
  }
  evidence.checks.push("Real React controlled fields and keyboard: exclusions/blank defaults, unsafe decimal and missing-note errors, labels/AX, explicit include/Calculate, edits hide old totals, Recalculate compares same-source visitor assumptions.");
  for (const width of [1440, 390, 320]) await screenshot("populated-offline", width);
  const storage = await evaluate("JSON.stringify({...sessionStorage})");
  const summariesBeforeSourceChange = await evaluate("document.querySelectorAll('.cse-summary').length");
  assert.equal(await evaluate("Object.keys(sessionStorage).length"), 1);
  await evaluate("window.offlineTest.state.updateTSA(window.offlineTest.state.session.current_deal.tsa_services[0].tsa_id,{title:'Offline TSA edit'})");
  assert.equal(await evaluate("document.querySelectorAll('.cse-summary').length"), summariesBeforeSourceChange);
  await evaluate("window.offlineTest.state.updateLicense(window.offlineTest.state.session.current_deal.license_positions[0].license_id,{notes:'Offline license edit'})");
  await waitFor("document.querySelectorAll('fieldset').length===0"); assert.equal(await evaluate("document.querySelector('.cse-summary')!==null"), false);
  if (exportChecks) assert.equal(await exportCount(), 0);
  await page("Page.reload"); await waitFor("document.querySelectorAll('fieldset').length===30"); assert.equal(await evaluate("document.querySelectorAll('input:checked').length"), 0);
  await evaluate("document.querySelector('.cse-action-details > summary').focus()"); await key("Enter", 13);
  await enter(firstInput, "123"); await evaluate("window.offlineTest.setCurrent(false)"); await waitFor("document.querySelectorAll('fieldset').length===0");
  await evaluate("window.offlineTest.setCurrent(true)"); await waitFor("document.querySelectorAll('fieldset').length===30"); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstInput)}).value`), "");
  await clickButton("Reset financial inputs"); assert.ok(await evaluate("[...document.querySelectorAll('input[type=text],textarea')].every(i=>i.value==='')"));
  if (exportChecks) { assert.equal(await exportCount(), 0); assert.equal(downloads.length, 2); }
  // No estimate/input/review write into the source session before the intentional source edit.
  assert.ok(!storage.includes("Fabricated browser assumption"));
  evidence.checks.push("Actual shared provider: TSA change retains estimates; license change synchronously removes stale inputs/totals; refresh/currentness reset clears drafts, no financial persistence.");
  const publicBase = process.env.AIVRA_BASE_URL;
  assert.ok(publicBase, "Set AIVRA_BASE_URL to the built, AI-disabled local application for public-state checks");
  await page("Page.navigate", { url: `${publicBase}/cost-synergy` }); await waitFor("document.querySelector('h1')?.textContent==='Cost Synergy Estimator' && document.querySelector('.cse-empty')!==null");
  assert.ok(await evaluate("document.querySelector('.cse-empty').textContent.includes('No validated ALA analysis available')"));
  assert.equal(await evaluate("document.querySelectorAll('.cse-workspace input,.cse-workspace textarea,.cse-summary').length"), 0);
  if (exportChecks) assert.equal(await exportCount(), 0);
  assert.equal(await evaluate("document.querySelectorAll('.future-features a,.future-features button').length"), 0);
  await evaluate("document.querySelector('.cse-empty a').focus()"); assert.ok(await evaluate("document.activeElement.matches('.cse-empty a')"));
  for (const width of [1440, 390, 320]) await screenshot("public-empty", width);
  await evaluate("document.querySelector('.cse-empty a').focus()"); await key("Enter", 13); await waitFor("location.pathname==='/application-rationalization'");
  evidence.checks.push("Built public /cost-synergy at 1440/390/320: honest no-analysis state, no editable/fabricated result surface, keyboard navigation, no page overflow; seven future icons remain inert.");
  assert.deepEqual(evidence.runtimeErrors, []); assert.deepEqual(evidence.externalRequests, []);
  await writeFile(`${output}/browser-checks.json`, JSON.stringify({ ...evidence, ...(exportChecks ? { download_directory: downloadDirectory } : {}) }, null, 2) + "\n");
  console.log(`PASS: ${evidence.checks.length} ${exportChecks ? "U03.03 export" : "U03.02"} browser groups, six screenshots, zero runtime errors/external page requests. Evidence: ${output}/browser-checks.json`);
  await send("Browser.close");
} finally { socket?.close(); browser.kill(); server.close(); }
