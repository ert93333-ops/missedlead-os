import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Action, Check, styles } from '../chat/ui';
import type { ActivityData, Dashboard, Locale } from './contracts';
import { canAcknowledgeCompletion, hasRequiredCompletionEvidence, money } from './contracts';
import { VisitPicker } from './VisitPicker';

export function RequestActions({ data, activity, requestId, locale, busy, act, onActivityChanged }: { readonly data: Dashboard; readonly activity?: ActivityData; readonly requestId: string; readonly locale: Locale; readonly busy: boolean; readonly act: (path: string, body: unknown, method?: 'POST' | 'PUT') => Promise<boolean>; readonly onActivityChanged: () => Promise<void> }) {
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState('');
  const [rating, setRating] = useState(5);
  const [acknowledged, setAcknowledged] = useState(false);
  const t = (en: string, es: string) => locale === 'es' ? es : en;
  const base = `/api/requests/${encodeURIComponent(requestId)}`;
  const job = data.jobs.find((v) => v.requestId === requestId);
  const schedule = data.schedules.find((v) => v.requestId === requestId);
  const changes = data.changes.filter((v) => v.requestId === requestId);
  const completionEvidenceReady = activity ? hasRequiredCompletionEvidence(activity) : false;
  const completionCanBeAcknowledged = activity ? canAcknowledgeCompletion(activity) : false;
  return <>
    <View style={styles.section}>
      <Text style={styles.heading}>{t('Conversation', 'Conversación')}</Text>
      <Text style={styles.muted}>{t('Phone numbers and email addresses are hidden automatically.', 'Los teléfonos y correos se ocultan automáticamente.')}</Text>
      {data.messages.filter((v) => v.requestId === requestId).map((v) => <View key={v.id} style={styles.bubble}><Text style={styles.body}>{v.text}</Text><Text style={styles.muted}>{new Date(v.createdAt).toLocaleString(locale)}</Text></View>)}
      <TextInput accessibilityLabel={t('Message', 'Mensaje')} multiline maxLength={2000} style={styles.input} value={message} onChangeText={setMessage} />
      <Action label={t('Send', 'Enviar')} disabled={busy || !message.trim()} onPress={() => { void act(`${base}/messages`, { text: message.trim() }).then((saved) => { if (saved) setMessage(''); }); }} />
    </View>
    <View style={styles.section}>
      <Text style={styles.heading}>{t('Visit', 'Visita')}</Text>
      {schedule && <Text style={styles.body}>{new Date(schedule.startsAt).toLocaleString(locale)} · {schedule.timeZone} · {schedule.status === 'confirmed' ? t('Confirmed', 'Confirmada') : t('Proposed', 'Propuesta')}</Text>}
      <VisitPicker locale={locale} busy={busy} onPropose={(date) => { void act(`${base}/schedule`, { startsAt: date.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, status: 'proposed' }, 'PUT'); }} />
      {schedule?.status === 'proposed' && <Action label={t('Confirm proposed visit', 'Confirmar visita propuesta')} disabled={busy} onPress={() => { void act(`${base}/schedule`, { startsAt: schedule.startsAt, timeZone: schedule.timeZone, status: 'confirmed' }, 'PUT'); }} />}
    </View>
    {changes.map((change) => <View key={change.id} style={styles.warning}>
      <Text style={styles.heading}>{t('Additional work', 'Trabajo adicional')} · {money(change.amountCents, locale)}</Text>
      <Text style={styles.body}>{change.description}</Text>
      {change.items.map((item, i) => <Text key={i} style={styles.body}>{item.description} × {item.quantity} · {money(item.unitCents, locale)}</Text>)}
      {data.evidence.filter((v) => change.evidenceIds.includes(v.id)).map((v) => <Text key={v.id} style={styles.body}>{v.note}</Text>)}
      {change.approvedAt ? <Text style={styles.body}>{t('Approved', 'Aprobado')}</Text> : <Action label={t('Approve this extra charge', 'Aprobar este cargo adicional')} disabled={busy} onPress={() => { void act(`/api/changes/${encodeURIComponent(change.id)}/approve`, {}); }} />}
    </View>)}
    {!!job?.completedAt && <View style={styles.section}>
      <Text style={styles.heading}>{t('Work completed', 'Trabajo terminado')}</Text>
      {activity?.acknowledgment ? <Text style={styles.body}>{t('You confirmed completion.', 'Confirmaste la finalización.')}</Text> : <>
        {!completionEvidenceReady && <Text style={styles.muted}>{t('Before and after evidence is required before you can confirm completion.', 'Se requieren pruebas de antes y después antes de confirmar la finalización.')}</Text>}
        <Check checked={acknowledged} onPress={() => setAcknowledged(!acknowledged)} label={t('I have inspected the before and after evidence and the completed work.', 'He revisado las pruebas de antes y después y el trabajo terminado.')} />
        <Action label={t('Confirm completion', 'Confirmar finalización')} disabled={busy || !acknowledged || !completionCanBeAcknowledged} onPress={() => { void act(`${base}/completion-ack`, { accepted: true }).then(async (saved) => { if (saved) await onActivityChanged(); }); }} />
      </>}
      <Text style={styles.muted}>{t('Report a problem within 72 hours of completion.', 'Informa de un problema dentro de las 72 horas posteriores a la finalización.')}</Text>
      {data.disputes.filter((v) => v.requestId === requestId).map((v) => <Text key={v.id} style={styles.body}>{v.reason} · {v.status}</Text>)}
      <TextInput accessibilityLabel={t('Describe a problem', 'Describe un problema')} multiline style={styles.input} value={reason} onChangeText={setReason} />
      <Action label={t('Report problem', 'Informar de un problema')} disabled={busy || reason.trim().length < 3} onPress={() => { void act(`${base}/disputes`, { source: 'internal', reason: reason.trim() }).then(async (saved) => { if (saved) { setReason(''); await onActivityChanged(); } }); }} />
    </View>}
    {job?.settlementState === 'settled' && <View style={styles.section}>
      <Text style={styles.heading}>{t('Your review', 'Tu reseña')}</Text>
      {data.reviews.some((v) => v.requestId === requestId) ? data.reviews.filter((v) => v.requestId === requestId).map((v) => <Text key={v.id} style={styles.body}>{v.rating}/5 · {v.text}</Text>) : <>
        <View style={styles.row}>{[1, 2, 3, 4, 5].map((value) => <Action key={value} label={`${value}/5`} primary={rating === value} onPress={() => setRating(value)} />)}</View>
        <TextInput accessibilityLabel={t('Review', 'Reseña')} multiline maxLength={2000} style={styles.input} value={review} onChangeText={setReview} />
        <Action label={t('Publish review', 'Publicar reseña')} disabled={busy || review.trim().length < 3} onPress={() => { void act(`${base}/reviews`, { rating, text: review.trim() }); }} />
      </>}
    </View>}
  </>;
}
