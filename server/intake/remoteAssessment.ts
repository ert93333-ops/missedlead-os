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
