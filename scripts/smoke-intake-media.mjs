import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import sharp from "sharp";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const authPath = resolve(root, "data", "local-qa-auth.json");
const statePath = resolve(root, "data", "intake-media-smoke-state.local.json");
const evidencePath = resolve(root, "artifacts", "intake-media-live-flow.json");
const apiUrl = "http://127.0.0.1:8787";
const scenario = "La bisagra superior de una puerta interior de armario, de 60 por 40 cm, está floja. La puerta chirría, roza el marco y se atasca. Está dentro del armario de cocina, el acceso está despejado y se prefiere una visita entre semana por la tarde. Es una reparación menor. No hay olor a gas, humo, fuego, cables expuestos, agua, inundación ni daño estructural. La foto y el video son archivos sintéticos creados solo para esta prueba.";
const safeAnswer = "Datos del escenario sintético: no hay gas, humo, fuego, electricidad expuesta, agua activa, inundación ni daño estructural. La puerta mide 60 por 40 cm, el acceso interior está despejado y se prefiere una visita entre semana por la tarde.";

const questionSchema = z.object({ id: z.string().min(1), prompt: z.string().min(1), requiredForSafety: z.boolean() });
const assessmentSchema = z.object({
  reply: z.string().min(1), category: z.enum(["plumbing", "hvac", "handyman"]), summary: z.string().min(3),
  issueCandidates: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), likelihood: z.enum(["low", "medium", "high"]), reason: z.string().min(1), evidenceNeeded: z.array(z.string()) })).min(1),
  questions: z.array(questionSchema), safety: z.object({ level: z.enum(["normal", "urgent", "emergency"]), hazards: z.array(z.string()), guidance: z.string() }),
  readyToConfirm: z.boolean(), assessmentToken: z.string().min(1), locale: z.literal("es"), uncertaintyWarning: z.string().optional(),
});
const historySchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }));
const fixtureSchema = z.object({ fileName: z.string().min(1), contentType: z.enum(["image/png", "video/mp4"]), path: z.string().min(1), base64: z.string().min(1) });
const attemptSchema = z.object({ at: z.string().datetime(), outcome: z.enum(["passed", "failed"]), httpStatus: z.number().int().optional(), error: z.string().optional() });
const stateSchema = z.object({
  aiCallsAttempted: z.number().int().nonnegative(), attempts: z.array(attemptSchema),
  activeRun: z.object({ id: z.string().uuid(), callsAttempted: z.number().int().nonnegative(), maxCalls: z.literal(3) }).optional(),
  fixtures: z.array(fixtureSchema).length(2).optional(),
  resume: z.object({ assessment: assessmentSchema, history: historySchema, initialQuestionCount: z.number().int().nonnegative(), optionalQuestionsSkipped: z.number().int().nonnegative(), safetyQuestionsAnswered: z.number().int().nonnegative() }).optional(),
});
const confirmSchema = z.object({ requestId: z.string().min(1), status: z.string().min(1), matchCount: z.number().int().nonnegative() });
const mediaSchema = z.object({ media: z.array(z.object({ id: z.string().min(1), fileName: z.string().min(1), contentType: z.enum(["image/png", "video/mp4"]), sizeBytes: z.number().int().positive(), url: z.string().url().optional(), expiresInSeconds: z.number().int().positive().optional() })) });

class SmokeError extends Error {
  constructor(message, detail = {}) { super(message); this.name = "SmokeError"; this.detail = detail; }
}

function loadState() {
  const parsed = existsSync(statePath) ? stateSchema.parse(JSON.parse(readFileSync(statePath, "utf8"))) : { aiCallsAttempted: 0, attempts: [] };
  if (!parsed.activeRun) parsed.activeRun = { id: randomUUID(), callsAttempted: 0, maxCalls: 3 };
  return parsed;
}

