import { expect, test, type Page, type Route } from "@playwright/test";

type RecordMap = Record<string, unknown>;

const emptyDashboard = () => ({ requests: [] as RecordMap[], quotes: [], changes: [], jobs: [], disputes: [], evidence: [], payments: [], audit: [] });

async function openCustomer(page: Page) {
  await page.goto("/", { waitUntil: "commit" });
  await page.getByTestId("demo-customer").click();
  await expect(page).toHaveURL(/\/customer$/);
}

function fulfill(route: Route, status: number, json: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

test("customer can share media, skip a non-safety question, review uncertainty, and confirm", async ({ page }) => {
  const dashboard = emptyDashboard();
  let analysisCount = 0;
  let confirmed = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/capabilities") return fulfill(route, 200, { payments: { enabled: false, provider: "stripe" } });
    if (path === "/api/dashboard") return fulfill(route, 200, dashboard);
    if (path === "/api/intake/translate") return fulfill(route, 200, { original: "Water is dripping under the sink.", translated: "Hay agua goteando debajo del fregadero.", sourceLocale: "en", targetLocale: "es", warning: "AI translation may be inaccurate. Confirm prices, scope, warranties, and legal terms before approval.", translationToken: "translation-signed-1" });
    if (path === "/api/intake/analyze") {
      expect(request.headers().authorization).toMatch(/^Bearer demo\./);
      const body = request.postDataBuffer()?.toString("utf8") ?? "";
      expect(body).toContain('"mediaConsent":true');
      expect(body).toContain("sink.jpg");
      expect(body).not.toContain("Hi, I’m the WeCover repair assistant");
      analysisCount += 1;
      if (analysisCount === 1) expect(body).toContain('"history":[{"role":"user","content":"Water is dripping under the sink.');
      if (analysisCount === 1) return fulfill(route, 200, { reply: "The leak appears to be near the drain connection. Is it dripping only while water runs?", locale: "en", issueCandidates: [{ id: "trap-leak", label: "Loose or worn drain trap", likelihood: "high", reason: "The location and visible drip fit a drain connection leak.", evidenceNeeded: ["A close photo of the curved pipe"] }], questions: [{ id: "when-dripping", prompt: "Does it drip only while the faucet is running?", requiredForSafety: false }], safety: { level: "normal", guidance: "" }, readyToConfirm: false, assessmentToken: "assessment-1" });
      expect(body).toContain('"questionIds":["when-dripping"]');
      expect(body).toContain('"warningAcknowledged":true');
      expect(body).toContain('"translationToken":"translation-signed-1"');
      return fulfill(route, 200, { reply: "That is enough to prepare a provisional repair scope.", locale: "en", issueCandidates: [{ id: "trap-leak", label: "Loose or worn drain trap", likelihood: "high", reason: "The location and visible drip fit a drain connection leak.", evidenceNeeded: [] }], questions: [], safety: { level: "normal", guidance: "" }, readyToConfirm: true, uncertaintyWarning: "A technician must inspect the leak before the cause and final price are confirmed.", assessmentToken: "assessment-2" });
    }
    if (path === "/api/intake/confirm") {
      expect(request.postDataJSON()).toEqual({ assessmentToken: "assessment-2", acceptedIssueIds: ["trap-leak"], warningAcknowledged: true, customerName: "Jordan Lee", address: "101 Mint St, Charlotte, NC" });
      confirmed = true;
      dashboard.requests.push({ id: "req-chat", customerName: "Jordan Lee", description: "Leak under the kitchen sink", address: "101 Mint St, Charlotte, NC", safetyStatus: "cleared", status: "intake", providerIds: [], expandedSearch: false, workScopeSnapshot: { symptom: "Water is dripping under the sink", location: "Kitchen sink" }, createdAt: "2026-09-05T00:00:00.000Z" });
      return fulfill(route, 201, { requestId: "req-chat", status: "intake", matchCount: 0 });
    }
    if (path === "/api/requests/req-chat/intake-media" && request.method() === "POST") {
      const body = request.postDataBuffer()?.toString("utf8") ?? "";
      expect(body).toContain("assessment-2");
      expect(body).toContain("sink.jpg");
      return fulfill(route, 201, { media: [{ id: "media-chat", requestId: "req-chat", fileName: "sink.jpg", sanitizationStatus: "sanitized", exifRemovalStatus: "removed", sourceRetention: "discarded_after_sanitization" }] });
    }
    if (path === "/api/requests/req-chat/intake-media" && request.method() === "GET") return fulfill(route, 200, { media: [{ id: "media-chat", fileName: "sink.jpg", contentType: "image/jpeg", sizeBytes: 3, url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", expiresInSeconds: 60 }] });
    return fulfill(route, 404, { error: `Unhandled ${request.method()} ${path}` });
  });

  await openCustomer(page);
  await expect(page.getByRole("heading", { name: "Tell us what happened" })).toBeVisible();
  await page.getByLabel("Add photos, video, or audio").setInputFiles({ name: "sink.jpg", mimeType: "image/jpeg", buffer: Buffer.from([1, 2, 3]) });
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-media-consent-desktop.png", fullPage: true });
  await page.getByText("I agree to secure AI processing", { exact: false }).click();
  await page.getByLabel("Describe the problem or answer the question").fill("Water is dripping under the sink.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Loose or worn drain trap")).toBeVisible();
  await expect(page.getByText("A technician must inspect", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Show Spanish translation" }).first().click();
  await expect(page.getByText("Hay agua goteando debajo del fregadero.")).toBeVisible();
  await expect(page.getByText("AI translation may be inaccurate", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "I’m not sure — skip" }).click();
  await page.getByText("You can skip this question", { exact: false }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-skip-warning-desktop.png", fullPage: true });
  await page.getByText("I understand the quote may change.").click();
  await page.getByRole("button", { name: "Skip and continue" }).click();

  await expect(page.getByRole("heading", { name: "Review your repair request" })).toBeVisible();
  await page.getByLabel("Your name").fill("Jordan Lee");
  await page.getByLabel("Service address").fill("101 Mint St, Charlotte, NC");
  await page.getByRole("button", { name: "Confirm and find technicians" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-confirm-desktop.png", fullPage: true });
  await page.getByText("A technician must inspect the leak", { exact: false }).click();
  await page.getByRole("button", { name: "Confirm and find technicians" }).click();

  expect(confirmed).toBe(true);
  await expect(page.getByTestId("chat-scope-summary")).toContainText("Water is dripping under the sink");
  await expect(page.getByTestId("intake-media-gallery")).toContainText("sink.jpg");
  await expect(page.getByTestId("request-details")).toHaveCount(0);
  await expect(page.getByTestId("payment-unavailable")).toContainText("No payment has been taken");
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-match-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "New request" }).click();
  await expect(page.getByTestId("customer-intake")).toBeVisible();
  await page.getByRole("button", { name: "View requests" }).click();
  await expect(page.getByTestId("chat-scope-summary")).toContainText("Water is dripping under the sink");
});

test("provider outage keeps the customer message and offers a retry", async ({ page }) => {
  const dashboard = emptyDashboard();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/capabilities") return fulfill(route, 200, { payments: { enabled: false, provider: "stripe" } });
    if (path === "/api/dashboard") return fulfill(route, 200, dashboard);
    if (path === "/api/intake/analyze") return fulfill(route, 503, { error: "AI_PROVIDER_UNAVAILABLE" });
    return fulfill(route, 404, { error: "Unhandled" });
  });

  await openCustomer(page);
  await page.getByLabel("Describe the problem or answer the question").fill("The breaker keeps tripping in the kitchen.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log").getByText("The breaker keeps tripping in the kitchen.")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Spanish mobile customer can confirm a provisional scope and enter matching", async ({ page }) => {
  const dashboard = emptyDashboard();
  let analysisCount = 0;
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/capabilities") return fulfill(route, 200, { payments: { enabled: false, provider: "stripe" } });
    if (path === "/api/dashboard") return fulfill(route, 200, dashboard);
    if (path === "/api/intake/analyze") {
      analysisCount += 1;
      if (analysisCount === 1) return fulfill(route, 200, { reply: "La fuga parece estar cerca de la conexión del desagüe. ¿Gotea solo cuando corre el agua?", locale: "es", issueCandidates: [{ id: "fuga-trampa", label: "Conexión del desagüe floja", likelihood: "high", reason: "La ubicación coincide con una fuga del desagüe.", evidenceNeeded: [] }], questions: [{ id: "cuando-gotea", prompt: "¿Gotea solo cuando abre el grifo?", requiredForSafety: false }], safety: { level: "normal", guidance: "" }, readyToConfirm: false, assessmentToken: "assessment-es-1" });
      return fulfill(route, 200, { reply: "Hay suficiente información para preparar un alcance provisional.", locale: "es", issueCandidates: [{ id: "fuga-trampa", label: "Conexión del desagüe floja", likelihood: "high", reason: "La ubicación coincide con una fuga del desagüe.", evidenceNeeded: [] }], questions: [], safety: { level: "normal", guidance: "" }, readyToConfirm: true, uncertaintyWarning: "Un técnico debe inspeccionar la fuga antes de confirmar la causa y el precio final.", assessmentToken: "assessment-es" });
    }
    if (path === "/api/intake/confirm") {
      dashboard.requests.push({ id: "req-es", customerName: "Ana Torres", description: "Fuga debajo del fregadero", address: "202 Oak St, Charlotte, NC", safetyStatus: "cleared", status: "intake", providerIds: [], expandedSearch: false, workScopeSnapshot: { symptom: "Fuga debajo del fregadero", location: "Cocina" }, createdAt: "2026-09-05T00:00:00.000Z" });
      return fulfill(route, 201, { requestId: "req-es", status: "intake", matchCount: 0 });
    }
    if (path === "/api/requests/req-es/intake-media" && request.method() === "POST") return fulfill(route, 201, { media: [{ id: "media-es", requestId: "req-es", fileName: "fuga.jpg", sanitizationStatus: "sanitized", exifRemovalStatus: "removed", sourceRetention: "discarded_after_sanitization" }] });
    if (path === "/api/requests/req-es/intake-media" && request.method() === "GET") return fulfill(route, 200, { media: [] });
    return fulfill(route, 404, { error: "Unhandled" });
  });

  await openCustomer(page);
  await page.getByRole("button", { name: "ES" }).click();
  await page.getByLabel("Agregar fotos, video o audio").setInputFiles({ name: "fuga.jpg", mimeType: "image/jpeg", buffer: Buffer.from([1, 2, 3]) });
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-media-consent-spanish-320.png", fullPage: true });
  await page.getByText("Acepto el procesamiento seguro con IA", { exact: false }).click();
  await page.getByLabel("Describa el problema o responda la pregunta").fill("Hay una fuga debajo del fregadero de la cocina.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "No estoy seguro — omitir" }).click();
  await page.getByText("Puede omitir esta pregunta", { exact: false }).scrollIntoViewIfNeeded();
  await page.getByText("Entiendo que el presupuesto puede cambiar.").click();
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-skip-warning-spanish-320.png", fullPage: true });
  await page.getByRole("button", { name: "Omitir y continuar" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Omitir y continuar" })).toBeInViewport();
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-skip-continue-spanish-320.png" });
  await page.getByRole("button", { name: "Omitir y continuar" }).click();
  await page.getByRole("heading", { name: "Revise su solicitud" }).scrollIntoViewIfNeeded();
  await page.getByLabel("Su nombre").fill("Ana Torres");
  await page.getByLabel("Dirección del servicio").fill("202 Oak St, Charlotte, NC");
  await page.getByRole("button", { name: "Confirmar y buscar técnicos" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-confirm-spanish-320.png", fullPage: true });
  await page.getByText("Un técnico debe inspeccionar la fuga", { exact: false }).click();
  await page.getByRole("button", { name: "Confirmar y buscar técnicos" }).click();
  await expect(page.getByTestId("chat-scope-summary")).toContainText("Solicitud de reparación confirmada");
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-match-spanish-320.png", fullPage: true });
  await page.getByTestId("coordination").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/wecover-chat-fixture-match-spanish-320-lower.png" });
});
