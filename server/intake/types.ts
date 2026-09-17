/**
 * 인테이크 도메인 zod 스키마와 타입: locale/category/safety/hazard, 평가 결과, 입력 페이로드.
 */
import { z } from "zod";

export const localeSchema = z.enum(["en", "es"]);
export const categorySchema = z.enum(["plumbing", "hvac", "handyman"]);
export const likelihoodSchema = z.enum(["low", "medium", "high"]);
export const safetyLevelSchema = z.enum(["normal", "urgent", "emergency"]);
export const hazardSchema = z.enum(["gas", "fire", "structural", "electrical", "severe_flooding"]);
export const translationRecordSchema = z.object({
  original: z.string().min(1).max(4_000),
  translated: z.string().min(1).max(8_000),
  sourceLocale: localeSchema,
  targetLocale: localeSchema,
});

export const issueCandidateSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,48}$/),
  label: z.string().trim().min(1).max(120),
  likelihood: likelihoodSchema,
  reason: z.string().trim().min(1).max(500),
  evidenceNeeded: z.array(z.string().trim().min(1).max(240)).max(5),
});

export const followupQuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,48}$/),
  prompt: z.string().trim().min(1).max(500),
  requiredForSafety: z.boolean(),
});

export const modelAssessmentSchema = z.object({
  reply: z.string().trim().min(1).max(2_000),
  category: categorySchema,
  summary: z.string().trim().min(3).max(1_000),
  issueCandidates: z.array(issueCandidateSchema).max(5),
  questions: z.array(followupQuestionSchema).max(6),
  details: z.object({
    location: z.string().trim().min(1).max(240).optional(),
    dimensions: z.string().trim().min(1).max(120).optional(),
    access: z.string().trim().min(1).max(240).optional(),
    desiredTime: z.string().datetime().optional(),
  }).default({}),
  safety: z.object({
    level: safetyLevelSchema,
    hazards: z.array(hazardSchema).max(5),
    guidance: z.string().trim().max(1_000),
  }),
  readyToConfirm: z.boolean(),
}).superRefine((value, context) => {
  if (value.safety.level === "emergency" && value.readyToConfirm) {
    context.addIssue({ code: "custom", message: "emergency assessments cannot be confirmed", path: ["readyToConfirm"] });
  }
  if (value.questions.length > 0 && value.readyToConfirm) {
    context.addIssue({ code: "custom", message: "follow-up questions must be answered or explicitly skipped", path: ["readyToConfirm"] });
  }
  if (value.issueCandidates.length === 0 && value.readyToConfirm) {
    context.addIssue({ code: "custom", message: "an issue candidate is required before confirmation", path: ["readyToConfirm"] });
  }
});

export type IntakeLocale = z.infer<typeof localeSchema>;
export type ModelAssessment = z.infer<typeof modelAssessmentSchema>;

export type IntakeMedia = {
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly digest: string;
};

export type AnalyzeInput = {
  readonly locale: IntakeLocale;
  readonly history: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly media: readonly IntakeMedia[];
  readonly skippedQuestionIds: readonly string[];
  readonly skippedQuestions: readonly { readonly id: string; readonly prompt: string }[];
};

export interface IntakeProvider {
  analyze(input: AnalyzeInput): Promise<ModelAssessment>;
}

export const signedAssessmentSchema = z.object({
  version: z.literal(1),
  assessmentId: z.string().uuid(),
  actorId: z.string().min(1),
  expiresAt: z.string().datetime(),
  locale: localeSchema,
  assessment: modelAssessmentSchema,
  skippedQuestionIds: z.array(z.string().min(1)).max(20),
  skippedQuestions: z.array(z.object({ id: z.string().min(1).max(48), prompt: z.string().min(1).max(500) })).max(20).default([]),
  askedQuestions: z.array(z.string().min(1).max(500)).max(60).default([]),
  uncertaintyAcknowledged: z.boolean(),
  attachmentTypes: z.array(z.string().min(1)).max(10),
  attachmentNames: z.array(z.string().regex(/^[\p{L}\p{N}\p{M} _().-]{1,120}$/u)).max(10),
  attachmentDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2_000) })).max(80).refine(messages => messages.reduce((total, message) => total + message.content.length, 0) <= 24_000, "conversation_too_long"),
  translations: z.array(translationRecordSchema).max(20),
});

export type SignedAssessment = z.infer<typeof signedAssessmentSchema>;

export const signedTranslationSchema = translationRecordSchema.extend({
  version: z.literal(1), actorId: z.string().min(1), expiresAt: z.string().datetime(),
});
export type SignedTranslation = z.infer<typeof signedTranslationSchema>;
