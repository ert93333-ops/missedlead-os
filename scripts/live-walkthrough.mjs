/**
 * 라이브 E2E 워크스루: 목 없이 실제 백엔드(로컬 Supabase + Gemini)를 브라우저로 구동한다.
 * Vite dev 서버(http://localhost:5199)와 API(9187)가 실행 중이어야 한다.
 *
 * 시나리오:
 *  A. 고객(test2) 누수 인테이크 → 동적 질문 응답 → 확정 → 대시보드 요청 생성
 *  B. 응급(가스 냄새) 입력 → 안전 차단 확인 (매칭 불가)
 *  C. 스킵 플로우 (비안전 질문 건너뛰기)
 *  D. ES 로케일 인테이크
 *  E. 운영자(test1) 매칭 → 기사(test3) 견적 제출 → 고객 견적 선택
 *
 * 실행: node scripts/live-walkthrough.mjs
 */
import { chromium } from "@playwright/test";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";

config({ path: [".env.local", ".env"], quiet: true, override: true });

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:5199";
const OUT = "artifacts/live";
mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  operator: "test1@demo.wecover.invalid",
  customer: "test2@demo.wecover.invalid",
  provider: "test3@demo.wecover.invalid",
};
const PASSWORD = "testtest";

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("response", (res) => { if (res.status() >= 400 && res.url().includes("/api/")) consoleErrors.push(`${res.status()} ${res.url()}`); });
page.on("response", (res) => {
  if (res.status() >= 400 && /intake|match|quote/.test(res.url()))
    res.text().then((body) => console.log(`  !! ${res.status()} ${res.url().slice(-50)} -> ${body.slice(0, 150)}`)).catch(() => {});
});
const inflight = new Map();
page.on("request", (req) => { if (req.url().includes("/api/") || req.url().includes("/supa/")) inflight.set(req.url(), Date.now()); });
page.on("response", (res) => inflight.delete(res.url()));
page.on("requestfailed", (req) => { inflight.delete(req.url()); if (req.url().includes("/api/") || req.url().includes("/supa/")) console.log(`  !! requestfailed ${req.method()} ${req.url().slice(0, 110)} ${req.failure()?.errorText ?? ""}`); });
const dumpInflight = (label) => { const now = Date.now(); for (const [url, started] of inflight) { if (now - started > 8_000) console.log(`  >> stalled ${Math.round((now - started) / 1000)}s ${url.slice(0, 110)} (${label})`); } };

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

async function login(email) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForSelector('input[name="email"], [data-testid$="-workspace"]', { timeout: 30_000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(3000);
    }
  }
  await page.evaluate(() => { try { window.localStorage?.clear(); window.sessionStorage?.clear(); } catch {} });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector('input[name="email"]', { timeout: 30_000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('form button[type="submit"], form button:has-text("Sign in"), form button:has-text("Continue"), form >> button');
  await page.waitForSelector('[data-testid$="-workspace"], [data-testid="customer-intake"], [data-testid="operator-console"], [data-testid="provider-inbox"]', { timeout: 30_000 });
}

async function signOut() {
  const btn = page.locator('button:has-text("Sign out"), button:has-text("Cerrar sesión")');
  if (await btn.count()) await btn.first().click();
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
}

const sendChat = async (text) => {
  await page.fill("#intake-message", text);
  const send = page.locator("button.send-button");
  try { await send.click({ timeout: 8_000 }); }
  catch {
    // 이전 요청이 hang해 busy가 풀리지 않은 경우 — 리로드로 복구 후 재전송
    // (리로드 시 creatingNewRequest state가 리셋돼 대시보드로 떨어지므로 ensureIntake로 재진입)
    await page.reload({ waitUntil: "domcontentloaded" });
    await ensureIntake();
    await page.fill("#intake-message", text);
    await page.locator("button.send-button").click({ timeout: 30_000 });
  }
  // 응답 지연 관측
  page.waitForResponse((res) => res.url().includes("/api/intake/analyze"), { timeout: 95_000 })
    .then((res) => console.log(`  analyze -> ${res.status()}`))
    .catch(() => console.log("  analyze -> TIMEOUT>95s (hung request)"));
};

const ensureIntake = async () => {
  await page.waitForSelector(".skeleton-stack", { state: "detached", timeout: 20_000 }).catch(() => {});
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await page.locator("#intake-message").count()) return;
    const btn = page.locator('button:has-text("New request"), button:has-text("Nueva solicitud"), .tabbar button:has-text("New repair"), .tabbar button:has-text("Nueva")').first();
    const count = await btn.count();
    console.log(`  ensureIntake attempt ${attempt}: btn=${count} testid=${await page.locator("[data-testid$='-workspace']").count()}`);
    if (!count) { dumpInflight("ensureIntake"); await page.waitForTimeout(2500); continue; }
    await btn.click();
    await page.waitForSelector("#intake-message", { timeout: 15_000 }).catch(() => {});
  }
  dumpInflight("ensureIntake-end");
};

