/**
 * 허가 플로우 E2E: 공급자의 허가 포함 견적·기록, 고객 읽기전용 표시, 운영자 검증 큐.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const blank = () => ({ requests: [] as Record<string, unknown>[], quotes: [] as Record<string, unknown>[], changes: [] as Record<string, unknown>[], jobs: [] as Record<string, unknown>[], disputes: [] as Record<string, unknown>[], evidence: [] as Record<string, unknown>[], payments: [] as Record<string, unknown>[], audit: [] as Record<string, unknown>[] });

async function actor(page: Page, role: "customer" | "provider" | "operator") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("demo-actor-selector")).toBeVisible();
  await page.getByTestId(`demo-${role}`).click();
  await expect(page).toHaveURL(new RegExp(`/${role}$`));
}

test("provider submits an itemized permit-required quote and records the county permit", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  const request = { id: "req-p1", customerName: "Customer", description: "Water heater replacement", address: "212 Trade St, Charlotte, NC", safetyStatus: "cleared", status: "matched", providerIds: ["demo-provider"], expandedSearch: false, createdAt: "2026-09-01T00:00:00.000Z" };
  let permit: Record<string, unknown> | null = null;
  let submittedQuote: Record<string, unknown> | null = null;
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/capabilities" && req.method() === "GET") return json({ payments: { enabled: false, provider: null } });
    expect(req.headers().authorization).toMatch(/^Bearer demo\./);
    if (path === "/api/dashboard" && req.method() === "GET") return json({ ...blank(), requests: [request] });
    if (path === "/api/requests/req-p1/quote-details" && req.method() === "GET") return json({ details: [{ permit_required: true }] });
    if (path === "/api/requests/req-p1/permit" && req.method() === "GET") return json({ permit });
    if (path === "/api/requests/req-p1/permit" && req.method() === "PUT") {
      expect(req.postDataJSON()).toEqual({ permitNumber: "CLT-1042", inspectionStatus: "passed" });
      permit = { request_id: "req-p1", permit_number: "CLT-1042", inspection_status: "passed", verified: false, verification_reference: null, updated_at: "2026-09-13T12:00:00.000Z" };
      return json({ permit });
    }
    if (path === "/api/requests/req-p1/intake-media" && req.method() === "GET") return json({ media: [] });
    if (path === "/api/providers/application" && req.method() === "GET") return json({ application: null, documents: [] });
    if (path === "/api/providers/requests/req-p1/quote" && req.method() === "POST") {
      submittedQuote = req.postDataJSON();
      return json({ quote: { id: "quote-p1", requestId: "req-p1" } }, 201);
    }
    throw new Error(`Unexpected API request: ${req.method()} ${path}`);
  });

  await actor(page, "provider");
  await expect(page.getByTestId("provider-inbox")).toBeVisible();
  const quoteStart = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 16);
  await page.getByLabel("Scope of work and exclusions").fill("Replace 50-gallon water heater, haul away old unit");
  await page.getByLabel("Diagnosis USD").fill("0");
  await page.getByLabel("Labor USD").fill("450");
  await page.getByLabel("Materials USD").fill("950");
  await page.getByLabel("Tax USD").fill("71.25");
  await page.getByLabel("Quote valid until").fill(quoteStart);
  await page.getByLabel("Earliest start").fill(quoteStart);
  await page.getByLabel("Warranty days").fill("365");
  await page.getByLabel("Permit required").check();
  await page.getByLabel("Permit number (if issued)").fill("CLT-1042");
  await page.getByRole("button", { name: "Submit quote" }).click();
  await expect(page.getByRole("status")).toContainText("sent to the customer");
  expect(submittedQuote).toMatchObject({ permitRequired: true, permitNumber: "CLT-1042", inspectionStatus: "pending", laborCents: 45000, materialsCents: 95000, taxCents: 7125, totalCents: 147125, warrantyDays: 365 });

  const panel = page.getByTestId("permit-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("requires a permit");
  await panel.getByLabel("Permit number", { exact: true }).fill("CLT-1042");
  await panel.getByLabel("Inspection status").selectOption("passed");
  await panel.getByRole("button", { name: "Save permit record" }).click();
  await expect(page.getByRole("status")).toContainText("Permit recorded");
  await expect(panel).toContainText("Permit CLT-1042 · Inspection passed · Awaiting operations verification");
});

test("customer sees read-only county permit status on the request", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  const request = { id: "req-c1", customerName: "Charlotte Customer", description: "Water heater replacement", address: "212 Trade St, Charlotte, NC", safetyStatus: "cleared", status: "in_progress", providerIds: ["demo-provider"], expandedSearch: false, workScopeSnapshot: { symptom: "No hot water", location: "Garage" }, createdAt: "2026-09-01T00:00:00.000Z" };
  const permit = { request_id: "req-c1", permit_number: "CLT-55", inspection_status: "pending", verified: false, verification_reference: null, updated_at: "2026-09-13T12:00:00.000Z" };
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/api/capabilities" && req.method() === "GET") return json({ payments: { enabled: false, provider: null } });
    expect(req.headers().authorization).toMatch(/^Bearer demo\./);
    if (path === "/api/dashboard" && req.method() === "GET") return json({ ...blank(), requests: [request] });
    if (path === "/api/requests/req-c1/quote-details" && req.method() === "GET") return json({ details: [{ permit_required: true }] });
    if (path === "/api/requests/req-c1/permit" && req.method() === "GET") return json({ permit });
    if (path === "/api/requests/req-c1/intake-media" && req.method() === "GET") return json({ media: [] });
    throw new Error(`Unexpected API request: ${req.method()} ${path}`);
  });

  await actor(page, "customer");
  const panel = page.getByTestId("permit-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Permit CLT-55 · Inspection pending · Awaiting operations verification");
  await expect(panel.getByRole("button", { name: "Save permit record" })).toHaveCount(0);
});

test("operator verifies a permit record from the queue with a verification reference", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  const permit = { request_id: "req-9", permit_number: "CLT-88", inspection_status: "pending", verified: false, verification_reference: null, updated_at: "2026-09-13T12:00:00.000Z", service_requests: { description: "Water heater replacement", address: "212 Trade St, Charlotte, NC" } };
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/api/capabilities" && req.method() === "GET") return json({ payments: { enabled: false, provider: null } });
    expect(req.headers().authorization).toMatch(/^Bearer demo\./);
    if (path === "/api/dashboard" && req.method() === "GET") return json(blank());
    if (path === "/api/ops/permits" && req.method() === "GET") return json({ permits: [permit] });
    if (path === "/api/providers/applications" && req.method() === "GET") return json({ applications: [] });
    if (path === "/api/ops/recovery" && req.method() === "GET") return json({ claims: [], receivables: [] });
    if (path === "/api/requests/req-9/permit" && req.method() === "PUT") {
      const body = req.postDataJSON() as { permitNumber: string; inspectionStatus: string; verificationReference: string };
      expect(body).toEqual({ permitNumber: "CLT-88", inspectionStatus: "pending", verificationReference: "county lookup A-1042" });
      permit.verified = true; permit.verification_reference = body.verificationReference;
      return json({ permit });
    }
    throw new Error(`Unexpected API request: ${req.method()} ${path}`);
  });

  await actor(page, "operator");
  const queue = page.getByTestId("permit-queue");
  await expect(queue).toBeVisible();
  await expect(queue).toContainText("Water heater replacement");
  await expect(queue).toContainText("CLT-88 · pending · unverified");
  await queue.getByLabel("Verification reference").fill("county lookup A-1042");
  await queue.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("Permit verification saved");
  await expect(queue).toContainText("CLT-88 · pending · verified");
});
