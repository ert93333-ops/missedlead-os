import express from 'express'
import { createHash } from 'node:crypto'
import multer from 'multer'
import cookieParser from 'cookie-parser'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { buildEstimate } from '../src/domain'
import { applyCallInput, initialCallContext, nextVoiceActions } from '../src/telephony'
import { calculateTransparentPrice, defaultPricingPolicy } from '../src/pricing'
import type { CaseStore } from './db'
import { createTwilioRouter, type TwilioConfig } from './twilio'
import type { MultimodalAnalyzer } from './multimodal'
import type { EvidenceStorage } from './evidenceStorage'
import { createAuth, type AuthConfig } from './auth'
import type { MaintenanceStore } from './maintenanceDb'
import { validatePlanCompliance } from '../src/maintenance'
import { evaluateEvidenceProtocol, listEvidenceProtocols } from '../src/evidenceProtocols'
import { charlottePilotJurisdiction, validateServiceAddress } from '../src/jurisdiction'
import { estimateCleaningRange } from '../src/homeCare'
import type { PlatformStore } from './platformDb'

const evidenceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  observed: z.boolean(),
  weight: z.number().int().min(0).max(30),
})

const caseSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/),
  summary: z.string().trim().min(1).max(1000),
  consentToText: z.literal(true),
  evidence: z.array(evidenceSchema).max(20),
})

const callContextSchema = z.object({
  stage: z.enum(['disclosure', 'intent', 'location', 'schedule', 'handoff', 'complete']),
  disclosureAccepted: z.boolean(),
  summary: z.string(),
  postalCode: z.string(),
  dangerDetected: z.boolean(),
})

const callTurnSchema = z.object({
  context: callContextSchema.optional(),
  input: z.string().max(2000).optional(),
})

