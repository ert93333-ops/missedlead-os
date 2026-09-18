/**
 * 페르소나 종합 E2E: 고객(test2) / 기사(test3) / 신규 기사(test4) / 운영자(test1).
 * Vite preview(http://localhost:5199) + API(9187) + 로컬 Supabase(56321)가 실행 중이어야 한다.
 *
 * 시드:
 *  - R_VISIT: access/pets/materialsHint가 들어간 매칭 요청 (기사 job-context + 고객 scope-summary 검증)
 *  - R_DECLINE: 기사가 거절할 요청
 *  - R_STALE: 48시간 경과 intake 요청 (운영자 SLA 플래그 검증)
 *  - test4: 미승인 기사 계정 (지원서→서류→운영자 승인 온보딩 루프)
 *
 * 실행: node scripts/persona-walkthrough.mjs
 */
import { chromium } from "@playwright/test";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";

config({ path: [".env.local", ".env"], quiet: true, override: true });

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:5199";
const OUT = "artifacts/persona";
mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  operator: "test1@demo.wecover.invalid",
  customer: "test2@demo.wecover.invalid",
  provider: "test3@demo.wecover.invalid",
  newProvider: "test4@demo.wecover.invalid",
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
page.on("response", (res) => {
  if (res.status() >= 400 && /respond|application|document|eligibility|match|messages|quote/.test(res.url()))
    res.text().then((body) => console.log(`  !! ${res.status()} ${res.url().slice(-60)} -> ${body.slice(0, 140)}`)).catch(() => {});
});
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
  await page.click('form button[type="submit"], form button:has-text("Sign in"), form >> button');
  await page.waitForSelector('[data-testid$="-workspace"], [data-testid="customer-intake"], [data-testid="operator-console"], [data-testid="provider-inbox"]', { timeout: 30_000 });
  await page.waitForSelector(".skeleton-stack", { state: "detached", timeout: 20_000 }).catch(() => {});
}

async function signOut() {
  const btn = page.locator('button:has-text("Sign out"), button:has-text("Cerrar sesión")');
  if (await btn.count()) await btn.first().click();
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
}

const pickRequest = async (pattern, timeout = 30_000) => {
  const picker = page.locator(".request-picker select");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await picker.count()) {
      const options = await picker.locator("option").allTextContents();
      const index = options.findIndex((text) => pattern.test(text));
      if (index >= 0) {
        await picker.selectOption({ index });
        await page.waitForTimeout(800);
        return true;
      }
    }
    await page.waitForTimeout(1000);
  }
  return false;
};

const waitForText = async (pattern, timeout = 30_000) => {
  try {
    await page.waitForSelector(`text=${pattern instanceof RegExp ? pattern : `/${pattern}/`}`, { timeout });
    return true;
  } catch {
    return false;
  }
};

// ---------- SETUP: 계정 조회 + test4 생성 + 시드 요청 ----------
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let ids = {};
try {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const [key, email] of Object.entries(ACCOUNTS)) ids[key] = data.users.find((u) => u.email === email)?.id ?? "";
  record("S0. account lookup", Boolean(ids.operator && ids.customer && ids.provider), "");
  if (!ids.newProvider) {
    const created = await admin.auth.admin.createUser({ email: ACCOUNTS.newProvider, password: PASSWORD, email_confirm: true, app_metadata: { role: "provider", demo: true }, user_metadata: { display_name: "New Provider Test" } });
    if (created.error) throw new Error(created.error.message);
    ids.newProvider = created.data.user.id;
  }
  const profile = await admin.from("profiles").upsert({ id: ids.newProvider, role: "provider", display_name: "New Provider Test", is_demo: true, provider_status: "pending", service_categories: ["plumbing"], service_areas: ["Charlotte"], license_verified: false, insurance_verified: false });
  if (profile.error) throw new Error(profile.error.message);
  // 재실행 시 온보딩 루프를 다시 검증할 수 있도록 이전 지원서/서류를 초기화
  await admin.from("provider_documents").delete().eq("provider_id", ids.newProvider);
  await admin.from("provider_applications").delete().eq("provider_id", ids.newProvider);
  record("S0b. new provider account", Boolean(ids.newProvider), ids.newProvider.slice(0, 8));
} catch (error) { record("S0. account setup", false, String(error).slice(0, 150)); }

