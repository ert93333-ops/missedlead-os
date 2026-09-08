import { z } from 'zod';

const cents = z.number().int().min(0).max(3_999_999);
const future = z.iso.datetime({ offset: true }).refine(value => Date.parse(value) > Date.now(), 'future_required');
export const applicationSchema = z.object({
  organizationName: z.string().trim().min(2).max(150), contactName: z.string().trim().min(2).max(100),
  contactEmail: z.email().max(254), contactPhone: z.string().trim().min(7).max(30),
  categories: z.array(z.enum(['plumbing', 'electrical', 'hvac', 'handyman', 'general'])).min(1).max(5),
  zipCodes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(100), languages: z.array(z.enum(['en', 'es'])).min(1).max(2),
  availability: z.string().trim().min(3).max(1000), diagnosticFeeCents: cents,
  licenseNumber: z.string().trim().min(2).max(100), licenseExpiresAt: future, insuranceExpiresAt: future,
  workersCompRequired: z.boolean(),
}).strict();
export const quoteSchema = z.object({
  scope: z.string().trim().min(3).max(4000), bundleId: z.uuid().optional(), diagnosticCents: cents, laborCents: cents, materialsCents: cents,
  taxCents: cents, totalCents: cents.positive(), validUntil: future, earliestStartAt: future,
  warrantyDays: z.number().int().min(0).max(3650), siteVisitRequired: z.boolean(), permitRequired: z.boolean(),
  permitNumber: z.string().trim().max(100).optional(), inspectionStatus: z.enum(['not_required', 'pending', 'passed']),
}).strict().refine(value => value.totalCents === value.diagnosticCents + value.laborCents + value.materialsCents + value.taxCents, 'quote_total_mismatch')
  .refine(value => value.permitRequired || value.inspectionStatus === 'not_required', 'inspection_status_invalid');
export const documentKind = z.enum(['license', 'coi', 'workers_comp', 'w9']);
export const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().min(3).max(2000), verificationReference: z.string().trim().min(3).max(500) }).strict();
