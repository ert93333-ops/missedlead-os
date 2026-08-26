import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { buildEstimate, validateCase, type Evidence } from './domain'
import { rankHypotheses, type DiagnosticSignal } from './diagnosis'
import { calculateTransparentPrice, defaultPricingPolicy } from './pricing'
import { defaultMaintenanceTerms } from './maintenance'
import { annualMembershipEconomics, completedRepairFee } from './marketplace'
import { evaluateEvidenceProtocol, listEvidenceProtocols, type ProtocolId } from './evidenceProtocols'
import { charlottePilotJurisdiction } from './jurisdiction'
import { estimateCleaningRange, matchHomeCareProviders, type HomeCareTeam, type ServiceProvider } from './homeCare'
import './App.css'

const initialEvidence: Evidence[] = [
  { label: 'Leak overview video', observed: true, weight: 18 },
  { label: 'P-trap close-up', observed: true, weight: 16 },
  { label: 'Meter movement test', observed: false, weight: 20 },
  { label: 'Supply valve photo', observed: false, weight: 14 },
]
const protocolCatalog = listEvidenceProtocols()
type PortalRole = 'homeowner' | 'provider' | 'admin'
type PortalSession = {
  id: string
  organizationId: string
  email: string
  displayName: string
  role: PortalRole
}
type HomeownerProperty = {
  id: string
  customerName: string
  addressLine1: string
  city: string
  state: string
  county: string
  postalCode: string
}
type HomeownerBooking = {
  id: string
  propertyId: string
  service: string
  preferredStart: string
  status: string
  safetyStop: boolean
  estimateLowCents: number | null
  estimateHighCents: number | null
}
type HomeownerNotification = {
  id: string
  type: string
  title: string
  message: string
  readAt: string | null
  createdAt: string
}
type ProviderPricebookItem = {
  id: string
  service: string
  label: string
  baseFeeCents: number
  laborLowCents: number
  laborHighCents: number
  active: boolean
}
type ProviderWorkOrder = {
  id: string
  service: string
  summary: string
  status: string
  scheduledAt: string | null
  finalOutcome: null | { finalPriceCents: number; outcome: string; aiAssessmentOutcome: string }
  customerName?: string
  propertyAddress?: string
}
type AdminBooking = HomeownerBooking & { organizationId: string; symptomSummary: string; assignedProviderId: string | null }
type ProviderServiceBooking = AdminBooking & { providerAcceptedAt: string | null }
type AdminDispute = { id: string; organizationId: string; category: string; summary: string; status: string; resolution: string | null }
type AdminOperations = {
  bookings: AdminBooking[]
  disputes: AdminDispute[]
  providerControls: { organizationId: string; status: string; reason: string }[]
  auditLogs: { id: string; action: string; targetType: string; targetId: string; createdAt: string }[]
  queues: { safetyReview: number; unassigned: number }
}
const demoHomeCareTeam: HomeCareTeam = {
  propertyId: 'charlotte-home',
  coordinatorId: 'coordinator-1',
  assignedProviderIds: ['cleaner-1'],
  backupProviderIds: ['cleaner-2'],
}
const demoProviders: ServiceProvider[] = [
  { id: 'cleaner-1', ownerOrganizationId: 'queen-city-care', name: 'Maya · Primary home care provider', role: 'primary_cleaner', trade: 'cleaning', active: true, licenseVerified: false, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: false },
  { id: 'cleaner-2', ownerOrganizationId: 'queen-city-backup', name: 'Queen City Care · Backup team', role: 'primary_cleaner', trade: 'cleaning', active: true, licenseVerified: false, insured: true, postalCodePrefixes: ['282'], availableForUrgentDispatch: false },
]

function loadEvidence(): Evidence[] {
  try {
    const saved = localStorage.getItem('missedlead:evidence')
    return saved ? JSON.parse(saved) as Evidence[] : initialEvidence
  } catch {
    return initialEvidence
  }
}

