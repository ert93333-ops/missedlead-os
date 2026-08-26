export type Trade = 'cleaning' | 'handyman' | 'hvac' | 'plumbing'

export type TradeAuthority = {
  trade: Trade
  licenseRequired: boolean
  authority: string | null
  verificationUrl: string | null
}

export type JurisdictionProfile = {
  id: string
  state: string
  county: string
  launchCity: string
  allowedPostalCodePrefixes: string[]
  blockedStates: string[]
  launchLegalMode: 'scheduled_maintenance'
  tradeAuthorities: TradeAuthority[]
  disclosures: string[]
}

export const charlottePilotJurisdiction: JurisdictionProfile = {
  id: 'us-nc-mecklenburg',
  state: 'NC',
  county: 'Mecklenburg',
  launchCity: 'Charlotte',
  allowedPostalCodePrefixes: ['282'],
  blockedStates: ['SC'],
  launchLegalMode: 'scheduled_maintenance',
  tradeAuthorities: [
    { trade: 'cleaning', licenseRequired: false, authority: null, verificationUrl: null },
    { trade: 'handyman', licenseRequired: false, authority: null, verificationUrl: null },
    {
      trade: 'hvac',
      licenseRequired: true,
      authority: 'North Carolina State Board of Examiners of Plumbing, Heating, and Fire Sprinkler Contractors',
      verificationUrl: 'https://public.nclicensing.org/Public/Search',
    },
    {
      trade: 'plumbing',
      licenseRequired: true,
      authority: 'North Carolina State Board of Examiners of Plumbing, Heating, and Fire Sprinkler Contractors',
      verificationUrl: 'https://public.nclicensing.org/Public/Search',
    },
  ],
  disclosures: [
    'The Charlotte pilot provides scheduled maintenance and service coordination, not insurance or a home warranty.',
    'HVAC and plumbing work is routed only to providers whose applicable North Carolina license is verified.',
    'South Carolina addresses are not supported during the North Carolina pilot.',
  ],
}

export type ServiceAddress = {
  state: string
  county: string
  postalCode: string
}

export function validateServiceAddress(address: ServiceAddress, profile = charlottePilotJurisdiction): string[] {
  const state = address.state.trim().toUpperCase()
  const county = address.county.trim().toLowerCase()
  const postalCode = address.postalCode.trim()
  const errors: string[] = []
  if (profile.blockedStates.includes(state)) errors.push(`${state} is not supported during the ${profile.launchCity} pilot`)
  else if (state !== profile.state) errors.push(`Service is currently limited to ${profile.state}`)
  if (county !== profile.county.toLowerCase()) errors.push(`Service is currently limited to ${profile.county} County`)
  if (!profile.allowedPostalCodePrefixes.some((prefix) => postalCode.startsWith(prefix))) {
    errors.push(`Postal code is outside the ${profile.launchCity} pilot area`)
  }
  return errors
}

export function getTradeAuthority(trade: Trade, profile = charlottePilotJurisdiction): TradeAuthority {
  const authority = profile.tradeAuthorities.find((candidate) => candidate.trade === trade)
  if (!authority) throw new Error(`Unsupported trade: ${trade}`)
  return authority
}
