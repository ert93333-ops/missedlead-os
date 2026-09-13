import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { activeRoleName, activeTokens, font, skin, type SkinRole, type SkinTokens } from '../theme';
export type IconName = 'chevron-back' | 'ellipsis-horizontal' | 'add' | 'close' | 'arrow-up' | 'chatbubble-ellipses-outline' | 'list-outline' | 'briefcase-outline' | 'person-circle-outline' | 'language-outline' | 'water-outline' | 'thermometer-outline' | 'flash-outline' | 'home-outline' | 'warning-outline' | 'construct-outline' | 'cube-outline' | 'shield-check-outline';

const buildStyles = (t: SkinTokens) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, flex: { flex: 1 }, grow: { flex: 1 },
  header: { paddingHorizontal: t.pad, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line, gap: 4 },
  chatHeader: { paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: t.surface, gap: 8 },
  headerMain: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDetails: { flex: 1 },
  headerTitle: { color: t.text, fontSize: 17, lineHeight: 20, fontFamily: font.displaySemi },
  online: { color: t.muted, fontSize: 11, lineHeight: 15, fontFamily: font.mono, letterSpacing: 0.8, textTransform: 'uppercase' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: t.onAccent, fontSize: 18, fontFamily: font.display },
  secondaryMenu: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap', paddingTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  brand: { fontSize: 24, color: t.text, flex: 1, fontFamily: font.display, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 24, lineHeight: 26, color: t.text, fontFamily: font.display, letterSpacing: 0.4 },
  sectionKicker: { color: t.accent, fontSize: 11, lineHeight: 15, fontFamily: font.monoMed, letterSpacing: 1.4, textTransform: 'uppercase' },
  heading: { fontSize: 20, lineHeight: 24, color: t.text, fontFamily: font.displaySemi, letterSpacing: 0.3 },
  body: { color: t.text, fontSize: 16, lineHeight: 24, fontFamily: font.body },
  muted: { color: t.muted, fontSize: 14, lineHeight: 21, fontFamily: font.body },
  content: { padding: t.pad, gap: 16, paddingBottom: 32 },
  chatContent: { paddingHorizontal: 14, paddingTop: 16, gap: 10, paddingBottom: 24 },
  bubble: { padding: 16, gap: 8, backgroundColor: t.surface, borderRadius: t.radius, maxWidth: '96%', alignSelf: 'flex-start' },
  chatBubble: { paddingHorizontal: 13, paddingVertical: 10, gap: 7, backgroundColor: t.surface, borderRadius: t.radiusSm, borderWidth: 1, borderColor: t.line, maxWidth: '84%', alignSelf: 'flex-start' },
  userBubble: { backgroundColor: t.accentSoft, alignSelf: 'flex-end' },
  chatUserBubble: { backgroundColor: t.accentSoft, borderColor: t.line, alignSelf: 'flex-end' },
  latestAssistantBubble: { paddingVertical: 13, borderColor: t.line, shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  questionSection: { gap: 12, paddingVertical: 4 },
  questionBubble: { paddingHorizontal: 18, paddingVertical: 17, gap: 7, backgroundColor: t.surface, borderRadius: t.radius + 2, borderWidth: 1, borderColor: t.line, maxWidth: '96%', alignSelf: 'flex-start', shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  section: { gap: 12, paddingVertical: 10 },
  resultCard: { gap: 12, marginTop: 8, padding: 16, backgroundColor: t.surface, borderRadius: t.radius, borderWidth: 1, borderColor: t.line },
  issueHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  issueIconTile: { width: 36, height: 36, borderRadius: t.radiusSm + 2, backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' },
  estimateCard: { gap: 10, marginTop: 4, padding: 16, backgroundColor: t.okSoft, borderRadius: t.radius, borderWidth: 1, borderColor: t.ok },
  separator: { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 16 },
  warning: { padding: 16, backgroundColor: t.warnSoft, borderRadius: t.radiusSm, gap: 8 },
  danger: { color: t.danger, fontSize: 16, lineHeight: 24, fontFamily: font.body },
  action: { minHeight: t.controlMin, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: t.line, borderRadius: t.radiusSm, backgroundColor: t.surface },
  actionText: { fontSize: t.actionFont, fontWeight: t.actionWeight, fontFamily: font.bodySemi, color: t.accent, textAlign: 'center', flexShrink: 1 },
  primary: { backgroundColor: t.accent, borderColor: t.accent }, accentPrimary: { backgroundColor: t.accent, borderColor: t.accent }, primaryText: { color: t.onAccent, fontSize: 16, fontWeight: '600', fontFamily: font.bodySemi },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.7 },
  iconAction: { width: t.iconMin, height: t.iconMin, borderRadius: t.iconMin / 2, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: t.line, backgroundColor: t.surface },
  iconText: { color: t.text, fontSize: 21, lineHeight: 24, fontWeight: '600', fontFamily: font.bodySemi, textAlign: 'center' },
  quickReply: { minHeight: 54, paddingHorizontal: 18, paddingVertical: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: t.accent, borderRadius: t.radiusSm, backgroundColor: t.surface },
  quickReplyText: { color: t.text, fontSize: 16, lineHeight: 22, fontWeight: '600', fontFamily: font.bodySemi, textAlign: 'center' },
  quickReplyPressed: { backgroundColor: t.accentSoft },
  checkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  checkbox: { width: 26, height: 26, borderWidth: 1, borderColor: t.muted, borderRadius: t.radiusSm, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: t.inputMin, borderWidth: 1, borderColor: t.line, borderRadius: t.radiusSm, padding: 12, color: t.text, backgroundColor: t.surface, fontSize: 16, fontFamily: font.body },
  composer: { borderTopWidth: 1, borderTopColor: t.line, padding: 12, gap: 8, backgroundColor: t.background },
  chatComposer: { borderTopWidth: 1, borderTopColor: t.line, paddingHorizontal: 12, paddingVertical: 9, gap: 8, backgroundColor: t.surface },
  attachmentTray: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 4 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  messageInput: { minHeight: 48, maxHeight: 130, flex: 1, textAlignVertical: 'top' },
  chatMessageInput: { minHeight: 42, maxHeight: 110, flex: 1, textAlignVertical: 'top', borderRadius: t.radius, paddingHorizontal: 16, paddingVertical: 10 },
  image: { width: 112, height: 84, borderRadius: t.radiusSm },
  specStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: t.pad, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: t.background },
  specText: { color: t.muted, fontSize: 10, fontFamily: font.mono, letterSpacing: 1.1, textTransform: 'uppercase' },
  specRole: { color: t.accent, fontSize: 10, fontFamily: font.monoMed, letterSpacing: 1.1, textTransform: 'uppercase' },
  specDot: { width: 8, height: 8, backgroundColor: t.accent },
  tabBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', padding: 8, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.surface },
});

