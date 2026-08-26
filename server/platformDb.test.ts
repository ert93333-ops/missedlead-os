import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPlatformStore, type PlatformStore } from './platformDb'

let store: PlatformStore
beforeEach(() => { store = createPlatformStore(':memory:') })
afterEach(() => { store.close() })

describe('platform homeowner data', () => {
  it('isolates properties and bookings by organization', () => {
    const property = store.createProperty({
      organizationId: 'household-1', customerName: 'Home Owner', addressLine1: '1200 South Blvd',
      city: 'Charlotte', state: 'NC', county: 'Mecklenburg', postalCode: '28210',
    })
    expect(store.listProperties('household-1')).toHaveLength(1)
    expect(store.listProperties('household-2')).toEqual([])
    expect(store.findProperty(property.id, 'household-2')).toBeNull()

    const created = store.createBooking({
      organizationId: 'household-1', propertyId: property.id, service: 'recurring_cleaning',
      preferredStart: '2026-09-01T14:00:00.000Z', safetyStop: false, symptomSummary: 'Biweekly cleaning',
      estimateLowCents: 15400, estimateHighCents: 21700,
    })
    expect(created).toMatchObject({ booking: { status: 'requested', organizationId: 'household-1' } })
    expect(store.listBookings('household-2')).toEqual([])
  })

  it('routes safety bookings to human review and rejects duplicate property slots', () => {
    const property = store.createProperty({
      organizationId: 'household-1', customerName: 'Home Owner', addressLine1: '1200 South Blvd',
      city: 'Charlotte', state: 'NC', county: 'Mecklenburg', postalCode: '28210',
    })
    const input = {
      organizationId: 'household-1', propertyId: property.id, service: 'hvac_service' as const,
      preferredStart: '2026-09-01T14:00:00.000Z', safetyStop: true, symptomSummary: 'Burning odor',
      estimateLowCents: null, estimateHighCents: null,
    }
    expect(store.createBooking(input)).toMatchObject({ booking: { status: 'human_review', safetyStop: true } })
    expect(store.createBooking(input)).toEqual({ error: 'booking_slot_conflict' })
  })

  it('persists organization-scoped pricebooks and conflict-safe availability', () => {
    const item = store.createPricebookItem({
      organizationId: 'provider-org', service: 'hvac_service', label: 'Diagnostic visit',
      baseFeeCents: 8900, laborLowCents: 9000, laborHighCents: 29000, active: true,
    })
    expect(item).toMatchObject({ organizationId: 'provider-org', baseFeeCents: 8900 })
    expect(store.listPricebookItems('provider-org')).toHaveLength(1)
    expect(store.listPricebookItems('other-provider')).toEqual([])

    const availability = {
      organizationId: 'provider-org', weekday: 1, startTime: '08:00', endTime: '17:00', urgent: true,
    }
    expect(store.createAvailability(availability)).toMatchObject({ availability: { weekday: 1, urgent: true } })
    expect(store.createAvailability(availability)).toEqual({ error: 'availability_conflict' })
    expect(store.listAvailability('provider-org')).toHaveLength(1)
  })

  it('requires safety review for dispatch and records disputes, controls, and audits', () => {
    const property = store.createProperty({
      organizationId: 'household-1', customerName: 'Home Owner', addressLine1: '1200 South Blvd',
      city: 'Charlotte', state: 'NC', county: 'Mecklenburg', postalCode: '28210',
    })
    const created = store.createBooking({
      organizationId: 'household-1', propertyId: property.id, service: 'hvac_service',
      preferredStart: '2026-09-04T14:00:00.000Z', safetyStop: true, symptomSummary: 'Burning odor',
      estimateLowCents: null, estimateHighCents: null,
    })
    if (!('booking' in created)) throw new Error('booking not created')
    expect(store.dispatchBooking(created.booking.id, 'provider-1', false)).toEqual({ error: 'safety_review_required' })
    expect(store.dispatchBooking(created.booking.id, 'provider-1', true)).toMatchObject({ booking: { status: 'assigned', assignedProviderId: 'provider-1' } })

    expect(store.setProviderControl({
      organizationId: 'provider-org', status: 'suspended', licenseExpiresAt: null,
      insuranceExpiresAt: null, reason: 'Insurance verification expired',
    })).toMatchObject({ status: 'suspended' })
    expect(store.listProviderControls()).toHaveLength(1)

    const dispute = store.createDispute({
      organizationId: 'household-1', bookingId: created.booking.id, category: 'quality', summary: 'Return visit requested',
    })
    expect(store.transitionDispute(dispute.id, 'resolved')).toMatchObject({ error: 'resolution_required' })
    expect(store.transitionDispute(dispute.id, 'investigating')).toMatchObject({ dispute: { status: 'investigating' } })
    expect(store.transitionDispute(dispute.id, 'resolved', 'Assigned a no-charge return visit')).toMatchObject({ dispute: { status: 'resolved' } })

    store.appendAudit({
      actorUserId: 'admin-1', actorOrganizationId: 'platform', actorRole: 'admin',
      action: 'provider.suspended', targetType: 'provider_organization', targetId: 'provider-org',
    })
    expect(store.listAudits()).toEqual([expect.objectContaining({ action: 'provider.suspended', targetId: 'provider-org' })])
  })
})
