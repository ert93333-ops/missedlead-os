/**
 * 네이티브 결제 래퍼: publishable key가 있을 때만 StripeProvider를 감싼다(없으면 통과).
 */
import { StripeProvider } from '@stripe/stripe-react-native';
import type { ReactNode } from 'react';
import { paymentProviderConfigured, stripePublishableKey } from './config';
export function Payments({children}:{readonly children:ReactNode}) {
  return paymentProviderConfigured ? <StripeProvider publishableKey={stripePublishableKey} urlScheme="wecover"><>{children}</></StripeProvider> : <>{children}</>;
}
