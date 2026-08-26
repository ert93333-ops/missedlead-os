import { describe, expect, it } from 'vitest'
import type { HomeAsset } from './homePassport'
import { evaluateThresholdCrossings, recoveredThresholdRules, type ThresholdSnapshot } from './maintenanceThresholds'

const asset: HomeAsset = {
  id: 'asset-1', category: 'hvac', label: 'Main HVAC', installedYear: 2018, expectedLifeYears: 15,
  serviceIntervalMonths: 12, lastServicedAt: '2025-01-01T00:00:00.000Z', condition: 'good',
}
const snapshot = (score: number, overdueDays = 0, condition: HomeAsset['condition'] = 'good'): ThresholdSnapshot => ({
  score, overdueDays, condition, riskLevel: score < 45 ? 'high' : score < 70 ? 'medium' : 'low',
})

describe('maintenance threshold crossings', () => {
  it('emits only the first health crossing and maps the asset protocol', () => {
    const events = evaluateThresholdCrossings({ asset, previous: snapshot(74), current: snapshot(68) })
    expect(events).toEqual([expect.objectContaining({ ruleId: 'health_below_70', severity: 'advisory', recommendedProtocolId: 'no_cooling' })])
  })

  it('deduplicates an already-open rule', () => {
    const events = evaluateThresholdCrossings({
      asset, previous: snapshot(74), current: snapshot(68),
      openEvents: [{ ruleId: 'health_below_70', status: 'acknowledged' }],
    })
    expect(events).toEqual([])
  })

  it('requires hysteresis recovery before a health rule can reopen', () => {
    expect(recoveredThresholdRules(snapshot(68), snapshot(72))).not.toContain('health_below_70')
    expect(recoveredThresholdRules(snapshot(68), snapshot(75))).toContain('health_below_70')
    expect(recoveredThresholdRules(snapshot(40), snapshot(50))).toContain('health_below_45')
  })

  it('raises 30-day and 90-day overdue crossings independently', () => {
    expect(evaluateThresholdCrossings({ asset, previous: snapshot(80, 29), current: snapshot(80, 30) })[0].ruleId)
      .toBe('service_30_days_overdue')
    expect(evaluateThresholdCrossings({ asset, previous: snapshot(80, 89), current: snapshot(80, 90) })[0].ruleId)
      .toBe('service_90_days_overdue')
  })

  it('lets technician urgency and safety evidence bypass suppression', () => {
    const urgentAsset = { ...asset, condition: 'urgent' as const }
    const urgent = evaluateThresholdCrossings({
      asset: urgentAsset, previous: snapshot(60, 0, 'watch'), current: snapshot(30, 0, 'urgent'),
      openEvents: [{ ruleId: 'technician_urgent', status: 'open' }], safetyStop: true, safetyEvidence: ['breaker retripped'],
    })
    expect(urgent.map((event) => event.ruleId)).toEqual(['health_below_45', 'safety_stop'])
    expect(urgent.at(-1)).toMatchObject({ severity: 'urgent', safetyStop: true, bypassCooldown: true })
  })
})
