/**
 * PUBLIC_APP_URL이 https이고 스토리지 서명 URL이면 앱 오리진으로 재작성해 반환한다.
 * 외부 링크/이메일에서 미디어가 열리도록 하는 헬퍼.
 */
export function publicMediaUrl(value: string, env: NodeJS.ProcessEnv = process.env): string {
 if (!env.PUBLIC_APP_URL || !env.SUPABASE_URL) return value;
 const media = new URL(value);
 const storage = new URL(env.SUPABASE_URL);
 const app = new URL(env.PUBLIC_APP_URL);
 if (app.protocol !== 'https:' || media.origin !== storage.origin || !media.pathname.startsWith('/storage/v1/object/sign/')) return value;
 return new URL('/supabase' + media.pathname + media.search, app).toString();
}
