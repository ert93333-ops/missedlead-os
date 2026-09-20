/**
 * Persona usage matrix — live API checks across customer / provider / operator.
 * Covers auth boundaries, role enforcement, validation, state transitions,
 * cross-tenant isolation, and edge cases. Run against the local stack:
 *   API http://localhost:8787 + local Supabase :56321
 * Usage: node scripts/persona-matrix-api.mjs
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true, override: true });

const API = process.env.API_URL ?? "http://localhost:8787";
const SUPA = process.env.SUPABASE_URL ?? "http://localhost:56321";
const ANON = process.env.SUPABASE_ANON_KEY;

const results = [];
let section = "";
function sec(name) { section = name; }
function check(name, cond, detail = "") {
  results.push({ section, name, ok: Boolean(cond), detail: String(detail).slice(0, 160) });
  if (!cond) console.log(`FAIL  [${section}] ${name} :: ${String(detail).slice(0, 120)}`);
}
async function api(method, path, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json };
}
async function login(email) {
  const res = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "testtest" }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`login failed for ${email}: ${JSON.stringify(j).slice(0, 120)}`);
  return j.access_token;
}

const [op, cu, pv, pvNew] = await Promise.all([
  login("test1@demo.wecover.invalid"),
  login("test2@demo.wecover.invalid"),
  login("test3@demo.wecover.invalid"),
  login("test4@demo.wecover.invalid"),
]);
console.log("logins ok");

// ============ A. Unauthenticated boundaries ============
sec("A. unauth");
for (const [m, p] of [
  ["GET", "/api/dashboard"], ["GET", "/api/me"], ["GET", "/api/coverage"],
  ["POST", "/api/requests"], ["GET", "/api/providers/application"],
  ["PUT", "/api/providers/application"], ["GET", "/api/providers/applications"],
  ["GET", "/api/ops/readiness"], ["GET", "/api/ops/recovery"],
  ["GET", "/api/notifications"], ["GET", "/api/care"],
  ["GET", "/api/business/organizations"], ["GET", "/api/properties"],
  ["GET", "/api/safety-reports"], ["POST", "/api/privacy/consent"],
  ["POST", "/api/privacy/deletion"], ["POST", "/api/intake/analyze"],
  ["POST", "/api/intake/confirm"], ["POST", "/api/intake/translate"],
]) {
  const r = await api(m, p, { body: m === "GET" ? undefined : {} });
  check(`unauth ${m} ${p} -> 401`, r.status === 401, `${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
}
{
  const r = await api("GET", "/api/dashboard", { token: "bad.token.here" });
  check("garbage token -> 401", r.status === 401, `${r.status}`);
  const r2 = await api("GET", "/api/capabilities");
  check("capabilities is public", r2.status === 200 && r2.json.payments, `${r2.status}`);
  const r3 = await api("GET", "/api/health");
  check("health endpoint reachable", [200, 401].includes(r3.status), `${r3.status}`);
}

// ============ B. Role enforcement matrix ============
sec("B. role matrix");
const roleCases = [
  // [token, method, path, body, expectStatus, why]
  [cu, "GET", "/api/ops/readiness", undefined, 403, "customer -> ops readiness"],
  [pv, "GET", "/api/ops/readiness", undefined, 403, "provider -> ops readiness"],
  [cu, "PUT", "/api/operators/providers/x/eligibility", { status: "pending", organizationName: "x", licenseVerified: false, licenseExpiresAt: "2030-01-01T00:00:00Z", insuranceVerified: false, insuranceExpiresAt: "2030-01-01T00:00:00Z", serviceCategories: ["plumbing"], serviceAreas: ["Charlotte"] }, 403, "customer -> eligibility"],
  [pv, "GET", "/api/providers/applications", undefined, 403, "provider -> applications list"],
  [cu, "GET", "/api/providers/applications", undefined, 403, "customer -> applications list"],
  [cu, "POST", "/api/providers/applications/x/review", { decision: "approve" }, [400, 403], "customer -> review"],
  [cu, "POST", "/api/requests/x/match", { providerIds: ["p1"] }, 403, "customer -> match"],
  [pv, "POST", "/api/requests/x/match", { providerIds: ["p1"] }, 403, "provider -> match"],
  [cu, "POST", "/api/requests/x/provider-slot", { providerId: "p1" }, 403, "customer -> slot"],
  [op, "POST", "/api/requests", { customerName: "x", description: "0123456789", address: "123 Main", hazards: ["none"] }, 403, "operator -> create request"],
  [pv, "POST", "/api/requests", { customerName: "x", description: "0123456789", address: "123 Main", hazards: ["none"] }, 403, "provider -> create request"],
  [cu, "POST", "/api/requests/x/quotes", { providerName: "p", scope: "12345", amountCents: 100, ranking: { totalCents: 100, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: 0 } }, 403, "customer -> quote"],
  [cu, "POST", "/api/providers/requests/x/respond", { action: "accept" }, [400, 403], "customer -> respond"],
  [cu, "POST", "/api/requests/x/evidence", { kind: "before", note: "abc" }, 403, "customer -> evidence"],
  [cu, "POST", "/api/requests/x/changes", { description: "abc", amountCents: 0, items: [{ description: "x", quantity: 1, unitCents: 0 }], evidenceIds: ["e1"] }, 403, "customer -> change order"],
  [pv, "POST", "/api/changes/c1/approve", {}, 403, "provider -> approve change"],
  [cu, "POST", "/api/requests/x/start", {}, 403, "customer -> start job"],
  [cu, "POST", "/api/requests/x/complete", {}, 403, "customer -> complete job"],
  [pv, "POST", "/api/requests/x/disputes", { source: "internal", reason: "bad" }, 403, "provider -> dispute"],
  [cu, "POST", "/api/disputes/d1/resolve", {}, 403, "customer -> resolve dispute"],
  [cu, "POST", "/api/requests/x/settle", { authorizationToken: "00000000-0000-0000-0000-000000000000", authorizationVersion: 0, feeVersion: 0, feeRateBps: 0, feeAmountCents: 0 }, [403, 503], "customer -> settle"],
  [pv, "POST", "/api/requests/x/settlement-preflight", {}, [403, 503], "provider -> preflight"],
  [cu, "GET", "/api/ops/recovery", undefined, 403, "customer -> recovery"],
  [cu, "POST", "/api/ops/recovery/receivables/r1/resolve", {}, 403, "customer -> resolve receivable"],
  [pv, "POST", "/api/requests/x/reviews", { rating: 5, text: "good" }, 403, "provider -> review"],
  [op, "POST", "/api/requests/x/reviews", { rating: 5, text: "good" }, 403, "operator -> review"],
];
for (const [token, m, p, b, expect, why] of roleCases) {
  let r = await api(m, p, { token, body: b });
  if (r.status === 401 && r.json.error === "invalid_token") { await new Promise((s) => setTimeout(s, 800)); r = await api(m, p, { token, body: b }); } // transient JWT verify hiccup on local stack
  const ok = Array.isArray(expect) ? expect.includes(r.status) : r.status === expect;
  check(`${why} -> ${expect}`, ok, `${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
}

// ============ C. Validation matrix (customer paths) ============
sec("C. request validation");
const reqValid = { customerName: "Matrix Tester", description: "kitchen sink leaking under the cabinet", address: "123 Main St, Charlotte NC", hazards: ["none"] };
const reqBad = [
  [{}, "empty body"],
  [{ ...reqValid, customerName: "" }, "empty name"],
  [{ ...reqValid, description: "short" }, "description <10"],
  [{ ...reqValid, address: "ab" }, "address <3"],
  [{ ...reqValid, hazards: [] }, "no hazards"],
  [{ ...reqValid, hazards: ["bogus"] }, "bad hazard enum"],
  [{ ...reqValid, hazards: ["none", "gas"] }, "none+gas combo"],
  [{ ...reqValid, description: "<script>alert(1)</script>" }, "xss payload stored raw (escaped at render)"],
];
for (const [b, why] of reqBad) {
  const r = await api("POST", "/api/requests", { token: cu, body: b });
  const expectOk = why.startsWith("xss"); // XSS text is legal input; must be escaped at render
  check(`request: ${why}`, expectOk ? [200, 201].includes(r.status) : r.status === 400 || r.status === 422, `${r.status}`);
}
{
  const r = await api("POST", "/api/requests", { token: cu, body: { ...reqValid, hazards: ["gas"] } });
  const blocked = r.json.safety_status === "blocked" || r.json.safetyStatus === "blocked" || r.status === 422;
  check("hazard request created but safety-blocked", blocked, `${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
}
// valid request to reuse below
let reqId;
{
  const r = await api("POST", "/api/requests", { token: cu, body: reqValid });
  check("valid request created", [200, 201].includes(r.status) && r.json.id, `${r.status}`);
  reqId = r.json.id;
}

sec("C2. message validation");
for (const [b, expect, why] of [
  [{}, 400, "empty body"],
  [{ text: "" }, 400, "empty text"],
  [{ text: "x".repeat(2001) }, 400, "over 2000 chars"],
  [{ text: "call me at 704-555-1234" }, 201, "phone number masked?"],
  [{ text: "my email is a@b.com, ssn 123-45-6789" }, 201, "PII masked?"],
]) {
  const r = await api("POST", `/api/requests/${reqId}/messages`, { token: cu, body: b });
  check(`message: ${why}`, r.status === expect, `${r.status} ${JSON.stringify(r.json).slice(0, 90)}`);
  if (r.status === 201 && /555-1234|a@b\.com|123-45-6789/.test(r.json.text ?? "")) check(`message: ${why} actually masked`, false, `unmasked: ${r.json.text}`);
}

sec("C3. schedule validation");
for (const [b, expect, why] of [
  [{}, 400, "empty"],
  [{ startsAt: "not-a-date", timeZone: "America/New_York", status: "proposed" }, 400, "bad datetime"],
  [{ startsAt: "2030-01-01T10:00:00Z", timeZone: "", status: "proposed" }, 400, "empty tz"],
  [{ startsAt: "2030-01-01T10:00:00Z", timeZone: "America/New_York", status: "bogus" }, 400, "bad status"],
  [{ startsAt: "2030-01-01T10:00:00Z", timeZone: "America/New_York", status: "proposed" }, 200, "valid"],
]) {
  const r = await api("PUT", `/api/requests/${reqId}/schedule`, { token: cu, body: b });
  check(`schedule: ${why}`, r.status === expect, `${r.status}`);
}

sec("C4. privacy lifecycle");
{
  // fresh signup so consent state is clean every run
  const email = `matrix_${Date.now()}@demo.wecover.invalid`;
  const su = await fetch(`${SUPA}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "testtest" }) });
  const suJson = await su.json();
  const fresh = suJson.access_token;
  if (!fresh) check("fresh signup for privacy test", false, JSON.stringify(suJson).slice(0, 120));
  else {
    let r = await api("POST", "/api/privacy/deletion", { token: fresh, body: {} });
    check("deletion before consent -> 409", r.status === 409, `${r.status}`);
    r = await api("POST", "/api/privacy/consent", { token: fresh, body: { version: "1.0", accepted: false } });
    check("consent accepted=false -> 400", r.status === 400, `${r.status}`);
    r = await api("POST", "/api/privacy/consent", { token: fresh, body: { version: "1.0", accepted: true } });
    check("consent -> 201", r.status === 201, `${r.status}`);
    r = await api("POST", "/api/privacy/deletion", { token: fresh, body: {} });
    check("deletion after consent -> 202", r.status === 202, `${r.status}`);
  }
}

// ============ D. Provider persona ============
sec("D. provider");
{
  const r = await api("GET", "/api/dashboard", { token: pv });
  check("provider dashboard", r.status === 200 && Array.isArray(r.json.requests), `${r.status}`);
  const reqs = r.json.requests ?? [];
  check("provider sees matched requests", reqs.length > 0, `${reqs.length}`);
}
// quote validation on a matched request (find one)
{
  const dash = await api("GET", "/api/dashboard", { token: pv });
  const target = (dash.json.requests ?? []).find((r) => ["matched", "quoted"].includes(r.status ?? r.workflowStatus ?? r.workflow_status));
  if (target) {
    const rid = target.id;
    for (const [b, expect, why] of [
      [{}, 400, "empty"],
      [{ providerName: "p", scope: "s", amountCents: 100, ranking: { totalCents: 100, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: 0 } }, 400, "scope <5"],
      [{ providerName: "p", scope: "12345", amountCents: 0, ranking: { totalCents: 0, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: 0 } }, 400, "amount 0"],
      [{ providerName: "p", scope: "12345", amountCents: -5, ranking: { totalCents: -5, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: 0 } }, 400, "negative amount"],
      [{ providerName: "p", scope: "12345", amountCents: 100000000, ranking: { totalCents: 100000000, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: 0 } }, 400, "amount over cap"],
      [{ providerName: "p", scope: "12345", amountCents: 100, ranking: { totalCents: 200, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: 0 } }, 400, "ranking total mismatch"],
      [{ providerName: "p", scope: "12345", amountCents: 100, ranking: { totalCents: 100, earliestStartAt: "bad", warrantyDays: 0 } }, 400, "bad earliestStartAt"],
      [{ providerName: "p", scope: "12345", amountCents: 100, ranking: { totalCents: 100, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: -1 } }, 400, "negative warranty"],
      [{ providerName: "p", scope: "12345", amountCents: 100, ranking: { totalCents: 100, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: 30, rating: 6 } }, 400, "rating >5"],
    ]) {
      const r = await api("POST", `/api/requests/${rid}/quotes`, { token: pv, body: b });
      check(`quote: ${why}`, r.status === expect, `${r.status}`);
    }
  } else check("provider has matched/quoted request to test", false, "none found");
}
// respond on random id
{
  const r = await api("POST", "/api/requests/nonexistent/respond", { token: pv, body: { action: "accept" } });
  check("respond to unknown request -> 404", r.status === 404, `${r.status}`);
  const r2 = await api("POST", "/api/requests/nonexistent/respond", { token: pv, body: { action: "bogus" } });
  check("respond bad action -> 400/404", [400, 404].includes(r2.status), `${r2.status}`);
}
// application read/update
{
  const r = await api("GET", "/api/providers/application", { token: pv });
  check("provider application readable", [200, 404].includes(r.status), `${r.status}`);
  const r2 = await api("PUT", "/api/providers/application", { token: pv, body: { businessName: "", licenseNumber: "", serviceCategories: [], serviceAreas: [] } });
  check("application bad body -> 400", r2.status === 400, `${r2.status}`);
}

// ============ E. Operator persona ============
sec("E. operator");
{
  const r = await api("GET", "/api/ops/readiness", { token: op });
  check("operator readiness (503 ok when payments blocked)", [200, 503].includes(r.status), `${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  const d = await api("GET", "/api/dashboard", { token: op });
  check("operator dashboard", d.status === 200, `${d.status}`);
  const apps = await api("GET", "/api/providers/applications", { token: op });
  check("applications list", apps.status === 200 && Array.isArray(apps.json.applications ?? apps.json), `${apps.status}`);
  const rec = await api("GET", "/api/ops/recovery", { token: op });
  check("recovery list", rec.status === 200, `${rec.status}`);
  const notif = await api("GET", "/api/notifications", { token: op });
  check("notifications", notif.status === 200, `${notif.status}`);
}
{
  // match on nonexistent request
  const r = await api("POST", "/api/requests/nonexistent/match", { token: op, body: { providerIds: ["p"] } });
  check("match unknown request -> 404/409", [404, 409].includes(r.status), `${r.status}`);
  // match with >3 providers -> schema rejects
  const r2 = await api("POST", `/api/requests/${reqId}/match`, { token: op, body: { providerIds: ["a", "b", "c", "d"] } });
  check("match >3 providers -> 400/409", [400, 409].includes(r2.status), `${r2.status}`);
  // resolve nonexistent receivable/dispute
  const r3 = await api("POST", "/api/ops/recovery/receivables/nope/resolve", { token: op, body: {} });
  check("resolve unknown receivable -> 404/409", [404, 409].includes(r3.status), `${r3.status}`);
  const r4 = await api("POST", "/api/disputes/nope/resolve", { token: op, body: {} });
  check("resolve unknown dispute -> 404/409", [404, 409].includes(r4.status), `${r4.status}`);
}

// ============ F. Cross-tenant isolation ============
sec("F. cross-tenant");
{
  // provider quoting a request they aren't matched to
  const r = await api("POST", `/api/requests/${reqId}/quotes`, { token: pv, body: { providerName: "p", scope: "12345", amountCents: 100, ranking: { totalCents: 100, earliestStartAt: "2030-01-01T00:00:00Z", warrantyDays: 0 } } });
  check("unmatched provider quote -> 403", r.status === 403, `${r.status}`);
  // operator reading another provider's documents id
  const r2 = await api("GET", "/api/providers/documents/nonexistent", { token: op });
  check("unknown document -> 400/404", [400, 404].includes(r2.status), `${r2.status}`);
  // customer messaging a request that doesn't exist
  const r3 = await api("POST", "/api/requests/nonexistent/messages", { token: cu, body: { text: "hi" } });
  check("message unknown request -> 403/404/409", [403, 404, 409].includes(r3.status), `${r3.status}`);
}

// ============ G. Intake edge cases (no AI spend) ============
sec("G. intake edge");
{
  const r = await api("POST", "/api/intake/confirm", { token: cu, body: {} });
  check("confirm empty -> 400", r.status === 400, `${r.status}`);
  const r2 = await api("POST", "/api/intake/confirm", { token: cu, body: { assessmentToken: "forged.token.value" } });
  check("confirm forged token -> 4xx", r2.status >= 400 && r2.status < 500, `${r2.status}`);
  const r3 = await api("POST", "/api/intake/translate", { token: cu, body: {} });
  check("translate empty -> 400", r3.status === 400, `${r3.status}`);
  // media list on nonexistent request
  const r4 = await api("GET", "/api/requests/nonexistent/intake-media", { token: cu });
  check("media unknown request -> 403/404", [403, 404].includes(r4.status), `${r4.status}`);
  // safety endpoint is public and immediate
  const r5 = await api("POST", "/api/intake/safety", { body: {} });
  check("safety endpoint rejects bad payload", [400, 422].includes(r5.status), `${r5.status} ${JSON.stringify(r5.json).slice(0, 80)}`);
}

// ============ H. Misc feature surfaces ============
sec("H. features");
{
  const r = await api("GET", "/api/coverage", { token: pv });
  check("provider coverage get", [200, 404].includes(r.status), `${r.status}`);
  const r2 = await api("GET", "/api/properties", { token: cu });
  check("customer properties", [200].includes(r2.status), `${r2.status}`);
  const r3 = await api("POST", "/api/properties", { token: cu, body: {} });
  check("property bad body -> 400", r3.status === 400, `${r3.status}`);
  const r4 = await api("GET", "/api/reference-price", { token: cu });
  check("reference price", [200, 400, 404].includes(r4.status), `${r4.status}`);
  const r5 = await api("GET", "/api/safety-reports", { token: op });
  check("safety reports (op)", [200].includes(r5.status), `${r5.status}`);
  const r6 = await api("GET", "/api/care", { token: cu });
  check("care bundles", [200].includes(r6.status), `${r6.status}`);
  const r7 = await api("GET", "/api/business/organizations", { token: cu });
  check("business orgs", [200].includes(r7.status), `${r7.status}`);
  const r8 = await api("POST", "/api/requests/x/deposit", { token: cu, body: {} });
  check("deposit while payments disabled -> 4xx/5xx fail-closed", r8.status >= 400, `${r8.status} ${JSON.stringify(r8.json).slice(0, 80)}`);
  const r9 = await api("POST", "/api/webhooks/stripe", { raw: true, body: "{}", headers: { "Content-Type": "application/json" } });
  check("stripe webhook unsigned -> 4xx", r9.status >= 400, `${r9.status}`);
  const r10 = await api("POST", "/api/demo/login", { body: { email: "test2@demo.wecover.invalid", password: "wrong" } });
  check("demo login wrong pw", [400, 401, 403, 404].includes(r10.status), `${r10.status}`);
}

// ============ Report ============
const fails = results.filter((r) => !r.ok);
console.log(`\n===== PERSONA MATRIX: ${results.length - fails.length}/${results.length} pass =====`);
if (fails.length) {
  const bySec = {};
  for (const f of fails) (bySec[f.section] ??= []).push(f);
  for (const [s, list] of Object.entries(bySec)) {
    console.log(`\n${s}:`);
    for (const f of list) console.log(`  FAIL ${f.name} :: ${f.detail}`);
  }
}
