/**
 * 페르소나 UX 워크스루: dev 서버(5199)에 대해 고객·공급자·운영자의 실제 여정을
 * 상태ful API 목으로 시뮬레이션하고 단계별 스크린샷을 artifacts/ux/에 남긴다.
 * 실행: node scripts/ux-persona-review.mjs  (vite dev 서버가 5199에서 실행 중이어야 함)
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.UX_BASE_URL ?? "http://localhost:5199";
const OUT = "artifacts/ux";
mkdirSync(OUT, { recursive: true });

const blank = () => ({ requests: [], quotes: [], changes: [], jobs: [], disputes: [], evidence: [], payments: [], audit: [] });
const json = (route, body, status = 200) => route.fulfill({ status, json: body });
const shot = async (page, name) => { await page.evaluate(() => document.querySelector(".chat-log")?.scrollTo({ top: 999999, behavior: "instant" })).catch(() => {}); await page.waitForTimeout(150); return page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };

const NAV = { waitUntil: "domcontentloaded", timeout: 240_000 };

async function actor(page, role) {
  await page.goto("/", NAV);
  await page.getByTestId(`demo-${role}`).click();
  await page.waitForURL(new RegExp(`/${role}$`));
}

/* ---------- Persona 1: Maria, Charlotte homeowner, mobile ---------- */
async function customer(browser) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const dashboard = blank();
  let turn = 0;
  const request = { id: "req-maria", customerName: "Maria Reyes", description: "Water dripping under the kitchen sink", address: "1820 Euclid Ave, Charlotte, NC 28203", safetyStatus: "cleared", status: "matched", providerIds: ["p-1", "p-2", "p-3"], expandedSearch: false, workScopeSnapshot: { symptom: "Water dripping under the kitchen sink", location: "Kitchen sink cabinet", likelyIssues: ["Drain trap leak"], notes: "Cabinet floor shows water damage" }, createdAt: "2026-09-10T14:00:00.000Z" };
  const quotes = [
    { id: "q-1", requestId: "req-maria", providerName: "Queen City Plumbing", scope: "Replace drain trap and supply line; check disposal connection", amountCents: 14800, rankingScore: 91, rankingPolicyVersion: 3, ranking: { totalCents: 14800, earliestStartAt: "2026-09-11T13:00:00.000Z", warrantyDays: 365, licenseVerified: true, insuranceVerified: true, rating: 4.8, distanceMiles: 4, responseMinutes: 6, languages: ["English", "Spanish"] } },
    { id: "q-2", requestId: "req-maria", providerName: "Carolina Home Repair", scope: "Reseal trap; inspect for secondary leak", amountCents: 9500, rankingScore: 84, rankingPolicyVersion: 3, ranking: { totalCents: 9500, earliestStartAt: "2026-09-12T15:00:00.000Z", warrantyDays: 90, licenseVerified: true, insuranceVerified: true, rating: 4.2, distanceMiles: 11, responseMinutes: 45, languages: ["English"] } },
    { id: "q-3", requestId: "req-maria", providerName: "Mint Hill Handyman", scope: "Trap replacement only", amountCents: 7200, rankingScore: 79, rankingPolicyVersion: 3, ranking: { totalCents: 7200, earliestStartAt: "2026-09-14T12:00:00.000Z", warrantyDays: 30, licenseVerified: true, insuranceVerified: false, rating: 3.9, distanceMiles: 16, responseMinutes: 120, languages: ["English"] } },
  ];
  await page.route("**/api/**", (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === "/api/capabilities") return json(route, { payments: { enabled: false, provider: null } });
    if (path === "/api/dashboard") return json(route, { ...dashboard });
    if (path === "/api/intake/analyze") {
      turn += 1;
      if (turn === 1) return json(route, { reply: "Sorry about the leak. One safety check before we continue: do you smell gas or see any scorch marks near outlets?", locale: "en", issueCandidates: [], questions: [{ id: "safety-1", prompt: "Do you smell gas or see scorch marks near outlets?", requiredForSafety: true }], safety: { level: "normal", guidance: "" }, readyToConfirm: false, assessmentToken: "tok-1" });
      return json(route, { reply: "That is enough to prepare a provisional repair scope.", locale: "en", issueCandidates: [{ id: "trap-leak", label: "Drain trap leak", likelihood: "high", reason: "Dripping under the sink fits a loose trap connection.", evidenceNeeded: [] }, { id: "supply-line", label: "Worn supply line", likelihood: "medium", reason: "Steady drip can also come from a corroded supply line.", evidenceNeeded: [] }], questions: [], safety: { level: "normal", guidance: "" }, readyToConfirm: true, uncertaintyWarning: "A technician must inspect before the cause and final price are confirmed.", assessmentToken: "tok-2" });
    }
    if (path === "/api/intake/confirm") { dashboard.requests = [request]; dashboard.quotes = quotes; dashboard.messages = [{ id: "m-1", requestId: "req-maria", senderId: "ops-1", text: "Thanks Maria — three verified pros are reviewing your sink leak.", createdAt: "2026-09-10T15:02:00.000Z" }, { id: "m-2", requestId: "req-maria", senderId: "demo-customer", text: "Great, I picked Queen City Plumbing.", createdAt: "2026-09-10T15:20:00.000Z" }]; return json(route, { requestId: "req-maria", status: "intake", matchCount: 3 }, 201); }
    if (path === "/api/requests/req-maria/intake-media" && req.method() === "GET") return json(route, { media: [] });
    if (path === "/api/requests/req-maria/permit" && req.method() === "GET") return json(route, { permit: null });
    if (path === "/api/requests/req-maria/quote-details") return json(route, { details: [] });
    if (path === "/api/requests/req-maria/messages" && req.method() === "GET") return json(route, { messages: [] });
    return json(route, {});
  });

  await page.goto("/", NAV);
  await shot(page, "c1-auth-mobile");
  await page.getByTestId("demo-customer").click();
  await page.waitForURL(/\/customer$/);
  await shot(page, "c2-intake-empty");
  await page.getByLabel("Add photos, video, or audio").setInputFiles({ name: "sink.jpg", mimeType: "image/jpeg", buffer: Buffer.from([1, 2, 3]) });
  await shot(page, "c2b-media-consent");
  await page.getByText("I agree to secure AI processing", { exact: false }).click();
  await page.getByLabel("Describe the problem or answer the question").fill("Water is dripping under my kitchen sink and the cabinet floor is soaked.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("smell gas", { exact: false }).first().waitFor();
  await shot(page, "c3-safety-question");
  await page.getByLabel("Describe the problem or answer the question").fill("No gas smell, no burn marks. Just the leak.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Drain trap leak").first().waitFor();
  await shot(page, "c4-issue-candidates");
  await page.getByRole("heading", { name: "Review your repair request" }).waitFor();
  await page.getByLabel("Your name").fill("Maria Reyes");
  await page.getByLabel("Service address").fill("1820 Euclid Ave, Charlotte, NC 28203");
  await shot(page, "c5-confirm");
  await page.getByText("A technician must inspect", { exact: false }).last().click();
  await page.getByRole("button", { name: "Confirm and find technicians" }).click();
  await page.getByTestId("customer-workspace").waitFor();
  await page.waitForTimeout(600);
  await shot(page, "c6-dashboard-quotes");
  // Spanish pass on the same screen
  const es = page.getByRole("button", { name: "ES" });
  if (await es.count()) { await es.first().click(); await page.waitForTimeout(300); await shot(page, "c7-dashboard-es"); }
  await ctx.close();
}

