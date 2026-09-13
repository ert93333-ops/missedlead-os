/**
 * 진단 지식 타입: DiagnosticRecord(카테고리·신호·질문·안전관찰·출처·레드플래그).
 */
export type KnowledgeLocale = 'en' | 'es';
export type LocalizedText = Readonly<Record<KnowledgeLocale, string>>;
export type DiagnosticSource = { readonly title: string; readonly url: string; readonly accessedAt: string };
export type DiagnosticRecord = {
  readonly id: string;
  readonly category: 'plumbing' | 'hvac' | 'handyman' | 'emergency';
  readonly title: LocalizedText;
  readonly signals: readonly (readonly string[])[];
  readonly candidateCauses: readonly string[];
  readonly questions: readonly LocalizedText[];
  readonly safeObservation: LocalizedText;
  readonly redFlags: readonly string[];
  readonly onSiteRequired: true;
  readonly limitation: string;
  readonly sources: readonly DiagnosticSource[];
};
export const bilingual = (en: string, es: string): LocalizedText => ({ en, es });
export function source(title: string, url: string): DiagnosticSource {
  return { title, url, accessedAt: '2026-09-05' };
}
