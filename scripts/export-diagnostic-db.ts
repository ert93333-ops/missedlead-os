/**
 * 진단 지식 레코드를 sqlite/JSON으로보내는 유틸(data/diagnostic-knowledge.*).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { diagnosticKnowledge } from '../server/intake/knowledge/index.js';
mkdirSync('data', { recursive: true });
const database = new DatabaseSync('data/diagnostic-knowledge.sqlite');
database.exec('CREATE TABLE IF NOT EXISTS diagnostic_knowledge (id TEXT PRIMARY KEY, category TEXT NOT NULL, content TEXT NOT NULL, source_checked_at TEXT NOT NULL, dataset_hash TEXT NOT NULL)');
const serialized = JSON.stringify(diagnosticKnowledge);
const hash = createHash('sha256').update(serialized).digest('hex');
try {
 database.exec('BEGIN');
 const statement = database.prepare('INSERT INTO diagnostic_knowledge (id,category,content,source_checked_at,dataset_hash) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category=excluded.category,content=excluded.content,source_checked_at=excluded.source_checked_at,dataset_hash=excluded.dataset_hash');
 for (const record of diagnosticKnowledge) statement.run(record.id, record.category, JSON.stringify(record), record.sources[0]?.accessedAt ?? 'unknown', hash);
 database.exec('COMMIT');
 writeFileSync('data/diagnostic-knowledge.json', JSON.stringify({version:1,kind:'reviewed_reference_collection',hash,records:diagnosticKnowledge},null,2));
 console.log(JSON.stringify({records:diagnosticKnowledge.length,hash,database:'data/diagnostic-knowledge.sqlite'}));
} finally { database.close(); }
