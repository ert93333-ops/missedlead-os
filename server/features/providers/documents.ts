/**
 * 공급자 서류(라이선스/보험) 업로드 POST /api/providers/documents. 단일 파일 10MB 제한.
 */
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { featureActor, featureClient, featureService, featureError, FeatureError } from '../context.js';
import { documentKind } from './schemas.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10_000_000, files: 1, fields: 1 } }).single('file');
export function registerProviderDocuments(app: Express) {
  app.post('/api/providers/documents', (req, res) => {
    upload(req, res, async uploadError => {
      try {
        if (uploadError) throw new FeatureError(400, 'document_upload_invalid');
        const kind = documentKind.parse(req.body.kind), actor = featureActor(res), file = req.file;
        if (!file) throw new FeatureError(400, 'document_required');
        const pdf = file.buffer.subarray(0, 5).toString() === '%PDF-';
        const png = file.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpg = file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255;
        if (!pdf && !png && !jpg) throw new FeatureError(400, 'document_format_invalid');
        const db = featureClient(req), service = featureService();
        const application = await db.from('provider_applications').select('provider_id,status').eq('provider_id', actor.id).single();
        if (application.error) throw application.error;
        if (application.data.status === 'approved') throw new FeatureError(409, 'resubmit_application_first');
        const id = randomUUID(), path = `${actor.id}/${id}`, mime = pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg';
        const stored = await service.storage.from('provider-documents-private').upload(path, file.buffer, { contentType: mime, upsert: false });
        if (stored.error) throw stored.error;
        const result = await service.from('provider_documents').insert({ id, provider_id: actor.id, kind, file_name: `${kind}.${pdf ? 'pdf' : png ? 'png' : 'jpg'}`, object_path: path }).select('id,kind,file_name,created_at').single();
        if (result.error) {
          const cleanup = await service.storage.from('provider-documents-private').remove([path]);
          if (cleanup.error) throw new FeatureError(503, 'document_cleanup_pending');
          throw result.error;
        }
        res.status(201).json({ document: result.data });
      } catch (error) { featureError(res, error); }
    });
  });
  app.get('/api/providers/documents/:id', async (req, res) => {
    try {
      const id = z.uuid().parse(req.params.id);
      const result = await featureClient(req).from('provider_documents').select('object_path').eq('id', id).single();
      if (result.error) throw result.error;
      const signed = await featureService().storage.from('provider-documents-private').createSignedUrl(result.data.object_path, 60, { download: true });
      if (signed.error) throw signed.error;
      res.set('Cache-Control', 'no-store').json({ url: signed.data.signedUrl, expiresIn: 60 });
    } catch (error) { featureError(res, error); }
  });
}
