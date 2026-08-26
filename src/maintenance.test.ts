import { describe, expect, it } from 'vitest'
import {
  accrueRepairCredit,
  calculateMemberRepairPrice,
  charlottePilotTerms,
  registeredServiceContractTerms,
  remainingAnnualVisits,
  validatePlanCompliance,
} from './maintenance'

const registeredNorthCarolina = {
  jurisdiction: 'NC',
  legalMode: 'registered_service_contract' as const,
  contractorLicenseVerified: true,
  serviceContractRegistrationVerified: true,
}

describe('maintenance membership', () => {
  it('keeps the Charlotte pilot to scheduled maintenance only', () => {
    expect(validatePlanCompliance(charlottePilotTerms, {
      jurisdiction: 'NC', legalMode: 'scheduled_maintenance', contractorLicenseVerified: true, serviceContractRegistrationVerified: false,
    })).toEqual([])
    expect(charlottePilotTerms).toMatchObject({ includedVisitsPerYear: 2, monthlyRepairCreditCents: 0, laborDiscountBps: 0 })
  })

  it('blocks repair benefits without service-contract registration', () => {
    expect(validatePlanCompliance(registeredServiceContractTerms, {
      ...registeredNorthCarolina, serviceContractRegistrationVerified: false,
    })).toContain('Service-contract registration must be verified before repair benefits are offered')
    expect(validatePlanCompliance(registeredServiceContractTerms, {
      ...registeredNorthCarolina, legalMode: 'scheduled_maintenance', serviceContractRegistrationVerified: false,
    })).toContain('Scheduled-maintenance mode cannot promise repair discounts or credits')
  })

  it('requires a verified trade license for technician assignment', () => {
    expect(validatePlanCompliance(charlottePilotTerms, {
      jurisdiction: 'NC', legalMode: 'scheduled_maintenance', contractorLicenseVerified: false, serviceContractRegistrationVerified: false,
    })).toContain('A verified trade contractor license is required before assignment')
  })

  it('accrues only registered-plan paid-month credits up to the cap', () => {
    expect(accrueRepairCredit(0, 3, registeredServiceContractTerms)).toBe(7500)
    expect(accrueRepairCredit(29000, 2, registeredServiceContractTerms)).toBe(30000)
  })

  it('tracks annual visit entitlement without going negative', () => {
    expect(remainingAnnualVisits(0, charlottePilotTerms)).toBe(2)
    expect(remainingAnnualVisits(1, charlottePilotTerms)).toBe(1)
    expect(remainingAnnualVisits(3, charlottePilotTerms)).toBe(0)
  })

  it('discounts labor then applies earned registered-plan credit', () => {
    const price = calculateMemberRepairPrice({ laborCents: 20000, partsCents: 10000, availableCreditCents: 5000 }, registeredServiceContractTerms)
    expect(price).toMatchObject({ retailCents: 30000, laborDiscountCents: 2000, creditAppliedCents: 5000, memberDueCents: 23000 })
  })

  it('never makes the repair due or credit balance negative', () => {
    const price = calculateMemberRepairPrice({ laborCents: 5000, partsCents: 0, availableCreditCents: 10000 }, registeredServiceContractTerms)
    expect(price).toMatchObject({ memberDueCents: 0, creditAppliedCents: 4500, remainingCreditCents: 5500 })
  })
})
