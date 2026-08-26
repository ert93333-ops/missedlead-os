export type Trade = 'plumbing' | 'hvac' | 'electrical' | 'water_heater'
export type ProtocolId = 'sink_leak' | 'drain_backup' | 'no_cooling' | 'breaker_trip' | 'water_heater_issue'

export type EvidenceQuestion = {
  id: string
  prompt: string
  kind: 'boolean' | 'text' | 'number'
  required: boolean
}

export type ProtocolEvidence = {
  id: string
  label: string
  capture: string
  supports: string[]
  conflicts: string[]
  weight: number
}

export type DifferentialCause = {
  id: string
  label: string
  base: number
  fieldChecks: string[]
  estimateVariables: string[]
}

export type EvidenceProtocol = {
  id: ProtocolId
  trade: Trade
  title: string
  confidenceCeiling: number
  questions: EvidenceQuestion[]
  evidence: ProtocolEvidence[]
  causes: DifferentialCause[]
  redFlagQuestionIds: string[]
  redFlagPattern: RegExp
  redFlagInstruction: string
  sources: { title: string; url: string }[]
}

const protocols: Record<ProtocolId, EvidenceProtocol> = {
  sink_leak: {
    id: 'sink_leak', trade: 'plumbing', title: 'Leak below a sink', confidenceCeiling: 0.78,
    questions: [
      { id: 'when_leaks', prompt: 'Does it leak continuously, only while the faucet runs, or only while the sink drains?', kind: 'text', required: true },
      { id: 'meter_moves', prompt: 'With every fixture and appliance off, does the water meter still move?', kind: 'boolean', required: true },
      { id: 'water_near_electric', prompt: 'Is water touching an outlet, appliance wiring, or electrical panel?', kind: 'boolean', required: true },
    ],
    evidence: [
      { id: 'overview_video', label: 'Leak overview video', capture: 'Record 15 seconds from the dry cabinet floor upward while another person runs and drains the sink.', supports: ['drain_joint', 'supply_leak'], conflicts: [], weight: 16 },
      { id: 'joint_closeup', label: 'Joint close-up', capture: 'Photograph the first wet point at the P-trap, tailpiece, supply valve, and faucet hoses without touching valves.', supports: ['drain_joint'], conflicts: ['concealed_supply'], weight: 22 },
      { id: 'dry_supply_lines', label: 'Dry supply lines', capture: 'Photograph both supply hoses and shutoff valves while the leak is active.', supports: ['drain_joint'], conflicts: ['supply_leak'], weight: 14 },
      { id: 'moving_meter', label: 'Meter movement with all water off', capture: 'Record the meter for 30 seconds only after confirming every fixture and appliance is off.', supports: ['concealed_supply', 'supply_leak'], conflicts: ['drain_joint'], weight: 24 },
    ],
    causes: [
      { id: 'drain_joint', label: 'Drain joint or P-trap seal leak', base: 18, fieldChecks: ['Run-and-drain test', 'Joint alignment and seal inspection'], estimateVariables: ['trap material', 'access clearance', 'joint replacement count', 'water-damage cleanup'] },
      { id: 'supply_leak', label: 'Supply hose, valve, or faucet connection leak', base: 16, fieldChecks: ['Static pressure test', 'Valve and hose inspection'], estimateVariables: ['valve type', 'hose/faucet access', 'water shutoff condition', 'pressure regulation'] },
      { id: 'concealed_supply', label: 'Concealed pressurized supply leak', base: 8, fieldChecks: ['Isolation test', 'Pressure test', 'Moisture mapping'], estimateVariables: ['wall/cabinet opening', 'pipe material', 'leak location', 'restoration excluded from plumbing quote'] },
    ],
    redFlagQuestionIds: ['water_near_electric'],
    redFlagPattern: /electrical|outlet|panel|active flood|burst|sewage/i,
    redFlagInstruction: 'Stop water use if safe, avoid all electrical contact, and route immediately to a licensed professional or emergency response.',
    sources: [
      { title: 'EPA WaterSense — Fix a Leak', url: 'https://www.epa.gov/watersense/fix-leak-week' },
      { title: 'InterNACHI Standards of Practice — Plumbing', url: 'https://www.nachi.org/sop.htm' },
    ],
  },
  drain_backup: {
    id: 'drain_backup', trade: 'plumbing', title: 'Slow drain or backup', confidenceCeiling: 0.72,
    questions: [
      { id: 'fixtures_affected', prompt: 'Is one fixture affected or are multiple fixtures backing up?', kind: 'text', required: true },
      { id: 'sewage_present', prompt: 'Is sewage or contaminated water entering a fixture or floor drain?', kind: 'boolean', required: true },
      { id: 'gurgling', prompt: 'Do other drains gurgle when this fixture drains or the toilet flushes?', kind: 'boolean', required: true },
    ],
    evidence: [
      { id: 'drain_test_video', label: 'Timed drain video', capture: 'Record the basin, water level, and drain sound for 30 seconds. Do not add chemical cleaner.', supports: ['local_blockage', 'vent_or_main'], conflicts: [], weight: 18 },
      { id: 'multi_fixture_video', label: 'Second-fixture response', capture: 'From a safe dry position, record whether a nearby tub or floor drain rises when the toilet flushes.', supports: ['main_blockage'], conflicts: ['local_blockage'], weight: 26 },
      { id: 'sewage_visible', label: 'Visible sewage backup', capture: 'Do not approach or touch. A distant photo is optional only if it can be taken safely.', supports: ['main_blockage'], conflicts: [], weight: 30 },
    ],
    causes: [
      { id: 'local_blockage', label: 'Local fixture or branch blockage', base: 18, fieldChecks: ['Trap/branch flow test', 'Cable access assessment'], estimateVariables: ['fixture count', 'access point', 'cable length', 'foreign object'] },
      { id: 'main_blockage', label: 'Main building drain or sewer blockage', base: 12, fieldChecks: ['Cleanout inspection', 'Camera scope after flow restoration'], estimateVariables: ['cleanout access', 'line length', 'root/pipe damage', 'excavation excluded until scope'] },
      { id: 'vent_or_main', label: 'Venting or downstream drainage problem', base: 8, fieldChecks: ['Drain-waste-vent functional test'], estimateVariables: ['affected fixture pattern', 'roof/attic access', 'code correction scope'] },
    ],
    redFlagQuestionIds: ['sewage_present'],
    redFlagPattern: /sewage|blackwater|multiple fixtures|floor drain backup/i,
    redFlagInstruction: 'Stop using water in the home, avoid contaminated water, and dispatch a licensed plumber urgently.',
    sources: [{ title: 'InterNACHI Standards of Practice — Plumbing', url: 'https://www.nachi.org/sop.htm' }],
  },
  no_cooling: {
    id: 'no_cooling', trade: 'hvac', title: 'AC not cooling', confidenceCeiling: 0.75,
    questions: [
      { id: 'thermostat', prompt: 'What mode, setpoint, room temperature, and fan setting appear on the thermostat?', kind: 'text', required: true },
      { id: 'airflow', prompt: 'Is airflow weak at multiple open supply registers?', kind: 'boolean', required: true },
      { id: 'ice', prompt: 'Is ice visible on the refrigerant line or indoor coil cabinet?', kind: 'boolean', required: true },
      { id: 'breaker_retrips', prompt: 'Did the HVAC breaker trip again after one reset?', kind: 'boolean', required: true },
    ],
    evidence: [
      { id: 'thermostat_photo', label: 'Thermostat photo', capture: 'Photograph the full display showing mode, setpoint, room temperature, and fan setting.', supports: ['control_setting'], conflicts: [], weight: 18 },
      { id: 'filter_photo', label: 'Filter and size photo', capture: 'With the system off, photograph the installed filter face, size label, and airflow arrow without opening equipment panels.', supports: ['airflow_restriction'], conflicts: [], weight: 20 },
      { id: 'ice_video', label: 'Visible ice video', capture: 'Turn cooling off. From outside the cabinet, record visible ice and water without touching or chipping it.', supports: ['airflow_restriction', 'refrigerant_or_blower'], conflicts: ['control_setting'], weight: 24 },
      { id: 'outdoor_unit_video', label: 'Outdoor unit video', capture: 'From a safe distance, record the fan, sound, vibration, and debris around the cabinet for 15 seconds.', supports: ['outdoor_unit_fault'], conflicts: [], weight: 18 },
    ],
    causes: [
      { id: 'control_setting', label: 'Thermostat setting, battery, or control issue', base: 16, fieldChecks: ['Thermostat call verification', 'Control voltage test'], estimateVariables: ['thermostat type', 'control wiring', 'replacement compatibility'] },
      { id: 'airflow_restriction', label: 'Restricted airflow from filter, return, coil, or duct', base: 15, fieldChecks: ['Static pressure', 'Temperature split', 'Blower/coil inspection'], estimateVariables: ['filter/coil access', 'cleaning scope', 'blower condition', 'duct restriction'] },
      { id: 'refrigerant_or_blower', label: 'Refrigerant, evaporator, or blower fault', base: 8, fieldChecks: ['Refrigerant circuit diagnostics by qualified technician', 'Blower electrical test'], estimateVariables: ['leak-search time', 'refrigerant type', 'component access', 'certified handling'] },
      { id: 'outdoor_unit_fault', label: 'Outdoor fan, capacitor, contactor, or compressor-side fault', base: 10, fieldChecks: ['Voltage/current/capacitance tests', 'Condenser airflow inspection'], estimateVariables: ['failed component', 'equipment age', 'warranty', 'after-hours availability'] },
    ],
    redFlagQuestionIds: ['breaker_retrips'],
    redFlagPattern: /burning|smoke|spark|gas|carbon monoxide|breaker.*again|water.*electrical/i,
    redFlagInstruction: 'Turn the system off, do not reset the breaker again, and route to emergency services or a licensed HVAC/electrical professional as appropriate.',
    sources: [
      { title: 'ENERGY STAR HVAC Maintenance Checklist', url: 'https://www.energystar.gov/saveathome/heating-cooling/maintenance-checklist' },
      { title: 'CPSC Carbon Monoxide Safety', url: 'https://www.cpsc.gov/safety-education/safety-guides/carbon-monoxide/carbon-monoxide-fact-sheet' },
      { title: 'Carrier AC Troubleshooting', url: 'https://www.carrier.com/us/en/residential/hvac-resources/air-conditioners/troubleshoot-an-ac-not-working/' },
    ],
  },
  breaker_trip: {
    id: 'breaker_trip', trade: 'electrical', title: 'Breaker trip or hot/discolored device', confidenceCeiling: 0.55,
    questions: [
      { id: 'repeat_trip', prompt: 'Did the breaker trip again after one reset?', kind: 'boolean', required: true },
      { id: 'heat_or_odor', prompt: 'Is any outlet, switch, cord, or panel hot, discolored, buzzing, or giving off a burning odor?', kind: 'boolean', required: true },
      { id: 'what_running', prompt: 'What appliances or loads were operating when it tripped?', kind: 'text', required: true },
    ],
    evidence: [
      { id: 'panel_exterior', label: 'Closed panel exterior', capture: 'Photograph labels and breaker positions without opening the panel or touching a hot, wet, buzzing, or damaged panel.', supports: ['overload', 'circuit_fault'], conflicts: [], weight: 10 },
      { id: 'device_photo', label: 'Affected device photo', capture: 'With power off only if safely accessible, photograph discoloration or damage without unplugging a hot or melted plug.', supports: ['device_or_connection_fault'], conflicts: ['simple_overload'], weight: 22 },
      { id: 'active_spark', label: 'Active spark, smoke, or melting', capture: 'Do not approach or record. Evacuate if there is active fire or smoke.', supports: ['circuit_fault'], conflicts: [], weight: 30 },
    ],
    causes: [
      { id: 'overload', label: 'Circuit overload from connected loads', base: 12, fieldChecks: ['Load calculation', 'Clamp-current measurement'], estimateVariables: ['circuit capacity', 'new circuit need', 'panel access', 'permit'] },
      { id: 'device_or_connection_fault', label: 'Damaged receptacle, switch, cord, or loose connection', base: 10, fieldChecks: ['De-energized device inspection', 'Torque and conductor condition'], estimateVariables: ['device count', 'box/conductor damage', 'AFCI/GFCI requirement', 'wall repair excluded'] },
      { id: 'circuit_fault', label: 'Short, ground fault, arc fault, or equipment fault', base: 6, fieldChecks: ['Insulation/continuity testing', 'AFCI/GFCI diagnostics', 'Equipment isolation'], estimateVariables: ['fault location time', 'wire access', 'equipment repair', 'permit/code corrections'] },
      { id: 'simple_overload', label: 'Single temporary load conflict', base: 8, fieldChecks: ['Load verification'], estimateVariables: ['appliance load', 'dedicated circuit requirement'] },
    ],
    redFlagQuestionIds: ['repeat_trip', 'heat_or_odor'],
    redFlagPattern: /spark|smoke|flame|burning|melt|hot panel|shock|tingle|tripped again/i,
    redFlagInstruction: 'Stop using the circuit. Do not repeatedly reset it or open the panel. Evacuate and call 911 for smoke, flame, or active sparking; otherwise dispatch a licensed electrician.',
    sources: [
      { title: 'CPSC Guide to Home Wiring Hazards', url: 'https://www.cpsc.gov/s3fs-public/518.pdf' },
      { title: 'ESFI Home Electrical Safety', url: 'https://www.esfi.org/home-electrical-safety/' },
    ],
  },
  water_heater_issue: {
    id: 'water_heater_issue', trade: 'water_heater', title: 'Water heater leak, noise, or low hot water', confidenceCeiling: 0.62,
    questions: [
      { id: 'fuel', prompt: 'Is the unit electric, natural gas, propane, heat pump, or unknown?', kind: 'text', required: true },
      { id: 'leak_location', prompt: 'Is water at a pipe fitting, drain valve, relief discharge pipe, or tank seam/base?', kind: 'text', required: true },
      { id: 'hot_discharge', prompt: 'Is the relief pipe releasing a large amount of very hot water?', kind: 'boolean', required: true },
      { id: 'gas_or_co', prompt: 'Is there gas/vent odor, soot, a loose vent, or a CO alarm?', kind: 'boolean', required: true },
    ],
    evidence: [
      { id: 'unit_label', label: 'Unit and rating-plate photo', capture: 'Photograph the full unit and rating plate without removing covers.', supports: ['age_or_capacity', 'control_or_element'], conflicts: [], weight: 14 },
      { id: 'leak_origin', label: 'Leak-origin video', capture: 'From a safe distance, record the highest visible wet point, base, pipe connections, drain valve, and relief discharge pipe.', supports: ['connection_leak', 'tank_failure', 'tpr_or_pressure'], conflicts: [], weight: 22 },
      { id: 'vent_exterior', label: 'Gas vent exterior photo', capture: 'For gas units only, photograph visible vent connections from the floor. Do not touch, adjust, or operate the appliance.', supports: ['vent_or_combustion'], conflicts: [], weight: 18 },
      { id: 'rust_or_sediment', label: 'Rust, corrosion, or sediment evidence', capture: 'Photograph visible corrosion or rusty hot water. Do not drain or operate the relief valve unless directed by a qualified professional.', supports: ['tank_failure', 'sediment'], conflicts: [], weight: 18 },
    ],
    causes: [
      { id: 'connection_leak', label: 'Pipe connection, drain valve, or fitting leak', base: 14, fieldChecks: ['Dry-and-observe leak origin', 'Pressure/connection inspection'], estimateVariables: ['connection type', 'valve/fitting count', 'shutoff condition', 'access'] },
      { id: 'tank_failure', label: 'Tank corrosion or vessel leak', base: 8, fieldChecks: ['Tank/body inspection', 'Replacement sizing and code review'], estimateVariables: ['tank type/capacity', 'fuel/venting', 'drain pan', 'permit/disposal', 'access'] },
      { id: 'tpr_or_pressure', label: 'Relief valve, excessive pressure, or thermal expansion issue', base: 8, fieldChecks: ['Static/thermal pressure', 'Expansion tank', 'TPR evaluation by professional'], estimateVariables: ['PRV/expansion tank', 'valve/discharge piping', 'pressure correction'] },
      { id: 'sediment', label: 'Sediment or scale reducing capacity', base: 10, fieldChecks: ['Age/water-quality review', 'Element/burner recovery test'], estimateVariables: ['tank age', 'flush suitability', 'element/burner parts', 'replacement alternative'] },
      { id: 'control_or_element', label: 'Power, thermostat, element, pilot, or control issue', base: 10, fieldChecks: ['Fuel/power verification', 'Control and heating-component tests'], estimateVariables: ['fuel type', 'failed component', 'warranty', 'electrical/gas access'] },
      { id: 'vent_or_combustion', label: 'Gas venting or combustion problem', base: 4, fieldChecks: ['Combustion/vent inspection by qualified technician'], estimateVariables: ['vent correction', 'combustion repair', 'code/permit scope'] },
      { id: 'age_or_capacity', label: 'Capacity, demand, or age-related performance issue', base: 8, fieldChecks: ['Recovery/capacity assessment'], estimateVariables: ['household demand', 'tank capacity', 'incoming water temperature', 'replacement options'] },
    ],
    redFlagQuestionIds: ['hot_discharge', 'gas_or_co'],
    redFlagPattern: /gas odor|carbon monoxide|CO alarm|soot|very hot water|relief.*discharg|tank seam.*leak/i,
    redFlagInstruction: 'Do not cap the relief pipe. For gas or CO concerns, leave the home and call emergency services. For hot relief discharge or tank-body leaks, shut down only if safe and dispatch a qualified technician urgently.',
    sources: [
      { title: 'ENERGY STAR Water Heater Replacement Guidance', url: 'https://www.energystar.gov/products/energy_star_home_upgrade/super_efficient_water_heater' },
      { title: 'CPSC Carbon Monoxide Fact Sheet', url: 'https://www.cpsc.gov/safety-education/safety-guides/carbon-monoxide/carbon-monoxide-fact-sheet' },
      { title: 'A. O. Smith Water Heater Support', url: 'https://www.hotwater.com/info-center/product-support.html' },
    ],
  },
}