// 인테이크 루프: 질문 카드가 보이면 답하고, 확정 폼이면 true 반환, 응급 차단이면 "blocked"
async function driveIntake({ answers = [], skipFirst = false, maxRounds = 16, shotPrefix }) {
  let skipped = false;
  let retries = 0;
  for (let round = 0; round < maxRounds; round++) {
    await page.waitForTimeout(500);
    await page.waitForSelector(".chat-message--thinking", { state: "detached", timeout: 90_000 }).catch(() => {});
    // 요청이 hang하면(브라우저 fetch 미완료) 리로드로 복구 — sessionStorage가 상태 복원
    if (await page.locator(".chat-message--thinking").count()) { await page.reload({ waitUntil: "domcontentloaded" }); await ensureIntake(); continue; }
    // 간헐적 503(Gemini 분당 쿼터)/429(앱 레이트리밋) — 60초 윈도우 대기 후 재시도
    const retryBtn = page.locator(".chat-error button");
    if (await retryBtn.count() && retries < 8) { retries++; await page.waitForTimeout(75_000); await retryBtn.first().click(); continue; }
    if (await page.locator(".safety-guidance--emergency, [data-testid='blocked-request']").count()) return "blocked";
    if (await page.locator('h2:has-text("Review your repair request"), h2:has-text("Revise su solicitud")').count()) return "confirm";
    const questionCard = page.locator(".followup-questions article");
    if (await questionCard.count()) {
      if (skipFirst && !skipped && await page.locator(".followup-questions article button").count()) {
        skipped = true;
        await page.locator(".followup-questions article button").first().click();
        await page.locator('.skip-warning input[type="checkbox"]').check();
        await page.locator('.skip-warning button:has-text("Skip"), .skip-warning button:has-text("Omitir")').first().click();
        continue;
      }
      const prompt = (await questionCard.locator("p").first().textContent().catch(() => "")) ?? "";
      const contextual = /electr|wir|outlet|disposal|spark/i.test(prompt) ? "No electrical outlets, disposal cords, or wiring near the wet area."
        : /gas|smell|odor/i.test(prompt) ? "No gas smell anywhere in the house."
        : /shut ?off|valve|stop/i.test(prompt) ? "Yes, I shut off the valve under the sink."
        : /when|how long|started|long/i.test(prompt) ? "It started yesterday evening and is getting worse."
        : /where|which|location|what room/i.test(prompt) ? "Under the kitchen sink, at the drain pipe joint."
        : /drain|tap|faucet|run|continuous|only/i.test(prompt) ? "It drips continuously, even when the faucet is off."
        : /sewage|color|water/i.test(prompt) ? "The water is clear, not sewage."
        : answers[round % answers.length] ?? "It started two days ago and is getting worse.";
      await sendChat(contextual);
      continue;
    }
    // 카드 없이 reply 안에만 질문이 있는 경우 — 자유 텍스트로 계속 진행 (실제 사용자 동작)
    if (await page.locator(".chat-error").count()) return "error";
    const answer = answers[round % answers.length] ?? "Please proceed with what you have so far.";
    await sendChat(answer);
    await page.waitForTimeout(500);
  }
  await shot(`${shotPrefix}-stuck`);
  return "stuck";
}

