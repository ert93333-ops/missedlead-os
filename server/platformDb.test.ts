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
})
