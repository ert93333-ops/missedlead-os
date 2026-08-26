import Database from 'better-sqlite3'
import {
  calculateMemberRepairPrice,
  remainingAnnualVisits,
  validatePlanCompliance,
  type ComplianceProfile,
  type MaintenancePlanTerms,
  type MemberRepairPrice,
} from '../src/maintenance'
import { calculateContinuityScore, evaluateAssetHealth, prioritizeActions, type HomeAsset } from '../src/homePassport'
import {
  buildThresholdSnapshot,
  evaluateThresholdCrossings,
  type ThresholdEventCandidate,
  type ThresholdRuleId,
  type ThresholdSeverity,
  type ThresholdSnapshot,
} from '../src/maintenanceThresholds'
import { matchHomeCareProviders, type HomeCareService, type HomeCareTeam, type ServiceProvider } from '../src/homeCare'

export type Membership = {
  id: string
  technician: { id: string; name: string; phone: string }
  property: { id: string; customerName: string; address: string }
  terms: MaintenancePlanTerms
  compliance: ComplianceProfile
  repairCreditCents: number
  status: 'active' | 'paused'
  createdAt: string
}

export type MaintenanceThresholdEvent = {
  id: string
  planId: string
  assetId: string
  ruleId: ThresholdRuleId
  previousLevel: 'low' | 'medium' | 'high'
  currentLevel: 'low' | 'medium' | 'high'
  severity: ThresholdSeverity
  triggeredAt: string
  evidenceSnapshot: string[]
  recommendedProtocolId: string | null
  assignedTechnicianId: string
  status: 'open' | 'acknowledged' | 'scheduled' | 'resolved' | 'dismissed'
  safetyStop: boolean
  cooldownUntil: string
}

export type WorkOrder = {
  id: string
  planId: string
  providerId: string
  thresholdEventId: string | null
  service: HomeCareService
  summary: string
  status: 'offered' | 'accepted' | 'scheduled' | 'completed' | 'cancelled'
  scheduledAt: string | null
  finalOutcome: null | {
    technicianConfirmedIssue: string
    parts: string[]
    laborMinutes: number
    finalPriceCents: number
    outcome: 'resolved' | 'follow_up_required' | 'no_fault_found'
    aiAssessmentOutcome: 'accepted' | 'corrected' | 'rejected'
  }
  createdAt: string
}

