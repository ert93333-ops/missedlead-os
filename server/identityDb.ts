import Database from 'better-sqlite3'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AuthUser, UserRole } from './auth'

export type IdentityUser = Omit<AuthUser, 'accessCode'> & {
  active: boolean
  createdAt: string
}

function hashAccessCode(accessCode: string, salt: Buffer): Buffer {
  return scryptSync(accessCode, salt, 32)
}

export function createIdentityStore(filename: string) {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS identity_users (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('homeowner','provider','admin')),
      access_code_salt BLOB NOT NULL,
      access_code_hash BLOB NOT NULL,
      active INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS identity_users_org ON identity_users(organization_id, role);
  `)
  const insertUser = db.prepare(`INSERT INTO identity_users
    (id, organization_id, email, display_name, role, access_code_salt, access_code_hash, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
  const findByEmail = db.prepare('SELECT * FROM identity_users WHERE email=? COLLATE NOCASE')
  const listUsers = db.prepare('SELECT * FROM identity_users ORDER BY created_at DESC')
  const updateActive = db.prepare('UPDATE identity_users SET active=? WHERE id=?')
  const findById = db.prepare('SELECT * FROM identity_users WHERE id=?')

  const mapUser = (row: Record<string, unknown>): IdentityUser => ({
    id: String(row.id), organizationId: String(row.organization_id), email: String(row.email),
    displayName: String(row.display_name), role: String(row.role) as UserRole,
    active: Boolean(row.active), createdAt: String(row.created_at),
  })

  return {
    createUser(input: { organizationId: string; email: string; displayName: string; role: UserRole; accessCode: string }) {
      if (input.accessCode.length < 8) throw new Error('Access code must be at least 8 characters')
      const salt = randomBytes(16)
      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      try {
        insertUser.run(id, input.organizationId, input.email.trim().toLowerCase(), input.displayName.trim(), input.role,
          salt, hashAccessCode(input.accessCode, salt), createdAt)
      } catch (error) {
        if (error instanceof Error && error.message.includes('identity_users.email')) return { error: 'email_already_exists' as const }
        throw error
      }
      return { user: mapUser(findById.get(id) as Record<string, unknown>) }
    },
    authenticate(email: string, accessCode: string): AuthUser | null {
      const row = findByEmail.get(email.trim().toLowerCase()) as Record<string, unknown> | undefined
      if (!row || !row.active) return null
      const expected = row.access_code_hash as Buffer
      const actual = hashAccessCode(accessCode, row.access_code_salt as Buffer)
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
      return { ...mapUser(row), accessCode }
    },
    listUsers(): IdentityUser[] {
      return (listUsers.all() as Record<string, unknown>[]).map(mapUser)
    },
    setUserActive(id: string, active: boolean) {
      if (updateActive.run(active ? 1 : 0, id).changes === 0) return null
      return mapUser(findById.get(id) as Record<string, unknown>)
    },
    close() { db.close() },
  }
}

export type IdentityStore = ReturnType<typeof createIdentityStore>
