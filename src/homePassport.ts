export type EquipmentCategory = 'hvac' | 'water_heater' | 'plumbing' | 'electrical'

export type HomeAsset = {
  id: string
  category: EquipmentCategory
  label: string
  installedYear: number
  expectedLifeYears: number
  serviceIntervalMonths: number
  lastServicedAt: string | null
  condition: 'good' | 'watch' | 'urgent'
}

export type AssetHealth = {
  assetId: string
  score: number
  riskLevel: 'low' | 'medium' | 'high'
  reasons: string[]
  nextDueAt: string
  action: string
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

export function evaluateAssetHealth(asset: HomeAsset, now = new Date()): AssetHealth {
  const reasons: string[] = []
  const age = now.getUTCFullYear() - asset.installedYear
  const ageRatio = Math.max(0, age / asset.expectedLifeYears)
  let penalty = Math.round(Math.min(45, ageRatio * 35))
  if (ageRatio >= 0.8) reasons.push(`Asset is ${age} years old, near its ${asset.expectedLifeYears}-year planning life.`)

  const baseline = asset.lastServicedAt ? new Date(asset.lastServicedAt) : new Date(Date.UTC(asset.installedYear, 0, 1))
  const nextDue = addMonths(baseline, asset.serviceIntervalMonths)
  const overdueMonths = Math.max(0, (now.getUTCFullYear() - nextDue.getUTCFullYear()) * 12 + now.getUTCMonth() - nextDue.getUTCMonth())
  if (overdueMonths > 0) {
    penalty += Math.min(30, 10 + overdueMonths * 2)
    reasons.push(`Scheduled maintenance is approximately ${overdueMonths} month${overdueMonths === 1 ? '' : 's'} overdue.`)
  }

  if (asset.condition === 'watch') {
    penalty += 15
    reasons.push('The assigned technician marked this asset for observation.')
  }
  if (asset.condition === 'urgent') {
    penalty += 35
    reasons.push('The assigned technician marked this asset urgent; human review is required.')
  }

  const score = Math.max(0, 100 - penalty)
  const riskLevel = score < 45 ? 'high' : score < 70 ? 'medium' : 'low'
  return {
    assetId: asset.id,
    score,
    riskLevel,
    reasons: reasons.length > 0 ? reasons : ['No current age, schedule, or technician condition flags.'],
    nextDueAt: nextDue.toISOString(),
    action: asset.condition === 'urgent'
      ? 'Route to the assigned technician for human review.'
      : overdueMonths > 0
        ? `Schedule the overdue ${asset.label} maintenance visit.`
        : `Keep the next ${asset.label} service due date on the home calendar.`,
  }
}

export function calculateContinuityScore(visitTechnicianIds: string[], assignedTechnicianId: string): number {
  if (visitTechnicianIds.length === 0) return 100
  const assignedVisits = visitTechnicianIds.filter((id) => id === assignedTechnicianId).length
  return Math.round(assignedVisits / visitTechnicianIds.length * 100)
}

export function prioritizeActions(assets: HomeAsset[], now = new Date()): AssetHealth[] {
  return assets.map((asset) => evaluateAssetHealth(asset, now)).sort((left, right) => left.score - right.score)
}
