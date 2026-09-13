/**
 * 관리 화면 공용 상태: locale 문구 선택, 통화 포맷, 비동기 작업 훅(useTask).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import type { z } from 'zod';
import { get, errorMessage } from '../platform/api';
import { Action, styles } from '../chat/ui';
import { FormInputError } from './formValues';
export const words = (locale: 'en' | 'es', en: string, es: string) => locale === 'es' ? es : en;
export const dollars = (cents: number, locale: 'en' | 'es') => new Intl.NumberFormat(locale === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function useTask(locale: 'en' | 'es') {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const run = async (work: () => Promise<void>, success = '') => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(success); }
    catch (caught) { setError(caught instanceof FormInputError ? (caught.code === 'money' ? words(locale, 'Enter an amount below 40,000 USD using at most two decimal places.', 'Introduce un importe menor de 40.000 USD con un máximo de dos decimales.') : caught.code === 'file_size' ? words(locale, 'Choose a document smaller than 10 MB.', 'Elige un documento de menos de 10 MB.') : words(locale, 'Enter a real date using the format shown next to the field.', 'Introduce una fecha real con el formato indicado junto al campo.')) : errorMessage(caught, locale)); }
    finally { setBusy(false); }
  };
  return { busy, run, feedback: <>{busy && <ActivityIndicator accessibilityLabel={words(locale, 'Saving', 'Guardando')} />}{error !== '' && <Text accessibilityRole="alert" style={styles.danger}>{error}</Text>}{notice !== '' && <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text>}</> };
}
export function useRemote<T>(path: string, token: string, schema: z.ZodType<T>, locale: 'en' | 'es') {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const failure = useCallback((caught: unknown) => errorMessage(caught, locale), [locale]);
  const reload = useCallback(async () => { setLoading(true); setError(''); try { setData(await get(path, token, schema)); } catch (caught) { setError(failure(caught)); } finally { setLoading(false); } }, [path, token, schema, failure]);
  useEffect(() => { let active = true; void get(path, token, schema).then(value => { if (active) setData(value); }).catch((caught: unknown) => { if (active) setError(failure(caught)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [path, token, schema, failure]);
  return { data, reload, feedback: <>{loading && <ActivityIndicator />}{error !== '' && <><Text accessibilityRole="alert" style={styles.danger}>{error}</Text><Action label={words(locale, 'Retry', 'Reintentar')} onPress={() => void reload()} /></>}</> };
}
