import request from 'supertest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { createCaseStore, type CaseStore } from './db'
import { createEvidenceStorage, type EvidenceStorage } from './evidenceStorage'
import type { AuthConfig } from './auth'
import { createMaintenanceStore, type MaintenanceStore } from './maintenanceDb'
import { charlottePilotTerms } from '../src/maintenance'
import { createPlatformStore, type PlatformStore } from './platformDb'
import { createIdentityStore, type IdentityStore } from './identityDb'

let store: CaseStore
let evidenceStorage: EvidenceStorage
let evidenceRoot: string
let maintenance: MaintenanceStore
let platform: PlatformStore
let identity: IdentityStore

beforeEach(async () => {
  store = createCaseStore(':memory:')
  evidenceRoot = await mkdtemp(join(tmpdir(), 'missedlead-evidence-'))
  evidenceStorage = createEvidenceStorage(evidenceRoot)
  maintenance = createMaintenanceStore(':memory:')
  platform = createPlatformStore(':memory:')
  identity = createIdentityStore(':memory:')
})
afterEach(async () => {
  store.close()
  maintenance.close()
  platform.close()
  identity.close()
  await rm(evidenceRoot, { recursive: true, force: true })
})

const validCase = {
  customerName: 'Alex Morgan', phone: '+15125550142', summary: 'Water under kitchen sink', consentToText: true,
  evidence: [
    { label: 'Leak overview video', observed: true, weight: 18 },
    { label: 'P-trap close-up', observed: true, weight: 16 },
  ],
}
const testAuth: AuthConfig = { accessCode: 'test-access-code', sessionSecret: 'test-session-secret-that-is-long', secureCookies: false }
const roleAuth: AuthConfig = {
  accessCode: 'unused-bootstrap-code',
  sessionSecret: 'test-session-secret-that-is-long',
  secureCookies: false,
  users: [
    { id: 'home-1', organizationId: 'household-1', email: 'home@example.com', displayName: 'Home Owner', role: 'homeowner', accessCode: 'home-code' },
    { id: 'home-2', organizationId: 'household-2', email: 'other@example.com', displayName: 'Other Owner', role: 'homeowner', accessCode: 'other-code' },
    { id: 'provider-1', organizationId: 'provider-org', email: 'pro@example.com', displayName: 'Service Pro', role: 'provider', accessCode: 'pro-code' },
    { id: 'admin-1', organizationId: 'platform', email: 'admin@example.com', displayName: 'Operator', role: 'admin', accessCode: 'admin-code' },
  ],
}

async function authenticatedAgent(options: Parameters<typeof createApp>[1] = {}) {
  const agent = request.agent(createApp(store, { ...options, auth: testAuth }))
  await agent.post('/api/session').send({ accessCode: testAuth.accessCode }).expect(200)
  return agent
}

