/**
 * API 프로세스 엔트리. .env.local/.env 로드 후 app.listen(기본 8787).
 * 배포 매니페스트 검증과 백그라운드 잡(견적 확장, 결제 리컨실)을 시작한다.
 * 주의: dotenv override가 .env.local의 PORT를 우선 적용하므로, 포트를 바꾸려면
 * .env.local에 없는 API_PORT를 사용한다(예: 다른 로컬 서비스가 8787을 점유할 때).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import express from 'express'
import { createApp } from './app.js'
import { refreshCarePriority } from './features/care/index.js'
import { createProductionRepository } from './repository.js'
import { startQuoteExpansion } from './jobs/expandQuotes.js'

config({ path: ['.env.local', '.env'], quiet: true, override: process.env.NODE_ENV !== 'production' })

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787)
let deploymentManifest: unknown
try {
  deploymentManifest = process.env.DEPLOYMENT_MANIFEST_JSON
    ? JSON.parse(process.env.DEPLOYMENT_MANIFEST_JSON)
    : undefined
} catch {
  deploymentManifest = undefined
}
const app = createApp({ deploymentManifest })

// Production single-service mode: serve the built Vite bundle so one host
// (e.g. a free Render web service) exposes UI + API on the same origin.
const serveStatic = process.env.SERVE_STATIC === '1' || process.env.SERVE_STATIC === 'true'
const distDir = path.resolve('dist')
if (serveStatic && existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { index: false }))
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api')) return next()
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

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
