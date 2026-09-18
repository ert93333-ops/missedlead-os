/**
 * 진단 지식 검색기: 증상 텍스트 정규화(액센트 제거) 후 signals 매칭으로 관련 레코드를 찾는다.
 */
import { diagnosticKnowledge } from './records.js';
import type { DiagnosticRecord, KnowledgeLocale } from './types.js';
export { diagnosticKnowledge } from './records.js';
export type { DiagnosticRecord, DiagnosticSource, KnowledgeLocale } from './types.js';
const normalize = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function matches(text: string, term: string): boolean {
  const normalized = normalize(term);
  if (normalized.length <= 3) return text.split(/[^a-z0-9]+/u).includes(normalized);
  return text.includes(normalized);
}
export function retrieveDiagnosticKnowledge(text: string, locale: KnowledgeLocale): {
  readonly locale: KnowledgeLocale; readonly emergency: boolean; readonly records: readonly DiagnosticRecord[];
} {
  const input = normalize(text.slice(0, 30000));
  const gasEvidence = input.replace(/\b(?:no(?: hay)?|sin|without)\s+(?:gas smell|gas leak|olor a gas|fuga de gas)\b|\b(?:do not|don't|don’t|cannot|can't)\s+smell gas\b/gu, ' ');
  const externalWaterEvidence = input.replace(/\bno\s+(?:hay\s+)?(?:water\s+on\s+(?:the\s+)?floor|agua\s+en\s+(?:el\s+)?(?:suelo|piso))\b/gu, ' ');
  const relevant = diagnosticKnowledge.filter(record => {
    const routineEvidence = record.id === 'toilet-external-leak' ? externalWaterEvidence : input;
    const evidence = record.category === 'emergency' ? gasEvidence : routineEvidence;
    return record.signals.every(group => group.some(term => matches(evidence, term)));
  });
  const emergencies = relevant.filter(record => record.category === 'emergency');
  return { locale, emergency: emergencies.length > 0, records: emergencies.length ? emergencies : relevant.slice(0, 5) };
}

const MEDIA_CATALOG_CAP = 30;

/**
 * 증상 텍스트 없이 미디어만 들어온 경우 모델에 건네는 한정 카탈로그.
 * 응급 레코드는 항상 전부 포함하고, 일반 레코드는 카테고리별 라운드로빈으로
 * 골라 모든 서비스 종류가 균형 있게 대표되도록 한다 (최대 MEDIA_CATALOG_CAP건).
 */
export function mediaReferenceCatalog(): readonly DiagnosticRecord[] {
  const emergency = diagnosticKnowledge.filter(record => record.category === 'emergency');
  const pools = new Map<string, DiagnosticRecord[]>();
  for (const record of diagnosticKnowledge) {
    if (record.category === 'emergency') continue;
    const pool = pools.get(record.category) ?? [];
    pool.push(record);
    pools.set(record.category, pool);
  }
  const picked: DiagnosticRecord[] = [];
  const buckets = [...pools.values()];
  let progressed = true;
  while (progressed && emergency.length + picked.length < MEDIA_CATALOG_CAP) {
    progressed = false;
    for (const bucket of buckets) {
      if (emergency.length + picked.length >= MEDIA_CATALOG_CAP) break;
      const next = bucket.shift();
      if (next) { picked.push(next); progressed = true; }
    }
  }
  return [...emergency, ...picked];
}
