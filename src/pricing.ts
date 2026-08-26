export type PricingPolicy = {
  currency: 'USD'
  dispatchFee: number
  hourlyLaborLow: number
  hourlyLaborHigh: number
  expectedHoursLow: number
  expectedHoursHigh: number
  partsLow: number
  partsHigh: number
  afterHoursFee: number
}

export type PricingContext = {
  confidence: number
  afterHours: boolean
  safetyEscalation: boolean
}

export type PriceComponent = {
  label: string
  low: number
  high: number
  basis: string
}

export type TransparentPrice = {
  low: number
  high: number
  components: PriceComponent[]
  assumptions: string[]
  blocked: boolean
}

export const defaultPricingPolicy: PricingPolicy = {
  currency: 'USD',
  dispatchFee: 89,
  hourlyLaborLow: 90,
  hourlyLaborHigh: 145,
  expectedHoursLow: 1,
  expectedHoursHigh: 2,
  partsLow: 10,
  partsHigh: 45,
  afterHoursFee: 75,
}

export function calculateTransparentPrice(policy: PricingPolicy, context: PricingContext): TransparentPrice {
  if (context.safetyEscalation) {
    return {
      low: 0,
      high: 0,
      components: [],
      assumptions: ['Pricing is blocked until a human handles the safety escalation.'],
      blocked: true,
    }
  }

  const components: PriceComponent[] = [
    { label: 'Dispatch & assessment', low: policy.dispatchFee, high: policy.dispatchFee, basis: 'Contractor-approved fixed fee' },
    {
      label: 'Expected labor',
      low: policy.hourlyLaborLow * policy.expectedHoursLow,
      high: policy.hourlyLaborHigh * policy.expectedHoursHigh,
      basis: `${policy.expectedHoursLow}–${policy.expectedHoursHigh} hours at approved hourly rates`,
    },
    { label: 'Common parts', low: policy.partsLow, high: policy.partsHigh, basis: 'Typical consumable parts; major components excluded' },
  ]
  if (context.afterHours) {
    components.push({ label: 'After-hours service', low: policy.afterHoursFee, high: policy.afterHoursFee, basis: 'Contractor-approved after-hours fee' })
  }

  const subtotalLow = components.reduce((sum, item) => sum + item.low, 0)
  const subtotalHigh = components.reduce((sum, item) => sum + item.high, 0)
  const uncertainty = Math.max(0, 100 - context.confidence) / 100
  const uncertaintyHigh = Math.round(subtotalHigh * uncertainty * 0.5)
  if (uncertaintyHigh > 0) {
    components.push({
      label: 'Uncertainty range',
      low: 0,
      high: uncertaintyHigh,
      basis: `Range only—not a fee. ${context.confidence}% evidence confidence leaves unresolved scope.`,
    })
  }

  return {
    low: Math.round(subtotalLow),
    high: Math.round(subtotalHigh + uncertaintyHigh),
    components,
    assumptions: [
      'Accessible residential fixture with no concealed structural damage.',
      'Final price requires technician inspection and customer approval.',
      'No taxes, permits, restoration, or major replacement parts are included.',
    ],
    blocked: false,
  }
}
