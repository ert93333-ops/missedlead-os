import { describe, expect, it } from 'vitest'
import { evaluateEvidenceProtocol, listEvidenceProtocols } from './evidenceProtocols'

describe('pre-visit evidence protocols', () => {
  it('covers the four priority trades with source-linked protocols', () => {
    const protocols = listEvidenceProtocols()
    expect(new Set(protocols.map((item) => item.trade))).toEqual(new Set(['plumbing', 'hvac', 'electrical', 'water_heater']))
    expect(protocols.every((item) => item.sources.length > 0 && item.questions.length > 0 && item.evidence.length > 0)).toBe(true)
  })

  it('uses positive and negative plumbing evidence to rank a drain-joint leak', () => {
    const result = evaluateEvidenceProtocol({
      protocolId: 'sink_leak',
      answers: { when_leaks: 'only while the sink drains', meter_moves: false, water_near_electric: false },
      observedEvidenceIds: ['overview_video', 'joint_closeup', 'dry_supply_lines'],
    })
    expect(result.safetyStop).toBe(false)
    expect(result.hypotheses[0]).toMatchObject({ id: 'drain_joint' })
    expect(result.hypotheses[0].supportingEvidence).toContain('Joint close-up')
    expect(result.hypotheses[0].confidence).toBeLessThanOrEqual(result.confidenceCeiling)
    expect(result.requiredFieldChecks).toContain('Run-and-drain test')
    expect(result.estimateVariables).toContain('access clearance')
  })

  it.each([
    ['sink_leak', { water_near_electric: true, when_leaks: 'water at electrical outlet', meter_moves: false }, []],
    ['drain_backup', { fixtures_affected: 'multiple fixtures', sewage_present: true, gurgling: true }, ['sewage_visible']],
    ['no_cooling', { thermostat: 'cool', airflow: true, ice: false, breaker_retrips: true }, []],
    ['breaker_trip', { repeat_trip: true, heat_or_odor: 'burning smell', what_running: 'dryer' }, []],
    ['water_heater_issue', { fuel: 'gas', leak_location: 'relief pipe', hot_discharge: true, gas_or_co: false }, []],
  ] as const)('stops normal inference for %s safety evidence', (protocolId, answers, observedEvidenceIds) => {
    const result = evaluateEvidenceProtocol({ protocolId, answers, observedEvidenceIds: [...observedEvidenceIds] })
    expect(result.safetyStop).toBe(true)
    expect(result.safetyInstruction).toBeTruthy()
    expect(result.hypotheses).toEqual([])
  })

  it('keeps electrical visual inference below its conservative ceiling', () => {
    const result = evaluateEvidenceProtocol({
      protocolId: 'breaker_trip',
      answers: { repeat_trip: false, heat_or_odor: false, what_running: 'space heater and microwave' },
      observedEvidenceIds: ['panel_exterior'],
    })
    expect(result.confidenceCeiling).toBe(0.55)
    expect(result.hypotheses.every((item) => item.confidence <= 0.55)).toBe(true)
    expect(result.limitations.join(' ')).toContain('voltage')
  })

  it('requests missing questions and uncollected capture evidence', () => {
    const result = evaluateEvidenceProtocol({ protocolId: 'no_cooling', answers: { thermostat: 'cool 72 room 82 fan auto' }, observedEvidenceIds: ['thermostat_photo'] })
    expect(result.unansweredQuestions.map((item) => item.id)).toEqual(['airflow', 'ice', 'breaker_retrips'])
    expect(result.captureRequests.map((item) => item.id)).toEqual(expect.arrayContaining(['filter_photo', 'ice_video', 'outdoor_unit_video']))
  })
})