describe('authentication', () => {
  it('fails closed without auth configuration and rejects a bad code', async () => {
    await request(createApp(store)).post('/api/cases').send(validCase).expect(503, { error: 'auth_not_configured' })
    await request(createApp(store, { auth: testAuth })).post('/api/session').send({ accessCode: 'wrong' }).expect(401)
  })

  it('requires a session for protected APIs', async () => {
    await request(createApp(store, { auth: testAuth })).post('/api/cases').send(validCase).expect(401, { error: 'authentication_required' })
  })

  it('issues organization-scoped role sessions and denies cross-role access', async () => {
    const homeowner = request.agent(createApp(store, { auth: roleAuth }))
    await homeowner.post('/api/session').send({ accessCode: 'home-code' }).expect(400, { error: 'email_required' })
    const login = await homeowner.post('/api/session').send({ email: 'HOME@example.com', accessCode: 'home-code' }).expect(200)
    expect(login.body.session).toMatchObject({
      id: 'home-1', organizationId: 'household-1', role: 'homeowner', email: 'home@example.com',
    })
    const session = await homeowner.get('/api/session').expect(200)
    expect(session.body.session).toMatchObject({ organizationId: 'household-1', role: 'homeowner' })
    await homeowner.get('/api/homeowner/health').expect(200, { role: 'homeowner' })
    await homeowner.get('/api/provider/health').expect(403, { error: 'insufficient_role' })
    await homeowner.get('/api/admin/health').expect(403, { error: 'insufficient_role' })

    const provider = request.agent(createApp(store, { auth: roleAuth }))
    await provider.post('/api/session').send({ email: 'pro@example.com', accessCode: 'pro-code' }).expect(200)
    await provider.get('/api/provider/health').expect(200, { role: 'provider' })
    await provider.get('/api/homeowner/health').expect(403, { error: 'insufficient_role' })
  })

  it('isolates homeowner cases by organization while allowing admin review', async () => {
    const app = createApp(store, { auth: roleAuth })
    const owner = request.agent(app)
    await owner.post('/api/session').send({ email: 'home@example.com', accessCode: 'home-code' }).expect(200)
    const created = await owner.post('/api/cases').send(validCase).expect(201)
    expect(created.body.case.ownerOrganizationId).toBe('household-1')

    const other = request.agent(app)
    await other.post('/api/session').send({ email: 'other@example.com', accessCode: 'other-code' }).expect(200)
    await other.get(`/api/cases/${created.body.case.id}`).expect(404, { error: 'case_not_found' })

    const admin = request.agent(app)
    await admin.post('/api/session').send({ email: 'admin@example.com', accessCode: 'admin-code' }).expect(200)
    await admin.get(`/api/cases/${created.body.case.id}`).expect(200)
  })

  it('isolates maintenance memberships by homeowner organization', async () => {
    const app = createApp(store, { auth: roleAuth, maintenance })
    const owner = request.agent(app)
    await owner.post('/api/session').send({ email: 'home@example.com', accessCode: 'home-code' }).expect(200)
    const created = await owner.post('/api/maintenance/memberships').send({
      technicianName: 'Jordan Lee',
      technicianPhone: '+17045550199',
      customerName: 'Home Owner',
      propertyAddress: '1200 South Blvd, Charlotte, NC',
      terms: charlottePilotTerms,
      compliance: {
        jurisdiction: 'NC',
        legalMode: 'scheduled_maintenance',
        contractorLicenseVerified: true,
        serviceContractRegistrationVerified: false,
      },
      initialRepairCreditCents: 0,
    }).expect(201)
    expect(created.body.membership.ownerOrganizationId).toBe('household-1')

    const other = request.agent(app)
    await other.post('/api/session').send({ email: 'other@example.com', accessCode: 'other-code' }).expect(200)
    await other.get(`/api/maintenance/memberships/${created.body.membership.id}`).expect(404, { error: 'membership_not_found' })

    const admin = request.agent(app)
    await admin.post('/api/session').send({ email: 'admin@example.com', accessCode: 'admin-code' }).expect(200)
    await admin.get(`/api/maintenance/memberships/${created.body.membership.id}`).expect(200)
  })

  it('onboards a Charlotte property and creates conflict-safe homeowner bookings', async () => {
    const app = createApp(store, { auth: roleAuth, platform })
    const owner = request.agent(app)
    await owner.post('/api/session').send({ email: 'home@example.com', accessCode: 'home-code' }).expect(200)
    await owner.post('/api/homeowner/properties').send({
      customerName: 'Home Owner', addressLine1: '1 Main St', city: 'Fort Mill',
      state: 'SC', county: 'York', postalCode: '29715',
    }).expect(400, {
      error: 'property_outside_service_area',
      issues: ['SC is not supported during the Charlotte pilot', 'Service is currently limited to Mecklenburg County', 'Postal code is outside the Charlotte pilot area'],
    })
    const created = await owner.post('/api/homeowner/properties').send({
      customerName: 'Home Owner', addressLine1: '1200 South Blvd', city: 'Charlotte',
      state: 'nc', county: 'Mecklenburg', postalCode: '28210',
    }).expect(201)
    const propertyId = created.body.property.id
    const bookingInput = {
      propertyId,
      service: 'recurring_cleaning',
      preferredStart: '2026-09-01T14:00:00.000Z',
      symptomSummary: 'Biweekly cleaning',
      safetyStop: false,
      cleaningScope: { squareFeet: 2200, bathrooms: 2, frequency: 'biweekly', deepClean: false, pets: true },
    }
    const booking = await owner.post('/api/homeowner/bookings').send(bookingInput).expect(201)
    expect(booking.body.booking).toMatchObject({
      status: 'requested', estimateLowCents: 15400, estimateHighCents: 21700,
    })
    await owner.post('/api/homeowner/bookings').send(bookingInput).expect(409, { error: 'booking_slot_conflict' })
    const safetyBooking = await owner.post('/api/homeowner/bookings').send({
      ...bookingInput,
      service: 'hvac_service',
      preferredStart: '2026-09-03T14:00:00.000Z',
      symptomSummary: 'Burning odor and repeated breaker trip',
      safetyStop: true,
      cleaningScope: undefined,
    }).expect(201)
    expect(safetyBooking.body.booking).toMatchObject({
      status: 'human_review', safetyStop: true, estimateLowCents: null, estimateHighCents: null,
    })
    const dispute = await owner.post('/api/homeowner/disputes').send({
      bookingId: booking.body.booking.id, category: 'quality', summary: 'Return visit requested',
    }).expect(201)

    const other = request.agent(app)
    await other.post('/api/session').send({ email: 'other@example.com', accessCode: 'other-code' }).expect(200)
    await other.post('/api/homeowner/bookings').send({ ...bookingInput, preferredStart: '2026-09-02T14:00:00.000Z' })
      .expect(404, { error: 'property_not_found' })

    const admin = request.agent(app)
    await admin.post('/api/session').send({ email: 'admin@example.com', accessCode: 'admin-code' }).expect(200)
    await admin.post(`/api/admin/bookings/${safetyBooking.body.booking.id}/dispatch`)
      .send({ providerId: 'provider-1', providerOrganizationId: 'provider-org', safetyReviewed: false })
      .expect(409, { error: 'safety_review_required' })
    await admin.post(`/api/admin/bookings/${safetyBooking.body.booking.id}/dispatch`)
      .send({ providerId: 'provider-1', providerOrganizationId: 'provider-org', safetyReviewed: true }).expect(200)
    const provider = request.agent(app)
    await provider.post('/api/session').send({ email: 'pro@example.com', accessCode: 'pro-code' }).expect(200)
    await provider.post(`/api/provider/service-bookings/${safetyBooking.body.booking.id}/accept`).send({}).expect(200)
    await provider.post(`/api/provider/service-bookings/${safetyBooking.body.booking.id}/schedule`)
      .send({ scheduledAt: '2026-09-03T15:00:00.000Z' }).expect(200)
    await provider.post(`/api/provider/service-bookings/${safetyBooking.body.booking.id}/complete`).send({
      finalOutcome: {
        technicianConfirmedIssue: 'Failed blower capacitor',
        parts: ['45/5 capacitor'],
        laborMinutes: 55,
        finalPriceCents: 32900,
        outcome: 'resolved',
        aiAssessmentOutcome: 'corrected',
      },
    }).expect(200)
    expect((await provider.get('/api/provider/work-orders').expect(200)).body.earnings)
      .toEqual({ completedJobs: 1, grossRevenueCents: 32900 })
    await admin.post('/api/admin/provider-controls').send({
      organizationId: 'provider-org', status: 'suspended', licenseExpiresAt: null,
      insuranceExpiresAt: null, reason: 'Insurance verification expired',
    }).expect(200)
    await admin.post(`/api/admin/disputes/${dispute.body.dispute.id}/investigating`).send({}).expect(200)
    await admin.post(`/api/admin/disputes/${dispute.body.dispute.id}/resolved`)
      .send({ resolution: 'No-charge return visit assigned' }).expect(200)
    const operations = await admin.get('/api/admin/operations').expect(200)
    expect(operations.body).toMatchObject({
      queues: { safetyReview: 0, unassigned: 1 },
      providerControls: [expect.objectContaining({ organizationId: 'provider-org', status: 'suspended' })],
    })
    expect(operations.body.auditLogs.map((entry: { action: string }) => entry.action))
      .toEqual(expect.arrayContaining(['booking.dispatched', 'provider.suspended', 'dispute.resolved']))
    const integrations = await admin.get('/api/admin/integrations').expect(200)
    expect(integrations.body.integrations.payments).toEqual({ configured: false, humanActionRequired: true })
  })

  it('keeps provider pricebooks and availability inside the provider organization', async () => {
    const app = createApp(store, { auth: roleAuth, platform, maintenance })
    const provider = request.agent(app)
    await provider.post('/api/session').send({ email: 'pro@example.com', accessCode: 'pro-code' }).expect(200)
    await provider.post('/api/provider/pricebook').send({
      service: 'hvac_service', label: 'Diagnostic visit', baseFeeCents: 8900,
      laborLowCents: 9000, laborHighCents: 29000, active: true,
    }).expect(201)
    await provider.post('/api/provider/availability').send({
      weekday: 1, startTime: '08:00', endTime: '17:00', urgent: true,
    }).expect(201)
    await provider.post('/api/provider/availability').send({
      weekday: 1, startTime: '08:00', endTime: '17:00', urgent: true,
    }).expect(409, { error: 'availability_conflict' })
    expect((await provider.get('/api/provider/pricebook').expect(200)).body.items).toHaveLength(1)
    expect((await provider.get('/api/provider/availability').expect(200)).body.availability).toHaveLength(1)
    expect((await provider.get('/api/provider/work-orders').expect(200)).body.earnings)
      .toEqual({ completedJobs: 0, grossRevenueCents: 0 })

    const owner = request.agent(app)
    await owner.post('/api/session').send({ email: 'home@example.com', accessCode: 'home-code' }).expect(200)
    await owner.get('/api/provider/pricebook').expect(403, { error: 'insufficient_role' })
  })

  it('lets admins provision persistent users without exposing access codes', async () => {
    const authWithIdentity: AuthConfig = {
      ...roleAuth,
      authenticate: (email, accessCode) => identity.authenticate(email, accessCode),
    }
    const app = createApp(store, { auth: authWithIdentity, identity, platform })
    const admin = request.agent(app)
    await admin.post('/api/session').send({ email: 'admin@example.com', accessCode: 'admin-code' }).expect(200)
    const created = await admin.post('/api/admin/users').send({
      organizationId: 'new-household', email: 'newhome@example.com', displayName: 'New Homeowner',
      role: 'homeowner', accessCode: 'new-home-code',
    }).expect(201)
    expect(created.body.user).toMatchObject({ organizationId: 'new-household', role: 'homeowner', active: true })
    expect(JSON.stringify(created.body)).not.toContain('new-home-code')
    expect((await admin.get('/api/admin/users').expect(200)).body.users).toHaveLength(1)

    const homeowner = request.agent(app)
    await homeowner.post('/api/session').send({ email: 'newhome@example.com', accessCode: 'new-home-code' }).expect(200)
    await homeowner.get('/api/homeowner/health').expect(200, { role: 'homeowner' })
    await admin.post(`/api/admin/users/${created.body.user.id}/active`).send({ active: false }).expect(200)
    const disabled = request.agent(app)
    await disabled.post('/api/session').send({ email: 'newhome@example.com', accessCode: 'new-home-code' }).expect(401)
  })
})

