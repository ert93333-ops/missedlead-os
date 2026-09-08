import { Text, View } from 'react-native';
import { styles } from '../chat/ui';
import type { Locale } from './contracts';

export function PaymentButton({ locale }: { readonly accessToken: string; readonly requestId: string; readonly quoteId?: string; readonly locale: Locale; readonly onResult: (message: string) => void }) {
  return <View style={styles.warning}><Text style={styles.body}>{locale === 'es' ? 'Los pagos no están disponibles en esta versión web. La configuración de Stripe está pendiente.' : 'Payments are unavailable in this web version. Stripe setup is pending.'}</Text></View>;
}
