import { config } from 'dotenv'
import { createApp } from './app.js'
import { refreshCarePriority } from './features/care/index.js'

config({ path: ['.env.local', '.env'], quiet: true, override: process.env.NODE_ENV !== 'production' })

const port = Number(process.env.PORT ?? 8787)
let deploymentManifest: unknown
try {
  deploymentManifest = process.env.DEPLOYMENT_MANIFEST_JSON
    ? JSON.parse(process.env.DEPLOYMENT_MANIFEST_JSON)
    : undefined
} catch {
  deploymentManifest = undefined
}
const app = createApp({ deploymentManifest })

app.listen(port, () => {
  console.log(`WeCover API listening on http://localhost:${port}`)
})

const careTimer = setInterval(() => { void refreshCarePriority().catch(() => console.warn('Care priority refresh unavailable')); }, 60_000)
careTimer.unref()
