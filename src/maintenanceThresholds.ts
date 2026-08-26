import type { AssetHealth, HomeAsset } from './homePassport'
import type { ProtocolId } from './evidenceProtocols'

export type ThresholdLevel = 'low' | 'medium' | 'high'
export type ThresholdSeverity = 'advisory' | 'action_required' | 'urgent'
export type ThresholdRuleId = 'health_below_70' | 'health_below_45' | 'service_30_days_overdue' | 'service_90_days_overdue' | 'technician_urgent' | 'safety_stop'

export type ThresholdSnapshot = {
  score: number
  riskLevel: ThresholdLevel
  condition: HomeAsset['condition']
  overdueDays: number
}

export type ThresholdEventCandidate = {
  ruleId: ThresholdRuleId
  severity: ThresholdSeverity
  previousLevel: ThresholdLevel
  currentLevel: ThresholdLevel
  reason: string
  recommendedProtocolId: ProtocolId | null
  safetyStop: boolean
  bypassCooldown: boolean
  evidenceSnapshot: string[]
}

export type OpenThresholdState = {
  ruleId: ThresholdRuleId
  status: 'open' | 'acknowledged' | 'scheduled'
}

const recoveryScores: Partial<Record<ThresholdRuleId, number>> = {
  health_below_70: 75,
  health_below_45: 50,
}

export function protocolForAsset(asset: HomeAsset): ProtocolId | null {
  if (asset.category === 'hvac') return 'no_cooling'
  if (asset.category === 'plumbing') return 'sink_leak'
  if (asset.category === 'water_heater') return 'water_heater_issue'
  if (asset.category === 'electrical') return 'breaker_trip'
  return null
}

export function buildThresholdSnapshot(asset: HomeAsset, health: AssetHealth, now = new Date()): ThresholdSnapshot {
  const dueAt = new Date(health.nextDueAt).getTime()
  const overdueDays = Math.max(0, Math.floor((now.getTime() - dueAt) / 86_400_000))
  return { score: health.score, riskLevel: health.riskLevel, condition: asset.condition, overdueDays }
}

function crossedBelow(previous: number, current: number, threshold: number): boolean {
  return previous >= threshold && current < threshold
}

function crossedAbove(previous: number, current: number, threshold: number): boolean {
  return previous < threshold && current >= threshold
}

export function recoveredThresholdRules(previous: ThresholdSnapshot, current: ThresholdSnapshot): ThresholdRuleId[] {
  const recovered: ThresholdRuleId[] = []
  for (const [ruleId, recoveryScore] of Object.entries(recoveryScores) as [ThresholdRuleId, number][]) {
    if (crossedAbove(previous.score, current.score, recoveryScore)) recovered.push(ruleId)
  }
  if (previous.overdueDays >= 30 && current.overdueDays < 30) recovered.push('service_30_days_overdue')
  if (previous.overdueDays >= 90 && current.overdueDays < 90) recovered.push('service_90_days_overdue')
  if (previous.condition === 'urgent' && current.condition !== 'urgent') recovered.push('technician_urgent')
  return recovered
}

export function evaluateThresholdCrossings(input: {
  asset: HomeAsset
  previous: ThresholdSnapshot
  current: ThresholdSnapshot
  openEvents?: OpenThresholdState[]
  safetyStop?: boolean
  safetyEvidence?: string[]
}): ThresholdEventCandidate[] {
  const openRules = new Set((input.openEvents ?? []).map((event) => event.ruleId))
  const protocol = protocolForAsset(input.asset)
  const candidates: ThresholdEventCandidate[] = []
  const add = (candidate: ThresholdEventCandidate) => {
    if (candidate.ruleId === 'safety_stop' || !openRules.has(candidate.ruleId)) candidates.push(candidate)
  }

  if (crossedBelow(input.previous.score, input.current.score, 70)) add({
    ruleId: 'health_below_70', severity: 'advisory', previousLevel: input.previous.riskLevel, currentLevel: input.current.riskLevel,
    reason: 'Equipment health crossed below 70.', recommendedProtocolId: protocol, safetyStop: false, bypassCooldown: false,
    evidenceSnapshot: [`score:${input.previous.score}->${input.current.score}`],
  })
  if (crossedBelow(input.previous.score, input.current.score, 45)) add({
    ruleId: 'health_below_45', severity: 'action_required', previousLevel: input.previous.riskLevel, currentLevel: input.current.riskLevel,
    reason: 'Equipment health crossed below 45.', recommendedProtocolId: protocol, safetyStop: false, bypassCooldown: false,
    evidenceSnapshot: [`score:${input.previous.score}->${input.current.score}`],
  })
  if (input.previous.overdueDays < 30 && input.current.overdueDays >= 30) add({
    ruleId: 'service_30_days_overdue', severity: 'advisory', previousLevel: input.previous.riskLevel, currentLevel: input.current.riskLevel,
    reason: 'Scheduled service became at least 30 days overdue.', recommendedProtocolId: protocol, safetyStop: false, bypassCooldown: false,
    evidenceSnapshot: [`overdueDays:${input.current.overdueDays}`],
  })
  if (input.previous.overdueDays < 90 && input.current.overdueDays >= 90) add({
    ruleId: 'service_90_days_overdue', severity: 'action_required', previousLevel: input.previous.riskLevel, currentLevel: input.current.riskLevel,
    reason: 'Scheduled service became at least 90 days overdue.', recommendedProtocolId: protocol, safetyStop: false, bypassCooldown: false,
    evidenceSnapshot: [`overdueDays:${input.current.overdueDays}`],
  })
  if (input.previous.condition !== 'urgent' && input.current.condition === 'urgent') add({
    ruleId: 'technician_urgent', severity: 'urgent', previousLevel: input.previous.riskLevel, currentLevel: input.current.riskLevel,
    reason: 'The assigned technician marked the equipment urgent.', recommendedProtocolId: protocol, safetyStop: true, bypassCooldown: true,
    evidenceSnapshot: ['technicianCondition:urgent'],
  })
  if (input.safetyStop) add({
    ruleId: 'safety_stop', severity: 'urgent', previousLevel: input.previous.riskLevel, currentLevel: input.current.riskLevel,
    reason: 'Safety evidence requires immediate human escalation.', recommendedProtocolId: protocol, safetyStop: true, bypassCooldown: true,
    evidenceSnapshot: input.safetyEvidence ?? ['safetyStop:true'],
  })
  return candidates
}
