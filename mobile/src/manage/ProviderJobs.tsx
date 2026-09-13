/**
 * 공급자 작업 큐: 요청 수락/거절, 항목별 견적 제출(허가 필드 포함), 허가 기록, 증빙 업로드.
 */
import { DateField } from './DateField';
import { Activity } from '../requests/Activity';
import { ProviderCommunication } from './ProviderCommunication';
import { dollars, useRemote, useTask, words } from './state';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { z } from 'zod';
import { parseMoney, parseDateInput } from './formValues';
import { post, put } from '../platform/api';
import { Action, Check, styles } from '../chat/ui';
import { pickMedia } from '../chat/media';
import { multipart } from '../chat/api';
import type { Attachment } from '../chat/protocol';
import { Field, Screen, Section, type ManagementProps } from './shared';
import { getProviderEvidenceReadiness, hasProviderQuote, providerEvidenceKinds, type ProviderEvidenceKind } from './providerJob';
const requestSchema = z.object({ id: z.string(), description: z.string(), address: z.string(), status: z.string() });
const dashboard = z.object({ requests: z.array(requestSchema), evidence: z.array(z.object({ id: z.string(), requestId: z.string(), kind: z.enum(providerEvidenceKinds), note: z.string() })), quotes: z.array(z.object({ id: z.string(), requestId: z.string(), providerId: z.string(), amountCents: z.number() })) });
const resultSchema = z.object({}).passthrough();
const bundlesSchema = z.object({ bundles: z.array(z.object({ id: z.string(), primary_request_id: z.string(), status: z.string(), scope_snapshot: z.array(z.object({ requestId: z.string(), description: z.string() }).passthrough()) })) });
const permitSchema = z.object({ permit: z.object({ request_id: z.string(), permit_number: z.string(), inspection_status: z.string(), verified: z.boolean(), verification_reference: z.string().nullable(), updated_at: z.string() }).nullable() });
const quoteDetailsSchema = z.object({ details: z.array(z.object({ permit_required: z.boolean() })) });
export function ProviderJobs(props: ManagementProps) {
  const { locale, accessToken: token } = props; const t = (en: string, es: string) => words(locale, en, es); const remote = useRemote('/api/dashboard', token, dashboard, locale); const [selected, setSelected] = useState('');
  const item = remote.data?.requests.find(value => value.id === selected);
  if (item && remote.data) return <JobDetail {...props} item={item} data={remote.data} refresh={remote.reload} onBack={() => { setSelected(''); void remote.reload(); }} />;
  return <Screen {...props} title={t('Invitations and jobs', 'Invitaciones y trabajos')}>{remote.feedback}{remote.data?.requests.length === 0 && <Text style={styles.body}>{t('Requests matched to your verified services will appear here.', 'Aquí aparecerán las solicitudes que coincidan con tus servicios verificados.')}</Text>}{remote.data?.requests.map(value => <View key={value.id} style={styles.separator}><Text style={styles.muted}>{value.address}</Text><Action label={value.description} onPress={() => setSelected(value.id)} /></View>)}</Screen>;
}
function JobDetail(props: ManagementProps & { readonly item: z.infer<typeof requestSchema>; readonly data: z.infer<typeof dashboard>; readonly refresh: () => Promise<void> }) {
  const { item, data, refresh, locale, actorId, accessToken: token } = props; const t = (en: string, es: string) => words(locale, en, es); const task = useTask(locale); const [quote, setQuote] = useState(false); const [note, setNote] = useState(''); const [kind, setKind] = useState<'before' | 'during' | 'after' | 'receipt' | 'warranty'>('before'); const [files, setFiles] = useState<Attachment[]>([]);
  const evidenceSubmitting = useRef(false); const readiness = getProviderEvidenceReadiness(item.id, data.evidence);
  const evidenceLabel = (value: ProviderEvidenceKind) => value === 'before' ? t('Before work', 'Antes del trabajo') : value === 'during' ? t('During work', 'Durante el trabajo') : value === 'after' ? t('After work', 'Después del trabajo') : value === 'receipt' ? t('Receipt', 'Recibo') : t('Warranty', 'Garantía');
  const submitEvidence = () => {
    if (task.busy || evidenceSubmitting.current) return;
    const submittedNote = note; const submittedFiles = files;
    evidenceSubmitting.current = true;
    void task.run(async () => {
      try {
        await post(`/api/requests/${item.id}/${submittedFiles.length ? 'evidence-files' : 'evidence'}`, token, resultSchema, submittedFiles.length ? multipart({ kind, note: submittedNote }, submittedFiles) : { kind, note: submittedNote });
        setFiles(current => current === submittedFiles ? [] : current);
        setNote(current => current === submittedNote ? '' : current);
        await refresh();
      } finally {
        evidenceSubmitting.current = false;
      }
    }, t('Evidence saved.', 'Prueba guardada.'));
  };
  const action = (suffix: string, body: unknown = {}) => void task.run(async () => { await post(`/api/requests/${item.id}/${suffix}`, token, resultSchema, body); await refresh(); }, t('Job updated.', 'Trabajo actualizado.'));
  if (quote) return <QuoteEditor {...props} onBack={() => { setQuote(false); void refresh(); }} />;
  return <Screen {...props} title={item.description}><Text style={styles.body}>{item.address}</Text><Text style={styles.muted}>{t('Job status', 'Estado del trabajo')}: {item.status.replaceAll('_', ' ')}</Text>{task.feedback}
    {['matched', 'quoted'].includes(item.status) && <Section title={t('Invitation to quote', 'Invitación a presupuestar')}><Text style={styles.muted}>{t('Accepting this invitation does not book or charge the customer.', 'Aceptar esta invitación no reserva el trabajo ni cobra al cliente.')}</Text>{(['accept', 'decline'] as const).map(decision => <Action key={decision} disabled={task.busy} label={decision === 'accept' ? t('Accept invitation', 'Aceptar invitación') : t('Decline invitation', 'Rechazar invitación')} onPress={() => void task.run(async () => { await post(`/api/providers/requests/${item.id}/respond`, token, z.object({ match: z.object({}).passthrough() }), { decision }); await refresh(); }, t('Response recorded.', 'Respuesta registrada.'))} />)}{actorId.length > 0 && !hasProviderQuote(item.id, actorId, data.quotes) && <Action label={t('Prepare itemized quote', 'Preparar presupuesto detallado')} onPress={() => setQuote(true)} />}</Section>}
    {item.status === 'funded' && <Action primary disabled={task.busy} label={t('Start work', 'Comenzar trabajo')} onPress={() => action('start')} />}
    <PermitSection {...props} requestId={item.id} />
    <Activity accessToken={token} requestId={item.id} locale={locale} revision={data} /><ProviderCommunication {...props} requestId={item.id} status={item.status} /><Section title={t('Work evidence', 'Pruebas del trabajo')}><Text style={styles.muted}>{t('Record the condition before and after work. Add photos or video with the customer’s consent.', 'Registra el estado antes y después del trabajo. Añade fotos o video con el consentimiento del cliente.')}</Text>{providerEvidenceKinds.map(value => <Text key={`status-${value}`} style={styles.body}>{readiness.kinds[value] ? '✓' : '○'} {evidenceLabel(value)} · {value === 'before' || value === 'after' ? (readiness.kinds[value] ? t('Required — added', 'Obligatoria — añadida') : t('Required — missing', 'Obligatoria — falta')) : (readiness.kinds[value] ? t('Optional — added', 'Opcional — añadida') : t('Optional — not added', 'Opcional — no añadida'))}</Text>)}{data.evidence.filter(value => value.requestId === item.id).map(value => <Text key={value.id} style={styles.body}>{evidenceLabel(value.kind)} · {value.note}</Text>)}{providerEvidenceKinds.map(value => <Action key={value} primary={kind === value} label={evidenceLabel(value)} onPress={() => setKind(value)} />)}<Field label={t('Describe this evidence', 'Describe esta prueba')} value={note} onChange={setNote} multiline />{files.map(file => <Text key={file.uri} style={styles.muted}>{file.name}</Text>)}<Action disabled={task.busy} label={t('Take evidence photo', 'Tomar foto como prueba')} onPress={() => void task.run(async () => setFiles(await pickMedia('camera', files)))} /><Action disabled={task.busy} label={t('Choose photos or video', 'Elegir fotos o video')} onPress={() => void task.run(async () => setFiles(await pickMedia('library', files)))} /><Action disabled={task.busy || evidenceSubmitting.current || note.trim().length < 3} label={t('Save work evidence', 'Guardar prueba del trabajo')} onPress={submitEvidence} /></Section>
    {item.status === 'in_progress' && <><Text style={styles.muted}>{readiness.completionReady ? t('Required before and after evidence is ready. Completion does not settle payment.', 'Las pruebas obligatorias de antes y después están listas. La finalización no liquida el pago.') : t('Before and after evidence are required to finish. Completion does not settle payment.', 'Se requieren pruebas de antes y después para finalizar. La finalización no liquida el pago.')}</Text><Action primary disabled={task.busy || !readiness.completionReady} label={t('Mark work completed', 'Marcar trabajo terminado')} onPress={() => action('complete')} /></>}
  </Screen>;
}
function PermitSection(props: ManagementProps & { readonly requestId: string }) {
  const { locale, accessToken: token, requestId } = props; const t = (en: string, es: string) => words(locale, en, es);
  const permit = useRemote(`/api/requests/${requestId}/permit`, token, permitSchema, locale);
  const details = useRemote(`/api/requests/${requestId}/quote-details`, token, quoteDetailsSchema, locale);
  const task = useTask(locale);
  const [number, setNumber] = useState(''); const [status, setStatus] = useState<'pending' | 'passed' | 'failed'>('pending');
  const existing = permit.data?.permit ?? null;
  useEffect(() => { if (existing && !number) setNumber(existing.permit_number); }, [existing, number]);
  const required = (details.data?.details ?? []).some(value => value.permit_required);
  if (!required && !existing) return <>{permit.feedback}{details.feedback}</>;
  const inspectionLabel = (value: string) => value === 'passed' ? t('passed', 'aprobada') : value === 'failed' ? t('failed', 'fallida') : t('pending', 'pendiente');
  return <Section title={t('Permit and inspection', 'Permiso e inspección')}>
    {permit.feedback}{details.feedback}{task.feedback}
    {existing ? <Text style={styles.body}>{t('Permit', 'Permiso')} {existing.permit_number} · {t('Inspection', 'Inspección')}: {inspectionLabel(existing.inspection_status)} · {existing.verified ? t('Verified by operations', 'Verificado por operaciones') : t('Awaiting operations verification', 'Pendiente de verificación de operaciones')}</Text>
      : <Text style={styles.muted}>{t('A quote for this job requires a permit. Record the permit number here; operations must verify it before work can start or finish.', 'Un presupuesto de este trabajo requiere permiso. Registra el número aquí; operaciones debe verificarlo antes de comenzar o terminar el trabajo.')}</Text>}
    <Field label={t('Permit number', 'Número de permiso')} value={number} onChange={setNumber} />
    <View style={styles.row}>{(['pending', 'passed', 'failed'] as const).map(value => <Action key={value} primary={status === value} label={`${t('Inspection', 'Inspección')}: ${inspectionLabel(value)}`} onPress={() => setStatus(value)} />)}</View>
    <Action primary disabled={task.busy || number.trim().length < 2} label={t('Save permit record', 'Guardar registro de permiso')} onPress={() => void task.run(async () => { await put(`/api/requests/${requestId}/permit`, token, z.object({ permit: z.object({}).passthrough() }), { permitNumber: number.trim(), inspectionStatus: status }); await permit.reload(); }, t('Permit recorded. Operations will verify it.', 'Permiso registrado. Operaciones lo verificará.'))} />
  </Section>;
}
function QuoteEditor(props: ManagementProps & { readonly item: z.infer<typeof requestSchema> }) {
  const { locale, accessToken: token, item } = props; const t = (en: string, es: string) => words(locale, en, es); const task = useTask(locale); const care = useRemote('/api/care', token, bundlesSchema, locale);
  const [scope, setScope] = useState(''); const [amounts, setAmounts] = useState({ diagnostic: '', labor: '', materials: '', tax: '' }); const [valid, setValid] = useState(''); const [start, setStart] = useState(''); const [warranty, setWarranty] = useState('0'); const [siteVisit, setSiteVisit] = useState(false); const [permit, setPermit] = useState(false); const [permitNumber, setPermitNumber] = useState(''); const [inspection, setInspection] = useState<'pending' | 'passed'>('pending');
  const bundle = care.data?.bundles.find(value => value.primary_request_id === item.id && value.status === 'active'); const cents = { diagnosticCents: Math.round(Number(amounts.diagnostic) * 100), laborCents: Math.round(Number(amounts.labor) * 100), materialsCents: Math.round(Number(amounts.materials) * 100), taxCents: Math.round(Number(amounts.tax) * 100) }; const total = Object.values(cents).reduce((sum, value) => sum + value, 0);
  return <Screen {...props} title={t('Itemized quote', 'Presupuesto detallado')}>{care.feedback}{bundle && <Section title={t('One visit for these jobs', 'Una visita para estos trabajos')}>{bundle.scope_snapshot.map(value => <Text key={value.requestId} style={styles.body}>{value.description}</Text>)}</Section>}<Field multiline label={t('Work included and exclusions', 'Trabajo incluido y exclusiones')} value={scope} onChange={setScope} />{([['diagnostic', 'Diagnosis (USD)', 'Diagnóstico (USD)'], ['labor', 'Labor (USD)', 'Mano de obra (USD)'], ['materials', 'Materials (USD)', 'Materiales (USD)'], ['tax', 'Tax (USD)', 'Impuestos (USD)']] as const).map(([key, en, es]) => <Field key={key} numeric label={t(en, es)} value={amounts[key]} onChange={value => setAmounts(current => ({ ...current, [key]: value }))} />)}<Text style={styles.heading}>{t('Total', 'Total')}: {dollars(Number.isFinite(total) ? total : 0, locale)}</Text><DateField locale={locale} time label={t('Quote valid until', 'Presupuesto válido hasta')} value={valid} onChange={setValid} /><DateField locale={locale} time label={t('Earliest start', 'Inicio más temprano')} value={start} onChange={setStart} /><Field numeric label={t('Warranty days', 'Días de garantía')} value={warranty} onChange={setWarranty} /><Check label={t('Site visit required before final scope', 'Visita necesaria antes del alcance final')} checked={siteVisit} onPress={() => setSiteVisit(value => !value)} /><Check label={t('Permit required', 'Se requiere permiso')} checked={permit} onPress={() => setPermit(value => !value)} />{permit && <><Field label={t('Permit number (if issued)', 'Número de permiso (si se emitió)')} value={permitNumber} onChange={setPermitNumber} /><Action label={inspection === 'pending' ? t('Inspection: pending', 'Inspección: pendiente') : t('Inspection: passed', 'Inspección: aprobada')} onPress={() => setInspection(value => value === 'pending' ? 'passed' : 'pending')} /><Text style={styles.muted}>{t('Unresolved permit or inspection requirements prevent work from starting.', 'Los requisitos de permiso o inspección pendientes impiden comenzar el trabajo.')}</Text></>}{task.feedback}<Action primary disabled={task.busy || !care.data || !scope.trim() || !Number.isFinite(total) || total <= 0} label={t('Send itemized quote', 'Enviar presupuesto detallado')} onPress={() => void task.run(async () => { await post(`/api/providers/requests/${item.id}/quote`, token, z.object({ quote: z.object({}).passthrough() }), { scope, diagnosticCents: parseMoney(amounts.diagnostic || '0'), laborCents: parseMoney(amounts.labor || '0'), materialsCents: parseMoney(amounts.materials || '0'), taxCents: parseMoney(amounts.tax || '0'), totalCents: total, validUntil: parseDateInput(valid, true), earliestStartAt: parseDateInput(start, true), warrantyDays: Number(warranty), siteVisitRequired: siteVisit, permitRequired: permit, ...(permitNumber.trim() ? { permitNumber } : {}), inspectionStatus: permit ? inspection : 'not_required', ...(bundle ? { bundleId: bundle.id } : {}) }); }, t('Quote sent. Return to your jobs to view the request.', 'Presupuesto enviado. Vuelve a tus trabajos para ver la solicitud.'))} /></Screen>;
}