const maintenanceTermsSchema = z.object({
  monthlyFeeCents: z.number().int().min(0).max(1_000_000),
  includedVisitsPerYear: z.number().int().min(0).max(24),
  monthlyRepairCreditCents: z.number().int().min(0).max(1_000_000),
  repairCreditCapCents: z.number().int().min(0).max(10_000_000),
  laborDiscountBps: z.number().int().min(0).max(5000),
})
const complianceProfileSchema = z.object({
  jurisdiction: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  legalMode: z.enum(['scheduled_maintenance', 'registered_service_contract']),
  contractorLicenseVerified: z.boolean(),
  serviceContractRegistrationVerified: z.boolean(),
})
const membershipSchema = z.object({
  technicianName: z.string().trim().min(1).max(120),
  technicianPhone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/),
  customerName: z.string().trim().min(1).max(120),
  propertyAddress: z.string().trim().min(5).max(300),
  terms: maintenanceTermsSchema,
  compliance: complianceProfileSchema,
  initialRepairCreditCents: z.number().int().min(0),
}).refine((input) => input.initialRepairCreditCents <= input.terms.repairCreditCapCents, {
  message: 'Initial repair credit exceeds plan cap',
  path: ['initialRepairCreditCents'],
}).superRefine((input, context) => {
  if (input.compliance.jurisdiction !== charlottePilotJurisdiction.state) {
    context.addIssue({
      code: 'custom',
      message: input.compliance.jurisdiction === 'SC'
        ? 'SC is not supported during the Charlotte pilot'
        : `Service is currently limited to ${charlottePilotJurisdiction.state}`,
      path: ['compliance', 'jurisdiction'],
    })
  }
  if (input.compliance.legalMode !== charlottePilotJurisdiction.launchLegalMode) {
    context.addIssue({
      code: 'custom',
      message: 'The Charlotte pilot is limited to scheduled maintenance until service-contract review is complete',
      path: ['compliance', 'legalMode'],
    })
  }
  for (const message of validatePlanCompliance(input.terms, input.compliance)) {
    context.addIssue({ code: 'custom', message, path: ['compliance'] })
  }
})
const homeAssetSchema = z.object({
  category: z.enum(['hvac', 'water_heater', 'plumbing', 'electrical']),
  label: z.string().trim().min(1).max(120),
  installedYear: z.number().int().min(1900).max(new Date().getUTCFullYear() + 1),
  expectedLifeYears: z.number().int().min(1).max(100),
  serviceIntervalMonths: z.number().int().min(1).max(120),
  lastServicedAt: z.iso.datetime().nullable(),
  condition: z.enum(['good', 'watch', 'urgent']),
})
const thresholdEvaluationSchema = z.object({
  now: z.iso.datetime().optional(),
  safetyStopAssetId: z.string().uuid().optional(),
  safetyEvidence: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
})
const serviceProviderSchema = z.object({
  ownerOrganizationId: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['primary_cleaner', 'home_care_coordinator', 'hvac_technician', 'plumber', 'handyman']),
  trade: z.enum(['cleaning', 'handyman', 'hvac', 'plumbing']),
  active: z.boolean(),
  licenseVerified: z.boolean(),
  insured: z.boolean(),
  postalCodePrefixes: z.array(z.string().regex(/^\d{3}$/)).min(1).max(20),
  availableForUrgentDispatch: z.boolean(),
}).superRefine((provider, context) => {
  if ((provider.trade === 'hvac' || provider.trade === 'plumbing') && !provider.licenseVerified) {
    context.addIssue({ code: 'custom', message: 'NC trade license verification is required', path: ['licenseVerified'] })
  }
})
const providerMatchSchema = z.object({
  service: z.enum(['recurring_cleaning', 'home_care_visit', 'hvac_service', 'plumbing_service', 'handyman_visit']),
  postalCode: z.string().regex(/^\d{5}$/),
  urgent: z.boolean(),
  safetyStop: z.boolean(),
})
const workOrderSchema = z.object({
  providerId: z.string().uuid(),
  thresholdEventId: z.string().uuid().optional(),
  service: z.enum(['recurring_cleaning', 'home_care_visit', 'hvac_service', 'plumbing_service', 'handyman_visit']),
  summary: z.string().trim().min(1).max(1000),
})
const finalOutcomeSchema = z.object({
  technicianConfirmedIssue: z.string().trim().min(1).max(500),
  parts: z.array(z.string().trim().min(1).max(200)).max(50),
  laborMinutes: z.number().int().min(0).max(10_000),
  finalPriceCents: z.number().int().min(0).max(100_000_000),
  outcome: z.enum(['resolved', 'follow_up_required', 'no_fault_found']),
  aiAssessmentOutcome: z.enum(['accepted', 'corrected', 'rejected']),
})
const platformPropertySchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  addressLine1: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().length(2),
  county: z.string().trim().min(2).max(100),
  postalCode: z.string().regex(/^\d{5}$/),
})
const bookingSchema = z.object({
  propertyId: z.string().uuid(),
  service: z.enum(['recurring_cleaning', 'home_care_visit', 'hvac_service', 'plumbing_service', 'handyman_visit']),
  preferredStart: z.iso.datetime(),
  symptomSummary: z.string().trim().min(1).max(1000),
  safetyStop: z.boolean(),
  confidence: z.number().min(0).max(100).optional(),
  cleaningScope: z.object({
    squareFeet: z.number().int().min(200).max(20_000),
    bathrooms: z.number().int().min(0).max(20),
    frequency: z.enum(['weekly', 'biweekly', 'monthly', 'one_time']),
    deepClean: z.boolean(),
    pets: z.boolean(),
  }).optional(),
})
const pricebookItemSchema = z.object({
  service: z.enum(['recurring_cleaning', 'home_care_visit', 'hvac_service', 'plumbing_service', 'handyman_visit']),
  label: z.string().trim().min(1).max(160),
  baseFeeCents: z.number().int().min(0).max(10_000_000),
  laborLowCents: z.number().int().min(0).max(10_000_000),
  laborHighCents: z.number().int().min(0).max(10_000_000),
  active: z.boolean(),
}).refine((input) => input.laborHighCents >= input.laborLowCents, {
  message: 'Labor high must be greater than or equal to labor low',
  path: ['laborHighCents'],
})
const availabilitySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  urgent: z.boolean(),
}).refine((input) => input.endTime > input.startTime, {
  message: 'End time must be after start time',
  path: ['endTime'],
})
const disputeSchema = z.object({
  bookingId: z.string().uuid().optional(),
  category: z.enum(['refund', 'quality', 'safety', 'billing']),
  summary: z.string().trim().min(1).max(1000),
})
const providerControlSchema = z.object({
  organizationId: z.string().trim().min(1).max(120),
  status: z.enum(['pending', 'approved', 'suspended']),
  licenseExpiresAt: z.iso.datetime().nullable(),
  insuranceExpiresAt: z.iso.datetime().nullable(),
  reason: z.string().trim().min(1).max(500),
})

function presentCase(serviceCase: ReturnType<CaseStore['create']>) {
  const estimate = buildEstimate(serviceCase.evidence, serviceCase.summary)
  return {
    case: serviceCase,
    estimate,
    pricing: calculateTransparentPrice(defaultPricingPolicy, {
      confidence: estimate.confidence,
      afterHours: true,
      safetyEscalation: estimate.safetyEscalation,
    }),
  }
}

