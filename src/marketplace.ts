export type MarketplaceTerms = {
  homeownerMonthlyFeeCents: number
  includedVisitsPerYear: number
  technicianPayoutPerVisitCents: number
  completedRepairFeeBps: number
  completedRepairFeeCapCents: number
  annualInfrastructureCostCents: number
  paymentProcessingBps: number
}

export const charlotteMarketplaceTerms: MarketplaceTerms = {
  homeownerMonthlyFeeCents: 3900,
  includedVisitsPerYear: 2,
  technicianPayoutPerVisitCents: 11000,
  completedRepairFeeBps: 800,
  completedRepairFeeCapCents: 15000,
  annualInfrastructureCostCents: 2400,
  paymentProcessingBps: 300,
}

export function completedRepairFee(repairRevenueCents: number, terms = charlotteMarketplaceTerms): number {
  if (!Number.isInteger(repairRevenueCents) || repairRevenueCents < 0) throw new Error('Repair revenue must be non-negative integer cents')
  return Math.min(terms.completedRepairFeeCapCents, Math.floor(repairRevenueCents * terms.completedRepairFeeBps / 10_000))
}

export function annualMembershipEconomics(terms = charlotteMarketplaceTerms) {
  const revenueCents = terms.homeownerMonthlyFeeCents * 12
  const technicianVisitPayoutCents = terms.technicianPayoutPerVisitCents * terms.includedVisitsPerYear
  const processingCents = Math.round(revenueCents * terms.paymentProcessingBps / 10_000)
  const contributionCents = revenueCents - technicianVisitPayoutCents - processingCents - terms.annualInfrastructureCostCents
  return {
    homeownerAnnualPriceCents: revenueCents,
    technicianVisitPayoutCents,
    leadFeeCents: 0,
    processingCents,
    infrastructureCents: terms.annualInfrastructureCostCents,
    contributionCents,
    contributionMarginBps: Math.round(contributionCents / revenueCents * 10_000),
    proPromise: 'Technicians never pay for an unbooked lead; the platform fee applies only to completed repair revenue.',
  }
}
