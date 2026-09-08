import { useEffect, useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { Action, styles } from '../chat/ui';
import { errorMessage, get } from '../platform/api';
import { activitySchema } from './contracts';
import type { ActivityData, ActivityMedia, Locale } from './contracts';

type ActivityProps = {
  readonly activity?: ActivityData;
  readonly locale: Locale;
  readonly busy?: boolean;
  readonly onRefresh?: () => void;
  readonly onOpenMedia?: (media: ActivityMedia) => void;
  readonly accessToken?: string;
  readonly requestId?: string;
  readonly revision?: object;
};
export function Activity({ activity, locale, busy = false, onRefresh, onOpenMedia, accessToken, requestId, revision }: ActivityProps) {
  const [remoteActivity, setRemoteActivity] = useState<ActivityData>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!accessToken || !requestId) return;
    let active = true;
    setError('');
    void get(`/api/requests/${encodeURIComponent(requestId)}/activity`, accessToken, activitySchema)
      .then((value) => { if (active) setRemoteActivity(value); })
      .catch((failure: unknown) => { if (active) setError(errorMessage(failure, locale)); });
    return () => { active = false; };
  }, [accessToken, requestId, revision, refresh, locale]);
  const displayedActivity = activity ?? remoteActivity;
  const t = (en: string, es: string) => locale === 'es' ? es : en;
  const groups = [
    ['before', t('Before', 'Antes')],
    ['after', t('After', 'Después')],
    ['receipt', t('Receipt', 'Recibo')],
    ['warranty', t('Warranty', 'Garantía')],
    ['during', t('Progress', 'Progreso')],
  ] as const;
  const openMedia = (item: ActivityMedia) => {
    if (onOpenMedia) return onOpenMedia(item);
    if (!accessToken || !requestId) return;
    void get(`/api/requests/${encodeURIComponent(requestId)}/activity`, accessToken, activitySchema).then(async (fresh) => {
      setRemoteActivity(fresh);
      const url = fresh.evidence.flatMap((evidence) => evidence.media).find((mediaItem) => mediaItem.id === item.id)?.url;
      if (!url || !await Linking.canOpenURL(url)) throw new Error(t('This evidence file cannot be opened.', 'No se puede abrir este archivo de prueba.'));
      await Linking.openURL(url);
    }).catch((failure: unknown) => setError(errorMessage(failure, locale)));
  };
  return <View style={styles.section}>
    <Text style={styles.heading}>{t('Work history', 'Historial del trabajo')}</Text>
    {!!error && <Text style={styles.danger}>{error}</Text>}
    <Action label={t('Refresh history and photos', 'Actualizar historial y fotos')} disabled={busy} onPress={onRefresh ?? (() => setRefresh((value) => value + 1))} />
    {displayedActivity?.acknowledgment && <Text style={styles.body}>{t('Completion confirmed', 'Finalización confirmada')}: {new Date(displayedActivity.acknowledgment.acceptedAt).toLocaleString(locale)}</Text>}
    {displayedActivity?.schedules.map((v) => <View key={v.id} style={styles.separator}><Text style={styles.body}>{v.status === 'confirmed' ? t('Confirmed visit', 'Visita confirmada') : t('Proposed visit', 'Visita propuesta')}: {new Date(v.startsAt).toLocaleString(locale)}</Text><Text style={styles.muted}>{new Date(v.changedAt).toLocaleString(locale)}</Text></View>)}
    {groups.map(([kind, label]) => {
      const items = displayedActivity?.evidence.filter((item) => item.kind === kind) ?? [];
      if (items.length === 0) return null;
      return <View key={kind} style={styles.separator}>
        <Text style={styles.heading}>{label}</Text>
        {items.map((item) => <View key={item.id} style={styles.separator}>
          {!!item.note && <Text style={styles.body}>{item.note}</Text>}
          <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString(locale)}</Text>
          {item.media.map((file) => <View key={file.id}>
            {file.contentType.startsWith('image/') && <Image accessibilityLabel={file.fileName} source={{ uri: file.url }} style={{ width: '100%', height: 180 }} resizeMode="contain" />}
            <Action label={file.fileName} onPress={() => openMedia(file)} />
          </View>)}
        </View>)}
      </View>;
    })}
  </View>;
}
