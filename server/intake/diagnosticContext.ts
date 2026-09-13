/**
 * 증상 텍스트와 지식 레코드를 매칭해 모델 프롬프트에 넣을 진단 컨텍스트를 만든다.
 * 매칭 없으면 미디어 참조 카탈로그 모드로 폴백.
 */
import { diagnosticKnowledge, retrieveDiagnosticKnowledge } from './knowledge/index.js';
import type { AnalyzeInput } from './types.js';
export function diagnosticContext(input: AnalyzeInput) {
  const symptoms = input.history.filter(message => message.role === 'user').map(message => message.content).join('\n');
  const matched = retrieveDiagnosticKnowledge(symptoms, input.locale).records;
  const records = matched.length ? matched : input.media.length ? diagnosticKnowledge : [];
  return {
    mode: matched.length ? 'symptom_reference' : input.media.length ? 'media_reference_catalog' : 'no_reference',
    records: records.map(record => ({ id: record.id, category: record.category, title: record.title[input.locale], candidateCauses: record.candidateCauses, questions: record.questions.map(question => question[input.locale]), safeObservation: record.safeObservation[input.locale], redFlags: record.redFlags, limitation: record.limitation, sources: record.sources })),
  };
}
