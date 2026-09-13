/**
 * 고객 요청 목록/상세 화면: 견적 비교·선택, 방문 일정, 상태 타임라인.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, Text, View } from 'react-native';
import { z } from 'zod';
import { Action, MotionView, styles } from '../chat/ui';
import { paymentUiEnabled } from '../config';
import { errorMessage, get, post, put } from '../platform/api';
import { activitySchema, capabilitiesSchema, dashboardSchema, money, requestStatus } from './contracts';
import type { ActivityData, ActivityMedia, Dashboard, Locale, Quote } from './contracts';
import { QuoteList } from './QuoteList';
import { RequestActions } from './RequestActions';
import { PaymentButton } from './PaymentButton';
import { Activity } from './Activity';

const mediaSchema = z.object({ media: z.array(z.object({ id: z.string(), fileName: z.string(), contentType: z.string(), url: z.string().url() })) });
export function RequestsScreen({ accessToken, locale, onBack }: { readonly accessToken: string; readonly locale: Locale; readonly onBack: () => void }) {
  const [data, setData] = useState<Dashboard>();
  const [selected, setSelected] = useState<string>();
  const [quote, setQuote] = useState<Quote>();
  const [payments, setPayments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [media, setMedia] = useState<z.infer<typeof mediaSchema>['media']>([]);
  const [activity, setActivity] = useState<ActivityData>();
  const t = useCallback((en: string, es: string) => locale === 'es' ? es : en, [locale]);
  const refresh = useCallback(async () => {
    const [dashboard, capabilities] = await Promise.all([get('/api/dashboard', accessToken, dashboardSchema), get('/api/capabilities', accessToken, capabilitiesSchema)]);
    setData(dashboard); setPayments(paymentUiEnabled(capabilities));
  }, [accessToken]);
  const refreshActivity = useCallback(async (requestId: string) => {
    const value = await get(`/api/requests/${encodeURIComponent(requestId)}/activity`, accessToken, activitySchema);
    setActivity(value);
  }, [accessToken]);
  useEffect(() => { let active = true; setBusy(true); void refresh().catch((error: unknown) => { if (active) setNotice(errorMessage(error, locale)); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [refresh, locale]);
  useEffect(() => { setQuote(undefined); setMedia([]); setActivity(undefined); if (!selected) return; let active = true;
    void Promise.all([
      get(`/api/requests/${encodeURIComponent(selected)}/intake-media`, accessToken, mediaSchema),
      get(`/api/requests/${encodeURIComponent(selected)}/activity`, accessToken, activitySchema),
    ]).then(([mediaValue, activityValue]) => { if (active) { setMedia(mediaValue.media); setActivity(activityValue); } }).catch((error: unknown) => { if (active) setNotice(errorMessage(error, locale)); });
    return () => { active = false; };
  }, [selected, accessToken, locale]);
  const openActivityMedia = async (item: ActivityMedia) => {
    if (!selected) return;
    try {
      const fresh = await get(`/api/requests/${encodeURIComponent(selected)}/activity`, accessToken, activitySchema);
      setActivity(fresh);
      const url = fresh.evidence.flatMap((evidence) => evidence.media).find((mediaItem) => mediaItem.id === item.id)?.url;
      if (!url || !await Linking.canOpenURL(url)) throw new Error(t('This evidence file cannot be opened.', 'No se puede abrir este archivo de prueba.'));
      await Linking.openURL(url);
    } catch (error) { setNotice(errorMessage(error, locale)); }
  };
  const act = async (path: string, body: unknown, method: 'POST' | 'PUT' = 'POST') => {
    setBusy(true); setNotice('');
    try { await (method === 'PUT' ? put(path, accessToken, z.unknown(), body) : post(path, accessToken, z.unknown(), body)); await refresh(); setNotice(t('Saved.', 'Guardado.')); return true; }
    catch (error) { setNotice(errorMessage(error, locale)); return false; }
    finally { setBusy(false); }
  };
  const request = data?.requests.find((v) => v.id === selected);
  const job = data?.jobs.find((v) => v.requestId === selected);
  const paymentReady = payments;
  return <View style={[styles.flex, styles.safe]}>
    <View style={styles.header}><Action label={selected ? t('All requests', 'Todas las solicitudes') : t('Back to chat', 'Volver al chat')} onPress={() => selected ? setSelected(undefined) : onBack()} /><Text style={styles.title}>{t('Your requests', 'Tus solicitudes')}</Text></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Action label={t('Refresh', 'Actualizar')} disabled={busy} onPress={() => { setBusy(true); void Promise.all([refresh(), selected ? refreshActivity(selected) : Promise.resolve()]).catch((error: unknown) => setNotice(errorMessage(error, locale))).finally(() => setBusy(false)); }} />
      {busy && <ActivityIndicator />}
      {!!notice && <Text accessibilityRole="alert" style={styles.body}>{notice}</Text>}
      {!selected && data?.requests.length === 0 && <Text style={styles.body}>{t('Start a chat to create your first request.', 'Inicia un chat para crear tu primera solicitud.')}</Text>}
      {!selected && data?.requests.map((value, index) => <MotionView key={value.id} delay={Math.min(index * 35, 175)} style={styles.separator}><Text style={styles.heading}>{value.description}</Text><Text style={styles.muted}>{value.address} · {requestStatus(value.status, locale)}</Text><Action label={t('View request', 'Ver solicitud')} onPress={() => setSelected(value.id)} /></MotionView>)}
      {request && data && <>
        <Text style={styles.heading}>{request.description}</Text><Text style={styles.body}>{request.address}</Text>
        {!paymentReady && <Text style={styles.muted}>{t('Payments are not available yet. You can review quotes and speak with professionals.', 'Los pagos aún no están disponibles. Puedes revisar presupuestos y hablar con profesionales.')}</Text>}
        <QuoteList quotes={data.quotes.filter((v) => v.requestId === request.id)} locale={locale} busy={busy || !paymentReady || !!job} onSelect={setQuote} />
        {quote && paymentReady && <View style={styles.warning}><Text style={styles.body}>{quote.providerName} · {money(quote.amountCents, locale)} {t('total. The secure payment screen shows the deposit due.', 'en total. La pantalla de pago seguro muestra el depósito.')}</Text><PaymentButton key={quote.id} accessToken={accessToken} requestId={request.id} quoteId={quote.id} locale={locale} onResult={setNotice} /></View>}
        {job?.completedAt && paymentReady && <PaymentButton accessToken={accessToken} requestId={request.id} locale={locale} onResult={setNotice} />}
        <Text style={styles.heading}>{t('Your attachments', 'Tus archivos')}</Text>
        {media.map((item) => <View key={item.id}>{item.contentType.startsWith('image/') && <Image accessibilityLabel={item.fileName} source={{ uri: item.url }} style={{ width: '100%', height: 180 }} resizeMode="contain" />}<Action label={item.fileName} onPress={() => { void get(`/api/requests/${encodeURIComponent(request.id)}/intake-media`, accessToken, mediaSchema).then((value) => { const fresh = value.media.find((v) => v.id === item.id); if (fresh) return Linking.openURL(fresh.url); }).catch((error: unknown) => setNotice(errorMessage(error, locale))); }} /></View>)}
        <Activity activity={activity} locale={locale} busy={busy} onRefresh={() => { setBusy(true); setNotice(''); void refreshActivity(request.id).catch((error: unknown) => setNotice(errorMessage(error, locale))).finally(() => setBusy(false)); }} onOpenMedia={(item) => { void openActivityMedia(item); }} />
        <RequestActions key={request.id} data={data} activity={activity} requestId={request.id} locale={locale} busy={busy} act={act} onActivityChanged={() => refreshActivity(request.id).catch((error: unknown) => { setNotice(errorMessage(error, locale)); })} />
      </>}
    </ScrollView>
  </View>;
}