describe('jurisdiction API', () => {
  it('publishes the Charlotte boundary and blocks South Carolina memberships', async () => {
    const publicProfile = await request(createApp(store)).get('/api/jurisdiction').expect(200)
    expect(publicProfile.body).toMatchObject({
      id: 'us-nc-mecklenburg',
      state: 'NC',
      county: 'Mecklenburg',
      blockedStates: ['SC'],
      launchLegalMode: 'scheduled_maintenance',
    })

    const app = await authenticatedAgent({ maintenance })
    const rejected = await app.post('/api/maintenance/memberships').send({
      technicianName: 'Jordan Lee',
      technicianPhone: '+17045550199',
      customerName: 'Taylor Home',
      propertyAddress: '100 Main St, Fort Mill, SC',
      terms: charlottePilotTerms,
      compliance: {
        jurisdiction: 'SC',
        legalMode: 'scheduled_maintenance',
        contractorLicenseVerified: true,
        serviceContractRegistrationVerified: false,
      },
      initialRepairCreditCents: 0,
    }).expect(400)
    expect(rejected.body.issues.map((issue: { message: string }) => issue.message))
      .toContain('SC is not supported during the Charlotte pilot')
  })
})

describe('case API', () => {
  it('persists and retrieves a validated case with its estimate', async () => {
    const app = await authenticatedAgent()
    const created = await app.post('/api/cases').send(validCase).expect(201)
    expect(created.body.estimate).toMatchObject({ confidence: 72, canBook: true })
    const fetched = await app.get(`/api/cases/${created.body.case.id}`).expect(200)
    expect(fetched.body.case).toMatchObject({ customerName: 'Alex Morgan', summary: validCase.summary })
  })

  it('rejects malformed contact details and blocks safety-sensitive booking', async () => {
    const app = await authenticatedAgent()
    await app.post('/api/cases').send({ ...validCase, phone: '123', consentToText: false }).expect(400)
    const response = await app.post('/api/cases').send({ ...validCase, summary: 'Gas odor near the heater' }).expect(201)
    expect(response.body.estimate).toMatchObject({ safetyEscalation: true, canBook: false, low: 0, high: 0 })
  })

  it('returns a stable not-found error', async () => {
    const app = await authenticatedAgent()
    await app.get('/api/cases/missing').expect(404, { error: 'case_not_found' })
  })

  it('stores and serves safe evidence with integrity metadata', async () => {
    const app = await authenticatedAgent({ evidenceStorage })
    const created = await app.post('/api/cases').send(validCase).expect(201)
    const uploaded = await app.post(`/api/cases/${created.body.case.id}/evidence`)
      .attach('evidence', Buffer.from('valid-image-bytes'), { filename: 'leak.jpg', contentType: 'image/jpeg' }).expect(201)
    expect(uploaded.body.asset).toMatchObject({ originalName: 'leak.jpg', mediaType: 'image/jpeg', byteSize: 17 })
    expect(uploaded.body.asset.sha256).toMatch(/^[a-f0-9]{64}$/)

    const content = await app.get(`/api/cases/${created.body.case.id}/evidence/${uploaded.body.asset.id}`).expect(200)
    expect(content.headers['x-content-type-options']).toBe('nosniff')
    expect(content.headers['cache-control']).toBe('private, no-store')
    expect(content.body).toEqual(Buffer.from('valid-image-bytes'))
  })

  it('rejects unsupported and empty evidence', async () => {
    const app = await authenticatedAgent({ evidenceStorage })
    const created = await app.post('/api/cases').send(validCase).expect(201)
    await app.post(`/api/cases/${created.body.case.id}/evidence`)
      .attach('evidence', Buffer.from('script'), { filename: 'payload.svg', contentType: 'image/svg+xml' })
      .expect(400, { error: 'invalid_evidence' })
    await app.post(`/api/cases/${created.body.case.id}/evidence`).expect(400, { error: 'evidence_required' })
  })

  it('runs configured multimodal analysis and fails closed without it', async () => {
    const base = await authenticatedAgent()
    const created = await base.post('/api/cases').send(validCase).expect(201)
    await base.post(`/api/cases/${created.body.case.id}/evidence/analyze`)
      .attach('evidence', Buffer.from('image'), { filename: 'leak.jpg', contentType: 'image/jpeg' })
      .expect(503, { error: 'multimodal_not_configured' })

    const multimodal = async () => ({ observations: ['Visible moisture near a drain joint'], possibleCauses: [], missingEvidence: ['Meter movement test'], safetyConcern: false, safetyReason: '' })
    const configured = await authenticatedAgent({ multimodal })
    const analyzed = await configured.post(`/api/cases/${created.body.case.id}/evidence/analyze`)
      .attach('evidence', Buffer.from('image'), { filename: 'leak.jpg', contentType: 'image/jpeg' }).expect(200)
    expect(analyzed.body.analysis.observations).toEqual(['Visible moisture near a drain joint'])
    expect(analyzed.body.analysis.mediaSource).toBe('original_image')
    await configured.post(`/api/cases/${created.body.case.id}/evidence/analyze`)
      .attach('evidence', Buffer.from('not-a-video'), { filename: 'leak.mp4', contentType: 'video/mp4' })
      .expect(422, { error: 'video_frame_extraction_failed' })
  })
})

