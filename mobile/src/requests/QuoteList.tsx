import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Action, styles } from '../chat/ui';
import { filterQuotes, money } from './contracts';
import type { Locale, Quote } from './contracts';

export function QuoteList({ quotes, locale, busy, onSelect }: { readonly quotes: readonly Quote[]; readonly locale: Locale; readonly busy: boolean; readonly onSelect: (quote: Quote) => void }) {
  const [language, setLanguage] = useState('');
  const [before, setBefore] = useState('');
  const t = (en: string, es: string) => locale === 'es' ? es : en;
  const visible = filterQuotes(quotes, language, before);
  return <View style={styles.section}>
    <Text style={styles.heading}>{t('Compare professionals', 'Comparar profesionales')}</Text>
    <Text style={styles.muted}>{t('Recommended order considers quality, availability and protection, alongside price.', 'El orden recomendado considera calidad, disponibilidad y protección, además del precio.')}</Text>
    <View style={styles.row}>{[['', t('All languages', 'Todos los idiomas')], ['en', 'English'], ['es', 'Español']].map(([value, label]) => <Action key={value} label={label ?? ''} primary={language === value} onPress={() => setLanguage(value ?? '')} />)}</View>
    <Text style={styles.body}>{t('Available by (YYYY-MM-DD, optional)', 'Disponible antes de (AAAA-MM-DD, opcional)')}</Text>
    <TextInput accessibilityLabel={t('Available by date', 'Fecha límite')} style={styles.input} value={before} onChangeText={setBefore} placeholder="2026-09-30" autoCapitalize="none" />
    {!visible.length && <Text style={styles.muted}>{t('No quotes match these filters yet.', 'Aún no hay presupuestos que coincidan.')}</Text>}
    {visible.map((q) => <View key={q.id} style={styles.separator}>
      <Text style={styles.heading}>{q.providerName} · {money(q.amountCents, locale)}</Text>
      <Text style={styles.body}>{q.scope}</Text>
      <Text style={styles.muted}>{new Date(q.ranking.earliestStartAt).toLocaleString(locale)} · {q.ranking.warrantyDays} {t('warranty days', 'días de garantía')}</Text>
      <Text style={styles.muted}>{t('Rating', 'Valoración')}: {q.ranking.rating || t('No reviews yet', 'Sin reseñas')} · {q.ranking.languages?.join(', ') || t('Language not specified', 'Idioma sin especificar')}</Text>
      <Text style={styles.muted}>{t('License', 'Licencia')}: {q.ranking.licenseVerified ? t('Verified', 'Verificada') : t('Not verified', 'Sin verificar')} · {t('Insurance', 'Seguro')}: {q.ranking.insuranceVerified ? t('Verified', 'Verificado') : t('Not verified', 'Sin verificar')}</Text>
      <Action label={t('Choose and pay deposit', 'Elegir y pagar depósito')} disabled={busy} onPress={() => onSelect(q)} />
    </View>)}
  </View>;
}
