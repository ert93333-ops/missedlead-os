import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { endpointConfigurationIsValid } from '../config.web.ts';
import { draftFile, readDraft, writeDraft } from '../chat/draft.web.ts';
import { createForegroundRefreshController, createPermissionSelectionController } from './securityState.ts';

const accessToken = account => `header.${Buffer.from(JSON.stringify({ sub: account })).toString('base64url')}.signature`;
const opaqueRefreshToken = account => `v1.refresh:${account}:not-a-jwt.${'x'.repeat(48)}`;

test('release endpoint validation rejects HTTP, loopback, credentials, and malformed pairs', () => {
  assert.equal(endpointConfigurationIsValid('http://api.example.test', 'https://project.supabase.co', false), false);
  assert.equal(endpointConfigurationIsValid('https://127.0.0.1:8787', 'https://127.0.0.1:56321', false), false);
  assert.equal(endpointConfigurationIsValid('https://user:password@api.example.test', 'https://project.supabase.co', false), false);
  assert.equal(endpointConfigurationIsValid('https://api.example.test', 'https://project.supabase.co', false), true);
  assert.equal(endpointConfigurationIsValid('http://localhost:8787', 'https://project.supabase.co', true), false);
  assert.equal(endpointConfigurationIsValid('http://localhost:8787', 'http://127.0.0.1:56321', true), true);
});

test('logout and revocation storage cleanup is account scoped and removes media metadata', async () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const { clearSession, writeRefresh } = await import('../sessionStorage.web.ts');
  const secondDraft = JSON.stringify({ locale: 'es', files: [{ name: 'keep.jpg', uri: 'blob:keep' }] });
  values.set('wecover:mobile-draft:account-one', JSON.stringify({ locale: 'en', files: [{ name: 'remove.jpg', uri: 'blob:remove' }] }));
  values.set('wecover:mobile-draft:account-two', secondDraft);
  await writeRefresh(opaqueRefreshToken('account-one'), 'account-one');
  await clearSession('account-one');
  assert.equal(values.has('wecover.refresh'), false);
  assert.equal(values.has('wecover.account'), false);
  assert.equal(values.has('wecover:mobile-draft:account-one'), false);
  assert.equal(values.get('wecover:mobile-draft:account-two'), secondDraft);

  // A cold-start revocation only has the separately stored identity and opaque refresh token.
  await writeRefresh(opaqueRefreshToken('account-two'), 'account-two');
  await clearSession();
  assert.equal(values.has('wecover.refresh'), false);
  assert.equal(values.has('wecover.account'), false);
  assert.equal(values.has('wecover:mobile-draft:account-two'), false);
});

test('session cleanup never derives identity from an opaque refresh token or crosses accounts', async () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const { clearSession, writeRefresh } = await import('../sessionStorage.web.ts');
  values.set('wecover:mobile-draft:account-one', 'remove');
  values.set('wecover:mobile-draft:account-two', 'keep');
  await writeRefresh(opaqueRefreshToken('account-two'), 'account-one');
  await clearSession();
  assert.equal(values.has('wecover:mobile-draft:account-one'), false);
  assert.equal(values.get('wecover:mobile-draft:account-two'), 'keep');
});

