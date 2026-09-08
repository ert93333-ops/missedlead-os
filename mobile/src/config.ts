import { z } from 'zod';

const loopbackHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '::1' ||
  hostname === '[::1]' ||
  hostname === '0.0.0.0' ||
  hostname.startsWith('127.');

export function endpointConfigurationIsValid(api: string, supabase: string, development: boolean): boolean {
  const parse = (value: string) => {
    const parsed = z.string().url().safeParse(value);
    if (!parsed.success) return null;
    const url = new URL(parsed.data);
    if (url.username || url.password) return null;
    if (!development && (url.protocol !== 'https:' || loopbackHost(url.hostname))) return null;
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  };
  const apiAddress = parse(api);
  const supabaseAddress = parse(supabase);
  if (!apiAddress || !supabaseAddress) return false;
  // A development stack must not silently mix a local/HTTP service with a
  // release-like remote service. Release builds are HTTPS-only above.
  return !development ||
    (apiAddress.protocol === supabaseAddress.protocol &&
      loopbackHost(apiAddress.hostname) === loopbackHost(supabaseAddress.hostname));
}

const development = typeof __DEV__ !== 'undefined' && __DEV__;
export const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
export const configured = endpointConfigurationIsValid(apiUrl, supabaseUrl, development) && supabaseKey.length > 0;

export type AuthenticatedServerCapabilities = {
  readonly payments: {
    readonly enabled: boolean;
  };
};

// A publishable key configures the payment SDK; it never activates payment UI.
export const paymentProviderConfigured = stripePublishableKey.length > 0;
export const paymentUiEnabled = (capabilities: AuthenticatedServerCapabilities): boolean => capabilities.payments.enabled;
