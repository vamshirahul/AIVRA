import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AIStatusNotice } from "../components/ai/ai-status-notice.ts";
import { AI_ERROR_COPY, metadataFromValidatedResult, presentAIState } from "../lib/ai/ai-view-state.ts";
import type { AIViewState } from "../lib/ai/ai-view-state.ts";
import type { ResultEnvelope } from "../lib/server/ai/contracts.ts";
import { createDemoSession, captureInputVersions, recordDerivedResultMetadata } from "../lib/session/session.ts";

const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Offline AI UI check forbids network"); };
const render = (state: AIViewState) => renderToStaticMarkup(createElement(AIStatusNotice, { state }));
const envelope = (mode: "paid" | "fallback", reason?: "budget_exhausted" | "paid_unavailable"): ResultEnvelope<unknown> => ({
  module: "ala", request_id: "b57acb37-5daf-4c49-9175-e22c9c3da9fb", input_digest: "0".repeat(64),
  model_provider: "offline-test", model_id: "simulated-model/v1", mode, ...(reason ? { routing_reason: reason } : {}),
  prompt_version: "ui-check/v1", generated_at: "2026-10-31T12:00:00Z", usage_estimate: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null },
  warnings: ["ai_generated_draft"], data: { private_canary: "DO_NOT_DISPLAY_SOURCE_OR_PAYLOAD" },
});
function completed(result: ResultEnvelope<unknown>, freshness?: "stale"): AIViewState {
  const resultMetadata = metadataFromValidatedResult(result); assert.ok(resultMetadata);
  return { status: "completed", resultMetadata, freshness };
}
try {
  for (const status of ["not_enabled", "idle"] as const) {
    const html = render({ status });
    assert.doesNotMatch(html, /role=|Provider:|Model:|<button|AI draft/);
    assert.match(html, status === "idle" ? /No AI analysis yet/ : /AI not enabled/);
  }
  const loading = render({ status: "loading" });
  assert.match(loading, /role="status"/); assert.match(loading, /aria-live="polite"/); assert.match(loading, /aria-atomic="true"/);
  assert.match(loading, /Analyzing with AI\.\.\./); assert.doesNotMatch(loading, /%|progressbar|<button|Provider:/);
  console.log("PASS: not-enabled, idle and loading copy; polite atomic loading, no fake progress or controls");

  const paid = render(completed(envelope("paid")));
  assert.match(paid, /AI draft · Paid model/); assert.match(paid, /Provider: offline-test · Model: simulated-model\/v1/);
  assert.match(paid, /not transaction advice or human approval/); assert.doesNotMatch(paid, /fallback|DO_NOT_DISPLAY|input_digest|request_id|usage_estimate/);
  for (const reason of ["budget_exhausted", "paid_unavailable"] as const) {
    const html = render(completed(envelope("fallback", reason)));
    assert.match(html, /Open-weight AI fallback/); assert.match(html, /Results may differ/); assert.match(html, /Provider: offline-test/);
    assert.match(html, reason === "budget_exhausted" ? /allowance could not cover/ : /disabled by policy/);
    assert.doesNotMatch(html, /free|unlimited|<button/);
  }
  assert.match(render(completed(envelope("paid"), "stale")), /Outdated: source data changed/);
  assert.doesNotMatch(paid, /Outdated/);
  console.log("PASS: typed simulated paid/fallback identity and both permitted reasons, provisional labels and explicit freshness");

  for (const invalid of [envelope("fallback"), envelope("paid", "budget_exhausted"),
    { ...envelope("paid"), model_provider: "<script>private</script>" }, { ...envelope("paid"), model_id: "x".repeat(129) },
    { ...envelope("fallback"), routing_reason: "provider_failed" }, { ...envelope("paid"), mode: "visitor_override" }]) {
    assert.equal(metadataFromValidatedResult(invalid as ResultEnvelope<unknown>), null);
    const html = render({ status: "completed", resultMetadata: invalid as never });
    assert.match(html, /AI unavailable/); assert.doesNotMatch(html, /<script|visitor_override|provider_failed|Provider:/);
  }
  const server = await readFile("lib/server/ai/base-contracts.ts", "utf8");
  const codes = [...server.match(/FailureCodeSchema = z.enum\(\[([^\]]+)\]/)![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(AI_ERROR_COPY).sort(), codes.sort());
  for (const safeErrorCode of Object.keys(AI_ERROR_COPY) as (keyof typeof AI_ERROR_COPY)[]) {
    const state = { status: "error", safeErrorCode, raw_message: "SECRET_PROVIDER_PAYLOAD" } as const;
    const html = render(state);
    assert.equal((html.match(/role="alert"/g) ?? []).length, 1);
    assert.match(html, /AI unavailable/); assert.match(html, /Your synthetic session data is retained/);
    assert.doesNotMatch(html, /SECRET_PROVIDER_PAYLOAD|<button|Provider:|Model:|aria-live=/);
    assert.equal(presentAIState(state).message.startsWith(AI_ERROR_COPY[safeErrorCode]), true);
  }
  assert.match(render({ status: "error", safeErrorCode: "provider_unavailable" }), /No fallback result was generated/);
  assert.doesNotMatch(render({ status: "error", safeErrorCode: "raw_secret" as never }), /raw_secret/);
  console.log(`PASS: all ${codes.length} server failure codes covered, one alert, fixed safe text, malformed provenance suppressed`);

  const initial = createDemoSession("2026-10-31T12:00:00Z");
  const session = recordDerivedResultMetadata(initial, "ala", ["applications"], captureInputVersions(initial, ["applications"]));
  const snapshot = JSON.stringify(session);
  for (const state of [completed(envelope("fallback", "budget_exhausted")), { status: "error", safeErrorCode: "fallback_unavailable" }] as AIViewState[]) render(state);
  assert.equal(JSON.stringify(session), snapshot);
  for (const file of ["components/ai/ai-status-notice.ts", "lib/ai/ai-view-state.ts"]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source.replace(/^import type .*$/gm, ""), /server-only|server\/ai|fetch\(|sessionStorage|localStorage|useEffect|setTimeout|setInterval|process\.env|dangerouslySetInnerHTML/);
  }
  const page = await readFile("app/[module]/page.tsx", "utf8");
  assert.match(page, /AIStatusNotice state=\{\{ status: "not_enabled" \}\}/);
  assert.doesNotMatch(page, /status: "(?:completed|loading|error)"|server\/ai|"use server"/);
  const gallery = await readFile("components/future-features.tsx", "utf8");
  assert.doesNotMatch(gallery, /<(?:button|a|Link)\b|\b(?:onClick|tabIndex|href)=/);
  const css = await readFile("app/globals.css", "utf8");
  const colors = Object.fromEntries([...css.matchAll(/--([a-z-]+): (#[0-9A-F]+);/g)].map((m) => [m[1], m[2]]));
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map((c) => parseInt(c, 16) / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const contrast: Record<string, number> = {};
  for (const [fg, bg] of [["foreground", "surface"], ["accent", "accent-soft"], ["success", "success-surface"], ["warning", "warning-surface"], ["error", "error-surface"]]) {
    const a = luminance(colors[fg]), b = luminance(colors[bg]); const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(ratio >= 4.5); contrast[`${fg}/${bg}`] = Number(ratio.toFixed(2));
  }
  console.log(`PASS: read-only session/metadata preservation, no client server-runtime imports, inert gallery; A1 text contrast ${JSON.stringify(contrast)}`);
  assert.equal(networkAttempts, 0);
  console.log("PASS: 5 offline UI-state groups; zero provider/network attempts, no transport or endpoint");
} finally { globalThis.fetch = originalFetch; }

if (process.argv.includes("--browser")) {
  // Existing external tool only; never install a framework for this unit.
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.AIVRA_PLAYWRIGHT_PATH || "playwright-core");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AIVRA_CHROMIUM_PATH, args: ["--disable-background-networking"] });
  const base = process.env.AIVRA_BASE_URL || "http://127.0.0.1:3000";
  assert.equal(new URL(base).hostname, "127.0.0.1", "Smoke check must stay on local loopback");
  const page = await browser.newPage(); const errors: string[] = []; let external = 0;
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.route("**/*", (route: any) => {
    if (new URL(route.request().url()).origin !== base) { external++; return route.abort(); }
    return route.continue();
  });
  try {
    const paths = ["/", "/integration-health", "/data-mapper", "/application-rationalization", "/license-optimizer", "/cost-synergy", "/scenario-modeling", "/playbook-generator", "/tsa-tracker", "/ai-assistant"];
    for (const path of paths) assert.equal((await page.request.get(`${base}${path}`)).status(), 200);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/application-rationalization", "/license-optimizer", "/playbook-generator", "/ai-assistant"]) {
        await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        if (path === "/ai-assistant") {
          assert.equal(await page.locator(".assistant-workspace").count(), 1);
          assert.match(await page.locator(".assistant-availability").innerText(), /AI not enabled/);
          assert.equal(await page.getByRole("button", { name: "Ask Assistant", exact: true }).isDisabled(), true);
          assert.equal(await page.getByRole("textbox", { name: "Your M&A question", exact: true }).count(), 1);
          assert.equal(await page.getByRole("button", { name: "Reset chat", exact: true }).count(), 1);
          assert.equal(await page.locator(".assistant-transcript").count(), 0);
        } else {
          const notice = page.locator(".ai-notice");
          assert.equal(await notice.count(), 1); assert.match(await notice.innerText(), /AI not enabled/);
          assert.equal(await notice.locator("button,a,[tabindex],[role=status],[role=alert]").count(), 0);
          if (path === "/license-optimizer") assert.equal(await page.getByRole("heading", { name: "License inventory", exact: true }).count(), 1);
          else if (path === "/application-rationalization") assert.equal(await page.getByRole("button", { name: "Analyze applications", exact: true }).count(), 1);
          else assert.equal(await page.getByRole("button", { name: "Generate playbook", exact: true }).count(), 1);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      assert.equal(await page.locator("nav a").count(), 10);
      assert.equal(await page.locator(".future-feature").count(), 7);
      assert.equal(await page.locator(".future-feature a,.future-feature button,.future-feature [tabindex]").count(), 0);
      const stored = await page.evaluate(() => sessionStorage.getItem("aivra:r0:demo-session:v1")); assert.ok(stored);
      await page.goto(`${base}/application-rationalization`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => sessionStorage.getItem("aivra:r0:demo-session:v1")), stored);
      await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to main content");
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle), "none");
      await page.keyboard.press("Enter"); assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content");
    }
    await page.goto(`${base}/data-mapper`, { waitUntil: "networkidle" }); assert.equal(await page.locator(".ai-notice").count(), 0);
    assert.deepEqual(errors, []); assert.equal(external, 0);
    console.log("PASS: bounded Chromium smoke, 10 routes HTTP 200; three disabled notices and unavailable Assistant workspace at 1440/390px, no overflow, inert gallery, skip-link focus, session retained; zero external requests or runtime errors");
  } finally { await browser.close(); }
}
