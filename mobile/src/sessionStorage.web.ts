/**
 * 웹 세션 저장소: localStorage 기반, 토큰 길이·계정 ID 형식 검증.
 */
const refreshKey = 'wecover.refresh';
const accountKey = 'wecover.account';
const maxTokenLength = 16_384;
const maxAccountIdLength = 128;

function validAccountId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= maxAccountIdLength && /^[a-zA-Z0-9_-]+$/.test(value);
}

export async function readRefresh() { return sessionStorage.getItem(refreshKey); }
export async function writeRefresh(value: string, accountId: string) {
  if (value.length > maxTokenLength) throw new Error('The session token exceeds the browser storage limit.');
  if (!validAccountId(accountId)) throw new Error('The account identifier is invalid.');
  const previousAccount = sessionStorage.getItem(accountKey);
  try {
    sessionStorage.setItem(accountKey, accountId);
    sessionStorage.setItem(refreshKey, value);
  } catch (error) {
    if (previousAccount === null) sessionStorage.removeItem(accountKey);
    else sessionStorage.setItem(accountKey, previousAccount);
    throw error;
  }
}
export async function removeRefresh() { sessionStorage.removeItem(refreshKey); }

export async function clearSession(accountId?: string | null): Promise<void> {
  await removeRefresh();
  const storedAccount = sessionStorage.getItem(accountKey);
  const id = validAccountId(accountId) ? accountId : validAccountId(storedAccount) ? storedAccount : null;
  if (id) sessionStorage.removeItem(`wecover:mobile-draft:${id}`);
  sessionStorage.removeItem(accountKey);
}
