import type { Express, Request } from 'express';
import { z } from 'zod';
import { featureClient, featureError, featureService, FeatureError } from '../context.js';

const id = z.string().uuid();
export async function accessibleRequest(req: Request, requestId: string) {
  const client = featureClient(req);
  const result = await client.from('service_requests').select('id,customer_id').eq('id', requestId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new FeatureError(403, 'request_access_required');
  return client;
}
const message = z.object({ id, request_id: id, sender_id: id, body: z.string(), created_at: z.string() });
const schedule = z.object({ id, request_id: id, starts_at: z.string(), time_zone: z.string(), status: z.string(), changed_at: z.string(), changed_by: id.nullable() });
const evidence = z.object({ id, request_id: id, kind: z.string(), storage_path: z.string(), created_at: z.string() });
const media = z.object({ evidence_id: id, file_name: z.string(), content_type: z.string(), size_bytes: z.coerce.number(), object_path: z.string(), note: z.string() });

export function registerActivityRoutes(app: Express) {
  app.get('/api/requests/:id/activity', async (req, res) => {
    try {
      const requestId = id.parse(req.params.id);
      const client = await accessibleRequest(req, requestId);
      const [messages, schedules, evidenceRows, mediaRows, ack] = await Promise.all([
        client.from('request_messages').select('*').eq('request_id', requestId).order('created_at'),
        client.from('schedule_history').select('*').eq('request_id', requestId).order('changed_at'),
        client.from('evidence').select('*').eq('request_id', requestId).order('created_at'),
        client.from('evidence_media').select('*').eq('request_id', requestId),
        client.from('completion_acknowledgments').select('request_id,accepted_at').eq('request_id', requestId).maybeSingle(),
      ]);
      for (const result of [messages, schedules, evidenceRows, mediaRows, ack]) if (result.error) throw result.error;
      const attachments = z.array(media).parse(mediaRows.data);
      const evidenceItems = await Promise.all(z.array(evidence).parse(evidenceRows.data).map(async row => {
        const attached = attachments.find(item => item.evidence_id === row.id);
        const files = [];
        if (attached) {
          const signed = await featureService().storage.from('request-media-private').createSignedUrl(attached.object_path, 60);
          if (signed.error) throw signed.error;
          files.push({ id: row.id, fileName: attached.file_name, contentType: attached.content_type, sizeBytes: attached.size_bytes, url: signed.data.signedUrl, expiresInSeconds: 60 });
        }
        return { id: row.id, requestId, kind: row.kind, note: attached?.note ?? (row.storage_path.includes('/evidence/') ? '' : row.storage_path), createdAt: row.created_at, media: files };
      }));
      const acknowledgment = ack.data ? z.object({ request_id: id, accepted_at: z.string() }).parse(ack.data) : null;
      return res.json({ messages: z.array(message).parse(messages.data).map(row => ({ id: row.id, requestId, senderId: row.sender_id, text: row.body, createdAt: row.created_at })),
        schedules: z.array(schedule).parse(schedules.data).map(row => ({ id: row.id, requestId, startsAt: row.starts_at, timeZone: row.time_zone, status: row.status, changedAt: row.changed_at, changedBy: row.changed_by })),
        evidence: evidenceItems, acknowledgment: acknowledgment ? { requestId, acceptedAt: acknowledgment.accepted_at } : null });
    } catch (error) { return featureError(res, error); }
  });
  app.post('/api/requests/:id/completion-ack', async (req, res) => {
    try {
      z.object({ accepted: z.literal(true) }).parse(req.body);
      const { data, error } = await featureClient(req).rpc('acknowledge_completion', { p_request: id.parse(req.params.id) }).single();
      if (error) throw error;
      const ack = z.object({ request_id: id, accepted_at: z.string() }).parse(data);
      return res.json({ requestId: ack.request_id, acceptedAt: ack.accepted_at });
    } catch (error) { return featureError(res, error); }
  });
  app.put('/api/requests/:id/permit', async (req, res) => {
    try {
      const input = z.object({ permitNumber: z.string().trim().min(2), inspectionStatus: z.enum(['pending', 'passed', 'failed']), verificationReference: z.string().min(5).optional() }).parse(req.body);
      const { data, error } = await featureClient(req).rpc('record_job_permit', { p_request: id.parse(req.params.id), p_number: input.permitNumber, p_inspection: input.inspectionStatus, p_reference: input.verificationReference ?? null }).single();
      if (error) throw error;
      return res.json({ permit: data });
    } catch (error) { return featureError(res, error); }
  });
}
