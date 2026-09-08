import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

if (!process.argv.includes("--live-ai")) throw new Error("Pass --live-ai to run two real model requests using the configured provider.");
const base = "http://127.0.0.1:8787";
const saved = JSON.parse(readFileSync(new URL("../data/local-qa-auth.json", import.meta.url), "utf8"));
const headers = { Authorization: `Bearer ${saved.storageValue.access_token}` };
const capabilities = await fetch(`${base}/api/capabilities`, { signal: AbortSignal.timeout(10_000) });
assert.equal(capabilities.status, 200);
assert.equal((await capabilities.json()).payments.enabled, false);

const form = new FormData();
form.append("payload", JSON.stringify({ locale: "en", history: [{ role: "user", content: "The kitchen sink drain drips into the cabinet only when I run the tap. There is no smoke, no gas smell, no exposed wiring, and no flooding. What detail should I check or photograph?" }] }));
const analyzed = await fetch(`${base}/api/intake/analyze`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(60_000) });
const assessment = await analyzed.json();
assert.equal(analyzed.status, 200, `Analysis failed: HTTP ${analyzed.status}, ${assessment.error ?? "unknown error"}`);
assert.equal(assessment.locale, "en");
assert.ok(assessment.issueCandidates.length > 0);
assert.ok(assessment.reply.length > 0);
assert.notEqual(assessment.safety.level, "emergency");
assert.ok(assessment.assessmentToken);

const translated = await fetch(`${base}/api/intake/translate`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ text: "The diagnostic visit costs $85. The final repair quote requires my approval.", sourceLocale: "en", targetLocale: "es" }), signal: AbortSignal.timeout(60_000) });
const translation = await translated.json();
assert.equal(translated.status, 200, `Translation failed: HTTP ${translated.status}, ${translation.error ?? "unknown error"}`);
assert.match(translation.translated, /85/);
assert.equal(translation.sourceLocale, "en");
assert.equal(translation.targetLocale, "es");
assert.ok(translation.original);
assert.ok(translation.warning);

const evidence = { checkedAt: new Date().toISOString(), provider: "gemini", realModelRequests: 2, analysis: { httpStatus: analyzed.status, locale: assessment.locale, category: assessment.category, candidateCount: assessment.issueCandidates.length, questionCount: assessment.questions.length, safety: assessment.safety.level, reply: assessment.reply }, translation: { httpStatus: translated.status, original: translation.original, translated: translation.translated, warning: translation.warning }, paymentsEnabled: false };
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("../artifacts/intake-live-smoke.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ analysis: "passed", translation: "passed", realModelRequests: 2, paymentsEnabled: false }));
