import { z } from 'zod';
import { assessmentSchema, confirmationSchema, localeSchema, translationSchema } from './protocol';
import { missingMedia } from './media.web';

type BrowserDraftFile = { readonly key: string };
const draftSchema = z.object({
  locale: localeSchema, messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string(), locale: localeSchema })),
  draft: z.string(), files: z.array(z.object({ uri: z.string(), name: z.string(), mimeType: z.string(), size: z.number() })),
  consent: z.boolean(), assessment: assessmentSchema.nullable(), translations: z.record(z.string(), translationSchema), translationsDirty: z.boolean(),
  selected: z.array(z.string()), skips: z.array(z.string()), skipAck: z.boolean(), warningAck: z.boolean(), name: z.string(), address: z.string(),
  confirmation: confirmationSchema.nullable(), uploadComplete: z.boolean(),
});
export type Draft = z.infer<typeof draftSchema>;
const empty: Draft = { locale: 'en', messages: [], draft: '', files: [], consent: false, assessment: null, translations: {}, translationsDirty: false, selected: [], skips: [], skipAck: false, warningAck: false, name: '', address: '', confirmation: null, uploadComplete: false };

export function accountIdFromAccessToken(accessToken: string): string | null {
  try {
    const encoded = (accessToken.split('.')[1] ?? '').replaceAll('-', '+').replaceAll('_', '/');
    return z.object({ sub: z.string().max(128).regex(/^[a-zA-Z0-9_-]+$/) }).parse(JSON.parse(atob(encoded))).sub;
  } catch (error) { if (error instanceof Error) return null; throw error; }
}

export function draftFile(accessToken: string): BrowserDraftFile | null {
  const accountId = accountIdFromAccessToken(accessToken);
  return accountId ? { key: `wecover:mobile-draft:${accountId}` } : null;
}

export function readDraft(file: BrowserDraftFile | null): Draft & { readonly missingMedia: boolean } {
  if (!file) return { ...empty, missingMedia: false };
  try {
    const stored = sessionStorage.getItem(file.key);
    if (!stored) return { ...empty, missingMedia: false };
    const value = draftSchema.parse(JSON.parse(stored));
    const missing = missingMedia(value.files);
    return { ...value, consent: missing ? false : value.consent, uploadComplete: missing ? false : value.uploadComplete, missingMedia: missing };
  } catch (error) { if (error instanceof Error) return { ...empty, missingMedia: false }; throw error; }
}

export function writeDraft(file: BrowserDraftFile | null, value: Draft): boolean {
  if (!file) return false;
  try { sessionStorage.setItem(file.key, JSON.stringify(value)); return true; }
  catch (error) { if (error instanceof Error) return false; throw error; }
}

export function clearDraft(file: BrowserDraftFile | null): void {
  if (file) sessionStorage.removeItem(file.key);
}
