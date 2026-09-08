import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

export const palette = { background: '#F6F4EE', surface: '#FFFFFF', text: '#193A31', muted: '#53665E', border: '#D5DDD6', primary: '#174B3B', accent: '#16855B', warning: '#FFF1D6', danger: '#9B2D26' } as const;

function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (value: number) => {
    Animated.spring(scale, { toValue: value, damping: 18, stiffness: 320, mass: 0.55, useNativeDriver: true }).start();
  };
  return { scale, pressIn: () => animate(0.97), pressOut: () => animate(1) };
}

export function MotionView({ children, delay = 0, style }: { readonly children: ReactNode; readonly delay?: number; readonly style?: ViewStyle | ViewStyle[] }) {
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

export function Action({ label, onPress, disabled = false, primary = false }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean; readonly primary?: boolean }) {
  const motion = usePressScale();
  return <Animated.View style={{ transform: [{ scale: motion.scale }] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onPressIn={motion.pressIn} onPressOut={motion.pressOut} style={({ pressed }) => [styles.action, primary && styles.primary, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={[styles.actionText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  </Animated.View>;
}

export function Check({ label, checked, onPress, disabled = false }: { readonly label: string; readonly checked: boolean; readonly onPress: () => void; readonly disabled?: boolean }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={styles.checkRow}>
    <View style={[styles.checkbox, checked && styles.primary]}><Text style={styles.primaryText}>{checked ? '✓' : ''}</Text></View>
    <Text style={[styles.body, styles.grow]}>{label}</Text>
  </Pressable>;
}

export function IconAction({ label, glyph, onPress, disabled = false, primary = false }: { readonly label: string; readonly glyph: string; readonly onPress: () => void; readonly disabled?: boolean; readonly primary?: boolean }) {
  const motion = usePressScale();
  return <Animated.View style={{ transform: [{ scale: motion.scale }] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onPressIn={motion.pressIn} onPressOut={motion.pressOut} style={({ pressed }) => [styles.iconAction, primary && styles.accentPrimary, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={[styles.iconText, primary && styles.primaryText]}>{glyph}</Text>
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

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, flex: { flex: 1 }, grow: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border, gap: 4 },
  chatHeader: { paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface, gap: 8 },
  headerMain: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDetails: { flex: 1 },
  headerTitle: { color: palette.text, fontSize: 16, lineHeight: 20, fontWeight: '700' },
  online: { color: palette.muted, fontSize: 12, lineHeight: 16 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#151714', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  secondaryMenu: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap', paddingTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  brand: { fontSize: 24, fontWeight: '700', color: palette.primary, flex: 1 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600', color: palette.text },
  heading: { fontSize: 18, lineHeight: 25, fontWeight: '600', color: palette.text },
  body: { color: palette.text, fontSize: 16, lineHeight: 24 },
  muted: { color: palette.muted, fontSize: 14, lineHeight: 21 },
  content: { padding: 20, gap: 16, paddingBottom: 32 },
  chatContent: { paddingHorizontal: 14, paddingTop: 16, gap: 10, paddingBottom: 24 },
  bubble: { padding: 16, gap: 8, backgroundColor: palette.surface, borderRadius: 16, maxWidth: '96%', alignSelf: 'flex-start' },
  chatBubble: { paddingHorizontal: 13, paddingVertical: 10, gap: 7, backgroundColor: palette.surface, borderRadius: 10, borderWidth: 1, borderColor: '#ECEAE3', maxWidth: '84%', alignSelf: 'flex-start' },
  userBubble: { backgroundColor: '#DCEAE0', alignSelf: 'flex-end' },
  chatUserBubble: { backgroundColor: '#EEEDE8', borderColor: '#E2E0D8', alignSelf: 'flex-end' },
  latestAssistantBubble: { paddingVertical: 13, borderColor: '#D5D8D1', shadowColor: '#000000', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  questionSection: { gap: 12, paddingVertical: 4 },
  questionBubble: { paddingHorizontal: 14, paddingVertical: 13, gap: 5, backgroundColor: palette.surface, borderRadius: 10, borderWidth: 1, borderColor: '#D5D8D1', maxWidth: '88%', alignSelf: 'flex-start' },
  quickReplies: { gap: 9, paddingTop: 2 },
  section: { gap: 12, paddingVertical: 10 },
  separator: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 16 },
  warning: { padding: 16, backgroundColor: palette.warning, borderRadius: 12, gap: 8 },
  danger: { color: palette.danger, fontSize: 16, lineHeight: 24 },
  action: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 11, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface },
  actionText: { fontSize: 15, fontWeight: '600', color: palette.primary, textAlign: 'center', flexShrink: 1 },
  primary: { backgroundColor: palette.primary, borderColor: palette.primary }, accentPrimary: { backgroundColor: palette.accent, borderColor: palette.accent }, primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.7 },
  iconAction: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  iconText: { color: palette.text, fontSize: 21, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
  quickReply: { minHeight: 54, paddingHorizontal: 18, paddingVertical: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: palette.accent, borderRadius: 9, backgroundColor: palette.surface },
  quickReplyText: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  quickReplyPressed: { backgroundColor: '#E8F3ED' },
  checkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  checkbox: { width: 26, height: 26, borderWidth: 1, borderColor: palette.muted, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 50, borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, color: palette.text, backgroundColor: palette.surface, fontSize: 16 },
  composer: { borderTopWidth: 1, borderTopColor: palette.border, padding: 12, gap: 8, backgroundColor: palette.background },
  chatComposer: { borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: 12, paddingVertical: 9, gap: 8, backgroundColor: palette.surface },
  attachmentTray: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 4 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  messageInput: { minHeight: 48, maxHeight: 130, flex: 1, textAlignVertical: 'top' },
  chatMessageInput: { minHeight: 42, maxHeight: 110, flex: 1, textAlignVertical: 'top', borderRadius: 21, paddingHorizontal: 16, paddingVertical: 10 },
  image: { width: 112, height: 84, borderRadius: 8 },
});
