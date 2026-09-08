import { emergencyGuidance } from './emergency.js';
import { diagnosticContext } from './diagnosticContext.js';
import { createHash, randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Actor, Repository } from "../repository.js";
import { IntakeProviderResponseError, IntakeProviderUnavailableError, normalizeModelAssessment, type IntakeAiProvider } from "./provider.js";
import { MediaSanitizationError, sanitizeMediaBuffer } from "./media.js";
import { enforceSafetyFloor } from "./safety.js";
import { AssessmentTokenSigner, InvalidAssessmentTokenError } from "./token.js";
import { localeSchema, translationRecordSchema, type IntakeMedia, type SignedAssessment } from "./types.js";
import type { IntakeUsageBudget } from "./usage.js";

const MAX_FILE_BYTES = 25_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/webm", "audio/mp4", "audio/wav", "audio/x-wav"] as const;
const mediaTypeSchema = z.enum(MEDIA_TYPES);
const payloadSchema = z.object({
  locale: localeSchema,
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2_000) })).min(1).max(80).refine(messages => messages.reduce((total, message) => total + message.content.length, 0) <= 24_000, "conversation_too_long"),
  mediaConsent: z.boolean().default(false),
  translations: z.array(translationRecordSchema.extend({ translationToken: z.string().min(1) })).max(20).default([]),
  previousAssessmentToken: z.string().min(1).optional(),
  skipped: z.object({ questionIds: z.array(z.string().min(1)).max(6), warningAcknowledged: z.boolean() }).optional(),
});
const confirmSchema = z.object({
  assessmentToken: z.string().min(1),
  customerName: z.string().trim().min(1).max(120),
  address: z.string().trim().min(3).max(500),
  acceptedIssueIds: z.array(z.string().min(1)).min(1).max(5),
  warningAcknowledged: z.literal(true),
  scopeDetails: z.object({ location: z.string().max(300).optional(), dimensions: z.string().max(300).optional(), access: z.string().max(500).optional(), desiredTime: z.string().max(120).optional(), exclusions: z.array(z.string().max(300)).max(10).optional() }).optional(),
});
const translateSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  sourceLocale: localeSchema,
  targetLocale: localeSchema,
});

type RouteOptions = {
  readonly beforeConfirm?: (request: Request, address: string) => Promise<void>;
  readonly onSafety?: (signed: SignedAssessment) => Promise<boolean>;
  readonly onConfirmed?: (requestId: string) => Promise<{matchCount:number;status:string}>;
  readonly repository: Repository;
  readonly provider?: IntakeAiProvider;
  readonly signingSecret?: string;
  readonly usageBudget?: IntakeUsageBudget;
  readonly now: () => Date;
};

type BudgetedOperation = {
  readonly budget?: IntakeUsageBudget;
  readonly actorId: string;
  readonly credits: number;
  readonly now: Date;
  readonly response: Response;
  readonly operation: () => Promise<unknown>;
};

const withUsageBudget = async (input: BudgetedOperation): Promise<unknown> => {
  if (!input.budget) return input.response.status(503).json({ error: "intake_usage_unavailable" });
  let reservation;
  try {
    reservation = await input.budget.reserve(input.actorId, input.credits, input.now);
  } catch {
    return input.response.status(503).json({ error: "intake_usage_unavailable" });
  }
  if (!reservation.allowed) {
    const quota = reservation.reason === "account_quota" || reservation.reason === "total_quota";
    return input.response.status(429).json({ error: quota ? "intake_daily_quota_exceeded" : "intake_capacity_reached" });
  }
  try {
    return await input.operation();
  } finally {
    await input.budget.release(reservation.leaseId, input.actorId);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: MAX_FILE_BYTES, fieldSize: 100_000, fields: 2 },
  fileFilter: (_request, file, callback) => mediaTypeSchema.safeParse(file.mimetype).success
    ? callback(null, true)
    : callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "media")),
});

const actor = (response: Response): Actor => response.locals.actor as Actor;
const accessToken = (request: Request): string => request.header("Authorization")?.slice(7) ?? "";
const warning = "AI translation may be inaccurate. Confirm prices, scope, warranties, and legal terms before approval.";

const parsePayload = (request: Request, response: Response): z.infer<typeof payloadSchema> | undefined => {
  if (typeof request.body.payload !== "string") {
    response.status(400).json({ error: "invalid_request" });
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(request.body.payload);
  } catch {
    response.status(400).json({ error: "invalid_request" });
    return undefined;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) response.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
  return parsed.success ? parsed.data : undefined;
};

