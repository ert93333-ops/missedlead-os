import { calculateTransparentPrice, defaultPricingPolicy } from './pricing'

export type Evidence = {
  label: string
  observed: boolean
  weight: number
}

export type CaseStatus = 'recovering' | 'collecting_evidence' | 'ready_for_review' | 'safety_escalation'

export type ServiceCase = {
  customerName: string
  phone: string
  summary: string
  consentToText: boolean
  evidence: Evidence[]
}

export type Estimate = {
  low: number
  high: number
  confidence: number
  missingEvidence: string[]
  safetyEscalation: boolean
  status: CaseStatus
  canBook: boolean
}

const dangerPattern = /gas|smoke|spark|fire|carbon monoxide|sewage flood|active flooding/i

export function buildEstimate(evidence: Evidence[], summary = '', afterHours = true): Estimate {
  const observed = evidence.filter((item) => item.observed)
  const confidence = Math.min(92, 38 + observed.reduce((sum, item) => sum + item.weight, 0))
  const safetyEscalation = dangerPattern.test(summary) || observed.some((item) => dangerPattern.test(item.label))
  const missingEvidence = evidence.filter((item) => !item.observed).map((item) => item.label)
  const status: CaseStatus = safetyEscalation
    ? 'safety_escalation'
    : confidence >= 72
      ? 'ready_for_review'
      : 'collecting_evidence'

  const price = calculateTransparentPrice(defaultPricingPolicy, { confidence, afterHours, safetyEscalation })
  return {
    low: price.low,
    high: price.high,
    confidence,
    missingEvidence,
    safetyEscalation,
    status,
    canBook: !safetyEscalation && confidence >= 72,
  }
}

export function validateCase(serviceCase: ServiceCase): string[] {
  const errors: string[] = []
  if (!serviceCase.customerName.trim()) errors.push('Customer name is required')
  if (!/^\+?[1-9]\d{7,14}$/.test(serviceCase.phone.replace(/[\s()-]/g, ''))) errors.push('A valid phone number is required')
  if (!serviceCase.summary.trim()) errors.push('Issue summary is required')
  if (!serviceCase.consentToText) errors.push('Text messaging consent is required')
  return errors
}