function saveState(state) {
  mkdirSync(resolve(root, "data"), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function fixtureBytes(records) {
  return records.map((item) => {
    const bytes = Buffer.from(item.base64, "base64");
    if (!existsSync(item.path)) writeFileSync(item.path, bytes, { flag: "wx" });
    if (!readFileSync(item.path).equals(bytes)) throw new SmokeError("Persisted synthetic fixture changed");
    return { fileName: item.fileName, contentType: item.contentType, bytes };
  });
}

async function loadOrCreateFixtures(state) {
  if (state.fixtures) return fixtureBytes(state.fixtures);
  const id = randomUUID();
  const pngPath = resolve(root, "data", `${id}-hinge.png`);
  const mp4Path = resolve(root, "data", `${id}-hinge.mp4`);
  mkdirSync(resolve(root, "data"), { recursive: true });
  await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: 184, g: 126, b: 72 } } }).png().toFile(pngPath);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xB87E48:s=96x96:d=1:r=5", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4Path], { stdio: "pipe" });
  state.fixtures = [
    { fileName: `${id}-hinge.png`, contentType: "image/png", path: pngPath, base64: readFileSync(pngPath).toString("base64") },
    { fileName: `${id}-hinge.mp4`, contentType: "video/mp4", path: mp4Path, base64: readFileSync(mp4Path).toString("base64") },
  ];
  saveState(state);
  return fixtureBytes(state.fixtures);
}

async function jsonRequest(path, init, expectedStatuses) {
  const response = await fetch(`${apiUrl}${path}`, { ...init, signal: AbortSignal.timeout(90_000) });
  const body = await response.json();
  if (!expectedStatuses.includes(response.status)) throw new SmokeError(`Unexpected ${path} status`, { status: response.status, error: typeof body?.error === "string" ? body.error : "unknown" });
  return { status: response.status, body };
}

function appendMedia(form, fixtures) {
  for (const fixture of fixtures) form.append("media", new Blob([fixture.bytes], { type: fixture.contentType }), fixture.fileName);
}

async function analyze(accessToken, fixtures, payload, state) {
  if (state.activeRun.callsAttempted >= state.activeRun.maxCalls) throw new SmokeError("Active-run Gemini call limit reached");
  state.activeRun.callsAttempted += 1;
  state.aiCallsAttempted += 1;
  saveState(state);
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  appendMedia(form, fixtures);
  try {
    const result = await jsonRequest("/api/intake/analyze", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form }, [200]);
    const assessment = assessmentSchema.parse(result.body);
    state.attempts.push({ at: new Date().toISOString(), outcome: "passed", httpStatus: 200 });
    saveState(state);
    return assessment;
  } catch (error) {
    const detail = error instanceof SmokeError ? error.detail : {};
    state.attempts.push({ at: new Date().toISOString(), outcome: "failed", httpStatus: detail.status, error: typeof detail.error === "string" ? detail.error : "invalid_response" });
    saveState(state);
    throw error;
  }
}