export function createMaintenanceStore(filename: string) {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS technicians (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, address TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id TEXT PRIMARY KEY,
      technician_id TEXT NOT NULL REFERENCES technicians(id),
      property_id TEXT NOT NULL REFERENCES properties(id),
      terms_json TEXT NOT NULL,
      compliance_json TEXT NOT NULL,
      repair_credit_cents INTEGER NOT NULL CHECK (repair_credit_cents >= 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maintenance_visits (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES maintenance_plans(id),
      technician_id TEXT,
      completed_at TEXT NOT NULL,
      notes TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_repair_quotes (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES maintenance_plans(id),
      labor_cents INTEGER NOT NULL,
      parts_cents INTEGER NOT NULL,
      price_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS home_assets (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      installed_year INTEGER NOT NULL,
      expected_life_years INTEGER NOT NULL,
      service_interval_months INTEGER NOT NULL,
      last_serviced_at TEXT,
      condition TEXT NOT NULL CHECK (condition IN ('good', 'watch', 'urgent')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS asset_threshold_state (
      asset_id TEXT PRIMARY KEY REFERENCES home_assets(id) ON DELETE CASCADE,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maintenance_threshold_events (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES maintenance_plans(id),
      asset_id TEXT NOT NULL REFERENCES home_assets(id),
      rule_id TEXT NOT NULL,
      previous_level TEXT NOT NULL,
      current_level TEXT NOT NULL,
      severity TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      evidence_snapshot_json TEXT NOT NULL,
      recommended_protocol_id TEXT,
      assigned_technician_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'scheduled', 'resolved', 'dismissed')),
      safety_stop INTEGER NOT NULL,
      cooldown_until TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_threshold_event
      ON maintenance_threshold_events(asset_id, rule_id)
      WHERE status IN ('open', 'acknowledged', 'scheduled');
    CREATE TABLE IF NOT EXISTS service_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      trade TEXT NOT NULL,
      active INTEGER NOT NULL,
      license_verified INTEGER NOT NULL,
      insured INTEGER NOT NULL,
      postal_prefixes_json TEXT NOT NULL,
      urgent_available INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS home_care_team_assignments (
      plan_id TEXT NOT NULL REFERENCES maintenance_plans(id),
      provider_id TEXT NOT NULL REFERENCES service_providers(id),
      relationship TEXT NOT NULL CHECK (relationship IN ('assigned', 'backup')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (plan_id, provider_id)
    );
    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES maintenance_plans(id),
      provider_id TEXT NOT NULL REFERENCES service_providers(id),
      threshold_event_id TEXT REFERENCES maintenance_threshold_events(id),
      service TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('offered', 'accepted', 'scheduled', 'completed', 'cancelled')),
      scheduled_at TEXT,
      final_outcome_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  const planColumns = db.pragma('table_info(maintenance_plans)') as { name: string }[]
  if (!planColumns.some((column) => column.name === 'compliance_json')) {
    db.exec(`ALTER TABLE maintenance_plans ADD COLUMN compliance_json TEXT NOT NULL DEFAULT '{"jurisdiction":"NC","legalMode":"scheduled_maintenance","contractorLicenseVerified":false,"serviceContractRegistrationVerified":false}'`)
  }
  const visitColumns = db.pragma('table_info(maintenance_visits)') as { name: string }[]
  if (!visitColumns.some((column) => column.name === 'technician_id')) {
    db.exec('ALTER TABLE maintenance_visits ADD COLUMN technician_id TEXT')
  }

  const createTechnician = db.prepare('INSERT INTO technicians (id, name, phone, created_at) VALUES (?, ?, ?, ?)')
  const createProperty = db.prepare('INSERT INTO properties (id, customer_name, address, created_at) VALUES (?, ?, ?, ?)')
  const createPlan = db.prepare(`INSERT INTO maintenance_plans (id, technician_id, property_id, terms_json, compliance_json, repair_credit_cents, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`)
  const getPlan = db.prepare(`SELECT p.*, t.name technician_name, t.phone technician_phone, r.customer_name, r.address
    FROM maintenance_plans p JOIN technicians t ON t.id=p.technician_id JOIN properties r ON r.id=p.property_id WHERE p.id=?`)
  const countVisits = db.prepare(`SELECT COUNT(*) count FROM maintenance_visits WHERE plan_id=? AND substr(completed_at,1,4)=?`)
  const insertVisit = db.prepare('INSERT INTO maintenance_visits (id, plan_id, technician_id, completed_at, notes) VALUES (?, ?, ?, ?, ?)')
  const insertQuote = db.prepare(`INSERT INTO member_repair_quotes (id, plan_id, labor_cents, parts_cents, price_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
  const insertHomeAsset = db.prepare(`INSERT INTO home_assets
    (id, property_id, category, label, installed_year, expected_life_years, service_interval_months, last_serviced_at, condition, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const listHomeAssets = db.prepare('SELECT * FROM home_assets WHERE property_id=? ORDER BY created_at ASC')
  const insertThresholdState = db.prepare('INSERT OR REPLACE INTO asset_threshold_state (asset_id, snapshot_json, updated_at) VALUES (?, ?, ?)')
  const getThresholdState = db.prepare('SELECT snapshot_json FROM asset_threshold_state WHERE asset_id=?')
  const insertThresholdEvent = db.prepare(`INSERT INTO maintenance_threshold_events
    (id, plan_id, asset_id, rule_id, previous_level, current_level, severity, triggered_at, evidence_snapshot_json,
     recommended_protocol_id, assigned_technician_id, status, safety_stop, cooldown_until, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
  const listThresholdEvents = db.prepare('SELECT * FROM maintenance_threshold_events WHERE plan_id=? ORDER BY triggered_at DESC')
  const listActiveThresholdEventsForAsset = db.prepare(`SELECT rule_id, status FROM maintenance_threshold_events
    WHERE asset_id=? AND status IN ('open', 'acknowledged', 'scheduled')`)
  const getThresholdEvent = db.prepare('SELECT * FROM maintenance_threshold_events WHERE id=?')
  const countActiveSafetyEvents = db.prepare(`SELECT COUNT(*) count FROM maintenance_threshold_events
    WHERE plan_id=? AND safety_stop=1 AND status IN ('open', 'acknowledged', 'scheduled')`)
  const updateThresholdEvent = db.prepare('UPDATE maintenance_threshold_events SET status=?, updated_at=? WHERE id=?')
  const deleteThresholdEvents = db.prepare('DELETE FROM maintenance_threshold_events WHERE plan_id=?')
  const deleteThresholdStates = db.prepare('DELETE FROM asset_threshold_state WHERE asset_id IN (SELECT id FROM home_assets WHERE property_id=?)')
  const listVisitTechnicians = db.prepare('SELECT technician_id FROM maintenance_visits WHERE plan_id=? ORDER BY completed_at ASC')
  const deleteQuotes = db.prepare('DELETE FROM member_repair_quotes WHERE plan_id=?')
  const deleteVisits = db.prepare('DELETE FROM maintenance_visits WHERE plan_id=?')
  const deleteAssets = db.prepare('DELETE FROM home_assets WHERE property_id=?')
  const deletePlan = db.prepare('DELETE FROM maintenance_plans WHERE id=?')
  const deleteProperty = db.prepare('DELETE FROM properties WHERE id=?')
  const deleteTechnician = db.prepare('DELETE FROM technicians WHERE id=?')
  const insertServiceProvider = db.prepare(`INSERT INTO service_providers
    (id, name, role, trade, active, license_verified, insured, postal_prefixes_json, urgent_available, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const getServiceProvider = db.prepare('SELECT * FROM service_providers WHERE id=?')
  const listServiceProviders = db.prepare('SELECT * FROM service_providers ORDER BY created_at ASC')
  const assignServiceProvider = db.prepare(`INSERT OR REPLACE INTO home_care_team_assignments
    (plan_id, provider_id, relationship, created_at) VALUES (?, ?, ?, ?)`)
  const listTeamAssignments = db.prepare('SELECT provider_id, relationship FROM home_care_team_assignments WHERE plan_id=?')
  const deleteTeamAssignments = db.prepare('DELETE FROM home_care_team_assignments WHERE plan_id=?')
  const insertWorkOrder = db.prepare(`INSERT INTO work_orders
    (id, plan_id, provider_id, threshold_event_id, service, summary, status, scheduled_at, final_outcome_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'offered', NULL, NULL, ?, ?)`)
  const getWorkOrder = db.prepare('SELECT * FROM work_orders WHERE id=?')
  const listWorkOrders = db.prepare('SELECT * FROM work_orders WHERE plan_id=? ORDER BY created_at DESC')
  const updateWorkOrderStatus = db.prepare('UPDATE work_orders SET status=?, scheduled_at=?, final_outcome_json=?, updated_at=? WHERE id=?')
  const deleteWorkOrders = db.prepare('DELETE FROM work_orders WHERE plan_id=?')

  const mapMembership = (row: Record<string, unknown>): Membership => ({
    id: String(row.id),
    technician: { id: String(row.technician_id), name: String(row.technician_name), phone: String(row.technician_phone) },
    property: { id: String(row.property_id), customerName: String(row.customer_name), address: String(row.address) },
    terms: JSON.parse(String(row.terms_json)) as MaintenancePlanTerms,
    compliance: JSON.parse(String(row.compliance_json)) as ComplianceProfile,
    repairCreditCents: Number(row.repair_credit_cents),
    status: String(row.status) as Membership['status'],
    createdAt: String(row.created_at),
  })
  const mapAsset = (row: Record<string, unknown>): HomeAsset => ({
    id: String(row.id),
    category: String(row.category) as HomeAsset['category'],
    label: String(row.label),
    installedYear: Number(row.installed_year),
    expectedLifeYears: Number(row.expected_life_years),
    serviceIntervalMonths: Number(row.service_interval_months),
    lastServicedAt: row.last_serviced_at ? String(row.last_serviced_at) : null,
    condition: String(row.condition) as HomeAsset['condition'],
  })
  const mapThresholdEvent = (row: Record<string, unknown>): MaintenanceThresholdEvent => ({
    id: String(row.id),
    planId: String(row.plan_id),
    assetId: String(row.asset_id),
    ruleId: String(row.rule_id) as ThresholdRuleId,
    previousLevel: String(row.previous_level) as MaintenanceThresholdEvent['previousLevel'],
    currentLevel: String(row.current_level) as MaintenanceThresholdEvent['currentLevel'],
    severity: String(row.severity) as ThresholdSeverity,
    triggeredAt: String(row.triggered_at),
    evidenceSnapshot: JSON.parse(String(row.evidence_snapshot_json)) as string[],
    recommendedProtocolId: row.recommended_protocol_id ? String(row.recommended_protocol_id) : null,
    assignedTechnicianId: String(row.assigned_technician_id),
    status: String(row.status) as MaintenanceThresholdEvent['status'],
    safetyStop: Boolean(row.safety_stop),
    cooldownUntil: String(row.cooldown_until),
  })
  const mapServiceProvider = (row: Record<string, unknown>): ServiceProvider => ({
    id: String(row.id),
    name: String(row.name),
    role: String(row.role) as ServiceProvider['role'],
    trade: String(row.trade) as ServiceProvider['trade'],
    active: Boolean(row.active),
    licenseVerified: Boolean(row.license_verified),
    insured: Boolean(row.insured),
    postalCodePrefixes: JSON.parse(String(row.postal_prefixes_json)) as string[],
    availableForUrgentDispatch: Boolean(row.urgent_available),
  })
  const mapWorkOrder = (row: Record<string, unknown>): WorkOrder => ({
    id: String(row.id),
    planId: String(row.plan_id),
    providerId: String(row.provider_id),
    thresholdEventId: row.threshold_event_id ? String(row.threshold_event_id) : null,
    service: String(row.service) as HomeCareService,
    summary: String(row.summary),
    status: String(row.status) as WorkOrder['status'],
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
    finalOutcome: row.final_outcome_json ? JSON.parse(String(row.final_outcome_json)) as NonNullable<WorkOrder['finalOutcome']> : null,
    createdAt: String(row.created_at),
  })

  const createMembership = db.transaction((input: {
    technicianName: string
    technicianPhone: string
    customerName: string
    propertyAddress: string
    terms: MaintenancePlanTerms
    compliance: ComplianceProfile
    initialRepairCreditCents: number
  }) => {
    const complianceErrors = validatePlanCompliance(input.terms, input.compliance)
    if (complianceErrors.length > 0) throw new Error(complianceErrors.join('; '))
    const createdAt = new Date().toISOString()
    const technicianId = crypto.randomUUID()
    const propertyId = crypto.randomUUID()
    const planId = crypto.randomUUID()
    createTechnician.run(technicianId, input.technicianName, input.technicianPhone, createdAt)
    createProperty.run(propertyId, input.customerName, input.propertyAddress, createdAt)
    createPlan.run(planId, technicianId, propertyId, JSON.stringify(input.terms), JSON.stringify(input.compliance), input.initialRepairCreditCents, createdAt)
    return findMembership(planId)!
  })

  function findMembership(id: string): Membership | null {
    const row = getPlan.get(id) as Record<string, unknown> | undefined
    return row ? mapMembership(row) : null
  }

  const quoteTransaction = db.transaction((plan: Membership, laborCents: number, partsCents: number) => {
    const price = calculateMemberRepairPrice({ laborCents, partsCents, availableCreditCents: plan.repairCreditCents }, plan.terms)
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    insertQuote.run(id, plan.id, laborCents, partsCents, JSON.stringify(price), createdAt)
    return { id, planId: plan.id, price, createdAt }
  })

  return {
    createMembership,
    findMembership,
    completeVisit(planId: string, notes: string, completedAt = new Date().toISOString(), technicianId?: string) {
      const plan = findMembership(planId)
      if (!plan) return null
      const year = completedAt.slice(0, 4)
      const before = Number((countVisits.get(planId, year) as { count: number }).count)
      insertVisit.run(crypto.randomUUID(), planId, technicianId ?? plan.technician.id, completedAt, notes)
      const after = before + 1
      return { completedVisitsThisYear: after, remainingIncludedVisits: remainingAnnualVisits(after, plan.terms), completedAt }
    },
    createRepairQuote(planId: string, laborCents: number, partsCents: number): { id: string; planId: string; price: MemberRepairPrice; createdAt: string } | null {
      const plan = findMembership(planId)
      return plan ? quoteTransaction(plan, laborCents, partsCents) : null
    },
    addHomeAsset(planId: string, input: Omit<HomeAsset, 'id'>): HomeAsset | null {
      const plan = findMembership(planId)
      if (!plan) return null
      const asset = { ...input, id: crypto.randomUUID() }
      insertHomeAsset.run(
        asset.id, plan.property.id, asset.category, asset.label, asset.installedYear, asset.expectedLifeYears,
        asset.serviceIntervalMonths, asset.lastServicedAt, asset.condition, new Date().toISOString(),
      )
      const initialSnapshot: ThresholdSnapshot = { score: 100, riskLevel: 'low', condition: 'good', overdueDays: 0 }
      insertThresholdState.run(asset.id, JSON.stringify(initialSnapshot), new Date().toISOString())
      return asset
    },
    getHomePassport(planId: string) {
      const plan = findMembership(planId)
      if (!plan) return null
      const assets = (listHomeAssets.all(plan.property.id) as Record<string, unknown>[]).map(mapAsset)
      const technicianIds = (listVisitTechnicians.all(planId) as { technician_id: string | null }[])
        .map((row) => row.technician_id)
        .filter((id): id is string => Boolean(id))
      return {
        membership: plan,
        assets,
        prioritizedActions: prioritizeActions(assets),
        continuityScore: calculateContinuityScore(technicianIds, plan.technician.id),
      }
    },
    evaluateThresholds(planId: string, options: { now?: string; safetyStopAssetId?: string; safetyEvidence?: string[] } = {}) {
      const plan = findMembership(planId)
      if (!plan) return null
      const now = options.now ? new Date(options.now) : new Date()
      const assets = (listHomeAssets.all(plan.property.id) as Record<string, unknown>[]).map(mapAsset)
      const created: MaintenanceThresholdEvent[] = []
      for (const asset of assets) {
        const stored = getThresholdState.get(asset.id) as { snapshot_json: string } | undefined
        const previous = stored
          ? JSON.parse(stored.snapshot_json) as ThresholdSnapshot
          : { score: 100, riskLevel: 'low', condition: 'good', overdueDays: 0 } satisfies ThresholdSnapshot
        const current = buildThresholdSnapshot(asset, evaluateAssetHealth(asset, now), now)
        const openEvents = listActiveThresholdEventsForAsset.all(asset.id) as { rule_id: ThresholdRuleId; status: 'open' | 'acknowledged' | 'scheduled' }[]
        const candidates = evaluateThresholdCrossings({
          asset,
          previous,
          current,
          openEvents: openEvents.map((event) => ({ ruleId: event.rule_id, status: event.status })),
          safetyStop: options.safetyStopAssetId === asset.id,
          safetyEvidence: options.safetyEvidence,
        })
        for (const candidate of candidates) {
          const event = createThresholdEvent(plan, asset, candidate, now)
          created.push(event)
        }
        insertThresholdState.run(asset.id, JSON.stringify(current), now.toISOString())
      }
      return { created, events: listEvents(planId) }
    },
    listThresholdEvents(planId: string) {
      return findMembership(planId) ? listEvents(planId) : null
    },
    hasOpenSafetyStop(planId: string) {
      return Number((countActiveSafetyEvents.get(planId) as { count: number }).count) > 0
    },
    transitionThresholdEvent(eventId: string, status: MaintenanceThresholdEvent['status']) {
      const row = getThresholdEvent.get(eventId) as Record<string, unknown> | undefined
      if (!row) return { error: 'not_found' as const }
      const event = mapThresholdEvent(row)
      const allowed: Record<MaintenanceThresholdEvent['status'], MaintenanceThresholdEvent['status'][]> = {
        open: ['acknowledged', 'scheduled', 'dismissed'],
        acknowledged: ['scheduled', 'resolved', 'dismissed'],
        scheduled: ['resolved'],
        resolved: [],
        dismissed: [],
      }
      if (!allowed[event.status].includes(status)) return { error: 'invalid_transition' as const, event }
      updateThresholdEvent.run(status, new Date().toISOString(), eventId)
      return { event: mapThresholdEvent(getThresholdEvent.get(eventId) as Record<string, unknown>) }
    },
    createServiceProvider(input: Omit<ServiceProvider, 'id'>) {
      const provider: ServiceProvider = { ...input, id: crypto.randomUUID() }
      insertServiceProvider.run(
        provider.id, provider.name, provider.role, provider.trade, provider.active ? 1 : 0,
        provider.licenseVerified ? 1 : 0, provider.insured ? 1 : 0, JSON.stringify(provider.postalCodePrefixes),
        provider.availableForUrgentDispatch ? 1 : 0, new Date().toISOString(),
      )
      return provider
    },
    assignHomeCareProvider(planId: string, providerId: string, relationship: 'assigned' | 'backup') {
      if (!findMembership(planId)) return { error: 'membership_not_found' as const }
      const row = getServiceProvider.get(providerId) as Record<string, unknown> | undefined
      if (!row) return { error: 'provider_not_found' as const }
      assignServiceProvider.run(planId, providerId, relationship, new Date().toISOString())
      return { provider: mapServiceProvider(row), relationship }
    },
    getHomeCareTeam(planId: string) {
      const plan = findMembership(planId)
      if (!plan) return null
      const assignments = listTeamAssignments.all(planId) as { provider_id: string; relationship: 'assigned' | 'backup' }[]
      const providers = assignments.map((assignment) => {
        const row = getServiceProvider.get(assignment.provider_id) as Record<string, unknown>
        return { provider: mapServiceProvider(row), relationship: assignment.relationship }
      })
      return { planId, propertyId: plan.property.id, coordinatorId: plan.technician.id, providers }
    },
    matchProviders(planId: string, request: { service: HomeCareService; postalCode: string; urgent: boolean; safetyStop: boolean }) {
      const team = this.getHomeCareTeam(planId)
      if (!team) return null
      const homeCareTeam: HomeCareTeam = {
        propertyId: team.propertyId,
        coordinatorId: team.coordinatorId,
        assignedProviderIds: team.providers.filter((item) => item.relationship === 'assigned').map((item) => item.provider.id),
        backupProviderIds: team.providers.filter((item) => item.relationship === 'backup').map((item) => item.provider.id),
      }
      const providers = (listServiceProviders.all() as Record<string, unknown>[]).map(mapServiceProvider)
      return matchHomeCareProviders(request, homeCareTeam, providers)
    },
    createWorkOrder(input: { planId: string; providerId: string; thresholdEventId?: string; service: HomeCareService; summary: string }) {
      if (!findMembership(input.planId)) return { error: 'membership_not_found' as const }
      if (!getServiceProvider.get(input.providerId)) return { error: 'provider_not_found' as const }
      if (input.thresholdEventId) {
        const event = getThresholdEvent.get(input.thresholdEventId) as Record<string, unknown> | undefined
        if (!event || String(event.plan_id) !== input.planId) return { error: 'threshold_event_not_found' as const }
      }
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      insertWorkOrder.run(id, input.planId, input.providerId, input.thresholdEventId ?? null, input.service, input.summary, now, now)
      return { workOrder: mapWorkOrder(getWorkOrder.get(id) as Record<string, unknown>) }
    },
    listWorkOrders(planId: string) {
      return findMembership(planId) ? (listWorkOrders.all(planId) as Record<string, unknown>[]).map(mapWorkOrder) : null
    },
    transitionWorkOrder(workOrderId: string, input: {
      status: 'accepted' | 'scheduled' | 'completed' | 'cancelled'
      scheduledAt?: string
      finalOutcome?: NonNullable<WorkOrder['finalOutcome']>
    }) {
      const row = getWorkOrder.get(workOrderId) as Record<string, unknown> | undefined
      if (!row) return { error: 'not_found' as const }
      const workOrder = mapWorkOrder(row)
      const allowed: Record<WorkOrder['status'], WorkOrder['status'][]> = {
        offered: ['accepted', 'cancelled'],
        accepted: ['scheduled', 'cancelled'],
        scheduled: ['completed', 'cancelled'],
        completed: [],
        cancelled: [],
      }
      if (!allowed[workOrder.status].includes(input.status)) return { error: 'invalid_transition' as const, workOrder }
      if (input.status === 'scheduled' && !input.scheduledAt) return { error: 'scheduled_at_required' as const, workOrder }
      if (input.status === 'completed' && !input.finalOutcome) return { error: 'final_outcome_required' as const, workOrder }
      const scheduledAt = input.scheduledAt ?? workOrder.scheduledAt
      const finalOutcome = input.finalOutcome ?? workOrder.finalOutcome
      updateWorkOrderStatus.run(input.status, scheduledAt, finalOutcome ? JSON.stringify(finalOutcome) : null, new Date().toISOString(), workOrderId)
      return { workOrder: mapWorkOrder(getWorkOrder.get(workOrderId) as Record<string, unknown>) }
    },
    exportHomeownerData(planId: string) {
      return this.getHomePassport(planId)
    },
    deleteMembership: db.transaction((planId: string) => {
      const plan = findMembership(planId)
      if (!plan) return false
      deleteQuotes.run(planId)
      deleteVisits.run(planId)
      deleteWorkOrders.run(planId)
      deleteThresholdEvents.run(planId)
      deleteThresholdStates.run(plan.property.id)
      deleteTeamAssignments.run(planId)
      deleteAssets.run(plan.property.id)
      deletePlan.run(planId)
      deleteProperty.run(plan.property.id)
      deleteTechnician.run(plan.technician.id)
      return true
    }),
    close() { db.close() },
  }

  function listEvents(planId: string): MaintenanceThresholdEvent[] {
    return (listThresholdEvents.all(planId) as Record<string, unknown>[]).map(mapThresholdEvent)
  }

  function createThresholdEvent(plan: Membership, asset: HomeAsset, candidate: ThresholdEventCandidate, now: Date): MaintenanceThresholdEvent {
    const id = crypto.randomUUID()
    const triggeredAt = now.toISOString()
    const cooldownUntil = new Date(now.getTime() + (candidate.bypassCooldown ? 0 : 30 * 86_400_000)).toISOString()
    insertThresholdEvent.run(
      id, plan.id, asset.id, candidate.ruleId, candidate.previousLevel, candidate.currentLevel, candidate.severity,
      triggeredAt, JSON.stringify(candidate.evidenceSnapshot), candidate.recommendedProtocolId, plan.technician.id,
      candidate.safetyStop ? 1 : 0, cooldownUntil, triggeredAt,
    )
    return mapThresholdEvent(getThresholdEvent.get(id) as Record<string, unknown>)
  }
}

export type MaintenanceStore = ReturnType<typeof createMaintenanceStore>
