/**
 * 모바일 Supabase 인증: 세션 복원/저장, 이메일 로그인, 역할 해석.
 */
import { createClient, type Session } from '@supabase/supabase-js';
import {clearSession,readRefresh,writeRefresh} from './sessionStorage';
import { AppState } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { fetch } from 'expo/fetch';
import { z } from 'zod';
import { configured, apiUrl, supabaseKey, supabaseUrl } from './config';
import { createForegroundRefreshController } from './platform/securityState';

const client = configured ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: true } }) : null;

export async function restorePersistedSession(
  read: () => Promise<string | null>,
  refresh: (token: string) => Promise<{ error: Error | null }>,
  cleanup: () => Promise<void>,
): Promise<void> {
  const token = await read();
  if (!token) {
    await cleanup();
    return;
  }
  const result = await refresh(token);
  if (result.error) {
    await cleanup();
    throw result.error;
  }
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const currentSession = useRef<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState('');
  useEffect(() => {
    const auth = client?.auth;
    if (!auth) return;
    let active = true;
    let writes = Promise.resolve();
    const { data } = auth.onAuthStateChange((event, next) => {
      if (!active) return;
      const previous = currentSession.current;
      currentSession.current = next;
      setSession(next);
      if (event === 'INITIAL_SESSION') return;
      writes = writes.then(() => next ? writeRefresh(next.refresh_token, next.user.id) : clearSession(previous?.user.id)).catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not securely save your session.');
      });
    });
    const refreshController = createForegroundRefreshController({
      refresh: async () => {
        if (!currentSession.current) return;
        const result = await auth.refreshSession();
        if (result.error) throw result.error;
      },
      onSuccess: () => setError(''),
      onFailure: (caught) => {
        const previous = currentSession.current;
        currentSession.current = null;
        setSession(null);
        setError(caught instanceof Error ? caught.message : 'Please sign in again.');
        void clearSession(previous?.user.id).catch((cleanupError: unknown) => {
          if (active) setError(cleanupError instanceof Error ? cleanupError.message : 'Could not securely clear your session.');
        });
      },
      startAutoRefresh: () => auth.startAutoRefresh(),
      stopAutoRefresh: () => auth.stopAutoRefresh(),
    }, AppState.currentState === 'active');
    refreshController.start();
    void restorePersistedSession(
      readRefresh,
      async (token) => {
        const result = await auth.refreshSession({ refresh_token: token });
        return { error: result.error };
      },
      () => clearSession(),
    ).catch(async (caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Please sign in again.');
    }).finally(() => { if (active) setLoading(false); });
    const listener = AppState.addEventListener('change', (state) => {
      void refreshController.setAppState(state);
    });
    return () => { active = false; data.subscription.unsubscribe(); listener.remove(); refreshController.dispose(); };
  }, []);
  return {
    session, loading, error,
    async submit(email: string, password: string, signup: boolean) {
      if (!client) throw new Error('The service connection is not configured.');
      setError('');
      if (email === 'test') {
        if (signup) throw new Error('Use Sign in for the test account.');
        const response = await fetch(`${apiUrl}/api/demo/login`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:email,password}),signal:AbortSignal.timeout(30000)});
        if (!response.ok) throw new Error(response.status === 401 ? 'Check the test username and password.' : response.status === 429 ? 'Please wait a minute and try again.' : 'The test account is not available yet.');
        const tokens = z.object({access_token:z.string().min(1),refresh_token:z.string().min(1)}).parse(await response.json());
        const result = await client.auth.setSession(tokens);
        if (result.error) throw result.error;
        return Boolean(result.data.session);
      }
      const result = signup ? await client.auth.signUp({ email, password }) : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      return Boolean(result.data.session);
    },
    async signOut() {
      if (!client) return;
      const accountId = currentSession.current?.user.id;
      currentSession.current = null;
      setSession(null);
      await clearSession(accountId);
      const { error: failure } = await client.auth.signOut();
      if (failure) {
        await client.auth.signOut({ scope: 'local' });
        setError(failure.message);
      }
    },
  };
}
