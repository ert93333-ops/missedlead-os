import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAttachments, ChatError, confirmationSchema, assessmentSchema } from './protocol.ts';

const attachment = (size) => ({ uri: 'file:///repair.jpg', name: 'repair.jpg', mimeType: 'image/jpeg', size });

test('rejects attachments above the server decimal-byte limit', () => {
  const files = [attachment(25_000_001)];
  assert.throws(() => validateAttachments(files), ChatError);
});

test('accepts the exact aggregate file boundary', () => {
  const files = [attachment(25_000_000), attachment(25_000_000)];
  assert.doesNotThrow(() => validateAttachments(files));
});

test('rejects eleven files even when byte sizes are small', () => {
  const files = Array.from({ length: 11 }, () => attachment(10));
  assert.throws(() => validateAttachments(files), ChatError);
});

test('preserves zero eligible matches without inventing a booking', () => {
  const response = { requestId: 'request-one', status: 'intake', matchCount: 0 };
  assert.equal(confirmationSchema.parse(response).matchCount, 0);
});

test('rejects unsigned analysis responses at the API boundary', () => {
  const response = { reply: 'Inspect the hinge', locale: 'en', issueCandidates: [], questions: [], safety: { level: 'normal', guidance: '' }, readyToConfirm: false };
  assert.equal(assessmentSchema.safeParse(response).success, false);
});


test('adds a user turn for media-only followups while preserving signed history', async () => {
  const { nextHistory } = await import('./protocol.ts');
  const history = [{role:'user',content:'A leak',locale:'en'}, {role:'assistant',content:'Send a photo',locale:'en'}];
  const result = nextHistory(history, '', 'en', true);
  assert.deepEqual(result.slice(0,2), history);
  assert.equal(result[2].role, 'user');
  assert.ok(result[2].content.length > 0);
});

test('does not invent a user answer when only skipping a question', async () => {
  const { nextHistory } = await import('./protocol.ts');
  const history = [{role:'user',content:'A leak',locale:'es'}];
  assert.deepEqual(nextHistory(history, '', 'es', false), history);
});

test('quick replies submit explicit localized user-visible answers', async () => {
  const { quickReplyLabels } = await import('./protocol.ts');
  assert.deepEqual(quickReplyLabels('en'), ['Yes', 'No', 'Not sure']);
  assert.deepEqual(quickReplyLabels('es'), ['Sí', 'No', 'No estoy seguro/a']);
});

test('blocks confirmation when additional customer details remain unsent', async () => {
  const { hasUnsentDetails } = await import('./protocol.ts');
  assert.equal(hasUnsentDetails('There is also a burning smell'), true);
  assert.equal(hasUnsentDetails('  '), false);
});


test('rejects executable and insecure reference links while accepting HTTPS references', async () => {
  const { referenceSchema } = await import('./protocol.ts');
  assert.equal(referenceSchema.safeParse({title:'Safety',url:'https://www.cpsc.gov/Safety-Education'}).success, true);
  for (const url of ['javascript:alert(1)', 'http://example.org', 'https://user:secret@example.org']) assert.equal(referenceSchema.safeParse({title:'Safety',url}).success, false);
});

test('enforces conversation count and text budgets at the exact boundary', async () => {
  const { conversationLimitReached } = await import('./protocol.ts');
  const message = {role:'user',content:'x'.repeat(300),locale:'en'};
  assert.equal(conversationLimitReached(Array.from({length:80},()=>message)), false);
  assert.equal(conversationLimitReached(Array.from({length:81},()=>message)), true);
  assert.equal(conversationLimitReached([{...message,content:'x'.repeat(24001)}]), true);
});


test('emergency preflight prevents the media analysis callback from running', async () => {
  const { analyzeAfterSafety } = await import('./protocol.ts');
  const emergency = {reply:'Leave the area',locale:'en',assessmentToken:'safety-guidance-only',issueCandidates:[],questions:[],safety:{level:'emergency',guidance:'Leave the area'},readyToConfirm:false};
  let mediaCalls = 0;
  const result = await analyzeAfterSafety(async () => ({emergency:true,assessment:emergency}), async () => { mediaCalls++; return emergency; });
  assert.equal(result.safety.level, 'emergency');
  assert.equal(mediaCalls, 0);
});

test('unavailable safety preflight defers to authenticated analysis without inventing safety status', async () => {
  const { analyzeAfterSafety } = await import('./protocol.ts');
  const assessment = {reply:'More details',locale:'en',assessmentToken:'signed',issueCandidates:[],questions:[],safety:{level:'normal',guidance:''},readyToConfirm:false};
  let analysisCalls = 0;
  const result = await analyzeAfterSafety(async () => { throw new ChatError('network','connection_retry'); }, async () => { analysisCalls++; return assessment; });
  assert.equal(result, assessment);
  assert.equal(analysisCalls, 1);
});
