import { describe, expect, it } from 'vitest'
import { estimateCleaningRange, matchHomeCareProviders, type HomeCareTeam, type ServiceProvider } from './homeCare'

const providers: ServiceProvider[] = [
  { id: 'assigned', name: 'Assigned Pro', role: 'hvac_technician', trade: 'hvac', active: true, licenseVerified: true, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true },
  { id: 'backup', name: 'Backup Pro', role: 'hvac_technician', trade: 'hvac', active: true, licenseVerified: true, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true },
  { id: 'unlicensed', name: 'Unlicensed Pro', role: 'hvac_technician', trade: 'hvac', active: true, licenseVerified: false, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true },
]
const team: HomeCareTeam = { propertyId: 'home-1', coordinatorId: 'coordinator', assignedProviderIds: ['assigned'], backupProviderIds: ['backup'] }

describe('home care network', () => {
  it('prioritizes the assigned provider then backup and excludes unlicensed HVAC providers', () => {
    const matches = matchHomeCareProviders({ service: 'hvac_service', postalCode: '28210', urgent: true, safetyStop: false }, team, providers)
    expect(matches.map((match) => [match.provider.id, match.relationship])).toEqual([
      ['assigned', 'assigned'], ['backup', 'backup'],
    ])
  })

  it('stops normal matching when safety escalation is active', () => {
    expect(matchHomeCareProviders({ service: 'hvac_service', postalCode: '28210', urgent: true, safetyStop: true }, team, providers)).toEqual([])
  })

  it('produces a transparent cleaning range from observable scope variables', () => {
    const standard = estimateCleaningRange({ squareFeet: 2200, bathrooms: 2, frequency: 'biweekly', deepClean: false, pets: false })
    const complex = estimateCleaningRange({ squareFeet: 2200, bathrooms: 2, frequency: 'one_time', deepClean: true, pets: true })
    expect(standard.lowCents).toBeLessThan(standard.highCents)
    expect(complex.lowCents).toBeGreaterThan(standard.highCents)
    expect(complex.variables).toEqual(expect.arrayContaining(['deep-clean scope', 'pet hair and access']))
  })

  it('rejects implausible cleaning scope instead of inventing a price', () => {
    expect(() => estimateCleaningRange({ squareFeet: 0, bathrooms: 2, frequency: 'monthly', deepClean: false, pets: false }))
      .toThrow('squareFeet is outside the supported range')
  })
})
