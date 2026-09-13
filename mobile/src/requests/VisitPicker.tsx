/**
 * 네이티브 방문 일시 제안 피커.
 */
import { useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Text, View } from 'react-native';
import { Action, styles } from '../chat/ui';
import type { Locale } from './contracts';

export function VisitPicker({ locale, busy, onPropose }: { readonly locale: Locale; readonly busy: boolean; readonly onPropose: (date: Date) => void }) {
  const [date, setDate] = useState(() => new Date(Date.now() + 86400000));
  const [mode, setMode] = useState<'date' | 'time'>();
  const t = (en: string, es: string) => locale === 'es' ? es : en;
  return <View style={styles.section}>
    <Text style={styles.body}>{date.toLocaleString(locale)}</Text>
    <Text style={styles.muted}>{t('Shown in your device timezone.', 'Se muestra en la zona horaria de tu dispositivo.')}</Text>
    <View style={styles.row}><Action label={t('Choose day', 'Elegir día')} onPress={() => setMode('date')} /><Action label={t('Choose time', 'Elegir hora')} onPress={() => setMode('time')} /></View>
    {mode && <DateTimePicker value={date} mode={mode} minimumDate={mode === 'date' ? new Date() : undefined} display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, next) => { if (Platform.OS !== 'ios') setMode(undefined); if (event.type !== 'dismissed' && next) setDate(next); }} />}
    {mode && Platform.OS === 'ios' && <Action label={t('Done', 'Listo')} onPress={() => setMode(undefined)} />}
    <Action label={t('Propose visit', 'Proponer visita')} disabled={busy || date.getTime() <= Date.now()} onPress={() => onPropose(date)} />
  </View>;
}
