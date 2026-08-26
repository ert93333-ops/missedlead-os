export type PlanLegalMode = 'scheduled_maintenance' | 'registered_service_contract'

export type ComplianceProfile = {
  jurisdiction: string
  legalMode: PlanLegalMode
  contractorLicenseVerified: boolean
  serviceContractRegistrationVerified: boolean
}

export type MaintenancePlanTerms = {
  monthlyFeeCents: number
  includedVisitsPerYear: number
  monthlyRepairCreditCents: number
  repairCreditCapCents: number
  laborDiscountBps: number
}

export type RepairInput = {
  laborCents: number
  partsCents: number
  availableCreditCents: number
}

export type MemberRepairPrice = {
  retailCents: number
  laborDiscountCents: number
  creditAppliedCents: number
  memberDueCents: number
  remainingCreditCents: number
  disclosures: string[]
}

export const charlottePilotTerms: MaintenancePlanTerms = {
  monthlyFeeCents: 3900,
  includedVisitsPerYear: 2,
  monthlyRepairCreditCents: 0,
  repairCreditCapCents: 0,
  laborDiscountBps: 0,
}

export const registeredServiceContractTerms: MaintenancePlanTerms = {
  monthlyFeeCents: 7900,
  includedVisitsPerYear: 2,
  monthlyRepairCreditCents: 2500,
  repairCreditCapCents: 30000,
  laborDiscountBps: 1000,
}

export const defaultMaintenanceTerms = charlottePilotTerms

export function validatePlanCompliance(terms: MaintenancePlanTerms, compliance: ComplianceProfile): string[] {
  const errors: string[] = []
  if (!compliance.contractorLicenseVerified) errors.push('A verified trade contractor license is required before assignment')
  const offersRepairBenefit = terms.monthlyRepairCreditCents > 0 || terms.repairCreditCapCents > 0 || terms.laborDiscountBps > 0
  if (compliance.legalMode === 'scheduled_maintenance' && offersRepairBenefit) {
    errors.push('Scheduled-maintenance mode cannot promise repair discounts or credits')
  }
  if (compliance.legalMode === 'registered_service_contract' && !compliance.serviceContractRegistrationVerified) {
    errors.push('Service-contract registration must be verified before repair benefits are offered')
  }
  return errors
}

export function accrueRepairCredit(currentCreditCents: number, paidMonths: number, terms: MaintenancePlanTerms): number {
  if (!Number.isInteger(paidMonths) || paidMonths < 0) throw new Error('paidMonths must be a non-negative integer')
  return Math.min(terms.repairCreditCapCents, currentCreditCents + paidMonths * terms.monthlyRepairCreditCents)
}

export function remainingAnnualVisits(completedVisits: number, terms: MaintenancePlanTerms): number {
  if (!Number.isInteger(completedVisits) || completedVisits < 0) throw new Error('completedVisits must be a non-negative integer')
  return Math.max(0, terms.includedVisitsPerYear - completedVisits)
}

export function calculateMemberRepairPrice(input: RepairInput, terms: MaintenancePlanTerms): MemberRepairPrice {
  if ([input.laborCents, input.partsCents, input.availableCreditCents].some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('Repair amounts must be non-negative integer cents')
  }
  const retailCents = input.laborCents + input.partsCents
  const laborDiscountCents = Math.floor(input.laborCents * terms.laborDiscountBps / 10_000)
  const afterDiscount = retailCents - laborDiscountCents
  const creditAppliedCents = Math.min(afterDiscount, input.availableCreditCents)
  return {
    retailCents,
    laborDiscountCents,
    creditAppliedCents,
    memberDueCents: afterDiscount - creditAppliedCents,
    remainingCreditCents: input.availableCreditCents - creditAppliedCents,
    disclosures: [
      'Scheduled-maintenance plans pay only for the listed preventive visits and are not insurance or a home warranty.',
      'Repair discounts or credits are available only under separately approved, registered service-contract terms where required.',
      'Parts are not discounted unless the signed plan explicitly says otherwise.',
      'The customer approves the final repair quote before work starts.',
    ],
  }
}
