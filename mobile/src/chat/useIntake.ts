import { useEffect, useRef, useState } from 'react';
import { multipart, request } from './api';
import { analyzeAfterSafety, safetyPreflightSchema, conversationLimitReached, nextHistory, hasUnsentDetails, assessmentSchema, confirmationSchema, translationSchema, uploadSchema, ChatError, type Assessment, type Attachment, type Confirmation, type Locale, type Message, type Translation } from './protocol';
import { discardMedia, missingMedia, pickMedia } from './media';
import { errorCopy } from './copy';
import { accountIdFromAccessToken, clearDraft, draftFile, readDraft, writeDraft } from './draft';

export function useIntake(accessToken: string) {
  const [accountId] = useState(() => accountIdFromAccessToken(accessToken));
  const [storage] = useState(() => draftFile(accessToken));
  const [initial] = useState(() => readDraft(storage));
  const [locale, setLocale] = useState<Locale>(initial.locale);
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const [draft, setDraft] = useState(initial.draft);
  const [files, setFiles] = useState<Attachment[]>(initial.files);
  const [consent, setConsent] = useState(initial.consent);
  const [assessment, setAssessment] = useState<Assessment | null>(initial.assessment);
  const [translations, setTranslations] = useState<Record<number, Translation>>(initial.translations);
  const [translationsDirty, setTranslationsDirty] = useState(initial.translationsDirty);
  const [selected, setSelected] = useState<string[]>(initial.selected);
  const [skips, setSkips] = useState<string[]>(initial.skips);
  const [skipAck, setSkipAck] = useState(initial.skipAck);
  const [warningAck, setWarningAck] = useState(initial.warningAck);
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(initial.confirmation);
  const [uploadComplete, setUploadComplete] = useState(initial.uploadComplete);
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const requiresReattach = missingMedia(files);

  useEffect(() => {
    setSaveFailed(!writeDraft(storage, { locale, messages, draft, files, consent, assessment, translations, translationsDirty, selected, skips, skipAck, warningAck, name, address, confirmation, uploadComplete }));
  }, [storage, locale, messages, draft, files, consent, assessment, translations, translationsDirty, selected, skips, skipAck, warningAck, name, address, confirmation, uploadComplete]);

  async function perform(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); setRetry(null); }
    catch (caught) { setError(errorCopy(caught instanceof ChatError ? caught.message : 'error', locale)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function analyze(content = draft.trim(), skipIds: string[] = []) {
    if (confirmation || requiresReattach || assessment?.safety.level === 'emergency' || (files.length > 0 && !consent)) return;
    if (!content && !files.length && !skipIds.length && !translationsDirty) return;
    const next = nextHistory(messages, content, locale, files.length > 0 && !skipIds.length && !translationsDirty);
    if (conversationLimitReached(next)) { setError(errorCopy('conversation_limit', locale)); setRetry(null); return; }
    const action = async () => {
      const result = await analyzeAfterSafety(
        () => request('/api/intake/safety', accessToken, safetyPreflightSchema, { locale, history: next.map(({ role, content: value }) => ({ role, content: value })) }),
        () => request('/api/intake/analyze', accessToken, assessmentSchema, multipart({ payload: JSON.stringify({
        locale, history: next.map(({ role, content: value }) => ({ role, content: value })), previousAssessmentToken: assessment?.assessmentToken,
        mediaConsent: consent, skipped: skipIds.length ? { questionIds: skipIds, warningAcknowledged: skipAck } : undefined,
        translations: Object.values(translations),
      }) }, files)));
      setAssessment(result); setMessages([...next, { role: 'assistant', content: result.reply, locale: result.locale }]);
      if (content.trim()) setDraft(''); setSkips([]); setSkipAck(false); setWarningAck(false); setTranslationsDirty(false);
      setSelected(result.issueCandidates.filter(issue => issue.likelihood !== 'low').map(issue => issue.id));
    };
    setRetry(() => () => perform(action)); await perform(action);
  }

  async function translate(index: number) {
    const message = messages[index];
    if (!message || translations[index] || confirmation) return;
    await perform(async () => {
      const translated = await request('/api/intake/translate', accessToken, translationSchema, { text: message.content, sourceLocale: message.locale, targetLocale: message.locale === 'en' ? 'es' : 'en' });
      setTranslations(current => ({ ...current, [index]: translated })); setTranslationsDirty(true);
    });
  }

  async function confirm() {
    if (!assessment || (!confirmation && hasUnsentDetails(draft)) || requiresReattach || (files.length > 0 && !consent) || !assessment.readyToConfirm || !warningAck || !selected.length || translationsDirty || !name.trim() || address.trim().length < 3) return;
    await perform(async () => {
      const saved = confirmation ?? await request('/api/intake/confirm', accessToken, confirmationSchema, { assessmentToken: assessment.assessmentToken, acceptedIssueIds: selected, warningAcknowledged: warningAck, customerName: name.trim(), address: address.trim() });
      setConfirmation(saved);
      if (files.length) await request(`/api/requests/${saved.requestId}/intake-media`, accessToken, uploadSchema, multipart({ assessmentToken: assessment.assessmentToken }, files));
      setUploadComplete(true); discardMedia(files, accountId ?? undefined); setFiles([]);
    });
  }

  async function addMedia(source: 'camera' | 'video' | 'library' | 'audio') {
    if (confirmation && !requiresReattach) return;
    await perform(async () => {
      if (!accountId) throw new Error('The account identifier is invalid.');
      const next = await pickMedia(source, files, accountId);
      if (confirmation && (next.length !== files.length || next.some((item, index) => item.name !== files[index]?.name || item.size !== files[index]?.size || item.mimeType !== files[index]?.mimeType))) {
        discardMedia(next.filter(item => !files.some(prior => prior.uri === item.uri)), accountId);
        throw new ChatError('media', 'media_reattach');
      }
      if (next.length === files.length && next.every((item, index) => item.uri === files[index]?.uri)) return;
      setRetry(null); setFiles(next); setConsent(false);
      if (!confirmation) setAssessment(current => current ? { ...current, readyToConfirm: false } : null);
    });
  }
  function removeMedia(uri: string) {
    if (confirmation || busy || assessment) return;
    discardMedia(files.filter(file => file.uri === uri), accountId ?? undefined); setFiles(current => current.filter(file => file.uri !== uri));
    setRetry(null); setAssessment(current => current ? { ...current, readyToConfirm: false } : null);
  }
  function reset() {
    if (busy) return;
    clearDraft(storage); discardMedia(files, accountId ?? undefined); setFiles([]); setMessages([]); setDraft(''); setAssessment(null); setTranslations({}); setTranslationsDirty(false);
    setSelected([]); setSkips([]); setSkipAck(false); setWarningAck(false); setName(''); setAddress(''); setConfirmation(null); setUploadComplete(false); setError(''); setRetry(null); setConsent(false);
  }
  function toggleSkip(id: string) { setSkips(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); setSkipAck(false); }
  function toggleIssue(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  return { locale, setLocale, messages, draft, setDraft, files, consent, setConsent, assessment, translations, translationsDirty,
    selected, toggleIssue, skips, toggleSkip, skipAck, setSkipAck, warningAck, setWarningAck, name, setName, address, setAddress,
    busy, error, retry, saveFailed, requiresReattach, confirmation, uploadComplete, analyze, translate, confirm, addMedia, removeMedia, reset };
}
export type Intake = ReturnType<typeof useIntake>;