const seedRequest = async (suffix, overrides = {}, matches = []) => {
  const marker = `persona-${suffix}`;
  const { data: existing } = await admin.from("service_requests").select("id").ilike("description", `%${marker}%`).limit(1);
  let requestId = existing?.[0]?.id;
  if (!requestId) {
    const inserted = await admin.from("service_requests").insert({
      customer_id: ids.customer,
      description: `${marker} — seeded request`,
      service_address: "101 Mint St, Charlotte, NC 28202",
      safety_status: "cleared",
      workflow_status: "matched",
      service_category: "plumbing",
      ...overrides,
    }).select("id").single();
    if (inserted.error) throw new Error(inserted.error.message);
    requestId = inserted.data.id;
  }
  for (const match of matches) {
    await admin.from("request_matches").upsert({ request_id: requestId, provider_id: match.providerId, rank: match.rank, status: match.status ?? "invited" }, { onConflict: "request_id,provider_id" });
  }
  return requestId;
};

let visitId = "", declineId = "", staleId = "";
try {
  visitId = await seedRequest("visit-context", {
    work_scope_snapshot: { symptom: "Kitchen sink drain leak", location: "Kitchen", access: "Gate code 4321 — call first", pets: "One friendly dog", materialsHint: ["P-trap kit", "bucket", "plumber's putty"] },
  }, [{ providerId: ids.provider, rank: 1 }]);
  declineId = await seedRequest("decline-case", {
    work_scope_snapshot: { symptom: "Bathroom faucet drip", location: "Bathroom" },
  }, [{ providerId: ids.provider, rank: 1 }]);
  staleId = await seedRequest("stale-sla", {
    workflow_status: "intake",
    created_at: new Date(Date.now() - 49 * 3_600_000).toISOString(),
    work_scope_snapshot: { symptom: "Water heater not heating", location: "Garage" },
  });
  record("S1. seeded requests", Boolean(visitId && declineId && staleId), "");
} catch (error) { record("S1. seeded requests", false, String(error).slice(0, 150)); }