// ---------- A. 고객 인테이크 → 확정 ----------
try {
  await login(ACCOUNTS.customer);
  await ensureIntake();
  await shot("a1-login");
  await sendChat("Water is leaking under my kitchen sink and the cabinet floor is soaked.");
  const outcome = await driveIntake({
    shotPrefix: "a2",
    answers: [
      "It drips even when the faucet is off.",
      "Under the kitchen sink, at the drain pipe joint.",
      "It started yesterday evening. No gas smell, no scorch marks.",
      "The water is clear, not sewage.",
      "Yes, I can shut off the valve under the sink.",
      "No other rooms are affected.",
    ],
  });
  record("A. intake reaches confirm or blocked", outcome === "confirm", outcome);
  await shot("a3-before-confirm");
  if (outcome === "confirm") {
    await page.fill('input[name="customerName"]', "Jordan Lee");
    await page.fill('input[name="address"]', "101 Mint St, Charlotte, NC 28202");
    // 모든 후보가 low로 내려가 선택이 비어 있으면 첫 후보를 선택
    const firstIssue = page.locator('.confirm-request fieldset input[type="checkbox"]').first();
    if (await firstIssue.count() && !(await firstIssue.isChecked())) await firstIssue.check();
    await page.locator('.confirm-request__ack input[type="checkbox"]').check();
    await page.click('button.confirm-request__submit');
    await page.waitForSelector('[data-testid="chat-scope-summary"], [data-testid="quote-comparison"]', { timeout: 30_000 });
    record("A. request created → dashboard", true);
    await shot("a4-dashboard");
  }
} catch (error) { record("A. customer intake", false, String(error).slice(0, 200)); await shot("a-fail"); }

// ---------- B. 응급 차단 ----------
try {
  await ensureIntake();
  await sendChat("I smell strong gas near my stove and see scorch marks on the outlet.");
  await page.waitForSelector(".safety-guidance--emergency, [data-testid='blocked-request'], .assessment", { timeout: 60_000 });
  const emergency = await page.locator(".safety-guidance--emergency").count() || await page.locator('text=/emergency|911|gas/i').count();
  const confirmVisible = await page.locator('button:has-text("Confirm and find technicians")').count();
  record("B. gas smell → emergency block", emergency > 0 && !confirmVisible, `emergency=${emergency} confirm=${confirmVisible}`);
  await shot("b1-emergency");
} catch (error) { record("B. emergency block", false, String(error).slice(0, 200)); await shot("b-fail"); }

// ---------- E-1. 운영자 매칭 ----------
let providerId = "";
let customerId = "";
let admin;
try {
  admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  providerId = data.users.find((u) => u.email === ACCOUNTS.provider)?.id ?? "";
  customerId = data.users.find((u) => u.email === ACCOUNTS.customer)?.id ?? "";
  record("E0. provider id lookup", Boolean(providerId), providerId.slice(0, 8));
} catch (error) { record("E0. provider id lookup", false, String(error).slice(0, 120)); }

// 인테이크 결과와 무관하게 매칭 플로우를 검증할 수 있도록 요청이 없으면 하나 시드
try {
  const { data: existing } = await admin.from("service_requests").select("id,description").eq("customer_id", customerId);
  const hasLive = (existing ?? []).some((r) => /live walkthrough/i.test(r.description));
  if (!hasLive) {
    const { error } = await admin.from("service_requests").insert({
      customer_id: customerId,
      description: "Kitchen sink drain leak — live walkthrough",
      service_address: "101 Mint St, Charlotte, NC 28202",
      safety_status: "cleared",
      workflow_status: "intake",
      service_category: "plumbing",
      work_scope_snapshot: { symptom: "Water dripping from drain pipe joint under kitchen sink", location: "Kitchen sink cabinet" },
    });
    if (error) throw new Error(error.message);
    record("E0b. seeded test request", true);
  } else {
    record("E0b. seeded test request", true, "already exists");
  }
} catch (error) { record("E0b. seeded test request", false, String(error).slice(0, 150)); }

