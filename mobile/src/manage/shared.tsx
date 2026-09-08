import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Action, styles } from '../chat/ui';
import { words } from './state';
export type ManagementProps = { readonly accessToken: string; readonly locale: 'en' | 'es'; readonly role: 'customer' | 'provider' | 'operator'; readonly onBack: () => void };

export function Field({ label, value, onChange, numeric = false, multiline = false }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly numeric?: boolean; readonly multiline?: boolean }) {
  return <View style={{ gap: 6 }}><Text style={styles.body}>{label}</Text><TextInput accessibilityLabel={label} style={styles.input} value={value} onChangeText={onChange} keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} autoCapitalize="none" /></View>;
}
export function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) { return <View style={styles.section}><Text accessibilityRole="header" style={styles.heading}>{title}</Text>{children}</View>; }
export function Screen({ title, onBack, locale, children }: { readonly title: string; readonly onBack: () => void; readonly locale: 'en' | 'es'; readonly children: ReactNode }) {
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><Action label={words(locale, 'Back', 'Volver')} onPress={onBack} /><Text accessibilityRole="header" style={styles.title}>{title}</Text>{children}</ScrollView></KeyboardAvoidingView>;
}
