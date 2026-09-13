/**
 * 관리 화면 루트: 역할·상태에 따라 공급자 작업/지원서/케어/비즈니스 화면으로 분기하고
 * 운영자용 허가 검증 큐를 포함한다.
 */
import { useRemote, useTask, words } from './state';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { z } from 'zod';
import { post, put } from '../platform/api';
import { Action, styles } from '../chat/ui';
import { ProviderApplication, ProviderReview } from './ProviderApplication';
import { ProviderJobs } from './ProviderJobs';
import { CareScreen } from './CareScreen';
import { BusinessScreen } from './BusinessScreen';
import { Field, Screen, type ManagementProps } from './shared';
export type { ManagementProps } from './shared';
const inboxSchema = z.object({ notifications: z.array(z.object({ id: z.string(), request_id: z.string().nullable(), kind: z.string(), title: z.string(), body: z.string(), created_at: z.string(), read_at: z.string().nullable() })) });
const coverageSchema = z.object({ zips: z.array(z.string()), configured: z.boolean() });
const opsPermitsSchema = z.object({ permits: z.array(z.object({ request_id: z.string(), permit_number: z.string(), inspection_status: z.string(), verified: z.boolean(), verification_reference: z.string().nullable(), updated_at: z.string(), service_requests: z.object({ description: z.string(), address: z.string() }).nullable() })) });
export function ManagementScreen(props: ManagementProps) {
  const { locale, role } = props; const t = (en: string, es: string) => words(locale, en, es); const [page, setPage] = useState<'home' | 'application' | 'review' | 'jobs' | 'care' | 'business' | 'inbox' | 'coverage' | 'permits'>('home'); const child = { ...props, onBack: () => setPage('home') };
  switch (page) {
    case 'permits': return <PermitQueue {...child} />;
    case 'application': return <ProviderApplication {...child} />;
    case 'review': return <ProviderReview {...child} />;
    case 'jobs': return <ProviderJobs {...child} />;
    case 'care': return <CareScreen {...child} />;
    case 'business': return <BusinessScreen {...child} />;
    case 'inbox': return <Inbox {...child} />;
    case 'coverage': return <Coverage {...child} />;
    case 'home': return <Screen {...props} title={t('Account and services', 'Cuenta y servicios')}><Action label={t('Notifications', 'Notificaciones')} onPress={() => setPage('inbox')} />{role !== 'operator' && <><Action label={t('Home care and maintenance', 'Cuidado y mantenimiento')} onPress={() => setPage('care')} /><Action label={t('Professional application', 'Solicitud profesional')} onPress={() => setPage('application')} /></>}{role === 'customer' && <Action label={t('Business locations and approvals', 'Locales y autorizaciones')} onPress={() => setPage('business')} />}{role === 'provider' && <Action label={t('Invitations, quotes and jobs', 'Invitaciones, presupuestos y trabajos')} onPress={() => setPage('jobs')} />}{role === 'operator' && <><Action label={t('Review professional applications', 'Revisar solicitudes profesionales')} onPress={() => setPage('review')} /><Action label={t('Service ZIP codes', 'Códigos postales de servicio')} onPress={() => setPage('coverage')} /><Action label={t('Permit verification', 'Verificación de permisos')} onPress={() => setPage('permits')} /></>}</Screen>;
  }
}
function Inbox(props: ManagementProps) {
  const { locale, accessToken: token } = props; const t = (en: string, es: string) => words(locale, en, es); const remote = useRemote('/api/notifications', token, inboxSchema, locale); const task = useTask(locale);
  return <Screen {...props} title={t('Notifications', 'Notificaciones')}>{remote.feedback}{task.feedback}{remote.data?.notifications.length === 0 && <Text style={styles.body}>{t('New quotes, schedule updates and expense decisions will appear here.', 'Aquí aparecerán los presupuestos nuevos, cambios de horario y decisiones de gastos.')}</Text>}{remote.data?.notifications.map(item => <View key={item.id} style={styles.separator}><Text style={styles.heading}>{item.title}</Text><Text style={styles.body}>{item.body}</Text><Text style={styles.muted}>{new Date(item.created_at).toLocaleString(locale)}</Text>{!item.read_at && <Action disabled={task.busy} label={t('Mark as read', 'Marcar como leída')} onPress={() => void task.run(async () => { await post(`/api/notifications/${item.id}/read`, token, z.object({ notification: z.object({ id: z.string() }).passthrough() }), {}); await remote.reload(); })} />}</View>)}</Screen>;
}
function PermitQueue(props: ManagementProps) {
  const { locale, accessToken: token } = props; const t = (en: string, es: string) => words(locale, en, es); const remote = useRemote('/api/ops/permits', token, opsPermitsSchema, locale); const task = useTask(locale);
  const [editing, setEditing] = useState(''); const [number, setNumber] = useState(''); const [status, setStatus] = useState<'pending' | 'passed' | 'failed'>('passed'); const [reference, setReference] = useState('');
  const permits = [...(remote.data?.permits ?? [])].sort((a, b) => Number(a.verified) - Number(b.verified));
  return <Screen {...props} title={t('Permit verification', 'Verificación de permisos')}>{remote.feedback}{task.feedback}
    <Text style={styles.muted}>{t('Jobs flagged as permit-required cannot start or finish until a permit record is verified here.', 'Los trabajos marcados con permiso no pueden comenzar ni finalizar hasta verificar el registro aquí.')}</Text>
    {remote.data?.permits.length === 0 && <Text style={styles.body}>{t('No permit records yet.', 'Aún no hay registros de permisos.')}</Text>}
    {permits.map(item => <View key={item.request_id} style={styles.separator}>
      <Text style={styles.heading}>{item.service_requests?.description ?? item.request_id}</Text>
      {item.service_requests?.address ? <Text style={styles.muted}>{item.service_requests.address}</Text> : null}
      <Text style={styles.body}>{t('Permit', 'Permiso')} {item.permit_number} · {t('Inspection', 'Inspección')}: {item.inspection_status} · {item.verified ? t('verified', 'verificado') : t('unverified', 'sin verificar')}</Text>
      {editing === item.request_id ? <>
        <Field label={t('Permit number', 'Número de permiso')} value={number} onChange={setNumber} />
        <View style={styles.row}>{(['pending', 'passed', 'failed'] as const).map(value => <Action key={value} primary={status === value} label={value} onPress={() => setStatus(value)} />)}</View>
        <Field label={t('Verification reference (permit lookup)', 'Referencia de verificación (consulta del permiso)')} value={reference} onChange={setReference} />
        <Action primary disabled={task.busy || number.trim().length < 2 || reference.trim().length < 5} label={t('Save verification', 'Guardar verificación')} onPress={() => void task.run(async () => { await put(`/api/requests/${item.request_id}/permit`, token, z.object({ permit: z.object({}).passthrough() }), { permitNumber: number.trim(), inspectionStatus: status, verificationReference: reference.trim() }); setEditing(''); setReference(''); await remote.reload(); }, t('Permit verification saved.', 'Verificación de permiso guardada.'))} />
      </> : <Action label={item.verified ? t('Update record', 'Actualizar registro') : t('Verify', 'Verificar')} onPress={() => { setEditing(item.request_id); setNumber(item.permit_number); setStatus(item.inspection_status === 'passed' || item.inspection_status === 'failed' ? item.inspection_status : 'pending'); }} />}
    </View>)}
  </Screen>;
}
function Coverage(props: ManagementProps) {
  const { locale, accessToken: token } = props; const t = (en: string, es: string) => words(locale, en, es); const remote = useRemote('/api/coverage', token, coverageSchema, locale); const task = useTask(locale); const [input, setInput] = useState<string | null>(null);
  return <Screen {...props} title={t('Service area', 'Área de servicio')}>{remote.feedback}<Text style={styles.muted}>{t('Enter only ZIP codes your verified professional network can serve. An empty list disables coverage.', 'Introduce solo los códigos postales que tu red verificada puede atender. Una lista vacía desactiva la cobertura.')}</Text><Field label={t('Supported ZIP codes, separated by commas', 'Códigos postales admitidos, separados por comas')} value={input ?? remote.data?.zips.join(', ') ?? ''} onChange={setInput} multiline />{task.feedback}<Action primary disabled={task.busy || !remote.data} label={t('Save service area', 'Guardar área de servicio')} onPress={() => void task.run(async () => { await put('/api/coverage', token, coverageSchema, { zips: (input ?? remote.data?.zips.join(',') ?? '').split(',').map(value => value.trim()).filter(Boolean) }); await remote.reload(); setInput(null); }, t('Service area saved.', 'Área de servicio guardada.'))} /></Screen>;
}
