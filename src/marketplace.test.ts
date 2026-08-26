import { describe, expect, it } from 'vitest'
import { annualMembershipEconomics, charlotteMarketplaceTerms, completedRepairFee } from './marketplace'

describe('technician marketplace economics', () => {
  it('never charges for an unbooked lead', () => {
    expect(annualMembershipEconomics().leadFeeCents).toBe(0)
    expect(completedRepairFee(0)).toBe(0)
  })

  it('charges only a capped fee on completed repair revenue', () => {
    expect(completedRepairFee(100000)).toBe(8000)
    expect(completedRepairFee(500000)).toBe(charlotteMarketplaceTerms.completedRepairFeeCapCents)
  })

  it('keeps the pilot contribution margin positive after visit payouts and direct costs', () => {
    const economics = annualMembershipEconomics()
    expect(economics).toMatchObject({
      homeownerAnnualPriceCents: 46800,
      technicianVisitPayoutCents: 22000,
      infrastructureCents: 2400,
    })
    expect(economics.contributionCents).toBeGreaterThan(0)
    expect(economics.contributionMarginBps).toBeGreaterThan(4000)
  })
})
