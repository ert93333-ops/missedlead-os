// 라이브 멀티모달 브라우저 테스트: 생성 사진을 실제 intake 파일 입력으로 업로드하고
// AI 인식 → 확정 → 미디어 영속성(대시보드 갤러리)까지 검증한다.
// Vite(5199) + API(9187) + 로컬 Supabase가 실행 중이어야 한다.
//
// 실행: node scripts/media-browser-test.mjs
import { chromium } from "@playwright/test";
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

config({ path: [".env.local", ".env"], quiet: true, override: true });

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:5199";
const OUT = "artifacts/live-media";
mkdirSync(OUT, { recursive: true });

const CUSTOMER = "test2@demo.wecover.invalid";
const PASSWORD = "testtest";
const PHOTO = resolve("artifacts/test-media/leak-under-sink.jpg");

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
const analyzeBodies = [];
const mediaUploads = [];
page.on("response", (res) => {
  if (res.url().includes("/api/intake/analyze"))
    res.json().then((b) => analyzeBodies.push(b)).catch(() => {});
  if (res.url().match(/\/api\/requests\/[^/]+\/intake-media/) && res.request().method() === "POST")
    mediaUploads.push(res.status());
});

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

async function login(email) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.evaluate(() => { try { window.localStorage?.clear(); window.sessionStorage?.clear(); } catch {} });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector('input[name="email"]', { timeout: 30_000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('form button[type="submit"], form button.primary');
  await page.waitForSelector('[data-testid$="-workspace"], [data-testid="customer-intake"]', { timeout: 30_000 });
}

const ensureIntake = async () => {
  await page.waitForSelector(".skeleton-stack", { state: "detached", timeout: 20_000 }).catch(() => {});
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await page.locator("#intake-message").count()) return;
    const btn = page.locator('button:has-text("New request"), button:has-text("Nueva solicitud"), .tabbar button:has-text("New repair"), .tabbar button:has-text("Nueva")').first();
    if (!(await btn.count())) { await page.waitForTimeout(2500); continue; }
    await btn.click();
    await page.waitForSelector("#intake-message", { timeout: 15_000 }).catch(() => {});
  }
};

async function driveIntake({ maxRounds = 16 } = {}) {
  let retries = 0;
  let reattached = 0;
  for (let round = 0; round < maxRounds; round++) {
    await page.waitForTimeout(500);
    await page.waitForSelector(".chat-message--thinking", { state: "detached", timeout: 90_000 }).catch(() => {});
    if (await page.locator(".chat-message--thinking").count()) { console.log(`  round ${round}: thinking hung — reloading`); await page.reload({ waitUntil: "domcontentloaded" }); await ensureIntake(); continue; }
    // 리로드 후 첨부파일은 프라이버시상 복원 안 됨 — 재첨부 요구 시 재첨부 (설계된 동작)
    if (await page.locator(".reattach-notice").count()) {
      if (reattached >= 2) return "reattach-loop";
      reattached++;
      console.log(`  round ${round}: re-attaching photo (reattach notice)`);
      await page.setInputFiles(".attachment-button input[type=file]", PHOTO);
      await page.waitForSelector(".attachment-tray .attachment", { timeout: 10_000 });
      await page.locator(".media-consent input[type=checkbox]").check();
      continue;
    }
    const retryBtn = page.locator(".chat-error button");
    if (await retryBtn.count() && retries < 8) { retries++; console.log(`  round ${round}: error shown — retry in 75s`); await page.waitForTimeout(75_000); await retryBtn.first().click(); continue; }
    if (await page.locator(".safety-guidance--emergency, [data-testid='blocked-request']").count()) return "blocked";
    if (await page.locator('h2:has-text("Review your repair request"), h2:has-text("Revise su solicitud")').count()) return "confirm";
    const questionCard = page.locator(".followup-questions article");
    if (await questionCard.count()) {
      const prompt = (await questionCard.locator("p").first().textContent().catch(() => "")) ?? "";
      console.log(`  round ${round}: question — ${prompt.slice(0, 80)}`);
      const answer = /electr|wir|outlet|disposal|spark/i.test(prompt) ? "No electrical outlets or wiring near the wet area."
        : /gas|smell|odor/i.test(prompt) ? "No gas smell anywhere in the house."
        : /shut ?off|valve|stop/i.test(prompt) ? "Yes, I shut off the valve under the sink."
        : /when|how long|started/i.test(prompt) ? "It started yesterday evening and is getting worse."
        : /drain|tap|faucet|run|continuous|only/i.test(prompt) ? "It drips continuously, even when the faucet is off."
        : "It started yesterday and is getting worse. No other issues.";
      await page.fill("#intake-message", answer);
      await page.locator("button.send-button").click({ timeout: 10_000 });
      continue;
    }
    if (await page.locator(".chat-error").count()) return "error";
    console.log(`  round ${round}: no card — nudging`);
    await page.fill("#intake-message", "Please proceed with what you have so far.");
    await page.locator("button.send-button").click({ timeout: 10_000 });
  }
  return "stuck";
}

