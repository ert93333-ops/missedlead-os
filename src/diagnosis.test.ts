import { describe, expect, it } from 'vitest'
import { rankHypotheses } from './diagnosis'

describe('rankHypotheses', () => {
  it('ranks a drain joint issue when drain-only evidence agrees', () => {
    const hypotheses = rankHypotheses(['leaks_during_drain', 'supply_lines_dry', 'visible_joint_moisture'])

    expect(hypotheses[0]).toMatchObject({
      id: 'drain-joint-seal',
      confidence: 84,
    })
    expect(hypotheses[0].supportingEvidence).toHaveLength(3)
  })

  it('ranks a supply leak when meter movement is observed', () => {
    const hypotheses = rankHypotheses(['continuous_meter_movement'])

    expect(hypotheses[0]).toMatchObject({
      id: 'supply-line-leak',
      confidence: 38,
    })
  })

  it('abstains when there is no supporting evidence', () => {
    expect(rankHypotheses([])).toEqual([])
  })

  it('never reports diagnostic certainty above the safety cap', () => {
    const hypotheses = rankHypotheses(['leaks_during_drain', 'supply_lines_dry', 'visible_joint_moisture'])

    expect(hypotheses.every((item) => item.confidence <= 85)).toBe(true)
  })
})
