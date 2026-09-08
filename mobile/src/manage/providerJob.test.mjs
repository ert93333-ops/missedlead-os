import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderEvidenceReadiness } from './providerJob.ts';

test('completion is not ready when before or after evidence is missing', () => {
  assert.equal(getProviderEvidenceReadiness('request-1', []).completionReady, false);
  assert.equal(getProviderEvidenceReadiness('request-1', [
    { requestId: 'request-1', kind: 'before' },
  ]).completionReady, false);
  assert.equal(getProviderEvidenceReadiness('request-1', [
    { requestId: 'request-1', kind: 'after' },
  ]).completionReady, false);
});

test('evidence belonging to another request does not count', () => {
  const readiness = getProviderEvidenceReadiness('request-1', [
    { requestId: 'request-1', kind: 'before' },
    { requestId: 'request-2', kind: 'after' },
  ]);

  assert.deepEqual(readiness.kinds, {
    before: true,
    during: false,
    after: false,
    receipt: false,
    warranty: false,
  });
  assert.equal(readiness.completionReady, false);
});

test('optional evidence kinds do not substitute for before and after', () => {
  const readiness = getProviderEvidenceReadiness('request-1', [
    { requestId: 'request-1', kind: 'during' },
    { requestId: 'request-1', kind: 'receipt' },
    { requestId: 'request-1', kind: 'warranty' },
  ]);

  assert.equal(readiness.completionReady, false);
  assert.equal(readiness.kinds.during, true);
  assert.equal(readiness.kinds.receipt, true);
  assert.equal(readiness.kinds.warranty, true);
});

test('completion is ready only when the selected request has before and after evidence', () => {
  const readiness = getProviderEvidenceReadiness('request-1', [
    { requestId: 'request-1', kind: 'before' },
    { requestId: 'request-1', kind: 'after' },
  ]);

  assert.equal(readiness.completionReady, true);
});
