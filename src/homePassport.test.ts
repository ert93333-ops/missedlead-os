import { describe, expect, it } from 'vitest'
import { calculateContinuityScore, evaluateAssetHealth, prioritizeActions, type HomeAsset } from './homePassport'

const now = new Date('2026-08-26T00:00:00.000Z')
const asset: HomeAsset = {
  id: 'asset-1', category: 'hvac', label: 'Main HVAC', installedYear: 2014, expectedLifeYears: 15,
  serviceIntervalMonths: 12, lastServicedAt: '2025-02-01T00:00:00.000Z', condition: 'watch',
}

describe('Home Passport', () => {
  it('produces an explainable health score without predicting failure', () => {
    const health = evaluateAssetHealth(asset, now)
    expect(health.riskLevel).toBe('high')
    expect(health.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('near its 15-year planning life'),
      expect.stringContaining('overdue'),
      expect.stringContaining('marked this asset for observation'),
    ]))
    expect(health.action).toContain('Schedule')
  })

  it('forces human review for technician-marked urgent assets', () => {
    const health = evaluateAssetHealth({ ...asset, condition: 'urgent' }, now)
    expect(health.riskLevel).toBe('high')
    expect(health.action).toContain('human review')
  })

  it('prioritizes the lowest health score first', () => {
    const healthy = { ...asset, id: 'asset-2', installedYear: 2025, lastServicedAt: '2026-07-01T00:00:00.000Z', condition: 'good' as const }
    expect(prioritizeActions([healthy, asset], now)[0].assetId).toBe('asset-1')
  })

  it('measures assigned-technician continuity transparently', () => {
    expect(calculateContinuityScore([], 'tech-a')).toBe(100)
    expect(calculateContinuityScore(['tech-a', 'tech-a', 'tech-b', 'tech-a'], 'tech-a')).toBe(75)
  })
})
