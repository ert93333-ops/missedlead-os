import { z } from 'zod';

export const localeSchema = z.enum(['en', 'es']);
export type Locale = z.infer<typeof localeSchema>;
export type Message = { readonly role: 'user' | 'assistant'; readonly content: string; readonly locale: Locale };
export const referenceSchema = z.object({ title: z.string().min(1).max(300), url: z.url({ protocol: /^https$/ }).refine(value => { try { const url = new URL(value); return !url.username && !url.password; } catch (error) { if (error instanceof TypeError) return false; throw error; } }) });
export const assessmentSchema = z.object({
  reply: z.string().min(1), locale: localeSchema, assessmentToken: z.string().min(1),
  issueCandidates: z.array(z.object({ id: z.string(), label: z.string(), likelihood: z.enum(['low', 'medium', 'high']), reason: z.string(), evidenceNeeded: z.array(z.string()) })),
  questions: z.array(z.object({ id: z.string(), prompt: z.string(), requiredForSafety: z.boolean() })),
  safety: z.object({ level: z.enum(['normal', 'urgent', 'emergency']), guidance: z.string() }),
  references: z.array(referenceSchema).max(5).optional(),
  readyToConfirm: z.boolean(), uncertaintyWarning: z.string().optional(),
});
export type Assessment = z.infer<typeof assessmentSchema>;
export const translationSchema = z.object({ original: z.string(), translated: z.string(), sourceLocale: localeSchema, targetLocale: localeSchema, warning: z.string(), translationToken: z.string().min(1) });
export type Translation = z.infer<typeof translationSchema>;
export const confirmationSchema = z.object({ requestId: z.string().min(1), status: z.string(), matchCount: z.number().int().nonnegative() });
export type Confirmation = z.infer<typeof confirmationSchema>;
export const uploadSchema = z.object({ media: z.array(z.object({ id: z.string(), fileName: z.string() })) });
export type Attachment = { readonly uri: string; readonly name: string; readonly mimeType: string; readonly size: number };
export class ChatError extends Error {
  constructor(readonly code: 'network' | 'request' | 'media', message: string) { super(message); this.name = 'ChatError'; }
}

export function validateAttachments(files: readonly Attachment[]): void {
  const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/wav', 'audio/x-wav']);
  if (files.length > 10 || files.some(file => file.size <= 0 || file.size > 25_000_000) || files.reduce((sum, file) => sum + file.size, 0) > 50_000_000) {
    throw new ChatError('media', 'file_limits');
  }
  if (files.some(file => !types.has(file.mimeType))) throw new ChatError('media', 'file_format');
}

export function nextHistory(history: readonly Message[], content: string, locale: Locale, reviewMedia: boolean): Message[] {
  const message = content.trim() || (reviewMedia ? (locale === 'en' ? 'Please review the attached files with my previous details.' : 'Revise los archivos adjuntos junto con los detalles anteriores.') : '');
  return message ? [...history, { role: 'user', content: message, locale }] : [...history];
}

export function hasUnsentDetails(draft: string): boolean { return draft.trim().length > 0; }

export function quickReplyLabels(locale: Locale): readonly string[] {
  return locale === 'en' ? ['Yes', 'No', 'Not sure'] : ['Sí', 'No', 'No estoy seguro/a'];
}

export function conversationLimitReached(history: readonly Message[]): boolean {
  return history.length > 80 || history.reduce((total, message) => total + message.content.length, 0) > 24_000;
}

export const safetyPreflightSchema = z.discriminatedUnion('emergency', [
  z.object({ emergency: z.literal(false) }),
  z.object({ emergency: z.literal(true), assessment: assessmentSchema.refine(value => value.safety.level === 'emergency' && !value.readyToConfirm) }),
]);
export async function analyzeAfterSafety(preflight: () => Promise<z.infer<typeof safetyPreflightSchema>>, analyze: () => Promise<Assessment>): Promise<Assessment> {
  let safety: z.infer<typeof safetyPreflightSchema> | undefined;
  try { safety = await preflight(); }
  catch (error) { if (!(error instanceof ChatError)) throw error; }
  if (safety?.emergency) return safety.assessment;
  return analyze();
}