// ---------- P. 기사 페르소나 ----------
try {
  await login(ACCOUNTS.provider);
  const found = await pickRequest(/persona-visit-context/i);
  record("P1. provider inbox lists matched request", found, "");
  if (found) {
    const entryLine = await page.locator(".job-context--visit").textContent().catch(() => "");
    const materialsLine = await page.locator(".job-context--materials").textContent().catch(() => "");
    record("P2. job context: entry + pets", /Gate code 4321/.test(entryLine ?? "") && /dog/i.test(entryLine ?? ""), (entryLine ?? "").slice(0, 80));
    record("P3. job context: materials hint", /P-trap kit/.test(materialsLine ?? ""), (materialsLine ?? "").slice(0, 80));
  }
  // 수락
  const acceptBtn = page.locator('[data-testid="match-actions"] button:has-text("Accept")');
  if (await acceptBtn.count()) {
    await acceptBtn.click();
    await page.waitForSelector('text=/Accepted — send your quote/i', { timeout: 15_000 }).catch(() => {});
  }
  const accepted = await page.locator('text=/Accepted — send your quote/i').count();
  const alreadyQuoted = await page.locator('[data-testid="provider-quote-sent"]').count();
  record("P4. accept request → viewed", accepted > 0 || alreadyQuoted > 0, `accepted=${accepted} quoted=${alreadyQuoted}`);
  // 견적 제출 (미제출 시)
  if (!alreadyQuoted) {
    if (await page.locator('textarea[name="scope"]').count()) {
      await page.fill('textarea[name="scope"]', "Replace P-trap and reseal drain joint. Excludes cabinet repair.");
      await page.fill('input[name="diagnostic"]', "49");
      await page.fill('input[name="labor"]', "120");
      await page.fill('input[name="materials"]', "35");
      await page.fill('input[name="tax"]', "12");
      await page.fill('input[name="validUntil"]', "2026-12-31T18:00");
      await page.fill('input[name="earliestStartAt"]', "2026-09-20T09:00");
      await page.fill('input[name="warrantyDays"]', "90");
      await page.click('button:has-text("Submit quote")');
      await page.locator('[data-testid="provider-quote-sent"]').waitFor({ timeout: 15_000 });
    }
  }
  record("P5. itemized quote submitted", await page.locator('[data-testid="provider-quote-sent"]').count() > 0, "");
  // 메시지
  await page.fill('[data-testid="provider-messages"] textarea[name="text"]', "I can come tomorrow morning — please keep the gate unlocked.");
  await page.click('[data-testid="provider-messages"] button:has-text("Send message")');
  record("P6. provider message sent", await waitForText(/gate unlocked/i, 30_000), "");
  // 거절 케이스
  const declineFound = await pickRequest(/persona-decline-case/i);
  if (declineFound) {
    const declineBtn = page.locator('[data-testid="match-actions"] button:has-text("Decline")');
    if (await declineBtn.count()) await declineBtn.click();
    let stillListed = true;
    for (let wait = 0; wait < 20 && stillListed; wait++) {
      await page.waitForTimeout(1000);
      const options = await page.locator(".request-picker select option").allTextContents();
      stillListed = options.some((text) => /persona-decline-case/i.test(text));
    }
    record("P7. declined request leaves inbox", !stillListed, "");
  } else {
    record("P7. declined request leaves inbox", false, "decline seed not in picker");
  }
  // 지원서 패널
  const appStatus = await page.locator('[data-testid="application-status"]').textContent().catch(() => "");
  record("P8. application panel shows status", /Approved|Under review|Rejected/i.test(appStatus ?? "") || await page.locator('[data-testid="provider-application"] input[name="organizationName"]').count() > 0, (appStatus ?? "form only").slice(0, 60));
  await shot("p-provider");
} catch (error) { record("P. provider persona", false, String(error).slice(0, 200)); await shot("p-fail"); }

