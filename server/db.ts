import Database from 'better-sqlite3'
import type { Evidence } from '../src/domain'

export type StoredCase = {
  id: string
  customerName: string
  phone: string
  summary: string
  consentToText: boolean
  evidence: Evidence[]
  createdAt: string
}

export type EvidenceAsset = {
  id: string
  caseId: string
  originalName: string
  mediaType: string
  byteSize: number
  sha256: string
  createdAt: string
}

export function createCaseStore(filename: string) {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_cases (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      summary TEXT NOT NULL,
      consent_to_text INTEGER NOT NULL CHECK (consent_to_text IN (0, 1)),
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_assets (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)

  const insert = db.prepare(`
    INSERT INTO service_cases (id, customer_name, phone, summary, consent_to_text, evidence_json, created_at)
    VALUES (@id, @customerName, @phone, @summary, @consentToText, @evidenceJson, @createdAt)
  `)
  const find = db.prepare('SELECT * FROM service_cases WHERE id = ?')
  const insertAsset = db.prepare(`
    INSERT INTO evidence_assets (id, case_id, original_name, media_type, byte_size, sha256, created_at)
    VALUES (@id, @caseId, @originalName, @mediaType, @byteSize, @sha256, @createdAt)
  `)
  const listAssets = db.prepare('SELECT * FROM evidence_assets WHERE case_id = ? ORDER BY created_at ASC')
  const findAsset = db.prepare('SELECT * FROM evidence_assets WHERE id = ? AND case_id = ?')

  const mapAsset = (row: Record<string, unknown>): EvidenceAsset => ({
    id: String(row.id),
    caseId: String(row.case_id),
    originalName: String(row.original_name),
    mediaType: String(row.media_type),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    createdAt: String(row.created_at),
  })

  return {
    create(input: Omit<StoredCase, 'id' | 'createdAt'>): StoredCase {
      const stored: StoredCase = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
      insert.run({
        ...stored,
        consentToText: stored.consentToText ? 1 : 0,
        evidenceJson: JSON.stringify(stored.evidence),
      })
      return stored
    },
    find(id: string): StoredCase | null {
      const row = find.get(id) as Record<string, unknown> | undefined
      if (!row) return null
      return {
        id: String(row.id),
        customerName: String(row.customer_name),
        phone: String(row.phone),
        summary: String(row.summary),
        consentToText: Boolean(row.consent_to_text),
        evidence: JSON.parse(String(row.evidence_json)) as Evidence[],
        createdAt: String(row.created_at),
      }
    },
    addAsset(input: Omit<EvidenceAsset, 'createdAt'>): EvidenceAsset {
      const asset = { ...input, createdAt: new Date().toISOString() }
      insertAsset.run(asset)
      return asset
    },
    listAssets(caseId: string): EvidenceAsset[] {
      return (listAssets.all(caseId) as Record<string, unknown>[]).map(mapAsset)
    },
    findAsset(caseId: string, assetId: string): EvidenceAsset | null {
      const row = findAsset.get(assetId, caseId) as Record<string, unknown> | undefined
      return row ? mapAsset(row) : null
    },
    close() { db.close() },
  }
}

export type CaseStore = ReturnType<typeof createCaseStore>
