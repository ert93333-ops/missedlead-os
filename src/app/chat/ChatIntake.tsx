/**
 * 고객 접수 채팅 UI의 핵심. 메시지 송수신, 미디어 첨부, AI 후보 이슈 카드,
 * 안전 질문 게이팅, 가안 범위 확인 폼, EN/ES 번역을 처리한다.
 * localStorage에 진행 상태를 저장해 새로고침 후에도 복원한다.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CloseIcon, PaperclipIcon, PhotoIcon, SendIcon } from "./ChatIcons";
import { BoltIcon, CameraIcon, DrainIcon, DropletIcon, FanIcon, HelpIcon, ThermometerIcon, WarningIcon, type IconComponent } from "../icons";

import { issueIcon } from "../issueIcon";
import type { IntakeAssessment, IntakeLocale, IntakeMessage } from "./types";

type DisplayMessage = IntakeMessage & { locale: IntakeLocale; echo?: boolean; quoted?: string; note?: boolean };
type Translation = { original: string; translated: string; sourceLocale: IntakeLocale; targetLocale: IntakeLocale; warning: string; translationToken: string };
type PendingMediaRequest = { requestId: string; assessmentToken: string };
type SymptomId = "leak" | "drain" | "ac" | "hotwater" | "power" | "other";

const symptomIcons: Record<SymptomId, IconComponent> = { leak: DropletIcon, drain: DrainIcon, ac: FanIcon, hotwater: ThermometerIcon, power: BoltIcon, other: HelpIcon };
const fileAccept = "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/webm,audio/mp4,audio/wav,audio/x-wav";
type StoredIntake = { messages: DisplayMessage[]; draft: string; assessment: IntakeAssessment | null; selectedIssueIds: string[]; skipQuestionIds: string[]; skipAcknowledged: boolean; uncertaintyAcknowledged: boolean; translations: Record<number, Translation>; translationsDirty: boolean; hadMedia: boolean; pendingMediaRequest: PendingMediaRequest | null };

type ChatIntakeProps = {
  accessToken: string;
  onCreated: (requestId: string) => Promise<void> | void;
  onLocaleChange?: (locale: IntakeLocale) => void;
  initialLocale?: IntakeLocale;
};

type Copy = {
  title: string;
  subtitle: string;
  greeting: string;
  placeholder: string;
  composerLabel: string;
  attach: string;
  send: string;
  skip: string;
  skipWarning: string;
  skipAcknowledge: string;
  skipContinue: string;
  retry: string;
  possibleIssues: string;
  tentative: string;
  evidence: string;
  safetyRequired: string;
  confirmTitle: string;
  confirmHelp: string;
  name: string;
  address: string;
  uncertainty: string;
  confirm: string;
  confirming: string;
  payment: string;
  fileLimits: string;
  mediaConsent: string;
  mediaPrivacy: string;
  translate: string;
  translating: string;
  saveTranslation: string;
  reattach: string;
  remove: string;
  heroTitle: string;
  heroSub: string;
  photoCta: string;
  tilesLabel: string;
  tiles: { id: SymptomId; label: string; message: string }[];
  questionStep: string;
  moreIssues: string;
  fewerIssues: string;
  safetyUrgent: string;
  answerPlaceholder: string;
  skipUndo: string;
  skipNote: string;
  likelihood: Record<"high" | "medium" | "low", string>;
};

const copy: Record<IntakeLocale, Copy> = {
  en: {
    title: "Tell us what happened",
    subtitle: "We’ll ask a few useful questions, then prepare a repair request for local pros.",
    greeting: "Hi, I’m the WeCover repair assistant. What’s happening in your home? Share what you see, hear, or smell. You can add photos, a short video, or a voice note too.",
    placeholder: "What happened?",
    composerLabel: "Describe the problem or answer the question",
    attach: "Add photos, video, or audio",
    send: "Send",
    skip: "I’m not sure — skip",
    skipWarning: "You can skip this question, but missing details may change which pros match and the quote they provide.",
    skipAcknowledge: "I understand the quote may change.",
    skipContinue: "Skip and continue",
    retry: "Try again",
    possibleIssues: "What it might be",
    tentative: "These are possible issues based on what you shared. A technician must inspect the problem before confirming the cause.",
    evidence: "Helpful next photo or detail",
    safetyRequired: "This answer is needed for safety and can’t be skipped.",
    confirmTitle: "Review your repair request",
    confirmHelp: "Choose the possible issues that best match what you’re seeing. You can edit your name and service address before we look for technicians.",
    name: "Your name",
    address: "Service address",
    uncertainty: "I understand this is a provisional scope, not a confirmed diagnosis, and the final quote may change after inspection.",
    confirm: "Confirm and find technicians",
    confirming: "Looking for technicians…",
    payment: "No payment is collected during this consultation.",
    fileLimits: "Up to 10 photos, videos, or audio files. 25 MB each, 50 MB total.",
    mediaConsent: "I agree to secure AI processing of these files for this repair request.",
    mediaPrivacy: "Before sending, remove faces, mail, IDs, or other private details that are not needed to show the problem.",
    translate: "Show Spanish translation",
    translating: "Translating…",
    saveTranslation: "Save translation and continue",
    reattach: "For your privacy, attached files were not saved in this browser. Add them again before continuing.",
    remove: "Remove",
    heroTitle: "Snap a photo — we’ll take it from there.",
    heroSub: "AI-assisted intake plus licensed, insured local pros — serving Charlotte.",
    photoCta: "Take or upload a photo",
    tilesLabel: "Sound familiar? Tap one",
    tiles: [
      { id: "leak", label: "Water leak", message: "I found water leaking or pooling where it shouldn’t be." },
      { id: "drain", label: "Clogged drain", message: "Water drains slowly or won’t drain at all." },
      { id: "ac", label: "AC not cooling", message: "The AC is running but the house isn’t cooling down." },
      { id: "hotwater", label: "No hot water", message: "No hot water — the water heater may be acting up." },
      { id: "power", label: "No power", message: "An outlet or breaker stopped working." },
      { id: "other", label: "Something else", message: "I have a different home repair issue." },
    ],
    questionStep: "Question {current} of {total}",
    moreIssues: "Show more possibilities",
    fewerIssues: "Show fewer",
    safetyUrgent: "Important safety note — tap to read",
    answerPlaceholder: "Type your answer…",
    skipUndo: "Undo skip",
    skipNote: "Skipped question:",
    likelihood: { high: "high", medium: "medium", low: "low" },
  },
  es: {
    title: "Cuéntenos qué pasó",
    subtitle: "Le haremos algunas preguntas y prepararemos una solicitud para profesionales locales.",
    greeting: "Hola, soy el asistente de reparaciones de WeCover. ¿Qué está pasando en su hogar? Cuéntenos qué ve, oye o huele. También puede adjuntar fotos, un video corto o una nota de voz.",
    placeholder: "¿Qué pasó?",
    composerLabel: "Describa el problema o responda la pregunta",
    attach: "Agregar fotos, video o audio",
    send: "Enviar",
    skip: "No estoy seguro — omitir",
    skipWarning: "Puede omitir esta pregunta, pero la información faltante puede cambiar los profesionales disponibles y el presupuesto.",
    skipAcknowledge: "Entiendo que el presupuesto puede cambiar.",
    skipContinue: "Omitir y continuar",
    retry: "Intentar de nuevo",
    possibleIssues: "Qué podría ser",
    tentative: "Estas son posibilidades según lo que compartió. Un técnico debe inspeccionar el problema para confirmar la causa.",
    evidence: "Próxima foto o dato útil",
    safetyRequired: "Esta respuesta es necesaria por seguridad y no se puede omitir.",
    confirmTitle: "Revise su solicitud",
    confirmHelp: "Elija los posibles problemas que coincidan con lo que ve. Puede editar su nombre y dirección antes de buscar técnicos.",
    name: "Su nombre",
    address: "Dirección del servicio",
    uncertainty: "Entiendo que este alcance es provisional, no un diagnóstico confirmado, y que el presupuesto final puede cambiar después de la inspección.",
    confirm: "Confirmar y buscar técnicos",
    confirming: "Buscando técnicos…",
    payment: "No se cobra durante esta consulta.",
    fileLimits: "Hasta 10 fotos, videos o archivos de audio. 25 MB cada uno, 50 MB en total.",
    mediaConsent: "Acepto el procesamiento seguro con IA de estos archivos para esta solicitud de reparación.",
    mediaPrivacy: "Antes de enviar, quite rostros, correspondencia, identificaciones u otros datos privados que no sean necesarios para mostrar el problema.",
    translate: "Mostrar traducción al inglés",
    translating: "Traduciendo…",
    saveTranslation: "Guardar traducción y continuar",
    reattach: "Por su privacidad, los archivos adjuntos no se guardaron en este navegador. Agréguelos de nuevo antes de continuar.",
    remove: "Eliminar",
    heroTitle: "Tome una foto — nosotros nos encargamos.",
    heroSub: "Diagnóstico asistido por IA y técnicos locales con licencia y seguro — en Charlotte.",
    photoCta: "Tome o suba una foto",
    tilesLabel: "¿Le suena? Toque uno",
    tiles: [
      { id: "leak", label: "Fuga de agua", message: "Encontré una fuga o agua donde no debería estar." },
      { id: "drain", label: "Drenaje tapado", message: "El agua drena lento o no drena." },
      { id: "ac", label: "El aire no enfría", message: "El aire acondicionado funciona pero no enfría la casa." },
      { id: "hotwater", label: "Sin agua caliente", message: "No hay agua caliente — puede ser el calentador." },
      { id: "power", label: "Sin electricidad", message: "Un enchufe o breaker dejó de funcionar." },
      { id: "other", label: "Otro problema", message: "Tengo otro problema de reparación en casa." },
    ],
    questionStep: "Pregunta {current} de {total}",
    moreIssues: "Ver más posibilidades",
    fewerIssues: "Ver menos",
    safetyUrgent: "Nota de seguridad importante — toque para leer",
    answerPlaceholder: "Escriba su respuesta…",
    skipUndo: "Deshacer omisión",
    skipNote: "Pregunta omitida:",
    likelihood: { high: "alta", medium: "media", low: "baja" },
  },
};

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/webm", "audio/mp4", "audio/wav", "audio/x-wav"]);
const megabyte = 1024 * 1024;

function accountIdFromToken(token: string) {
  try {
    const encoded = (token.split(".")[1] ?? "").replaceAll("-", "+").replaceAll("_", "/");
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))) as { sub?: string };
    return payload.sub ?? "customer";
  } catch {
    return "customer";
  }
}

function intakeStorageKey(token: string, locale: IntakeLocale) {
  return `wecover:intake:${accountIdFromToken(token)}:${locale}`;
}

function readStoredIntake(token: string, locale: IntakeLocale): StoredIntake {
  const empty: StoredIntake = { messages: [], draft: "", assessment: null, selectedIssueIds: [], skipQuestionIds: [], skipAcknowledged: false, uncertaintyAcknowledged: false, translations: {}, translationsDirty: false, hadMedia: false, pendingMediaRequest: null };
  try {
    const saved = sessionStorage.getItem(intakeStorageKey(token, locale));
    if (!saved) return empty;
    const state = JSON.parse(saved) as Partial<StoredIntake>;
    const storedMessages = state.messages ?? empty.messages;
    const hasLegacyGreeting = storedMessages[0]?.role === "assistant" && Object.values(copy).some(({ greeting }) => greeting === storedMessages[0]?.content);
    return { ...empty, ...state, messages: hasLegacyGreeting ? storedMessages.slice(1) : storedMessages, translations: hasLegacyGreeting ? {} : state.translations ?? {}, translationsDirty: hasLegacyGreeting ? false : state.translationsDirty ?? false };
  } catch {
    return empty;
  }
}

function apiError(status: number, body: unknown, locale: IntakeLocale) {
  if (status === 503) return locale === "es" ? "El asistente no está disponible en este momento. Sus datos siguen aquí; inténtelo de nuevo." : "The repair assistant is temporarily unavailable. Your details are still here — please try again.";
  if (typeof body === "object" && body && "error" in body && typeof body.error === "string") return body.error;
  return locale === "es" ? "No pudimos procesar su mensaje. Inténtelo de nuevo." : "We couldn’t process that message. Please try again.";
}

export function ChatIntake({ accessToken, onCreated, onLocaleChange, initialLocale = "en" }: ChatIntakeProps) {
  const [initialState] = useState(() => readStoredIntake(accessToken, initialLocale));
  const [locale, setLocale] = useState<IntakeLocale>(initialLocale);
  const text = copy[locale];
  const [messages, setMessages] = useState<DisplayMessage[]>(initialState.messages);
  const [draft, setDraft] = useState(initialState.draft);
  const [files, setFiles] = useState<File[]>([]);
  const [assessment, setAssessment] = useState<IntakeAssessment | null>(initialState.assessment);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>(initialState.selectedIssueIds);
  const [skipQuestionIds, setSkipQuestionIds] = useState<string[]>(initialState.skipQuestionIds);
  const [skipAcknowledged, setSkipAcknowledged] = useState(initialState.skipAcknowledged);
  const [uncertaintyAcknowledged, setUncertaintyAcknowledged] = useState(initialState.uncertaintyAcknowledged);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [mediaConsent, setMediaConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lastAttempt, setLastAttempt] = useState<(() => Promise<void>) | null>(null);
  const [confirmationRetry, setConfirmationRetry] = useState<(() => Promise<void>) | null>(null);
  const [translations, setTranslations] = useState<Record<number, Translation>>(initialState.translations);
  const [translationsDirty, setTranslationsDirty] = useState(initialState.translationsDirty);
  const [requiresReattach, setRequiresReattach] = useState(initialState.hadMedia);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [pendingMediaRequest, setPendingMediaRequest] = useState<PendingMediaRequest | null>(initialState.pendingMediaRequest);
  const logRef = useRef<HTMLDivElement>(null);
  const storageKey = intakeStorageKey(accessToken, locale);
  const openQuestions = assessment?.questions.filter((question) => !skipQuestionIds.includes(question.id)) ?? [];
  const activeQuestion = assessment && !assessment.readyToConfirm ? openQuestions[0] : undefined;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, assessment, error]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ messages, draft, assessment, selectedIssueIds, skipQuestionIds, skipAcknowledged, uncertaintyAcknowledged, translations, translationsDirty, hadMedia: files.length > 0 || requiresReattach, pendingMediaRequest }));
    } catch { return; }
  }, [assessment, draft, files.length, messages, pendingMediaRequest, requiresReattach, selectedIssueIds, skipAcknowledged, skipQuestionIds, storageKey, translations, translationsDirty, uncertaintyAcknowledged]);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  const changeLocale = (next: IntakeLocale) => {
    const state = readStoredIntake(accessToken, next);
    setLocale(next);
    onLocaleChange?.(next);
    setMessages(state.messages); setDraft(state.draft); setAssessment(state.assessment); setSelectedIssueIds(state.selectedIssueIds); setSkipQuestionIds(state.skipQuestionIds); setSkipAcknowledged(state.skipAcknowledged); setUncertaintyAcknowledged(state.uncertaintyAcknowledged); setTranslations(state.translations); setTranslationsDirty(state.translationsDirty); setRequiresReattach(state.hadMedia); setPendingMediaRequest(state.pendingMediaRequest); setFiles([]); setMediaConsent(false); setError(""); setFileError(""); setLastAttempt(null); setConfirmationRetry(null); setShowAllIssues(false);
  };

  const addFiles = (incoming: File[]) => {
    const next = [...files, ...incoming];
    if (next.length > 10) return setFileError(locale === "es" ? "Puede adjuntar hasta 10 archivos." : "You can attach up to 10 files.");
    if (next.some((file) => !allowedTypes.has(file.type))) return setFileError(locale === "es" ? "Uno de los archivos tiene un formato no compatible." : "One of those files isn’t a supported photo or video format.");
    if (next.some((file) => file.size > 25 * megabyte)) return setFileError(locale === "es" ? "Cada archivo debe pesar 25 MB o menos." : "Each file must be 25 MB or smaller.");
    if (next.reduce((sum, file) => sum + file.size, 0) > 50 * megabyte) return setFileError(locale === "es" ? "Los archivos deben pesar 50 MB o menos en total." : "Your files must be 50 MB or less in total.");
    setFileError("");
    setFiles(next);
    setRequiresReattach(false);
  };

  const runAnalysis = async (userContent?: string, skippedIds = skipQuestionIds) => {
    const trimmed = userContent?.trim() ?? "";
    if (!trimmed && skippedIds.length === 0 && files.length === 0 && !translationsDirty) return;
    const attachmentNote = files.length ? `${files.length} ${locale === "es" ? "archivo(s) adjunto(s)" : "attachment(s) included"}` : "";
    const content = [trimmed, attachmentNote].filter(Boolean).join("\n");
    const answeredQuestion = trimmed ? assessment?.questions.find((question) => !skippedIds.includes(question.id)) : undefined;
    const quoted = answeredQuestion?.prompt;
    const noteMessages = (assessment?.questions ?? []).filter((question) => skippedIds.includes(question.id)).map((question) => ({ role: "assistant" as const, content: `${text.skipNote} ${question.prompt}`, locale, echo: true, note: true }));
    const nextMessages = [...messages, ...noteMessages, ...(content ? [{ role: "user" as const, content, locale, quoted }] : [])];

    const attempt = async () => {
      setBusy(true);
      setError("");
      if (nextMessages.length !== messages.length) setMessages(nextMessages);
      try {
        const form = new FormData();
        form.append("payload", JSON.stringify({
          locale,
          history: nextMessages.filter((message) => !message.echo).map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          previousAssessmentToken: assessment?.assessmentToken,
          skipped: skippedIds.length ? { questionIds: skippedIds, warningAcknowledged: skipAcknowledged } : undefined,
          mediaConsent: files.length ? mediaConsent : undefined,
          translations: Object.values(translations).filter(({ translationToken }) => Boolean(translationToken)).map(({ original, translated, sourceLocale, targetLocale, translationToken }) => ({ original, translated, sourceLocale, targetLocale, translationToken })),
        }));
        files.forEach((file) => form.append("media", file, file.name));
        const response = await fetch("/api/intake/analyze", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form, signal: AbortSignal.timeout(75_000) });
        const body = await response.json().catch(() => ({})) as IntakeAssessment & { error?: string };
        if (!response.ok) throw new Error(apiError(response.status, body, locale));
        setAssessment(body);
        setMessages([...nextMessages, { role: "assistant", content: body.reply, locale: body.locale }]);
        setSelectedIssueIds(body.issueCandidates.filter((candidate) => candidate.likelihood !== "low").map((candidate) => candidate.id));
        setSkipQuestionIds([]);
        setSkipAcknowledged(false);
        setShowAllIssues(false);
        setTranslationsDirty(false);
        setDraft("");
      } catch (caught) {
        const timedOut = caught instanceof Error && (caught.name === "TimeoutError" || caught.name === "AbortError");
        setError(timedOut ? (locale === "es" ? "La respuesta está tardando demasiado. Inténtelo de nuevo." : "The response is taking too long. Please try again.") : caught instanceof Error ? caught.message : apiError(500, {}, locale));
      } finally {
        setBusy(false);
      }
    };

    setLastAttempt(() => attempt);
    await attempt();
  };

  const chooseSkip = (questionId: string) => {
    setSkipQuestionIds((current) => current.includes(questionId) ? current.filter((id) => id !== questionId) : [...current, questionId]);
    setSkipAcknowledged(false);
  };

  const confirmRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assessment?.assessmentToken) return;
    const form = new FormData(event.currentTarget);
    setConfirming(true);
    setError("");
    try {
      let pending = pendingMediaRequest;
      if (!pending) {
        const response = await fetch("/api/intake/confirm", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ assessmentToken: assessment.assessmentToken, acceptedIssueIds: selectedIssueIds, warningAcknowledged: uncertaintyAcknowledged, customerName: form.get("customerName"), address: form.get("address") }),
          signal: AbortSignal.timeout(30_000),
        });
        const body = await response.json().catch(() => ({})) as { requestId?: string; error?: string };
        if (!response.ok || !body.requestId) throw new Error(apiError(response.status, body, locale));
        pending = { requestId: body.requestId, assessmentToken: assessment.assessmentToken };
        setPendingMediaRequest(pending);
      }
      const finish = async () => {
        if (requiresReattach) throw new Error(text.reattach);
        if (files.length > 0) {
          const upload = new FormData();
          upload.append("assessmentToken", pending.assessmentToken);
          files.forEach((file) => upload.append("media", file, file.name));
          const uploadResponse = await fetch(`/api/requests/${pending.requestId}/intake-media`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: upload, signal: AbortSignal.timeout(120_000) });
          const uploadBody = await uploadResponse.json().catch(() => ({})) as { error?: string };
          if (!uploadResponse.ok) throw new Error(apiError(uploadResponse.status, uploadBody, locale));
        }
        sessionStorage.removeItem(storageKey);
        setPendingMediaRequest(null);
        setConfirmationRetry(null);
        await onCreated(pending.requestId);
      };
      setConfirmationRetry(() => finish);
      await finish();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : apiError(500, {}, locale));
    } finally {
      setConfirming(false);
    }
  };

  return <section className="chat-intake" data-testid="customer-intake" aria-labelledby="intake-title">
    <header className="chat-intake__header">
      <div><p className="chat-intake__kicker">WECOVER HOME REPAIR</p><h1 id="intake-title">{text.title}</h1><p>{text.subtitle}</p></div>
      <div className="language-switch" role="group" aria-label="Language"><button type="button" aria-pressed={locale === "en"} onClick={() => changeLocale("en")}>EN</button><button type="button" aria-pressed={locale === "es"} onClick={() => changeLocale("es")}>ES</button></div>
    </header>

    <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
      <div className="chat-message chat-message--assistant"><span className="chat-message__sender">WeCover</span><p>{text.greeting}</p></div>
      {messages.length === 0 && !assessment && <>
        <div className="intake-hero">
          <img className="intake-hero__art" src="/img/intake-scan.png" alt=""/>
          <div className="intake-hero__body"><h2>{text.heroTitle}</h2><p>{text.heroSub}</p>
            <label className="intake-hero__cta"><CameraIcon size={18}/>{text.photoCta}<input type="file" accept={fileAccept} multiple onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}/></label>
          </div>
        </div>
        <div className="symptom-tiles"><span className="symptom-tiles__label">{text.tilesLabel}</span><div className="symptom-grid">{text.tiles.map((tile) => { const TileIcon = symptomIcons[tile.id]; return <button type="button" key={tile.id} onClick={() => void runAnalysis(tile.message)}><TileIcon size={22}/><span>{tile.label}</span></button>; })}</div></div>
      </>}
      {messages.map((message, index) => {
        if (message.note) return <div className="chat-note" key={`note-${index}`}>{message.content}</div>;
        const next = messages[index + 1];
        const hasPendingCard = index === messages.length - 1 && Boolean(activeQuestion);
        const hasQuotedAnswer = next?.role === "user" && Boolean(next.quoted);
        const content = message.role === "assistant" && (hasPendingCard || hasQuotedAnswer) ? message.content.replace(/[^.!?]*\?/g, "").replace(/\s{2,}/g, " ").trim() : message.content;
        if (!content) return null;
        return <div className={`chat-message chat-message--${message.role}`} key={`${message.role}-${index}`}><span className="chat-message__sender">{message.role === "assistant" ? "WeCover" : locale === "es" ? "Usted" : "You"}</span><p>{message.quoted && <small className="chat-message__quote">{message.quoted}</small>}{content}</p></div>;
      })}
      {busy && <div className="chat-message chat-message--assistant chat-message--thinking" aria-label={locale === "es" ? "Analizando" : "Analyzing"}><span/><span/><span/></div>}

      {assessment && !busy && <div className="assessment" data-testid="intake-assessment">
        {assessment.safety.level === "emergency" && <div className="safety-guidance safety-guidance--emergency" role="alert"><WarningIcon size={22}/><div><strong>{locale === "es" ? "Posible emergencia" : "Possible emergency"}</strong><p>{assessment.safety.guidance}</p></div></div>}
        {assessment.safety.level !== "normal" && assessment.safety.level !== "emergency" && <details className={`safety-guidance safety-guidance--${assessment.safety.level} safety-collapsible`}><summary><WarningIcon size={18}/><strong>{text.safetyUrgent}</strong></summary><p>{assessment.safety.guidance}</p></details>}
        {assessment.issueCandidates.length > 0 && !assessment.readyToConfirm && <section className="possible-issues" aria-labelledby="possible-issues-title"><h2 id="possible-issues-title">{text.possibleIssues}</h2><p className="tentative-note">{text.tentative}</p>{(showAllIssues ? assessment.issueCandidates : assessment.issueCandidates.slice(0, 2)).map((candidate) => { const CandidateIcon = issueIcon(candidate.label); return <article key={candidate.id}><span className="issue-icon"><CandidateIcon size={20}/></span><div className="issue-body"><div><strong>{candidate.label}</strong><span className={`likelihood likelihood--${candidate.likelihood}`}>{text.likelihood[candidate.likelihood] ?? candidate.likelihood}</span></div><p>{candidate.reason}</p>{candidate.evidenceNeeded.length > 0 && <small><PhotoIcon size={16}/>{text.evidence}: {candidate.evidenceNeeded.join(", ")}</small>}</div></article>; })}{assessment.issueCandidates.length > 2 && <button type="button" className="issues-more" onClick={() => setShowAllIssues((value) => !value)}>{showAllIssues ? text.fewerIssues : `${text.moreIssues} (${assessment.issueCandidates.length - 2})`}</button>}</section>}
        {activeQuestion && <section className="followup-questions" aria-label={locale === "es" ? "Pregunta de seguimiento" : "Follow-up question"}><p className="question-progress">{text.questionStep.replace("{current}", String(assessment.questions.length - openQuestions.length + 1)).replace("{total}", String(assessment.questions.length))}</p><article key={activeQuestion.id}><p>{activeQuestion.prompt}</p>{activeQuestion.requiredForSafety ? <small className="required-safety">{text.safetyRequired}</small> : <button type="button" className={skipQuestionIds.includes(activeQuestion.id) ? "selected" : ""} onClick={() => chooseSkip(activeQuestion.id)}>{text.skip}</button>}</article></section>}
        {skipQuestionIds.length > 0 && <div className="skip-warning" role="note"><div className="skip-undos">{assessment.questions.filter((question) => skipQuestionIds.includes(question.id)).map((question) => <button key={question.id} type="button" className="skip-undo" onClick={() => chooseSkip(question.id)}><span>{text.skipUndo}</span>{question.prompt}</button>)}</div><p>{text.skipWarning}</p><label><input type="checkbox" checked={skipAcknowledged} onChange={(event) => setSkipAcknowledged(event.target.checked)}/>{text.skipAcknowledge}</label><button type="button" disabled={!skipAcknowledged} onClick={() => void runAnalysis(undefined, skipQuestionIds)}>{text.skipContinue}</button></div>}
        {translationsDirty && <div className="translation-sync"><button type="button" onClick={() => void runAnalysis()} disabled={busy || requiresReattach}>{text.saveTranslation}</button></div>}
        {assessment.readyToConfirm && assessment.assessmentToken && assessment.safety.level !== "emergency" && <form className="confirm-request" onSubmit={confirmRequest}><div><h2>{text.confirmTitle}</h2><p>{text.confirmHelp}</p></div><fieldset><legend>{text.possibleIssues}</legend>{assessment.issueCandidates.map((candidate) => { const CandidateIcon = issueIcon(candidate.label); return <label key={candidate.id}><input type="checkbox" checked={selectedIssueIds.includes(candidate.id)} onChange={(event) => setSelectedIssueIds((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))}/><span className="issue-icon"><CandidateIcon size={18}/></span><span><strong>{candidate.label}</strong><small>{candidate.reason}</small></span></label>; })}</fieldset><label>{text.name}<input name="customerName" autoComplete="name" required/></label><label>{text.address}<input name="address" autoComplete="street-address" required/></label><label className="confirm-request__ack"><input type="checkbox" checked={uncertaintyAcknowledged} onChange={(event) => setUncertaintyAcknowledged(event.target.checked)} required/><span>{assessment.uncertaintyWarning ?? text.uncertainty}</span></label><button className="primary confirm-request__submit" disabled={confirming || selectedIssueIds.length === 0 || requiresReattach || translationsDirty}>{confirming ? text.confirming : text.confirm}</button></form>}
      </div>}
      {error && <div className="chat-error" role="alert"><p>{error}</p>{(confirmationRetry || lastAttempt) && <button type="button" onClick={() => void (confirmationRetry ?? lastAttempt)?.()} disabled={busy || confirming || requiresReattach}>{text.retry}</button>}</div>}
    </div>

    <div className="chat-composer">
      {files.length > 0 && <div className="attachment-tray" aria-label={locale === "es" ? "Archivos adjuntos" : "Attachments"}>{files.map((file, index) => <div className="attachment" key={`${file.name}-${file.lastModified}`}><PhotoIcon size={18}/><span><strong>{file.name}</strong><small>{(file.size / megabyte).toFixed(1)} MB</small></span><button type="button" aria-label={`${text.remove} ${file.name}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><CloseIcon/></button></div>)}</div>}
      {files.length > 0 && <div className="media-consent"><p>{text.mediaPrivacy}</p><label><input type="checkbox" checked={mediaConsent} onChange={(event) => setMediaConsent(event.target.checked)}/><span>{text.mediaConsent}</span></label></div>}
      {fileError && <p className="file-error" role="alert">{fileError}</p>}
      {requiresReattach && <p className="reattach-notice" role="alert">{text.reattach}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void runAnalysis(draft); }}>
        <label className="attachment-button" title={text.attach}><PaperclipIcon/><span>{text.attach}</span><input type="file" accept={fileAccept} multiple onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}/></label>
        <label className="sr-only" htmlFor="intake-message">{text.composerLabel}</label><textarea id="intake-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={activeQuestion ? text.answerPlaceholder : text.placeholder} rows={1} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void runAnalysis(draft); } }}/>
        <button type="submit" className="send-button" aria-label={text.send} disabled={busy || requiresReattach || (!draft.trim() && skipQuestionIds.length === 0 && files.length === 0 && !translationsDirty) || (skipQuestionIds.length > 0 && !skipAcknowledged) || (files.length > 0 && !mediaConsent)}><SendIcon/></button>
      </form>
      <div className="composer-notes"><span>{text.fileLimits}</span><span>{files.length}/10 · {(totalBytes / megabyte).toFixed(1)} MB</span></div>
    </div>
    <footer className="chat-intake__footer">{text.payment}</footer>
  </section>;
}
