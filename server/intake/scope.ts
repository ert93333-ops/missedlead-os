/**
 * 서비스 범위 하한선. WeCover는 plumbing/electrical/hvac/painting/pest_control/handyman
 * 수리 요청만 접수한다. 모델이 이사·청소·조경·차량·전자기기·법률/세무/보험 같은 미취급 작업을
 * 접수 가능한 요청으로 만들면 후보·질문·확정 가능 상태를 제거하고 안내 문구로 대체한다(enforceServiceScope).
 */
import type { IntakeLocale, ModelAssessment } from "./types.js";

/** 취급하지 않는 작업 유형. 단어 하나가 아니라 실제 의뢰 표현으로만 매칭한다. */
const NON_SERVICEABLE_PATTERNS: readonly RegExp[] = [
  /\b(?:movers?|moving (?:company|service|help|crew|quote)|packing service|mudanza|empacado)\b/,
  /\b(?:carpet|house|home|apartment|move-?out|deep) cleaning\b/,
  /\b(?:maid|janitorial|housekeeping) service\b/,
  /\b(?:limpieza (?:de (?:alfombras?|casa)|profunda)|servicio de limpieza)\b/,
  /\b(?:lawn (?:mowing|care|service)|mowing|landscap(?:ing|er)|tree (?:removal|trimming)|snow removal|jardiner[ií]a|cortar el c[eé]sped)\b/,
  /\b(?:car|truck|vehicle|automobile|motorcycle) (?:engine|repair|maintenance|mechanic)\b/,
  /\b(?:check engine light|auto repair|mec[aá]nico automotriz|reparaci[oó]n de (?:autom[oó]vil|coche))\b/,
  /\b(?:laptop|desktop computer|computer repair|smartphone|cell ?phone|tablet|game console|reparaci[oó]n de (?:computadora|celular))\b/,
  /\b(?:tax (?:return|filing|advice|preparation)|income taxes|impuestos)\b/,
  /\b(?:legal (?:advice|action)|lawsuit|attorney|lawyer|sue (?:my|the) \w+|lease (?:dispute|termination letter)|abogad[oa]|demanda legal)\b/,
  /\b(?:insurance claim|home warranty|mortgage|real estate agent|reclamo de seguro|garant[ií]a del hogar|hipoteca)\b/,
  /\b(?:medical|doctor|prescription|m[eé]dic[oa])\s+(?:advice|help|consultation|consulta)\b/,
  /\b(?:weather forecast|restaurant recommendation|sports? (?:score|prediction)|pron[oó]stico del tiempo)\b/,
];

/** 실제 수리 요청 신호. 미취급 표현이 섞여 있어도 이 신호가 있으면 정상 접수로 둔다. */
const SERVICEABLE_SIGNALS: readonly RegExp[] = [
  /\b(?:leak|leaking|drip|drain|clog|pipe|faucet|toilet|sink|shower|water heater|sewer|sump pump)\b/,
  /\b(?:fuga|goteo|desag[üu]e|tuber[ií]a|llave|inodoro|fregadero|calentador)\b/,
  /\b(?:outlet|receptacle|breaker|electrical panel|wiring|circuit|light fixture|switch|gfci)\b/,
  /\b(?:enchufe|interruptor|cableado|circuito|panel el[eé]ctrico)\b/,
  /\b(?:hvac|furnace|air conditioner|air conditioning|heat pump|thermostat|duct|condenser|refrigerant|ac (?:unit|system))\b/,
  /\b(?:calefacci[oó]n|aire acondicionado|termostato|conducto)\b/,
  /\b(?:paint|painting|primer|drywall|plaster|trim|ceiling repair|wall repair)\b/,
  /\b(?:pintura|pintar|panel de yeso|yeso)\b/,
  /\b(?:roach|cockroach|rodent|mouse|mice|rat|termite|bed ?bug|ant|wasp|pest)\b/,
  /\b(?:cucaracha|roedor|rat[oó]n|termita|chinche|hormiga|plaga)\b/,
  /\b(?:door|hinge|latch|cabinet|shelf|tile|grout|caulk|handrail|window repair|mount)\b/,
  /\b(?:puerta|bisagra|gabinete|estante|azulejo|repisa)\b/,
];

const DECLINE_REPLY: Record<IntakeLocale, string> = {
  en: "WeCover only handles home repair requests: plumbing, electrical, HVAC, painting, pest control, and general handyman repairs. That work is outside our service, so no technician request was created. Describe a home repair issue and we can continue.",
  es: "WeCover solo atiende solicitudes de reparación del hogar: plomería, electricidad, climatización, pintura, control de plagas y reparaciones generales. Ese trabajo está fuera de nuestro servicio, así que no se creó ninguna solicitud de técnico. Describa un problema de reparación del hogar y seguimos.",
};

const normalize = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** 접수 대상(요약·후보)이 취급 범위 밖인지 판정한다. 대화 원문이 아니라 접수될 내용만 본다. */
export const isNonServiceableSubject = (subject: string): boolean => {
  const text = normalize(subject);
  if (SERVICEABLE_SIGNALS.some((pattern) => pattern.test(text))) return false;
  return NON_SERVICEABLE_PATTERNS.some((pattern) => pattern.test(text));
};

export const enforceServiceScope = (assessment: ModelAssessment, locale: IntakeLocale): ModelAssessment => {
  const subject = [assessment.summary, ...assessment.issueCandidates.map((issue) => `${issue.label} ${issue.reason}`)].join(" ");
  if (!isNonServiceableSubject(subject)) return assessment;
  return {
    ...assessment,
    // 응급 안내는 범위 밖이어도 그대로 유지한다.
    reply: assessment.safety.level === "emergency" ? assessment.reply : DECLINE_REPLY[locale],
    issueCandidates: [],
    questions: [],
    materialsHint: [],
    readyToConfirm: false,
  };
};
