import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, InMemoryRepository, type AuthAdapter } from "./app.js";
import {
  IntakeProviderResponseError,
  IntakeProviderUnavailableError,
  type IntakeAiProvider,
} from "./intake/provider.js";
import { refineRemoteAssessment } from "./intake/remoteAssessment.js";
import type { AnalyzeInput, ModelAssessment } from "./intake/types.js";
import { InMemoryIntakeUsageBudget } from "./intake/usage.js";

const input: AnalyzeInput = {
  locale: "en",
  history: [{ role: "user", content: "Listen to this" }],
  media: [{ buffer: Buffer.from("audio-fixture"), contentType: "audio/wav", digest: "fixture" }],
  skippedQuestionIds: [],
  skippedQuestions: [],
};
const assessment: ModelAssessment = {
  reply: "Possible fill valve issue",
  category: "plumbing",
  summary: "Running toilet",
  issueCandidates: [{ id: "fill", label: "Fill valve", likelihood: "high", reason: "Reported hiss", evidenceNeeded: [] }],
  questions: [],
  details: {},
  safety: { level: "normal", hazards: [], guidance: "" },
  readyToConfirm: true,
};

it("asks for distinguishing information before accepting first media assessment", () => {
  const result = refineRemoteAssessment(assessment, input);
  expect(result.readyToConfirm).toBe(false);
  expect(result.questions).toHaveLength(1);
  expect(result.issueCandidates[0]?.likelihood).toBe("medium");
});

it("allows followup with explicit optional skip to remain eligible", () => {
  const result = refineRemoteAssessment(assessment, {
    ...input,
    history: [...input.history, { role: "assistant", content: "Equipment model?" }, { role: "user", content: "I cannot provide it" }],
    skippedQuestionIds: ["confirm_observations"],
  });
  expect(result.readyToConfirm).toBe(true);
});

it("never replaces emergency guidance with routine evidence collection", () => {
  const result = refineRemoteAssessment(
    { ...assessment, safety: { level: "emergency", hazards: ["gas"], guidance: "Leave" }, readyToConfirm: false },
    input,
  );
  expect(result.questions).toEqual([]);
  expect(result.readyToConfirm).toBe(false);
});

const actors = {
  customer: { id: "customer", role: "customer" as const },
  other: { id: "other", role: "customer" as const },
};
const auth: AuthAdapter = { async authenticate(token) { return actors[token as keyof typeof actors] ?? null; } };
const bearer = (token: keyof typeof actors) => ({ Authorization: `Bearer ${token}` });
const signingSecret = "synthetic-intake-signing-secret-with-at-least-32-bytes";

class SyntheticProvider implements IntakeAiProvider {
  constructor(
    private readonly outcome: ModelAssessment | Error = assessment,
    readonly analyzeCalls: AnalyzeInput[] = [],
  ) {}

  async analyze(value: AnalyzeInput): Promise<ModelAssessment> {
    this.analyzeCalls.push(value);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }

  async translate(text: string): Promise<string> {
    return text;
  }
}

const analyzed = (app: ReturnType<typeof createApp>, content = "My toilet keeps running") => request(app)
  .post("/api/intake/analyze")
  .set(bearer("customer"))
  .field("payload", JSON.stringify({ locale: "en", history: [{ role: "user", content }] }));

const syntheticApp = (
  provider: IntakeAiProvider,
  now: () => Date = () => new Date("2026-09-05T12:00:00.000Z"),
  usageBudget = new InMemoryIntakeUsageBudget(),
) => {
  const repository = new InMemoryRepository();
  return {
    app: createApp({
      repository,
      auth,
      paymentsMode: "disabled",
      intakeProvider: provider,
      intakeSigningSecret: signingSecret,
      intakeUsageBudget: usageBudget,
      now,
    }),
    repository,
  };
};

describe("synthetic staging intake contract", () => {
  it.each([
    ["unavailable", new IntakeProviderUnavailableError("not_configured")],
    ["quota-like upstream rejection", new IntakeProviderUnavailableError("request_failed", 429, "provider")],
    ["timeout", new IntakeProviderUnavailableError("request_failed", undefined, "timeout")],
  ])("fails closed for %s without exposing provider details", async (_label, failure) => {
    const provider = new SyntheticProvider(failure);
    const { app } = syntheticApp(provider);
    await analyzed(app).expect(503, { error: "intake_ai_unavailable" });
    expect(provider.analyzeCalls).toHaveLength(1);
  });

  it("rejects a malformed model response instead of signing it", async () => {
    const provider = new SyntheticProvider({ reply: "" } as ModelAssessment);
    const { app } = syntheticApp(provider);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await analyzed(app).expect(502, { error: "invalid_provider_response" });
    expect(warning).toHaveBeenCalledWith("intake provider response rejected", expect.objectContaining({ issues: expect.any(Array) }));
    warning.mockRestore();
  });

  it("rejects actor-bound and expired confirmations", async () => {
    let now = new Date("2026-09-05T12:00:00.000Z");
    const { app } = syntheticApp(new SyntheticProvider(), () => now);
    const result = await analyzed(app).expect(200);
    const confirmation = {
      assessmentToken: result.body.assessmentToken,
      customerName: "Synthetic customer",
      address: "Synthetic staging address",
      acceptedIssueIds: ["fill"],
      warningAcknowledged: true,
    };
    await request(app).post("/api/intake/confirm").set(bearer("other")).send(confirmation)
      .expect(401, { error: "invalid_assessment_token" });
    now = new Date("2026-09-05T12:31:00.000Z");
    await request(app).post("/api/intake/confirm").set(bearer("customer")).send(confirmation)
      .expect(401, { error: "invalid_assessment_token" });
  });

  it("accepts and queries a synthetic request while money remains disabled", async () => {
    const { app, repository } = syntheticApp(new SyntheticProvider());
    const result = await analyzed(app).expect(200);
    const confirmed = await request(app).post("/api/intake/confirm").set(bearer("customer")).send({
      assessmentToken: result.body.assessmentToken,
      customerName: "Synthetic customer",
      address: "Synthetic staging address",
      acceptedIssueIds: ["fill"],
      warningAcknowledged: true,
    }).expect(201);
    expect(confirmed.body).toMatchObject({ status: "intake", matchCount: 0, requestId: expect.any(String) });

    const capabilities = await request(app).get("/api/capabilities").expect(200);
    expect(capabilities.body.payments).toEqual({ mode: "disabled", enabled: false, provider: "stripe" });
    const dashboard = await request(app).get("/api/dashboard").set(bearer("customer")).expect(200);
    expect(dashboard.body.requests).toEqual([
      expect.objectContaining({ id: confirmed.body.requestId, status: "intake", customerId: "customer" }),
    ]);
    expect(repository.inspect((state) => ({ payments: state.payments, claims: state.claims })))
      .toEqual({ payments: [], claims: {} });
  });
});