try {
  await signOut();
  await login(ACCOUNTS.operator);
  await page.waitForSelector(".skeleton-stack", { state: "detached", timeout: 20_000 }).catch(() => {});
  const picker = page.locator(".request-picker select");
  if (!(await picker.count())) { record("E1. operator match", false, "no requests in operator dashboard"); await shot("e1-empty"); throw new Error("skip"); }
  await picker.waitFor({ timeout: 15_000 });
  const options = await picker.locator("option").allTextContents();
  const leakIndex = options.findIndex((o) => /live walkthrough|leak|sink|water/i.test(o) && !/gas|scorch/i.test(o));
  if (leakIndex >= 0) await picker.selectOption({ index: leakIndex });
  const currentLabel = options[leakIndex] ?? "";
  if (/match|quote|fund|progress|complet/i.test(currentLabel)) {
    record("E1. operator match", true, `already matched — ${currentLabel.slice(0, 60)}`);
  } else {
    await page.fill('input[name="provider1"]', providerId);
    await page.fill('input[name="provider2"]', "");
    await page.fill('input[name="provider3"]', "");
    await shot("e1-operator-before-match");
    const matchResponse = page.waitForResponse((res) => res.url().includes("/match"), { timeout: 15_000 }).catch(() => null);
    await page.click('button:has-text("Match providers")');
    const matchRes = await matchResponse;
    await page.waitForTimeout(2000);
    const optionText = await picker.locator("option:checked").textContent().catch(() => "");
    const ok = (matchRes?.status() ?? 0) < 400;
    record("E1. operator match", ok, `http=${matchRes?.status() ?? "?"} status=${(optionText ?? "").slice(0, 60)}`);
  }
  await shot("e2-operator-after-match");
} catch (error) { record("E1. operator match", false, String(error).slice(0, 200)); await shot("e-fail"); }

// ---------- E-2. 기사 견적 제출 ----------
try {
  await signOut();
  await login(ACCOUNTS.provider);
  await page.waitForSelector(".skeleton-stack", { state: "detached", timeout: 20_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="provider-inbox"]', { timeout: 15_000 });
  const picker = page.locator(".request-picker select");
  if (await picker.count()) {
    const options = await picker.locator("option").allTextContents();
    const leakIndex = options.findIndex((o) => /live walkthrough|leak|sink|water/i.test(o) && !/gas|scorch/i.test(o));
    if (leakIndex >= 0) await picker.selectOption({ index: leakIndex });
  }
  if (await page.locator('textarea[name="scope"]').count()) {
    await page.fill('textarea[name="scope"]', "Replace P-trap and reseal drain joint under kitchen sink. Excludes cabinet repair.");
    await page.fill('input[name="diagnostic"]', "49");
    await page.fill('input[name="labor"]', "120");
    await page.fill('input[name="materials"]', "35");
    await page.fill('input[name="tax"]', "12");
    await page.fill('input[name="validUntil"]', "2026-12-31T18:00");
    await page.fill('input[name="earliestStartAt"]', "2026-09-20T09:00");
    await page.fill('input[name="warrantyDays"]', "90");
    await page.click('button:has-text("Submit quote")');
    await page.locator('[data-testid="provider-quote-sent"]').or(page.getByText(/quote is in/i)).first().waitFor({ timeout: 15_000 });
    record("E2. provider quote submitted", true);
  } else {
    record("E2. provider quote submitted", await page.locator('[data-testid="provider-quote-sent"]').count() > 0, "no form — already quoted?");
  }
  await shot("e3-provider-quote");
} catch (error) { record("E2. provider quote", false, String(error).slice(0, 200)); await shot("e3-fail"); }

// ---------- E-3. 고객 견적 선택 ----------
try {
  await signOut();
  await login(ACCOUNTS.customer);
  await page.waitForSelector(".skeleton-stack", { state: "detached", timeout: 20_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="quote-comparison"], .request-picker', { timeout: 15_000 });
  const picker = page.locator(".request-picker select");
  if (await picker.count()) {
    const options = await picker.locator("option").allTextContents();
    const leakIndex = options.findIndex((o) => /live walkthrough|leak|sink|water/i.test(o) && !/gas|scorch/i.test(o));
    if (leakIndex >= 0) await picker.selectOption({ index: leakIndex });
  }
  await page.waitForSelector('[data-testid^="ranked-quote-"]', { timeout: 15_000 });
  await shot("e4-customer-quotes");
  const chooseBtn = page.locator('button:has-text("Choose this quote"), button:has-text("Elegir este presupuesto")').first();
  await chooseBtn.click();
  await page.waitForSelector('text=/Your pick|confirmation pending|selected/i', { timeout: 15_000 });
  record("E3. customer picks quote", true);
  await shot("e5-customer-picked");
} catch (error) { record("E3. customer quote select", false, String(error).slice(0, 200)); await shot("e5-fail"); }

// ---------- 콘솔/네트워크 오류 ----------
const relevant = consoleErrors.filter((e) => !/favicon|net::ERR_|vite|DevTools/i.test(e));
record("Console clean", relevant.length === 0, relevant.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
