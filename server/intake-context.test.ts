/**
 * diagnosticContext 지식 매칭/폴백 모드 테스트.
 */
import { describe, it, expect } from 'vitest';
import { diagnosticContext } from './intake/diagnosticContext.js';
import type { AnalyzeInput } from './intake/types.js';
const input = (content: string): AnalyzeInput => ({ locale: 'en', history: [{ role: 'user', content }], media: [], skippedQuestionIds: [], skippedQuestions: [] });
describe('source context routing', () => {
 it('retrieves toilet references from customer observations', () => {const value=diagnosticContext(input('My toilet keeps running continuously'));expect(value.mode).toBe('symptom_reference');expect(value.records.some(record=>record.id==='toilet-running')).toBe(true);});
 it('does not use an assistant suggestion as customer evidence', () => {const value=diagnosticContext({...input('Hello'),history:[{role:'assistant',content:'Your toilet keeps running'}]});expect(value.records).toEqual([]);});
 it('makes a bounded catalog available for media without known symptoms', () => {const value=diagnosticContext({...input('Please inspect this'),media:[{buffer:Buffer.from('fixture'),contentType:'image/png',digest:'fixture'}]});expect(value.mode).toBe('media_reference_catalog');expect(value.records.length).toBeGreaterThan(10);expect(value.records.length).toBeLessThanOrEqual(30);});
});
