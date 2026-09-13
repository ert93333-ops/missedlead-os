/**
 * 요청/견적/증빙/일정/활동 응답의 zod 스키마(대시보드 계약).
 */
import { z } from 'zod';

const record = { id: z.string(), requestId: z.string() };
export const quoteSchema = z.object({ ...record, providerName: z.string(), scope: z.string(), amountCents: z.number(), rankingScore: z.number().optional(), ranking: z.object({ earliestStartAt: z.string(), warrantyDays: z.number(), rating: z.number().optional(), languages: z.array(z.string()).optional(), licenseVerified: z.boolean().optional(), insuranceVerified: z.boolean().optional(), distanceMiles: z.number().optional(), responseMinutes: z.number().optional() }) });
export const evidenceKindSchema = z.enum(['before', 'during', 'after', 'receipt', 'warranty']);
export const evidenceSchema = z.object({ ...record, kind: evidenceKindSchema, note: z.string(), createdAt: z.string() });
export const scheduleSchema = z.object({ requestId: z.string(), startsAt: z.string(), timeZone: z.string(), status: z.string() });
export const activityMediaSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().nonnegative(),
  url: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
}).strict();
export const activityEvidenceSchema = evidenceSchema.extend({
  media: z.array(activityMediaSchema),
}).strict();
export const completionAcknowledgmentSchema = z.object({
  requestId: z.string(),
  acceptedAt: z.string(),
}).strict();
export const activitySchema = z.object({
  messages: z.array(z.object({ ...record, senderId: z.string(), text: z.string(), createdAt: z.string() }).strict()),
  schedules: z.array(z.object({ ...record, startsAt: z.string(), timeZone: z.string(), status: z.string(), changedAt: z.string(), changedBy: z.string().nullable() }).strict()),
  evidence: z.array(activityEvidenceSchema),
  acknowledgment: completionAcknowledgmentSchema.nullable(),
}).strict();
export const dashboardSchema = z.object({
  requests: z.array(z.object({ id: z.string(), description: z.string(), address: z.string(), status: z.string(), createdAt: z.string() })),
  quotes: z.array(quoteSchema),
  changes: z.array(z.object({ ...record, description: z.string(), amountCents: z.number(), items: z.array(z.object({ description: z.string(), quantity: z.number(), unitCents: z.number() })), evidenceIds: z.array(z.string()), approvedAt: z.string().nullish() })),
  jobs: z.array(z.object({ requestId: z.string(), quoteId: z.string(), completedAt: z.string().nullish(), settlementState: z.string(), depositCents: z.number() })),
  evidence: z.array(evidenceSchema),
  disputes: z.array(z.object({ ...record, reason: z.string(), status: z.string() })),
  messages: z.array(z.object({ ...record, text: z.string(), createdAt: z.string() })).default([]),
  schedules: z.array(scheduleSchema).default([]),
  reviews: z.array(z.object({ ...record, rating: z.number(), text: z.string() })).default([]),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type ActivityData = z.infer<typeof activitySchema>;
export type ActivityMedia = z.infer<typeof activityMediaSchema>;
export type Locale = 'en' | 'es';
export function hasRequiredCompletionEvidence(activity: ActivityData): boolean {
  return activity.evidence.some((item) => item.kind === 'before') && activity.evidence.some((item) => item.kind === 'after');
}
export function canAcknowledgeCompletion(activity: ActivityData): boolean {
  return activity.acknowledgment === null && hasRequiredCompletionEvidence(activity);
}
export const money = (cents: number, locale: Locale) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
export function filterQuotes(quotes: readonly Quote[], language: string, before: string): Quote[] {
  const deadline = before ? Date.parse(`${before}T23:59:59`) : Infinity;
  return quotes.filter((q) => (!language || q.ranking.languages?.some((value) => value.toLowerCase() === language || (language === 'en' && value.toLowerCase() === 'english') || (language === 'es' && ['spanish', 'español'].includes(value.toLowerCase())))) && Date.parse(q.ranking.earliestStartAt) <= deadline);
}
export function requestStatus(status: string, locale: Locale): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = { intake: ['Finding professionals', 'Buscando profesionales'], matched: ['Waiting for quotes', 'Esperando presupuestos'], quoted: ['Quotes available', 'Presupuestos disponibles'], funded: ['Deposit paid', 'Depósito pagado'], in_progress: ['Work in progress', 'Trabajo en curso'], completed: ['Work completed', 'Trabajo terminado'], settled: ['Payment complete', 'Pago completado'] };
  const label = labels[status];
  return label ? label[locale === 'es' ? 1 : 0] : locale === 'es' ? 'Solicitud en revisión' : 'Request under review';
}
export const capabilitiesSchema = z.object({ payments: z.object({ enabled: z.boolean() }) });
