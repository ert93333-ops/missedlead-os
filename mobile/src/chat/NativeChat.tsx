/**
 * 모바일 인테이크 채팅 화면: 메시지/첨부/평가 패널/확정 플로우를 useIntake 훅에 연결.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { AssessmentPanel } from './AssessmentPanel';
import { copy } from './copy';
import { confirmAction } from './confirmAction';
import { useIntake } from './useIntake';
import { Action, Check, IconAction, MotionView, palette, styles } from './ui';

export function NativeChat({ accessToken, onSignOut, preferredLocale, onLocaleChange }: { readonly accessToken: string; readonly onSignOut: () => void; readonly preferredLocale?: "en"|"es"; readonly onLocaleChange?: (locale:"en"|"es")=>void }) {
  const intake = useIntake(accessToken);
  useEffect(()=>{if(preferredLocale)intake.setLocale(preferredLocale);},[preferredLocale]);
  const text = copy[intake.locale];
  const scroll = useRef<ScrollView>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const isBlocked = intake.assessment?.safety.level === 'emergency';
  const reset = () => {
    if (!intake.messages.length || intake.uploadComplete) return intake.reset();
    confirmAction(text.newRequest, intake.locale === 'en' ? 'Start over? This unfinished conversation and its attachments will be removed from this screen.' : '¿Empezar de nuevo? Se quitarán esta conversación sin terminar y sus archivos.', intake.locale === 'en' ? 'Keep conversation' : 'Conservar conversación', text.newRequest, intake.reset);
  };
  const signOut = () => {
    if (!intake.messages.length || intake.uploadComplete) { intake.reset(); onSignOut(); return; }
    confirmAction(text.signOut, intake.locale === 'en' ? 'Your unfinished conversation and local attachments will be cleared.' : 'Se borrarán la conversación sin terminar y los archivos locales.', intake.locale === 'en' ? 'Stay here' : 'Seguir aquí', text.signOut, () => { intake.reset(); onSignOut(); });
  };
  return <View style={styles.safe}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.chatHeader}>
        <View style={styles.headerMain}>
          <IconAction label={text.newRequest} glyph="‹" disabled={intake.busy} onPress={reset} />
          <View style={styles.headerIdentity}>
            <View style={styles.avatar} accessibilityElementsHidden><Text style={styles.avatarText}>W</Text></View>
            <View style={styles.headerDetails}>
              <Text style={styles.headerTitle}>WeCover AI</Text>
              <Text style={styles.online}>{intake.locale === 'en' ? 'Online' : 'En línea'}</Text>
            </View>
          </View>
          <IconAction label={intake.locale === 'en' ? 'More options' : 'Más opciones'} glyph="•••" disabled={intake.busy} onPress={() => setMenuOpen(open => !open)} />
        </View>
        {menuOpen ? <MotionView style={styles.secondaryMenu}>
          <Check label={text.translationSetting} checked={intake.translationsEnabled} disabled={intake.busy || Boolean(intake.confirmation)} onPress={() => { void intake.enableTranslations(!intake.translationsEnabled); }} />
          <Action label={intake.locale === 'en' ? 'Español' : 'English'} disabled={intake.busy} onPress={() => {const next=intake.locale === 'en' ? 'es' : 'en';intake.setLocale(next);onLocaleChange?.(next);}} />
          <Action label={text.newRequest} disabled={intake.busy} onPress={reset} />
          <Action label={text.signOut} disabled={intake.busy} onPress={signOut} />
        </MotionView> : null}
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {intake.saveFailed ? <Text style={styles.danger}>{intake.locale === 'en' ? 'This device could not save the conversation. Keep the app open to avoid losing your draft.' : 'No se pudo guardar la conversación en este dispositivo. Mantenga la aplicación abierta para conservar el borrador.'}</Text> : null}
        <View style={styles.chatBubble}><Text style={styles.body}>{text.greeting}</Text></View>
        {intake.messages.map((message, index) => <MotionView key={index} delay={Math.min(index * 25, 180)} style={[styles.chatBubble, message.role === 'user' && styles.chatUserBubble, message.role === 'assistant' && index === intake.messages.length - 1 && styles.latestAssistantBubble]}>
          <Text selectable style={styles.body}>{message.content}</Text>
          {intake.translationsEnabled && intake.translations[index] ? <View style={styles.separator}>
            <Text selectable style={styles.body}>{intake.translations[index]?.translated}</Text>
            <Text style={styles.muted}>{text.translationWarning}</Text>
          </View> : null}
        </MotionView>)}
        {!intake.confirmation ? <AssessmentPanel intake={intake} /> : <View style={styles.section} accessibilityLiveRegion="polite">
          <Text style={styles.heading}>{text.saved}</Text>
          <Text selectable style={styles.muted}>{intake.confirmation.requestId}</Text>
          <Text style={styles.body}>{intake.confirmation.matchCount > 0 ? `${intake.confirmation.matchCount} ${text.matched}` : text.noMatches}</Text>
          {!intake.uploadComplete ? <View style={styles.warning}><Text style={styles.body}>{text.pendingUpload}</Text><Action label={text.retryUpload} disabled={intake.busy || intake.requiresReattach || (intake.files.length > 0 && !intake.consent)} onPress={() => { void intake.confirm(); }} /></View> : null}
          <Text style={styles.muted}>{text.noPayment}</Text>
        </View>}
        {intake.files.length > 0 ? <View style={styles.section}>
          {intake.assessment && !intake.confirmation ? <Text style={styles.muted}>{intake.locale === 'en' ? 'Files already included in this conversation stay with the request. Start a new request to remove or replace them.' : 'Los archivos incluidos en esta conversación se conservan. Inicie otra solicitud para quitarlos o reemplazarlos.'}</Text> : null}
          {intake.requiresReattach ? <View style={styles.warning}>
            <Text style={styles.body}>{text.media_reattach}</Text>
            <Action label={text.library} disabled={intake.busy} onPress={() => { void intake.addMedia('library'); }} />
            <Action label={text.audio} disabled={intake.busy} onPress={() => { void intake.addMedia('audio'); }} />
          </View> : null}
          {intake.files.map(file => <View key={file.uri} style={styles.section}>
            {!intake.requiresReattach && file.mimeType.startsWith('image/') ? <Image source={{ uri: file.uri }} style={styles.image} accessibilityLabel={file.name} /> : null}
            <Text style={styles.muted}>{file.name} · {(file.size / 1_000_000).toFixed(1)} MB</Text>
            {!intake.confirmation ? <Action label={`${text.remove} ${file.name}`} disabled={intake.busy || Boolean(intake.assessment)} onPress={() => intake.removeMedia(file.uri)} /> : null}
          </View>)}
          {!intake.uploadComplete ? <><Text style={styles.muted}>{text.privacy}</Text><Check label={text.consent} checked={intake.consent} disabled={intake.busy || intake.requiresReattach} onPress={() => intake.setConsent(!intake.consent)} /></> : null}
        </View> : null}
        {intake.translationsDirty && !intake.confirmation ? <Action label={text.saveTranslation} disabled={intake.busy || intake.requiresReattach || isBlocked || (intake.files.length > 0 && !intake.consent)} onPress={() => { void intake.analyze(''); }} /> : null}
        {intake.busy ? <View style={styles.row} accessibilityLiveRegion="polite"><ActivityIndicator color={palette.primary} /><Text style={styles.muted}>{text.thinking}</Text></View> : null}
        {intake.error ? <View style={styles.warning} accessibilityLiveRegion="assertive"><Text style={styles.danger}>{intake.error}</Text>{intake.retry ? <Action label={text.retry} disabled={intake.busy} onPress={() => { void intake.retry?.(); }} /> : null}</View> : null}
      </ScrollView>
      {!intake.confirmation && !isBlocked ? <View style={styles.chatComposer}>
        {attachmentsOpen ? <View style={styles.attachmentTray}>
          <Action label={text.camera} disabled={intake.busy} onPress={() => { void intake.addMedia('camera'); }} />
          <Action label={text.video} disabled={intake.busy} onPress={() => { void intake.addMedia('video'); }} />
          <Action label={text.library} disabled={intake.busy} onPress={() => { void intake.addMedia('library'); }} />
          <Action label={text.audio} disabled={intake.busy} onPress={() => { void intake.addMedia('audio'); }} />
          <Text style={styles.muted}>{text.limits}</Text>
        </View> : null}
        <View style={styles.composerRow}>
          <IconAction label={attachmentsOpen ? (intake.locale === 'en' ? 'Close attachments' : 'Cerrar archivos adjuntos') : (intake.locale === 'en' ? 'Add attachment' : 'Agregar archivo adjunto')} glyph={attachmentsOpen ? '×' : '＋'} disabled={intake.busy} onPress={() => setAttachmentsOpen(open => !open)} />
          <TextInput accessibilityLabel={text.placeholder} placeholder={text.placeholder} placeholderTextColor={palette.muted} value={intake.draft} onChangeText={intake.setDraft} maxLength={2000} multiline editable={!intake.busy} style={[styles.input, styles.chatMessageInput]} onFocus={() => scroll.current?.scrollToEnd({ animated: false })} />
          <IconAction label={text.send} glyph="↑" primary disabled={intake.busy || intake.requiresReattach || (!intake.draft.trim() && !intake.files.length) || (intake.files.length > 0 && !intake.consent)} onPress={() => { void intake.analyze().then(() => scroll.current?.scrollToEnd({ animated: false })); }} />
        </View>
      </View> : null}
    </KeyboardAvoidingView>
  </View>;
}
