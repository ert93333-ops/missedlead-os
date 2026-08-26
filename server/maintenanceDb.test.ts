import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { charlottePilotTerms } from '../src/maintenance'
import { createMaintenanceStore, type MaintenanceStore } from './maintenanceDb'

let store: MaintenanceStore
beforeEach(() => { store = createMaintenanceStore(':memory:') })
afterEach(() => { store.close() })

const membershipInput = {
  technicianName: 'Jordan Lee',
  technicianPhone: '+15125550199',
  customerName: 'Taylor Home',
  propertyAddress: '1200 South Blvd, Charlotte, NC',
  terms: charlottePilotTerms,
  compliance: {
    jurisdiction: 'NC',
    legalMode: 'scheduled_maintenance' as const,
    contractorLicenseVerified: true,
    serviceContractRegistrationVerified: false,
  },
  initialRepairCreditCents: 0,
}

describe('maintenance store', () => {
  it('assigns one technician to a property under explicit plan terms', () => {
    const membership = store.createMembership(membershipInput)
    expect(store.findMembership(membership.id)).toMatchObject({
      technician: { name: 'Jordan Lee' },
      property: { customerName: 'Taylor Home' },
      repairCreditCents: 0,
      status: 'active',
    })
  })

  it('tracks completed visits against the monthly entitlement', () => {
    const membership = store.createMembership(membershipInput)
    const first = store.completeVisit(membership.id, 'Checked drains and shutoff valves', '2026-08-26T03:00:00.000Z')
    const second = store.completeVisit(membership.id, 'Follow-up inspection', '2026-08-27T03:00:00.000Z')
    expect(first).toMatchObject({ completedVisitsThisYear: 1, remainingIncludedVisits: 1 })
    expect(second).toMatchObject({ completedVisitsThisYear: 2, remainingIncludedVisits: 0 })
  })

  it('creates a transparent repair quote without consuming credit before approval', () => {
    const membership = store.createMembership(membershipInput)
    const quote = store.createRepairQuote(membership.id, 20000, 10000)!
    expect(quote.price).toMatchObject({ retailCents: 30000, memberDueCents: 30000, creditAppliedCents: 0 })
    expect(store.findMembership(membership.id)?.repairCreditCents).toBe(0)
  })

  it('builds an explainable Home Passport and continuity score', () => {
    const membership = store.createMembership(membershipInput)
    const asset = store.addHomeAsset(membership.id, {
      category: 'hvac',
      label: 'Main HVAC',
      installedYear: 2014,
      expectedLifeYears: 15,
      serviceIntervalMonths: 12,
      lastServicedAt: '2025-02-01T00:00:00.000Z',
      condition: 'watch',
    })
    expect(asset).not.toBeNull()
    store.completeVisit(membership.id, 'Assigned technician visit', '2026-01-02T00:00:00.000Z')
    store.completeVisit(membership.id, 'Backup technician visit', '2026-02-02T00:00:00.000Z', 'backup-tech')
    const passport = store.getHomePassport(membership.id)!
    expect(passport.assets).toHaveLength(1)
    expect(passport.prioritizedActions[0].reasons.length).toBeGreaterThan(0)
    expect(passport.continuityScore).toBe(50)
  })

  it('exports and permanently deletes homeowner membership data', () => {
    const membership = store.createMembership(membershipInput)
    store.addHomeAsset(membership.id, {
      category: 'water_heater', label: 'Water heater', installedYear: 2018, expectedLifeYears: 12,
      serviceIntervalMonths: 12, lastServicedAt: null, condition: 'good',
    })
    expect(store.exportHomeownerData(membership.id)?.assets).toHaveLength(1)
    expect(store.deleteMembership(membership.id)).toBe(true)
    expect(store.findMembership(membership.id)).toBeNull()
    expect(store.exportHomeownerData(membership.id)).toBeNull()
  })

  it('persists, deduplicates, and transitions threshold events', () => {
    const membership = store.createMembership(membershipInput)
    const asset = store.addHomeAsset(membership.id, {
      category: 'hvac', label: 'Main HVAC', installedYear: 2005, expectedLifeYears: 15,
      serviceIntervalMonths: 12, lastServicedAt: '2024-01-01T00:00:00.000Z', condition: 'watch',
    })!
    const first = store.evaluateThresholds(membership.id, { now: '2026-08-27T00:00:00.000Z' })!
    expect(first.created.map((event) => event.ruleId)).toEqual(expect.arrayContaining([
      'health_below_70', 'health_below_45', 'service_30_days_overdue', 'service_90_days_overdue',
    ]))
    expect(first.created[0].assignedTechnicianId).toBe(membership.technician.id)
    expect(store.evaluateThresholds(membership.id, { now: '2026-08-28T00:00:00.000Z' })?.created).toEqual([])

    const event = first.created.find((candidate) => candidate.ruleId === 'health_below_45')!
    expect(store.transitionThresholdEvent(event.id, 'acknowledged')).toMatchObject({ event: { status: 'acknowledged' } })
    expect(store.transitionThresholdEvent(event.id, 'resolved')).toMatchObject({ event: { status: 'resolved' } })
    expect(store.transitionThresholdEvent(event.id, 'scheduled')).toMatchObject({ error: 'invalid_transition' })

    const safety = store.evaluateThresholds(membership.id, {
      now: '2026-08-29T00:00:00.000Z', safetyStopAssetId: asset.id, safetyEvidence: ['breaker retripped'],
    })!
    expect(safety.created).toEqual([expect.objectContaining({
      ruleId: 'safety_stop', severity: 'urgent', safetyStop: true, cooldownUntil: '2026-08-29T00:00:00.000Z',
    })])
  })

  it('persists a home care team and matches assigned licensed providers first', () => {
    const membership = store.createMembership(membershipInput)
    const assigned = store.createServiceProvider({
      name: 'Assigned HVAC', role: 'hvac_technician', trade: 'hvac', active: true,
      licenseVerified: true, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true,
    })
    const backup = store.createServiceProvider({
      name: 'Backup HVAC', role: 'hvac_technician', trade: 'hvac', active: true,
      licenseVerified: true, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true,
    })
    const unlicensed = store.createServiceProvider({
      name: 'Unlicensed HVAC', role: 'hvac_technician', trade: 'hvac', active: true,
      licenseVerified: false, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true,
    })
    store.assignHomeCareProvider(membership.id, assigned.id, 'assigned')
    store.assignHomeCareProvider(membership.id, backup.id, 'backup')
    store.assignHomeCareProvider(membership.id, unlicensed.id, 'backup')
    expect(store.getHomeCareTeam(membership.id)?.providers).toHaveLength(3)
    const matches = store.matchProviders(membership.id, {
      service: 'hvac_service', postalCode: '28210', urgent: true, safetyStop: false,
    })!
    expect(matches.map((match) => match.provider.id)).toEqual([assigned.id, backup.id])
    expect(store.matchProviders(membership.id, {
      service: 'hvac_service', postalCode: '28210', urgent: true, safetyStop: true,
    })).toEqual([])
  })

  it('records work-order acceptance, scheduling, and technician-confirmed outcomes', () => {
    const membership = store.createMembership(membershipInput)
    const provider = store.createServiceProvider({
      name: 'Assigned Plumber', role: 'plumber', trade: 'plumbing', active: true,
      licenseVerified: true, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true,
    })
    store.assignHomeCareProvider(membership.id, provider.id, 'assigned')
    const created = store.createWorkOrder({
      planId: membership.id, providerId: provider.id, service: 'plumbing_service', summary: 'Leak below sink',
    })
    if (!('workOrder' in created)) throw new Error('work order not created')
    expect(created.workOrder.status).toBe('offered')
    expect(store.transitionWorkOrder(created.workOrder.id, { status: 'accepted' })).toMatchObject({ workOrder: { status: 'accepted' } })
    expect(store.transitionWorkOrder(created.workOrder.id, { status: 'scheduled' })).toMatchObject({ error: 'scheduled_at_required' })
    expect(store.transitionWorkOrder(created.workOrder.id, {
      status: 'scheduled', scheduledAt: '2026-09-01T14:00:00.000Z',
    })).toMatchObject({ workOrder: { status: 'scheduled' } })
    const completed = store.transitionWorkOrder(created.workOrder.id, {
      status: 'completed',
      finalOutcome: {
        technicianConfirmedIssue: 'Failed P-trap slip-joint washer',
        parts: ['1.5 inch slip-joint washer'],
        laborMinutes: 35,
        finalPriceCents: 18900,
        outcome: 'resolved',
        aiAssessmentOutcome: 'accepted',
      },
    })
    expect(completed).toMatchObject({
      workOrder: {
        status: 'completed',
        finalOutcome: { outcome: 'resolved', finalPriceCents: 18900, aiAssessmentOutcome: 'accepted' },
      },
    })
    expect(store.transitionWorkOrder(created.workOrder.id, { status: 'cancelled' })).toMatchObject({ error: 'invalid_transition' })
    expect(store.listWorkOrders(membership.id)).toHaveLength(1)
  })
})
