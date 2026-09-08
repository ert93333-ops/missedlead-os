import type { IntakeLocale, ModelAssessment } from "./types.js";

type Hazard = ModelAssessment["safety"]["hazards"][number];
const HAZARD_PATTERNS: readonly { readonly hazard: Hazard; readonly pattern: RegExp }[] = [
  { hazard: "gas", pattern: /\b(?:gas (?:smell|leak)|smell(?:ing)? (?:of )?gas|(?:huele|huelo|olemos) a gas|olor a gas|fuga de gas)\b/g },
  { hazard: "fire", pattern: /\b(?:fire(?! (?:department|alarm|detector))|flames?|smoke(?! (?:detector|alarm))|fuego|llamas?|humo)\b/g },
  { hazard: "electrical", pattern: /\b(?:sparks?|live wires?|exposed wiring|electric shock|electrocut\w*|chispas?|cables? (?:vivos?|expuestos con corriente)|electrocuci\w*)\b/g },
  { hazard: "structural", pattern: /\b(?:structural collapse|ceiling (?:is )?falling|wall (?:is )?collapsing|colapso estructural|techo (?:se )?(?:cae|esta cayendo))\b/g },
  { hazard: "severe_flooding", pattern: /\b(?:severe flood(?:ing)?|rapid flooding|filling rapidly with water|water (?:is )?rising rapidly|inundacion grave|agua sube rapidamente)\b/g },
];
// Negation is restricted to the matched observation, never the entire sentence.
const NEGATED_OBSERVATION = /\b(?:no|not|without|don't|do not|doesn't|does not|isn't|is not|ningun|ninguna|sin)(?:\s+(?:hay|any|signs?|of|visible|active|obvious|detectable|see|seeing|smell|smelling|evidence|the|a|an|smoke|gas|fire|sparks?|flames?|humo|fuego|chispas?|olor|or|nor|ni|and|y|electrical|contact|standing|water|flooding|contacto|electrico|inundacion))*\s*$/;
const DENIAL_PREFIX = /^\s*(?:(?:there (?:is|are)|i (?:see|have|notice))\s+)?(?:no(?:\s+hay)?|without|sin|ningun[ao]?)\s+/;
const OBSERVATION_PREDICATE = /\b(?:is|are|was|were|am|has|have|had|can|could|will|would|must|should|does|do|did|i|we|you|it|they|he|she|hay|esta|estan|estaba|tengo|tiene|tenemos|puedo|puede|veo|vemos|sale|salen|sube|suben|cae|caen|huele|huelo|olemos|aparece|aparecen|from|near|under|through|desde|cerca|sale|salen|comes?|appears?|rises?|billows?|emerges?|spreads?|continues?)\b/;
const ACTIVE_PARTICIPLE = /\b(?!(?:flooding|wiring|ceiling|standing)\b)\w+(?:ing|ando|iendo)\b/;
const bareCoordination = (clause: string): boolean => clause.trim().length > 0
  && !OBSERVATION_PREDICATE.test(clause) && !ACTIVE_PARTICIPLE.test(clause);
const SENSOR_CONTEXT = /\b(?:detector|alarma) (?:de )?$/;
const HISTORICAL = /\b(?:last year|years? ago|el ano pasado|hace anos)\b/;
const RESOLVED_FIRE = /^\s+(?:was extinguished by the fire department|fue extinguido por los bomberos)\b/;

const explicitHazards = (history: readonly { readonly role: "user" | "assistant"; readonly content: string }[]): Hazard[] => {
  const hazards = new Set<Hazard>();
  const clauses = history.filter((message) => message.role === "user").flatMap((message) => message.content
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’]/g, "'")
    .split(/[.!?;\n]+|\b(?:but|however|although|pero|aunque|sin embargo)\b/)
    .flatMap(sentence => {
      let deniedList = false;
      return sentence.split(',').flatMap(part => {
        const denial = DENIAL_PREFIX.exec(part);
        const nounPhrase = denial ? part.slice(denial[0].length) : part;
        deniedList = (Boolean(denial) || deniedList) && bareCoordination(nounPhrase);
        return deniedList ? [] : [part];
      });
    }));
  for (const clause of clauses) {
    for (const candidate of HAZARD_PATTERNS) {
      for (const match of clause.matchAll(candidate.pattern)) {
        const before = clause.slice(0, match.index);
        const after = clause.slice(match.index + match[0].length);
        if (NEGATED_OBSERVATION.test(before)) continue;
        if (candidate.hazard === "fire" && SENSOR_CONTEXT.test(before)) continue;
        if (candidate.hazard === "fire" && HISTORICAL.test(before) && RESOLVED_FIRE.test(after)) continue;
        hazards.add(candidate.hazard);
      }
    }
  }
  return [...hazards];
};

export const enforceSafetyFloor = (
  assessment: ModelAssessment,
  history: readonly { readonly role: "user" | "assistant"; readonly content: string }[],
  locale: IntakeLocale,
): ModelAssessment => {
  const hazards = explicitHazards(history);
  if (hazards.length === 0 || assessment.safety.level === "emergency") return assessment;
  return {
    ...assessment,
    reply: locale === "es"
      ? "Detente, aléjate del peligro y llama al 911 o a la empresa pública correspondiente. No continúes con el diagnóstico en línea."
      : "Stop, move away from the danger, and call 911 or the appropriate public utility. Do not continue online diagnosis.",
    safety: {
      level: "emergency",
      hazards: [...new Set([...assessment.safety.hazards, ...hazards])],
      guidance: locale === "es"
        ? "Sal del área si puedes hacerlo con seguridad y contacta a los servicios de emergencia o a la empresa pública."
        : "Leave the area if you can do so safely and contact emergency services or the public utility.",
    },
    readyToConfirm: false,
  };
};