type StyleMap = ReturnType<typeof buildStyles>;
const styleCache: Partial<Record<SkinRole, StyleMap>> = {};
const stylesFor = (role: SkinRole): StyleMap => styleCache[role] ??= buildStyles(skin[role]);
const currentStyles = (): StyleMap => stylesFor(activeRoleName());

// Legacy key names kept so existing call sites resolve against the active role.
const paletteFor = (t: SkinTokens) => ({ background: t.background, surface: t.surface, text: t.text, muted: t.muted, border: t.line, primary: t.accent, accent: t.accentDeep, warning: t.warnSoft, danger: t.danger });

type LegacyPalette = ReturnType<typeof paletteFor>;
export const styles = new Proxy({} as StyleMap, { get: (_target, key) => currentStyles()[key as keyof StyleMap] });
export const palette = new Proxy({} as LegacyPalette, { get: (_target, key) => paletteFor(activeTokens())[key as keyof LegacyPalette] });

export function SpecStrip({ role, es, paymentsLive }: { readonly role: SkinRole; readonly es: boolean; readonly paymentsLive: boolean }) {
  const t = activeTokens();
  const roleTag = role === 'customer' ? (es ? 'Cliente' : 'Customer') : role === 'provider' ? (es ? 'Proveedor' : 'Provider') : (es ? 'Operador' : 'Operator');
  const dotRadius = role === 'provider' ? 4 : role === 'operator' ? 0 : 2;
  return <View style={styles.specStrip} accessibilityElementsHidden importantForAccessibility="no">
    <View style={[styles.specDot, { borderRadius: dotRadius, shadowColor: t.accent, shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } }]} />
    <Text style={styles.specRole}>{roleTag}</Text>
    <Text style={styles.specText}>WeCover · Charlotte pilot</Text>
    <View style={styles.grow} />
    <Text style={styles.specText}>{paymentsLive ? (es ? 'Pagos activos' : 'Payments live') : (es ? 'Pagos inactivos' : 'Payments off')}</Text>
  </View>;
}

