import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySchema, canAcknowledgeCompletion, filterQuotes, hasRequiredCompletionEvidence, requestStatus } from './contracts.ts';

const quotes = [
  { id: 'best', amountCents: 20000, ranking: { earliestStartAt: '2026-09-10T12:00:00Z', languages: ['Spanish'] } },
  { id: 'cheapest', amountCents: 10000, ranking: { earliestStartAt: '2026-09-20T12:00:00Z', languages: ['en'] } },
  { id: 'other', amountCents: 15000, ranking: { earliestStartAt: '2026-09-12T12:00:00Z', languages: ['es'] } },
];
test('filters preserve backend recommended order instead of sorting cheapest first', () => {
  assert.deepEqual(filterQuotes(quotes, '', '').map((v) => v.id), ['best', 'cheapest', 'other']);
  assert.deepEqual(filterQuotes(quotes, 'es', '').map((v) => v.id), ['best', 'other']);
});
test('availability filter excludes later quotes and invalid dates do not expose mismatches', () => {
  assert.deepEqual(filterQuotes(quotes, '', '2026-09-11').map((v) => v.id), ['best']);
  assert.equal(filterQuotes(quotes, '', 'invalid').length, 0);
});
test('request status displays localized customer language', () => {
  assert.equal(requestStatus('funded', 'es'), 'Depósito pagado');
  assert.equal(requestStatus('unknown', 'es'), 'Solicitud en revisión');
});

const evidence = (id, kind) => ({
  id,
  requestId: 'request',
  kind,
  note: `${kind} note`,
  createdAt: '2026-09-05T10:00:00Z',
  media: [{ id, fileName: `${kind}.jpg`, contentType: 'image/jpeg', sizeBytes: 10, url: 'https://example.com/signed', expiresInSeconds: 60 }],
});
const activity = (evidenceItems, acknowledgment = null) => ({
  messages: [],
  schedules: [],
  evidence: evidenceItems,
  acknowledgment,
});

test('strict activity contract parses authoritative evidence and acknowledgment', () => {
  const parsed = activitySchema.parse(activity(
    [evidence('before', 'before'), evidence('after', 'after')],
    { requestId: 'request', acceptedAt: '2026-09-05T11:00:00Z' },
  ));
  assert.equal(parsed.evidence.length, 2);
  assert.equal(parsed.acknowledgment?.requestId, 'request');
});

test('completion requires both before and after evidence', () => {
  assert.equal(hasRequiredCompletionEvidence(activity([evidence('before', 'before')])), false);
  assert.equal(hasRequiredCompletionEvidence(activity([evidence('after', 'after')])), false);
  assert.equal(canAcknowledgeCompletion(activity([evidence('before', 'before'), evidence('after', 'after')])), true);
});

test('existing acknowledgment prevents another acknowledgment', () => {
  const value = activity(
    [evidence('before', 'before'), evidence('after', 'after')],
    { requestId: 'request', acceptedAt: '2026-09-05T11:00:00Z' },
  );
  assert.equal(hasRequiredCompletionEvidence(value), true);
  assert.equal(canAcknowledgeCompletion(value), false);
});

test('receipt and warranty do not substitute for before or after evidence', () => {
  assert.equal(hasRequiredCompletionEvidence(activity([evidence('before', 'before'), evidence('receipt', 'receipt'), evidence('warranty', 'warranty')])), false);
  assert.equal(hasRequiredCompletionEvidence(activity([evidence('after', 'after'), evidence('receipt', 'receipt'), evidence('warranty', 'warranty')])), false);
});