// ---------- N. 신규 기사 온보딩 ----------
try {
  await signOut();
  await login(ACCOUNTS.newProvider);
  const panelVisible = await page.locator('[data-testid="provider-application"]').count();
  record("N1. application panel visible without assigned jobs", panelVisible > 0, "");
  const appForm = page.locator('[data-testid="provider-application"] form').first();
  if (await page.locator('[data-testid="provider-application"] input[name="organizationName"]').count()) {
    await page.fill('input[name="organizationName"]', "Mint Street Plumbing LLC");
    await page.fill('input[name="contactName"]', "Casey Rivers");
    await page.fill('input[name="contactEmail"]', "casey@mintstplumbing.example");
    await page.fill('input[name="contactPhone"]', "704-555-0142");
    await page.locator('input[name="categories"][value="plumbing"]').check();
    await page.fill('input[name="zipCodes"]', "28202, 28203");
    await page.locator('input[name="languages"][value="en"]').check();
    await page.fill('textarea[name="availability"]', "Weekdays 8am–6pm");
    await page.fill('input[name="diagnosticFee"]', "59");
    await page.fill('input[name="licenseNumber"]', "NC-PLB-88421");
    await page.fill('input[name="licenseExpiresAt"]', "2027-06-30T00:00");
    await page.fill('input[name="insuranceExpiresAt"]', "2027-06-30T00:00");
    await appForm.locator('button[type="submit"], button:has-text("Submit application"), button:has-text("Update application")').first().click();
    await page.waitForSelector('[data-testid="application-status"]', { timeout: 15_000 }).catch(() => {});
  }
  const statusText = await page.locator('[data-testid="application-status"]').textContent().catch(() => "");
  record("N2. application submitted → under review", /Under review/i.test(statusText ?? ""), (statusText ?? "").slice(0, 90));
  // 서류 업로드 (license, coi, w9)
  const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  const docForm = page.locator('[data-testid="provider-application"] .document-upload');
  if (await docForm.count()) {
    for (const kind of ["license", "coi", "w9"]) {
      await docForm.locator('select[name="kind"]').selectOption(kind);
      await docForm.locator('input[name="file"]').setInputFiles({ name: `${kind}.pdf`, mimeType: "application/pdf", buffer: pdfBuffer });
      await docForm.locator('button:has-text("Upload document")').click();
      await page.waitForSelector(`text=${kind}.pdf`, { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  const docList = await page.locator('[data-testid="provider-application"] .document-upload .row').allTextContents();
  record("N3. three documents uploaded", ["license", "coi", "w9"].every((kind) => docList.some((row) => row.includes(kind))), docList.join(" | ").slice(0, 100));
  await shot("n-onboarding");
} catch (error) { record("N. provider onboarding", false, String(error).slice(0, 200)); await shot("n-fail"); }

// ---------- O. 운영자 페르소나 ----------
try {
  await signOut();
  await login(ACCOUNTS.operator);
  // SLA 메트릭 + 플래그
  const slaMetric = await page.locator('.metric--alert, .metrics div:has-text("SLA")').allTextContents();
  record("O1. SLA metric present", /SLA/.test(slaMetric.join(" ")), slaMetric.join(" | ").slice(0, 80));
  const staleFound = await pickRequest(/persona-stale-sla/i);
  const staleOption = (await page.locator(".request-picker select option").allTextContents()).find((text) => /persona-stale-sla/i.test(text)) ?? "";
  record("O2. stale request flagged in picker", staleFound && /⚠|SLA/.test(staleOption), staleOption.slice(0, 80));
  const slaWarning = await page.locator('[data-testid="sla-warning"]').count();
  record("O3. stale warning shown for selection", slaWarning > 0, "");
  // 지원서 심사 → test4 승인
  const queue = page.locator('[data-testid="application-queue"]');
  const mintRow = queue.locator('.application-row:has-text("Mint Street Plumbing")');
  record("O4. application queue lists new provider", await mintRow.count() > 0, "");
  if (await mintRow.count()) {
    await mintRow.locator('button:has-text("Review")').click();
    await page.waitForSelector('[data-testid="application-detail"]', { timeout: 10_000 });
    const detail = await page.locator('[data-testid="application-detail"]').textContent().catch(() => "");
    const docButtons = await page.locator('[data-testid="application-detail"] .document-link').count();
    record("O5. application detail + documents visible", /NC-PLB-88421/.test(detail ?? "") && docButtons >= 3, `docs=${docButtons}`);
    const statusText = await mintRow.textContent();
    if (/pending/i.test(statusText ?? "")) {
      const reviewForm = page.locator('[data-testid="application-detail"] form');
      await reviewForm.locator('select[name="decision"]').selectOption("approved");
      await reviewForm.locator('input[name="reference"]').fill("NC licensing board lookup #88421 — verified");
      await reviewForm.locator('input[name="reason"]').fill("License and insurance verified against state registry");
      await reviewForm.locator('button:has-text("Save review")').click();
      await page.waitForTimeout(2500);
    }
    const updated = await admin.from("profiles").select("provider_status,license_verified,insurance_verified").eq("id", ids.newProvider).single();
    record("O6. approve → provider activated", updated.data?.provider_status === "approved" && updated.data?.license_verified === true, JSON.stringify(updated.data ?? updated.error).slice(0, 100));
  } else {
    record("O5. application detail + documents visible", false, "row missing");
    record("O6. approve → provider activated", false, "row missing");
  }
  // 자격 폼 — approved 옵션 제거 회귀
  const statusOptions = await page.locator('[data-testid="provider-eligibility"] select[name="status"] option').allTextContents();
  record("O7. eligibility form excludes approved", !statusOptions.some((text) => /approved/i.test(text)), statusOptions.join(","));
  // 정체 요청 매칭 (stale 요청에 기사 매칭)
  if (staleFound) {
    await page.fill('input[name="provider1"]', ids.provider);
    await page.fill('input[name="provider2"]', "");
    await page.fill('input[name="provider3"]', "");
    const matchResponse = page.waitForResponse((res) => res.url().includes("/match"), { timeout: 15_000 }).catch(() => null);
    await page.click('button:has-text("Match providers")');
    const matchRes = await matchResponse;
    const ok = (matchRes?.status() ?? 0) < 400 || /409/.test(String(matchRes?.status() ?? ""));
    record("O8. operator match on stale request", ok, `http=${matchRes?.status() ?? "already matched"}`);
  }
  await shot("o-operator");
} catch (error) { record("O. operator persona", false, String(error).slice(0, 200)); await shot("o-fail"); }

// ---------- C. 고객 페르소나 ----------
try {
  await signOut();
  await login(ACCOUNTS.customer);
  let found = await pickRequest(/persona-visit-context/i);
  if (!found) {
    // 대시보드 로드 실패(일시적 hang/에러) 시 한 번 새로고침 후 재시도
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid$="-workspace"]', { timeout: 30_000 });
    await page.waitForSelector(".skeleton-stack", { state: "detached", timeout: 40_000 }).catch(() => {});
    found = await pickRequest(/persona-visit-context/i);
  }
  record("C1. customer dashboard lists request", found, "");
  if (found) {
    const scopeText = await page.locator('[data-testid="chat-scope-summary"]').textContent().catch(() => "");
    record("C2. scope summary shows visit + materials", /Gate code 4321/.test(scopeText ?? "") && /dog/i.test(scopeText ?? "") && /P-trap kit/.test(scopeText ?? ""), (scopeText ?? "").slice(0, 120));
  }
  // 견적 카드 + 선택
  const quoteCard = page.locator('[data-testid^="ranked-quote-"]').first();
  if (await quoteCard.count()) {
    const cardText = await quoteCard.textContent().catch(() => "");
    record("C3. quote card shows ranking facts", /score|Response|Warranty/i.test(cardText ?? ""), (cardText ?? "").slice(0, 100));
    const chosen = page.locator('[data-testid="quote-chosen"]');
    if (!(await chosen.count())) {
      const chooseBtn = page.locator('button:has-text("Choose this quote"), button:has-text("Elegir este presupuesto")').first();
      if (await chooseBtn.count()) await chooseBtn.click();
    }
    await page.waitForSelector('[data-testid="quote-chosen"]', { timeout: 15_000 }).catch(() => {});
    record("C4. choose quote → selection persists", await page.locator('[data-testid="quote-chosen"]').count() > 0, "");
  } else {
    record("C3. quote card shows ranking facts", false, "no quotes on visit request");
    record("C4. choose quote → selection persists", false, "no quotes");
  }
  // 메시지 스레드: 기사 메시지가 보이고 고객이 답장
  const threadVisible = await waitForText(/gate unlocked/i, 20_000);
  record("C5. provider message visible to customer", threadVisible, "");
  const customerMsg = page.locator('[data-testid="coordination"] textarea[name="text"]');
  if (await customerMsg.count()) {
    await customerMsg.fill("Gate is unlocked — see you at 9am.");
    await page.click('[data-testid="coordination"] button:has-text("Send message")');
    record("C6. customer reply sent", await waitForText(/see you at 9am/i, 30_000), "");
  } else {
    record("C6. customer reply sent", false, "no message form");
  }
  // 다음 단계 힌트 + 스테퍼
  record("C7. progress stepper renders", await page.locator(".stepper li").count() >= 6, "");
  await shot("c-customer");
} catch (error) { record("C. customer persona", false, String(error).slice(0, 200)); await shot("c-fail"); }

// ---------- 콘솔/네트워크 오류 ----------
const relevant = consoleErrors.filter((e) => !/favicon|net::ERR_|vite|DevTools|Download the React|409 \(Conflict\)/i.test(e));
record("Console clean", relevant.length === 0, relevant.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
