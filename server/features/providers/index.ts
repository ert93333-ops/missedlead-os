/**
 * 공급자 API 라우트: 지원서 조회/제출, 요청 큐, 견적 제출(submit_itemized_quote),
 * 허가 기록, 완료 보고 등. 인가는 featureClient(RLS)에 위임.
 */
import type { Express } from 'express';
import { z } from 'zod';
import { featureActor, featureClient, featureError, FeatureError } from '../context.js';
import { applicationSchema, quoteSchema, reviewSchema } from './schemas.js';
import { registerProviderDocuments } from './documents.js';

export function registerProviderRoutes(app: Express) {
  registerProviderDocuments(app);
  app.get('/api/providers/application', async (req, res) => {
    try {
      const db = featureClient(req), actor = featureActor(res);
      const { data: application, error } = await db.from('provider_applications').select('*').eq('provider_id', actor.id).maybeSingle();
      if (error) throw error;
      const docs = await db.from('provider_documents').select('id,kind,file_name,created_at').eq('provider_id', actor.id);
      if (docs.error) throw docs.error;
      res.json({ application, documents: docs.data });
    } catch (error) { featureError(res, error); }
  });
  app.put('/api/providers/application', async (req, res) => {
    try {
      const body = applicationSchema.parse(req.body);
      const { data, error } = await featureClient(req).rpc('save_provider_application', { p_data: body });
      if (error) throw error;
      res.json({ application: data });
    } catch (error) { featureError(res, error); }
  });
  app.get('/api/providers/applications', async (req, res) => {
    try {
      if (featureActor(res).role !== 'operator') throw new FeatureError(403, 'operator_required');
      const { data, error } = await featureClient(req).from('provider_applications').select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      res.json({ applications: data });
    } catch (error) { featureError(res, error); }
  });
  app.get('/api/providers/applications/:id', async (req, res) => {
    try {
      if (featureActor(res).role !== 'operator') throw new FeatureError(403, 'operator_required');
      const id = z.uuid().parse(req.params.id), db = featureClient(req);
      const result = await db.from('provider_applications').select('*').eq('provider_id', id).single();
      if (result.error) throw result.error;
      const docs = await db.from('provider_documents').select('id,kind,file_name,created_at').eq('provider_id', id);
      if (docs.error) throw docs.error;
      res.json({ application: result.data, documents: docs.data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/providers/applications/:id/review', async (req, res) => {
    try {
      const body = reviewSchema.parse(req.body);
      const { data, error } = await featureClient(req).rpc('review_provider_application', { p_provider_id: z.uuid().parse(req.params.id), p_decision: body.decision, p_reason: body.reason, p_reference: body.verificationReference });
      if (error) throw error;
      res.json({ application: data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/providers/requests/:id/respond', async (req, res) => {
    try {
      const { decision } = z.object({ decision: z.enum(['accept', 'decline']) }).parse(req.body);
      const { data, error } = await featureClient(req).rpc('respond_provider_match', { p_request_id: z.uuid().parse(req.params.id), p_decision: decision });
      if (error) throw error;
      res.json({ match: data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/providers/requests/:id/quote', async (req, res) => {
    try {
      const body = quoteSchema.parse(req.body);
      const requestId = z.uuid().parse(req.params.id);
      const db = featureClient(req);
      const { data, error } = await db.rpc('submit_itemized_quote', { p_request_id: requestId, p_data: body });
      if (error && ['provider not matched or already quoted', 'request is not accepting quotes', 'provider ineligible']
        .some((message) => error.message.includes(message))) {
        throw new FeatureError(403, 'provider_invitation_required');
      }
      if (error) throw error;
      res.status(201).json({ quote: data });
    } catch (error) { featureError(res, error); }
  });
  app.get('/api/requests/:id/quote-details', async (req, res) => {
    try {
      const { data, error } = await featureClient(req).from('quote_details').select('*').eq('request_id', z.uuid().parse(req.params.id));
      if (error) throw error;
      res.json({ details: data });
    } catch (error) { featureError(res, error); }
  });
}