export function createApp(store: CaseStore, options: {
  twilio?: TwilioConfig
  multimodal?: MultimodalAnalyzer
  evidenceStorage?: EvidenceStorage
  auth?: AuthConfig
  maintenance?: MaintenanceStore
  platform?: PlatformStore
} = {}) {
  const app = express()
  const auth = createAuth(options.auth)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
      callback(allowed.has(file.mimetype) ? null : new Error('unsupported_media_type'), allowed.has(file.mimetype))
    },
  })
  app.use('/api/webhooks/twilio', express.urlencoded({ extended: false }), createTwilioRouter(options.twilio))
  app.use(express.json({ limit: '256kb' }))
  app.use(cookieParser())
  app.use('/api/session', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }))
  app.post('/api/session', auth.login)
  app.get('/api/session', auth.requireSession, (_request, response) => response.json({
    authenticated: true,
    session: response.locals.authSession,
  }))
  app.delete('/api/session', auth.logout)

  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
  app.get('/api/jurisdiction', (_request, response) => response.json(charlottePilotJurisdiction))
  app.get('/api/homeowner/health', auth.requireRole('homeowner', 'admin'), (_request, response) => response.json({ role: response.locals.authSession.role }))
  app.get('/api/provider/health', auth.requireRole('provider', 'admin'), (_request, response) => response.json({ role: response.locals.authSession.role }))
  app.get('/api/admin/health', auth.requireRole('admin'), (_request, response) => response.json({ role: response.locals.authSession.role }))
  app.use('/api/homeowner', auth.requireRole('homeowner', 'admin'))
  app.post('/api/homeowner/properties', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const parsed = platformPropertySchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_property', issues: parsed.error.issues })
      return
    }
    const normalized = { ...parsed.data, state: parsed.data.state.toUpperCase() }
    const boundaryErrors = validateServiceAddress(normalized)
    if (boundaryErrors.length > 0) {
      response.status(400).json({ error: 'property_outside_service_area', issues: boundaryErrors })
      return
    }
    response.status(201).json({ property: options.platform.createProperty({
      ...normalized,
      organizationId: response.locals.authSession.organizationId,
    }) })
  })
  app.get('/api/homeowner/properties', (_request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    response.json({ properties: options.platform.listProperties(response.locals.authSession.organizationId) })
  })
  app.post('/api/homeowner/bookings', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const parsed = bookingSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_booking', issues: parsed.error.issues })
      return
    }
    const property = options.platform.findProperty(parsed.data.propertyId, response.locals.authSession.organizationId)
    if (!property) {
      response.status(404).json({ error: 'property_not_found' })
      return
    }
    let estimateLowCents: number | null = null
    let estimateHighCents: number | null = null
    if (!parsed.data.safetyStop && parsed.data.service === 'recurring_cleaning' && parsed.data.cleaningScope) {
      const estimate = estimateCleaningRange(parsed.data.cleaningScope)
      estimateLowCents = estimate.lowCents
      estimateHighCents = estimate.highCents
    } else if (!parsed.data.safetyStop && parsed.data.service !== 'recurring_cleaning') {
      const estimate = calculateTransparentPrice(defaultPricingPolicy, {
        confidence: parsed.data.confidence ?? 0,
        afterHours: false,
        safetyEscalation: false,
      })
      estimateLowCents = Math.round(estimate.low * 100)
      estimateHighCents = Math.round(estimate.high * 100)
    }
    const result = options.platform.createBooking({
      organizationId: response.locals.authSession.organizationId,
      propertyId: property.id,
      service: parsed.data.service,
      preferredStart: parsed.data.preferredStart,
      safetyStop: parsed.data.safetyStop,
      symptomSummary: parsed.data.symptomSummary,
      estimateLowCents,
      estimateHighCents,
    })
    if ('error' in result) {
      response.status(409).json({ error: result.error })
      return
    }
    response.status(201).json(result)
  })
  app.get('/api/homeowner/bookings', (_request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    response.json({ bookings: options.platform.listBookings(response.locals.authSession.organizationId) })
  })
  app.post('/api/homeowner/disputes', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const parsed = disputeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_dispute', issues: parsed.error.issues })
      return
    }
    try {
      const dispute = options.platform.createDispute({
        ...parsed.data,
        bookingId: parsed.data.bookingId ?? null,
        organizationId: response.locals.authSession.organizationId,
      })
      response.status(201).json({ dispute })
    } catch {
      response.status(404).json({ error: 'booking_not_found' })
    }
  })
  app.get('/api/homeowner/notifications', (_request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    response.json({ notifications: options.platform.listNotifications(response.locals.authSession.organizationId) })
  })
  app.post('/api/homeowner/notifications/:id/read', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const notification = options.platform.markNotificationRead(request.params.id, response.locals.authSession.organizationId)
    if (!notification) {
      response.status(404).json({ error: 'notification_not_found' })
      return
    }
    response.json({ notification })
  })
  app.use('/api/provider', auth.requireRole('provider', 'admin'))
  app.post('/api/provider/pricebook', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const parsed = pricebookItemSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_pricebook_item', issues: parsed.error.issues })
      return
    }
    response.status(201).json({ item: options.platform.createPricebookItem({
      ...parsed.data,
      organizationId: response.locals.authSession.organizationId,
    }) })
  })
  app.get('/api/provider/pricebook', (_request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    response.json({ items: options.platform.listPricebookItems(response.locals.authSession.organizationId) })
  })
  app.post('/api/provider/availability', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const parsed = availabilitySchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_availability', issues: parsed.error.issues })
      return
    }
    const result = options.platform.createAvailability({
      ...parsed.data,
      organizationId: response.locals.authSession.organizationId,
    })
    if ('error' in result) {
      response.status(409).json({ error: result.error })
      return
    }
    response.status(201).json(result)
  })
  app.get('/api/provider/availability', (_request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    response.json({ availability: options.platform.listAvailability(response.locals.authSession.organizationId) })
  })
  app.get('/api/provider/work-orders', (_request, response) => {
    if (!options.maintenance && !options.platform) {
      response.status(503).json({ error: 'provider_work_store_not_configured' })
      return
    }
    const workOrders = options.maintenance?.listProviderWorkOrders(response.locals.authSession.organizationId) ?? []
    const completed = workOrders.filter((workOrder) => workOrder.status === 'completed' && workOrder.finalOutcome)
    const serviceBookings = options.platform?.listProviderBookings(response.locals.authSession.organizationId) ?? []
    const completedBookings = serviceBookings.filter((booking) => booking.status === 'completed' && booking.finalOutcome)
    response.json({
      workOrders,
      serviceBookings,
      earnings: {
        completedJobs: completed.length + completedBookings.length,
        grossRevenueCents: completed.reduce((total, workOrder) => total + (workOrder.finalOutcome?.finalPriceCents ?? 0), 0)
          + completedBookings.reduce((total, booking) => total + (booking.finalOutcome?.finalPriceCents ?? 0), 0),
      },
    })
  })
  app.post('/api/provider/service-bookings/:id/accept', (request, response) => {
    const booking = options.platform?.acceptProviderBooking(request.params.id, response.locals.authSession.organizationId)
    if (!booking) {
      response.status(404).json({ error: 'assigned_booking_not_found' })
      return
    }
    response.json({ booking })
  })
  app.post('/api/provider/service-bookings/:id/schedule', (request, response) => {
    const parsed = z.object({ scheduledAt: z.iso.datetime() }).safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_schedule', issues: parsed.error.issues })
      return
    }
    const booking = options.platform?.scheduleProviderBooking(
      request.params.id, response.locals.authSession.organizationId, parsed.data.scheduledAt,
    )
    if (!booking) {
      response.status(409).json({ error: 'booking_must_be_assigned_and_accepted' })
      return
    }
    response.json({ booking })
  })
  app.post('/api/provider/service-bookings/:id/complete', (request, response) => {
    const parsed = finalOutcomeSchema.safeParse(request.body?.finalOutcome)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_final_outcome', issues: parsed.error.issues })
      return
    }
    const booking = options.platform?.completeProviderBooking(
      request.params.id, response.locals.authSession.organizationId, parsed.data,
    )
    if (!booking) {
      response.status(409).json({ error: 'booking_must_be_scheduled' })
      return
    }
    response.json({ booking })
  })
  app.use('/api/admin', auth.requireRole('admin'))
  app.get('/api/admin/operations', (_request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const bookings = options.platform.listAllBookings()
    response.json({
      bookings,
      disputes: options.platform.listDisputes(),
      providerControls: options.platform.listProviderControls(),
      auditLogs: options.platform.listAudits(100),
      queues: {
        safetyReview: bookings.filter((booking) => booking.status === 'human_review').length,
        unassigned: bookings.filter((booking) => booking.status === 'requested').length,
      },
    })
  })
  app.post('/api/admin/bookings/:id/dispatch', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const parsed = z.object({
      providerId: z.string().min(1),
      providerOrganizationId: z.string().min(1),
      safetyReviewed: z.boolean(),
    }).safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_dispatch', issues: parsed.error.issues })
      return
    }
    const result = options.platform.dispatchBooking(
      request.params.id, parsed.data.providerId, parsed.data.providerOrganizationId, parsed.data.safetyReviewed,
    )
    if ('error' in result) {
      response.status(result.error === 'booking_not_found' ? 404 : 409).json({ error: result.error })
      return
    }
    options.platform.appendAudit({
      actorUserId: response.locals.authSession.id,
      actorOrganizationId: response.locals.authSession.organizationId,
      actorRole: response.locals.authSession.role,
      action: 'booking.dispatched',
      targetType: 'booking',
      targetId: request.params.id,
      metadata: {
        providerId: parsed.data.providerId,
        providerOrganizationId: parsed.data.providerOrganizationId,
        safetyReviewed: parsed.data.safetyReviewed,
      },
    })
    response.json(result)
  })
  app.post('/api/admin/provider-controls', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const parsed = providerControlSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_provider_control', issues: parsed.error.issues })
      return
    }
    const control = options.platform.setProviderControl(parsed.data)
    options.platform.appendAudit({
      actorUserId: response.locals.authSession.id,
      actorOrganizationId: response.locals.authSession.organizationId,
      actorRole: response.locals.authSession.role,
      action: `provider.${control.status}`,
      targetType: 'provider_organization',
      targetId: control.organizationId,
      metadata: { reason: control.reason },
    })
    response.json({ control })
  })
  app.post('/api/admin/disputes/:id/:status', (request, response) => {
    if (!options.platform) {
      response.status(503).json({ error: 'platform_store_not_configured' })
      return
    }
    const parsed = z.object({
      status: z.enum(['investigating', 'resolved']),
      resolution: z.string().trim().max(1000).optional(),
    }).safeParse({ ...request.body, status: request.params.status })
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_dispute_transition', issues: parsed.error.issues })
      return
    }
    const result = options.platform.transitionDispute(request.params.id, parsed.data.status, parsed.data.resolution)
    if (!result) {
      response.status(404).json({ error: 'dispute_not_found' })
      return
    }
    if ('error' in result) {
      response.status(409).json({ error: result.error })
      return
    }
    options.platform.appendAudit({
      actorUserId: response.locals.authSession.id,
      actorOrganizationId: response.locals.authSession.organizationId,
      actorRole: response.locals.authSession.role,
      action: `dispute.${parsed.data.status}`,
      targetType: 'dispute',
      targetId: request.params.id,
    })
    response.json(result)
  })
  app.get('/api/admin/integrations', (_request, response) => {
    response.json({
      integrations: {
        twilio: { configured: Boolean(options.twilio), humanActionRequired: !options.twilio },
        multimodal: { configured: Boolean(options.multimodal), humanActionRequired: !options.multimodal },
        evidenceStorage: { configured: Boolean(options.evidenceStorage), productionReady: false },
        payments: { configured: false, humanActionRequired: true },
      },
      productionBlockers: [
        'Provision and verify the production Twilio account and phone number.',
        'Configure a production object-storage provider and retention policy.',
        'Connect a payment processor and complete merchant verification.',
        'Deploy behind HTTPS with backups, monitoring, and a managed secret store.',
      ],
    })
  })

  app.post('/api/calls/next', auth.requireSession, (request, response) => {
    const parsed = callTurnSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_call_turn', issues: parsed.error.issues })
      return
    }
    const previous = parsed.data.context ?? initialCallContext
    const context = parsed.data.input === undefined ? previous : applyCallInput(previous, parsed.data.input)
    response.json({ context, actions: nextVoiceActions(context) })
  })

  app.get('/api/diagnostic-protocols', auth.requireSession, (_request, response) => {
    response.json({ protocols: listEvidenceProtocols() })
  })
  app.post('/api/diagnostic-protocols/evaluate', auth.requireSession, (request, response) => {
    const parsed = z.object({
      protocolId: z.enum(['sink_leak', 'drain_backup', 'no_cooling', 'breaker_trip', 'water_heater_issue']),
      answers: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])),
      observedEvidenceIds: z.array(z.string()).max(30),
    }).safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_protocol_evaluation', issues: parsed.error.issues })
      return
    }
    response.json({ evaluation: evaluateEvidenceProtocol(parsed.data) })
  })

  app.use('/api/maintenance', auth.requireSession)
  app.use('/api/maintenance/memberships/:id', (request, response, next) => {
    const ownerOrganizationId = response.locals.authSession.role === 'admin'
      ? undefined
      : response.locals.authSession.organizationId
    if (!options.maintenance?.findMembership(request.params.id, ownerOrganizationId)) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    next()
  })
  app.post('/api/maintenance/memberships', (request, response) => {
    if (!options.maintenance) {
      response.status(503).json({ error: 'maintenance_not_configured' })
      return
    }
    const parsed = membershipSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_membership', issues: parsed.error.issues })
      return
    }
    response.status(201).json({
      membership: options.maintenance.createMembership({
        ...parsed.data,
        ownerOrganizationId: response.locals.authSession.organizationId,
      }),
    })
  })
  app.get('/api/maintenance/memberships/:id', (request, response) => {
    const membership = options.maintenance?.findMembership(request.params.id)
    if (!membership) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.json({ membership })
  })
  app.post('/api/maintenance/memberships/:id/visits', (request, response) => {
    const parsed = z.object({ notes: z.string().trim().max(2000), completedAt: z.iso.datetime().optional() }).safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_visit', issues: parsed.error.issues })
      return
    }
    const visit = options.maintenance?.completeVisit(request.params.id, parsed.data.notes, parsed.data.completedAt)
    if (!visit) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.status(201).json({ visit })
  })
  app.post('/api/maintenance/memberships/:id/repair-quotes', (request, response) => {
    const parsed = z.object({
      laborCents: z.number().int().min(0).max(100_000_000),
      partsCents: z.number().int().min(0).max(100_000_000),
    }).safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_repair_quote', issues: parsed.error.issues })
      return
    }
    if (options.maintenance?.hasOpenSafetyStop(request.params.id)) {
      response.status(409).json({ error: 'pricing_blocked_by_safety_event' })
      return
    }
    const quote = options.maintenance?.createRepairQuote(request.params.id, parsed.data.laborCents, parsed.data.partsCents)
    if (!quote) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.status(201).json({ quote })
  })
  app.post('/api/maintenance/memberships/:id/evaluate-thresholds', (request, response) => {
    const parsed = thresholdEvaluationSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_threshold_evaluation', issues: parsed.error.issues })
      return
    }
    const result = options.maintenance?.evaluateThresholds(request.params.id, parsed.data)
    if (!result) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.json(result)
  })
  app.get('/api/maintenance/memberships/:id/events', (request, response) => {
    const events = options.maintenance?.listThresholdEvents(request.params.id)
    if (!events) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.json({ events })
  })
  const transitionThresholdEvent = (status: 'acknowledged' | 'scheduled' | 'resolved') =>
    (request: express.Request, response: express.Response) => {
      const existing = options.maintenance?.findThresholdEvent(request.params.id)
      const ownerOrganizationId = response.locals.authSession.role === 'admin'
        ? undefined
        : response.locals.authSession.organizationId
      if (!existing || !options.maintenance?.findMembership(existing.planId, ownerOrganizationId)) {
        response.status(404).json({ error: 'maintenance_event_not_found' })
        return
      }
      const result = options.maintenance?.transitionThresholdEvent(request.params.id, status)
      if (!result || result.error === 'not_found') {
        response.status(404).json({ error: 'maintenance_event_not_found' })
        return
      }
      if (result.error === 'invalid_transition') {
        response.status(409).json({ error: 'invalid_event_transition', event: result.event })
        return
      }
      response.json(result)
    }
  app.post('/api/maintenance/events/:id/acknowledge', transitionThresholdEvent('acknowledged'))
  app.post('/api/maintenance/events/:id/schedule', transitionThresholdEvent('scheduled'))
  app.post('/api/maintenance/events/:id/resolve', transitionThresholdEvent('resolved'))
  app.post('/api/maintenance/providers', auth.requireRole('provider', 'admin'), (request, response) => {
    const parsed = serviceProviderSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_service_provider', issues: parsed.error.issues })
      return
    }
    response.status(201).json({
      provider: options.maintenance?.createServiceProvider({
        ...parsed.data,
        ownerOrganizationId: response.locals.authSession.role === 'admin'
          ? parsed.data.ownerOrganizationId ?? response.locals.authSession.organizationId
          : response.locals.authSession.organizationId,
      }),
    })
  })
  app.post('/api/maintenance/memberships/:id/team/:providerId', (request, response) => {
    const parsed = z.object({ relationship: z.enum(['assigned', 'backup']) }).safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_team_assignment', issues: parsed.error.issues })
      return
    }
    const result = options.maintenance?.assignHomeCareProvider(request.params.id, request.params.providerId, parsed.data.relationship)
    if (!result || result.error === 'membership_not_found') {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    if (result.error === 'provider_not_found') {
      response.status(404).json({ error: 'provider_not_found' })
      return
    }
    response.json(result)
  })
  app.get('/api/maintenance/memberships/:id/team', (request, response) => {
    const team = options.maintenance?.getHomeCareTeam(request.params.id)
    if (!team) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.json({ team })
  })
  app.post('/api/maintenance/memberships/:id/match-providers', (request, response) => {
    const parsed = providerMatchSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_provider_match', issues: parsed.error.issues })
      return
    }
    const matches = options.maintenance?.matchProviders(request.params.id, parsed.data)
    if (!matches) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.json({ matches })
  })
  app.post('/api/maintenance/memberships/:id/work-orders', (request, response) => {
    const parsed = workOrderSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_work_order', issues: parsed.error.issues })
      return
    }
    const result = options.maintenance?.createWorkOrder({ planId: request.params.id, ...parsed.data })
    if (!result || result.error === 'membership_not_found') {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    if (result.error === 'provider_not_found') {
      response.status(404).json({ error: 'provider_not_found' })
      return
    }
    if (result.error === 'threshold_event_not_found') {
      response.status(404).json({ error: 'threshold_event_not_found' })
      return
    }
    response.status(201).json(result)
  })
  app.get('/api/maintenance/memberships/:id/work-orders', (request, response) => {
    const workOrders = options.maintenance?.listWorkOrders(request.params.id)
    if (!workOrders) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.json({ workOrders })
  })
  const transitionWorkOrder = (status: 'accepted' | 'scheduled' | 'completed' | 'cancelled') =>
    (request: express.Request, response: express.Response) => {
      const parsed = z.object({
        scheduledAt: z.iso.datetime().optional(),
        finalOutcome: finalOutcomeSchema.optional(),
      }).safeParse(request.body)
      if (!parsed.success) {
        response.status(400).json({ error: 'invalid_work_order_transition', issues: parsed.error.issues })
        return
      }
      const existing = options.maintenance?.findWorkOrder(request.params.id)
      const membershipOwner = existing
        ? options.maintenance?.findMembership(existing.planId, response.locals.authSession.role === 'admin'
          ? undefined
          : response.locals.authSession.organizationId)
        : null
      const assignedProvider = existing ? options.maintenance?.findServiceProvider(existing.providerId) : null
      const providerCanAccess = response.locals.authSession.role === 'provider'
        && assignedProvider?.ownerOrganizationId === response.locals.authSession.organizationId
      if (!existing || (!membershipOwner && !providerCanAccess)) {
        response.status(404).json({ error: 'work_order_not_found' })
        return
      }
      const result = options.maintenance?.transitionWorkOrder(request.params.id, { status, ...parsed.data })
      if (!result || result.error === 'not_found') {
        response.status(404).json({ error: 'work_order_not_found' })
        return
      }
      if (result.error) {
        response.status(409).json({ error: result.error, workOrder: result.workOrder })
        return
      }
      response.json(result)
    }
  app.post('/api/maintenance/work-orders/:id/accept', transitionWorkOrder('accepted'))
  app.post('/api/maintenance/work-orders/:id/schedule', transitionWorkOrder('scheduled'))
  app.post('/api/maintenance/work-orders/:id/complete', transitionWorkOrder('completed'))
  app.post('/api/maintenance/work-orders/:id/cancel', transitionWorkOrder('cancelled'))
  app.post('/api/maintenance/memberships/:id/assets', (request, response) => {
    const parsed = homeAssetSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_home_asset', issues: parsed.error.issues })
      return
    }
    const asset = options.maintenance?.addHomeAsset(request.params.id, parsed.data)
    if (!asset) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.status(201).json({ asset })
  })
  app.get('/api/maintenance/memberships/:id/passport', (request, response) => {
    const passport = options.maintenance?.getHomePassport(request.params.id)
    if (!passport) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.json({ passport })
  })
  app.get('/api/maintenance/memberships/:id/export', (request, response) => {
    const data = options.maintenance?.exportHomeownerData(request.params.id)
    if (!data) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.set('Content-Disposition', `attachment; filename="home-data-${request.params.id}.json"`).json({ exportedAt: new Date().toISOString(), data })
  })
  app.delete('/api/maintenance/memberships/:id', (request, response) => {
    const parsed = z.object({ confirmation: z.string() }).safeParse(request.body)
    if (!parsed.success || parsed.data.confirmation !== request.params.id) {
      response.status(400).json({ error: 'deletion_confirmation_required' })
      return
    }
    if (!options.maintenance?.deleteMembership(request.params.id)) {
      response.status(404).json({ error: 'membership_not_found' })
      return
    }
    response.status(204).end()
  })

  app.use('/api/cases', auth.requireSession)
  app.post('/api/cases', rateLimit({ windowMs: 60_000, limit: 60 }), (request, response) => {
    const parsed = caseSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_case', issues: parsed.error.issues })
      return
    }
    const serviceCase = store.create({
      ...parsed.data,
      ownerOrganizationId: response.locals.authSession.organizationId,
    })
    response.status(201).json(presentCase(serviceCase))
  })

  app.get('/api/cases/:id', (request, response) => {
    const serviceCase = store.find(
      request.params.id,
      response.locals.authSession.role === 'admin' ? undefined : response.locals.authSession.organizationId,
    )
    if (!serviceCase) {
      response.status(404).json({ error: 'case_not_found' })
      return
    }
    response.json({ ...presentCase(serviceCase), assets: store.listAssets(serviceCase.id) })
  })

  app.post('/api/cases/:id/evidence', (request, response) => {
    upload.single('evidence')(request, response, async (error) => {
      if (error) {
        const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        response.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'evidence_too_large' : 'invalid_evidence' })
        return
      }
      const serviceCase = store.find(
        request.params.id,
        response.locals.authSession.role === 'admin' ? undefined : response.locals.authSession.organizationId,
      )
      if (!serviceCase) {
        response.status(404).json({ error: 'case_not_found' })
        return
      }
      if (!request.file || request.file.size === 0) {
        response.status(400).json({ error: 'evidence_required' })
        return
      }
      if (!options.evidenceStorage) {
        response.status(503).json({ error: 'evidence_storage_not_configured' })
        return
      }
      const assetId = crypto.randomUUID()
      try {
        await options.evidenceStorage.save(assetId, request.file.buffer)
        const asset = store.addAsset({
          id: assetId,
          caseId: serviceCase.id,
          originalName: request.file.originalname.slice(0, 255),
          mediaType: request.file.mimetype,
          byteSize: request.file.size,
          sha256: createHash('sha256').update(request.file.buffer).digest('hex'),
        })
        response.status(201).json({ asset })
      } catch {
        await options.evidenceStorage.remove(assetId)
        response.status(500).json({ error: 'evidence_storage_failed' })
      }
    })
  })

  app.get('/api/cases/:id/evidence/:assetId', async (request, response) => {
    const serviceCase = store.find(
      request.params.id,
      response.locals.authSession.role === 'admin' ? undefined : response.locals.authSession.organizationId,
    )
    if (!serviceCase) {
      response.status(404).json({ error: 'evidence_not_found' })
      return
    }
    const asset = store.findAsset(request.params.id, request.params.assetId)
    if (!asset) {
      response.status(404).json({ error: 'evidence_not_found' })
      return
    }
    if (!options.evidenceStorage) {
      response.status(503).json({ error: 'evidence_storage_not_configured' })
      return
    }
    try {
      const bytes = await options.evidenceStorage.read(asset.id)
      response.set({
        'Content-Type': asset.mediaType,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename="evidence-${asset.id}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      }).send(bytes)
    } catch {
      response.status(404).json({ error: 'evidence_content_not_found' })
    }
  })

  app.post('/api/cases/:id/evidence/analyze', (request, response) => {
    upload.single('evidence')(request, response, async (error) => {
      if (error) {
        response.status(400).json({ error: 'invalid_evidence' })
        return
      }
      if (!options.multimodal) {
        response.status(503).json({ error: 'multimodal_not_configured' })
        return
      }
      const serviceCase = store.find(
        request.params.id,
        response.locals.authSession.role === 'admin' ? undefined : response.locals.authSession.organizationId,
      )
      if (!serviceCase) {
        response.status(404).json({ error: 'case_not_found' })
        return
      }
      if (!request.file) {
        response.status(400).json({ error: 'evidence_required' })
        return
      }
      try {
        const analysis = await options.multimodal(request.file.buffer, request.file.mimetype, serviceCase.summary)
        response.json({ analysis })
      } catch {
        response.status(502).json({ error: 'multimodal_analysis_failed' })
      }
    })
  })

  return app
}
