// Optional browser QA using an existing local tool installation, not app dependencies.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIVRA_PLAYWRIGHT_PATH || "playwright-core");
const axeScript = process.env.AIVRA_AXE_PATH || require.resolve("axe-core/axe.min.js");
const base = process.env.AIVRA_BASE_URL || "http://127.0.0.1:3000";
const evidenceDir = path.resolve(process.env.AIVRA_EVIDENCE_DIR || "artifacts/u00-03");
await mkdir(evidenceDir, { recursive: true });

const routes = [
  ["/", "M&A integration workspace"],
  ["/integration-health", "Integration Health Dashboard"],
  ["/data-mapper", "Data Mapper Engine"],
  ["/application-rationalization", "Application Rationalization"],
  ["/license-optimizer", "License Optimizer"],
  ["/cost-synergy", "Cost Synergy Estimator"],
  ["/scenario-modeling", "Scenario / What-if Modeling"],
  ["/playbook-generator", "Playbook Generator"],
  ["/tsa-tracker", "TSA Tracker"],
  ["/ai-assistant", "AI M&A Assistant"],
];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const evidence = { routes: [], viewports: [], keyboard: [], accessibility: [], palette: {}, contrast: [], consoleErrors: errors };

async function checkAccessibility(label) {
  await page.addScriptTag({ path: axeScript });
  const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
  evidence.accessibility.push({ page: label, violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })), incomplete: result.incomplete.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })) })) });
  assert.deepEqual(result.violations, [], `${label}: accessibility violations`);
}

try {
  for (const [route, title] of routes) {
    const response = await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
    assert.equal(response.status(), 200, route);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("h1").innerText(), title);
    assert.equal(await page.locator("main").count(), 1);
    assert.equal(await page.getByRole("navigation", { name: "Main navigation" }).count(), 1);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    assert.equal(await nav.getByRole("link").count(), 10);
    assert.deepEqual(await nav.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href"))), routes.map(([href]) => href));
    assert.equal(await nav.locator('[aria-current="page"]').getAttribute("href"), route);
    assert.match(await page.locator("footer").innerText(), /Public preview • Synthetic example data • AI-generated analysis is illustrative, not transaction advice\./);
    if (route !== "/") assert.equal(await page.getByText("Not yet implemented", { exact: true }).count(), 1);
    await checkAccessibility(route);
    evidence.routes.push({ route, status: response.status(), title, activeLink: route, navigationLinks: 10 });
  }
  assert.equal((await page.goto(`${base}/not-an-approved-module`)).status(), 404);
  await page.goto(base, { waitUntil: "networkidle" });
  evidence.palette = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(["background", "surface", "foreground", "accent", "border", "muted"].map((key) => {
      let value = style.getPropertyValue(`--${key}`).trim().toUpperCase();
      // Production CSS may shorten #FFFFFF to #FFF without changing the color.
      if (/^#[0-9A-F]{3}$/.test(value)) value = "#" + [...value.slice(1)].map((digit) => digit + digit).join("");
      return [key, value];
    }));
  });
  assert.deepEqual(evidence.palette, { background: "#F7F9FC", surface: "#FFFFFF", foreground: "#152B46", accent: "#206F81", border: "#CBD5E1", muted: "#4C627E" });
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(["background", "surface", "foreground", "muted", "accent", "accent-hover", "accent-soft", "focus", "disabled", "success", "success-surface", "warning", "warning-surface", "error", "error-surface"].map((key) => [key, style.getPropertyValue(`--${key}`).trim()]));
  });
  function luminance(hex) {
    if (hex.length === 4) hex = "#" + [...hex.slice(1)].map((digit) => digit + digit).join("");
    const rgb = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  }
  for (const [foreground, background, minimum] of [
    ["foreground", "background", 4.5], ["muted", "background", 4.5], ["muted", "surface", 4.5],
    ["surface", "foreground", 4.5], ["surface", "accent", 4.5], ["surface", "accent-hover", 4.5],
    ["accent", "surface", 4.5], ["accent", "accent-soft", 4.5], ["muted", "disabled", 4.5],
    ["success", "success-surface", 4.5], ["warning", "warning-surface", 4.5], ["error", "error-surface", 4.5],
    ["focus", "surface", 3], ["focus", "background", 3],
  ]) {
    const a = luminance(colors[foreground]);
    const b = luminance(colors[background]);
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(ratio >= minimum, `${foreground}/${background}: contrast ${ratio} below ${minimum}`);
    evidence.contrast.push({ foreground, background, ratio: Number(ratio.toFixed(2)), minimum });
  }
  assert.deepEqual(await page.locator("dl dd").allTextContents(), ["15", "15", "10", "5"]);
  await page.screenshot({ path: path.join(evidenceDir, "desktop.png"), fullPage: true });

  // Client-side navigation updates active state without requiring a full reload.
  await page.getByRole("navigation").getByRole("link", { name: "License Optimizer", exact: true }).click();
  await page.waitForURL("**/license-optimizer");
  assert.equal(await page.locator('nav [aria-current="page"]').getAttribute("href"), "/license-optimizer");
  await page.screenshot({ path: path.join(evidenceDir, "module-desktop.png"), fullPage: true });

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/", "/application-rationalization", "/scenario-modeling"]) {
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(sizes.scroll <= sizes.width, `${route}: horizontal overflow at ${width}px`);
    }
    evidence.viewports.push({ width, horizontalOverflow: false, pages: 3 });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(await page.locator("#workspace-navigation").isVisible(), false);
  await page.screenshot({ path: path.join(evidenceDir, "mobile.png"), fullPage: true });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Skip to main content");
  const focusStyle = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(focusStyle, "none");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "main-content");
  evidence.keyboard.push("Skip link is the first tab stop, visibly focused, and targets main");

  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("button", { name: "Close menu", exact: true }).getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("href")), "/");
  for (const [route] of routes.slice(1)) {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("href")), route);
  }
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#workspace-navigation").isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Open menu");
  evidence.keyboard.push("Enter opens navigation; all 10 links reachable by Tab; Escape closes and returns focus");

  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#workspace-navigation").isVisible(), false);
  await page.keyboard.press("Space");
  await page.evaluate(() => window.scrollTo(0, 0));
  await checkAccessibility("mobile menu open");
  await page.screenshot({ path: path.join(evidenceDir, "mobile-menu.png"), fullPage: true });
  await page.getByRole("navigation").getByRole("link", { name: "AI M&A Assistant", exact: true }).click();
  await page.waitForURL("**/ai-assistant");
  assert.equal(await page.locator("#workspace-navigation").isVisible(), false);
  assert.equal(await page.locator('nav [aria-current="page"]').getAttribute("href"), "/ai-assistant");
  await checkAccessibility("mobile module");
  evidence.keyboard.push("Space toggles menu; Escape also works at toggle; choosing a route closes navigation and updates active state");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("button", { name: "Close menu", exact: true }).click();
  assert.equal(await page.locator("#workspace-navigation").isVisible(), false);
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidenceDir, "checks.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log("PASS: 10 public routes, 9 honest module states, active navigation, fixture counts, exact A1 palette, 5 viewport widths, keyboard/menu/skip-link checks, zero axe WCAG A/AA violations and no page errors.");
} finally {
  await browser.close();
}
