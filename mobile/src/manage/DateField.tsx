/**
 * 네이티브 날짜/시간 선택 필드(DateTimePicker 래핑).
 */
import { useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Text, View } from 'react-native';
import { Action, styles } from '../chat/ui';
import { Field } from './shared';
import { parseDateInput } from './formValues';
import { words } from './state';
export function DateField({ label, value, onChange, locale, time = false }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly locale: 'en' | 'es'; readonly time?: boolean }) {
  const [mode, setMode] = useState<'date' | 'time'>();
  const [initial] = useState(() => new Date(Date.now() + 86_400_000));
  const t = (en: string, es: string) => words(locale, en, es);
  if (Platform.OS === 'web') return <Field label={`${label} (${time ? 'YYYY-MM-DD HH:mm UTC' : 'YYYY-MM-DD'})`} value={value} onChange={onChange} />;
  const selected = value ? new Date(parseDateInput(value, time)) : initial;
  return <View style={styles.section}><Text style={styles.body}>{label}</Text><Text style={styles.muted}>{value ? time ? selected.toLocaleString(locale) : value : t('No date chosen', 'No se eligió fecha')}</Text><Action label={t('Choose date', 'Elegir fecha')} onPress={() => setMode('date')} />{time && <Action label={t('Choose time', 'Elegir hora')} onPress={() => setMode('time')} />}{mode && <DateTimePicker value={selected} mode={mode} minimumDate={mode === 'date' ? new Date() : undefined} display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, date) => { if (Platform.OS !== 'ios') setMode(undefined); if (event.type !== 'dismissed' && date) onChange(time ? date.toISOString().slice(0, 16).replace('T', ' ') : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`); }} />}{mode && Platform.OS === 'ios' && <Action label={t('Use this date', 'Usar esta fecha')} onPress={() => { if (!value) onChange(time ? selected.toISOString().slice(0, 16).replace('T', ' ') : `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`); setMode(undefined); }} />}</View>;
}
