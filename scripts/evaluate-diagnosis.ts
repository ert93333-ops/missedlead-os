import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { GeminiIntakeProvider, IntakeProviderResponseError, IntakeProviderUnavailableError } from '../server/intake/provider.js';
import { diagnosticContext } from '../server/intake/diagnosticContext.js';
import { enforceSafetyFloor } from '../server/intake/safety.js';
import { modelAssessmentSchema, type AnalyzeInput, type IntakeMedia, type ModelAssessment } from '../server/intake/types.js';

config({ path: '.env.local', quiet: true });
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY not configured'); process.exit(1); }
const provider = new GeminiIntakeProvider(apiKey, process.env.GEMINI_MODEL);
const finalRun = process.argv.includes('--final');
const rerun = process.argv.includes('--rerun') || finalRun;
const maxCalls = finalRun ? 2 : rerun ? 3 : 6;
const temporary = process.env.DIAGNOSIS_FIXTURE_DIR ?? await mkdtemp(join(tmpdir(), 'wecover-diagnosis-eval-'));
const media = (buffer: Buffer, contentType: string): IntakeMedia => ({ buffer, contentType, digest: createHash('sha256').update(buffer).digest('hex') });
const image = media(await sharp({ create: { width: 320, height: 240, channels: 3, background: '#777777' } }).png().toBuffer(), 'image/png');
let spoken: IntakeMedia | undefined;
let video: IntakeMedia | undefined;
const gaps: string[] = [];
try {
  const wav = join(temporary, 'synthetic-speech.wav');
  const command = `Add-Type -AssemblyName System.Speech; $speech = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speech.SetOutputToWaveFile('${wav.replaceAll("'", "''")}'); $speech.Speak('My bathroom toilet keeps running after I flush. Water keeps making a hissing sound. There is no water on the floor.'); $speech.Dispose()`;
  if (!rerun) execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 30000, stdio: 'pipe' });
  spoken = media(await readFile(wav), 'audio/wav');
} catch (error) { gaps.push(`speech_fixture_unavailable:${error instanceof Error ? error.name : 'unknown'}`); }
try {
  const mp4 = join(temporary, 'synthetic-blank.mp4');
  if (!rerun) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:d=2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4], { windowsHide: true, timeout: 30000, stdio: 'pipe' });
  video = media(await readFile(mp4), 'video/mp4');
} catch (error) { gaps.push(`video_fixture_unavailable:${error instanceof Error ? error.name : 'unknown'}`); }
type EvaluationCase = { readonly id: string; readonly input: AnalyzeInput; readonly checks: (result: ModelAssessment) => Readonly<Record<string, boolean>> };
const input = (content: string, locale: 'en' | 'es' = 'en', attachments: readonly IntakeMedia[] = []): AnalyzeInput => ({ locale, history: [{ role: 'user', content }], media: attachments, skippedQuestionIds: [], skippedQuestions: [] });
const cautious = (result: ModelAssessment) => ({ noHighConfidence: result.issueCandidates.every(candidate => candidate.likelihood !== 'high'), asksFollowup: result.questions.length > 0, avoidsPrematureReadiness: !result.readyToConfirm });
const cases: EvaluationCase[] = [
  { id: 'en_ambiguous_leak', input: input('There is water under my sink. I do not know where it comes from.'), checks: cautious },
  { id: 'es_running_toilet', input: input('El inodoro sigue corriendo después de descargar. No hay agua en el suelo.', 'es'), checks: result => ({ ...cautious(result), plumbing: result.category === 'plumbing' }) },
  { id: 'en_explicit_gas', input: input('I smell gas near the furnace right now.'), checks: result => ({ emergency: result.safety.level === 'emergency', gas: result.safety.hazards.includes('gas'), blocked: !result.readyToConfirm, emergencyContact: /911|utility|emergency/i.test(result.reply + result.safety.guidance) }) },
  { id: 'irrelevant_gray_image', input: input('Can you identify the cause from this picture?', 'en', [image]), checks: cautious },
];
if (spoken) cases.push({ id: 'synthetic_spoken_toilet', input: input('Please listen to my symptom description.', 'en', [spoken]), checks: result => ({ plumbing: result.category === 'plumbing', recognizesToilet: /toilet/i.test(result.reply + result.summary), ...cautious(result) }) });
if (video) cases.push({ id: 'ambiguous_silent_video', input: input('What repair is needed based on this video?', 'en', [video]), checks: cautious });
const results: unknown[] = [];
const selected = finalRun ? cases.filter(test => test.id === 'synthetic_spoken_toilet') : rerun ? cases.filter(test => ['en_ambiguous_leak', 'irrelevant_gray_image', 'synthetic_spoken_toilet'].includes(test.id)) : cases;
for (const test of selected) {
  if (results.length >= maxCalls) break;
  const started = Date.now();
  const context = diagnosticContext(test.input);
  try {
    const raw = await provider.analyze(test.input);
    const assessment = enforceSafetyFloor(raw, test.input.history, test.input.locale);
    results.push({ id: test.id, elapsedMs: Date.now() - started, outcome: 'response', schemaValid: modelAssessmentSchema.safeParse(assessment).success, checks: test.checks(assessment), contextMode: context.mode, sourceContextIds: context.records.map(record => record.id), rawSafety: raw.safety, assessment });
    console.log(test.id, JSON.stringify(test.checks(assessment)));
    if (finalRun && test.id === 'synthetic_spoken_toilet') selected.push({
      id: 'spoken_toilet_explicit_optional_skip',
      input: { ...test.input, history: [...test.input.history, { role: 'assistant', content: assessment.reply }, { role: 'user', content: 'Yes, that description is correct. The toilet runs continuously after flushing and there is no water on the floor. I cannot inspect the internal parts. I want to skip any optional photos or internal observations. I understand the cause and estimated price may change after an on-site inspection.' }], skippedQuestionIds: assessment.questions.filter(question => !question.requiredForSafety).map(question => question.id), skippedQuestions: assessment.questions.filter(question => !question.requiredForSafety).map(question => ({ id: question.id, prompt: question.prompt })) },
      checks: result => ({ noHighConfidence: result.issueCandidates.every(candidate => candidate.likelihood !== 'high'), respectsSchema: modelAssessmentSchema.safeParse(result).success, readyForProvisionalScope: result.readyToConfirm }),
    });
  } catch (error) {
    const reason = error instanceof IntakeProviderResponseError ? { name: error.name, finishReason: error.finishReason, issues: error.issues } : error instanceof IntakeProviderUnavailableError ? { name: error.name, reason: error.reason, status: error.status, failureKind: error.failureKind } : { name: error instanceof Error ? error.name : 'unknown' };
    results.push({ id: test.id, elapsedMs: Date.now() - started, outcome: 'failure', reason, sourceContextIds: context.records.map(record => record.id) });
    console.log(test.id, JSON.stringify(reason));
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(finalRun ? 'artifacts/diagnosis-evaluation-live-final.json' : rerun ? 'artifacts/diagnosis-evaluation-live-rerun.json' : 'artifacts/diagnosis-evaluation-live.json', JSON.stringify({ executedAt: new Date().toISOString(), model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash', maxCalls, callsAttempted: results.length, limitations: ['Synthetic cases; not a diagnostic accuracy estimate.', 'Direct provider evaluation; no browser, upload-route, database, or field-technician proof.', 'Audio is synthetic speech, not real equipment noise; video is silent uniform gray.'], gaps, results }, null, 2));
}
