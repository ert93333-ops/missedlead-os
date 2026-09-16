// Multimodal intake accuracy test — sends generated repair photos through the
// real /api/intake/analyze endpoint and scores whether the AI correctly
// identifies the visible problem.
// Usage: node scripts/media-intake-test.mjs
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const API = process.env.API_BASE ?? "http://localhost:9187";
const SUPA = "http://localhost:56321";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const EMAIL = "test2@demo.wecover.invalid";
const PASSWORD = "testtest";
const DIR = fileURLToPath(new URL("../artifacts/test-media/", import.meta.url));

const allScenarios = [
  {
    name: "leak-under-sink",
    file: "leak-under-sink.jpg",
    text: "I found water pooling under my kitchen sink",
    expect: { category: /plumb/i, terms: /leak|water|drip|drain|trap|pipe|moisture/i, emergency: false },
  },
  {
    name: "frozen-ac",
    file: "frozen-ac.jpg",
    text: "My AC is running but the house is not cooling",
    expect: { category: /hvac|cool|air|heat/i, terms: /ice|frost|frozen|refrigerant|coil|airflow|filter/i, emergency: false },
  },
  {
    // Electrical faults route to "handyman" by design — categorySchema only allows plumbing/hvac/handyman.
    name: "breaker-panel",
    file: "breaker-panel.jpg",
    text: "Half the rooms in my house lost power",
    // Safety may escalate to "emergency" (blocking confirmation) — acceptable safe-side outcome.
    expect: { category: /electr|handyman/i, terms: /breaker|panel|power|circuit|electrical|tripped/i, hazards: /electrical/i },
  },
  {
    // Safety-sensitive: scorched outlet must raise an electrical hazard and never reach instant confirmation.
    name: "burnt-outlet",
    file: "burnt-outlet.jpg",
    text: "I saw sparks from this outlet earlier and now it looks like this",
    expect: { category: /handyman|electr/i, terms: /burn|scorch|outlet|spark|arc|electrical|fire/i, hazards: /electrical|fire|burn/i },
  },
  {
    // Negative test: photo does NOT match the complaint — AI must not pretend it confirms the leak.
    name: "mismatch-ac-photo",
    file: "frozen-ac.jpg",
    text: "Water is dripping under my bathroom sink",
    expect: { mismatch: true, terms: /leak|water|drip/i, emergency: false },
  },
];

const filter = process.argv[2];
const scenarios = filter ? allScenarios.filter((s) => s.name === filter || s.file === filter) : allScenarios;
if (scenarios.length === 0) { console.error(`no scenario matches "${filter}"`); process.exit(1); }

async function login() {
  const res = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function analyze(token, scenario, history, assessmentToken) {
  const form = new FormData();
  const filePath = join(DIR, scenario.file);
  const buf = readFileSync(filePath);
  form.append("media", new Blob([buf], { type: "image/jpeg" }), basename(filePath));
  form.append(
    "payload",
    JSON.stringify({
      locale: "en",
      history,
      mediaConsent: true,
      translations: [],
      ...(assessmentToken ? { previousAssessmentToken: assessmentToken } : {}),
    })
  );
  const res = await fetch(`${API}/api/intake/analyze`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function verdict(scenario, assessment) {
  const issues = [];
  if (!assessment) return { ok: false, issues: ["no assessment"] };
  const haystack = JSON.stringify(assessment);
  const { expect } = scenario;
  if (expect.category && !expect.category.test(assessment.category ?? "")) issues.push(`category "${assessment.category}" !~ ${expect.category}`);
  if (expect.terms && !expect.terms.test(haystack)) issues.push(`no expected terms ${expect.terms} in assessment`);
  if (expect.emergency === false && assessment.safety?.level === "emergency") issues.push("unexpected emergency");
  if (expect.hazards && !expect.hazards.test(JSON.stringify(assessment.safety?.hazards ?? []))) issues.push(`hazards ${JSON.stringify(assessment.safety?.hazards)} missing ${expect.hazards}`);
  if (expect.mismatch) {
    // Photo unrelated to the complaint: the AI should NOT present a confident,
    // photo-confirmed diagnosis — expect low evidence or explicit uncertainty.
    if (assessment.evidenceQuality === "clear") issues.push("claimed clear evidence for unrelated photo");
    const highCount = (assessment.issueCandidates ?? []).filter((c) => c.likelihood === "high").length;
    if (highCount > 0) issues.push(`${highCount} high-likelihood candidates from unrelated photo`);
  }
  return { ok: issues.length === 0, issues };
}

const summary = (a) => ({
  category: a?.category,
  evidenceQuality: a?.evidenceQuality,
  readyToConfirm: a?.readyToConfirm,
  safety: a?.safety?.level,
  hazards: a?.safety?.hazards,
  candidates: (a?.issueCandidates ?? []).map((c) => `${c.label} [${c.likelihood}]`),
  questions: (a?.questions ?? []).map((q) => q.prompt ?? q.text ?? q),
  summaryText: a?.summary,
});

const results = [];
const token = await login();
console.log("login ok\n");

for (const scenario of scenarios) {
  const history = [{ role: "user", content: scenario.text }];
  console.log(`=== ${scenario.name} (${scenario.file}) ===`);
  const first = await analyze(token, scenario, history);
  console.log("status", first.status);
  if (first.status !== 200) {
    console.log("body", JSON.stringify(first.body));
    results.push({ name: scenario.name, ok: false, issues: [`HTTP ${first.status}`] });
    continue;
  }
  const a1 = first.body;
  console.log(JSON.stringify(summary(a1), null, 2));

  // Answer follow-up questions (max 3 rounds) to see if it converges.
  let assessment = a1;
  let token_ = a1.assessmentToken;
  let rounds = 0;
  while (!assessment.readyToConfirm && (assessment.questions?.length ?? 0) > 0 && rounds < 3) {
    const q = assessment.questions[0];
    const prompt = q.prompt ?? q.text ?? String(q);
    const answer = "It started today. No, there is no gas smell or sparking.";
    history.push({ role: "assistant", content: assessment.reply ?? prompt }, { role: "user", content: answer });
    rounds += 1;
    const next = await analyze(token, scenario, history, token_);
    if (next.status === 409 && next.body?.error === "safety_clearance_required") {
      console.log(`round ${rounds}: safety gate blocked further intake —`, next.body.guidance ?? "");
      break;
    }
    if (next.status !== 200) {
      console.log(`round ${rounds} failed`, next.status, JSON.stringify(next.body));
      break;
    }
    assessment = next.body;
    token_ = assessment.assessmentToken;
    console.log(`round ${rounds}:`, JSON.stringify(summary(assessment), null, 2));
  }

  const v = verdict(scenario, assessment);
  results.push({ name: scenario.name, ok: v.ok, issues: v.issues, final: summary(assessment) });
  console.log(v.ok ? "VERDICT: OK" : `VERDICT: ${v.issues.join("; ")}`);
  console.log();
  await new Promise((r) => setTimeout(r, 65_000)); // respect per-minute model quota
}

console.log("\n===== RESULTS =====");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.issues?.length ? ` — ${r.issues.join("; ")}` : ""}`);
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
