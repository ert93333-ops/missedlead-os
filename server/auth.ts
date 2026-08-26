import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import type { RequestHandler, Response } from 'express'

export type AuthConfig = {
  accessCode: string
  sessionSecret: string
  secureCookies: boolean
}

const cookieName = 'missedlead_session'
const ttlSeconds = 8 * 60 * 60

function equalSecret(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function issueSession(response: Response, config: AuthConfig) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url')
  response.cookie(cookieName, `${payload}.${sign(payload, config.sessionSecret)}`, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    maxAge: ttlSeconds * 1000,
    path: '/',
  })
}

export function createAuth(config?: AuthConfig) {
  const requireSession: RequestHandler = (request, response, next) => {
    if (!config) {
      response.status(503).json({ error: 'auth_not_configured' })
      return
    }
    const token = request.cookies?.[cookieName] as string | undefined
    const [payload, signature] = token?.split('.') ?? []
    if (!payload || !signature || !equalSecret(signature, sign(payload, config.sessionSecret))) {
      response.status(401).json({ error: 'authentication_required' })
      return
    }
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number }
      if (!session.exp || session.exp <= Math.floor(Date.now() / 1000)) throw new Error('expired')
      next()
    } catch {
      response.status(401).json({ error: 'authentication_required' })
    }
  }

  return {
    requireSession,
    login: ((request, response) => {
      if (!config) {
        response.status(503).json({ error: 'auth_not_configured' })
        return
      }
      const accessCode = typeof request.body?.accessCode === 'string' ? request.body.accessCode : ''
      if (!equalSecret(accessCode, config.accessCode)) {
        response.status(401).json({ error: 'invalid_access_code' })
        return
      }
      issueSession(response, config)
      response.json({ authenticated: true })
    }) satisfies RequestHandler,
    logout: ((_request, response) => {
      response.clearCookie(cookieName, { path: '/' })
      response.status(204).end()
    }) satisfies RequestHandler,
  }
}
