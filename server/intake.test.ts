/**
 * 인테이크 라우트 단위 테스트: 분석·확인·에러 경로.
 */
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, InMemoryRepository, type AuthAdapter } from "./app.js";
import type { AnalyzeInput, ModelAssessment } from "./intake/types.js";
import type { IntakeAiProvider } from "./intake/provider.js";
import { IntakeProviderUnavailableError, normalizeModelAssessment } from "./intake/provider.js";
import sharp from "sharp";
import { sanitizeMediaBuffer } from "./intake/media.js";
import { InMemoryIntakeUsageBudget, type IntakeUsageBudget } from "./intake/usage.js";
import { execFileSync } from "node:child_process";
import { MediaSanitizationError } from "./intake/media.js";

const actors = {
  customer: { id: "customer", role: "customer" as const },
  other: { id: "other", role: "customer" as const },
  provider: { id: "provider", role: "provider" as const },
};
const auth: AuthAdapter = { async authenticate(token) { return actors[token as keyof typeof actors] ?? null; } };
const bearer = (token: keyof typeof actors) => ({ Authorization: `Bearer ${token}` });
const signingSecret = "test-intake-signing-secret-with-at-least-32-bytes";
const assistantReply = "I found a likely drain leak and need a little more information.";

const assessment = (questions: ModelAssessment["questions"] = [], readyToConfirm = questions.length === 0): ModelAssessment => ({
  reply: assistantReply,
  category: "plumbing",
  summary: "Possible leak beneath the kitchen sink",
  issueCandidates: [{ id: "drain_leak", label: "Drain connection leak", likelihood: "medium", reason: "Water appears near the drain connection", evidenceNeeded: [] }],
  questions,
  details: { location: "beneath the kitchen sink" },
  safety: { level: "normal", hazards: [], guidance: "" },
  readyToConfirm,
});

class FakeIntakeProvider implements IntakeAiProvider {
  readonly inputs: AnalyzeInput[] = [];
  next = assessment();
  async analyze(input: AnalyzeInput) { this.inputs.push(input); return this.next; }
  async translate(text: string) { return `ES: ${text}`; }
}

class BlockingIntakeProvider extends FakeIntakeProvider {
  private start: () => void = () => undefined;
  private finishRequest?: () => void;
  readonly started = new Promise<void>((resolve) => { this.start = resolve; });
  override async analyze(input: AnalyzeInput) {
    this.inputs.push(input);
    this.start();
    await new Promise<void>((resolve) => { this.finishRequest = resolve; });
    return this.next;
  }
  finish(): void { this.finishRequest?.(); }
}

const setup = (provider?: IntakeAiProvider, usageBudget: IntakeUsageBudget = new InMemoryIntakeUsageBudget()) => {
  const repository = new InMemoryRepository();
  const app = createApp({ repository, auth, paymentsEnabled: false, intakeProvider: provider, intakeSigningSecret: signingSecret, intakeUsageBudget: usageBudget, now: () => new Date("2026-09-05T12:00:00.000Z") });
  return { app, repository };
};
const analyze = (app: ReturnType<typeof createApp>, payload: object, token: keyof typeof actors = "customer") => request(app)
  .post("/api/intake/analyze")
  .set(bearer(token))
  .field("payload", JSON.stringify(payload));

