/**
 * 케어(사후관리) 기능: 번들 우선순위 적용/갱신, 전담 기사 제안·수락·해제, 유지보수 리마인더.
 * care_* RPC 호출 래퍼 모음.
 */
import type { Express } from 'express';
import { z } from 'zod';
import { featureClient, featureService, featureError } from '../context.js';

const id = z.string().uuid();
export async function applyCarePriority(requestId: string): Promise<void> {
  const { error } = await featureService().rpc('care_apply_priority', { p_request: id.parse(requestId) });
  if (error) throw error;
}
export async function refreshCarePriority(): Promise<void> {
  const { error } = await featureService().rpc('care_refresh_priority');
  if (error) throw error;
}
export function registerCareRoutes(app: Express): void {
  app.get('/api/care', async (req, res) => {
    try {
      const client = featureClient(req);
      const refreshed = await client.rpc('care_refresh_priority');
      if (refreshed.error) throw refreshed.error;
      const tables = ['care_bundles', 'care_dedicated', 'care_maintenance', 'care_reminders', 'care_priority'] as const;
      const results = await Promise.all(tables.map(table => client.from(table).select(table === 'care_bundles' ? '*,care_bundle_items(request_id)' : '*').limit(200)));
      for (const result of results) if (result.error) throw result.error;
      return res.json({ bundles: results[0].data, dedicated: results[1].data, maintenance: results[2].data, reminders: results[3].data, priority: results[4].data });
    } catch (error) { return featureError(res, error); }
  });
  app.post('/api/care/bundles', async (req, res) => {
    try {
      const input = z.object({ requestIds: z.array(id).min(2).max(5) }).parse(req.body);
      const { data, error } = await featureClient(req).rpc('care_create_bundle', { p_requests: input.requestIds });
      if (error) throw error;
      return res.status(201).json({ id: data });
    } catch (error) { return featureError(res, error); }
  });
  app.post('/api/care/bundles/:id/release', async (req, res) => {
    try {
      const { error } = await featureClient(req).rpc('care_release_bundle', { p_id: id.parse(req.params.id) });
      if (error) throw error;
      return res.json({ ok: true });
    } catch (error) { return featureError(res, error); }
  });
  app.post('/api/care/dedicated/:id', async (req, res) => {
    try {
      const input = z.object({ action: z.enum(['accept', 'release']) }).parse(req.body);
      const { data, error } = await featureClient(req).rpc('care_set_dedicated', { p_id: id.parse(req.params.id), p_action: input.action });
      if (error) throw error;
      return res.json(data);
    } catch (error) { return featureError(res, error); }
  });
  app.post('/api/care/priority/:requestId', async (req, res) => {
    try {
      const input = z.object({ action: z.enum(['accept', 'decline']) }).parse(req.body);
      const { error } = await featureClient(req).rpc('care_respond_priority', { p_request: id.parse(req.params.requestId), p_action: input.action });
      if (error) throw error;
      return res.json({ ok: true });
    } catch (error) { return featureError(res, error); }
  });
  app.post('/api/care/maintenance/:requestId', async (req, res) => {
    try {
      const input = z.object({ assetName: z.string().trim().min(1).max(160), parts: z.array(z.object({ name: z.string().trim().min(1).max(160), quantity: z.number().int().min(1).max(999) })).max(30), nextServiceAt: z.string().datetime({ offset: true }).optional() }).parse(req.body);
      const { data, error } = await featureClient(req).rpc('care_record_maintenance', { p_request: id.parse(req.params.requestId), p_asset: input.assetName, p_parts: input.parts, p_next: input.nextServiceAt ?? null });
      if (error) throw error;
      return res.json(data);
    } catch (error) { return featureError(res, error); }
  });
  app.post('/api/care/reminders/:id', async (req, res) => {
    try {
      z.object({ action: z.literal('dismiss') }).parse(req.body);
      const { error } = await featureClient(req).rpc('care_dismiss_reminder', { p_id: id.parse(req.params.id) });
      if (error) throw error;
      return res.json({ ok: true });
    } catch (error) { return featureError(res, error); }
  });
}