export function AppIcon({ name, size = 22, color = palette.text }: { readonly name: IconName; readonly size?: number; readonly color?: string }) {
  const stroke = { stroke: color, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };
  const paths: Record<IconName, ReactNode> = {
    'chevron-back': <Path d="M14.5 5 7.5 12l7 7" {...stroke} />,
    'ellipsis-horizontal': <><Circle cx="5" cy="12" r="1.25" fill={color}/><Circle cx="12" cy="12" r="1.25" fill={color}/><Circle cx="19" cy="12" r="1.25" fill={color}/></>,
    add: <Path d="M12 5v14M5 12h14" {...stroke} />,
    close: <Path d="m6 6 12 12M18 6 6 18" {...stroke} />,
    'arrow-up': <Path d="M12 19V5M6 11l6-6 6 6" {...stroke} />,
    'chatbubble-ellipses-outline': <><Path d="M19 11.5a7 7 0 0 1-7 7 7.7 7.7 0 0 1-3.1-.65L5 19l1.15-3.25A7 7 0 1 1 19 11.5Z" {...stroke}/><Circle cx="9" cy="11.5" r="0.8" fill={color}/><Circle cx="12" cy="11.5" r="0.8" fill={color}/><Circle cx="15" cy="11.5" r="0.8" fill={color}/></>,
    'list-outline': <><Path d="M8 6h10M8 12h10M8 18h10" {...stroke}/><Circle cx="4.5" cy="6" r="0.8" fill={color}/><Circle cx="4.5" cy="12" r="0.8" fill={color}/><Circle cx="4.5" cy="18" r="0.8" fill={color}/></>,
    'briefcase-outline': <Path d="M4 8.5h16v10H4zM8 8.5V6h8v2.5M4 13h16M10 13v2h4v-2" {...stroke}/>,
    'person-circle-outline': <><Circle cx="12" cy="12" r="8.5" {...stroke}/><Circle cx="12" cy="9.5" r="2.4" {...stroke}/><Path d="M7.8 17.2a4.8 4.8 0 0 1 8.4 0" {...stroke}/></>,
    'language-outline': <><Circle cx="12" cy="12" r="8.5" {...stroke}/><Path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5Z" {...stroke}/></>,
    'water-outline': <><Path d="M12 3s6.5 6.6 6.5 11a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3Z" {...stroke}/><Path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5" {...stroke}/></>,
    'thermometer-outline': <><Path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4.5 4.5 0 1 1-4 0Z" {...stroke}/><Path d="M12 10v7" {...stroke}/><Circle cx="12" cy="18" r="1.2" fill={color}/></>,
    'flash-outline': <Path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2Z" {...stroke}/>,
    'home-outline': <><Path d="m3 11 9-8 9 8" {...stroke}/><Path d="M5.5 9.5V20h13V9.5" {...stroke}/><Path d="M10 20v-5h4v5" {...stroke}/></>,
    'warning-outline': <><Path d="M12 3.5 2.5 20h19L12 3.5Z" {...stroke}/><Path d="M12 10v4.5" {...stroke}/><Circle cx="12" cy="17.3" r="0.4" fill={color}/></>,
    'construct-outline': <Path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7Z" {...stroke}/>,
    'cube-outline': <><Path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" {...stroke}/><Path d="M4 7.5 12 12l8-4.5M12 12v9" {...stroke}/></>,
    'shield-check-outline': <><Path d="M12 3 5 5.8v5.4c0 4.4 2.9 7.4 7 9.3 4.1-1.9 7-4.9 7-9.3V5.8L12 3Z" {...stroke}/><Path d="m9 11.5 2.2 2.2L15.4 9.5" {...stroke}/></>,
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>{paths[name]}</Svg>;
}

function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (value: number) => {
    Animated.spring(scale, { toValue: value, damping: 18, stiffness: 320, mass: 0.55, useNativeDriver: true }).start();
  };
  return { scale, pressIn: () => animate(0.97), pressOut: () => animate(1) };
}

