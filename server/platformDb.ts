import Database from 'better-sqlite3'
import type { HomeCareService } from '../src/homeCare'

export type PlatformProperty = {
  id: string
  organizationId: string
  customerName: string
  addressLine1: string
  city: string
  state: string
  county: string
  postalCode: string
  createdAt: string
}

export type ServiceBooking = {
  id: string
  organizationId: string
  propertyId: string
  service: HomeCareService
  preferredStart: string
  status: 'requested' | 'human_review' | 'assigned' | 'scheduled' | 'completed' | 'cancelled'
  safetyStop: boolean
  symptomSummary: string
  estimateLowCents: number | null
  estimateHighCents: number | null
  assignedProviderId: string | null
  createdAt: string
}

export type ProviderPricebookItem = {
  id: string
  organizationId: string
  service: HomeCareService
  label: string
  baseFeeCents: number
  laborLowCents: number
  laborHighCents: number
  active: boolean
  createdAt: string
}

export type ProviderAvailability = {
  id: string
  organizationId: string
  weekday: number
  startTime: string
  endTime: string
  urgent: boolean
}

export type ProviderControl = {
  organizationId: string
  status: 'pending' | 'approved' | 'suspended'
  licenseExpiresAt: string | null
  insuranceExpiresAt: string | null
  reason: string
  updatedAt: string
}

export type Dispute = {
  id: string
  organizationId: string
  bookingId: string | null
  category: 'refund' | 'quality' | 'safety' | 'billing'
  summary: string
  status: 'open' | 'investigating' | 'resolved'
  resolution: string | null
  createdAt: string
}

