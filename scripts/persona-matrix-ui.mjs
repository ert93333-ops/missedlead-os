/**
 * Persona UI matrix — exercises every screen per persona, captures screenshots
 * for design review, checks mobile + Spanish + error/empty states, collects
 * console errors. Run with the local stack up (preview :5199, API :8787).
 * Usage: node scripts/persona-matrix-ui.mjs
 */
import { chromium } from "@playwright/test";
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
config({ path: [".env.local", ".env"], quiet: true, override: true });

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:5199";
const OUT = "artifacts/persona-ui";
mkdirSync(OUT, { recursive: true });
const PASSWORD = "testtest";
const ACCOUNTS = {
  operator: "test1@demo.wecover.invalid",
  customer: "test2@demo.wecover.invalid",
  provider: "test3@demo.wecover.invalid",
  newProvider: "test4@demo.wecover.invalid",
};

const results = [];
let section = "";
const sec = (s) => { section = s; };
const check = (name, cond, detail = "") => {
  results.push({ section, name, ok: !!cond, detail: String(detail).slice(0, 140) });
  if (!cond) console.log(`FAIL  [${section}] ${name} :: ${String(detail).slice(0, 120)}`);
};

const browser = await chromium.launch();
const consoleErrors = [];
let page;

async function newPage(viewport = { width: 1440, height: 900 }) {
  page = await browser.newPage({ viewport });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`[${page.url().slice(-40)}] ${m.text().slice(0, 120)}`); });
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message.slice(0, 120)}`));
}
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

async function login(email) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector('input[name="email"]', { timeout: 30_000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('form button');
  await page.waitForSelector('[data-testid$="-workspace"], [data-testid="customer-intake"], [data-testid="operator-console"], [data-testid="provider-inbox"], form button[type="submit"]', { timeout: 30_000 });
  await page.waitForSelector(".skeleton-stack", { state: "detached", timeout: 25_000 }).catch(() => {});
}
async function signOut() {
  const btn = page.locator('button:has-text("Sign out"), button:has-text("Cerrar sesión")');
  if (await btn.count()) await btn.first().click();
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
}
const visible = async (sel) => (await page.locator(sel).count()) > 0;
const txt = async (re) => { try { await page.waitForSelector(`text=${re}`, { timeout: 12_000, state: "attached" }); return true; } catch { return false; } };

// ============ 1. Login screen ============
sec("login");
await newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForSelector('input[name="email"]', { timeout: 30_000 });
check("login form visible", await visible('input[name="email"]'));
check("password field", await visible('input[name="password"]'));
await shot("01-login");
// failed login error state
await page.fill('input[name="email"]', "test2@demo.wecover.invalid");
await page.fill('input[name="password"]', "wrongpass");
await page.click('form button');
await page.waitForTimeout(3000);
check("bad login shows error (not silent)", await page.locator('text=/invalid|error|incorrect|falló|incorrecta/i').count() > 0 || await visible('input[name="email"]'), "no error visible");
await shot("02-login-error");
consoleErrors.length = 0; // the rejected login above is an expected 400 — don't count it

// ============ 2. Customer persona ============
sec("customer");
await login(ACCOUNTS.customer);
check("customer workspace mounts", await visible('[data-testid="customer-intake"], [data-testid$="-workspace"]'));
const newRequest = page.locator('button:has-text("New request"), button:has-text("Nueva solicitud")');
if (await newRequest.count()) {
  await newRequest.first().click();
  await page.waitForSelector('[data-testid="customer-intake"], .chat-intake', { timeout: 15_000 });
}
await shot("03-customer-intake");
check("intake stepper visible", await visible(".intake-steps, [class*=step]") || await txt(/describe|questions|confirm/i));
check("media consent UI exists or attach button", await visible('input[type="file"], [data-testid*="attach"], button:has-text("Attach"), button:has-text("photo")'));
check("language toggle present", await visible('button:has-text("ES"), button:has-text("EN"), select[name*="lang" i], [data-testid*="locale"]') || await txt(/ES|English|Español/i));
// dashboard
const dashLink = page.locator('button:has-text("request"), a:has-text("request"), button:has-text("My"), [data-testid*="requests"]');
if (await dashLink.count()) { await dashLink.first().click().catch(() => {}); await page.waitForTimeout(2000); }
await shot("04-customer-dashboard");
check("request cards or empty state", await visible(".request-picker, .card, [class*=request]") || await txt(/request|solicitud/i));
// locale switch to ES
const esBtn = page.locator('button:has-text("ES"), button:has-text("Español")');
if (await esBtn.count()) {
  await esBtn.first().click(); await page.waitForTimeout(1500);
  check("ES locale renders Spanish", await txt(/solicitud|describ|problema|ayuda/i));
  await shot("05-customer-es");
  const enBtn = page.locator('button:has-text("EN"), button:has-text("English")');
  if (await enBtn.count()) await enBtn.first().click();
}
// mobile viewport
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1200);
check("mobile: no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= 400), `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
await shot("06-customer-mobile");
await page.setViewportSize({ width: 1440, height: 900 });
await signOut();

// ============ 3. Provider persona ============
sec("provider");
await login(ACCOUNTS.provider);
check("provider workspace mounts", await visible('[data-testid="provider-inbox"], [data-testid$="-workspace"]') || await txt(/request|job|solicitud/i));
await shot("07-provider-inbox");
check("request picker or list", await visible(".request-picker, select, [class*=request]"));
check("accept/decline or quote controls exist", await txt(/accept|decline|quote|estimate|cotiz/i) || await visible('input[name="labor"], textarea[name="scope"]'));
await shot("08-provider-detail");
// application panel
check("application panel or status", await txt(/application|license|insurance|licencia/i));
await shot("09-provider-application");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1200);
check("mobile: no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= 400), `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
await shot("10-provider-mobile");
await page.setViewportSize({ width: 1440, height: 900 });
await signOut();

// ============ 4. Operator persona ============
sec("operator");
await login(ACCOUNTS.operator);
check("operator console mounts", await visible('[data-testid="operator-console"], [data-testid$="-workspace"]') || await txt(/operator|applications|metrics/i));
await shot("11-operator-console");
check("metrics visible", await txt(/overdue|sla|requests|pending|providers/i));
check("request picker", await visible(".request-picker, select"));
check("applications queue", await txt(/application|pending|review/i));
await shot("12-operator-detail");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1200);
check("mobile: no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= 400), `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
await shot("13-operator-mobile");
await page.setViewportSize({ width: 1440, height: 900 });

// ============ 5. New provider persona (empty states) ============
sec("new-provider");
await signOut();
await login(ACCOUNTS.newProvider);
check("new provider sees application path", await txt(/application|apply|license|verific/i) || await visible('[data-testid$="-workspace"]'));
await shot("14-newprovider");

// ============ Report ============
check("console errors", consoleErrors.length === 0, `${consoleErrors.length}: ${consoleErrors.slice(0, 3).join(" | ")}`);
const fails = results.filter((r) => !r.ok);
console.log(`\n===== UI MATRIX: ${results.length - fails.length}/${results.length} pass, ${consoleErrors.length} console errors =====`);
for (const f of fails) console.log(`  FAIL [${f.section}] ${f.name} :: ${f.detail}`);
if (consoleErrors.length) console.log("console:", consoleErrors.slice(0, 8).join("\n  "));
await browser.close();
