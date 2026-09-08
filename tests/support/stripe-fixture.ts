import http from 'node:http'
import Stripe from 'stripe'

const stripe = new Stripe('sk_test_dummy')
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_dummy'
const fixtureSecret = process.env.INTEGRATION_STRIPE_FIXTURE_SECRET ?? 'fixture-secret'
const apiUrl = process.env.INTEGRATION_API_URL ?? 'http://127.0.0.1:8790'

http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.headers['x-fixture-secret'] !== fixtureSecret) {
    response.writeHead(403).end()
    return
  }
  let raw = ''
  for await (const chunk of request) raw += chunk
  const input = JSON.parse(raw)
  const dispute = input.kind === 'dispute'
  const event = {
    id: input.eventId ?? `evt_${input.kind}_${input.requestId}`,
    type: dispute ? input.eventType : 'payment_intent.succeeded',
    data: {
      object: dispute
        ? { id: input.externalId, amount: input.amountCents, status: input.status, metadata: { requestId: input.requestId } }
        : { id: input.providerReference, metadata: { requestId: input.requestId } },
    },
  }
  const payload = JSON.stringify(event)
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })
  const result = await fetch(`${apiUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  })
  response.writeHead(result.status, { 'content-type': 'application/json' }).end(await result.text())
}).listen(8791, '127.0.0.1')
