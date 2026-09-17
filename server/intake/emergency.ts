/**
 * 응급 경로: emergency 판정 시 매칭/결제를 차단하고 긴급 안내·감사 이벤트를 기록한다.
 */
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { enforceSafetyFloor } from './safety.js';
import type { AssessmentTokenSigner } from './token.js';
import type { AnalyzeInput, IntakeLocale, ModelAssessment, SignedAssessment } from './types.js';

type EmergencyInput = {
  readonly history: AnalyzeInput['history'];
  readonly locale: IntakeLocale;
  readonly actorId: string;
  readonly now: Date;
  readonly signer?: AssessmentTokenSigner;
};
type EmergencyResult = {
  readonly response: ModelAssessment & { readonly locale: IntakeLocale; readonly assessmentToken: string };
  readonly signed?: SignedAssessment;
};

export const emergencyGuidance = (input: EmergencyInput): EmergencyResult | undefined => {
  const summary = input.locale === 'es' ? 'Se ha informado de un posible peligro inmediato.' : 'A possible immediate hazard was reported.';
  const assessment = enforceSafetyFloor({
    reply: summary, summary, category: 'handyman', issueCandidates: [], questions: [], details: {},
    safety: { level: 'normal', hazards: [], guidance: '' }, readyToConfirm: false,
  }, input.history, input.locale);
  if (assessment.safety.level !== 'emergency') return undefined;
  if (!input.signer) return { response: { ...assessment, locale: input.locale, assessmentToken: 'safety-guidance-only' } };
  const signed: SignedAssessment = {
    version: 1, assessmentId: randomUUID(), actorId: input.actorId,
    expiresAt: new Date(input.now.getTime() + 30 * 60_000).toISOString(),
    locale: input.locale, assessment, history: input.history.map(message => ({ ...message })),
    skippedQuestionIds: [], skippedQuestions: [], askedQuestions: [], uncertaintyAcknowledged: false,
    attachmentTypes: [], attachmentNames: [], attachmentDigests: [], translations: [],
  };
  return { response: { ...assessment, locale: input.locale, assessmentToken: input.signer.sign(signed) }, signed };
};

const safetyPayloadSchema = z.object({
  locale: z.enum(['en', 'es']),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']), content: z.string().min(1).max(24_000),
  })).max(80),
});

export const registerEmergencyRoute = (app: Express): void => {
  const limiter = rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: () => 'public-emergency',
    message: { error: 'safety_rate_limit' },
  });
  app.post('/api/intake/safety', limiter, (request, response) => {
    const parsed = safetyPayloadSchema.safeParse(request.body);
    if (!parsed.success) { response.status(422).json({ error: 'invalid_safety_payload' }); return; }
    const result = emergencyGuidance({ ...parsed.data, actorId: 'public', now: new Date() });
    response.setHeader('Cache-Control', 'no-store');
    response.json(result ? { emergency: true, assessment: result.response } : { emergency: false });
  });
};