async function nativeMediaProductionModule() {
  const mediaSource = await readFile(new URL('../chat/media.ts', import.meta.url), 'utf8');
  const helperSource = mediaSource.slice(
    mediaSource.indexOf('const validAccountId'),
    mediaSource.indexOf('export async function pickMedia'),
  ) + mediaSource.slice(
    mediaSource.indexOf('export function discardMedia'),
    mediaSource.indexOf('export function missingMedia'),
  );
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

async function nativeDraftCleanupProductionModule() {
  const draftSource = await readFile(new URL('../chat/draft.ts', import.meta.url), 'utf8');
  const helperSource = draftSource.slice(draftSource.indexOf('function validAccountId'));
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

async function authRestoreProductionModule() {
  const authSource = await readFile(new URL('../auth.ts', import.meta.url), 'utf8');
  const start = authSource.indexOf('export async function restorePersistedSession');
  const end = authSource.indexOf('\n\nexport function useAuth', start);
  const compiled = ts.transpileModule(authSource.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

function installNativeFileSystem() {
  const contents = new Map();
  const existing = new Set();
  globalThis.Paths = { document: 'file:///documents' };
  globalThis.Directory = class {
    constructor(parent, name) { this.uri = `${typeof parent === 'string' ? parent : parent.uri}/${name}`; }
    create() {}
  };
  globalThis.File = class {
    constructor(parent, name) { this.uri = name === undefined ? parent : `${parent.uri}/${name}`; }
    get exists() { return existing.has(this.uri); }
    textSync() { return contents.get(this.uri); }
    write(value) { contents.set(this.uri, value); existing.add(this.uri); }
    delete() { contents.delete(this.uri); existing.delete(this.uri); }
    copy(destination) {
      contents.set(destination.uri, contents.get(this.uri) ?? 'media');
      existing.add(destination.uri);
    }
  };
  return { contents, existing };
}

test('native account cleanup uses its journal when draft JSON is malformed', async () => {
  const { contents, existing } = installNativeFileSystem();
  const { retainMediaCopy, discardAccountMedia } = await nativeMediaProductionModule();
  const { clearAccountDraft } = await nativeDraftCleanupProductionModule();
  const source = new File('file:///picker/source.jpg');
  const destination = new File('file:///documents/wecover-intake/account-one.jpg');
  retainMediaCopy('account-one', source, destination);
  contents.set('file:///documents/wecover-drafts/account-one.json', '{"files":[');
  existing.add('file:///documents/wecover-drafts/account-one.json');
  clearAccountDraft('account-one', discardAccountMedia);
  assert.equal(existing.has(destination.uri), false);
  assert.equal(existing.has('file:///documents/wecover-intake/account-one.json'), false);
  assert.equal(existing.has('file:///documents/wecover-drafts/account-one.json'), false);
});

test('native journal covers a crash before draft write and partial deletion survives a cold retry', async () => {
  const { contents, existing } = installNativeFileSystem();
  const firstLoad = await nativeMediaProductionModule();
  const first = new File('file:///documents/wecover-intake/account-one-one.jpg');
  const second = new File('file:///documents/wecover-intake/account-one-two.jpg');
  const other = new File('file:///documents/wecover-intake/account-two.jpg');
  firstLoad.retainMediaCopy('account-one', new File('file:///picker/one.jpg'), first);
  firstLoad.retainMediaCopy('account-one', new File('file:///picker/two.jpg'), second);
  firstLoad.retainMediaCopy('account-two', new File('file:///picker/keep.jpg'), other);
  assert.equal(existing.has(first.uri), true);
  assert.equal(existing.has('file:///documents/wecover-drafts/account-one.json'), false);

  let failSecond = true;
  const retained = new Map([
    [first.uri, true],
    [second.uri, true],
    [other.uri, true],
  ]);
  const factory = uri => ({
    get exists() { return retained.get(uri); },
    delete() {
      if (uri === second.uri && failSecond) throw new Error('disk unavailable');
      retained.set(uri, false);
    },
  });
  assert.throws(() => firstLoad.discardAccountMedia('account-one', factory), /disk unavailable/);
  assert.deepEqual(JSON.parse(contents.get('file:///documents/wecover-intake/account-one.json')), [second.uri]);
  assert.equal(retained.get(first.uri), false);
  assert.equal(retained.get(second.uri), true);
  assert.equal(retained.get(other.uri), true);

  const coldRestart = await nativeMediaProductionModule();
  failSecond = false;
  coldRestart.discardAccountMedia('account-one', factory);
  assert.deepEqual([...retained.values()], [false, false, true]);
  assert.equal(existing.has('file:///documents/wecover-intake/account-one.json'), false);
  assert.equal(existing.has('file:///documents/wecover-intake/account-two.json'), true);
});

test('cold startup retries pending account cleanup even after the refresh token was already removed', async () => {
  const { restorePersistedSession } = await authRestoreProductionModule();
  let cleanupAttempts = 0;
  const cleanup = async () => {
    cleanupAttempts += 1;
    if (cleanupAttempts === 1) throw new Error('disk unavailable');
  };

  await assert.rejects(
    restorePersistedSession(async () => null, async () => ({ error: null }), cleanup),
    /disk unavailable/,
  );
  await restorePersistedSession(async () => null, async () => ({ error: null }), cleanup);
  assert.equal(cleanupAttempts, 2);
});

test('permission prompts specify denial recovery without adding broad permissions', async () => {
  const app = JSON.parse(await readFile(new URL('../../app.json', import.meta.url), 'utf8'));
  const imagePicker = app.expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-image-picker')[1];
  for (const key of ['cameraPermission', 'photosPermission', 'microphonePermission']) {
    assert.match(imagePicker[key], /denied/i);
    assert.match(imagePicker[key], /Settings/i);
    assert.match(imagePicker[key], /retry/i);
  }
  assert.equal(app.expo.android.permissions, undefined);
  assert.equal(app.expo.ios.infoPlist, undefined);
});

test('production permission controller blocks denial, then regrant enables a successful retry', async () => {
  let permission = { granted: false, canAskAgain: true };
  let requests = 0;
  let selections = 0;
  const controller = createPermissionSelectionController({
    getPermission: async () => permission,
    requestPermission: async () => {
      requests += 1;
      permission = { granted: false, canAskAgain: false };
      return permission;
    },
    select: async () => {
      selections += 1;
      return { uri: 'file:///selected.jpg' };
    },
    permissionDenied: () => new Error('camera_permission'),
  });

  await assert.rejects(controller.select(), /camera_permission/);
  await assert.rejects(controller.select(), /camera_permission/);
  assert.equal(requests, 1);
  assert.equal(selections, 0);

  permission = { granted: true, canAskAgain: false };
  assert.deepEqual(await controller.select(), { uri: 'file:///selected.jpg' });
  assert.equal(selections, 1);
});

test('production lifecycle controller stops in background and exposes foreground failure and retry', async () => {
  let attempts = 0;
  let autoRefresh = 'stopped';
  let exposedError = '';
  let refreshedAs = '';
  const controller = createForegroundRefreshController({
    refresh: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('refresh failed');
      return 'account-one';
    },
    onSuccess: account => { refreshedAs = account; exposedError = ''; },
    onFailure: error => { exposedError = error.message; },
    startAutoRefresh: () => { autoRefresh = 'started'; },
    stopAutoRefresh: () => { autoRefresh = 'stopped'; },
  });

  await controller.setAppState('background');
  assert.equal(autoRefresh, 'stopped');
  assert.equal(await controller.retry(), false);
  assert.equal(attempts, 0);

  assert.equal(await controller.setAppState('active'), false);
  assert.equal(autoRefresh, 'started');
  assert.equal(exposedError, 'refresh failed');

  assert.equal(await controller.retry(), true);
  assert.equal(refreshedAs, 'account-one');
  assert.equal(exposedError, '');
  controller.dispose();
  assert.equal(autoRefresh, 'stopped');
});

test('EN and ES draft changes persist for one account without crossing account boundaries', () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const first = draftFile(accessToken('account-one'));
  const second = draftFile(accessToken('account-two'));
  assert.ok(first);
  assert.ok(second);

  const initial = readDraft(first);
  assert.equal(writeDraft(first, { ...initial, locale: 'en', draft: 'Leaking pipe' }), true);
  assert.deepEqual(
    { locale: readDraft(first).locale, draft: readDraft(first).draft },
    { locale: 'en', draft: 'Leaking pipe' },
  );

  assert.equal(writeDraft(first, { ...readDraft(first), locale: 'es', draft: 'Tubería con fuga' }), true);
  assert.deepEqual(
    { locale: readDraft(first).locale, draft: readDraft(first).draft },
    { locale: 'es', draft: 'Tubería con fuga' },
  );
  assert.deepEqual(
    { locale: readDraft(second).locale, draft: readDraft(second).draft },
    { locale: 'en', draft: '' },
  );
});
