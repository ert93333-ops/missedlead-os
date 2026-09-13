/**
 * 웹 임시저장 직렬화/복원 테스트.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftFile, readDraft, writeDraft } from './draft.web.ts';

test('browser restart keeps saved request but requires missing originals before upload', () => {
  const values = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  try {
    const token = `header.${Buffer.from(JSON.stringify({ sub: 'customer-one' })).toString('base64url')}.secret`;
    const storage = draftFile(token);
    assert.ok(storage);
    const draft = readDraft(storage);
    writeDraft(storage, { ...draft, files: [{ uri: 'blob:old-session', name: 'repair.jpg', mimeType: 'image/jpeg', size: 150 }], consent: true, confirmation: { requestId: 'saved-request', status: 'intake', matchCount: 0 }, uploadComplete: false });
    const resumed = readDraft(storage);
    assert.equal(resumed.confirmation?.requestId, 'saved-request');
    assert.equal(resumed.missingMedia, true);
    assert.equal(resumed.consent, false);
    assert.equal(resumed.uploadComplete, false);
    assert.equal(resumed.files[0]?.name, 'repair.jpg');
    assert.equal([...values.values()].some(value => value.includes(token)), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('different accounts have different browser draft keys', () => {
  const token = id => `header.${Buffer.from(JSON.stringify({ sub: id })).toString('base64url')}.secret`;
  assert.notEqual(draftFile(token('customer-one'))?.key, draftFile(token('customer-two'))?.key);
});
