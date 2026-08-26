import request from 'supertest'
import twilio from 'twilio'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { createCaseStore, type CaseStore } from './db'
import { actionsToTwiML } from './twilio'

let store: CaseStore
beforeEach(() => { store = createCaseStore(':memory:') })
afterEach(() => { store.close() })

describe('Twilio webhook', () => {
  const authToken = 'test-auth-token'
  const publicBaseUrl = 'https://api.missedlead.test'
  const params = { CallSid: 'CA123', From: '+15125550142', To: '+15125550143' }
  const url = `${publicBaseUrl}/api/webhooks/twilio/voice`

  it('fails closed when provider credentials are unavailable', async () => {
    await request(createApp(store))
      .post('/api/webhooks/twilio/voice')
      .type('form')
      .send(params)
      .expect(503, { error: 'twilio_not_configured' })
  })

  it('rejects forged webhook requests', async () => {
    await request(createApp(store, { twilio: { authToken, publicBaseUrl } }))
      .post('/api/webhooks/twilio/voice')
      .set('x-twilio-signature', 'forged')
      .type('form')
      .send(params)
      .expect(403, { error: 'invalid_twilio_signature' })
  })

  it('returns disclosure TwiML for a correctly signed request', async () => {
    const signature = twilio.getExpectedTwilioSignature(authToken, url, params)
    const response = await request(createApp(store, { twilio: { authToken, publicBaseUrl } }))
      .post('/api/webhooks/twilio/voice')
      .set('x-twilio-signature', signature)
      .type('form')
      .send(params)
      .expect(200)

    expect(response.type).toBe('text/xml')
    expect(response.text).toContain('AI assistant')
    expect(response.text).toContain('<Gather')
  })
})

describe('TwiML translation', () => {
  it('dials the configured human handoff number', () => {
    const xml = actionsToTwiML([{ type: 'handoff', reason: 'danger' }], { humanHandoffNumber: '+15125550199' })
    expect(xml).toContain('<Dial>+15125550199</Dial>')
  })
})
