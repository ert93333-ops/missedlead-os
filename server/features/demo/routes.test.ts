/**
 * 데모 로그인 라우트의 모드·자격증명·env 검증 테스트.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDemoRoutes } from './routes.js';
function app() { const app = express(); app.use(express.json()); registerDemoRoutes(app); return app; }
afterEach(() => vi.unstubAllEnvs());
describe('demo login boundary', () => {
 it('fails closed when demo is disabled', async () => {
  vi.stubEnv('DEMO_MODE','false');
  const response = await request(app()).post('/api/demo/login').send({username:'test',password:'test'});
  expect(response.status).toBe(404);
 });
 it('rejects incorrect credentials before contacting authentication', async () => {
  vi.stubEnv('DEMO_MODE','true');
  const response = await request(app()).post('/api/demo/login').send({username:'test',password:'wrong'});
  expect(response.status).toBe(401);
 });
 it('fails closed when the strong account configuration is missing', async () => {
  vi.stubEnv('DEMO_MODE','true');vi.stubEnv('DEMO_CUSTOMER_PASSWORD','');
  const response = await request(app()).post('/api/demo/login').send({username:'test',password:'test'});
  expect(response.status).toBe(503);
 });
 it('limits repeated login attempts', async () => {
  vi.stubEnv('DEMO_MODE','true'); const service=app();
  for(let attempt=0;attempt<10;attempt++) await request(service).post('/api/demo/login').send({username:'test',password:'wrong'});
  const response = await request(service).post('/api/demo/login').send({username:'test',password:'wrong'});
  expect(response.status).toBe(429);
 });
});
