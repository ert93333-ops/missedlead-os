export type DiagnosticSignal = 'leaks_during_drain' | 'supply_lines_dry' | 'visible_joint_moisture' | 'continuous_meter_movement'

export type DiagnosticRule = {
  id: string
  label: string
  supportingSignals: DiagnosticSignal[]
  conflictingSignals: DiagnosticSignal[]
  baseScore: number
  inspectionRequired: string
  source: { title: string; url: string }
}

export type Hypothesis = {
  id: string
  label: string
  confidence: number
  supportingEvidence: DiagnosticSignal[]
  conflictingEvidence: DiagnosticSignal[]
  inspectionRequired: string
  source: DiagnosticRule['source']
}

export const plumbingRules: DiagnosticRule[] = [
  {
    id: 'drain-joint-seal',
    label: 'Drain joint or P-trap seal failure',
    supportingSignals: ['leaks_during_drain', 'supply_lines_dry', 'visible_joint_moisture'],
    conflictingSignals: ['continuous_meter_movement'],
    baseScore: 24,
    inspectionRequired: 'A technician must inspect and pressure-test the joint before confirming repair scope.',
    source: {
      title: 'InterNACHI Standards of Practice — Plumbing',
      url: 'https://www.nachi.org/sop.htm',
    },
  },
  {
    id: 'supply-line-leak',
    label: 'Pressurized supply line or valve leak',
    supportingSignals: ['continuous_meter_movement'],
    conflictingSignals: ['supply_lines_dry', 'leaks_during_drain'],
    baseScore: 18,
    inspectionRequired: 'Shutoff isolation and an on-site pressure test are required to locate a concealed supply leak.',
    source: {
      title: 'EPA WaterSense — Detecting Leaks',
      url: 'https://www.epa.gov/watersense/fix-leak-week',
    },
  },
]

export function rankHypotheses(signals: DiagnosticSignal[]): Hypothesis[] {
  const observed = new Set(signals)
  return plumbingRules
    .map((rule) => {
      const supportingEvidence = rule.supportingSignals.filter((signal) => observed.has(signal))
      const conflictingEvidence = rule.conflictingSignals.filter((signal) => observed.has(signal))
      const rawScore = rule.baseScore + supportingEvidence.length * 20 - conflictingEvidence.length * 24
      return {
        id: rule.id,
        label: rule.label,
        confidence: Math.max(0, Math.min(85, rawScore)),
        supportingEvidence,
        conflictingEvidence,
        inspectionRequired: rule.inspectionRequired,
        source: rule.source,
      }
    })
    .filter((hypothesis) => hypothesis.supportingEvidence.length > 0 && hypothesis.confidence >= 20)
    .sort((a, b) => b.confidence - a.confidence)
}
