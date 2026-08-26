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

function App() {
  const [session, setSession] = useState<'checking' | 'authenticated' | 'anonymous'>('checking')
  const [portalSession, setPortalSession] = useState<PortalSession | null>(null)
  const [email, setEmail] = useState('')
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
