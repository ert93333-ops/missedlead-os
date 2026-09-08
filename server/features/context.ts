import { createClient } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { z } from 'zod';

const actorSchema = z.object({ id: z.string().min(1), role: z.enum(['customer', 'provider', 'operator']), email: z.string().optional() });
export class FeatureError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'FeatureError'; }
}
export function featureActor(res: Response) { return actorSchema.parse(res.locals.actor); }
function credentials(service: boolean) {
  const url = process.env.SUPABASE_URL;
  const key = service ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new FeatureError(503, 'service_not_configured');
  return { url, key };
}
export function featureClient(req: Request) {
  const { url, key } = credentials(false);
  const authorization = req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new FeatureError(401, 'authentication_required');
  return createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
}
export function featureService() {
  const { url, key } = credentials(true);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function featureError(res: Response, error: unknown) {
  if (error instanceof FeatureError) return res.status(error.status).json({ error: error.code });
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_request', fields: error.issues.map(issue => issue.path.join('.')) });
  const failure = z.object({ code: z.string().optional(), message: z.string() }).safeParse(error);
  const code = failure.success ? failure.data.code : undefined;
  const message = failure.success && /^[a-z][a-z0-9_]{2,80}$/.test(failure.data.message) ? failure.data.message : 'feature_operation_failed';
  return res.status(code === '42501' ? 403 : code === 'PGRST116' ? 404 : code === '23505' || code === '23514' || code === 'P0001' ? 409 : 500).json({ error: message });
}
