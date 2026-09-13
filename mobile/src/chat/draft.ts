/**
 * 네이티브 채팅 임시저장: 파일 시스템에 상태를 저장/복원한다.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { z } from 'zod';
import { assessmentSchema, confirmationSchema, localeSchema, translationSchema } from './protocol';
import { discardAccountMedia } from './media';

const draftSchema = z.object({
  locale: localeSchema, messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string(), locale: localeSchema })),
  draft: z.string(), files: z.array(z.object({ uri: z.string(), name: z.string(), mimeType: z.string(), size: z.number() })),
  consent: z.boolean(), assessment: assessmentSchema.nullable(), translations: z.record(z.string(), translationSchema), translationsEnabled: z.boolean().default(false), translationsDirty: z.boolean(),
  selected: z.array(z.string()), skips: z.array(z.string()), skipAck: z.boolean(), warningAck: z.boolean(), name: z.string(), address: z.string(),
  confirmation: confirmationSchema.nullable(), uploadComplete: z.boolean(),
});
export type Draft = z.infer<typeof draftSchema>;
const empty: Draft = { locale: 'en', messages: [], draft: '', files: [], consent: false, assessment: null, translations: {}, translationsEnabled: false, translationsDirty: false, selected: [], skips: [], skipAck: false, warningAck: false, name: '', address: '', confirmation: null, uploadComplete: false };

function validAccountId(value: string): boolean {
  return value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}

export function accountIdFromAccessToken(accessToken: string): string | null {
  try {
    const encoded = (accessToken.split('.')[1] ?? '').replaceAll('-', '+').replaceAll('_', '/');
    const account = z.object({ sub: z.string().max(128).regex(/^[a-zA-Z0-9_-]+$/) }).parse(JSON.parse(atob(encoded)));
    return account.sub;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export function draftFileForAccount(accountId: string): File | null {
  if (!validAccountId(accountId)) return null;
  const directory = new Directory(Paths.document, 'wecover-drafts');
  directory.create({ intermediates: true, idempotent: true });
  return new File(directory, `${accountId}.json`);
}

export function draftFile(accessToken: string): File | null {
  const accountId = accountIdFromAccessToken(accessToken);
  return accountId ? draftFileForAccount(accountId) : null;
}

export function readDraft(file: File | null): Draft {
  if (!file?.exists) return empty;
  try { return draftSchema.parse(JSON.parse(file.textSync())); }
  catch (error) { if (error instanceof Error) return empty; throw error; }
}

export function writeDraft(file: File | null, value: Draft): boolean {
  if (!file) return false;
  try { file.write(JSON.stringify(value)); return true; }
  catch (error) { if (error instanceof Error) return false; throw error; }
}

export function clearDraft(file: File | null): void {
  if (file?.exists) file.delete();
}

export function clearAccountDraft(accountId: string, deleteMedia: typeof discardAccountMedia = discardAccountMedia): void {
  const file = draftFileForAccount(accountId);
  deleteMedia(accountId);
  if (file?.exists) file.delete();
}
