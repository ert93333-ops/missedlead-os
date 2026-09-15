/**
 * 고정 테스트 계정 시드: test1=운영자, test2=고객, test3=기사 — 비밀번호 testtest.
 * 로컬 Supabase(56321) + DEMO_MODE=true에서만 동작.
 * 운영자는 demo_isolation이 is_demo+operator 조합을 막으므로 is_demo=false로 둔다.
 * 실행: node scripts/seed-test-accounts.mjs
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: [".env.local", ".env"], quiet: true, override: true });
if (process.env.DEMO_MODE !== "true") throw new Error("DEMO_MODE must explicitly be true");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration missing");
const endpoint = new URL(url);
if (!["127.0.0.1", "localhost"].includes(endpoint.hostname) || endpoint.port !== "56321") throw new Error("Refusing non-project demo database");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PASSWORD = "testtest";
const accounts = [
  { email: "test1@demo.wecover.invalid", name: "Test Operator", role: "operator", demo: false },
  { email: "test2@demo.wecover.invalid", name: "Test Customer", role: "customer", demo: true },
  { email: "test3@demo.wecover.invalid", name: "Test Provider", role: "provider", demo: true },
];

const users = [];
for (let page = 1; ; page++) {
  const result = await client.auth.admin.listUsers({ page, perPage: 1000 });
  if (result.error) throw new Error("Unable to inspect accounts: " + result.error.message);
  users.push(...result.data.users);
  if (result.data.users.length < 1000) break;
}

for (const account of accounts) {
  const existing = users.find((user) => user.email === account.email);
  const attrs = { email: account.email, password: PASSWORD, email_confirm: true, app_metadata: { role: account.role, demo: account.demo }, user_metadata: { display_name: account.name } };
  const result = existing ? await client.auth.admin.updateUserById(existing.id, attrs) : await client.auth.admin.createUser(attrs);
  if (result.error || !result.data.user) throw new Error(`${account.email}: ${result.error?.message ?? "no user"}`);
  const id = result.data.user.id;
  const profile = { id, role: account.role, display_name: account.name, is_demo: account.demo };
  if (account.role === "provider") Object.assign(profile, { organization_name: account.name, provider_status: "approved", license_verified: true, license_expires_at: "2099-01-01T00:00:00Z", insurance_verified: true, insurance_expires_at: "2099-01-01T00:00:00Z", service_categories: ["plumbing", "hvac", "handyman"], service_areas: ["Charlotte", "28202"] });
  const saved = await client.from("profiles").upsert(profile);
  if (saved.error) throw new Error(`${account.email} profile: ${saved.error.message}`);
  if (account.role === "operator") {
    const allow = await client.from("operator_allowlist").upsert({ user_id: id });
    if (allow.error) throw new Error(`${account.email} allowlist: ${allow.error.message}`);
  }
  console.log(`${account.email} -> ${account.role} (${id})`);
}
console.log("Done. All passwords: testtest");