function writeBlockedEvidence(state, reason, assessment) {
  const questions = assessment?.questions.map((item) => ({ prompt: item.prompt, requiredForSafety: item.requiredForSafety })) ?? [];
  const evidence = {
    generatedAt: new Date().toISOString(), status: reason,
    environment: { apiUrl, supabasePort: 56321, paymentsEnabled: false },
    fixture: { synthetic: true, scenario: "safe interior cabinet hinge", locale: "es", mediaTypes: ["image/png", "video/mp4"], preservedForResume: Boolean(state.fixtures) },
    llm: { provider: "Gemini through local WeCover API", actualCallsTotal: state.aiCallsAttempted, activeRunCalls: state.activeRun.callsAttempted, attempts: state.attempts, finalReadyToConfirm: assessment?.readyToConfirm ?? false, remainingQuestions: questions },
    downstream: { requestConfirmed: false, supabaseRequestCreated: false, mediaUploaded: false, signedReadVerified: false, duplicateUploadVerified: false },
    dataHandling: { tokensExcluded: true, emailsExcluded: true, addressesExcluded: true, secretsExcluded: true, externalMessagesSent: false, paymentsAttempted: false },
  };
  mkdirSync(resolve(root, "artifacts"), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function magicMatches(contentType, bytes) {
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return contentType === "video/mp4" && bytes.subarray(4, 8).toString("ascii") === "ftyp";
}

function cleanup(state) {
  for (const item of state.fixtures ?? []) if (existsSync(item.path)) unlinkSync(item.path);
  delete state.fixtures;
  delete state.resume;
  delete state.activeRun;
  saveState(state);
}

async function run() {
  config({ path: resolve(root, ".env.local"), override: true, quiet: true });
  const state = loadState();
  if (process.argv.includes("--abandon")) { cleanup(state); console.log("live-smoke: resumable synthetic state abandoned and cleaned"); return; }
  if (!existsSync(authPath) || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new SmokeError("Local QA auth or Supabase environment is missing");
  if (process.env.PAYMENTS_ENABLED !== "false") throw new SmokeError("Payments must remain disabled");
  const saved = JSON.parse(readFileSync(authPath, "utf8"));
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const refreshed = await supabase.auth.setSession({ access_token: saved.storageValue.access_token, refresh_token: saved.storageValue.refresh_token });
  if (refreshed.error || !refreshed.data.session || refreshed.data.user.app_metadata?.role !== "customer") throw refreshed.error ?? new SmokeError("QA customer session refresh failed");
  const accessToken = refreshed.data.session.access_token;
  saved.storageValue = { ...saved.storageValue, access_token: accessToken, refresh_token: refreshed.data.session.refresh_token, expires_at: refreshed.data.session.expires_at, user: refreshed.data.user };
  writeFileSync(authPath, `${JSON.stringify(saved, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const fixtures = await loadOrCreateFixtures(state);

  let assessment = state.resume?.assessment;
  let history = state.resume?.history ?? [{ role: "user", content: scenario }];
  let initialQuestionCount = state.resume?.initialQuestionCount ?? 0;
  let optionalQuestionsSkipped = state.resume?.optionalQuestionsSkipped ?? 0;
  let safetyQuestionsAnswered = state.resume?.safetyQuestionsAnswered ?? 0;
  if (!assessment) {
    assessment = await analyze(accessToken, fixtures, { locale: "es", history, mediaConsent: true, translations: [] }, state);
    initialQuestionCount = assessment.questions.length;
    state.resume = { assessment, history, initialQuestionCount, optionalQuestionsSkipped, safetyQuestionsAnswered };
    saveState(state);
  }
  while (!assessment.readyToConfirm) {
    if (assessment.safety.level === "emergency" || assessment.safety.hazards.length > 0) { writeBlockedEvidence(state, "safety_blocked", assessment); throw new SmokeError("Safety gate stopped the synthetic scenario"); }
    if (assessment.questions.length === 0 || state.activeRun.callsAttempted >= state.activeRun.maxCalls) { writeBlockedEvidence(state, "blocked_by_follow_up_information", assessment); throw new SmokeError("Assessment still needs information at the bounded call limit", { questionCount: assessment.questions.length }); }
    const optionalIds = assessment.questions.filter((item) => !item.requiredForSafety).map((item) => item.id);
    const safetyCount = assessment.questions.filter((item) => item.requiredForSafety).length;
    history = [...history, { role: "assistant", content: assessment.reply }, ...(safetyCount ? [{ role: "user", content: safeAnswer }] : [])];
    optionalQuestionsSkipped += optionalIds.length;
    safetyQuestionsAnswered += safetyCount;
    assessment = await analyze(accessToken, fixtures, { locale: "es", history, mediaConsent: true, previousAssessmentToken: assessment.assessmentToken, skipped: optionalIds.length ? { questionIds: optionalIds, warningAcknowledged: true } : undefined, translations: [] }, state);
    state.resume = { assessment, history, initialQuestionCount, optionalQuestionsSkipped, safetyQuestionsAnswered };
    saveState(state);
  }
  if (assessment.safety.level === "emergency" || assessment.safety.hazards.length > 0) { writeBlockedEvidence(state, "safety_blocked", assessment); throw new SmokeError("Safety gate stopped the synthetic scenario"); }

  const confirmed = await jsonRequest("/api/intake/confirm", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ assessmentToken: assessment.assessmentToken, customerName: "Local QA Customer", address: "100 Test Fixture Lane, Charlotte, NC 28202", acceptedIssueIds: assessment.issueCandidates.map((item) => item.id), warningAcknowledged: true }) }, [201]);
  const requestResult = confirmSchema.parse(confirmed.body);
  const upload = new FormData(); upload.append("assessmentToken", assessment.assessmentToken); appendMedia(upload, fixtures);
  const firstUpload = await jsonRequest(`/api/requests/${requestResult.requestId}/intake-media`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: upload }, [201]);
  const createdMedia = mediaSchema.parse(firstUpload.body);
  const listing = mediaSchema.parse((await jsonRequest(`/api/requests/${requestResult.requestId}/intake-media`, { headers: { Authorization: `Bearer ${accessToken}` } }, [200])).body);
  const downloads = [];
  for (const item of listing.media) {
    if (!item.url) throw new SmokeError("Signed media URL is missing");
    const response = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get("content-type")?.split(";")[0];
    if (!response.ok || mime !== item.contentType || bytes.length !== item.sizeBytes || !magicMatches(item.contentType, bytes)) throw new SmokeError("Signed media download verification failed", { status: response.status, expectedMime: item.contentType, actualMime: mime, expectedBytes: item.sizeBytes, actualBytes: bytes.length });
    downloads.push({ contentType: item.contentType, declaredBytes: item.sizeBytes, downloadedBytes: bytes.length, magicVerified: true, signedUrlExpiresInSeconds: item.expiresInSeconds });
  }
  const duplicate = new FormData(); duplicate.append("assessmentToken", assessment.assessmentToken); appendMedia(duplicate, fixtures);
  const duplicateUpload = await jsonRequest(`/api/requests/${requestResult.requestId}/intake-media`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: duplicate }, [200]);
  const duplicateMedia = mediaSchema.parse(duplicateUpload.body);
  const afterDuplicate = mediaSchema.parse((await jsonRequest(`/api/requests/${requestResult.requestId}/intake-media`, { headers: { Authorization: `Bearer ${accessToken}` } }, [200])).body);
  if ([createdMedia.media.length, listing.media.length, duplicateMedia.media.length, afterDuplicate.media.length].some((count) => count !== 2)) throw new SmokeError("Media deduplication count changed");
  const evidence = {
    generatedAt: new Date().toISOString(), status: "passed", environment: { apiUrl, supabasePort: 56321, paymentsEnabled: false },
    fixture: { synthetic: true, scenario: "safe interior cabinet hinge", locale: "es", media: fixtures.map((item) => ({ contentType: item.contentType, sourceBytes: item.bytes.length })) },
    llm: { provider: "Gemini through local WeCover API", actualCallsTotal: state.aiCallsAttempted, activeRunCalls: state.activeRun.callsAttempted, attempts: state.attempts, initialQuestionCount, optionalQuestionsExplicitlySkipped: optionalQuestionsSkipped, safetyQuestionsAnswered, readyToConfirm: true, category: assessment.category, safetyLevel: assessment.safety.level, hazardCount: assessment.safety.hazards.length },
    request: { createdThroughActualSupabaseRepository: true, status: requestResult.status, matchCount: requestResult.matchCount },
    media: { firstUploadStatus: firstUpload.status, duplicateUploadStatus: duplicateUpload.status, countAfterFirstUpload: 2, countAfterDuplicateUpload: 2, signedReads: downloads },
    assertions: { customerAuthRefreshed: true, signedAssessmentAccepted: true, sameMediaContextAccepted: true, sanitizedMediaOnlyListed: true, duplicateUploadIdempotent: true, secretsExcluded: true },
  };
  mkdirSync(resolve(root, "artifacts"), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  cleanup(state);
  console.log(`live-smoke: passed (${evidence.llm.activeRunCalls} current-run Gemini calls, 2 sanitized media, duplicate count unchanged)`);
}

await run();
