import { describe, expect, it } from 'vitest'
import { calculateTransparentPrice, defaultPricingPolicy } from './pricing'

describe('calculateTransparentPrice', () => {
  it('derives every dollar from visible policy components', () => {
    const price = calculateTransparentPrice(defaultPricingPolicy, { confidence: 72, afterHours: false, safetyEscalation: false })
    const componentLow = price.components.reduce((sum, item) => sum + item.low, 0)
    const componentHigh = price.components.reduce((sum, item) => sum + item.high, 0)

    expect(price.low).toBe(componentLow)
    expect(price.high).toBe(componentHigh)
    expect(price.components.find((item) => item.label === 'Uncertainty range')?.basis).toContain('not a fee')
  })

  it('adds only the configured after-hours fee', () => {
    const regular = calculateTransparentPrice(defaultPricingPolicy, { confidence: 100, afterHours: false, safetyEscalation: false })
    const afterHours = calculateTransparentPrice(defaultPricingPolicy, { confidence: 100, afterHours: true, safetyEscalation: false })

    expect(afterHours.low - regular.low).toBe(defaultPricingPolicy.afterHoursFee)
    expect(afterHours.high - regular.high).toBe(defaultPricingPolicy.afterHoursFee)
  })

  it('narrows the range as evidence confidence improves', () => {
    const lowConfidence = calculateTransparentPrice(defaultPricingPolicy, { confidence: 40, afterHours: false, safetyEscalation: false })
    const highConfidence = calculateTransparentPrice(defaultPricingPolicy, { confidence: 90, afterHours: false, safetyEscalation: false })
    expect(lowConfidence.high).toBeGreaterThan(highConfidence.high)
    expect(lowConfidence.low).toBe(highConfidence.low)
  })

  it('emits no price when a safety escalation is active', () => {
    expect(calculateTransparentPrice(defaultPricingPolicy, { confidence: 92, afterHours: true, safetyEscalation: true })).toEqual({
      low: 0,
      high: 0,
      components: [],
      assumptions: ['Pricing is blocked until a human handles the safety escalation.'],
      blocked: true,
    })
  })
})