export function createPlatformStore(filename: string) {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_properties (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      address_line_1 TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      county TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS platform_properties_org ON platform_properties(organization_id, created_at);
    CREATE TABLE IF NOT EXISTS service_bookings (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      property_id TEXT NOT NULL REFERENCES platform_properties(id),
      service TEXT NOT NULL,
      preferred_start TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('requested','human_review','assigned','scheduled','completed','cancelled')),
      safety_stop INTEGER NOT NULL,
      symptom_summary TEXT NOT NULL,
      estimate_low_cents INTEGER,
      estimate_high_cents INTEGER,
      assigned_provider_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_property_slot ON service_bookings(property_id, preferred_start)
      WHERE status IN ('requested','human_review','assigned','scheduled');
    CREATE TABLE IF NOT EXISTS provider_pricebook_items (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      service TEXT NOT NULL,
      label TEXT NOT NULL,
      base_fee_cents INTEGER NOT NULL CHECK (base_fee_cents >= 0),
      labor_low_cents INTEGER NOT NULL CHECK (labor_low_cents >= 0),
      labor_high_cents INTEGER NOT NULL CHECK (labor_high_cents >= labor_low_cents),
      active INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS provider_pricebook_org ON provider_pricebook_items(organization_id, service);
    CREATE TABLE IF NOT EXISTS provider_availability (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      urgent INTEGER NOT NULL,
      UNIQUE (organization_id, weekday, start_time, end_time)
    );
    CREATE TABLE IF NOT EXISTS provider_controls (
      organization_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending','approved','suspended')),
      license_expires_at TEXT,
      insurance_expires_at TEXT,
      reason TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      booking_id TEXT REFERENCES service_bookings(id),
      category TEXT NOT NULL CHECK (category IN ('refund','quality','safety','billing')),
      summary TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open','investigating','resolved')),
      resolution TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      actor_organization_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  const insertProperty = db.prepare(`INSERT INTO platform_properties
    (id, organization_id, customer_name, address_line_1, city, state, county, postal_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const listProperties = db.prepare('SELECT * FROM platform_properties WHERE organization_id=? ORDER BY created_at DESC')
  const findProperty = db.prepare('SELECT * FROM platform_properties WHERE id=? AND organization_id=?')
  const findPropertyAdmin = db.prepare('SELECT * FROM platform_properties WHERE id=?')
  const insertBooking = db.prepare(`INSERT INTO service_bookings
    (id, organization_id, property_id, service, preferred_start, status, safety_stop, symptom_summary,
     estimate_low_cents, estimate_high_cents, assigned_provider_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
  const listBookings = db.prepare('SELECT * FROM service_bookings WHERE organization_id=? ORDER BY created_at DESC')
  const findBooking = db.prepare('SELECT * FROM service_bookings WHERE id=? AND organization_id=?')
  const findBookingAdmin = db.prepare('SELECT * FROM service_bookings WHERE id=?')
  const insertPricebookItem = db.prepare(`INSERT INTO provider_pricebook_items
    (id, organization_id, service, label, base_fee_cents, labor_low_cents, labor_high_cents, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const listPricebookItems = db.prepare('SELECT * FROM provider_pricebook_items WHERE organization_id=? ORDER BY created_at DESC')
  const insertAvailability = db.prepare(`INSERT INTO provider_availability
    (id, organization_id, weekday, start_time, end_time, urgent) VALUES (?, ?, ?, ?, ?, ?)`)
  const listAvailability = db.prepare('SELECT * FROM provider_availability WHERE organization_id=? ORDER BY weekday, start_time')
  const upsertProviderControl = db.prepare(`INSERT INTO provider_controls
    (organization_id, status, license_expires_at, insurance_expires_at, reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id) DO UPDATE SET status=excluded.status, license_expires_at=excluded.license_expires_at,
      insurance_expires_at=excluded.insurance_expires_at, reason=excluded.reason, updated_at=excluded.updated_at`)
  const listProviderControls = db.prepare('SELECT * FROM provider_controls ORDER BY updated_at DESC')
  const insertDispute = db.prepare(`INSERT INTO disputes
    (id, organization_id, booking_id, category, summary, status, resolution, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?)`)
  const listDisputes = db.prepare('SELECT * FROM disputes ORDER BY created_at DESC')
  const getDispute = db.prepare('SELECT * FROM disputes WHERE id=?')
  const updateDispute = db.prepare('UPDATE disputes SET status=?, resolution=?, updated_at=? WHERE id=?')
  const insertAudit = db.prepare(`INSERT INTO audit_logs
    (id, actor_user_id, actor_organization_id, actor_role, action, target_type, target_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const listAudits = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
  const listAllBookings = db.prepare('SELECT * FROM service_bookings ORDER BY created_at DESC')
  const updateBookingDispatch = db.prepare(`UPDATE service_bookings SET status=?, assigned_provider_id=? WHERE id=?`)

  const mapProperty = (row: Record<string, unknown>): PlatformProperty => ({
    id: String(row.id), organizationId: String(row.organization_id), customerName: String(row.customer_name),
    addressLine1: String(row.address_line_1), city: String(row.city), state: String(row.state), county: String(row.county),
    postalCode: String(row.postal_code), createdAt: String(row.created_at),
  })
  const mapBooking = (row: Record<string, unknown>): ServiceBooking => ({
    id: String(row.id), organizationId: String(row.organization_id), propertyId: String(row.property_id),
    service: String(row.service) as HomeCareService, preferredStart: String(row.preferred_start),
    status: String(row.status) as ServiceBooking['status'], safetyStop: Boolean(row.safety_stop),
    symptomSummary: String(row.symptom_summary),
    estimateLowCents: row.estimate_low_cents === null ? null : Number(row.estimate_low_cents),
    estimateHighCents: row.estimate_high_cents === null ? null : Number(row.estimate_high_cents),
    assignedProviderId: row.assigned_provider_id ? String(row.assigned_provider_id) : null,
    createdAt: String(row.created_at),
  })
  const mapPricebookItem = (row: Record<string, unknown>): ProviderPricebookItem => ({
    id: String(row.id), organizationId: String(row.organization_id), service: String(row.service) as HomeCareService,
    label: String(row.label), baseFeeCents: Number(row.base_fee_cents), laborLowCents: Number(row.labor_low_cents),
    laborHighCents: Number(row.labor_high_cents), active: Boolean(row.active), createdAt: String(row.created_at),
  })
  const mapAvailability = (row: Record<string, unknown>): ProviderAvailability => ({
    id: String(row.id), organizationId: String(row.organization_id), weekday: Number(row.weekday),
    startTime: String(row.start_time), endTime: String(row.end_time), urgent: Boolean(row.urgent),
  })
  const mapProviderControl = (row: Record<string, unknown>): ProviderControl => ({
    organizationId: String(row.organization_id), status: String(row.status) as ProviderControl['status'],
    licenseExpiresAt: row.license_expires_at ? String(row.license_expires_at) : null,
    insuranceExpiresAt: row.insurance_expires_at ? String(row.insurance_expires_at) : null,
    reason: String(row.reason), updatedAt: String(row.updated_at),
  })
  const mapDispute = (row: Record<string, unknown>): Dispute => ({
    id: String(row.id), organizationId: String(row.organization_id),
    bookingId: row.booking_id ? String(row.booking_id) : null, category: String(row.category) as Dispute['category'],
    summary: String(row.summary), status: String(row.status) as Dispute['status'],
    resolution: row.resolution ? String(row.resolution) : null, createdAt: String(row.created_at),
  })

  return {
    createProperty(input: Omit<PlatformProperty, 'id' | 'createdAt'>) {
      const property = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
      insertProperty.run(property.id, property.organizationId, property.customerName, property.addressLine1,
        property.city, property.state, property.county, property.postalCode, property.createdAt)
      return property
    },
    listProperties(organizationId: string) {
      return (listProperties.all(organizationId) as Record<string, unknown>[]).map(mapProperty)
    },
    findProperty(id: string, organizationId?: string) {
      const row = (organizationId ? findProperty.get(id, organizationId) : findPropertyAdmin.get(id)) as Record<string, unknown> | undefined
      return row ? mapProperty(row) : null
    },
    createBooking(input: Omit<ServiceBooking, 'id' | 'createdAt' | 'status' | 'assignedProviderId'>) {
      const status: ServiceBooking['status'] = input.safetyStop ? 'human_review' : 'requested'
      const booking: ServiceBooking = { ...input, id: crypto.randomUUID(), status, assignedProviderId: null, createdAt: new Date().toISOString() }
      try {
        insertBooking.run(booking.id, booking.organizationId, booking.propertyId, booking.service, booking.preferredStart,
          booking.status, booking.safetyStop ? 1 : 0, booking.symptomSummary, booking.estimateLowCents,
          booking.estimateHighCents, booking.createdAt)
      } catch (error) {
        if (error instanceof Error && (
          error.message.includes('one_active_property_slot')
          || error.message.includes('service_bookings.property_id, service_bookings.preferred_start')
        )) return { error: 'booking_slot_conflict' as const }
        throw error
      }
      return { booking }
    },
    listBookings(organizationId: string) {
      return (listBookings.all(organizationId) as Record<string, unknown>[]).map(mapBooking)
    },
    findBooking(id: string, organizationId?: string) {
      const row = (organizationId ? findBooking.get(id, organizationId) : findBookingAdmin.get(id)) as Record<string, unknown> | undefined
      return row ? mapBooking(row) : null
    },
    createPricebookItem(input: Omit<ProviderPricebookItem, 'id' | 'createdAt'>) {
      if (input.laborHighCents < input.laborLowCents) throw new Error('laborHighCents must be greater than or equal to laborLowCents')
      const item = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
      insertPricebookItem.run(item.id, item.organizationId, item.service, item.label, item.baseFeeCents,
        item.laborLowCents, item.laborHighCents, item.active ? 1 : 0, item.createdAt)
      return item
    },
    listPricebookItems(organizationId: string) {
      return (listPricebookItems.all(organizationId) as Record<string, unknown>[]).map(mapPricebookItem)
    },
    createAvailability(input: Omit<ProviderAvailability, 'id'>) {
      if (input.endTime <= input.startTime) throw new Error('endTime must be after startTime')
      const availability = { ...input, id: crypto.randomUUID() }
      try {
        insertAvailability.run(availability.id, availability.organizationId, availability.weekday,
          availability.startTime, availability.endTime, availability.urgent ? 1 : 0)
      } catch (error) {
        if (error instanceof Error && error.message.includes('provider_availability.organization_id')) {
          return { error: 'availability_conflict' as const }
        }
        throw error
      }
      return { availability }
    },
    listAvailability(organizationId: string) {
      return (listAvailability.all(organizationId) as Record<string, unknown>[]).map(mapAvailability)
    },
    listAllBookings() {
      return (listAllBookings.all() as Record<string, unknown>[]).map(mapBooking)
    },
    dispatchBooking(bookingId: string, providerId: string, safetyReviewed: boolean) {
      const booking = this.findBooking(bookingId)
      if (!booking) return { error: 'booking_not_found' as const }
      if (booking.safetyStop && !safetyReviewed) return { error: 'safety_review_required' as const }
      updateBookingDispatch.run('assigned', providerId, bookingId)
      return { booking: this.findBooking(bookingId)! }
    },
    setProviderControl(input: Omit<ProviderControl, 'updatedAt'>) {
      const control = { ...input, updatedAt: new Date().toISOString() }
      upsertProviderControl.run(control.organizationId, control.status, control.licenseExpiresAt,
        control.insuranceExpiresAt, control.reason, control.updatedAt)
      return control
    },
    listProviderControls() {
      return (listProviderControls.all() as Record<string, unknown>[]).map(mapProviderControl)
    },
    createDispute(input: Omit<Dispute, 'id' | 'status' | 'resolution' | 'createdAt'>) {
      if (input.bookingId && !this.findBooking(input.bookingId, input.organizationId)) throw new Error('booking_not_found')
      const dispute: Dispute = { ...input, id: crypto.randomUUID(), status: 'open', resolution: null, createdAt: new Date().toISOString() }
      insertDispute.run(dispute.id, dispute.organizationId, dispute.bookingId, dispute.category,
        dispute.summary, dispute.createdAt, dispute.createdAt)
      return dispute
    },
    listDisputes() {
      return (listDisputes.all() as Record<string, unknown>[]).map(mapDispute)
    },
    transitionDispute(id: string, status: Dispute['status'], resolution?: string) {
      const row = getDispute.get(id) as Record<string, unknown> | undefined
      if (!row) return null
      const current = mapDispute(row)
      const allowed = current.status === 'open' ? ['investigating', 'resolved'] : current.status === 'investigating' ? ['resolved'] : []
      if (!allowed.includes(status)) return { error: 'invalid_transition' as const, dispute: current }
      if (status === 'resolved' && !resolution?.trim()) return { error: 'resolution_required' as const, dispute: current }
      updateDispute.run(status, resolution?.trim() || null, new Date().toISOString(), id)
      return { dispute: mapDispute(getDispute.get(id) as Record<string, unknown>) }
    },
    appendAudit(input: {
      actorUserId: string; actorOrganizationId: string; actorRole: string; action: string;
      targetType: string; targetId: string; metadata?: Record<string, unknown>
    }) {
      const audit = { id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString() }
      insertAudit.run(audit.id, audit.actorUserId, audit.actorOrganizationId, audit.actorRole, audit.action,
        audit.targetType, audit.targetId, JSON.stringify(input.metadata ?? {}), audit.createdAt)
      return audit
    },
    listAudits(limit = 100) {
      return (listAudits.all(Math.min(500, Math.max(1, limit))) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id), actorUserId: String(row.actor_user_id), actorOrganizationId: String(row.actor_organization_id),
        actorRole: String(row.actor_role), action: String(row.action), targetType: String(row.target_type),
        targetId: String(row.target_id), metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
        createdAt: String(row.created_at),
      }))
    },
    close() { db.close() },
  }
}

export type PlatformStore = ReturnType<typeof createPlatformStore>
