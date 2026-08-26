import { Router } from 'express'
import twilio from 'twilio'
import { initialCallContext, nextVoiceActions, type VoiceAction } from '../src/telephony'

export type TwilioConfig = {
  authToken: string
  publicBaseUrl: string
  humanHandoffNumber?: string
}

export function actionsToTwiML(actions: VoiceAction[], config: Pick<TwilioConfig, 'humanHandoffNumber'>): string {
  const response = new twilio.twiml.VoiceResponse()
  for (const action of actions) {
    if (action.type === 'speak') response.say({ voice: 'Polly.Joanna' }, action.text)
    if (action.type === 'listen') {
      response.gather({
        input: ['speech'],
        action: `/api/webhooks/twilio/voice/turn?field=${action.field}`,
        speechTimeout: 'auto',
        timeout: 4,
      })
    }
    if (action.type === 'handoff') {
      if (config.humanHandoffNumber) response.dial(config.humanHandoffNumber)
      else response.say('A human operator will call you back shortly.')
    }
    if (action.type === 'complete') response.hangup()
  }
  return response.toString()
}

export function createTwilioRouter(config?: TwilioConfig) {
  const router = Router()
  router.use((request, response, next) => {
    if (!config?.authToken || !config.publicBaseUrl.startsWith('https://')) {
      response.status(503).json({ error: 'twilio_not_configured' })
      return
    }
    const signature = request.header('x-twilio-signature') ?? ''
    const url = `${config.publicBaseUrl.replace(/\/$/, '')}${request.originalUrl}`
    if (!twilio.validateRequest(config.authToken, signature, url, request.body as Record<string, string>)) {
      response.status(403).json({ error: 'invalid_twilio_signature' })
      return
    }
    next()
  })

  router.post('/voice', (_request, response) => {
    response.type('text/xml').send(actionsToTwiML(nextVoiceActions(initialCallContext), config ?? {}))
  })

  return router
}