describe('call turn API', () => {
  it('returns disclosure actions and escalates danger input', async () => {
    const app = await authenticatedAgent()
    const initial = await app.post('/api/calls/next').send({}).expect(200)
    expect(initial.body.actions[0].text).toContain('AI assistant')
    const consented = await app.post('/api/calls/next').send({ context: initial.body.context, input: 'yes' }).expect(200)
    const danger = await app.post('/api/calls/next').send({ context: consented.body.context, input: 'There is smoke and sparking by the unit' }).expect(200)
    expect(danger.body.context).toMatchObject({ dangerDetected: true, stage: 'handoff' })
    expect(danger.body.actions.at(-1)).toEqual({ type: 'handoff', reason: 'danger' })
  })
})

describe('diagnostic protocol API', () => {
  it('returns source-linked protocols and blocks safety-sensitive inference', async () => {
    const app = await authenticatedAgent()
    const catalog = await app.get('/api/diagnostic-protocols').expect(200)
    expect(catalog.body.protocols).toHaveLength(5)
    expect(catalog.body.protocols.every((item: { sources: unknown[] }) => item.sources.length > 0)).toBe(true)

    const evaluated = await app.post('/api/diagnostic-protocols/evaluate').send({
      protocolId: 'breaker_trip',
      answers: { repeat_trip: true, heat_or_odor: false, what_running: 'dryer' },
      observedEvidenceIds: ['panel_exterior'],
    }).expect(200)
    expect(evaluated.body.evaluation).toMatchObject({ safetyStop: true, hypotheses: [] })
  })
})

