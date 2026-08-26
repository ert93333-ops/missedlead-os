import { mkdirSync } from 'node:fs'
import dotenv from 'dotenv'
import { createApp } from './app'
import { createCaseStore } from './db'
import { createFallbackAnalyzer, createGeminiAnalyzer, createMultimodalAnalyzer } from './multimodal'
import { createEvidenceStorage } from './evidenceStorage'
import { createMaintenanceStore } from './maintenanceDb'
import { createMaintenanceScheduler } from './maintenanceScheduler'
import type { AuthUser } from './auth'

dotenv.config({ path: '.env.local' })
mkdirSync('data', { recursive: true })
const store = createCaseStore('data/missedlead.db')
const port = Number(process.env.API_PORT ?? 8787)
const twilioConfig = process.env.TWILIO_AUTH_TOKEN && process.env.PUBLIC_API_URL
  ? {
      authToken: process.env.TWILIO_AUTH_TOKEN,
      publicBaseUrl: process.env.PUBLIC_API_URL,
      humanHandoffNumber: process.env.HUMAN_HANDOFF_NUMBER,
    }
  : undefined
const multimodal = createFallbackAnalyzer(
  process.env.GEMINI_API_KEY ? createGeminiAnalyzer(process.env.GEMINI_API_KEY) : undefined,
  process.env.OPENAI_API_KEY ? createMultimodalAnalyzer(process.env.OPENAI_API_KEY) : undefined,
)
const evidenceStorage = createEvidenceStorage('data/evidence')
const maintenance = createMaintenanceStore('data/missedlead.db')
const maintenanceScheduler = createMaintenanceScheduler(maintenance, {
  intervalMs: Number(process.env.MAINTENANCE_EVALUATION_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
  runImmediately: true,
})
const localUsers: AuthUser[] = process.env.APP_ACCESS_CODE
  ? [{
      id: 'local-admin',
      organizationId: 'missedlead-platform',
      email: process.env.ADMIN_EMAIL ?? 'admin@local.missedlead',
      displayName: 'Platform operator',
      role: 'admin',
      accessCode: process.env.APP_ACCESS_CODE,
    }]
  : []
if (process.env.HOMEOWNER_ACCESS_CODE) {
  localUsers.push({
    id: 'local-homeowner',
    organizationId: 'local-household',
    email: process.env.HOMEOWNER_EMAIL ?? 'homeowner@local.missedlead',
    displayName: 'Charlotte homeowner',
    role: 'homeowner',
    accessCode: process.env.HOMEOWNER_ACCESS_CODE,
  })
}
if (process.env.PROVIDER_ACCESS_CODE) {
  localUsers.push({
    id: 'local-provider',
    organizationId: 'local-provider-org',
    email: process.env.PROVIDER_EMAIL ?? 'provider@local.missedlead',
    displayName: 'Charlotte service provider',
    role: 'provider',
    accessCode: process.env.PROVIDER_ACCESS_CODE,
  })
}
const auth = process.env.APP_ACCESS_CODE && process.env.SESSION_SECRET
  ? {
      accessCode: process.env.APP_ACCESS_CODE,
      sessionSecret: process.env.SESSION_SECRET,
      secureCookies: process.env.NODE_ENV === 'production',
      users: localUsers,
    }
  : undefined
const server = createApp(store, { twilio: twilioConfig, multimodal, evidenceStorage, auth, maintenance }).listen(port, '127.0.0.1', () => {
  console.log(`MissedLead API listening on http://127.0.0.1:${port}`)
})

function shutdown() {
  maintenanceScheduler.stop()
  server.close(() => {
    store.close()
    maintenance.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