function nextAvailableDay(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function App() {
  const [session, setSession] = useState<'checking' | 'authenticated' | 'anonymous'>('checking')
  const [portalSession, setPortalSession] = useState<PortalSession | null>(null)
  const [email, setEmail] = useState('')
  const [homeownerProperties, setHomeownerProperties] = useState<HomeownerProperty[]>([])
  const [homeownerBookings, setHomeownerBookings] = useState<HomeownerBooking[]>([])
  const [homeownerNotifications, setHomeownerNotifications] = useState<HomeownerNotification[]>([])
  const [propertyDraft, setPropertyDraft] = useState({
    customerName: '', addressLine1: '', city: 'Charlotte', state: 'NC', county: 'Mecklenburg', postalCode: '',
  })
  const [bookingDraft, setBookingDraft] = useState({
    propertyId: '', service: 'recurring_cleaning', preferredStart: '', symptomSummary: 'Biweekly home cleaning',
    safetyStop: false, squareFeet: '2200', bathrooms: '2', frequency: 'biweekly', deepClean: false, pets: false,
  })
  const [homeownerMessage, setHomeownerMessage] = useState('')
  const [providerPricebook, setProviderPricebook] = useState<ProviderPricebookItem[]>([])
  const [providerWorkOrders, setProviderWorkOrders] = useState<ProviderWorkOrder[]>([])
  const [providerServiceBookings, setProviderServiceBookings] = useState<ProviderServiceBooking[]>([])
  const [providerEarnings, setProviderEarnings] = useState({ completedJobs: 0, grossRevenueCents: 0 })
  const [pricebookDraft, setPricebookDraft] = useState({
    service: 'hvac_service', label: 'Diagnostic visit', baseFee: '89', laborLow: '90', laborHigh: '290',
  })
  const [availabilityDraft, setAvailabilityDraft] = useState({ weekday: '1', startTime: '08:00', endTime: '17:00', urgent: true })
  const [providerMessage, setProviderMessage] = useState('')
  const [completionDraft, setCompletionDraft] = useState({
    issue: '', parts: '', laborMinutes: '60', finalPrice: '189', outcome: 'resolved', aiAssessmentOutcome: 'corrected',
  })
  const [adminOperations, setAdminOperations] = useState<AdminOperations>({
    bookings: [], disputes: [], providerControls: [], auditLogs: [], queues: { safetyReview: 0, unassigned: 0 },
  })
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, { configured: boolean; humanActionRequired?: boolean; productionReady?: boolean }>>({})
  const [providerControlDraft, setProviderControlDraft] = useState({
    organizationId: 'provider-org', status: 'pending', reason: 'Pending document verification',
  })
  const [dispatchProviderId, setDispatchProviderId] = useState('provider-1')
  const [adminMessage, setAdminMessage] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [loginError, setLoginError] = useState('')
  const [evidence, setEvidence] = useState<Evidence[]>(loadEvidence)
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [consentToText, setConsentToText] = useState(false)
  const [summary, setSummary] = useState('Water under kitchen sink')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [caseId, setCaseId] = useState('')
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [analysisState, setAnalysisState] = useState<'idle' | 'working' | 'done' | 'error' | 'quota'>('idle')
  const [analysisSummary, setAnalysisSummary] = useState<string[]>([])
  const [technicianName, setTechnicianName] = useState('')
  const [propertyCustomer, setPropertyCustomer] = useState('')
  const [propertyAddress, setPropertyAddress] = useState('')
  const [membershipId, setMembershipId] = useState('')
  const [membershipState, setMembershipState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [assetLabel, setAssetLabel] = useState('')
  const [installedYear, setInstalledYear] = useState('')
  const [passport, setPassport] = useState<null | {
    continuityScore: number
    prioritizedActions: { assetId: string; score: number; riskLevel: string; reasons: string[]; action: string; nextDueAt: string }[]
  }>(null)
  const [thresholdEvents, setThresholdEvents] = useState<{
    id: string
    severity: string
    reason: string
    status: string
    recommendedProtocolId: ProtocolId | null
    safetyStop: boolean
  }[]>([])
  const [protocolId, setProtocolId] = useState<ProtocolId>('sink_leak')
  const [protocolAnswers, setProtocolAnswers] = useState<Record<string, string | boolean | number>>({})
  const [protocolEvidenceIds, setProtocolEvidenceIds] = useState<string[]>([])
  const estimate = useMemo(() => buildEstimate(evidence, summary), [evidence, summary])
  const price = useMemo(() => calculateTransparentPrice(defaultPricingPolicy, {
    confidence: estimate.confidence,
    afterHours: true,
    safetyEscalation: estimate.safetyEscalation,
  }), [estimate.confidence, estimate.safetyEscalation])
  const intakeErrors = useMemo(() => validateCase({ customerName, phone, summary, consentToText, evidence }), [customerName, phone, summary, consentToText, evidence])
  const hypotheses = useMemo(() => {
    const signals: DiagnosticSignal[] = []
    if (evidence[0]?.observed) signals.push('leaks_during_drain')
    if (evidence[1]?.observed) signals.push('visible_joint_moisture', 'supply_lines_dry')
    if (evidence[2]?.observed) signals.push('continuous_meter_movement')
    return rankHypotheses(signals)
  }, [evidence])
  const marketplaceEconomics = useMemo(() => annualMembershipEconomics(), [])
  const cleaningEstimate = useMemo(() => estimateCleaningRange({
    squareFeet: 2200, bathrooms: 2, frequency: 'biweekly', deepClean: false, pets: true,
  }), [])
  const cleaningMatches = useMemo(() => matchHomeCareProviders({
    service: 'recurring_cleaning', postalCode: '28210', urgent: false, safetyStop: false,
  }, demoHomeCareTeam, demoProviders), [])
  const selectedProtocol = useMemo(() => protocolCatalog.find((item) => item.id === protocolId)!, [protocolId])
  const protocolEvaluation = useMemo(() => evaluateEvidenceProtocol({
    protocolId,
    answers: protocolAnswers,
    observedEvidenceIds: protocolEvidenceIds,
  }), [protocolId, protocolAnswers, protocolEvidenceIds])

  useEffect(() => {
    localStorage.setItem('missedlead:evidence', JSON.stringify(evidence))
  }, [evidence])

  useEffect(() => {
    fetch('/api/session')
      .then(async (response) => {
        if (!response.ok) {
          setSession('anonymous')
          return
        }
        const result = await response.json() as { session: PortalSession }
        setPortalSession(result.session)
        setSession('authenticated')
      })
      .catch(() => setSession('anonymous'))
  }, [])

  useEffect(() => {
    if (portalSession?.role !== 'homeowner') return
    Promise.all([
      fetch('/api/homeowner/properties').then((response) => response.ok ? response.json() : { properties: [] }),
      fetch('/api/homeowner/bookings').then((response) => response.ok ? response.json() : { bookings: [] }),
      fetch('/api/homeowner/notifications').then((response) => response.ok ? response.json() : { notifications: [] }),
    ]).then(([propertiesResult, bookingsResult, notificationsResult]) => {
      const properties = (propertiesResult as { properties: HomeownerProperty[] }).properties
      setHomeownerProperties(properties)
      setHomeownerBookings((bookingsResult as { bookings: HomeownerBooking[] }).bookings)
      setHomeownerNotifications((notificationsResult as { notifications: HomeownerNotification[] }).notifications)
      if (properties[0]) setBookingDraft((draft) => ({ ...draft, propertyId: draft.propertyId || properties[0].id }))
    }).catch(() => setHomeownerMessage('Home data could not be loaded.'))
  }, [portalSession])

  const refreshAdminOperations = async () => {
    const [operationsResponse, integrationsResponse] = await Promise.all([
      fetch('/api/admin/operations'), fetch('/api/admin/integrations'),
    ])
    if (!operationsResponse.ok || !integrationsResponse.ok) {
      setAdminMessage('Operations data could not be loaded.')
      return
    }
    setAdminOperations(await operationsResponse.json() as AdminOperations)
    const integrationResult = await integrationsResponse.json() as { integrations: typeof integrationStatus }
    setIntegrationStatus(integrationResult.integrations)
  }

  useEffect(() => {
    if (portalSession?.role !== 'admin') return
    queueMicrotask(() => { void refreshAdminOperations() })
  }, [portalSession])

  useEffect(() => {
    if (portalSession?.role !== 'provider') return
    Promise.all([
      fetch('/api/provider/pricebook').then((response) => response.ok ? response.json() : { items: [] }),
      fetch('/api/provider/work-orders').then((response) => response.ok ? response.json() : { workOrders: [], serviceBookings: [], earnings: { completedJobs: 0, grossRevenueCents: 0 } }),
    ]).then(([pricebookResult, workOrderResult]) => {
      setProviderPricebook((pricebookResult as { items: ProviderPricebookItem[] }).items)
      const workData = workOrderResult as { workOrders: ProviderWorkOrder[]; serviceBookings: ProviderServiceBooking[]; earnings: typeof providerEarnings }
      setProviderWorkOrders(workData.workOrders)
      setProviderServiceBookings(workData.serviceBookings)
      setProviderEarnings(workData.earnings)
    }).catch(() => setProviderMessage('Provider workspace could not be loaded.'))
  }, [portalSession])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setLoginError('')
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() || undefined, accessCode }),
    })
    if (!response.ok) {
      const result = await response.json().catch(() => ({ error: 'authentication_failed' })) as { error?: string }
      setLoginError(result.error === 'email_required'
        ? 'Email is required when multiple portal accounts are configured.'
        : 'Email or access code is invalid, or authentication is not configured.')
      return
    }
    const result = await response.json() as { session: PortalSession }
    setAccessCode('')
    setPortalSession(result.session)
    setSession('authenticated')
  }

  const logout = async () => {
    await fetch('/api/session', { method: 'DELETE' })
    setPortalSession(null)
    setSession('anonymous')
    setEmail('')
    setAccessCode('')
  }

  const toggleEvidence = (label: string) => {
    setEvidence((items) =>
      items.map((item) => item.label === label ? { ...item, observed: !item.observed } : item),
    )
  }

  const saveCase = async () => {
    setSaveState('saving')
    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerName,
          phone,
          summary,
          consentToText,
          evidence,
        }),
      })
      if (!response.ok) throw new Error(`Case API returned ${response.status}`)
      const result = await response.json() as { case: { id: string } }
      setCaseId(result.case.id)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  const uploadAndAnalyze = async () => {
    if (!caseId || !evidenceFile) return
    setAnalysisState('working')
    const body = new FormData()
    body.append('evidence', evidenceFile)
    try {
      const upload = await fetch(`/api/cases/${caseId}/evidence`, { method: 'POST', body })
      if (!upload.ok) throw new Error('upload_failed')
      const analysisBody = new FormData()
      analysisBody.append('evidence', evidenceFile)
      const analyzed = await fetch(`/api/cases/${caseId}/evidence/analyze`, { method: 'POST', body: analysisBody })
      if (analyzed.status === 502) {
        setAnalysisState('quota')
        return
      }
      if (!analyzed.ok) throw new Error('analysis_failed')
      const result = await analyzed.json() as { analysis: { observations: string[] } }
      setAnalysisSummary(result.analysis.observations)
      setAnalysisState('done')
    } catch {
      setAnalysisState('error')
    }
  }

  const createMembership = async () => {
    setMembershipState('saving')
    const response = await fetch('/api/maintenance/memberships', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        technicianName,
        technicianPhone: '+15125550199',
        customerName: propertyCustomer,
        propertyAddress,
        terms: defaultMaintenanceTerms,
        compliance: {
          jurisdiction: 'NC',
          legalMode: 'scheduled_maintenance',
          contractorLicenseVerified: true,
          serviceContractRegistrationVerified: false,
        },
        initialRepairCreditCents: 0,
      }),
    })
    if (!response.ok) {
      setMembershipState('error')
      return
    }
    const result = await response.json() as { membership: { id: string } }
    setMembershipId(result.membership.id)
    setMembershipState('saved')
  }

  const addHomeAsset = async () => {
    if (!membershipId) return
    const created = await fetch(`/api/maintenance/memberships/${membershipId}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'hvac',
        label: assetLabel,
        installedYear: Number(installedYear),
        expectedLifeYears: 15,
        serviceIntervalMonths: 12,
        lastServicedAt: null,
        condition: 'good',
      }),
    })
    if (!created.ok) {
      setMembershipState('error')
      return
    }
    const response = await fetch(`/api/maintenance/memberships/${membershipId}/passport`)
    const result = await response.json() as { passport: NonNullable<typeof passport> }
    setPassport(result.passport)
    const evaluated = await fetch(`/api/maintenance/memberships/${membershipId}/evaluate-thresholds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (evaluated.ok) {
      const thresholdResult = await evaluated.json() as { events: typeof thresholdEvents }
      setThresholdEvents(thresholdResult.events)
    }
    setAssetLabel('')
    setInstalledYear('')
  }

  const acknowledgeThresholdEvent = async (eventId: string) => {
    const response = await fetch(`/api/maintenance/events/${eventId}/acknowledge`, { method: 'POST' })
    if (!response.ok) return
    setThresholdEvents((events) => events.map((event) => event.id === eventId ? { ...event, status: 'acknowledged' } : event))
  }

  const createHomeownerProperty = async (event: FormEvent) => {
    event.preventDefault()
    setHomeownerMessage('')
    const response = await fetch('/api/homeowner/properties', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(propertyDraft),
    })
    const result = await response.json() as { property?: HomeownerProperty; issues?: string[] }
    if (!response.ok || !result.property) {
      setHomeownerMessage(result.issues?.join(' ') ?? 'Property could not be added.')
      return
    }
    setHomeownerProperties((properties) => [result.property!, ...properties])
    setBookingDraft((draft) => ({ ...draft, propertyId: result.property!.id }))
    setPropertyDraft((draft) => ({ ...draft, customerName: '', addressLine1: '', postalCode: '' }))
    setHomeownerMessage('Charlotte property added.')
  }

  const createHomeownerBooking = async (event: FormEvent) => {
    event.preventDefault()
    setHomeownerMessage('')
    const preferredStart = bookingDraft.preferredStart ? new Date(bookingDraft.preferredStart).toISOString() : ''
    const response = await fetch('/api/homeowner/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: bookingDraft.propertyId,
        service: bookingDraft.service,
        preferredStart,
        symptomSummary: bookingDraft.symptomSummary,
        safetyStop: bookingDraft.safetyStop,
        confidence: 0,
        cleaningScope: bookingDraft.service === 'recurring_cleaning' ? {
          squareFeet: Number(bookingDraft.squareFeet),
          bathrooms: Number(bookingDraft.bathrooms),
          frequency: bookingDraft.frequency,
          deepClean: bookingDraft.deepClean,
          pets: bookingDraft.pets,
        } : undefined,
      }),
    })
    const result = await response.json() as { booking?: HomeownerBooking; error?: string }
    if (!response.ok || !result.booking) {
      setHomeownerMessage(result.error === 'booking_slot_conflict'
        ? 'That home already has an active request at the selected time.'
        : 'Service request could not be created.')
      return
    }
    setHomeownerBookings((bookings) => [result.booking!, ...bookings])
    const notifications = await fetch('/api/homeowner/notifications')
    if (notifications.ok) setHomeownerNotifications(((await notifications.json()) as { notifications: HomeownerNotification[] }).notifications)
    setHomeownerMessage(result.booking.safetyStop
      ? 'Safety concern routed to human review. Automated pricing and normal booking are stopped.'
      : 'Service request submitted with a preliminary price range.')
  }

  const readHomeownerNotification = async (notificationId: string) => {
    const response = await fetch(`/api/homeowner/notifications/${notificationId}/read`, { method: 'POST' })
    if (!response.ok) return
    setHomeownerNotifications((notifications) => notifications.map((notification) =>
      notification.id === notificationId ? { ...notification, readAt: new Date().toISOString() } : notification))
  }

  const createPricebookItem = async (event: FormEvent) => {
    event.preventDefault()
    const response = await fetch('/api/provider/pricebook', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service: pricebookDraft.service, label: pricebookDraft.label,
        baseFeeCents: Math.round(Number(pricebookDraft.baseFee) * 100),
        laborLowCents: Math.round(Number(pricebookDraft.laborLow) * 100),
        laborHighCents: Math.round(Number(pricebookDraft.laborHigh) * 100),
        active: true,
      }),
    })
    const result = await response.json() as { item?: ProviderPricebookItem; error?: string }
    if (!response.ok || !result.item) {
      setProviderMessage(result.error ?? 'Pricebook item could not be saved.')
      return
    }
    setProviderPricebook((items) => [result.item!, ...items])
    setProviderMessage('Contractor pricebook updated.')
  }

  const createProviderAvailability = async (event: FormEvent) => {
    event.preventDefault()
    const response = await fetch('/api/provider/availability', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        weekday: Number(availabilityDraft.weekday), startTime: availabilityDraft.startTime,
        endTime: availabilityDraft.endTime, urgent: availabilityDraft.urgent,
      }),
    })
    const result = await response.json() as { error?: string }
    setProviderMessage(response.ok ? 'Availability published.' : result.error === 'availability_conflict' ? 'That availability window already exists.' : 'Availability could not be saved.')
  }

  const refreshProviderWorkOrders = async () => {
    const response = await fetch('/api/provider/work-orders')
    if (!response.ok) return
    const result = await response.json() as { workOrders: ProviderWorkOrder[]; serviceBookings: ProviderServiceBooking[]; earnings: typeof providerEarnings }
    setProviderWorkOrders(result.workOrders)
    setProviderServiceBookings(result.serviceBookings)
    setProviderEarnings(result.earnings)
  }

  const advanceProviderWorkOrder = async (workOrder: ProviderWorkOrder) => {
    const action = workOrder.status === 'offered' ? 'accept' : workOrder.status === 'accepted' ? 'schedule' : 'complete'
    const body = action === 'schedule'
      ? { scheduledAt: nextAvailableDay() }
      : action === 'complete'
        ? {
            finalOutcome: {
              technicianConfirmedIssue: completionDraft.issue,
              parts: completionDraft.parts.split(',').map((part) => part.trim()).filter(Boolean),
              laborMinutes: Number(completionDraft.laborMinutes),
              finalPriceCents: Math.round(Number(completionDraft.finalPrice) * 100),
              outcome: completionDraft.outcome,
              aiAssessmentOutcome: completionDraft.aiAssessmentOutcome,
            },
          }
        : {}
    if (action === 'complete' && !completionDraft.issue.trim()) {
      setProviderMessage('Enter the field-confirmed issue before completing work.')
      return
    }
    const response = await fetch(`/api/maintenance/work-orders/${workOrder.id}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const result = await response.json() as { error?: string }
    setProviderMessage(response.ok ? `Work order ${action} recorded.` : result.error ?? 'Work order could not be updated.')
    if (response.ok) await refreshProviderWorkOrders()
  }

  const advanceProviderBooking = async (booking: ProviderServiceBooking) => {
    const action = booking.status === 'assigned' && !booking.providerAcceptedAt
      ? 'accept'
      : booking.status === 'assigned'
        ? 'schedule'
        : 'complete'
    const body = action === 'schedule'
      ? { scheduledAt: nextAvailableDay() }
      : action === 'complete'
        ? {
            finalOutcome: {
              technicianConfirmedIssue: completionDraft.issue,
              parts: completionDraft.parts.split(',').map((part) => part.trim()).filter(Boolean),
              laborMinutes: Number(completionDraft.laborMinutes),
              finalPriceCents: Math.round(Number(completionDraft.finalPrice) * 100),
              outcome: completionDraft.outcome,
              aiAssessmentOutcome: completionDraft.aiAssessmentOutcome,
            },
          }
        : {}
    if (action === 'complete' && !completionDraft.issue.trim()) {
      setProviderMessage('Enter the field-confirmed issue before completing work.')
      return
    }
    const response = await fetch(`/api/provider/service-bookings/${booking.id}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    setProviderMessage(response.ok ? `Service booking ${action} recorded.` : 'Service booking could not be updated.')
    if (response.ok) await refreshProviderWorkOrders()
  }

  const dispatchAdminBooking = async (bookingId: string, safetyReviewed: boolean) => {
    const response = await fetch(`/api/admin/bookings/${bookingId}/dispatch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: dispatchProviderId, safetyReviewed }),
    })
    const result = await response.json() as { error?: string }
    setAdminMessage(response.ok ? 'Booking assigned and audited.' : result.error === 'safety_review_required' ? 'Complete the human safety review before dispatch.' : 'Dispatch failed.')
    if (response.ok) await refreshAdminOperations()
  }

  const saveProviderControl = async (event: FormEvent) => {
    event.preventDefault()
    const response = await fetch('/api/admin/provider-controls', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...providerControlDraft, licenseExpiresAt: null, insuranceExpiresAt: null,
      }),
    })
    setAdminMessage(response.ok ? 'Provider status updated and audited.' : 'Provider status could not be updated.')
    if (response.ok) await refreshAdminOperations()
  }

  const advanceDispute = async (dispute: AdminDispute) => {
    const nextStatus = dispute.status === 'open' ? 'investigating' : 'resolved'
    const response = await fetch(`/api/admin/disputes/${dispute.id}/${nextStatus}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nextStatus === 'resolved' ? { resolution: 'Operator documented resolution and notified the homeowner.' } : {}),
    })
    setAdminMessage(response.ok ? `Dispute moved to ${nextStatus}.` : 'Dispute could not be updated.')
    if (response.ok) await refreshAdminOperations()
  }

  if (session !== 'authenticated') {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={login}>
          <div className="brand"><span>ML</span> MissedLead OS</div>
          <p className="eyebrow">SECURE OPERATIONS CONSOLE</p>
          <h1>{session === 'checking' ? 'Checking session…' : 'Access recovery operations'}</h1>
          {session === 'anonymous' && (
            <>
              <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="Required for role-based accounts" /></label>
              <label>Access code<input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="current-password" required /></label>
              <button type="submit">Sign in</button>
              {loginError && <p className="login-error">{loginError}</p>}
            </>
          )}
        </form>
      </main>
    )
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span>ML</span> MissedLead OS</div>
        <nav className="portal-nav" aria-label="Current portal">
          <span>{portalSession?.displayName ?? 'Authenticated user'}</span>
          <b>{portalSession?.role ?? 'admin'}</b>
          <button type="button" onClick={logout}>Sign out</button>
        </nav>
        <div className="status"><i /> {portalSession?.role === 'homeowner' ? 'Home care active' : portalSession?.role === 'provider' ? 'Provider workspace live' : 'Operations online'}</div>
      </header>

      <section className="portal-context" aria-labelledby="portal-title">
        <div>
          <p className="eyebrow">{portalSession?.role === 'homeowner' ? 'HOMEOWNER PORTAL' : portalSession?.role === 'provider' ? 'SERVICE PROVIDER PORTAL' : 'PLATFORM OPERATIONS'}</p>
          <h2 id="portal-title">{portalSession?.role === 'homeowner' ? 'Your home, care team, and service history.' : portalSession?.role === 'provider' ? 'Assigned work, evidence, and verified outcomes.' : 'Safety, dispatch, provider, and customer operations.'}</h2>
        </div>
        <dl>
          <div><dt>Organization</dt><dd>{portalSession?.organizationId}</dd></div>
          <div><dt>Access role</dt><dd>{portalSession?.role}</dd></div>
        </dl>
      </section>

      {portalSession?.role === 'homeowner' && (
        <section className="role-workspace" aria-labelledby="homeowner-workspace-title">
          <div className="workspace-heading">
            <p className="eyebrow">HOMEOWNER ONBOARDING</p>
            <h2 id="homeowner-workspace-title">Add your Charlotte home and request care.</h2>
            <p>Only Mecklenburg County 282xx addresses are accepted during the pilot.</p>
          </div>
          <div className="workspace-grid">
            <form className="workspace-card" onSubmit={createHomeownerProperty}>
              <h3>Property</h3>
              <label>Home or customer name<input required value={propertyDraft.customerName} onChange={(event) => setPropertyDraft({ ...propertyDraft, customerName: event.target.value })} /></label>
              <label>Street address<input required value={propertyDraft.addressLine1} onChange={(event) => setPropertyDraft({ ...propertyDraft, addressLine1: event.target.value })} /></label>
              <div className="field-row">
                <label>City<input required value={propertyDraft.city} onChange={(event) => setPropertyDraft({ ...propertyDraft, city: event.target.value })} /></label>
                <label>ZIP<input required inputMode="numeric" pattern="\d{5}" value={propertyDraft.postalCode} onChange={(event) => setPropertyDraft({ ...propertyDraft, postalCode: event.target.value })} /></label>
              </div>
              <button type="submit">Add Charlotte property</button>
            </form>
            <form className="workspace-card" onSubmit={createHomeownerBooking}>
              <h3>Service request</h3>
              <label>Property<select required value={bookingDraft.propertyId} onChange={(event) => setBookingDraft({ ...bookingDraft, propertyId: event.target.value })}>
                <option value="">Select a property</option>
                {homeownerProperties.map((property) => <option key={property.id} value={property.id}>{property.addressLine1}</option>)}
              </select></label>
              <label>Service<select value={bookingDraft.service} onChange={(event) => setBookingDraft({ ...bookingDraft, service: event.target.value })}>
                <option value="recurring_cleaning">Recurring cleaning</option>
                <option value="home_care_visit">Home Care Visit</option>
                <option value="hvac_service">HVAC service</option>
                <option value="plumbing_service">Plumbing service</option>
                <option value="handyman_visit">Handyman visit</option>
              </select></label>
              <label>Preferred time<input required type="datetime-local" value={bookingDraft.preferredStart} onChange={(event) => setBookingDraft({ ...bookingDraft, preferredStart: event.target.value })} /></label>
              <label>What do you need?<textarea required value={bookingDraft.symptomSummary} onChange={(event) => setBookingDraft({ ...bookingDraft, symptomSummary: event.target.value })} /></label>
              {bookingDraft.service === 'recurring_cleaning' && <div className="field-row">
                <label>Square feet<input type="number" min="200" value={bookingDraft.squareFeet} onChange={(event) => setBookingDraft({ ...bookingDraft, squareFeet: event.target.value })} /></label>
                <label>Bathrooms<input type="number" min="0" value={bookingDraft.bathrooms} onChange={(event) => setBookingDraft({ ...bookingDraft, bathrooms: event.target.value })} /></label>
              </div>}
              <label className="safety-check"><input type="checkbox" checked={bookingDraft.safetyStop} onChange={(event) => setBookingDraft({ ...bookingDraft, safetyStop: event.target.checked })} /> There is smoke, gas/CO concern, active sparking, sewage, flooding near electricity, or another immediate danger.</label>
              <button type="submit" disabled={!bookingDraft.propertyId}>Request service</button>
            </form>
            <div className="workspace-card booking-list">
              <h3>Current requests</h3>
              {homeownerBookings.length === 0 ? <p className="empty-state">No service requests yet.</p> : homeownerBookings.map((booking) => (
                <article key={booking.id}>
                  <div><strong>{booking.service.replaceAll('_', ' ')}</strong><b>{booking.status}</b></div>
                  <time>{new Date(booking.preferredStart).toLocaleString()}</time>
                  <p>{booking.estimateLowCents === null ? 'Pricing blocked pending human safety review.' : `$${booking.estimateLowCents / 100}–$${booking.estimateHighCents! / 100} preliminary range`}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="workspace-card notification-center">
            <h3>Notifications</h3>
            {homeownerNotifications.length === 0 ? <p className="empty-state">No notifications.</p> : homeownerNotifications.map((notification) => (
              <article key={notification.id} className={notification.readAt ? 'read' : 'unread'}>
                <div><strong>{notification.title}</strong><b>{notification.type}</b></div>
                <p>{notification.message}</p>
                {!notification.readAt && <button onClick={() => readHomeownerNotification(notification.id)}>Mark read</button>}
              </article>
            ))}
          </div>
          {homeownerMessage && <p className="workspace-message" role="status">{homeownerMessage}</p>}
        </section>
      )}

      {portalSession?.role === 'provider' && (
        <section className="role-workspace" aria-labelledby="provider-workspace-title">
          <div className="workspace-heading">
            <p className="eyebrow">PROVIDER BUSINESS OS</p>
            <h2 id="provider-workspace-title">Price work clearly. Control availability. Close the feedback loop.</h2>
            <p>Only completed repair revenue generates a platform fee; unbooked leads remain free.</p>
          </div>
          <div className="workspace-metrics">
            <div><span>Completed jobs</span><strong>{providerEarnings.completedJobs}</strong></div>
            <div><span>Recorded gross revenue</span><strong>${providerEarnings.grossRevenueCents / 100}</strong></div>
            <div><span>Open work</span><strong>{providerWorkOrders.filter((workOrder) => !['completed', 'cancelled'].includes(workOrder.status)).length + providerServiceBookings.filter((booking) => !['completed', 'cancelled'].includes(booking.status)).length}</strong></div>
          </div>
          <div className="workspace-grid">
            <form className="workspace-card" onSubmit={createPricebookItem}>
              <h3>Contractor pricebook</h3>
              <label>Service<select value={pricebookDraft.service} onChange={(event) => setPricebookDraft({ ...pricebookDraft, service: event.target.value })}>
                <option value="hvac_service">HVAC</option><option value="plumbing_service">Plumbing</option>
                <option value="recurring_cleaning">Cleaning</option><option value="handyman_visit">Handyman</option>
              </select></label>
              <label>Line item<input required value={pricebookDraft.label} onChange={(event) => setPricebookDraft({ ...pricebookDraft, label: event.target.value })} /></label>
              <div className="field-row">
                <label>Dispatch $<input type="number" min="0" value={pricebookDraft.baseFee} onChange={(event) => setPricebookDraft({ ...pricebookDraft, baseFee: event.target.value })} /></label>
                <label>Labor range $<span className="inline-inputs"><input type="number" min="0" value={pricebookDraft.laborLow} onChange={(event) => setPricebookDraft({ ...pricebookDraft, laborLow: event.target.value })} /><input type="number" min="0" value={pricebookDraft.laborHigh} onChange={(event) => setPricebookDraft({ ...pricebookDraft, laborHigh: event.target.value })} /></span></label>
              </div>
              <button type="submit">Save pricebook item</button>
              <div className="compact-list">{providerPricebook.map((item) => <p key={item.id}><span>{item.label}</span><b>${item.baseFeeCents / 100} + ${item.laborLowCents / 100}–${item.laborHighCents / 100}</b></p>)}</div>
            </form>
            <form className="workspace-card" onSubmit={createProviderAvailability}>
              <h3>Availability</h3>
              <label>Weekday<select value={availabilityDraft.weekday} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, weekday: event.target.value })}>
                {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select></label>
              <div className="field-row"><label>Start<input type="time" value={availabilityDraft.startTime} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, startTime: event.target.value })} /></label><label>End<input type="time" value={availabilityDraft.endTime} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, endTime: event.target.value })} /></label></div>
              <label className="safety-check"><input type="checkbox" checked={availabilityDraft.urgent} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, urgent: event.target.checked })} /> Available for urgent dispatch coordination</label>
              <button type="submit">Publish availability</button>
            </form>
            <div className="workspace-card booking-list">
              <h3>Assigned work</h3>
              {(providerWorkOrders.some((workOrder) => workOrder.status === 'scheduled') || providerServiceBookings.some((booking) => booking.status === 'scheduled')) && <div className="completion-fields">
                <label>Field-confirmed issue<input value={completionDraft.issue} onChange={(event) => setCompletionDraft({ ...completionDraft, issue: event.target.value })} /></label>
                <label>Parts, comma separated<input value={completionDraft.parts} onChange={(event) => setCompletionDraft({ ...completionDraft, parts: event.target.value })} /></label>
                <div className="field-row"><label>Labor minutes<input type="number" value={completionDraft.laborMinutes} onChange={(event) => setCompletionDraft({ ...completionDraft, laborMinutes: event.target.value })} /></label><label>Final price $<input type="number" value={completionDraft.finalPrice} onChange={(event) => setCompletionDraft({ ...completionDraft, finalPrice: event.target.value })} /></label></div>
              </div>}
              {providerWorkOrders.length === 0 && providerServiceBookings.length === 0 ? <p className="empty-state">No assigned work orders.</p> : providerWorkOrders.map((workOrder) => <article key={workOrder.id}><div><strong>{workOrder.customerName ?? workOrder.summary}</strong><b>{workOrder.status}</b></div><p>{workOrder.propertyAddress ?? workOrder.summary}</p><p>{workOrder.service.replaceAll('_', ' ')}</p>{['offered','accepted','scheduled'].includes(workOrder.status) && <button onClick={() => advanceProviderWorkOrder(workOrder)}>{workOrder.status === 'offered' ? 'Accept work' : workOrder.status === 'accepted' ? 'Schedule next available day' : 'Complete with field outcome'}</button>}</article>)}
              {providerServiceBookings.map((booking) => <article key={booking.id}><div><strong>{booking.symptomSummary}</strong><b>{booking.status}</b></div><p>{booking.service.replaceAll('_', ' ')}</p>{['assigned','scheduled'].includes(booking.status) && <button onClick={() => advanceProviderBooking(booking)}>{booking.status === 'assigned' && !booking.providerAcceptedAt ? 'Accept work' : booking.status === 'assigned' ? 'Schedule next available day' : 'Complete with field outcome'}</button>}</article>)}
            </div>
          </div>
          {providerMessage && <p className="workspace-message" role="status">{providerMessage}</p>}
        </section>
      )}

      {portalSession?.role === 'admin' && (
        <section className="role-workspace" aria-labelledby="admin-workspace-title">
          <div className="workspace-heading">
            <p className="eyebrow">ADMIN CONTROL CENTER</p>
            <h2 id="admin-workspace-title">Review safety. Dispatch deliberately. Keep an audit trail.</h2>
            <p>Danger signals remain outside automated pricing and normal booking until a human records review.</p>
          </div>
          <div className="workspace-metrics">
            <div><span>Safety review queue</span><strong>{adminOperations.queues.safetyReview}</strong></div>
            <div><span>Unassigned requests</span><strong>{adminOperations.queues.unassigned}</strong></div>
            <div><span>Open disputes</span><strong>{adminOperations.disputes.filter((dispute) => dispute.status !== 'resolved').length}</strong></div>
          </div>
          <div className="workspace-grid">
            <div className="workspace-card booking-list">
              <h3>Dispatch queue</h3>
              <label>Provider ID<input value={dispatchProviderId} onChange={(event) => setDispatchProviderId(event.target.value)} /></label>
              {adminOperations.bookings.filter((booking) => ['requested', 'human_review'].includes(booking.status)).map((booking) => (
                <article key={booking.id}>
                  <div><strong>{booking.symptomSummary}</strong><b>{booking.status}</b></div>
                  <p>{booking.service.replaceAll('_', ' ')} · {booking.organizationId}</p>
                  <button onClick={() => dispatchAdminBooking(booking.id, booking.status === 'human_review')}>{booking.status === 'human_review' ? 'Record safety review & assign' : 'Assign provider'}</button>
                </article>
              ))}
              {adminOperations.bookings.length === 0 && <p className="empty-state">No booking activity.</p>}
            </div>
            <form className="workspace-card" onSubmit={saveProviderControl}>
              <h3>Provider control</h3>
              <label>Provider organization<input value={providerControlDraft.organizationId} onChange={(event) => setProviderControlDraft({ ...providerControlDraft, organizationId: event.target.value })} /></label>
              <label>Status<select value={providerControlDraft.status} onChange={(event) => setProviderControlDraft({ ...providerControlDraft, status: event.target.value })}><option value="pending">Pending</option><option value="approved">Approved</option><option value="suspended">Suspended</option></select></label>
              <label>Reason<textarea value={providerControlDraft.reason} onChange={(event) => setProviderControlDraft({ ...providerControlDraft, reason: event.target.value })} /></label>
              <button type="submit">Update provider status</button>
              <div className="compact-list">{adminOperations.providerControls.map((control) => <p key={control.organizationId}><span>{control.organizationId}</span><b>{control.status}</b></p>)}</div>
            </form>
            <div className="workspace-card booking-list">
              <h3>Disputes and refunds</h3>
              {adminOperations.disputes.length === 0 ? <p className="empty-state">No disputes filed.</p> : adminOperations.disputes.map((dispute) => (
                <article key={dispute.id}><div><strong>{dispute.summary}</strong><b>{dispute.status}</b></div><p>{dispute.category} · {dispute.organizationId}</p>{dispute.status !== 'resolved' && <button onClick={() => advanceDispute(dispute)}>{dispute.status === 'open' ? 'Start investigation' : 'Record resolution'}</button>}</article>
              ))}
            </div>
          </div>
          <div className="integration-grid">
            {Object.entries(integrationStatus).map(([name, status]) => <article key={name}><span>{name}</span><b className={status.configured ? 'ready' : 'blocked'}>{status.configured ? 'configured' : 'human action required'}</b></article>)}
          </div>
          <div className="workspace-card audit-list">
            <h3>Recent audit log</h3>
            {adminOperations.auditLogs.slice(0, 8).map((entry) => <p key={entry.id}><time>{new Date(entry.createdAt).toLocaleString()}</time><span>{entry.action}</span><code>{entry.targetType}:{entry.targetId}</code></p>)}
          </div>
          {adminMessage && <p className="workspace-message" role="status">{adminMessage}</p>}
        </section>
      )}

      <section className="hero-panel">
        <div>
          <p className="eyebrow">PLUMBING · INBOUND CASE #ML-2048</p>
          <h1>One missed call.<br />A recoverable job.</h1>
          <p className="lede">The customer was contacted in 42 seconds. Evidence is collected before a technician is dispatched, and every estimate shows what is known and unknown.</p>
        </div>
        <div className="metric"><strong>42s</strong><span>time to recovery</span></div>
      </section>

      <section className="grid">
        <article className="card timeline">
          <div className="card-title"><span>Recovery timeline</span><b>LIVE</b></div>
          <ol>
            <li className="done"><time>10:42:06</time><div><strong>Missed call detected</strong><p>After-hours call · Charlotte, NC</p></div></li>
            <li className="done"><time>10:42:48</time><div><strong>AI text-back delivered</strong><p>Customer replied: “Water under kitchen sink.”</p></div></li>
            <li className="active"><time>10:44:11</time><div><strong>Guided evidence intake</strong><p>2 of 4 requested checks received</p></div></li>
            <li><time>Pending</time><div><strong>Book & dispatch</strong><p>Waiting for estimate acknowledgement</p></div></li>
          </ol>
        </article>

        <article className="card evidence">
          <div className="card-title"><span>Diagnostic evidence</span><b>{estimate.confidence}% confidence</b></div>
          <div className="intake-fields">
            <label>Customer name<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required /></label>
            <label>Phone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15125550142" required /></label>
          </div>
          <label className="summary-field">
            Customer-reported symptom
            <input value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <p className="hint">Toggle evidence to see how the estimate changes.</p>
          {evidence.map((item) => (
            <button key={item.label} className={item.observed ? 'observed' : ''} onClick={() => toggleEvidence(item.label)}>
              <span>{item.observed ? '✓' : '+'}</span>{item.label}<small>{item.observed ? 'verified' : 'request'}</small>
            </button>
          ))}
          <label className="consent-field">
            <input type="checkbox" checked={consentToText} onChange={(event) => setConsentToText(event.target.checked)} />
            Customer agreed to receive transactional service texts.
          </label>
          <div className="protocol-engine">
            <div className="card-title"><span>Adaptive evidence protocol</span><b>{Math.round(selectedProtocol.confidenceCeiling * 100)}% MAX</b></div>
            <select value={protocolId} onChange={(event) => {
              setProtocolId(event.target.value as ProtocolId)
              setProtocolAnswers({})
              setProtocolEvidenceIds([])
            }}>
              {protocolCatalog.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.title}</option>)}
            </select>
            <div className="protocol-questions">
              {selectedProtocol.questions.map((question) => (
                <label key={question.id}>{question.prompt}
                  {question.kind === 'boolean' ? (
                    <select value={String(protocolAnswers[question.id] ?? '')} onChange={(event) => setProtocolAnswers((answers) => ({
                      ...answers,
                      [question.id]: event.target.value === '' ? '' : event.target.value === 'true',
                    }))}>
                      <option value="">Select</option><option value="false">No</option><option value="true">Yes</option>
                    </select>
                  ) : (
                    <input value={String(protocolAnswers[question.id] ?? '')} onChange={(event) => setProtocolAnswers((answers) => ({ ...answers, [question.id]: event.target.value }))} />
                  )}
                </label>
              ))}
            </div>
            <strong className="capture-title">Safe capture checklist</strong>
            {selectedProtocol.evidence.map((item) => (
              <button key={item.id} className={protocolEvidenceIds.includes(item.id) ? 'observed' : ''} onClick={() => setProtocolEvidenceIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])}>
                <span>{protocolEvidenceIds.includes(item.id) ? '✓' : '+'}</span>{item.label}<small>{item.capture}</small>
              </button>
            ))}
            {protocolEvaluation.safetyStop ? (
              <div className="safety-alert"><strong>Stop normal assessment</strong><span>{protocolEvaluation.safetyInstruction}</span></div>
            ) : (
              <div className="protocol-result">
                <strong>Pre-visit differential</strong>
                {protocolEvaluation.hypotheses.length > 0 ? protocolEvaluation.hypotheses.map((item) => (
                  <p key={item.id}>{item.label} <b>{Math.round(item.confidence * 100)}%</b></p>
                )) : <p>Collect the requested evidence before ranking possible causes.</p>}
                <small>Field checks: {protocolEvaluation.requiredFieldChecks.join(' · ') || 'Pending evidence'}</small>
                <small>Estimate variables: {protocolEvaluation.estimateVariables.join(' · ') || 'Pending evidence'}</small>
              </div>
            )}
          </div>
        </article>

        <article className="card estimate">
          <div className="card-title"><span>Transparent estimate</span><b>NOT A FINAL QUOTE</b></div>
          {estimate.safetyEscalation ? (
            <div className="safety-alert">
              <strong>Safety escalation required</strong>
              <span>Estimate and autonomous booking are blocked. Show approved safety guidance and connect a human operator.</span>
            </div>
          ) : (
            <div className="price">${price.low}–${price.high}</div>
          )}
          <p>Expected on-site range based on verified evidence and the contractor’s approved pricing policy.</p>
          <dl>
            {price.components.map((component) => (
              <div key={component.label}>
                <dt>{component.label}<small>{component.basis}</small></dt>
                <dd>${component.low === component.high ? component.low : `${component.low}–$${component.high}`}</dd>
              </div>
            ))}
          </dl>
          <details className="assumptions">
            <summary>Estimate assumptions</summary>
            <ul>{price.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
          </details>
          <div className="unknown"><strong>What could change this price</strong><span>{estimate.missingEvidence.join(' · ') || 'No material evidence missing'}</span></div>
          <div className="hypotheses">
            <strong>Evidence-backed possibilities</strong>
            {hypotheses.length === 0 ? (
              <p>Not enough evidence to rank a possible cause.</p>
            ) : hypotheses.slice(0, 2).map((hypothesis) => (
              <div key={hypothesis.id}>
                <span>{hypothesis.label}</span>
                <b>{hypothesis.confidence}%</b>
                <small>{hypothesis.inspectionRequired}</small>
                <a href={hypothesis.source.url} target="_blank" rel="noreferrer">{hypothesis.source.title}</a>
              </div>
            ))}
          </div>
          <button className="booking" disabled={!estimate.canBook || saveState === 'saving' || intakeErrors.length > 0} onClick={saveCase}>
            {saveState === 'saving' ? 'Saving case…' : estimate.canBook ? 'Send for human approval' : 'More evidence required'}
          </button>
          {saveState === 'saved' && <p className="save-result">Case saved · {caseId}</p>}
          {saveState === 'error' && <p className="save-result error">Case could not be saved. Check API health.</p>}
          {saveState === 'saved' && (
            <div className="upload-panel">
              <label>Photo or video evidence<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} /></label>
              <button disabled={!evidenceFile || analysisState === 'working'} onClick={uploadAndAnalyze}>
                {analysisState === 'working' ? 'Uploading and analyzing…' : 'Upload & analyze evidence'}
              </button>
              {analysisState === 'done' && <ul>{analysisSummary.map((item) => <li key={item}>{item}</li>)}</ul>}
              {analysisState === 'quota' && <p className="save-result error">Evidence was stored, but AI analysis is unavailable because provider credits are exhausted.</p>}
              {analysisState === 'error' && <p className="save-result error">Evidence processing failed without changing the case estimate.</p>}
            </div>
          )}
        </article>
      </section>

      <section className="membership-section">
        <div className="membership-heading">
          <p className="eyebrow">CHARLOTTE HOME CARE MEMBERSHIP</p>
          <h2>One home. One accountable care team.</h2>
          <p>Scheduled care visits, recurring cleaning coordination, and licensed HVAC or plumbing routing—without a repair-coverage promise.</p>
        </div>
        <div className="membership-grid">
          <article className="card">
            <div className="card-title"><span>Recurring cleaning</span><b>BIWEEKLY</b></div>
            <div className="price">${cleaningEstimate.lowCents / 100}–${cleaningEstimate.highCents / 100}</div>
            <p>Preliminary range based on {cleaningEstimate.variables.join(', ')}. Final scope is confirmed before booking.</p>
          </article>
          <article className="card">
            <div className="card-title"><span>Your Home Care Team</span><b>ASSIGNED FIRST</b></div>
            <dl>
              {cleaningMatches.map((match) => (
                <div key={match.provider.id}><dt>{match.relationship}</dt><dd>{match.provider.name}</dd></div>
              ))}
            </dl>
            <p>Assigned providers are offered the visit first; verified backups preserve continuity.</p>
          </article>
        </div>
        <div className="membership-grid">
          <article className="card membership-form">
            <div className="card-title"><span>Assign property</span><b>MONTHLY</b></div>
            <label>Assigned technician<input value={technicianName} onChange={(event) => setTechnicianName(event.target.value)} /></label>
            <label>Customer / property name<input value={propertyCustomer} onChange={(event) => setPropertyCustomer(event.target.value)} /></label>
            <label>Property address<input value={propertyAddress} onChange={(event) => setPropertyAddress(event.target.value)} /></label>
            <button disabled={!technicianName.trim() || !propertyCustomer.trim() || propertyAddress.trim().length < 5 || membershipState === 'saving'} onClick={createMembership}>
              {membershipState === 'saving' ? 'Assigning…' : 'Create maintenance membership'}
            </button>
            {membershipState === 'saved' && <p className="save-result">Membership active · {membershipId}</p>}
            {membershipState === 'error' && <p className="save-result error">Membership could not be created.</p>}
            {membershipState === 'saved' && (
              <div className="asset-form">
                <strong>Add equipment to Home Passport</strong>
                <input placeholder="Main HVAC" value={assetLabel} onChange={(event) => setAssetLabel(event.target.value)} />
                <input type="number" placeholder="Installed year" value={installedYear} onChange={(event) => setInstalledYear(event.target.value)} />
                <button disabled={!assetLabel.trim() || !installedYear} onClick={addHomeAsset}>Add equipment</button>
              </div>
            )}
          </article>
          <article className="card plan-card">
            <div className="card-title"><span>Plan benefits</span><b>${defaultMaintenanceTerms.monthlyFeeCents / 100}/MO</b></div>
            <dl>
              <div><dt>Included maintenance visits</dt><dd>{defaultMaintenanceTerms.includedVisitsPerYear}/year</dd></div>
              <div><dt>Plan classification</dt><dd>Maintenance only</dd></div>
              <div><dt>Repair coverage</dt><dd>Not included</dd></div>
              <div><dt>Charlotte launch mode</dt><dd>NC license verified</dd></div>
            </dl>
          </article>
          <article className="card savings-card">
            <div className="card-title"><span>Charlotte pilot boundary</span><b>MECKLENBURG</b></div>
            <div className="price">{charlottePilotJurisdiction.allowedPostalCodePrefixes[0]}xx</div>
            <dl>
              <div><dt>Launch state</dt><dd>North Carolina</dd></div>
              <div><dt>Cross-border service</dt><dd>South Carolina blocked</dd></div>
              <div><dt>Licensed trades</dt><dd>HVAC + plumbing verified</dd></div>
            </dl>
            <p>{charlottePilotJurisdiction.disclosures[0]}</p>
          </article>
        </div>
        <div className="passport-panel">
          <div>
            <p className="eyebrow">LIVING HOME PASSPORT</p>
            <h3>Maintenance memory that stays with the home.</h3>
            <p>Equipment age, evidence, service history, due dates, and technician observations produce an explainable priority list—not a failure prediction.</p>
          </div>
          <div className="continuity">
            <span>Assigned-tech continuity</span>
            <strong>{passport?.continuityScore ?? 100}%</strong>
          </div>
          <div className="risk-list">
            {passport?.prioritizedActions.length ? passport.prioritizedActions.map((action) => (
              <article key={action.assetId}>
                <div><b>{action.riskLevel.toUpperCase()}</b><strong>{action.score}/100</strong></div>
                <p>{action.action}</p>
                <small>{action.reasons.join(' ')}</small>
              </article>
            )) : <p>Add the first equipment record to generate the explainable maintenance calendar.</p>}
          </div>
        </div>
        <div className="membership-grid">
          {thresholdEvents.length === 0 ? (
            <article className="card">
              <div className="card-title"><span>Preventive events</span><b>CLEAR</b></div>
              <p>No threshold crossings are open. New equipment evidence is evaluated without predicting a confirmed failure.</p>
            </article>
          ) : thresholdEvents.map((event) => (
            <article className="card" key={event.id}>
              <div className="card-title"><span>{event.reason}</span><b>{event.severity.toUpperCase()}</b></div>
              <p>Status: {event.status} · Capture protocol: {event.recommendedProtocolId ?? 'technician review'}</p>
              {event.safetyStop && <p>Automated pricing and normal booking are blocked until this safety event is resolved.</p>}
              {event.status === 'open' && <button onClick={() => acknowledgeThresholdEvent(event.id)}>Acknowledge event</button>}
            </article>
          ))}
        </div>
        <div className="pro-value">
          <div>
            <p className="eyebrow">FAIR PRO MARKETPLACE</p>
            <h3>No fee for a lead that never becomes work.</h3>
            <p>{marketplaceEconomics.proPromise}</p>
          </div>
          <dl>
            <div><dt>Lead fee</dt><dd>$0</dd></div>
            <div><dt>Two included-visit payouts</dt><dd>${marketplaceEconomics.technicianVisitPayoutCents / 100}/year</dd></div>
            <div><dt>Completed $1,000 repair fee</dt><dd>${completedRepairFee(100000) / 100}</dd></div>
            <div><dt>Fee cap per repair</dt><dd>$150</dd></div>
          </dl>
        </div>
      </section>

      <footer><span>Evidence before estimates.</span><span>Human approval before promises.</span><span>Revenue proven after completion.</span></footer>
    </main>
  )
}

export default App
