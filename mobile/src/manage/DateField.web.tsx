import { useId } from 'react';
import { Text, View } from 'react-native';
import { palette, styles } from '../chat/ui';
import { parseDateInput } from './formValues';
import { words } from './state';
const localDateTime = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
export function DateField({ label, value, onChange, locale, time = false }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly locale: 'en' | 'es'; readonly time?: boolean }) {
  const id = useId();
  const input = time && value ? localDateTime(new Date(parseDateInput(value, true))) : value;
  return <View style={styles.section}>
    <label htmlFor={id} style={{ color: palette.text, fontSize: 16 }}>{label}</label>
    <input id={id} lang={locale} type={time ? 'datetime-local' : 'date'} value={input} onChange={event => {
      const next = event.target.value;
      if (!next) { onChange(''); return; }
      if (!time) { onChange(next); return; }
      const date = new Date(next);
      if (Number.isFinite(date.getTime())) onChange(date.toISOString().slice(0, 16).replace('T', ' '));
    }} style={{ minHeight: 48, borderRadius: 12, border: `1px solid ${palette.border}`, padding: 12, fontSize: 16, color: palette.text, background: palette.surface, width: '100%', boxSizing: 'border-box' }} />
    {time && <Text style={styles.muted}>{words(locale, 'Shown in your device timezone.', 'Se muestra en la zona horaria de tu dispositivo.')}</Text>}
  </View>;
}
