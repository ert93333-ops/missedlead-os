/**
 * 정산 보류 E2E: 완료 후 72시간 내 preflight/정산이 거부되는지 확인.
 */
import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const request = { id: "req-settle", customerName: "Customer", description: "Completed kitchen repair", address: "Charlotte, NC", safetyStatus: "cleared", status: "completed", providerIds: ["demo-provider"], expandedSearch: false, createdAt: "2026-08-28T00:00:00.000Z" };
const job = { requestId: "req-settle", quoteId: "quote-1", depositCents: 2000, completedAt: "2026-09-01T00:00:00.000Z" };
const dashboard = () => ({ requests: [request], quotes: [], changes: [], jobs: [job], disputes: [], evidence: [], payments: [], audit: [] });

async function openOperator(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("demo-operator").click();
  await expect(page.getByTestId("operator-console")).toBeVisible();
}

test("72-hour hold rejects preflight and performs no settlement", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  let preflights = 0;
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === "/api/capabilities" && req.method() === "GET") return route.fulfill({ json: { payments: { enabled: true, provider: "stripe" } } });
    expect(req.headers().authorization).toMatch(/^Bearer demo\./);
    if (path === "/api/dashboard") return route.fulfill({ json: dashboard() });
    if (path === "/api/requests/req-settle/settlement-preflight" && req.method() === "POST") {
      preflights += 1; expect(req.postDataJSON()).toEqual({});
      return route.fulfill({ status: 409, json: { error: "dispute_window_open", guidance: "The 72-hour protection period has not ended yet." } });
    }
    if (path === "/api/ops/permits" && req.method() === "GET") return route.fulfill({ json: { permits: [] } });
    throw new Error(`Hold allowed forbidden API request: ${req.method()} ${path}`);
  });
  await openOperator(page);
  await page.getByRole("button", { name: "Run settlement" }).click();
  await expect(page.getByRole("status")).toContainText("72-hour protection period");
  expect(preflights).toBe(1);
});

test("exact 72-hour boundary authorizes one idempotent settlement", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  const authorization = { authorizationToken: "49d5a8e6-0173-4cad-8709-000000000001", authorizationVersion: 3, feeVersion: 1, feeRateBps: 1000, feeAmountCents: 1000, capturedAmountCents: 10000, transferAmountCents: 9000 };
  let phase = "boundary";
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === "/api/capabilities" && req.method() === "GET") return route.fulfill({ json: { payments: { enabled: true, provider: "stripe" } } });
    expect(req.headers().authorization).toMatch(/^Bearer demo\./);
    if (path === "/api/dashboard") return route.fulfill({ json: dashboard() });
    if (path === "/api/requests/req-settle/settlement-preflight" && req.method() === "POST") {
      expect(phase).toBe("boundary"); expect(req.postDataJSON()).toEqual({}); phase = "authorized";
      return route.fulfill({ json: authorization });
    }
    if (path === "/api/requests/req-settle/settle" && req.method() === "POST") {
      expect(phase).toBe("authorized");
      expect(req.postDataJSON()).toEqual(authorization);
      expect(req.headers()["idempotency-key"]).toBeTruthy();
      phase = "settled"; request.status = "settled"; Object.assign(job, { settledAt: "2026-09-04T00:00:00.000Z" });
      return route.fulfill({ status: 201, json: { state: "completed", transferAmountCents: 9000 } });
    }
    if (path === "/api/ops/permits" && req.method() === "GET") return route.fulfill({ json: { permits: [] } });
    throw new Error(`Unexpected settlement API request: ${req.method()} ${path}`);
  });
  await openOperator(page);
  await page.getByRole("button", { name: "Run settlement" }).click();
  await expect(page.getByRole("status")).toContainText("Settlement executed");
  await expect(page.getByRole("button", { name: "Run settlement" })).toHaveCount(0);
  expect(phase).toBe("settled");
  const path = resolve("artifacts", "e2e-settlement-exact-boundary.png");
  await page.screenshot({ path, fullPage: true });
  await test.info().attach("settlement-exact-boundary", { path, contentType: "image/png" });
});