describe('maintenance membership API', () => {
  it('assigns a technician, records a visit, and quotes a member repair', async () => {
    const app = await authenticatedAgent({ maintenance })
    const created = await app.post('/api/maintenance/memberships').send({
      technicianName: 'Jordan Lee',
      technicianPhone: '+15125550199',
      customerName: 'Taylor Home',
      propertyAddress: '1200 South Blvd, Charlotte, NC',
      terms: charlottePilotTerms,
      compliance: {
        jurisdiction: 'NC',
        legalMode: 'scheduled_maintenance',
        contractorLicenseVerified: true,
        serviceContractRegistrationVerified: false,
      },
      initialRepairCreditCents: 0,
    }).expect(201)
    const id = created.body.membership.id
    const visit = await app.post(`/api/maintenance/memberships/${id}/visits`).send({
      notes: 'Monthly plumbing inspection complete',
      completedAt: '2026-08-26T03:00:00.000Z',
    }).expect(201)
    expect(visit.body.visit.remainingIncludedVisits).toBe(1)

    const quote = await app.post(`/api/maintenance/memberships/${id}/repair-quotes`).send({
      laborCents: 20000,
      partsCents: 10000,
    }).expect(201)
    expect(quote.body.quote.price).toMatchObject({ retailCents: 30000, memberDueCents: 30000 })
  })

  it('serves a Home Passport export and requires explicit deletion confirmation', async () => {
    const app = await authenticatedAgent({ maintenance })
    const created = await app.post('/api/maintenance/memberships').send({
      technicianName: 'Jordan Lee',
      technicianPhone: '+15125550199',
      customerName: 'Taylor Home',
      propertyAddress: '1200 South Blvd, Charlotte, NC',
      terms: charlottePilotTerms,
      compliance: {
        jurisdiction: 'NC',
        legalMode: 'scheduled_maintenance',
        contractorLicenseVerified: true,
        serviceContractRegistrationVerified: false,
      },
      initialRepairCreditCents: 0,
    }).expect(201)
    const id = created.body.membership.id
    await app.post(`/api/maintenance/memberships/${id}/assets`).send({
      category: 'hvac',
      label: 'Main HVAC',
      installedYear: 2014,
      expectedLifeYears: 15,
      serviceIntervalMonths: 12,
      lastServicedAt: null,
      condition: 'watch',
    }).expect(201)
    const passport = await app.get(`/api/maintenance/memberships/${id}/passport`).expect(200)
    expect(passport.body.passport.prioritizedActions).toHaveLength(1)
    const exported = await app.get(`/api/maintenance/memberships/${id}/export`).expect(200)
    expect(exported.headers['content-disposition']).toContain('attachment')
    await app.delete(`/api/maintenance/memberships/${id}`).send({ confirmation: 'wrong' }).expect(400)
    await app.delete(`/api/maintenance/memberships/${id}`).send({ confirmation: id }).expect(204)
    await app.get(`/api/maintenance/memberships/${id}/passport`).expect(404)
  })

  it('runs the threshold lifecycle and blocks pricing while safety is unresolved', async () => {
    const app = await authenticatedAgent({ maintenance })
    const created = await app.post('/api/maintenance/memberships').send({
      technicianName: 'Jordan Lee',
      technicianPhone: '+17045550199',
      customerName: 'Taylor Home',
      propertyAddress: '1200 South Blvd, Charlotte, NC',
      terms: charlottePilotTerms,
      compliance: {
        jurisdiction: 'NC',
        legalMode: 'scheduled_maintenance',
        contractorLicenseVerified: true,
        serviceContractRegistrationVerified: false,
      },
      initialRepairCreditCents: 0,
    }).expect(201)
    const membershipId = created.body.membership.id
    const assignedProvider = await app.post('/api/maintenance/providers').send({
      ownerOrganizationId: 'provider-org',
      name: 'Assigned HVAC', role: 'hvac_technician', trade: 'hvac', active: true,
      licenseVerified: true, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true,
    }).expect(201)
    const backupProvider = await app.post('/api/maintenance/providers').send({
      ownerOrganizationId: 'backup-org',
      name: 'Backup HVAC', role: 'hvac_technician', trade: 'hvac', active: true,
      licenseVerified: true, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true,
    }).expect(201)
    await app.post(`/api/maintenance/memberships/${membershipId}/team/${assignedProvider.body.provider.id}`)
      .send({ relationship: 'assigned' }).expect(200)
    await app.post(`/api/maintenance/memberships/${membershipId}/team/${backupProvider.body.provider.id}`)
      .send({ relationship: 'backup' }).expect(200)
    const matched = await app.post(`/api/maintenance/memberships/${membershipId}/match-providers`).send({
      service: 'hvac_service', postalCode: '28210', urgent: true, safetyStop: false,
    }).expect(200)
    expect(matched.body.matches.map((match: { relationship: string }) => match.relationship)).toEqual(['assigned', 'backup'])
    const workOrder = await app.post(`/api/maintenance/memberships/${membershipId}/work-orders`).send({
      providerId: assignedProvider.body.provider.id,
      service: 'hvac_service',
      summary: 'Cooling recovery is slower than the recorded baseline',
    }).expect(201)
    await app.post(`/api/maintenance/work-orders/${workOrder.body.workOrder.id}/accept`).send({}).expect(200)
    await app.post(`/api/maintenance/work-orders/${workOrder.body.workOrder.id}/schedule`)
      .send({ scheduledAt: '2026-09-01T14:00:00.000Z' }).expect(200)
    await app.post(`/api/maintenance/work-orders/${workOrder.body.workOrder.id}/complete`).send({
      finalOutcome: {
        technicianConfirmedIssue: 'Restricted airflow from loaded filter',
        parts: ['16x25 filter'],
        laborMinutes: 40,
        finalPriceCents: 17900,
        outcome: 'resolved',
        aiAssessmentOutcome: 'corrected',
      },
    }).expect(200)
    const workOrders = await app.get(`/api/maintenance/memberships/${membershipId}/work-orders`).expect(200)
    expect(workOrders.body.workOrders[0]).toMatchObject({
      status: 'completed',
      finalOutcome: { aiAssessmentOutcome: 'corrected', finalPriceCents: 17900 },
    })
    await app.post('/api/maintenance/providers').send({
      name: 'Unlicensed HVAC', role: 'hvac_technician', trade: 'hvac', active: true,
      licenseVerified: false, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: true,
    }).expect(400)
    const added = await app.post(`/api/maintenance/memberships/${membershipId}/assets`).send({
      category: 'electrical',
      label: 'Main panel',
      installedYear: 2000,
      expectedLifeYears: 25,
      serviceIntervalMonths: 12,
      lastServicedAt: '2024-01-01T00:00:00.000Z',
      condition: 'watch',
    }).expect(201)
    const evaluated = await app.post(`/api/maintenance/memberships/${membershipId}/evaluate-thresholds`).send({
      now: '2026-08-27T00:00:00.000Z',
      safetyStopAssetId: added.body.asset.id,
      safetyEvidence: ['breaker retripped'],
    }).expect(200)
    const safetyEvent = evaluated.body.created.find((event: { ruleId: string }) => event.ruleId === 'safety_stop')
    expect(safetyEvent).toMatchObject({ severity: 'urgent', safetyStop: true, recommendedProtocolId: 'breaker_trip' })
    await app.post(`/api/maintenance/memberships/${membershipId}/repair-quotes`)
      .send({ laborCents: 10000, partsCents: 5000 })
      .expect(409, { error: 'pricing_blocked_by_safety_event' })
    await app.post(`/api/maintenance/events/${safetyEvent.id}/acknowledge`).expect(200)
    await app.post(`/api/maintenance/events/${safetyEvent.id}/schedule`).expect(200)
    await app.post(`/api/maintenance/events/${safetyEvent.id}/resolve`).expect(200)
    await app.post(`/api/maintenance/events/${safetyEvent.id}/acknowledge`).expect(409)
    await app.post(`/api/maintenance/memberships/${membershipId}/repair-quotes`)
      .send({ laborCents: 10000, partsCents: 5000 })
      .expect(201)
    const listed = await app.get(`/api/maintenance/memberships/${membershipId}/events`).expect(200)
    expect(listed.body.events.some((event: { id: string; status: string }) => event.id === safetyEvent.id && event.status === 'resolved')).toBe(true)
  })
})
