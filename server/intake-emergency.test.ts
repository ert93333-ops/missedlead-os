/**
 * emergency 차단·안내·감사 기록 테스트.
 */
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { emergencyGuidance, registerEmergencyRoute } from './intake/emergency.js';
import { AssessmentTokenSigner } from './intake/token.js';
import { modelAssessmentSchema } from './intake/types.js';

const now = new Date('2026-09-05T12:00:00.000Z');
const signer = new AssessmentTokenSigner('safety-test-secret-at-least-thirty-two-characters');
describe('offline emergency guidance', () => {
  it.each(['The faucet drips', 'No gas smell', 'No hay olor a gas'])('returns no override for %s', content => {
    expect(emergencyGuidance({ history: [{role: 'user', content}], locale: 'en', actorId: 'customer', now })).toBeUndefined();
  });
  it.each([
    ['en', 'I smell gas', 'Stop'], ['es', 'Huele a gas', 'Detente'],
  ] as const)('returns %s guidance without AI, database or signer', (locale, content, text) => {
    const result = emergencyGuidance({history: [{role: 'user', content}], locale, actorId: 'customer', now});
    expect(result?.response.reply).toContain(text);
    expect(result?.response.readyToConfirm).toBe(false);
    expect(result?.response.issueCandidates).toEqual([]);
    expect(result?.response.assessmentToken).toBe('safety-guidance-only');
    expect(result?.signed).toBeUndefined();
    expect(modelAssessmentSchema.safeParse(result?.response).success).toBe(true);
    expect(() => signer.verify(result?.response.assessmentToken ?? '', 'customer', now)).toThrow();
  });
  it('signs emergency evidence for the requesting owner when configured', () => {
    const result = emergencyGuidance({history: [{role: 'user', content: 'Smoke from the outlet'}], locale: 'en', actorId: 'customer', now, signer});
    const verified = signer.verify(result?.response.assessmentToken ?? '', 'customer', now);
    expect(verified).toEqual(result?.signed);
    expect(verified.assessment.safety.level).toBe('emergency');
    expect(verified.assessment.readyToConfirm).toBe(false);
    expect(() => signer.verify(result?.response.assessmentToken ?? '', 'other', now)).toThrow();
  });
});

const offlineApp = () => {
  const app = express();
  app.use(express.json());
  registerEmergencyRoute(app);
  app.use((_request, response) => { response.status(503).json({ error: 'auth_database_down' }); });
  return app;
};
describe('public emergency preflight', () => {
  it('returns immediate guidance before unavailable authentication without credentials', async () => {
    const result = await request(offlineApp()).post('/api/intake/safety').send({locale: 'es', history: [{role: 'user', content: 'Huelo a gas cerca del calentador.'}]}).expect(200);
    expect(result.body.emergency).toBe(true);
    expect(result.body.assessment.assessmentToken).toBe('safety-guidance-only');
    expect(result.body.assessment.safety.level).toBe('emergency');
    expect(result.body.assessment.readyToConfirm).toBe(false);
  });
  it('returns no assessment for benign input', async () => {
    const result = await request(offlineApp()).post('/api/intake/safety').send({locale: 'en', history: [{role: 'user', content: 'No gas smell'}]}).expect(200);
    expect(result.body).toEqual({emergency: false});
  });
  it.each([
    {locale: 'ko', history: []},
    {locale: 'en', history: Array.from({length: 81}, () => ({role: 'user', content: 'hello'}))},
    {locale: 'en', history: [{role: 'user', content: 'x'.repeat(24001)}]},
  ])('rejects unbounded or invalid payloads', async payload => {
    await request(offlineApp()).post('/api/intake/safety').send(payload).expect(422);
  });
  it('limits the shared endpoint even if forwarded IP changes', async () => {
    const app = offlineApp();
    for (let index = 0; index < 120; index++) {
      await request(app).post('/api/intake/safety').set('X-Forwarded-For', '192.0.2.' + (index + 1)).send({locale: 'en', history: []}).expect(200);
    }
    await request(app).post('/api/intake/safety').set('X-Forwarded-For', '198.51.100.1').send({locale: 'en', history: []}).expect(429);
  }, 20_000);
});
