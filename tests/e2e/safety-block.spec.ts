/**
 * 안전 차단 E2E: 위험 인테이크는 매칭/결제 API를 호출하지 않고 하드 블록되는지 검증.
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("hazard intake is a hard block and never exposes matching or payment", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  let blocked = false;
  const request = { id: "blocked-1", customerName: "Safety Customer", description: "Strong gas smell beside the water heater", address: "Charlotte, NC", safetyStatus: "blocked", hazardReason: "gas", status: "intake", providerIds: [], expandedSearch: false, createdAt: "2026-09-01T00:00:00.000Z" };
  const dashboard = () => ({ requests: blocked ? [request] : [], quotes: [], changes: [], jobs: [], disputes: [], evidence: [], payments: [], audit: blocked ? [{ id: "audit-1", action: "request.hazard_blocked", requestId: "blocked-1", at: "2026-09-01T00:00:00.000Z" }] : [] });
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === "/api/capabilities" && req.method() === "GET") return route.fulfill({ json: { payments: { enabled: false, provider: "stripe" } } });
    expect(req.headers().authorization).toMatch(/^Bearer demo\./);
    if (path === "/api/dashboard" && req.method() === "GET") return route.fulfill({ json: dashboard() });
    if (path === "/api/intake/analyze" && req.method() === "POST") {
      expect(blocked).toBeFalsy();
      expect(req.postDataBuffer()?.toString("utf8")).toContain("Strong gas smell beside the water heater");
      blocked = true;
      return route.fulfill({json:{reply:"Leave the area immediately and call 911 or the gas utility from a safe location.",locale:"en",category:"hvac",summary:"Strong gas smell beside the water heater",issueCandidates:[{id:"possible-gas-leak",label:"Possible gas leak",likelihood:"high",reason:"A strong gas odor can indicate an active leak.",evidenceNeeded:[]}],questions:[],safety:{level:"emergency",hazards:["gas"],guidance:"Leave immediately and call 911 or the gas utility."},readyToConfirm:false,assessmentToken:"signed.emergency.fixture"}});
    }
    throw new Error(`Blocked request caused forbidden API call: ${req.method()} ${path}`);
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("demo-customer").click();
  const intake = page.getByTestId("customer-intake");
  await intake.getByLabel("Describe the problem or answer the question").fill("Strong gas smell beside the water heater");
  await intake.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("911");
  await expect(page.getByRole("button",{name:"Confirm and find technicians"})).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByTestId("demo-customer").click();
  await expect(page.getByTestId("blocked-request")).toContainText("emergency services");
  await expect(page.getByRole("button", { name: "Choose this quote" })).toHaveCount(0);
  const path = resolve("artifacts", "e2e-safety-hard-block.png");
  await page.screenshot({ path, fullPage: true });
  await test.info().attach("safety-hard-block", { path, contentType: "image/png" });
});
