// Focused checks using installed Chromium + Node built-ins; no test packages.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const labels = ["Data Migration Readiness Checker", "System Dependency Mapper", "Synergy Realization Tracker", "Predictive Risk Assessment", "Portfolio Analytics/Reporting", "Governance/Approval Workflow", "Enterprise Connectors"];
const ids = ["M08", "M09", "M12", "M14", "M15", "M17", "M18"];
const routes = ["/", "/integration-health", "/data-mapper", "/application-rationalization", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"];
const futureSlugs = ["data-migration-readiness-checker", "system-dependency-mapper", "synergy-realization-tracker", "predictive-risk-assessment", "portfolio-analytics-reporting", "governance-approval-workflow", "enterprise-connectors"];
const base = process.env.AIVRA_BASE_URL || "http://127.0.0.1:3000";
const chrome = process.env.AIVRA_CHROMIUM_PATH;
assert.ok(chrome, "Set AIVRA_CHROMIUM_PATH to an existing Chromium executable");
const output = "artifacts/u00-04";
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "aivra-u04-chromium-"));
const source = await readFile("components/future-features.tsx", "utf8");
assert.doesNotMatch(source, /\b(?:onClick|onKeyDown|href|tabIndex|aria-expanded)\s*=/);
assert.doesNotMatch(source, /<(?:Link|a|button|input|summary|details)\b/);
const browser = spawn(chrome, ["--headless", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true });
let socket;
let serial = 0;
const pending = new Map();
const evidence = { routes: [], futureRoutes: [], presentations: [], keyboard: [], accessibility: "Focused DOM, accessibility-tree and contrast checks; no full axe/WCAG suite", runtimeErrors: [] };
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error("Chromium startup timed out")), 15000);
    browser.once("error", reject);
    browser.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") evidence.runtimeErrors.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timeout);
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
  async function key(keyName, keyCode) {
    for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: keyName, code: keyName, windowsVirtualKeyCode: keyCode, ...(keyName === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  }
  await page("Page.enable");
  await page("Runtime.enable");
  await page("Page.navigate", { url: base });
  for (let i = 0; i < 100 && !(await evaluate("document.readyState === 'complete' && !!document.querySelector('.future-features')")); i++) await new Promise((resolve) => setTimeout(resolve, 50));

  for (const width of [1440, 320, 390]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    if (width < 1024) {
      await evaluate("document.querySelector('.menu-toggle').focus()");
      await key("Enter", 13);
    }
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const state = await evaluate(`(() => {
      const gallery = document.querySelector('.future-features');
      const items = [...gallery.querySelectorAll('li')];
      const rect = gallery.getBoundingClientRect();
      return {
        heading: gallery.querySelector('h2').textContent,
        ids: items.map(el => el.dataset.featureId), labels: items.map(el => el.querySelector('.future-feature-label').textContent),
        planned: items.map(el => el.querySelector('.future-feature-status').textContent),
        interactive: gallery.querySelectorAll('a,button,input,select,textarea,summary,details,[href],[tabindex],[contenteditable],[role="button"],[aria-expanded]').length,
        icons: items.map(el => el.querySelector('svg').getAttribute('aria-hidden')),
        distinctIcons: new Set(items.map(el => el.querySelector('path').getAttribute('d'))).size,
        links: [...document.querySelectorAll('nav a')].map(el => el.getAttribute('href')),
        navCount: document.querySelectorAll('nav').length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        visible: rect.width > 0 && rect.height > 0,
        cursor: items.map(el => getComputedStyle(el).cursor),
        color: getComputedStyle(items[0]).color, background: getComputedStyle(document.querySelector('aside')).backgroundColor,
        clip: {x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height, scale: 1}
      };
    })()`);
    assert.equal(state.heading, "Future Features");
    assert.deepEqual(state.ids, ids); assert.deepEqual(state.labels, labels);
    assert.deepEqual(state.planned, labels.map(() => "Planned"));
    assert.equal(state.interactive, 0); assert.equal(state.distinctIcons, 7);
    assert.deepEqual(state.icons, labels.map(() => "true"));
    assert.deepEqual(state.links, routes); assert.equal(state.navCount, 1);
    assert.equal(state.overflow, false, `Overflow at ${width}px`); assert.equal(state.visible, true, `Gallery hidden at ${width}px`);
    assert.ok(state.cursor.every((cursor) => cursor === "default"));
    const luminance = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const contrast = (luminance(state.background) + .05) / (luminance(state.color) + .05);
    assert.ok(contrast >= 4.5);
    const { nodes } = await page("Accessibility.getFullAXTree");
    for (const label of labels) assert.equal(nodes.filter((node) => !node.ignored && node.role?.value === "StaticText" && node.name?.value === label).length, 1, `Accessible label ${label}`);
    const before = await evaluate("location.href + document.querySelector('main').innerText");
    if (width < 1024) await page("Emulation.setTouchEmulationEnabled", { enabled: true });
    for (let index = 0; index < labels.length; index++) {
      const point = await evaluate(`(() => { const el = document.querySelectorAll('.future-feature')[${index}]; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      if (width < 1024) {
        await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
        await page("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
      }
    }
    assert.equal(await evaluate("location.href + document.querySelector('main').innerText"), before);
    await evaluate("document.querySelector('nav a').focus()");
    for (let index = 1; index < routes.length; index++) {
      await key("Tab", 9);
      assert.equal(await evaluate("document.activeElement.getAttribute('href')"), routes[index]);
    }
    await key("Tab", 9);
    assert.equal(await evaluate("!!document.activeElement.closest('.future-features')"), false);
    assert.equal(await evaluate("!!document.activeElement.closest('main')"), true);
    // Reset scroll/focus before cropping to avoid fixed skip-link capture artifacts.
    await evaluate("document.activeElement.blur(); window.scrollTo(0,0); new Promise(resolve => requestAnimationFrame(resolve))");
    const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: state.clip });
    await writeFile(`${output}/gallery-${width}.png`, Buffer.from(data, "base64"));
    evidence.presentations.push({ width, items: 7, interactive: 0, distinctIcons: 7, overflow: false, contrast: Number(contrast.toFixed(2)), accessibleNamesOnce: true, clickChangesContentOrURL: false });
    evidence.keyboard.push({ width, existingNavigationOrderPreserved: true, tabSkipsGalleryToMain: true });
    if (width < 1024) { await evaluate("document.querySelector('.menu-toggle').focus()"); await key("Enter", 13); }
  }
  // Check link resolution only; deliberately do not repeat the full U00.03 suite.
  for (const route of routes) { const response = await fetch(base + route); assert.equal(response.status, 200); evidence.routes.push({ route, status: response.status }); }
  for (const slug of futureSlugs) { const response = await fetch(`${base}/${slug}`); assert.equal(response.status, 404); evidence.futureRoutes.push({ route: `/${slug}`, status: response.status }); }
  assert.deepEqual(evidence.runtimeErrors, []);
  await writeFile(`${output}/checks.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log("PASS: seven exact Planned items, distinct hidden SVGs, zero interactivity, accessibility names/contrast, desktop + 320/390px, Tab skips gallery, click has no action, ten links HTTP 200, seven future URLs 404.");
  await send("Browser.close");
} finally {
  socket?.close();
  browser.kill();
}
