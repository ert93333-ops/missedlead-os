import type { Express, Request } from 'express';
import { z } from 'zod';
import type { SignedAssessment } from '../../intake/types.js';
import { featureActor, featureClient, featureError, featureService, FeatureError } from '../context.js';
import { registerActivityRoutes } from './activity.js';
import { registerEvidenceUploads } from './uploads.js';

export async function validateCoverage(req: Request, address: string) {
  const { data, error } = await featureClient(req).from('service_zips').select('zip');
  if (error) throw error;
  if (!data.length) throw new FeatureError(409, 'service_area_not_configured');
  const zip = address.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  if (!zip || !data.some(row => row.zip === zip)) throw new FeatureError(422, 'service_zip_unavailable');
}
export async function recordSafetyReport(signed: SignedAssessment): Promise<boolean> {
  const { error } = await featureService().from('safety_reports').upsert({ id: signed.assessmentId, customer_id: signed.actorId, category: signed.assessment.category, summary: signed.assessment.summary, guidance: signed.assessment.safety.guidance, hazards: signed.assessment.safety.hazards }, { onConflict: 'id' });
  return !error;
}
export function registerLifecycleRoutes(app: Express) {
  registerActivityRoutes(app); registerEvidenceUploads(app);
  app.get('/api/me', (_req, res) => res.json({ actor: featureActor(res) }));
  app.get('/api/coverage', async (req, res) => {
    try { const { data, error } = await featureClient(req).from('service_zips').select('zip').order('zip'); if (error) throw error; return res.json({ zips: data.map(row => row.zip), configured: data.length > 0 }); }
    catch (error) { return featureError(res, error); }
  });
  app.put('/api/coverage', async (req, res) => {
    try { const input = z.object({ zips: z.array(z.string().regex(/^\d{5}$/)).min(1).max(50) }).parse(req.body); const { error } = await featureClient(req).rpc('set_service_zips', { p_zips: input.zips }); if (error) throw error; return res.json({ zips: input.zips, configured: true }); }
    catch (error) { return featureError(res, error); }
  });
  app.get('/api/properties', async (req, res) => {
    try { const { data, error } = await featureClient(req).from('customer_properties').select('*').order('created_at'); if (error) throw error; return res.json({ properties: data }); }
    catch (error) { return featureError(res, error); }
  });
  app.post('/api/properties', async (req, res) => {
    try {
      const input = z.object({ label: z.string().trim().min(1).max(120), address: z.string().trim().min(5).max(500), zip: z.string().regex(/^\d{5}$/), buildingType: z.enum(['house', 'condo', 'apartment', 'commercial']) }).parse(req.body);
      await validateCoverage(req, input.address);
      if (!input.address.includes(input.zip)) throw new FeatureError(400, 'address_zip_mismatch');
      const { data, error } = await featureClient(req).from('customer_properties').insert({ customer_id: featureActor(res).id, label: input.label, address: input.address, zip: input.zip, building_type: input.buildingType }).select('*').single();
      if (error) throw error; return res.status(201).json({ property: data });
    } catch (error) { return featureError(res, error); }
  });
  app.get('/api/reference-price', async (req, res) => {
    try { const category = z.enum(['plumbing', 'hvac', 'handyman']).parse(req.query.category); const { data, error } = await featureClient(req).rpc('reference_price', { p_category: category }); if (error) throw error; return res.json(data); }
    catch (error) { return featureError(res, error); }
  });
  app.get('/api/safety-reports', async (req, res) => {
    try { const { data, error } = await featureClient(req).from('safety_reports').select('*').order('created_at', { ascending: false }).limit(100); if (error) throw error; return res.json({ reports: data }); }
    catch (error) { return featureError(res, error); }
  });
  app.post('/api/safety-reports/:id/resolve', async (req, res) => {
    try { const resolution = z.object({ resolution: z.string().trim().min(3).max(2000) }).parse(req.body); const { error } = await featureClient(req).rpc('resolve_safety_report', { p_id: z.string().uuid().parse(req.params.id), p_resolution: resolution.resolution }); if (error) throw error; return res.json({ ok: true }); }
    catch (error) { return featureError(res, error); }
  });
}
