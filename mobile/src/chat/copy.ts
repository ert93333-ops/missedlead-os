/**
 * 채팅 화면 EN/ES 문구 모음(동의·제한·에러·버튼 라벨).
 */
import type { Locale } from './protocol';

export const copy = {
  en: {
    conversation_limit: 'This conversation has reached its length limit. Your draft is still here. Copy any details you need, then start a new request.',
    title: 'Your repair assistant', greeting: 'What’s happening in your home? Tell us what you see, hear, or smell. Add photos, a short video, or an audio file when helpful.',
    placeholder: 'What happened?', send: 'Send', camera: 'Take photo', video: 'Record video', library: 'Photos & videos', audio: 'Audio file', remove: 'Remove',
    consent: 'I agree to AI processing of these files for this repair request.', privacy: 'Remove faces, IDs, mail, and private details before sending.', limits: '10 files · 25 MB each · 50 MB total · video/audio up to 60 seconds',
    thinking: 'Reviewing your details…', retry: 'Try again', translate: 'Translate', translationWarning: 'AI translation may be inaccurate. Confirm prices, scope, warranties, and legal terms before approval.', saveTranslation: 'Save translations and continue', translationSetting: 'Enable AI translations',
    possible: 'What it might be', provisional: 'These are possibilities. A technician must inspect the problem to confirm its cause.', answerPrompt: 'Answer in your own words. You can describe what you noticed, when it happens, and anything that changed.', questionKicker: 'One detail at a time', resultKicker: 'Your first look',
    skip: 'Not sure — skip', required: 'Needed for safety; this question cannot be skipped.', skipWarning: 'Missing details may change the technicians we can match and the final quote.', skipAck: 'I understand the quote may change.', skipContinue: 'Skip selected questions',
    review: 'Review your request', name: 'Your name', address: 'Service address', uncertainty: 'I understand this scope is provisional and the final quote may change after inspection.', confirm: 'Confirm & find technicians',
    saved: 'Your request is saved', matched: 'eligible technicians matched.', noMatches: 'No eligible technician is available for this request yet. Your request is saved; a booking is not confirmed.',
    pendingUpload: 'Your request is saved, but its files still need to upload. Keep this screen open and retry.', retryUpload: 'Retry file upload', newRequest: 'New request', signOut: 'Sign out', noPayment: 'No payment is collected during this consultation.',
    emergency: 'Stop and seek urgent help', emergencyHelp: 'If there is immediate danger, leave the area and call 911. Do not attempt repairs.',
    error: 'We couldn’t complete that step. Your details are still here. Try again.', file_limits: 'Use up to 10 files, 25 MB each and 50 MB total.', file_format: 'Choose a JPG, PNG, WebP, MP4, MOV, WebM, MP3, M4A, or WAV file.',
    camera_permission: 'Allow camera access in Settings, or choose an existing photo or video.', microphone_permission: 'Allow microphone access in Settings to record a video with sound.', video_duration: 'Choose a video up to 60 seconds long.',
    media_reattach: 'These files are no longer available here. Select the same original files again. For a saved request, names and contents must match. If you no longer have them, start a new request.',
    connection_retry: 'Connection interrupted. Your details are still here. Check your connection and try again.',
    intake_daily_quota_exceeded: 'Today’s consultation limit has been reached. Please return tomorrow.', intake_capacity_reached: 'The assistant is busy. Please try again shortly.',
    invalid_assessment_token: 'This consultation has expired. Start a new request to review your details again.', intake_ai_unavailable: 'The assistant is temporarily unavailable. Please try again.',
  },
  es: {
    conversation_limit: 'Esta conversación alcanzó el límite de extensión. Su borrador sigue aquí. Copie los detalles que necesite e inicie otra solicitud.',
    title: 'Su asistente de reparaciones', greeting: '¿Qué está pasando en su hogar? Cuéntenos qué ve, oye o huele. Puede agregar fotos, un video corto o un archivo de audio.',
    placeholder: '¿Qué pasó?', send: 'Enviar', camera: 'Tomar foto', video: 'Grabar video', library: 'Fotos y videos', audio: 'Archivo de audio', remove: 'Eliminar',
    consent: 'Acepto el procesamiento con IA de estos archivos para esta solicitud.', privacy: 'Quite rostros, identificaciones, correspondencia y datos privados antes de enviar.', limits: '10 archivos · 25 MB cada uno · 50 MB total · video/audio hasta 60 segundos',
    thinking: 'Revisando sus datos…', retry: 'Intentar de nuevo', translate: 'Traducir', translationWarning: 'La traducción con IA puede contener errores. Confirme precios, alcance, garantías y términos legales antes de aprobar.', saveTranslation: 'Guardar traducciones y continuar', translationSetting: 'Activar traducciones con IA',
    possible: 'Qué podría ser', provisional: 'Estas son posibilidades. Un técnico debe inspeccionar el problema para confirmar la causa.', answerPrompt: 'Responda con sus propias palabras. Puede describir qué notó, cuándo ocurre y qué cambió.', questionKicker: 'Un detalle a la vez', resultKicker: 'Su primera orientación',
    skip: 'No estoy seguro — omitir', required: 'Necesaria por seguridad; esta pregunta no se puede omitir.', skipWarning: 'La información faltante puede cambiar los técnicos disponibles y el presupuesto final.', skipAck: 'Entiendo que el presupuesto puede cambiar.', skipContinue: 'Omitir preguntas seleccionadas',
    review: 'Revise su solicitud', name: 'Su nombre', address: 'Dirección del servicio', uncertainty: 'Entiendo que este alcance es provisional y el presupuesto final puede cambiar después de la inspección.', confirm: 'Confirmar y buscar técnicos',
    saved: 'Su solicitud está guardada', matched: 'técnicos elegibles encontrados.', noMatches: 'Aún no hay un técnico elegible disponible. Su solicitud está guardada; la reserva no está confirmada.',
    pendingUpload: 'Su solicitud está guardada, pero faltan los archivos. Mantenga esta pantalla abierta e inténtelo de nuevo.', retryUpload: 'Reintentar carga', newRequest: 'Nueva solicitud', signOut: 'Cerrar sesión', noPayment: 'No se cobra durante esta consulta.',
    emergency: 'Deténgase y busque ayuda urgente', emergencyHelp: 'Si hay peligro inmediato, salga del área y llame al 911. No intente reparar el problema.',
    error: 'No pudimos completar este paso. Sus datos siguen aquí. Inténtelo de nuevo.', file_limits: 'Use hasta 10 archivos, 25 MB cada uno y 50 MB en total.', file_format: 'Elija un archivo JPG, PNG, WebP, MP4, MOV, WebM, MP3, M4A o WAV.',
    camera_permission: 'Permita el acceso a la cámara en Ajustes o elija una foto o video existente.', microphone_permission: 'Permita el acceso al micrófono en Ajustes para grabar video con sonido.', video_duration: 'Elija un video de hasta 60 segundos.',
    media_reattach: 'Estos archivos ya no están disponibles aquí. Seleccione los mismos originales. Para una solicitud guardada, los nombres y el contenido deben coincidir. Si ya no los tiene, inicie otra solicitud.',
    connection_retry: 'Se interrumpió la conexión. Sus datos siguen aquí. Revise la conexión e inténtelo de nuevo.',
    intake_daily_quota_exceeded: 'Se alcanzó el límite de consultas de hoy. Vuelva mañana.', intake_capacity_reached: 'El asistente está ocupado. Inténtelo de nuevo en un momento.',
    invalid_assessment_token: 'Esta consulta ha vencido. Inicie otra solicitud para revisar sus datos.', intake_ai_unavailable: 'El asistente no está disponible en este momento. Inténtelo de nuevo.',
  },
} as const;

export function errorCopy(code: string, locale: Locale): string {
  const text: Readonly<Record<string, string>> = copy[locale];
  return text[code] ?? text['error'] ?? '';
}
