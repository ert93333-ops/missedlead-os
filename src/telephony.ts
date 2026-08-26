export type CallStage = 'disclosure' | 'intent' | 'location' | 'schedule' | 'handoff' | 'complete'

export type CallContext = {
  stage: CallStage
  disclosureAccepted: boolean
  summary: string
  postalCode: string
  dangerDetected: boolean
}

export type VoiceAction =
  | { type: 'speak'; text: string }
  | { type: 'listen'; field: 'disclosure' | 'summary' | 'postalCode' | 'schedule' }
  | { type: 'handoff'; reason: 'danger' | 'declined_disclosure' | 'low_confidence' }
  | { type: 'complete' }

const dangerPattern = /gas|smoke|fire|spark|carbon monoxide|electrocution|severe flooding/i

export const initialCallContext: CallContext = {
  stage: 'disclosure',
  disclosureAccepted: false,
  summary: '',
  postalCode: '',
  dangerDetected: false,
}

export function nextVoiceActions(context: CallContext): VoiceAction[] {
  if (context.dangerDetected) {
    return [
      { type: 'speak', text: 'This may be unsafe. Move away from the hazard and contact local emergency services when appropriate. I am connecting a human operator now.' },
      { type: 'handoff', reason: 'danger' },
    ]
  }

  switch (context.stage) {
    case 'disclosure':
      return [
        { type: 'speak', text: 'You are speaking with an AI assistant for the service company. This call may be processed to arrange service. Do you agree to continue?' },
        { type: 'listen', field: 'disclosure' },
      ]
    case 'intent':
      return [
        { type: 'speak', text: 'Briefly describe what is happening. Do not approach electrical, gas, fire, or flooding hazards.' },
        { type: 'listen', field: 'summary' },
      ]
    case 'location':
      return [
        { type: 'speak', text: 'What is the service postal code?' },
        { type: 'listen', field: 'postalCode' },
      ]
    case 'schedule':
      return [
        { type: 'speak', text: 'I can request an appointment window without promising a final price. Which day works best?' },
        { type: 'listen', field: 'schedule' },
      ]
    case 'handoff':
      return [{ type: 'handoff', reason: 'low_confidence' }]
    case 'complete':
      return [{ type: 'complete' }]
  }
}

export function applyCallInput(context: CallContext, input: string): CallContext {
  const normalized = input.trim()
  if (dangerPattern.test(normalized)) return { ...context, dangerDetected: true, stage: 'handoff' }

  switch (context.stage) {
    case 'disclosure': {
      const accepted = /^(yes|yeah|yep|i agree|continue)$/i.test(normalized)
      return accepted
        ? { ...context, disclosureAccepted: true, stage: 'intent' }
        : { ...context, stage: 'handoff' }
    }
    case 'intent':
      return normalized.length < 8
        ? { ...context, stage: 'handoff' }
        : { ...context, summary: normalized, stage: 'location' }
    case 'location':
      return /^\d{5}(-\d{4})?$/.test(normalized)
        ? { ...context, postalCode: normalized, stage: 'schedule' }
        : { ...context, stage: 'handoff' }
    case 'schedule':
      return { ...context, stage: 'complete' }
    default:
      return context
  }
}
