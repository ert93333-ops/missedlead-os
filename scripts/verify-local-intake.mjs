import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
const qaSessionPath = resolve(root, "data", "local-qa-auth.json");
const qaEmail = "qa.customer@wecover.local";

function parseEnvText(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return [];
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = JSON.parse(value);
    }
    return [[match[1], value]];
  }));
}

function setEnvValues(values) {
  let source = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    source = pattern.test(source)
      ? source.replace(pattern, line)
      : `${source.trimEnd()}${source.trim() ? "\n" : ""}${line}\n`;
  }
  writeFileSync(envPath, source, { encoding: "utf8", mode: 0o600 });
}

function configureLocalEnv() {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "supabase";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "supabase status --output env"]
    : ["status", "--output", "env"];
  const status = execFileSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const local = parseEnvText(status);
  const apiUrl = local.API_URL;
  const anonKey = local.ANON_KEY;
  const serviceRoleKey = local.SERVICE_ROLE_KEY;
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase local status did not expose API_URL, ANON_KEY, and SERVICE_ROLE_KEY");
  }
  const url = new URL(apiUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== "56321") {
    throw new Error(`Refusing unexpected Supabase endpoint ${url.origin}`);
  }
  setEnvValues({
    PORT: "8787",
    SUPABASE_URL: url.origin,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    VITE_SUPABASE_URL: url.origin,
    VITE_SUPABASE_ANON_KEY: anonKey,
    PAYMENTS_ENABLED: "false",
    REQUIRE_SUPABASE_INTEGRATION: "1",
    SUPABASE_TEST_URL: url.origin,
    SUPABASE_TEST_ANON_KEY: anonKey,
    SUPABASE_TEST_SERVICE_ROLE_KEY: serviceRoleKey,
    INTEGRATION_API_URL: "http://127.0.0.1:8787",
  });
  console.log("local-env: configured (Supabase 56321, API 8787, payments disabled)");
}

async function provisionQaCustomer(env) {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const password = randomBytes(24).toString("base64url");
  let qaUser;
  for (let page = 1; !qaUser; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    qaUser = data.users.find((user) => user.email === qaEmail);
    if (data.users.length < 100) break;
  }
  if (qaUser) {
    const { data, error } = await admin.auth.admin.updateUserById(qaUser.id, {
      password,
      email_confirm: true,
      app_metadata: { ...qaUser.app_metadata, role: "customer" },
    });
    if (error) throw error;
    qaUser = data.user;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: qaEmail,
      password,
      email_confirm: true,
      app_metadata: { role: "customer" },
    });
    if (error) throw error;
    qaUser = data.user;
  }
  if (!qaUser) throw new Error("Local QA user provisioning failed");
  const { error: profileError } = await admin.from("profiles").upsert({
    id: qaUser.id,
    role: "customer",
    display_name: "Local QA Customer",
  });
  if (profileError) throw profileError;

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: qaEmail, password });
  if (error || !data.session) throw error ?? new Error("Local QA session was not created");
  persistQaSession(env.SUPABASE_URL, password, data.session);
  console.log("qa-auth: provisioned customer session (credentials stored in ignored data file)");
}

function persistQaSession(supabaseUrl, password, session) {
  mkdirSync(resolve(root, "data"), { recursive: true });
  const hostname = new URL(supabaseUrl).hostname;
  const storageKey = `sb-${hostname.split(".")[0]}-auth-token`;
  const storageValue = {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  writeFileSync(qaSessionPath, `${JSON.stringify({
    email: qaEmail,
    password,
    storageKey,
    storageValue,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function verifyLocalRuntime(env) {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
  ];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing local variables: ${missing.join(", ")}`);
  const url = new URL(env.SUPABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== "56321") {
    throw new Error(`Unexpected Supabase URL ${url.origin}`);
  }
  if (env.PAYMENTS_ENABLED !== "false") throw new Error("PAYMENTS_ENABLED must remain false");
  const health = await fetch(`${url.origin}/auth/v1/health`, {
    headers: { apikey: env.SUPABASE_ANON_KEY },
  });
  if (!health.ok) throw new Error(`Supabase Auth health failed (${health.status})`);
  if (!existsSync(qaSessionPath)) throw new Error("Missing data/local-qa-auth.json; run with --provision");
  const saved = JSON.parse(readFileSync(qaSessionPath, "utf8"));
  const client = createClient(url.origin, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.setSession({
    access_token: saved.storageValue.access_token,
    refresh_token: saved.storageValue.refresh_token,
  });
  if (error || !data.session) throw error ?? new Error("Local QA session refresh failed");
  if (data.user.app_metadata?.role !== "customer") throw new Error("Local QA app_metadata role is not customer");
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id,role")
    .eq("id", data.user.id)
    .single();
  if (profileError || profile?.role !== "customer") {
    throw profileError ?? new Error("Local QA customer profile is missing");
  }
  persistQaSession(url.origin, saved.password, data.session);
  console.log("runtime-check: Supabase Auth healthy; QA token refresh and customer profile verified");
}

if (process.argv.includes("--configure")) configureLocalEnv();
config({ path: envPath, override: true, quiet: true });
if (process.argv.includes("--provision")) await provisionQaCustomer(process.env);
await verifyLocalRuntime(process.env);
