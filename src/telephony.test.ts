import { describe, expect, it } from 'vitest'
import { applyCallInput, initialCallContext, nextVoiceActions } from './telephony'

describe('telephony intake', () => {
  it('discloses AI use before collecting service details', () => {
    expect(nextVoiceActions(initialCallContext)).toEqual([
      expect.objectContaining({ type: 'speak', text: expect.stringContaining('AI assistant') }),
      { type: 'listen', field: 'disclosure' },
    ])
  })

  it('progresses through consent, issue, location, and scheduling', () => {
    const consented = applyCallInput(initialCallContext, 'yes')
    const described = applyCallInput(consented, 'Water leaks when the sink drains')
    const located = applyCallInput(described, '78701')
    const completed = applyCallInput(located, 'tomorrow morning')

    expect(consented.stage).toBe('intent')
    expect(described).toMatchObject({ stage: 'location', summary: 'Water leaks when the sink drains' })
    expect(located).toMatchObject({ stage: 'schedule', postalCode: '78701' })
    expect(completed.stage).toBe('complete')
  })

  it('hands off when disclosure is declined or input is ambiguous', () => {
    expect(applyCallInput(initialCallContext, 'no').stage).toBe('handoff')
    expect(applyCallInput({ ...initialCallContext, stage: 'intent', disclosureAccepted: true }, 'leak').stage).toBe('handoff')
  })

  it('interrupts every normal flow when danger is reported', () => {
    const context = applyCallInput({ ...initialCallContext, stage: 'intent', disclosureAccepted: true }, 'I smell gas near the heater')

    expect(context).toMatchObject({ stage: 'handoff', dangerDetected: true })
    expect(nextVoiceActions(context)).toEqual([
      expect.objectContaining({ type: 'speak', text: expect.stringContaining('unsafe') }),
      { type: 'handoff', reason: 'danger' },
    ])
  })
})
