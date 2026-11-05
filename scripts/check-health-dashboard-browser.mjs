// Isolated loopback harness only; never an app/public/Next build entrypoint.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import ts from "typescript";

assert.ok(process.env.AIVRA_CHROMIUM_PATH, "Set installed Chromium path");
const output = ".temp/u13-02", fixture = JSON.parse(await readFile(`${output}/fixtures.json`, "utf8"));
// Same small local React/TS bundler and CDP pattern as existing module harnesses.
const root = process.cwd(), modules = [], ids = new Map();
function bundleModule(file, source) {
  if (ids.has(file)) return ids.get(file); const id = modules.length; ids.set(file, id); modules.push("");
  let code = source ?? readFileSync(file, "utf8"); code = file.endsWith(".json") ? `module.exports=${code};` : ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  code = code.replace(/require\(["']([^"']+)["']\)/g, (_, spec) => {
    let resolved; if (spec.startsWith(".")) { const base = path.resolve(path.dirname(file), spec); resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`].find(p => existsSync(p) && path.extname(p)); }
    resolved ??= createRequire(file).resolve(spec); assert.ok(path.isAbsolute(resolved) && !resolved.replaceAll("\\", "/").includes("/lib/server/") && spec !== "server-only", `No server runtime in browser bundle: ${spec}`);
    return `__r(${bundleModule(resolved)})`;
  }); modules[id] = `function(module,exports,__r){${code}\n}`; return id;
}
const entry = bundleModule(path.join(root, `${output}/offline-entry.tsx`), `
import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
import {DemoSessionProvider,useDemoSession} from '../../components/demo-session-provider.tsx';
import {HealthDashboard} from '../../components/integration-health/dashboard.tsx';
import {SESSION_STORAGE_KEY} from '../../lib/session/session.ts';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const fixture=freeze(${JSON.stringify(fixture)});sessionStorage.setItem(SESSION_STORAGE_KEY,JSON.stringify(fixture.session));
let current=fixture.populated,revoked=false;const known=new WeakSet(Object.values(fixture).filter(v=>v?.contract_version)),listeners=new Set();
const api=window.offlineHealth={fetches:0};
const source={getSnapshot:()=>current,subscribe:n=>{listeners.add(n);return()=>listeners.delete(n);},isCurrent:v=>!revoked&&v===current&&known.has(v),matchesSession:s=>JSON.stringify(s)===JSON.stringify(fixture.session)};
api.mode=name=>{current=fixture[name];revoked=false;listeners.forEach(n=>n());};api.revoke=()=>{revoked=true;listeners.forEach(n=>n());};
api.invalid=()=>{current={...fixture.populated,private_context:'PRIVATE_DETAIL_MUST_NOT_RENDER'};known.add(current);listeners.forEach(n=>n());};
api.foreign=()=>{current=structuredClone(fixture.populated);listeners.forEach(n=>n());};
window.fetch=()=>{api.fetches++;throw Error('Offline dashboard must not fetch');};
function Harness(){api.session=useDemoSession();return h(HealthDashboard,{source});}
createRoot(document.getElementById('root')).render(h(DemoSessionProvider,null,h(Harness)));
`);
const bundle = `(()=>{const process={env:{NODE_ENV:'production'}},m=[${modules.join(",")}],cache={};function __r(i){if(cache[i])return cache[i].exports;const x=cache[i]={exports:{}};m[i](x,x.exports,__r);return x.exports;}__r(${entry});})();`;
let css = await readFile("app/globals.css", "utf8"); const font = css.match(/--font-sans:\s*([^;]+);/)[1]; css = css.replace(/@import[^;]+;/g, "").replace(/@theme inline\s*\{[^}]+\}/g, "") + `:root{--font-sans:${font}}*,::before,::after{box-sizing:border-box}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline dashboard test only</title><style>${css}body{padding:16px}#root{max-width:1080px;margin:auto}</style></head><body><p>Fabricated offline display only. These are isolated test results, not public transaction metrics.</p><main id="root"></main><script src="/bundle.js"></script></body></html>`;
const server = createServer((req, res) => { const url = new URL(req.url, "http://127.0.0.1"); if (url.pathname === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle); } else if (url.pathname === "/") { res.setHeader("content-type", "text/html"); res.end(html); } else { res.statusCode = 404; res.end(); } });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const offlineURL = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(path.join(tmpdir(), "aivra-health-dashboard-")), browser = spawn(process.env.AIVRA_CHROMIUM_PATH, ["--headless", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true });
const evidence = { checks: [], runtimeErrors: [], externalRequests: [], screenshots: [], limitations: "Isolated fabricated result displays only; public protected-result delivery remains unavailable. Keyboard/AX/DOM checks are not full WCAG/screen-reader or physical-device UAT." };
let socket, serial = 0; const pending = new Map();
try {
  const endpoint = await new Promise((resolve, reject) => { let stderr = ""; const timer = setTimeout(() => reject(Error("Chrome timeout")), 15000); browser.once("error", reject); browser.stderr.on("data", b => { stderr += b; const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", ({ data }) => { const m = JSON.parse(data); if (m.method === "Runtime.exceptionThrown") evidence.runtimeErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") evidence.runtimeErrors.push(m.params.args.map(a => a.description ?? a.value).join(" ")); if (m.method === "Network.requestWillBeSent" && /^https?:/.test(m.params.request.url) && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(m.params.request.url)) evidence.externalRequests.push(m.params.request.url); if (!m.id) return; const wait = pending.get(m.id); if (!wait) return; pending.delete(m.id); clearTimeout(wait.timer); m.error ? wait.reject(Error(JSON.stringify(m.error))) : wait.resolve(m.result); });
  function send(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(method)); }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" }), { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }); const page = (m, p) => send(m, p, sessionId);
  async function evaluate(expression) { const r = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
  async function waitFor(expression) { for (let i = 0; i < 180; i++) { if (await evaluate(`!!(${expression})`)) return; await new Promise(r => setTimeout(r, 50)); } throw Error(`Timeout: ${expression}`); }
  async function key(name, code, modifiers = 0) { for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code, modifiers, ...(name === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }); }

  const metric = title => evaluate(`document.querySelector('[data-metric=${JSON.stringify(title)}]').textContent`);
  async function mode(name) { await evaluate(`window.offlineHealth.mode(${JSON.stringify(name)})`); await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); }
  async function shot(name) { const {data}=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`${output}/${name}.png`,Buffer.from(data,'base64'));evidence.screenshots.push(`${name}.png`); }
  await page('Page.enable');await page('Runtime.enable');await page('Network.enable');
  await page('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await page('Page.navigate',{url:offlineURL});await waitFor("document.querySelector('[data-metric=\"Original AI actions\"]')?.textContent!=='Not available' && !!window.offlineHealth?.session?.ready");
  const stored=await evaluate('sessionStorage.getItem("aivra:r0:demo-session:v1")');
  assert.equal(await metric('Total applications'),String(fixture.session.current_deal.applications.length));
  assert.equal(await metric('Recorded visitor overrides'),String(fixture.populated.ala.value.visitor_overrides));
  assert.equal(await metric('Annual recurring savings'),'CAD 0.00');assert.equal(await metric('Illustrative net benefit'),'\u2212CAD 123.45');
  assert.equal(await metric('All suggestions reviewed'),'Not available');assert.match(await evaluate('document.body.textContent'),/Overrides are not approvals/);
  assert.equal(await evaluate("document.querySelectorAll('[data-tsa-count]').length"),5);assert.equal(await evaluate("document.querySelectorAll('.tsa-health-summary').length"),1);
  assert.equal(await evaluate('document.querySelectorAll(".health-dashboard a").length'),7);
  for(const width of [1440,390,320]){await page('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);const {nodes}=await page('Accessibility.getFullAXTree');for(const name of ['Open Data Mapper','Open Application Rationalization','Open Cost Synergy Estimator','Open License Optimizer','Open Scenario Modeling','Open Playbook Generator','View and edit TSA services'])assert.ok(nodes.some(n=>!n.ignored&&n.role?.value==='link'&&n.name?.value===name),name);await shot(`isolated-${width}`);}
  evidence.checks.push('Actual populated component: exact original counts, signed CAD/zero, review-not-approval disclosures, one TSA summary, all seven existing overview links, native accessibility-tree labels and1440/390/320 no overflow.');
  await mode('incomplete');assert.equal(await metric('Annual recurring savings'),'Unknown / Not computable');assert.match(await evaluate('document.body.textContent'),/A required assumption amount is unknown/);assert.ok(await evaluate("!!document.querySelector('[aria-label=\"Cost Synergy\"] [data-state=incomplete]')"));
  await mode('outdated');assert.equal(await metric('Illustrative net benefit'),'Not available');assert.match(await evaluate('document.body.textContent'),/The source changed/);
  await mode('absent');assert.equal(await metric('Original AI actions'),'Not available');assert.match(await evaluate('document.body.textContent'),/Not generated/);
  await evaluate('window.offlineHealth.invalid()');await waitFor("document.querySelector('[aria-label=\"Application Rationalization\"] [data-state=invalid]')");assert.equal(await evaluate("document.body.textContent.includes('PRIVATE_DETAIL_MUST_NOT_RENDER')"),false);
  await mode('populated');await evaluate('window.offlineHealth.foreign()');await waitFor("document.querySelector('[aria-label=\"Application Rationalization\"] [data-state=outdated]')");
  await mode('populated');await evaluate('window.offlineHealth.revoke()');await waitFor("document.querySelector('[aria-label=\"Playbook\"] [data-state=outdated]')");
  assert.equal(await evaluate('sessionStorage.getItem("aivra:r0:demo-session:v1")'),stored);assert.equal(await evaluate('window.offlineHealth.fetches'),0);
  evidence.checks.push('Actual incomplete/null CSE warnings, outdated/absent values, invalid private DTO and foreign/stale view refusal; source session unchanged and zero dashboard requests.');
  await mode('populated');await evaluate('window.offlineHealth.session.resetDemoSession()');await waitFor("document.querySelector('[aria-label=\"Cost Synergy\"] [data-state=outdated]')");assert.equal(await metric('Illustrative net benefit'),'Not available');
  evidence.checks.push('Shared-session Reset cannot display the previous protected result as current; no full mutation walkthrough/U13.03 claim.');
  if(process.env.AIVRA_BASE_URL){const base=process.env.AIVRA_BASE_URL;assert.equal(new URL(base).hostname,'127.0.0.1');
    await page('Page.addScriptToEvaluateOnNewDocument',{source:"window.__healthCalls=[];const f=window.fetch;window.fetch=(...a)=>{window.__healthCalls.push({url:String(a[0] instanceof Request?a[0].url:a[0]),method:a[1]?.method??(a[0] instanceof Request?a[0].method:'GET')});return f(...a)};"});
    for(const width of [1440,390,320]){await page('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await page('Page.navigate',{url:base+'/integration-health'});await waitFor("document.querySelector('[data-metric=\"Total applications\"]')?.textContent==='30'");
      const before=await evaluate('sessionStorage.getItem("aivra:r0:demo-session:v1")'),session=JSON.parse(before);assert.equal(await metric('Total applications'),String(session.current_deal.applications.length));assert.equal(await metric('Original AI actions'),'Not available');assert.equal(await metric('Illustrative net benefit'),'Not available');assert.equal(await metric('Original activities'),'Not available');assert.equal(await evaluate("document.querySelectorAll('[data-tsa-count]').length"),5);assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"),7);assert.equal(await evaluate("document.querySelectorAll('.future-feature a,.future-feature button,.future-feature [tabindex]').length"),0);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await evaluate("document.querySelector('.health-dashboard a').focus()");await key('Tab',9);assert.equal(await evaluate('document.activeElement.textContent'),'Open Application Rationalization');assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'),'none');
      await shot(`public-${width}`);for(const request of await evaluate('window.__healthCalls')){const url=new URL(request.url);assert.equal(request.method,'GET');assert.equal(url.origin,base);assert.ok(url.searchParams.has('_rsc'));assert.ok(['/','/integration-health','/data-mapper','/application-rationalization','/license-optimizer','/cost-synergy','/scenario-modeling','/playbook-generator','/tsa-tracker','/ai-assistant'].includes(url.pathname));}
      await key('Enter',13);await waitFor("location.pathname==='/application-rationalization'");assert.equal(await evaluate('sessionStorage.getItem("aivra:r0:demo-session:v1")'),before);
    }
    const destinations={'/data-mapper':'Data Mapper Engine','/application-rationalization':'Application Rationalization','/license-optimizer':'License Optimizer','/cost-synergy':'Cost Synergy Estimator','/scenario-modeling':'Scenario / What-if Modeling','/playbook-generator':'Playbook Generator','/tsa-tracker':'TSA Tracker'};
    for(const [path,title] of Object.entries(destinations)){await page('Page.navigate',{url:base+path});await waitFor(`location.pathname===${JSON.stringify(path)} && document.querySelector('h1')?.textContent===${JSON.stringify(title)}`);}

    evidence.checks.push('Final production1440/390/320: real application/TSA counts once, protected ALA/CSE/Playbook unavailable, keyboard Tab/Enter overview navigation with focus and preserved session, seven inert features, no overflow or API/provider calls; destination routes load.');
  }
  assert.deepEqual(evidence.runtimeErrors,[]);assert.deepEqual(evidence.externalRequests,[]);await writeFile(`${output}/browser-checks.json`,JSON.stringify(evidence,null,2));console.log(`PASS: ${evidence.checks.length} U13.02 Chromium groups; actual isolated components and optional final production dashboard.`);
}finally{socket?.close();browser.kill();await new Promise(resolve=>server.close(resolve));}
