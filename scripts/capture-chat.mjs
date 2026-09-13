/**
 * 로컬 QA 세션으로 채팅 인테이크를 실제 API까지 돌려 스크린샷·응답 증적을 artifacts에 남긴다.
 * localhost 전용 — data/local-qa-auth.json의 세션을 사용한다.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.CHAT_QA_URL ?? "http://127.0.0.1:5192";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "QA credentials must stay on localhost");
const saved = JSON.parse(readFileSync(new URL("../data/local-qa-auth.json", import.meta.url), "utf8"));
const directory = new URL("../artifacts/", import.meta.url);
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const evidence = { checkedAt: new Date().toISOString(), base, realApi: true, captures: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: saved.storageKey, value: saved.storageValue });
  const page = await context.newPage();
  const dashboardPending = page.waitForResponse((response) => response.url().endsWith("/api/dashboard"));
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("customer-workspace").waitFor({ timeout: 30_000 });
  const dashboardResponse = await dashboardPending;
  assert.ok(dashboardResponse.ok(), "Dashboard must load before capturing the intake");
  const dashboard = await dashboardResponse.json();
  const newRequest = page.getByRole("button", { name: "New request", exact: true });
  if (dashboard.requests.length > 0) await newRequest.click();
  await page.getByTestId("customer-intake").waitFor({ timeout: 30_000 });
  assert.match(await page.title(), /WeCover/i);
  for (const [locale, width, height, file] of [["EN", 1440, 1000, "wecover-chat-desktop.png"], ["EN", 375, 812, "wecover-chat-mobile.png"], ["ES", 320, 812, "wecover-chat-spanish.png"]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: locale, exact: true }).click();
    await page.getByTestId("customer-intake").waitFor();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(dimensions.document <= dimensions.viewport, `Horizontal overflow at ${width}px`);
    await page.screenshot({ path: fileURLToPath(new URL(file, directory)), fullPage: true });
    evidence.captures.push({ file, locale, width, height, horizontalOverflow: false });
  }
  if (process.argv.includes("--live-ai")) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await page.locator("#intake-message").fill("The bathroom faucet drips slowly after I close it. No gas, smoke, exposed electricity, or flooding. What photo would help identify the issue?");
    const responsePending = page.waitForResponse((response) => response.url().endsWith("/api/intake/analyze") && response.request().method() === "POST", { timeout: 60_000 });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const response = await responsePending;
    if (!response.ok()) {
      const failure = await response.json();
      await page.screenshot({ path: fileURLToPath(new URL("wecover-chat-ui-failure.png", directory)), fullPage: true });
      throw new Error(`Live UI analysis failed: HTTP ${response.status()} ${failure.error ?? "unknown"}`);
    }
    await page.getByTestId("intake-assessment").waitFor({ timeout: 60_000 });
    await page.screenshot({ path: fileURLToPath(new URL("wecover-chat-live-reply.png", directory)), fullPage: true });
    evidence.captures.push({ file: "wecover-chat-live-reply.png", locale: "EN", width: 1440, height: 1000, realLlmResponse: true });
    evidence.liveUiAnalysis = true;
  }
  writeFileSync(new URL("wecover-chat-browser-check.json", directory), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ captures: evidence.captures.length, realApi: true, liveUiAnalysis: evidence.liveUiAnalysis ?? false }));
} finally {
  await browser.close();
}
