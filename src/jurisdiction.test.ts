import { describe, expect, it } from 'vitest'
import { charlottePilotJurisdiction, getTradeAuthority, validateServiceAddress } from './jurisdiction'

describe('Charlotte pilot jurisdiction', () => {
  it('accepts Mecklenburg County addresses in the Charlotte postal area', () => {
    expect(validateServiceAddress({ state: 'NC', county: 'Mecklenburg', postalCode: '28210' })).toEqual([])
  })

  it('blocks South Carolina during the North Carolina pilot', () => {
    expect(validateServiceAddress({ state: 'SC', county: 'York', postalCode: '29715' }))
      .toContain('SC is not supported during the Charlotte pilot')
  })

  it('requires North Carolina license verification for HVAC and plumbing', () => {
    expect(getTradeAuthority('hvac')).toMatchObject({ licenseRequired: true })
    expect(getTradeAuthority('plumbing').verificationUrl).toBe('https://public.nclicensing.org/Public/Search')
    expect(getTradeAuthority('cleaning')).toMatchObject({ licenseRequired: false })
    expect(charlottePilotJurisdiction.launchLegalMode).toBe('scheduled_maintenance')
  })
})
