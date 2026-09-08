export function publicMediaUrl(value: string, env: NodeJS.ProcessEnv = process.env): string {
 if (!env.PUBLIC_APP_URL || !env.SUPABASE_URL) return value;
 const media = new URL(value);
 const storage = new URL(env.SUPABASE_URL);
 const app = new URL(env.PUBLIC_APP_URL);
 if (app.protocol !== 'https:' || media.origin !== storage.origin || !media.pathname.startsWith('/storage/v1/object/sign/')) return value;
 return new URL('/supabase' + media.pathname + media.search, app).toString();
}
