import * as SecureStore from 'expo-secure-store';
import { clearAccountDraft } from './chat/draft';

const refreshKey = 'wecover.refresh';
const accountKey = 'wecover.account';
const maxAccountIdLength = 128;

function validAccountId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= maxAccountIdLength && /^[a-zA-Z0-9_-]+$/.test(value);
}

export const readRefresh = () => SecureStore.getItemAsync(refreshKey);
export async function writeRefresh(value: string, accountId: string): Promise<void> {
  if (!validAccountId(accountId)) throw new Error('The account identifier is invalid.');
  const previousAccount = await SecureStore.getItemAsync(accountKey);
  await SecureStore.setItemAsync(accountKey, accountId);
  try {
    await SecureStore.setItemAsync(refreshKey, value);
  } catch (error) {
    if (previousAccount === null) await SecureStore.deleteItemAsync(accountKey);
    else await SecureStore.setItemAsync(accountKey, previousAccount);
    throw error;
  }
}
export const removeRefresh = () => SecureStore.deleteItemAsync(refreshKey);

export async function clearSession(accountId?: string | null, clearDraft: typeof clearAccountDraft = clearAccountDraft): Promise<void> {
  await removeRefresh();
  const storedAccount = await SecureStore.getItemAsync(accountKey);
  const id = validAccountId(accountId) ? accountId : validAccountId(storedAccount) ? storedAccount : null;
  if (id) clearDraft(id);
  await SecureStore.deleteItemAsync(accountKey);
}