export function MotionView({ children, delay = 0, style }: { readonly children: ReactNode; readonly delay?: number; readonly style?: StyleProp<ViewStyle> }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active) return;
      if (reduced) progress.setValue(1);
      else Animated.timing(progress, { toValue: 1, duration: 240, delay, useNativeDriver: true }).start();
    });
    return () => { active = false; progress.stopAnimation(); };
  }, [delay, progress]);
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>{children}</Animated.View>;
}

export function Action({ label, onPress, disabled = false, primary = false, icon }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean; readonly primary?: boolean; readonly icon?: IconName }) {
  const motion = usePressScale();
  return <Animated.View style={{ transform: [{ scale: motion.scale }] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onPressIn={motion.pressIn} onPressOut={motion.pressOut} style={({ pressed }) => [styles.action, primary && styles.primary, disabled && styles.disabled, pressed && styles.pressed]}>
      {icon ? <AppIcon name={icon} size={17} color={primary ? activeTokens().onAccent : palette.primary} /> : null}
      <Text style={[styles.actionText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  </Animated.View>;
}

export function Check({ label, checked, onPress, disabled = false }: { readonly label: string; readonly checked: boolean; readonly onPress: () => void; readonly disabled?: boolean }) {
  return <View style={styles.checkRow}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.checkbox, checked && styles.primary, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.primaryText}>{checked ? '✓' : ''}</Text>
    </Pressable>
    <Text style={[styles.body, styles.grow]}>{label}</Text>
  </View>;
}

export function IconAction({ label, glyph, onPress, disabled = false, primary = false }: { readonly label: string; readonly glyph: string; readonly onPress: () => void; readonly disabled?: boolean; readonly primary?: boolean }) {
  const motion = usePressScale();
  const iconNames: Record<string, IconName> = { '‹': 'chevron-back', '•••': 'ellipsis-horizontal', '＋': 'add', '×': 'close', '↑': 'arrow-up' };
  const icon = iconNames[glyph];
  return <Animated.View style={{ transform: [{ scale: motion.scale }] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onPressIn={motion.pressIn} onPressOut={motion.pressOut} style={({ pressed }) => [styles.iconAction, primary && styles.accentPrimary, disabled && styles.disabled, pressed && styles.pressed]}>
      {icon ? <AppIcon name={icon} size={22} color={primary ? activeTokens().onAccent : palette.text} /> : <Text style={[styles.iconText, primary && styles.primaryText]}>{glyph}</Text>}
    </Pressable>
  </Animated.View>;
}

export function QuickReply({ label, onPress, disabled = false }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }) {
  const motion = usePressScale();
  return <Animated.View style={{ transform: [{ scale: motion.scale }] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onPressIn={motion.pressIn} onPressOut={motion.pressOut} style={({ pressed }) => [styles.quickReply, disabled && styles.disabled, pressed && styles.quickReplyPressed]}>
      <Text style={styles.quickReplyText}>{label}</Text>
    </Pressable>
  </Animated.View>;
}
