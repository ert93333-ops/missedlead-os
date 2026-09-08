import { describe, expect, it } from 'vitest';
import { diagnosticKnowledge, retrieveDiagnosticKnowledge } from './index.js';
import { sources } from './sources.js';
describe('source-backed diagnostic retrieval', () => {
  it.each([
    ['My toilet keeps running', 'en', 'toilet-running'],
    ['El inodoro pierde agua por la base', 'es', 'toilet-external-leak'],
    ['The AC is not cooling', 'en', 'ac-no-cooling'],
    ['El aire acondicionado gotea agua', 'es', 'ac-water-leak'],
    ['Water heater has rusty hot water', 'en', 'heater-discolored'],
    ['La ventana tiene condensación', 'es', 'window-condensation'],
    ['Toilet refills every ten minutes', 'en', 'toilet-cycling'],
    ['Kitchen faucet leaks at its base', 'en', 'faucet-base-leak'],
    ['El grifo tiene poco caudal', 'es', 'faucet-low-flow'],
    ['The shower drips after use', 'en', 'shower-drip'],
    ['The drain is blocked', 'en', 'drain-backup'],
    ['La pared está mojada con agua', 'es', 'building-water-leak'],
    ['No hot water from any tap', 'en', 'heater-no-hot-water'],
    ['The water heater has a leak', 'en', 'heater-leak'],
    ['El calentador hace ruido', 'es', 'heater-noise'],
    ['Ice on the AC pipe', 'en', 'ac-ice'],
    ['Rain water at the window sill', 'en', 'window-water'],
    ['The wall has a widening crack', 'en', 'wall-cracks'],
    ['Hay olor a gas', 'es', 'gas-emergency'],
    ['Water under my kitchen sink', 'en', 'under-sink-leak'],
    ['Hay agua debajo del fregadero', 'es', 'under-sink-leak'],
    ['The AC makes a rattling noise', 'en', 'ac-unusual-noise'],
    ['El aire acondicionado hace ruido', 'es', 'ac-unusual-noise'],
    ['The dishwasher is leaking', 'en', 'dishwasher-leak'],
    ['El lavavajillas pierde agua', 'es', 'dishwasher-leak'],
    ['The CO detector alarm is sounding', 'en', 'co-alarm-or-symptoms'],
    ['La alarma de monóxido de carbono está sonando', 'es', 'co-alarm-or-symptoms'],
    ['Sewage is backing up from the drain', 'en', 'sewage-backup'],
    ['Las aguas residuales rebosan del desagüe', 'es', 'sewage-backup'],
    ['After the leak the wall is still wet and smells musty', 'en', 'post-leak-mold-moisture'],
    ['Después de la fuga sigue mojado y hay moho', 'es', 'post-leak-mold-moisture'],
    ['The furnace has a yellow flame and soot', 'en', 'furnace-combustion-warning'],
    ['El horno tiene llama amarilla y hollín', 'es', 'furnace-combustion-warning'],
    ['The HVAC breaker keeps tripping', 'en', 'hvac-repeated-breaker'],
    ['El interruptor del aire acondicionado se dispara otra vez', 'es', 'hvac-repeated-breaker'],
    ['The heat pump has persistent frost and aux heat stays on', 'en', 'heat-pump-frost-aux'],
    ['La bomba de calor tiene hielo y calor auxiliar continuo', 'es', 'heat-pump-frost-aux'],
  ] as const)('retrieves an appropriate case for %s', (text, locale, id) => {
    const result = retrieveDiagnosticKnowledge(text, locale);
    expect(result.records.map(record => record.id)).toContain(id);
    expect(result.records.length).toBeLessThanOrEqual(5);
  });
  it('returns no fabricated case for unrelated requests', () => {
    expect(retrieveDiagnosticKnowledge('Book a flight to Madrid', 'en').records).toEqual([]);
  });
  it('prioritizes suspected gas even when routine symptoms are present', () => {
    const result = retrieveDiagnosticKnowledge('AC not cooling and I smell gas', 'en');
    expect(result.emergency).toBe(true);
    expect(result.records.map(record => record.id)).toEqual(['gas-emergency']);
  });
  it.each([
    ['The heat pump has frost and the CO alarm is sounding', 'en', 'co-alarm-or-symptoms'],
    ['El HVAC no enfría y las aguas residuales rebosan', 'es', 'sewage-backup'],
  ] as const)('prioritizes a new safety record over routine symptoms: %s', (text, locale, id) => {
    const result = retrieveDiagnosticKnowledge(text, locale);
    expect(result.emergency).toBe(true);
    expect(result.records.map(record => record.id)).toEqual([id]);
  });
  it.each(['No gas smell; AC is not cooling', 'I do not smell gas', 'No hay olor a gas', 'Sin olor a gas'])('does not mark explicit absent gas evidence as present: %s', text => {
    expect(retrieveDiagnosticKnowledge(text, 'en').emergency).toBe(false);
  });
  it('contains distinct source-attributed cases with explicit field limits', () => {
    expect(diagnosticKnowledge.length).toBeGreaterThanOrEqual(15);
    expect(new Set(diagnosticKnowledge.map(record => record.id)).size).toBe(diagnosticKnowledge.length);
    for (const record of diagnosticKnowledge) {
      expect(record.sources.length).toBeGreaterThan(0);
      expect(record.onSiteRequired).toBe(true);
      expect(record.questions.length).toBeGreaterThan(0);
      for (const source of record.sources) expect(new URL(source.url).protocol).toBe('https:');
    }
  });
  it('keeps every researched record bilingual, bounded, on-site, and officially sourced', () => {
    const researchedIds = [
      'co-alarm-or-symptoms',
      'sewage-backup',
      'post-leak-mold-moisture',
      'furnace-combustion-warning',
      'hvac-repeated-breaker',
      'heat-pump-frost-aux',
    ];
    for (const id of researchedIds) {
      const record = diagnosticKnowledge.find(candidate => candidate.id === id);
      expect(record, id).toBeDefined();
      expect(record?.title.en).toBeTruthy();
      expect(record?.title.es).toBeTruthy();
      expect(record?.questions).toHaveLength(1);
      expect(record?.questions[0]?.en).toBeTruthy();
      expect(record?.questions[0]?.es).toBeTruthy();
      expect(record?.safeObservation.en).toBeTruthy();
      expect(record?.safeObservation.es).toBeTruthy();
      expect(record?.candidateCauses.length).toBeGreaterThanOrEqual(2);
      expect(record?.redFlags.length).toBeGreaterThan(0);
      expect(record?.onSiteRequired).toBe(true);
      expect(record?.sources.length).toBeGreaterThan(0);
      for (const source of record?.sources ?? []) {
        expect(new URL(source.url).protocol).toBe('https:');
        expect(source.title).toMatch(/CDC|CPSC|Department of Energy|ENERGY STAR|EPA|Mecklenburg|Charlotte Water/);
        expect(source.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
  it('registers the researched federal and Mecklenburg official sources with current provenance', () => {
    const researchedSources = [
      sources.mecklenburgPermitting,
      sources.mecklenburgHomeownerPermitting,
      sources.mecklenburgTradePermitting,
      sources.mecklenburgCodeSupport,
      sources.epaCarbonMonoxide,
      sources.cdcCarbonMonoxide,
      sources.cpscCarbonMonoxide,
      sources.epaMoldCleanup,
      sources.epaFloodCleanup,
      sources.cdcMoldCleanup,
      sources.energyStarHvacMaintenance,
      sources.doeAcMaintenance,
      sources.epaSection608,
    ];
    for (const source of researchedSources) {
      expect(new URL(source.url).protocol).toBe('https:');
      expect(source.accessedAt).toBe('2026-09-06');
      expect(source.title).toMatch(/Mecklenburg|U\.S\./);
    }
  });
});

describe('toilet symptom evidence polarity', () => {
  it.each([
    ['El inodoro sigue corriendo. No hay agua en el suelo.', 'es'],
    ['The toilet keeps running. There is no water on the floor.', 'en'],
  ] as const)('keeps running evidence and excludes denied external water: %s', (text, locale) => {
    const ids = retrieveDiagnosticKnowledge(text, locale).records.map(record => record.id);
    expect(ids).toContain('toilet-running');
    expect(ids).not.toContain('toilet-external-leak');
  });
  it.each([
    ['El inodoro sigue corriendo. No hay agua en el suelo, pero hay agua saliendo del tanque.', 'es'],
    ['The toilet keeps running. No water on the floor, but water is leaking from the tank.', 'en'],
  ] as const)('preserves a separate positive external leak clause: %s', (text, locale) => {
    const ids = retrieveDiagnosticKnowledge(text, locale).records.map(record => record.id);
    expect(ids).toContain('toilet-running');
    expect(ids).toContain('toilet-external-leak');
  });
});