describe("chat intake", () => {
  it("returns emergency guidance without calling AI or unavailable usage storage", async () => {
    const provider = new FakeIntakeProvider();
    const budget: IntakeUsageBudget = { async reserve() { throw new Error("database offline"); }, async release() {} };
    const { app } = setup(provider, budget);
    const result = await analyze(app, { locale:"en", history:[{role:"user",content:"I smell gas near the furnace"}] }).expect(200);
    expect(result.body.safety.level).toBe("emergency"); expect(result.body.readyToConfirm).toBe(false); expect(provider.inputs).toHaveLength(0);
  });
  it("keeps a previously optional question when it becomes safety-critical", () => {
    const result = normalizeModelAssessment({...assessment(), questions:[{id:"access",prompt:"Is the flooded area electrified?",requiredForSafety:true}],readyToConfirm:true}, "STOP", ["access"]);
    expect(result.questions).toHaveLength(1); expect(result.readyToConfirm).toBe(false);
  });
  it("removes acknowledged optional repeats before checking model-requested readiness", () => {
    const result = normalizeModelAssessment({...assessment(), questions:[{id:"dimensions",prompt:"Width?",requiredForSafety:false}],readyToConfirm:true}, "STOP", ["dimensions"]);
    expect(result.questions).toEqual([]); expect(result.readyToConfirm).toBe(true);
  });
  it("does not invent a cause or readiness for unusable evidence", () => {
    const value = normalizeModelAssessment({ ...assessment(), evidenceQuality: "unusable", issueCandidates: [{ ...assessment().issueCandidates[0], likelihood: "high" }], readyToConfirm: true });
    expect(value.issueCandidates).toEqual([]);
    expect(value.readyToConfirm).toBe(false);
  });

  it("preserves prior evidence while accepting an additional photo in a follow-up", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    const firstPhoto = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    const nextPhoto = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
    const history = [{ role: "user", content: "Water under the sink" }];
    const first = await analyze(app, { locale: "en", history, mediaConsent: true }).attach("media", firstPhoto, "first.png").expect(200);
    const continuation = { locale: "en", history: [...history, { role: "assistant", content: first.body.reply }, { role: "user", content: "Here is the other side" }], mediaConsent: true, previousAssessmentToken: first.body.assessmentToken };
    await analyze(app, continuation).attach("media", firstPhoto, "first.png").attach("media", nextPhoto, "second.png").expect(200);
    expect(provider.inputs.at(-1)?.media).toHaveLength(2);
    await analyze(app, continuation).attach("media", nextPhoto, "replacement.png").expect(409, { error: "media_context_changed" });
  });

  it("continues a signed conversation beyond twenty messages without losing its prefix", async () => {
    const { app } = setup(new FakeIntakeProvider());
    const history = Array.from({ length: 21 }, (_, index) => ({ role: "user", content: `Observation ${index}: sink drips` }));
    const first = await analyze(app, { locale: "en", history }).expect(200);
    await analyze(app, { locale: "en", history: [...history, { role: "assistant", content: first.body.reply }, { role: "user", content: "Only while draining" }], previousAssessmentToken: first.body.assessmentToken }).expect(200);
  });

  it("removes image metadata before AI analysis", async () => {
    const source = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).jpeg().withExif({ IFD0: { Artist: "private-location-owner" } }).toBuffer();
    const sanitized = await sanitizeMediaBuffer(source, "image/jpeg");
    const metadata = await sharp(sanitized).metadata();
    expect(metadata.exif).toBeUndefined();
  });

  it("normalizes nullable details and keeps uncertain follow-up assessments unconfirmable", () => {
    const normalized = normalizeModelAssessment({ ...assessment(), issueCandidates: [], questions: [{ id: "closer_photo", prompt: "Can you send a closer photo?", requiredForSafety: false }], details: { location: null, dimensions: null, access: null, desiredTime: null }, readyToConfirm: true }, "STOP");
    expect(normalized).toMatchObject({ issueCandidates: [], details: {}, readyToConfirm: false });
  });

  it("keeps a model's unready decision when no questions remain", () => {
    expect(normalizeModelAssessment({ ...assessment(), readyToConfirm: false }).readyToConfirm).toBe(false);
  });

  it("normalizes benign model-generated IDs and accepts the signed normalized issue", async () => {
    const provider = new FakeIntakeProvider();
    provider.next = { ...assessment(), issueCandidates: [{ ...assessment().issueCandidates[0], id: "FÚGA de Agua 1" }] };
    const { app } = setup(provider);
    const analyzed = await analyze(app, { locale: "es", history: [{ role: "user", content: "Hay agua debajo del fregadero" }] }).expect(200);
    expect(analyzed.body.issueCandidates[0].id).toBe("fuga_de_agua_1");
    await request(app).post("/api/intake/confirm").set(bearer("customer")).send({ assessmentToken: analyzed.body.assessmentToken, customerName: "Alex", address: "Charlotte, NC", acceptedIssueIds: ["fuga_de_agua_1"], warningAcknowledged: true }).expect(201);
  });

  it("sanitizes the same short PNG and MP4 shapes used by integrated QA", async () => {
    const image = await sharp({ create: { width: 96, height: 96, channels: 3, background: "#B87E48" } }).png().toBuffer();
    const video = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xB87E48:s=96x96:d=1:r=5", "-an", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { maxBuffer: 2_000_000, timeout: 30_000, windowsHide: true });
    await expect(sanitizeMediaBuffer(image, "image/png")).resolves.toEqual(expect.any(Buffer));
    await expect(sanitizeMediaBuffer(video, "video/mp4")).resolves.toEqual(expect.any(Buffer));
  }, 90_000);

  it("rejects audio or video longer than sixty seconds", async () => {
    const audio = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "61", "-f", "mp3", "pipe:1"], { maxBuffer: 2_000_000, timeout: 30_000, windowsHide: true });
    await expect(sanitizeMediaBuffer(audio, "audio/mpeg")).rejects.toBeInstanceOf(MediaSanitizationError);
  }, 60_000);
  it("returns 503 when no real AI provider is configured", async () => {
    const unavailable = new FakeIntakeProvider();
    unavailable.analyze = async () => { throw new IntakeProviderUnavailableError("not_configured"); };
    const { app } = setup(unavailable);
    await analyze(app, { locale: "en", history: [{ role: "user", content: "My sink is leaking" }] }).expect(503, { error: "intake_ai_unavailable" });
  });

  it("returns a signed assessment while preserving the requested Spanish locale", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    const response = await analyze(app, { locale: "es", history: [{ role: "user", content: "El fregadero tiene una fuga" }] }).expect(200);
    expect(response.body).toMatchObject({ category: "plumbing", locale: "es" });
    expect(response.body.assessmentToken).toEqual(expect.any(String));
    expect(provider.inputs[0]?.locale).toBe("es");
  });

  it("never allows a safety question to be skipped", async () => {
    const provider = new FakeIntakeProvider();
    provider.next = assessment([{ id: "gas_smell", prompt: "Do you smell gas?", requiredForSafety: true }]);
    const { app } = setup(provider);
    const first = await analyze(app, { locale: "en", history: [{ role: "user", content: "The heater stopped" }] }).expect(200);
    await analyze(app, { locale: "en", history: [{ role: "user", content: "The heater stopped" }, { role: "assistant", content: assistantReply }], previousAssessmentToken: first.body.assessmentToken, skipped: { questionIds: ["gas_smell"], warningAcknowledged: true } }).expect(409, { error: "safety_question_cannot_be_skipped" });
  });

  it("requires the uncertainty warning before skipping a non-safety question", async () => {
    const provider = new FakeIntakeProvider();
    provider.next = assessment([{ id: "dimensions", prompt: "How large is the wet area?", requiredForSafety: false }]);
    const { app } = setup(provider);
    const first = await analyze(app, { locale: "en", history: [{ role: "user", content: "There is water under the sink" }] }).expect(200);
    const payload = { locale: "en", history: [{ role: "user", content: "There is water under the sink" }, { role: "assistant", content: assistantReply }], previousAssessmentToken: first.body.assessmentToken, skipped: { questionIds: ["dimensions"], warningAcknowledged: false } };
    await analyze(app, payload).expect(422, { error: "estimate_uncertainty_acknowledgment_required" });
    provider.next = assessment();
    const skipped = await analyze(app, { ...payload, skipped: { questionIds: ["dimensions"], warningAcknowledged: true } }).expect(200);
    expect(skipped.body.uncertaintyWarning).toEqual(expect.any(String));
    expect(provider.inputs[1]?.skippedQuestions).toEqual([{ id: "dimensions", prompt: "How large is the wet area?" }]);
  });

  it("applies a server safety floor even when the model reports normal", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    const response = await analyze(app, { locale: "en", history: [{ role: "user", content: "I smell gas next to the furnace" }] }).expect(200);
    expect(response.body.safety.level).toBe("emergency");
    expect(response.body.safety.hazards).toContain("gas");
    await request(app).post("/api/intake/confirm").set(bearer("customer")).send({ assessmentToken: response.body.assessmentToken, customerName: "A", address: "Charlotte", acceptedIssueIds: ["drain_leak"], warningAcknowledged: true }).expect(409);
  });

  it("does not turn denied hazards or assistant questions into an emergency", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    const safetyReply = "Do you smell gas or see smoke?";
    provider.next = { ...assessment([{ id: "hazard_check", prompt: safetyReply, requiredForSafety: true }]), reply: safetyReply };
    const first = await analyze(app, { locale: "en", history: [{ role: "user", content: "The heater stopped working" }] }).expect(200);
    provider.next = assessment();
    const response = await analyze(app, { locale: "en", history: [{ role: "user", content: "The heater stopped working" }, { role: "assistant", content: safetyReply }, { role: "user", content: "No smoke or gas smell." }], previousAssessmentToken: first.body.assessmentToken }).expect(200);
    expect(response.body.safety.level).toBe("normal");
  });

  it("hard-blocks rapidly rising flood water", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    const response = await analyze(app, { locale: "en", history: [{ role: "user", content: "The basement is filling rapidly with water" }] }).expect(200);
    expect(response.body.safety).toMatchObject({ level: "emergency", hazards: ["severe_flooding"] });
  });

  it("binds confirmation to the authenticated customer and persists the signed assessment", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    const analyzed = await analyze(app, { locale: "en", history: [{ role: "user", content: "Water leaks below my sink" }] }).expect(200);
    const confirmation = { assessmentToken: analyzed.body.assessmentToken, customerName: "Alex", address: "Charlotte, NC", acceptedIssueIds: ["drain_leak"], warningAcknowledged: true };
    await request(app).post("/api/intake/confirm").set(bearer("other")).send(confirmation).expect(401, { error: "invalid_assessment_token" });
    const confirmed = await request(app).post("/api/intake/confirm").set(bearer("customer")).send(confirmation).expect(201);
    expect(confirmed.body).toMatchObject({ status: "intake", matchCount: 0 });
    expect(confirmed.body.requestId).toEqual(expect.any(String));
  });

  it("rejects rewritten conversation history from a continuation token", async () => {
    const provider = new FakeIntakeProvider();
    provider.next = assessment([{ id: "dimensions", prompt: "How large is it?", requiredForSafety: false }]);
    const { app } = setup(provider);
    const first = await analyze(app, { locale: "en", history: [{ role: "user", content: "Water leaks below my sink" }] }).expect(200);
    await analyze(app, { locale: "en", history: [{ role: "user", content: "Rewritten first message" }, { role: "assistant", content: assistantReply }, { role: "user", content: "It is two inches wide" }], previousAssessmentToken: first.body.assessmentToken }).expect(409, { error: "conversation_history_mismatch" });
    expect(provider.inputs).toHaveLength(1);
  });

  it("limits each customer to one active AI request", async () => {
    const provider = new BlockingIntakeProvider();
    const { app } = setup(provider);
    const first = analyze(app, { locale: "en", history: [{ role: "user", content: "Water leaks below my sink" }] });
    const completion = first.then((response) => response);
    await provider.started;
    await analyze(app, { locale: "en", history: [{ role: "user", content: "A second request" }] }).expect(429, { error: "intake_request_in_progress" });
    expect(provider.inputs).toHaveLength(1);
    provider.finish();
    expect((await completion).status).toBe(200);
  });

  it("does not call the provider after the durable daily quota is exhausted", async () => {
    const provider = new FakeIntakeProvider();
    const budget = new InMemoryIntakeUsageBudget(undefined, { accountDailyCredits: 1, totalDailyCredits: 10, globalActive: 4, accountActive: 1 });
    const { app } = setup(provider, budget);
    await analyze(app, { locale: "en", history: [{ role: "user", content: "My sink leaks" }] }).expect(200);
    await analyze(app, { locale: "en", history: [{ role: "user", content: "Another unrelated repair" }] }).expect(429, { error: "intake_daily_quota_exceeded" });
    expect(provider.inputs).toHaveLength(1);
  });

  it("uses a real provider boundary for English-Spanish translation", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    const response = await request(app).post("/api/intake/translate").set(bearer("customer")).send({ text: "Possible leak", sourceLocale: "en", targetLocale: "es" }).expect(200);
    expect(response.body).toMatchObject({ original: "Possible leak", translated: "ES: Possible leak", sourceLocale: "en", targetLocale: "es" });
    expect(response.body.translationToken).toEqual(expect.any(String));
    expect(response.body.warning).toContain("prices");
  });

  it("rejects a forged translation before signing the assessment", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    await analyze(app, { locale: "en", history: [{ role: "user", content: "My sink leaks" }], translations: [{ original: "Price is $100", translated: "El precio es $10", sourceLocale: "en", targetLocale: "es", translationToken: "forged" }] }).expect(422, { error: "invalid_translation_receipt" });
    expect(provider.inputs).toHaveLength(0);
  });

  it("allows a verified translation-only refresh without rewriting history", async () => {
    const provider = new FakeIntakeProvider();
    const { app } = setup(provider);
    const first = await analyze(app, { locale: "en", history: [{ role: "user", content: "My sink leaks" }] }).expect(200);
    const translated = await request(app).post("/api/intake/translate").set(bearer("customer")).send({ text: assistantReply, sourceLocale: "en", targetLocale: "es" }).expect(200);
    const response = await analyze(app, { locale: "en", history: [{ role: "user", content: "My sink leaks" }, { role: "assistant", content: assistantReply }], previousAssessmentToken: first.body.assessmentToken, translations: [{ original: translated.body.original, translated: translated.body.translated, sourceLocale: "en", targetLocale: "es", translationToken: translated.body.translationToken }] }).expect(200);
    expect(response.body.assessmentToken).toEqual(expect.any(String));
  });
});
