import { useState } from 'react';
import { Text, View } from 'react-native';
import { Action, palette, styles } from '../chat/ui';
import type { Locale } from './contracts';

const localInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
export function VisitPicker({ locale, busy, onPropose }: { readonly locale: Locale; readonly busy: boolean; readonly onPropose: (date: Date) => void }) {
  const [value, setValue] = useState(() => localInput(new Date(Date.now() + 86400000)));
  const date = new Date(value);
  const valid = Number.isFinite(date.getTime()) && date.getTime() > Date.now();
  return <View style={styles.section}>
    <label htmlFor="visit-date" style={{ color: palette.text, fontSize: 16 }}>{locale === 'es' ? 'Día y hora de la visita' : 'Visit date and time'}</label>
    <input id="visit-date" type="datetime-local" lang={locale} value={value} min={localInput(new Date())} disabled={busy} onChange={(event) => setValue(event.target.value)} style={{ minHeight: 48, borderRadius: 12, border: `1px solid ${palette.border}`, padding: 12, fontSize: 16, color: palette.text, background: palette.surface, width: '100%', boxSizing: 'border-box' }} />
    <Text style={styles.muted}>{locale === 'es' ? 'Se muestra en la zona horaria de tu dispositivo.' : 'Shown in your device timezone.'}</Text>
    <Action label={locale === 'es' ? 'Proponer visita' : 'Propose visit'} disabled={busy || !valid} onPress={() => onPropose(date)} />
  </View>;
}
