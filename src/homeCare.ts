import { getTradeAuthority, type Trade } from './jurisdiction'

export type HomeCareService = 'recurring_cleaning' | 'home_care_visit' | 'hvac_service' | 'plumbing_service' | 'handyman_visit'
export type ProviderRole = 'primary_cleaner' | 'home_care_coordinator' | 'hvac_technician' | 'plumber' | 'handyman'

export type ServiceProvider = {
  id: string
  ownerOrganizationId: string
  name: string
  role: ProviderRole
  trade: Trade
  active: boolean
  licenseVerified: boolean
  insured: boolean
  postalCodePrefixes: string[]
  availableForUrgentDispatch: boolean
}

export type HomeCareTeam = {
  propertyId: string
  coordinatorId: string
  assignedProviderIds: string[]
  backupProviderIds: string[]
}

export type ServiceRequest = {
  service: HomeCareService
  postalCode: string
  urgent: boolean
  safetyStop: boolean
}

export type ProviderMatch = {
  provider: ServiceProvider
  relationship: 'assigned' | 'backup' | 'network'
  reasons: string[]
}

const serviceTrade: Record<HomeCareService, Trade> = {
  recurring_cleaning: 'cleaning',
  home_care_visit: 'handyman',
  hvac_service: 'hvac',
  plumbing_service: 'plumbing',
  handyman_visit: 'handyman',
}

export function matchHomeCareProviders(request: ServiceRequest, team: HomeCareTeam, providers: ServiceProvider[]): ProviderMatch[] {
  if (request.safetyStop) return []
  const trade = serviceTrade[request.service]
  const authority = getTradeAuthority(trade)
  const assigned = new Set(team.assignedProviderIds)
  const backups = new Set(team.backupProviderIds)
  return providers
    .filter((provider) => provider.active && provider.insured && provider.trade === trade)
    .filter((provider) => !authority.licenseRequired || provider.licenseVerified)
    .filter((provider) => provider.postalCodePrefixes.some((prefix) => request.postalCode.startsWith(prefix)))
    .filter((provider) => !request.urgent || provider.availableForUrgentDispatch)
    .map((provider): ProviderMatch => {
      const relationship = assigned.has(provider.id) ? 'assigned' : backups.has(provider.id) ? 'backup' : 'network'
      return {
        provider,
        relationship,
        reasons: [
          relationship === 'assigned' ? 'Assigned to this home.' : relationship === 'backup' ? 'Designated backup for this home.' : 'Verified local network provider.',
          authority.licenseRequired ? 'Applicable North Carolina trade license verified.' : 'Insurance and service scope verified.',
          request.urgent ? 'Available for urgent dispatch coordination.' : 'Available in the property service area.',
        ],
      }
    })
    .sort((left, right) => relationshipRank(left.relationship) - relationshipRank(right.relationship) || left.provider.name.localeCompare(right.provider.name))
}

function relationshipRank(relationship: ProviderMatch['relationship']): number {
  if (relationship === 'assigned') return 0
  if (relationship === 'backup') return 1
  return 2
}

export type CleaningEstimateInput = {
  squareFeet: number
  bathrooms: number
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'one_time'
  deepClean: boolean
  pets: boolean
}

export function estimateCleaningRange(input: CleaningEstimateInput): { lowCents: number; highCents: number; variables: string[] } {
  if (!Number.isFinite(input.squareFeet) || input.squareFeet < 200 || input.squareFeet > 20_000) throw new Error('squareFeet is outside the supported range')
  if (!Number.isInteger(input.bathrooms) || input.bathrooms < 0 || input.bathrooms > 20) throw new Error('bathrooms is outside the supported range')
  const sizeUnits = Math.max(1, Math.ceil(input.squareFeet / 500))
  let midpoint = 6500 + sizeUnits * 1800 + input.bathrooms * 1200
  const variables = [`${input.squareFeet} sq ft`, `${input.bathrooms} bathrooms`, input.frequency.replace('_', ' ')]
  const frequencyFactor = { weekly: 0.82, biweekly: 0.9, monthly: 1, one_time: 1.15 }[input.frequency]
  midpoint = Math.round(midpoint * frequencyFactor)
  if (input.deepClean) {
    midpoint = Math.round(midpoint * 1.75)
    variables.push('deep-clean scope')
  }
  if (input.pets) {
    midpoint += 2000
    variables.push('pet hair and access')
  }
  return {
    lowCents: Math.round(midpoint * 0.85 / 100) * 100,
    highCents: Math.round(midpoint * 1.2 / 100) * 100,
    variables,
  }
}
