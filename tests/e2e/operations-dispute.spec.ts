/**
 * 운영자 분쟁 해결 E2E: 증빙 기반 분쟁 처리, 환불, 불변 감사 이벤트 확인.
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("operator resolves evidence-backed dispute, refunds, and sees immutable audit events", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  const request = { id: "req-ops", customerName: "Customer", description: "Repair disputed after completion", address: "Charlotte, NC", safetyStatus: "cleared", status: "completed", providerIds: ["demo-provider"], expandedSearch: false, createdAt: "2026-09-01T00:00:00.000Z" };
  const dispute = { id: "dispute-1", requestId: "req-ops", source: "internal", reason: "After photo shows a persistent leak", status: "open" };
  const audit = [
    { id: "audit-1", action: "evidence.submitted", requestId: "req-ops", at: "2026-09-01T01:00:00.000Z" },
    { id: "audit-2", action: "dispute.opened", requestId: "req-ops", at: "2026-09-01T02:00:00.000Z" },
  ];
  const dashboard = { requests: [request], quotes: [], changes: [], jobs: [{ requestId: "req-ops", quoteId: "quote-1", depositCents: 2000, completedAt: "2026-09-01T00:00:00.000Z" }], disputes: [dispute], evidence: [{ id: "evidence-after", requestId: "req-ops", kind: "after", note: "Leak-test video and after photo" }], payments: [] as Array<Record<string, unknown>>, audit };
  let phase = "open";
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === "/api/capabilities" && req.method() === "GET") return route.fulfill({ json: { payments: { enabled: true, provider: "stripe" } } });
    expect(req.headers().authorization).toMatch(/^Bearer demo\./);
    if (path === "/api/dashboard" && req.method() === "GET") return route.fulfill({ json: dashboard });
    if (path === "/api/disputes/dispute-1/resolve" && req.method() === "POST") {
      expect(phase).toBe("open"); expect(req.postDataJSON()).toEqual({});
      dispute.status = "resolved"; audit.push({ id: "audit-3", action: "dispute.resolved", requestId: "req-ops", at: "2026-09-01T03:00:00.000Z" }); phase = "resolved";
      return route.fulfill({ json: dispute });
    }
    if (path === "/api/requests/req-ops/refunds" && req.method() === "POST") {
      expect(phase).toBe("resolved");
      expect(req.headers()["idempotency-key"]).toBeTruthy();
      expect(req.postDataJSON()).toEqual({ amountCents: 2500, reason: "Evidence-supported remediation" });
      dashboard.payments.push({ id: "refund-1", requestId: "req-ops", kind: "refund", amountCents: 2500, status: "succeeded" });
      audit.push({ id: "audit-4", action: "refund.completed", requestId: "req-ops", at: "2026-09-01T04:00:00.000Z" }); phase = "refunded";
      return route.fulfill({ status: 201, json: { state: "completed", amountCents: 2500 } });
    }
    if (path === "/api/operators/providers/provider-new/eligibility" && req.method() === "PUT") {
      expect(req.postDataJSON()).toMatchObject({status:"approved",organizationName:"New Provider",licenseVerified:true,insuranceVerified:true,serviceCategories:["general"],serviceAreas:["Charlotte"]});
      return route.fulfill({json:req.postDataJSON()});
    }
    if (path === "/api/ops/recovery" && req.method() === "GET") return route.fulfill({json:{claims:[{claimId:"claim-stuck",kind:"settlement"}],receivables:[{id:"recv-1",amountCents:1200,reason:"partial reversal"}]}});
    if (path === "/api/ops/permits" && req.method() === "GET") return route.fulfill({json:{permits:[]}});
    if (path === "/api/ops/recovery/receivables/recv-1/resolve" && req.method() === "POST") return route.fulfill({json:{id:"recv-1",status:"resolved"}});
    throw new Error(`Unexpected operator API request: ${req.method()} ${path}`);
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("demo-operator").click();
  await expect(page.getByTestId("operator-console")).toBeVisible();
  await expect(page.getByText("internal · After photo shows a persistent leak")).toBeVisible();
  await expect(page.getByTestId("audit-log")).toContainText("evidence.submitted");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByRole("status")).toContainText("Dispute resolved");
  await expect(page.getByTestId("audit-log")).toContainText("dispute.resolved");
  await page.getByLabel("Refund amount USD").fill("25");
  await page.getByLabel("Refund reason").fill("Evidence-supported remediation");
  await page.getByRole("button", { name: "Issue refund" }).click();
  await expect(page.getByRole("status")).toContainText("Refund");
  await expect(page.getByTestId("audit-log")).toContainText("refund.completed");
  await page.getByLabel("Provider ID").fill("provider-new");
  await page.getByLabel("Organization name").fill("New Provider");
  await page.getByLabel("License expires").fill("2027-09-01T09:00");
  await page.getByLabel("Insurance expires").fill("2027-09-01T09:00");
  await page.getByRole("button",{name:"Save eligibility"}).click();
  await expect(page.getByRole("status")).toContainText("eligibility");
  await page.getByRole("button",{name:"Refresh recovery list"}).click();
  await expect(page.getByTestId("recovery-console")).toContainText("claim-stuck");
  await page.getByRole("button",{name:"Resolve receivable"}).click();
  expect(phase).toBe("refunded");
  const path = resolve("artifacts", "e2e-operator-dispute-refund-audit.png");
  await page.screenshot({ path, fullPage: true });
  await test.info().attach("operator-dispute-refund-audit", { path, contentType: "image/png" });
});