/* ---------- Persona 2: Mike, field tech, mobile ---------- */
async function provider(browser) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const request = { id: "req-p1", customerName: "Dana Collins", description: "50-gallon water heater replacement", address: "212 Trade St, Charlotte, NC", safetyStatus: "cleared", status: "matched", providerIds: ["demo-provider"], expandedSearch: false, workScopeSnapshot: { symptom: "No hot water; unit 12 years old", location: "Garage" }, createdAt: "2026-09-01T00:00:00.000Z" };
  let permit = null;
  let sentQuote = null;
  await page.route("**/api/**", (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === "/api/capabilities") return json(route, { payments: { enabled: false, provider: null } });
    if (path === "/api/dashboard") return json(route, { ...blank(), requests: [request], quotes: sentQuote ? [sentQuote] : [], messages: [{ id: "m-1", requestId: "req-p1", senderId: "cust-dana", text: "The heater is in the garage — side door is unlocked.", createdAt: "2026-09-02T09:10:00.000Z" }, { id: "m-2", requestId: "req-p1", senderId: "demo-provider", text: "Got it, I can start Friday morning.", createdAt: "2026-09-02T09:25:00.000Z" }] });
    if (path === "/api/requests/req-p1/quote-details") return json(route, { details: [{ permit_required: true }] });
    if (path === "/api/requests/req-p1/permit" && req.method() === "GET") return json(route, { permit });
    if (path === "/api/requests/req-p1/permit" && req.method() === "PUT") { permit = { ...req.postDataJSON(), verified: false }; return json(route, { permit }); }
    if (path === "/api/requests/req-p1/intake-media" && req.method() === "GET") return json(route, { media: [] });
    if (path === "/api/providers/requests/req-p1/quote" && req.method() === "POST") { const body = req.postDataJSON(); sentQuote = { id: "q-p1", requestId: "req-p1", providerId: "demo-provider", providerName: "Mike Torres Plumbing", scope: body.scope, amountCents: body.totalCents, rankingScore: 90, rankingPolicyVersion: 3, ranking: { totalCents: body.totalCents, earliestStartAt: body.earliestStartAt, warrantyDays: body.warrantyDays, licenseVerified: true, insuranceVerified: true, rating: 4.7 } }; return json(route, { quote: sentQuote }, 201); }
    if (path === "/api/requests/req-p1/messages" && req.method() === "GET") return json(route, { messages: [] });
    return json(route, {});
  });

  await actor(page, "provider");
  await page.getByTestId("provider-inbox").waitFor();
  await shot(page, "p1-inbox");
  await page.getByLabel("Scope of work and exclusions").scrollIntoViewIfNeeded();
  await shot(page, "p2-quote-form-top");
  const when = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 16);
  await page.getByLabel("Scope of work and exclusions").fill("Replace 50-gal water heater, haul away old unit, new shutoff valve");
  await page.getByLabel("Diagnosis USD").fill("0");
  await page.getByLabel("Labor USD").fill("450");
  await page.getByLabel("Materials USD").fill("950");
  await page.getByLabel("Tax USD").fill("71.25");
  await page.getByLabel("Quote valid until").fill(when);
  await page.getByLabel("Earliest start").fill(when);
  await page.getByLabel("Warranty days").fill("365");
  await page.getByLabel("Permit required").check();
  await page.getByLabel("Permit number (if issued)").fill("CLT-1042");
  await shot(page, "p3-quote-form-filled");
  await page.getByRole("button", { name: "Submit quote" }).click();
  await page.getByRole("status").waitFor();
  await shot(page, "p4-permit-panel");
  await ctx.close();
}