const sanitizeMedia = async (files: readonly Express.Multer.File[]): Promise<readonly IntakeMedia[]> => Promise.all(files.map(async (file) => {
  const type = mediaTypeSchema.parse(file.mimetype);
  const buffer = await sanitizeMediaBuffer(file.buffer, type);
  return { buffer, contentType: type, digest: createHash("sha256").update(file.buffer).digest("hex") };
}));

export const registerIntakeRoutes = (app: Express, options: RouteOptions): void => {
  const signer = options.signingSecret ? new AssessmentTokenSigner(options.signingSecret) : undefined;
  const aiRateLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (_request, response) => actor(response).id });
  const activeActors = new Set<string>();
  const concurrencyGuard = (_request: Request, response: Response, next: NextFunction): void => {
    const actorId = actor(response).id;
    if (activeActors.has(actorId)) {
      response.status(429).json({ error: "intake_request_in_progress" });
      return;
    }
    activeActors.add(actorId);
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      activeActors.delete(actorId);
    };
    response.once("finish", release);
    response.once("close", release);
    next();
  };

  app.post("/api/intake/analyze", aiRateLimit, concurrencyGuard, upload.array("media", 10), async (request, response) => {
    if (actor(response).role !== "customer") return response.status(403).json({ error: "forbidden" });
    const provider = options.provider;
    const payload = parsePayload(request, response);
    if (!payload) return;
    const emergency = emergencyGuidance({ history: payload.history, locale: payload.locale, actorId: actor(response).id, now: options.now(), signer });
    if (emergency) {
      if (emergency.signed && options.onSafety) void options.onSafety(emergency.signed).catch(() => console.warn("Emergency report storage unavailable"));
      return response.json(emergency.response);
    }
    if (!provider || !signer) return response.status(503).json({ error: "intake_ai_unavailable" });
    const translations: z.infer<typeof translationRecordSchema>[] = [];
    for (const submitted of payload.translations) {
      let receipt;
      try {
        receipt = signer.verifyTranslation(submitted.translationToken, actor(response).id, options.now());
      } catch (error) {
        if (error instanceof InvalidAssessmentTokenError) return response.status(422).json({ error: "invalid_translation_receipt" });
        throw error;
      }
      if (receipt.original !== submitted.original || receipt.translated !== submitted.translated || receipt.sourceLocale !== submitted.sourceLocale || receipt.targetLocale !== submitted.targetLocale) return response.status(422).json({ error: "invalid_translation_receipt" });
      translations.push({ original: receipt.original, translated: receipt.translated, sourceLocale: receipt.sourceLocale, targetLocale: receipt.targetLocale });
    }
    const files = Array.isArray(request.files) ? request.files : [];
    if (files.length > 0 && !payload.mediaConsent) return response.status(422).json({ error: "media_consent_required" });
    if (files.some((file) => !/^[\p{L}\p{N}\p{M} _().-]{1,120}$/u.test(file.originalname))) return response.status(400).json({ error: "invalid_media_name" });
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) return response.status(413).json({ error: "media_total_too_large" });
    return withUsageBudget({ budget: options.usageBudget, actorId: actor(response).id, credits: 1 + Math.ceil(totalBytes / 5_000_000), now: options.now(), response, operation: async () => {
    const media = await sanitizeMedia(files);
    let previous: SignedAssessment | undefined;
    if (payload.previousAssessmentToken) {
      try {
        previous = signer.verify(payload.previousAssessmentToken, actor(response).id, options.now());
      } catch (error) {
        if (error instanceof InvalidAssessmentTokenError) return response.status(401).json({ error: "invalid_assessment_token" });
        throw error;
      }
      if (previous.attachmentDigests.some((digest, index) => media[index]?.digest !== digest)) return response.status(409).json({ error: "media_context_changed" });
      if (previous.assessment.safety.level === "emergency") return response.status(409).json({ error: "safety_clearance_required", guidance: previous.assessment.safety.guidance });
    }
    const currentSkippedIds = payload.skipped?.questionIds ?? [];
    if (!previous && payload.history.some((message) => message.role === "assistant")) return response.status(422).json({ error: "conversation_history_mismatch" });
    if (previous) {
      const requiredPrefix = [...previous.history, { role: "assistant" as const, content: previous.assessment.reply }];
      const prefixMatches = requiredPrefix.every((message, index) => payload.history[index]?.role === message.role && payload.history[index]?.content === message.content);
      const suffix = payload.history.slice(requiredPrefix.length);
      if (!prefixMatches || suffix.some((message) => message.role !== "user") || (suffix.length === 0 && currentSkippedIds.length === 0 && payload.translations.length === 0)) return response.status(409).json({ error: "conversation_history_mismatch" });
    }
    if (currentSkippedIds.length > 0) {
      if (!previous) return response.status(422).json({ error: "previous_assessment_token_required" });
      const requested = new Set(currentSkippedIds);
      if (currentSkippedIds.some((id) => !previous.assessment.questions.some((question) => question.id === id))) return response.status(422).json({ error: "unknown_question_skip" });
      if (previous.assessment.questions.some((question) => requested.has(question.id) && question.requiredForSafety)) return response.status(409).json({ error: "safety_question_cannot_be_skipped" });
      if (!payload.skipped?.warningAcknowledged) return response.status(422).json({ error: "estimate_uncertainty_acknowledgment_required" });
    }
    const skippedIds = [...new Set([...(previous?.skippedQuestionIds ?? []), ...currentSkippedIds])];
    const currentSkippedQuestions = previous?.assessment.questions.filter((question) => currentSkippedIds.includes(question.id)).map((question) => ({ id: question.id, prompt: question.prompt })) ?? [];
    const skippedQuestions = [...(previous?.skippedQuestions ?? []), ...currentSkippedQuestions].filter((question, index, values) => values.findIndex((candidate) => candidate.id === question.id) === index);
    const rawAssessment = normalizeModelAssessment(await provider.analyze({ locale: payload.locale, history: payload.history, media, skippedQuestionIds: skippedIds, skippedQuestions }), "unknown", skippedIds);
    const safetyAssessment = enforceSafetyFloor(rawAssessment, payload.history, payload.locale);
    const remainingQuestions = safetyAssessment.questions.filter((question) => question.requiredForSafety || !skippedIds.includes(question.id));
    const assessment = { ...safetyAssessment, questions: remainingQuestions, readyToConfirm: safetyAssessment.readyToConfirm && safetyAssessment.issueCandidates.length > 0 && safetyAssessment.safety.level !== "emergency" && safetyAssessment.safety.hazards.length === 0 && remainingQuestions.length === 0 };
    const signed = {
      version: 1 as const,
      assessmentId: randomUUID(), actorId: actor(response).id,
      expiresAt: new Date(options.now().getTime() + 30 * 60_000).toISOString(),
      locale: payload.locale, assessment, skippedQuestionIds: skippedIds,
      skippedQuestions,
      uncertaintyAcknowledged: previous?.uncertaintyAcknowledged === true || payload.skipped?.warningAcknowledged === true,
      attachmentTypes: media.map((item) => item.contentType), attachmentNames: files.map((file) => file.originalname), attachmentDigests: media.map((item) => item.digest),
      history: payload.history, translations,
    };
    let safetyReportStored: boolean | undefined;
    if (assessment.safety.level === 'emergency' && options.onSafety) {
      try { safetyReportStored = await options.onSafety(signed); } catch { safetyReportStored = false; }
    }
    const referenced = diagnosticContext({ locale: payload.locale, history: payload.history, media, skippedQuestionIds: skippedIds, skippedQuestions }).records;
    const references = [...new Map(referenced.flatMap(record => record.sources).map(source => [source.url, { title: source.title, url: source.url }])).values()].slice(0, 5);
    return response.json({ ...assessment, references, safetyReportStored, locale: payload.locale, assessmentToken: signer.sign(signed), uncertaintyWarning: skippedIds.length ? "Skipped details can change the diagnosis and estimated quote." : undefined });
    } });
  });

  app.post("/api/intake/confirm", async (request, response) => {
    if (actor(response).role !== "customer") return response.status(403).json({ error: "forbidden" });
    if (!signer) return response.status(503).json({ error: "intake_ai_unavailable" });
    const input = confirmSchema.safeParse(request.body);
    if (!input.success) return response.status(400).json({ error: "invalid_request", issues: input.error.issues });
    let signed;
    try {
      signed = signer.verify(input.data.assessmentToken, actor(response).id, options.now());
    } catch (error) {
      if (error instanceof InvalidAssessmentTokenError) return response.status(401).json({ error: "invalid_assessment_token" });
      throw error;
    }
    if (signed.assessment.safety.level === "emergency" || signed.assessment.safety.hazards.length > 0) return response.status(409).json({ error: "safety_clearance_required", guidance: signed.assessment.safety.guidance });
    if (!signed.assessment.readyToConfirm) return response.status(409).json({ error: "assessment_not_ready" });
    if (signed.skippedQuestionIds.length > 0 && !signed.uncertaintyAcknowledged) return response.status(422).json({ error: "estimate_uncertainty_acknowledgment_required" });
    const accepted = new Set(input.data.acceptedIssueIds);
    const issues = signed.assessment.issueCandidates.filter((issue) => accepted.has(issue.id));
    if (issues.length !== accepted.size) return response.status(422).json({ error: "unknown_issue" });
    if (options.beforeConfirm) await options.beforeConfirm(request, input.data.address);
    const confidence = Math.max(...issues.map((issue) => ({ low: 0.35, medium: 0.6, high: 0.8 })[issue.likelihood]));
    const result = await options.repository.execute("confirm_intake", {
      customerName: input.data.customerName, address: input.data.address,
      description: signed.assessment.summary, category: signed.assessment.category,
      workScope: { symptom: signed.assessment.summary, ...signed.assessment.details, photos: [], exclusions: [], ...input.data.scopeDetails, skippedQuestionIds: signed.skippedQuestionIds, conversationTranscript: signed.history },
      triage: { category: signed.assessment.category, urgency: signed.assessment.safety.level === "urgent" ? "urgent" : "routine", possibleCauses: issues.map((issue) => issue.label), confidence, questions: signed.assessment.questions.map((question) => question.prompt), hazards: [], attachmentTypes: signed.attachmentTypes, uncertaintyAcknowledged: signed.uncertaintyAcknowledged, locale: signed.locale, translations: signed.translations },
      priceDisclosure: { source: "ai_intake_no_market_sample", sampleCount: 0, updatedAt: options.now().toISOString(), confidence: 0 }, assessmentId: signed.assessmentId,
    }, { actor: actor(response), accessToken: accessToken(request), now: options.now().toISOString() }, () => ({ status: 500, data: { error: "confirm_intake_not_implemented" } }));
    if (result.status < 300 && options.onConfirmed) {
      const saved = z.object({ requestId: z.string().uuid() }).safeParse(result.data);
      if (saved.success) { const updated=await options.onConfirmed(saved.data.requestId); result.data={requestId:saved.data.requestId,...updated}; }
    }
    return response.status(result.status).json(result.data);
  });

  app.post("/api/intake/translate", aiRateLimit, concurrencyGuard, async (request, response) => {
    if (actor(response).role !== "customer") return response.status(403).json({ error: "forbidden" });
    const input = translateSchema.safeParse(request.body);
    if (!input.success) return response.status(400).json({ error: "invalid_request", issues: input.error.issues });
    if (!signer) return response.status(503).json({ error: "intake_ai_unavailable" });
    if (!options.provider && input.data.sourceLocale !== input.data.targetLocale) return response.status(503).json({ error: "intake_ai_unavailable" });
    return withUsageBudget({ budget: options.usageBudget, actorId: actor(response).id, credits: 1, now: options.now(), response, operation: async () => {
    const translated = input.data.sourceLocale === input.data.targetLocale ? input.data.text : await options.provider?.translate(input.data.text, input.data.sourceLocale, input.data.targetLocale);
    if (!translated) return response.status(503).json({ error: "intake_ai_unavailable" });
    const record = { original: input.data.text, translated, sourceLocale: input.data.sourceLocale, targetLocale: input.data.targetLocale };
    const translationToken = signer.signTranslation({ version: 1, actorId: actor(response).id, expiresAt: new Date(options.now().getTime() + 30 * 60_000).toISOString(), ...record });
    return response.json({ ...record, translationToken, warning });
    } });
  });

  app.use((error: unknown, _request: Request, response: Response, next: (error?: unknown) => void) => {
    if (error instanceof multer.MulterError) return response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "invalid_media_upload" });
    if (error instanceof IntakeProviderUnavailableError) return response.status(503).json({ error: "intake_ai_unavailable" });
    if (error instanceof IntakeProviderResponseError) {
      console.warn("intake provider response rejected", { finishReason: error.finishReason, issues: error.issues });
      return response.status(502).json({ error: "invalid_provider_response" });
    }
    if (error instanceof MediaSanitizationError) {
      console.warn("intake media sanitization failed", { contentType: error.contentType });
      return response.status(422).json({ error: "media_sanitization_failed" });
    }
    return next(error);
  });
};