export type ProtocolEvaluationInput = {
  protocolId: ProtocolId
  answers: Record<string, string | boolean | number>
  observedEvidenceIds: string[]
}

export type ProtocolEvaluation = {
  protocolId: ProtocolId
  safetyStop: boolean
  safetyInstruction: string | null
  unansweredQuestions: EvidenceQuestion[]
  captureRequests: { id: string; label: string; capture: string }[]
  hypotheses: { id: string; label: string; confidence: number; supportingEvidence: string[]; conflictingEvidence: string[] }[]
  requiredFieldChecks: string[]
  estimateVariables: string[]
  confidenceCeiling: number
  limitations: string[]
  sources: EvidenceProtocol['sources']
}

export function listEvidenceProtocols(): EvidenceProtocol[] {
  return Object.values(protocols)
}

export function evaluateEvidenceProtocol(input: ProtocolEvaluationInput): ProtocolEvaluation {
  const protocol = protocols[input.protocolId]
  const answerText = Object.values(input.answers).map(String).join(' ')
  const safetyStop = protocol.redFlagPattern.test(answerText)
    || protocol.redFlagQuestionIds.some((id) => input.answers[id] === true)
    || input.observedEvidenceIds.some((id) => /active_spark|sewage_visible/.test(id))
  const observed = protocol.evidence.filter((item) => input.observedEvidenceIds.includes(item.id))
  const hypotheses = protocol.causes.map((cause) => {
    const supporting = observed.filter((item) => item.supports.includes(cause.id))
    const conflicting = observed.filter((item) => item.conflicts.includes(cause.id))
    const score = cause.base + supporting.reduce((sum, item) => sum + item.weight, 0) - conflicting.reduce((sum, item) => sum + item.weight, 0)
    return {
      id: cause.id,
      label: cause.label,
      confidence: safetyStop ? 0 : Math.max(0, Math.min(protocol.confidenceCeiling, score / 100)),
      supportingEvidence: supporting.map((item) => item.label),
      conflictingEvidence: conflicting.map((item) => item.label),
      cause,
    }
  }).filter((item) => item.supportingEvidence.length > 0 && item.confidence > 0).sort((a, b) => b.confidence - a.confidence)

  const activeCauses = hypotheses.slice(0, 3).map((item) => item.cause)
  return {
    protocolId: protocol.id,
    safetyStop,
    safetyInstruction: safetyStop ? protocol.redFlagInstruction : null,
    unansweredQuestions: protocol.questions.filter((question) => question.required && !(question.id in input.answers)),
    captureRequests: protocol.evidence.filter((item) => !input.observedEvidenceIds.includes(item.id)).map(({ id, label, capture }) => ({ id, label, capture })),
    hypotheses: hypotheses.slice(0, 3).map(({ cause: _cause, ...item }) => item),
    requiredFieldChecks: [...new Set(activeCauses.flatMap((cause) => cause.fieldChecks))],
    estimateVariables: [...new Set(activeCauses.flatMap((cause) => cause.estimateVariables))],
    confidenceCeiling: protocol.confidenceCeiling,
    limitations: [
      'This is a pre-visit differential, not a confirmed diagnosis or final quote.',
      'Photos and videos cannot prove concealed conditions, code compliance, pressure, voltage, refrigerant charge, combustion safety, or internal component state.',
      'A licensed professional must confirm the issue, scope, and final price after required field checks.',
    ],
    sources: protocol.sources,
  }
}
