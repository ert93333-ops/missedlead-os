/**
 * 웹 multipart FormData 생성: retainedFiles에서 실제 File을 꺼내 첨부.
 */
import { z } from 'zod';
import { apiUrl } from '../config';
import { retainedMedia } from './media.web';
import { ChatError, type Attachment } from './protocol';

export function multipart(fields: Readonly<Record<string, string>>, files: readonly Attachment[]): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) {
    const bytes = retainedMedia(file.uri);
    if (!bytes) throw new ChatError('media', 'media_reattach');
    form.append('media', bytes, file.name);
  }
  return form;
}

export async function request<T>(path: string, accessToken: string, schema: z.ZodType<T>, body: FormData | Readonly<Record<string, unknown>>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await globalThis.fetch(`${apiUrl}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
      body: body instanceof FormData ? body : JSON.stringify(body), signal: controller.signal,
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const failure = z.object({ error: z.string() }).safeParse(value);
      throw new ChatError('request', failure.success ? failure.data.error : `http_${response.status}`);
    }
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError('network', 'connection_retry');
  } finally { clearTimeout(timeout); }
}
