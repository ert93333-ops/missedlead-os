/**
 * API 프로세스 엔트리. .env.local/.env 로드 후 app.listen(PORT, 기본 8787).
 * 배포 매니페스트 검증과 백그라운드 잡(견적 확장, 결제 리컨실)을 시작한다.
 * 주의: dotenv override가 .env.local의 PORT를 우선 적용한다.
 */
import { config } from 'dotenv'
import { createApp } from './app.js'
import { refreshCarePriority } from './features/care/index.js'
import { createProductionRepository } from './repository.js'
import { startQuoteExpansion } from './jobs/expandQuotes.js'

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

const server = app.listen(port, () => {
  console.log(`WeCover API listening on http://localhost:${port}`)
})

const stopQuoteExpansion = startQuoteExpansion(createProductionRepository())
const careTimer = setInterval(() => { void refreshCarePriority().catch(() => console.warn('Care priority refresh unavailable')); }, 60_000)
careTimer.unref()

server.once('close', () => {
  stopQuoteExpansion()
  clearInterval(careTimer)
})
process.once('SIGINT', () => { server.close() })
process.once('SIGTERM', () => { server.close() })
