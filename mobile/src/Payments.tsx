import { StripeProvider } from '@stripe/stripe-react-native';
import type { ReactNode } from 'react';
import { paymentProviderConfigured, stripePublishableKey } from './config';
export function Payments({children}:{readonly children:ReactNode}) {
  return paymentProviderConfigured ? <StripeProvider publishableKey={stripePublishableKey} urlScheme="wecover"><>{children}</></StripeProvider> : <>{children}</>;
}
