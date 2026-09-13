/**
 * 미디어 업로드 검증·제한·스토리지 경로 테스트.
 */
import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { emptyState, InMemoryRepository, type Actor } from "./repository.js";
import { InMemoryIntakeMediaStore, registerIntakeMediaRoutes, type InMemoryIntakeMediaInventory, type IntakeMediaRouteOptions, type StoreIntakeMediaInput } from "./intake/mediaStorage.js";
import { AssessmentTokenSigner } from "./intake/token.js";
import type { SignedAssessment } from "./intake/types.js";

const SECRET = "intake-media-test-secret-that-is-long-enough";
const NOW = new Date("2026-09-05T12:00:00.000Z");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
const ASSESSMENT_ID = "3a682956-d236-4483-8637-f93044079021";

const repositoryFor = (ownerId: string) => {
  const state = emptyState();
  state.requests["request-1"] = {
    id: "request-1", customerId: ownerId, customerName: "Customer", description: "Leaking pipe under sink",
    address: "Charlotte, NC", safetyStatus: "cleared", status: "matched", providerIds: ["provider-1"],
    expandedSearch: true, createdAt: NOW.toISOString(),
  };
  state.providerEligibility["provider-1"] = {
    status: "approved", organizationName: "Provider One", licenseVerified: true,
    licenseExpiresAt: "2027-09-05T00:00:00.000Z", insuranceVerified: true,
    insuranceExpiresAt: "2027-09-05T00:00:00.000Z", serviceCategories: ["plumbing"], serviceAreas: ["Charlotte"],
  };
  return new InMemoryRepository(state);
};

const tokenFor = (actorId: string, fileName: string, contentType: string, bytes: Buffer) => {
  const value: SignedAssessment = {
    version: 1, assessmentId: ASSESSMENT_ID, actorId,
    expiresAt: "2026-09-05T13:00:00.000Z", locale: "en", skippedQuestionIds: [], uncertaintyAcknowledged: false,
    attachmentTypes: [contentType], attachmentNames: [fileName], attachmentDigests: [createHash("sha256").update(bytes).digest("hex")],
    history: [{ role: "user", content: "There is a leak under my sink." }], translations: [],
    assessment: {
      reply: "The connection may be leaking.", category: "plumbing", summary: "Leak under sink",
      issueCandidates: [{ id: "pipe_leak", label: "Pipe connection leak", likelihood: "high", reason: "Visible water", evidenceNeeded: [] }],
      questions: [], details: {}, safety: { level: "normal", hazards: [], guidance: "Turn off the sink supply if safe." }, readyToConfirm: true,
    },
  };
  return new AssessmentTokenSigner(SECRET).sign(value);
};

const testApp = (actor: Actor, ownerId = actor.id, requestAssessmentId = ASSESSMENT_ID, overrides: Partial<IntakeMediaRouteOptions> = {}) => {
  const app = express();
  const store = overrides.store ?? new InMemoryIntakeMediaStore({ "request-1": requestAssessmentId });
  app.use((_request, response, next) => { response.locals.actor = actor; next(); });
  registerIntakeMediaRoutes(app, {
    repository: repositoryFor(ownerId), signingSecret: SECRET, now: () => NOW,
    store, sanitize: async (bytes) => bytes, ...overrides,
  });
  return { app, store: store as InMemoryIntakeMediaStore };
};

class FailingSaveStore extends InMemoryIntakeMediaStore {
  async save(_input: StoreIntakeMediaInput): Promise<never> {
    throw new Error("synthetic_storage_failure");
  }
}

