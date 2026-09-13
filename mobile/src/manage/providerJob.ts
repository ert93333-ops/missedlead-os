/**
 * 공급자 작업 타입/유틸: 증빙 종류, 대시보드 데이터 매핑.
 */
export const providerEvidenceKinds = ['before', 'during', 'after', 'receipt', 'warranty'] as const;

export type ProviderEvidenceKind = typeof providerEvidenceKinds[number];

type DashboardEvidence = {
  readonly requestId: string;
  readonly kind: string;
};

type DashboardQuote = {
  readonly requestId: string;
  readonly providerId: string;
};

export type ProviderEvidenceReadiness = {
  readonly kinds: Record<ProviderEvidenceKind, boolean>;
  readonly completionReady: boolean;
};

export function hasProviderQuote(
  requestId: string,
  providerId: string,
  quotes: readonly DashboardQuote[],
): boolean {
  return quotes.some(
    quote => quote.requestId === requestId && quote.providerId === providerId,
  );
}

export function getProviderEvidenceReadiness(
  requestId: string,
  evidence: readonly DashboardEvidence[],
): ProviderEvidenceReadiness {
  const requestKinds = new Set(
    evidence.filter(item => item.requestId === requestId).map(item => item.kind),
  );
  const kinds = Object.fromEntries(
    providerEvidenceKinds.map(kind => [kind, requestKinds.has(kind)]),
  ) as Record<ProviderEvidenceKind, boolean>;

  return { kinds, completionReady: kinds.before && kinds.after };
}
