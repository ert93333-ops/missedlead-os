/**
 * 파일럿 시나리오 통합 테스트(로컬 Supabase 필요).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, SupabaseJwtAuthAdapter } from "./app.js";
import { IntakeProviderResponseError, type IntakeAiProvider } from "./intake/provider.js";
import { SupabaseIntakeMediaStore } from "./intake/mediaStorage.js";
import { InMemoryIntakeUsageBudget } from "./intake/usage.js";
import { SupabaseRepository } from "./repository.js";

const requiredNames = [
  "SUPABASE_TEST_URL",
  "SUPABASE_TEST_ANON_KEY",
  "SUPABASE_TEST_SERVICE_ROLE_KEY",
  "SUPABASE_TEST_CUSTOMER_TOKEN",
  "SUPABASE_TEST_PROVIDER_TOKEN",
  "SUPABASE_TEST_OPERATOR_TOKEN",
  "INTEGRATION_API_URL",
] as const;
const missing = requiredNames.filter((name) => !process.env[name]);
const pilotIntegrationRequired =
  process.env.npm_lifecycle_event === "test:pilot-integration"
  || process.env.REQUIRE_PILOT_INTEGRATION !== "0";
if (pilotIntegrationRequired && missing.length) {
  throw new Error(`required pilot integration inputs are absent: ${missing.join(", ")}`);
}

const env = Object.fromEntries(requiredNames.map((name) => [name, process.env[name] ?? ""])) as Record<(typeof requiredNames)[number], string>;
const decodeSubject = (token: string): string => {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("pilot JWT has no payload");
  const subject = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown }).sub;
  if (typeof subject !== "string") throw new Error("pilot JWT has no subject");
  return subject;
};
const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
const signingSecret = "pilot-integration-signing-secret-32-bytes-minimum";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const suite = !pilotIntegrationRequired && missing.length ? describe.skip : describe.sequential;
suite(`payment-disabled pilot integration${missing.length ? ` (missing ${missing.join(", ")})` : ""}`, () => {
  let service: SupabaseClient;
  let repository: SupabaseRepository;
  let customerId: string;
  let providerId: string;
  let operatorId: string;
  const createdRequestIds = new Set<string>();
  const createdProfileIds = new Set<string>();
  const createdAuthIds = new Set<string>();
  const storedPaths = new Set<string>();
  let originalProviderRows: Record<string, unknown>[] = [];
  let originalIdentityRows: Record<string, unknown>[] = [];
  let operatorWasAllowlisted = false;

  const readyProvider: IntakeAiProvider = {
    async analyze() {
      return {
        evidenceQuality: "clear",
        reply: "A professional should inspect the reported leak.",
        category: "handyman",
        summary: "Water is leaking beneath the utility sink.",
        issueCandidates: [{ id: "leaking-trap", label: "Leaking drain connection", likelihood: "medium", reason: "Reported water beneath the sink", evidenceNeeded: [] }],
        questions: [],
        details: { location: "utility sink", access: "open cabinet" },
        safety: { level: "normal", hazards: [], guidance: "Stop using the sink if leaking increases." },
        readyToConfirm: true,
      } as const;
    },
    async translate(text) { return text; },
  };
  const invalidProvider: IntakeAiProvider = {
    async analyze() { throw new IntakeProviderResponseError("STOP", [{ path: "summary", code: "too_small" }]); },
    async translate(text) { return text; },
  };

  const makeApp = (provider: IntakeAiProvider = readyProvider, operatorAllowlist = [operatorId]) => createApp({
    repository,
    auth: new SupabaseJwtAuthAdapter(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY),
    operatorAllowlist,
    paymentsMode: "disabled",
    intakeProvider: provider,
    intakeSigningSecret: signingSecret,
    intakeUsageBudget: new InMemoryIntakeUsageBudget(),
    intakeMediaStore: new SupabaseIntakeMediaStore(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_ROLE_KEY),
  });

  const api = async (path: string, init: RequestInit = {}) => fetch(`${env.INTEGRATION_API_URL.replace(/\/$/, "")}${path}`, init);
  const analyze = (app: ReturnType<typeof createApp>, token: string, content: string, attachment?: Buffer) => {
    let call = request(app).post("/api/intake/analyze").set(authHeader(token)).field("payload", JSON.stringify({ locale: "en", history: [{ role: "user", content }], mediaConsent: Boolean(attachment) }));
    if (attachment) call = call.attach("media", attachment, { filename: "leak.png", contentType: "image/png" });
    return call;
  };
  const confirm = (app: ReturnType<typeof createApp>, token: string, assessmentToken: string) => request(app)
    .post("/api/intake/confirm")
    .set(authHeader(token))
    .send({ assessmentToken, customerName: "Pilot Customer", address: "101 Synthetic Test St, Charlotte, NC", acceptedIssueIds: ["leaking_trap"], warningAcknowledged: true });

  beforeAll(async () => {
    for (const raw of [env.SUPABASE_TEST_URL, env.INTEGRATION_API_URL]) {
      const hostname = new URL(raw).hostname;
      if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") throw new Error(`pilot integration refuses non-local endpoint: ${hostname}`);
    }
    customerId = decodeSubject(env.SUPABASE_TEST_CUSTOMER_TOKEN);
    providerId = decodeSubject(env.SUPABASE_TEST_PROVIDER_TOKEN);
    operatorId = decodeSubject(env.SUPABASE_TEST_OPERATOR_TOKEN);
    service = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    repository = new SupabaseRepository(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY, env.SUPABASE_TEST_SERVICE_ROLE_KEY);
    const identities = await service.from("profiles").select("*").in("id", [customerId, providerId, operatorId]);
    if (identities.error) throw identities.error;
    originalIdentityRows = identities.data ?? [];
    const allowlist = await service.from("operator_allowlist").select("user_id").eq("user_id", operatorId);
    if (allowlist.error) throw allowlist.error;
    operatorWasAllowlisted = allowlist.data.length > 0;
    const canonical = await service.from("profiles").upsert([
      { id: customerId, role: "customer", display_name: "Pilot Customer" },
      { id: providerId, role: "provider", display_name: "Pilot Provider" },
      { id: operatorId, role: "operator", display_name: "Pilot Operator" },
    ]);
    if (canonical.error) throw canonical.error;
    const allowed = await service.from("operator_allowlist").upsert({ user_id: operatorId });
    if (allowed.error) throw allowed.error;
  });

  afterAll(async () => {
    if (!service) return;
    if (storedPaths.size) await service.storage.from("request-media-private").remove([...storedPaths]);
    for (const id of createdRequestIds) await service.from("service_requests").delete().eq("id", id);
    for (const id of createdProfileIds) await service.from("profiles").delete().eq("id", id);
    for (const row of originalProviderRows) await service.from("profiles").update(row).eq("id", row.id);
    for (const row of originalIdentityRows) await service.from("profiles").upsert(row);
    if (!operatorWasAllowlisted) await service.from("operator_allowlist").delete().eq("user_id", operatorId);
    for (const id of createdAuthIds) await service.auth.admin.deleteUser(id);
  });

  it("fails every money, webhook, and reconciliation surface closed without writing money rows", async () => {
    const moneyTables = ["money_operations", "payments", "payment_attempts", "refund_allocations", "stripe_webhook_events", "settlement_authorizations"];
    for (const table of moneyTables) {
      const result = await service.from(table).select("*", { count: "exact", head: true });
      if (result.error) throw result.error;
      expect(result.count, `${table} must start empty`).toBe(0);
    }

    const capabilities = await api("/api/capabilities");
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({ payments: { mode: "disabled", enabled: false } });
    const id = randomUUID();
    const routes: Array<[string, RequestInit]> = [
      [`/api/requests/${id}/deposit`, { method: "POST" }],
      [`/api/requests/${id}/balance`, { method: "POST" }],
      [`/api/requests/${id}/settlement-preflight`, { method: "POST" }],
      [`/api/requests/${id}/settle`, { method: "POST" }],
      [`/api/requests/${id}/refunds`, { method: "POST" }],
      ["/api/webhooks/stripe", { method: "POST", body: "{}", headers: { "content-type": "application/json", "stripe-signature": "synthetic" } }],
      ["/api/internal/jobs/reconcile-payments", { method: "POST", headers: { "x-job-secret": "synthetic" } }],
    ];
    for (const [path, init] of routes) {
      const response = await api(path, init);
      expect(response.status, path).toBe(503);
      expect(await response.json(), path).toMatchObject({ error: "payments_not_enabled" });
    }
    for (const table of moneyTables) {
      const result = await service.from(table).select("*", { count: "exact", head: true });
      if (result.error) throw result.error;
      expect(result.count, `${table} must remain empty`).toBe(0);
    }
  });

  it("derives roles from profiles, rejects missing and forged tokens, removed operators, and revoked users", async () => {
    const forgedUser = await service.auth.admin.createUser({
      email: `pilot-forged-${randomUUID()}@example.invalid`, password: `Pilot-${randomUUID()}-Aa1!`, email_confirm: true,
      user_metadata: { role: "operator", provider_status: "approved" }, app_metadata: { role: "operator" },
    });
    if (forgedUser.error || !forgedUser.data.user) throw forgedUser.error ?? new Error("forged user not created");
    createdAuthIds.add(forgedUser.data.user.id);
    const password = `Pilot-${randomUUID()}-Aa1!`;
    const revocable = await service.auth.admin.createUser({ email: `pilot-revoked-${randomUUID()}@example.invalid`, password, email_confirm: true });
    if (revocable.error || !revocable.data.user) throw revocable.error ?? new Error("revocable user not created");
    createdAuthIds.add(revocable.data.user.id);
    const forgedPassword = `Pilot-${randomUUID()}-Aa1!`;
    const update = await service.auth.admin.updateUserById(forgedUser.data.user.id, { password: forgedPassword });
    if (update.error) throw update.error;
    const anon = createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY, { auth: { persistSession: false } });
    const forgedSession = await anon.auth.signInWithPassword({ email: forgedUser.data.user.email!, password: forgedPassword });
    if (forgedSession.error || !forgedSession.data.session) throw forgedSession.error ?? new Error("forged session missing");
    const revokedSession = await anon.auth.signInWithPassword({ email: revocable.data.user.email!, password });
    if (revokedSession.error || !revokedSession.data.session) throw revokedSession.error ?? new Error("revoked session missing");

    const app = makeApp();
    await request(app).get("/api/me").expect(401, { error: "authentication_required" });
    const parts = env.SUPABASE_TEST_CUSTOMER_TOKEN.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: customerId, role: "authenticated", app_metadata: { role: "operator" } })).toString("base64url");
    await request(app).get("/api/me").set(authHeader(`${parts[0]}.${forgedPayload}.${parts[2]}`)).expect(401, { error: "invalid_token" });
    const me = await request(app).get("/api/me").set(authHeader(forgedSession.data.session.access_token)).expect(200);
    expect(me.body.actor).toMatchObject({ id: forgedUser.data.user.id, role: "customer" });
    const removedOperator = await service.from("operator_allowlist").delete().eq("user_id", operatorId);
    if (removedOperator.error) throw removedOperator.error;
    let restoreError: unknown = null;
    try {
      await request(app).get("/api/me").set(authHeader(env.SUPABASE_TEST_OPERATOR_TOKEN)).expect(403, { error: "operator_not_allowlisted" });
    } finally {
      const restoredOperator = await service.from("operator_allowlist").upsert({ user_id: operatorId });
      restoreError = restoredOperator.error;
    }
    if (restoreError) throw restoreError;
    const deletion = await service.auth.admin.deleteUser(revocable.data.user.id);
    if (deletion.error) throw deletion.error;
    createdAuthIds.delete(revocable.data.user.id);
    await request(app).get("/api/me").set(authHeader(revokedSession.data.session.access_token)).expect(401, { error: "invalid_token" });
  }, 30_000);

  it("blocks English and Spanish emergencies and maps invalid AI output to a safe error", async () => {
    const app = makeApp();
    for (const [locale, content] of [["en", "I smell gas beside the water heater"], ["es", "Huelo a gas junto al calentador"]] as const) {
      const result = await request(app).post("/api/intake/analyze").set(authHeader(env.SUPABASE_TEST_CUSTOMER_TOKEN))
        .field("payload", JSON.stringify({ locale, history: [{ role: "user", content }], mediaConsent: false })).expect(200);
      expect(result.body.safety.level).toBe("emergency");
      expect(result.body.readyToConfirm).toBe(false);
      expect(result.body.issueCandidates).toEqual([]);
      const blocked = await request(app).post("/api/intake/confirm").set(authHeader(env.SUPABASE_TEST_CUSTOMER_TOKEN))
        .send({ assessmentToken: result.body.assessmentToken, customerName: "Pilot", address: "Synthetic address", acceptedIssueIds: ["anything"], warningAcknowledged: true })
        .expect(409);
      expect(blocked.body).toMatchObject({ error: "safety_clearance_required" });
    }
    const invalid = await analyze(makeApp(invalidProvider), env.SUPABASE_TEST_CUSTOMER_TOKEN, "Water appears beneath the sink when it drains");
    expect(invalid.status).toBe(502);
    expect(invalid.body).toEqual({ error: "invalid_provider_response" });
  });

  it("enforces provider eligibility and invitation state through the actual API", async () => {
    const app = makeApp();
    const profileBase = { role: "provider", display_name: "Pilot Provider", license_verified: true, insurance_verified: true, license_expires_at: "2099-01-01T00:00:00Z", insurance_expires_at: "2099-01-01T00:00:00Z", service_categories: ["plumbing"], service_areas: ["Charlotte"] };
    const upsert = await service.from("profiles").upsert({ id: providerId, ...profileBase, provider_status: "approved" });
    if (upsert.error) throw upsert.error;
    const created = await request(app).post("/api/requests").set(authHeader(env.SUPABASE_TEST_CUSTOMER_TOKEN))
      .send({ customerName: "Pilot", description: "Synthetic provider eligibility request", address: "Charlotte", hazards: ["none"] }).expect(200);
    const requestId = created.body.id as string;
    createdRequestIds.add(requestId);
    const categorized = await service.from("service_requests").update({ service_category: "plumbing", service_area: "Charlotte" }).eq("id", requestId);
    if (categorized.error) throw categorized.error;

    for (const state of [
      { provider_status: "approved", license_expires_at: "2000-01-01T00:00:00Z" },
      { provider_status: "suspended", license_expires_at: "2099-01-01T00:00:00Z" },
    ]) {
      const changed = await service.from("profiles").update(state).eq("id", providerId);
      if (changed.error) throw changed.error;
      const match = await request(app).post(`/api/requests/${requestId}/match`).set(authHeader(env.SUPABASE_TEST_OPERATOR_TOKEN))
        .send({ providerIds: [providerId] }).expect(409);
      expect(match.body).toMatchObject({ error: "provider ineligible" });
    }
    const restored = await service.from("profiles").update({ provider_status: "approved", license_expires_at: "2099-01-01T00:00:00Z" }).eq("id", providerId);
    if (restored.error) throw restored.error;
    const quoteBody = { scope: "Synthetic provider quote", diagnosticCents: 0, laborCents: 10000, materialsCents: 0, taxCents: 0, totalCents: 10000, validUntil: "2099-01-01T00:00:00Z", earliestStartAt: "2099-01-01T00:00:00Z", warrantyDays: 30, siteVisitRequired: false, permitRequired: false, inspectionStatus: "not_required" };
    const quoteRequest = (id: string) => request(app).post(`/api/providers/requests/${id}/quote`).set(authHeader(env.SUPABASE_TEST_PROVIDER_TOKEN)).send(quoteBody);
    const uninvitedRequest = await quoteRequest(requestId);
    expect(uninvitedRequest.status, JSON.stringify(uninvitedRequest.body)).toBe(403);
    expect(uninvitedRequest.body).toEqual({ error: "provider_invitation_required" });
    const unknownRequest = await quoteRequest(randomUUID());
    expect(unknownRequest.status, JSON.stringify(unknownRequest.body)).toBe(403);
    expect(unknownRequest.body).toEqual({ error: "provider_invitation_required" });

    const otherProviderId = randomUUID();
    createdProfileIds.add(otherProviderId);
    const otherProvider = await service.from("profiles").insert({ id: otherProviderId, ...profileBase, display_name: "Other Pilot Provider" });
    if (otherProvider.error) throw otherProvider.error;
    const otherMatch = await service.from("request_matches").insert({ request_id: requestId, provider_id: otherProviderId, rank: 1, status: "invited" });
    if (otherMatch.error) throw otherMatch.error;
    await quoteRequest(requestId).expect(403, { error: "provider_invitation_required" });

    const declined = await service.from("request_matches").insert({ request_id: requestId, provider_id: providerId, rank: 2, status: "declined" });
    if (declined.error) throw declined.error;
    await quoteRequest(requestId).expect(403, { error: "provider_invitation_required" });

    const invited = await service.from("request_matches").update({ status: "invited" }).eq("request_id", requestId).eq("provider_id", providerId);
    if (invited.error) throw invited.error;
    const matched = await service.from("service_requests").update({ workflow_status: "matched" }).eq("id", requestId);
    if (matched.error) throw matched.error;
    await quoteRequest(requestId).expect(201);
  }, 20_000);

  it("confirms idempotently, exercises zero and three-match boundaries, and authorizes canonical intake media", async () => {
    const providerColumns = "id,provider_status,license_verified,license_expires_at,insurance_verified,insurance_expires_at,service_categories,service_areas";
    const originals = await service.from("profiles").select(providerColumns).eq("role", "provider");
    if (originals.error) throw originals.error;
    originalProviderRows = originals.data ?? [];
      const suspended = await service.from("profiles").update({ provider_status: "pending" }).eq("role", "provider");
      if (suspended.error) throw suspended.error;
      const app = makeApp();
      const zeroAssessment = await analyze(app, env.SUPABASE_TEST_CUSTOMER_TOKEN, "Water appears beneath the utility sink when draining");
      expect(zeroAssessment.status).toBe(200);
      const first = await confirm(app, env.SUPABASE_TEST_CUSTOMER_TOKEN, zeroAssessment.body.assessmentToken).expect(201);
      const replay = await confirm(app, env.SUPABASE_TEST_CUSTOMER_TOKEN, zeroAssessment.body.assessmentToken).expect(201);
      expect(replay.body.requestId).toBe(first.body.requestId);
      createdRequestIds.add(first.body.requestId);
      const zeroMatches = await service.from("request_matches").select("provider_id", { count: "exact", head: true }).eq("request_id", first.body.requestId);
      if (zeroMatches.error) throw zeroMatches.error;
      expect(zeroMatches.count).toBe(0);

      for (let index = 0; index < 4; index += 1) {
        const id = randomUUID();
        createdProfileIds.add(id);
        const inserted = await service.from("profiles").insert({ id, role: "provider", display_name: `Pilot Match ${index}`, provider_status: "approved", license_verified: true, license_expires_at: "2099-01-01T00:00:00Z", insurance_verified: true, insurance_expires_at: "2099-01-01T00:00:00Z", service_categories: ["handyman"], service_areas: ["Charlotte"] });
        if (inserted.error) throw inserted.error;
      }
      const mediaAssessment = await analyze(app, env.SUPABASE_TEST_CUSTOMER_TOKEN, "Water appears beneath another utility sink when draining", png);
      expect(mediaAssessment.status).toBe(200);
      const matched = await confirm(app, env.SUPABASE_TEST_CUSTOMER_TOKEN, mediaAssessment.body.assessmentToken).expect(201);
      createdRequestIds.add(matched.body.requestId);
      const threeMatches = await service.from("request_matches").select("provider_id", { count: "exact" }).eq("request_id", matched.body.requestId);
      if (threeMatches.error) throw threeMatches.error;
      expect(threeMatches.count).toBe(3);

      const uploaded = await request(app).post(`/api/requests/${matched.body.requestId}/intake-media`).set(authHeader(env.SUPABASE_TEST_CUSTOMER_TOKEN))
        .field("assessmentToken", mediaAssessment.body.assessmentToken).attach("media", png, { filename: "leak.png", contentType: "image/png" }).expect(201);
      expect(uploaded.body.media).toHaveLength(1);
      storedPaths.add(uploaded.body.media[0].objectPath);
      await request(app).post(`/api/requests/${matched.body.requestId}/media`).set(authHeader(env.SUPABASE_TEST_CUSTOMER_TOKEN)).send({}).expect(404);
      await request(app).post(`/api/media/${uploaded.body.media[0].id}/upload-url`).set(authHeader(env.SUPABASE_TEST_CUSTOMER_TOKEN)).send({}).expect(404);
      await request(app).post(`/api/media/${uploaded.body.media[0].id}/complete`).set(authHeader(env.SUPABASE_TEST_CUSTOMER_TOKEN)).send({}).expect(404);
      await request(app).patch(`/api/media/${uploaded.body.media[0].id}/sanitization`).set(authHeader(env.SUPABASE_TEST_OPERATOR_TOKEN)).send({}).expect(404);
      await request(app).get(`/api/requests/${matched.body.requestId}/intake-media`).expect(401);
      await request(app).get(`/api/requests/${matched.body.requestId}/intake-media`).set(authHeader(env.SUPABASE_TEST_PROVIDER_TOKEN)).expect(403, { error: "request_access_required" });
      await request(app).get(`/api/requests/${matched.body.requestId}/intake-media`).set(authHeader(env.SUPABASE_TEST_CUSTOMER_TOKEN)).expect(200);
    for (const row of originalProviderRows) {
      const restored = await service.from("profiles").update(row).eq("id", row.id);
      if (restored.error) throw restored.error;
    }
    originalProviderRows = [];
  }, 30_000);
});
