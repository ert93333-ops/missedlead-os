import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { z } from 'zod';
import { apiUrl } from '../config';
import { ChatError, type Attachment } from './protocol';

export function multipart(fields: Readonly<Record<string, string>>, files: readonly Attachment[]): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) form.append('media', new File(file.uri), file.name);
  return form;
}

export async function request<T>(path: string, accessToken: string, schema: z.ZodType<T>, body: FormData | Readonly<Record<string, unknown>>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
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
