import { describe, expect, it } from 'vitest'
import { buildEstimate, validateCase } from './domain'

describe('buildEstimate', () => {
  it('widens the range and reports missing evidence', () => {
    const estimate = buildEstimate([
      { label: 'Leak overview video', observed: true, weight: 18 },
      { label: 'Fixture close-up', observed: false, weight: 16 },
    ])

    expect(estimate.confidence).toBe(56)
    expect(estimate.low).toBeLessThan(estimate.high)
    expect(estimate.missingEvidence).toEqual(['Fixture close-up'])
    expect(estimate.status).toBe('collecting_evidence')
    expect(estimate.canBook).toBe(false)
  })

  it('allows review only when evidence meets the confidence gate', () => {
    const estimate = buildEstimate([
      { label: 'Overview video', observed: true, weight: 18 },
      { label: 'Fixture close-up', observed: true, weight: 16 },
    ])

    expect(estimate.status).toBe('ready_for_review')
    expect(estimate.canBook).toBe(true)
  })

  it('blocks estimates and booking when safety evidence is present', () => {
    const estimate = buildEstimate([
      { label: 'Overview video', observed: true, weight: 20 },
    ], 'Customer reports gas odor near the heater')

    expect(estimate.safetyEscalation).toBe(true)
    expect(estimate.status).toBe('safety_escalation')
    expect(estimate.canBook).toBe(false)
    expect(estimate.low).toBe(0)
    expect(estimate.high).toBe(0)
  })
})

describe('validateCase', () => {
  it('requires identity, contact details, issue summary, and consent', () => {
    expect(validateCase({
      customerName: '',
      phone: '123',
      summary: '',
      consentToText: false,
      evidence: [],
    })).toEqual([
      'Customer name is required',
      'A valid phone number is required',
      'Issue summary is required',
      'Text messaging consent is required',
    ])
  })

  it('accepts a complete customer intake', () => {
    expect(validateCase({
      customerName: 'Alex Morgan',
      phone: '+15125550142',
      summary: 'Water under kitchen sink',
      consentToText: true,
      evidence: [],
    })).toEqual([])
  })
})