try {
  await login(CUSTOMER);
  await ensureIntake();
  record("M1. login + intake mount", await page.locator("#intake-message").count() > 0);

  // 사진 첨부 — 컴포저의 페이퍼클립 파일 입력
  await page.setInputFiles(".attachment-button input[type=file]", PHOTO);
  await page.waitForSelector(".attachment-tray .attachment", { timeout: 10_000 });
  const trayText = await page.locator(".attachment-tray").textContent();
  record("M2. attachment tray shows photo", /leak-under-sink\.jpg/.test(trayText ?? ""), trayText?.slice(0, 80));

  // 동의 전 send 비활성 → 동의 후 활성
  const sendBtn = page.locator("button.send-button");
  await page.fill("#intake-message", "I found water pooling under my kitchen sink — photo attached.");
  const disabledBeforeConsent = await sendBtn.isDisabled();
  await page.locator(".media-consent input[type=checkbox]").check();
  const enabledAfterConsent = await sendBtn.isEnabled();
  record("M3. media consent gates send", disabledBeforeConsent && enabledAfterConsent, `before=${disabledBeforeConsent} after=${enabledAfterConsent}`);
  await shot("m1-attached");

  await sendBtn.click();
  const outcome = await driveIntake();
  record("M4. photo intake reaches confirm", outcome === "confirm", outcome);
  await shot("m2-before-confirm");

  // AI가 사진 내용을 실제로 반영했는지 — assessment에 누수/배관 언급 + evidenceQuality 확인
  const last = analyzeBodies.at(-1) ?? {};
  const hay = JSON.stringify(last);
  const sawLeak = /leak|water|drain|trap|pipe|pool/i.test(hay) && /plumb/i.test(last.category ?? "");
  const quality = last.evidenceQuality ?? "(unset)";
  record("M5. AI read the photo", sawLeak, `category=${last.category} evidence=${quality} candidates=${(last.issueCandidates ?? []).map((c) => c.label).join(" | ").slice(0, 120)}`);

  if (outcome === "confirm") {
    await page.fill('input[name="customerName"]', "Jordan Lee");
    await page.fill('input[name="address"]', "101 Mint St, Charlotte, NC 28202");
    const firstIssue = page.locator('.confirm-request fieldset input[type="checkbox"]').first();
    if (await firstIssue.count() && !(await firstIssue.isChecked())) await firstIssue.check();
    await page.locator('.confirm-request__ack input[type="checkbox"]').check();
    await page.click('button.confirm-request__submit');
    await page.waitForSelector('[data-testid="chat-scope-summary"], [data-testid="quote-comparison"], .request-picker, .panel', { timeout: 90_000 });
    // 미디어 업로드는 확정 응답 이후 진행될 수 있으므로 짧게 추가 대기
    for (let i = 0; i < 30 && mediaUploads.length === 0; i++) await page.waitForTimeout(1000);
    const uploadOk = (s) => s >= 200 && s < 300;
    record("M6. media uploaded on confirm", mediaUploads.some(uploadOk), `status=${mediaUploads.join(",") || "none"}`);

    // 대시보드 갤러리에서 첨부 이미지 영속성 확인
    await page.waitForSelector('[data-testid="intake-media-gallery"] figure img, [data-testid="intake-media-gallery"] img', { timeout: 20_000 }).catch(() => {});
    const thumbs = await page.locator('[data-testid="intake-media-gallery"] img').count();
    record("M7. dashboard shows attached media", thumbs > 0, `thumbnails=${thumbs}`);
    await shot("m3-dashboard-media");
  }
} catch (error) {
  record("M. media browser flow", false, String(error).slice(0, 200));
  await shot("m-fail");
}

const relevant = consoleErrors.filter((e) => !/favicon|net::ERR_|vite|DevTools/i.test(e));
record("Console clean", relevant.length === 0, relevant.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
