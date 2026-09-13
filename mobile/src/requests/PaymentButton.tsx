/**
 * 네이티브 결제 버튼: clientSecret 발급 후 Stripe 결제 시트를 연다(결제 비활성 시 서버가 거부).
 */
import { useState } from 'react';
import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { z } from 'zod';
import { Action } from '../chat/ui';
import { apiUrl } from '../config';
import { ApiError, errorMessage } from '../platform/api';
import type { Locale } from './contracts';

const paymentSchema = z.object({ clientSecret: z.string().min(1) });
export function PaymentButton({ accessToken, requestId, quoteId, locale, onResult }: { readonly accessToken: string; readonly requestId: string; readonly quoteId?: string; readonly locale: Locale; readonly onResult: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => `mobile-${requestId}-${quoteId ?? 'balance'}-${Date.now()}`);
  const pay = async () => {
    setBusy(true);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 30000);
    try {
      const response = await fetch(`${apiUrl}/api/requests/${encodeURIComponent(requestId)}/${quoteId ? 'deposit' : 'balance'}`, { method: 'POST', signal: timeout.signal, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(quoteId ? { quoteId } : {}) });
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(await response.json());
        throw new ApiError(response.status, failure.success ? failure.data.error : 'payment_unavailable');
      }
      const payment = paymentSchema.parse(await response.json());
      const initialized = await initPaymentSheet({ merchantDisplayName: 'WeCover', paymentIntentClientSecret: payment.clientSecret, returnURL: 'wecover://stripe-redirect' });
      if (initialized.error) throw new Error(initialized.error.localizedMessage);
      const result = await presentPaymentSheet();
      if (result.error) {
        if (result.error.code === 'Canceled') return;
        throw new Error(result.error.localizedMessage);
      }
      onResult(locale === 'es' ? 'Pago enviado. Actualiza para ver la confirmación del banco.' : 'Payment submitted. Refresh to see the bank confirmation.');
    } catch (error) { onResult(errorMessage(error, locale)); }
    finally { clearTimeout(timer); setBusy(false); }
  };
  return <Action primary disabled={busy} label={locale === 'es' ? 'Continuar al pago seguro' : 'Continue to secure payment'} onPress={() => { void pay(); }} />;
}
