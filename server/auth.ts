import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import type { Request, RequestHandler, Response } from 'express'

export type AuthConfig = {
  accessCode: string
  sessionSecret: string
  secureCookies: boolean
  users?: AuthUser[]
  authenticate?: (email: string, accessCode: string) => AuthUser | null
}

export type UserRole = 'homeowner' | 'provider' | 'admin'

export type AuthUser = {
  id: string
  organizationId: string
  email: string
  displayName: string
  role: UserRole
  accessCode: string
}

export type AuthSession = Omit<AuthUser, 'accessCode'> & { exp: number }

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

function issueSession(response: Response, config: AuthConfig, user: AuthUser) {
  const session: AuthSession = {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  response.cookie(cookieName, `${payload}.${sign(payload, config.sessionSecret)}`, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    maxAge: ttlSeconds * 1000,
    path: '/',
  })
}

export function createAuth(config?: AuthConfig) {
  const configuredUsers = config?.users?.length
    ? config.users
    : config
      ? [{
          id: 'local-admin',
          organizationId: 'missedlead-local',
          email: 'admin@local.missedlead',
          displayName: 'Local administrator',
          role: 'admin' as const,
          accessCode: config.accessCode,
        }]
      : []

  function readSession(request: Request): AuthSession | null {
    if (!config) return null
    const token = request.cookies?.[cookieName] as string | undefined
    const [payload, signature] = token?.split('.') ?? []
    if (!payload || !signature || !equalSecret(signature, sign(payload, config.sessionSecret))) return null
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AuthSession
      if (!session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null
      if (!session.id || !session.organizationId || !session.email || !session.displayName || !session.role) return null
      return session
    } catch {
      return null
    }
  }

  const requireSession: RequestHandler = (request, response, next) => {
    if (!config) {
      response.status(503).json({ error: 'auth_not_configured' })
      return
    }
    const session = readSession(request)
    if (!session) {
      response.status(401).json({ error: 'authentication_required' })
      return
    }
    response.locals.authSession = session
    next()
  }

  return {
    requireSession,
    requireRole: (...roles: UserRole[]): RequestHandler => (request, response, next) => {
      const session = readSession(request)
      if (!session) {
        response.status(401).json({ error: 'authentication_required' })
        return
      }
      if (!roles.includes(session.role)) {
        response.status(403).json({ error: 'insufficient_role' })
        return
      }
      response.locals.authSession = session
      next()
    },
    login: ((request, response) => {
      if (!config) {
        response.status(503).json({ error: 'auth_not_configured' })
        return
      }
      const accessCode = typeof request.body?.accessCode === 'string' ? request.body.accessCode : ''
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
      if ((configuredUsers.length > 1 || config.authenticate) && !email) {
        response.status(400).json({ error: 'email_required' })
        return
      }
      const candidates = email
        ? configuredUsers.filter((user) => user.email.toLowerCase() === email)
        : configuredUsers
      const user = config.authenticate?.(email, accessCode)
        ?? candidates.find((candidate) => equalSecret(accessCode, candidate.accessCode))
      if (!user) {
        response.status(401).json({ error: 'invalid_access_code' })
        return
      }
      issueSession(response, config, user)
      response.json({ authenticated: true, session: withoutExpiry(user) })
    }) satisfies RequestHandler,
    logout: ((_request, response) => {
      response.clearCookie(cookieName, { path: '/' })
      response.status(204).end()
    }) satisfies RequestHandler,
  }
}

function withoutExpiry(user: AuthUser): Omit<AuthSession, 'exp'> {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  }
}