/* ---------- Persona 3: Dana, operator, desktop ---------- */
async function operator(browser) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const dashboard = {
    ...blank(),
    requests: [
      { id: "req-p1", customerName: "Dana Collins", description: "50-gallon water heater replacement", address: "212 Trade St, Charlotte, NC", safetyStatus: "cleared", status: "quoted", providerIds: ["p-1"], expandedSearch: false, createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "req-maria", customerName: "Maria Reyes", description: "Water dripping under the kitchen sink", address: "1820 Euclid Ave, Charlotte, NC 28203", safetyStatus: "cleared", status: "in_progress", providerIds: ["p-2"], expandedSearch: false, createdAt: "2026-09-10T14:00:00.000Z" },
      { id: "req-gas", customerName: "Sam Ortiz", description: "Gas smell near the furnace", address: "77 Pecan Ave, Charlotte, NC", safetyStatus: "blocked", status: "intake", providerIds: [], expandedSearch: false, hazardReason: "Reported gas odor — emergency guidance issued", createdAt: "2026-09-12T09:00:00.000Z" },
    ],
    quotes: [{ id: "q-1", requestId: "req-p1", providerName: "Queen City Plumbing", scope: "Replace heater", amountCents: 147125, rankingScore: 91, rankingPolicyVersion: 3, ranking: { totalCents: 147125, earliestStartAt: "2026-09-15T13:00:00.000Z", warrantyDays: 365, licenseVerified: true, insuranceVerified: true, rating: 4.8, distanceMiles: 4, responseMinutes: 6, languages: ["English"] } }],
    jobs: [{ id: "job-1", requestId: "req-maria", quoteId: "q-1", status: "in_progress", scheduledAt: "2026-09-13T14:00:00.000Z" }],
    disputes: [{ id: "dis-1", requestId: "req-maria", status: "open", reason: "Customer says the leak returned after the visit" }],
    audit: [{ id: "a-1", action: "request.created", at: "2026-09-10T14:00:00.000Z" }, { id: "a-2", action: "quote.submitted", at: "2026-09-11T09:00:00.000Z" }, { id: "a-3", action: "dispute.opened", at: "2026-09-12T18:00:00.000Z" }],
  };
  const permits = [{ request_id: "req-p1", permit_number: "CLT-1042", inspection_status: "passed", verified: false, verification_reference: null, updated_at: "2026-09-13T12:00:00.000Z" }];
  await page.route("**/api/**", (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === "/api/capabilities") return json(route, { payments: { enabled: false, provider: null } });
    if (path === "/api/dashboard") return json(route, dashboard);
    if (path === "/api/ops/permits") return json(route, { permits });
    if (path === "/api/ops/recovery") return json(route, { claims: [{ claimId: "clm-1", kind: "chargeback" }], receivables: [{ id: "recv-1", amountCents: 4500, reason: "Unpaid balance after dispute" }] });
    if (path.startsWith("/api/requests/")) return json(route, {});
    return json(route, {});
  });

  await actor(page, "operator");
  await page.waitForTimeout(600);
  await shot(page, "o1-console");
  const permitQueue = page.getByTestId("permit-queue");
  if (await permitQueue.count()) await shot(page, "o2-permit-queue");
  const recovery = page.getByTestId("recovery-console");
  if (await recovery.count()) { await recovery.scrollIntoViewIfNeeded(); await shot(page, "o3-recovery"); }
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await customer(browser);
  await provider(browser);
  await operator(browser);
  console.log(`Persona walkthrough screenshots written to ${OUT}/`);
} finally {
  await browser.close();
}
