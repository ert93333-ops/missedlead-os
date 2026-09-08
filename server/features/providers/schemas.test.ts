import { describe, expect, it } from 'vitest';
import { applicationSchema, quoteSchema } from './schemas.js';

const quote = { scope: 'Replace faucet', diagnosticCents: 1000, laborCents: 2000, materialsCents: 500, taxCents: 100, totalCents: 3600, validUntil: '2099-01-01T00:00:00Z', earliestStartAt: '2099-02-01T00:00:00Z', warrantyDays: 30, siteVisitRequired: false, permitRequired: false, inspectionStatus: 'not_required' };
describe('itemized quote boundary', () => {
  it('accepts an exact cents total', () => { expect(quoteSchema.safeParse(quote).success).toBe(true); });
  it('rejects a total different from component sum', () => { expect(quoteSchema.safeParse({ ...quote, totalCents: 3601 }).success).toBe(false); });
  it('rejects expired quotes', () => { expect(quoteSchema.safeParse({ ...quote, validUntil: '2000-01-01T00:00:00Z' }).success).toBe(false); });
  it('rejects fractional cents', () => { expect(quoteSchema.safeParse({ ...quote, laborCents: 2000.5 }).success).toBe(false); });
  it('rejects projects outside platform amount scope', () => { expect(quoteSchema.safeParse({ ...quote, laborCents: 3998400, totalCents: 4000000 }).success).toBe(false); });
  it('rejects self-verification and plaintext tax identifier fields', () => {
    const application = { organizationName: 'Test Co', contactName: 'Tester', contactEmail: 'test@example.com', contactPhone: '5551234567', categories: ['plumbing'], zipCodes: ['28202'], languages: ['en'], availability: 'Weekdays', diagnosticFeeCents: 1000, licenseNumber: 'TEST123', licenseExpiresAt: '2099-01-01T00:00:00Z', insuranceExpiresAt: '2099-01-01T00:00:00Z', workersCompRequired: false };
    expect(applicationSchema.safeParse(application).success).toBe(true);
    expect(applicationSchema.safeParse({ ...application, licenseVerified: true }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...application, taxId: '123' }).success).toBe(false);
  });
});
