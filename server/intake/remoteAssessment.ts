/**
 * 원격(모델) 평가 후처리: 미디어만으로 확정한 경우 구분 질문을 강제하고,
 * 과도한 high 확신을 medium으로 낮춰 불확실성을 표시한다.
 */
import type { AnalyzeInput, ModelAssessment } from './types.js';
export function refineRemoteAssessment(assessment: ModelAssessment, input: AnalyzeInput): ModelAssessment {
 const initialMediaOnlyEvidence = input.media.length > 0 && !input.history.some(message => message.role === 'assistant');
 const needsDistinction = initialMediaOnlyEvidence && assessment.readyToConfirm && assessment.questions.length === 0 && assessment.safety.level !== 'emergency';
 return {
  ...assessment,
  issueCandidates: assessment.issueCandidates.map(issue => ({...issue, likelihood: issue.likelihood === 'high' ? 'medium' : issue.likelihood})),
  questions: needsDistinction ? [{id:'confirm_observations',prompt: input.locale === 'es' ? 'Para distinguir las causas, ¿qué modelo o tipo de equipo es y cuándo aparece el problema? Si es seguro, una foto más amplia puede ayudar.' : 'To distinguish the possible causes, what equipment model or type is involved, and when does the problem occur? A wider photo from a safe position may help.', requiredForSafety:false}] : assessment.questions,
  readyToConfirm: needsDistinction ? false : assessment.readyToConfirm,
 };
}