describe("intake media storage", () => {
  it("retires every legacy customer and operator media route", async () => {
    const actor: Actor = { id: "customer-1", role: "customer" };
    const app = createApp({
      repository: repositoryFor(actor.id),
      auth: { async authenticate() { return actor; } },
      paymentsMode: "disabled",
      intakeSigningSecret: SECRET,
      intakeMediaStore: new InMemoryIntakeMediaStore({ "request-1": ASSESSMENT_ID }),
    });
    const routes: Array<["post" | "patch", string]> = [
      ["post", "/api/requests/request-1/media"],
      ["post", "/api/media/media-1/upload-url"],
      ["post", "/api/media/media-1/complete"],
      ["patch", "/api/media/media-1/sanitization"],
    ];
    for (const [method, path] of routes) {
      expect((await request(app)[method](path).set("Authorization", "Bearer test-token").send({})).status, path).toBe(404);
    }
  });

  it("stores sanitized customer media and makes retries idempotent", async () => {
    const { app, store } = testApp({ id: "customer-1", role: "customer" });
    const assessmentToken = tokenFor("customer-1", "sink.png", "image/png", PNG);

    const first = await request(app).post("/api/requests/request-1/intake-media").set("Authorization", "Bearer test-token")
      .field("assessmentToken", assessmentToken).attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
    expect(first.status).toBe(201);
    expect(first.body.media).toEqual([expect.objectContaining({
      requestId: "request-1", ownerId: "customer-1", fileName: "sink.png", contentType: "image/png",
      sanitizationStatus: "sanitized", exifRemovalStatus: "removed", sourceRetention: "discarded_after_sanitization",
    })]);
    expect(first.body.media[0].objectPath).toMatch(/^customer-1\/request-1\/intake\/[a-f0-9]{64}\.png$/);

    const retry = await request(app).post("/api/requests/request-1/intake-media").set("Authorization", "Bearer test-token")
      .field("assessmentToken", assessmentToken).attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
    expect(retry.status).toBe(200);
    expect(retry.body.media[0].id).toBe(first.body.media[0].id);
    expect(store.records).toHaveLength(1);
  });

  it("coalesces concurrent identical retries into one row and one private object", async () => {
    const { app, store } = testApp({ id: "customer-1", role: "customer" });
    const assessmentToken = tokenFor("customer-1", "sink.png", "image/png", PNG);
    const upload = () => request(app).post("/api/requests/request-1/intake-media")
      .set("Authorization", "Bearer test-token").field("assessmentToken", assessmentToken)
      .attach("media", PNG, { filename: "sink.png", contentType: "image/png" });

    const [first, second] = await Promise.all([upload(), upload()]);

    expect([first.status, second.status].every((status) => status === 200 || status === 201)).toBe(true);
    expect(first.body.media[0].id).toBe(second.body.media[0].id);
    expect(store.records).toHaveLength(1);
    expect(store.objects.size).toBe(1);
  });

  it("rejects a customer who does not own the confirmed request", async () => {
    const { app, store } = testApp({ id: "customer-2", role: "customer" }, "customer-1");
    const response = await request(app).post("/api/requests/request-1/intake-media")
      .field("assessmentToken", tokenFor("customer-2", "sink.png", "image/png", PNG))
      .attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "request_owner_required" });
    expect(store.records).toHaveLength(0);
  });

  it("rejects bytes whose magic does not match the declared media type", async () => {
    const { app, store } = testApp({ id: "customer-1", role: "customer" });
    const invalid = Buffer.from("not a png");
    const response = await request(app).post("/api/requests/request-1/intake-media")
      .field("assessmentToken", tokenFor("customer-1", "sink.png", "image/png", invalid))
      .attach("media", invalid, { filename: "sink.png", contentType: "image/png" });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "media_context_changed" });
    expect(store.records).toHaveLength(0);
  });

  it("does not persist media when sanitization fails, times out, or changes the checksum-bearing bytes to invalid media", async () => {
    const assessmentToken = tokenFor("customer-1", "sink.png", "image/png", PNG);
    for (const overrides of [
      { sanitize: async () => { throw new Error("synthetic_sanitizer_failure"); } },
      { sanitize: async () => await new Promise<Buffer>(() => {}), sanitizationTimeoutMs: 5 },
      { sanitize: async () => Buffer.from("not sanitized media") },
    ]) {
      const { app, store } = testApp({ id: "customer-1", role: "customer" }, "customer-1", ASSESSMENT_ID, overrides);
      const response = await request(app).post("/api/requests/request-1/intake-media")
        .field("assessmentToken", assessmentToken)
        .attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
      expect(response.status).toBe(422);
      expect(response.body).toEqual({ error: "media_sanitization_failed" });
      expect((store as InMemoryIntakeMediaStore).records).toHaveLength(0);
    }
  });

  it("leaves no object or record after an upload failure", async () => {
    const store = new FailingSaveStore({ "request-1": ASSESSMENT_ID });
    const { app } = testApp({ id: "customer-1", role: "customer" }, "customer-1", ASSESSMENT_ID, { store });
    const response = await request(app).post("/api/requests/request-1/intake-media")
      .field("assessmentToken", tokenFor("customer-1", "sink.png", "image/png", PNG))
      .attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "media_storage_failed" });
    expect(store.records).toHaveLength(0);
  });

  it.each([
    ["reservation before upload", "afterReserve"],
    ["upload before finalize", "afterUpload"],
  ] as const)("resumes after a crash during %s without an orphan", async (_phase, fault) => {
    const inventory: InMemoryIntakeMediaInventory = { records: [], objects: new Set() };
    const crashingStore = new InMemoryIntakeMediaStore({ "request-1": ASSESSMENT_ID }, [], {
      [fault]: () => { throw new Error("synthetic_process_crash"); },
    }, inventory);
    const { app: crashingApp } = testApp({ id: "customer-1", role: "customer" }, "customer-1", ASSESSMENT_ID, { store: crashingStore });
    const assessmentToken = tokenFor("customer-1", "sink.png", "image/png", PNG);
    const crashed = await request(crashingApp).post("/api/requests/request-1/intake-media")
      .field("assessmentToken", assessmentToken)
      .attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
    expect(crashed.status).toBe(503);
    expect(inventory.records).toEqual([expect.objectContaining({
      uploaded: false, sanitizationStatus: "pending_scan", exifRemovalStatus: "pending",
    })]);
    expect(await crashingStore.listSanitized("request-1")).toEqual([]);
    expect(inventory.objects.size).toBe(fault === "afterUpload" ? 1 : 0);

    const restartedStore = new InMemoryIntakeMediaStore({ "request-1": ASSESSMENT_ID }, [], {}, inventory);
    const { app: restartedApp } = testApp({ id: "customer-1", role: "customer" }, "customer-1", ASSESSMENT_ID, { store: restartedStore });
    const resumed = await request(restartedApp).post("/api/requests/request-1/intake-media")
      .field("assessmentToken", assessmentToken)
      .attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
    expect(resumed.status).toBe(201);
    expect(inventory.records).toHaveLength(1);
    expect(inventory.records[0]).toEqual(expect.objectContaining({
      uploaded: true, sanitizationStatus: "sanitized", exifRemovalStatus: "removed",
    }));
    expect(inventory.objects).toEqual(new Set([resumed.body.media[0].objectPath]));
  });

  it("retains finalized inventory when signed-read creation transiently fails", async () => {
    class FailingReadStore extends InMemoryIntakeMediaStore {
      async signedReadUrl(): Promise<never> { throw new Error("synthetic_signing_failure"); }
    }
    const store = new FailingReadStore({ "request-1": ASSESSMENT_ID });
    const { app } = testApp({ id: "customer-1", role: "customer" }, "customer-1", ASSESSMENT_ID, { store });
    const response = await request(app).post("/api/requests/request-1/intake-media")
      .field("assessmentToken", tokenFor("customer-1", "sink.png", "image/png", PNG))
      .attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "media_storage_failed" });
    expect(store.records).toHaveLength(1);
    expect(store.objects.size).toBe(1);
  });

  it("rejects media from another assessment owned by the same customer", async () => {
    const { app, store } = testApp({ id: "customer-1", role: "customer" }, "customer-1", "9b5416ca-226f-48ee-b68e-a94859e6c835");
    const response = await request(app).post("/api/requests/request-1/intake-media")
      .field("assessmentToken", tokenFor("customer-1", "sink.png", "image/png", PNG))
      .attach("media", PNG, { filename: "sink.png", contentType: "image/png" });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "assessment_request_mismatch" });
    expect(store.records).toHaveLength(0);
  });

  it("rejects an unsupported executable attachment", async () => {
    const { app, store } = testApp({ id: "customer-1", role: "customer" });
    const executable = Buffer.from("4d5a9000", "hex");
    const response = await request(app).post("/api/requests/request-1/intake-media")
      .field("assessmentToken", tokenFor("customer-1", "payload.exe", "application/octet-stream", executable))
      .attach("media", executable, { filename: "payload.exe", contentType: "application/octet-stream" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_media_upload" });
    expect(store.records).toHaveLength(0);
  });

  it("lets a matched provider view sanitized media through short-lived URLs", async () => {
    const { app, store } = testApp({ id: "provider-1", role: "provider" }, "customer-1");
    await store.save({
      id: "media-1", requestId: "request-1", ownerId: "customer-1", fileName: "sink.png", contentType: "image/png",
      sizeBytes: PNG.length, checksum: createHash("sha256").update(PNG).digest("hex"), objectPath: "customer-1/request-1/media-1.png",
      sanitizationStatus: "sanitized", exifRemovalStatus: "removed", bytes: PNG,
    });

    const response = await request(app).get("/api/requests/request-1/intake-media").set("Authorization", "Bearer provider-token");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ media: [{
      id: "media-1", fileName: "sink.png", contentType: "image/png", sizeBytes: PNG.length,
      url: "/api/test-private-media/media-1?expires=60", expiresInSeconds: 60,
    }] });
    expect(response.body.media[0]).not.toHaveProperty("objectPath");
    expect(response.body.media[0]).not.toHaveProperty("checksum");
  });

  it("rejects a provider who cannot see the requested job", async () => {
    const { app } = testApp({ id: "provider-2", role: "provider" }, "customer-1");
    const response = await request(app).get("/api/requests/request-1/intake-media").set("Authorization", "Bearer other-provider-token");
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "request_access_required" });
  });

  it("filters unsanitized media from customer and provider views", async () => {
    const { app, store } = testApp({ id: "customer-1", role: "customer" });
    store.records.push({
      id: "media-pending", requestId: "request-1", ownerId: "customer-1", fileName: "raw.mp4", contentType: "video/mp4",
      sizeBytes: 12, checksum: "a".repeat(64), objectPath: "customer-1/request-1/raw.mp4",
      sanitizationStatus: "pending_scan", exifRemovalStatus: "pending", sourceRetention: "discarded_after_sanitization", uploaded: true,
    });
    const response = await request(app).get("/api/requests/request-1/intake-media");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ media: [] });
  });
});
