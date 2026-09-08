import { createHash, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sanitizeMediaBuffer, MediaSanitizationError } from '../../intake/media.js';
import { featureActor, featureError, featureService, FeatureError } from '../context.js';
import { accessibleRequest } from './activity.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10, fileSize: 25_000_000, fields: 2, fieldSize: 4000 } });
const fileSchema = z.object({ originalname: z.string().regex(/^[\p{L}\p{N}\p{M} _().-]{1,120}$/u), mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/wav', 'audio/x-wav']), size: z.number().int().positive().max(25_000_000), buffer: z.instanceof(Buffer) });
export function registerEvidenceUploads(app: Express) {
  app.post('/api/requests/:id/evidence-files', (req, res) => {
    upload.array('media', 10)(req, res, async failure => {
      if (failure) return res.status(400).json({ error: 'invalid_media_upload' });
      try {
        const requestId = z.string().uuid().parse(req.params.id);
        await accessibleRequest(req, requestId);
        const actor = featureActor(res);
        const input = z.object({ kind: z.enum(['before', 'during', 'after', 'receipt', 'warranty']), note: z.string().trim().min(3).max(2000) }).parse(req.body);
        const files = z.array(fileSchema).min(1).max(10).parse(req.files);
        if (files.reduce((sum, file) => sum + file.size, 0) > 50_000_000) throw new FeatureError(413, 'media_total_too_large');
        const service = featureService();
        const saved = [];
        for (const file of files) {
          const bytes = await sanitizeMediaBuffer(file.buffer, file.mimetype);
          const checksum = createHash('sha256').update(bytes).digest('hex');
          const objectPath = `${actor.id}/${requestId}/evidence/${randomUUID()}`;
          const uploaded = await service.storage.from('request-media-private').upload(objectPath, bytes, { contentType: file.mimetype, upsert: false });
          if (uploaded.error) throw uploaded.error;
          const committed = await service.rpc('commit_evidence_file', { p_actor: actor.id, p_request: requestId, p_kind: input.kind, p_note: input.note, p_name: file.originalname, p_type: file.mimetype, p_bytes: bytes.length, p_path: objectPath, p_checksum: checksum });
          if (committed.error) {
            await service.storage.from('request-media-private').remove([objectPath]);
            throw committed.error;
          }
          const evidenceId = z.string().uuid().parse(committed.data);
          const record = await service.from('evidence_media').select('object_path').eq('evidence_id', evidenceId).single();
          if (record.error) throw record.error;
          if (record.data.object_path !== objectPath) await service.storage.from('request-media-private').remove([objectPath]);
          saved.push({ id: evidenceId, fileName: file.originalname });
        }
        return res.status(201).json({ media: saved });
      } catch (error) {
        if (error instanceof MediaSanitizationError) return res.status(422).json({ error: 'media_sanitization_failed' });
        return featureError(res, error);
      }
    });
  });
}
