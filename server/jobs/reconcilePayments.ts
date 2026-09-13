/**
 * 결제 리컨실 잡: Stripe 클레임(결제/분쟁/이체/취소)을 점검·재시도·완료 처리하고
 * 실행 결과 요약(ReconciliationSummary)을 남긴다.
 */
import type { StripePayments } from "../app.js";
import type { CommandContext, MoneyKind, Repository } from "../repository.js";

export interface ReconciliationSummary { runId: string; startedAt: string; finishedAt: string; inspected: number; completed: number; retried: number; failed: number; outcomes: Array<{ claimId: string; kind: string; outcome: string; providerReference?: string }> }
export type DrainProviderReference =
  | { kind: "payment_intent"; id: string }
  | { kind: "dispute"; id: string }
  | { kind: "transfer"; id: string }
  | { kind: "reversal"; id: string }
  | { kind: "refund"; id: string };
export interface DrainProviderObservation { kind: DrainProviderReference["kind"]; status: string }
export interface DrainPayments {
  constructWebhook(payload: Buffer, signature: string): ReturnType<StripePayments["constructWebhook"]>;
  retrieveExistingObligation(providerReference: DrainProviderReference, claim?: { kind: MoneyKind; providerIdempotencyKey?: string }): Promise<DrainProviderObservation | undefined>;
}

const referencePrefixes: ReadonlyArray<readonly [DrainProviderReference["kind"], string]> = [
  ["payment_intent", "pi_"],
  ["dispute", "dp_"],
  ["transfer", "tr_"],
  ["reversal", "trr_"],
  ["refund", "re_"],
];

export const parseDrainProviderReference = (id: string): DrainProviderReference | undefined => {
  const match = referencePrefixes.find(([, prefix]) => id.startsWith(prefix));
  return match && id.length > match[1].length ? { kind: match[0], id } as DrainProviderReference : undefined;
};

const providerKindsByMoneyKind: Record<MoneyKind, ReadonlySet<DrainProviderReference["kind"]>> = {
  deposit: new Set(["payment_intent"]),
  balance: new Set(["payment_intent"]),
  payment_succeeded: new Set(["payment_intent"]),
  settlement: new Set(["transfer"]),
  refund: new Set(["refund"]),
  external_dispute: new Set(["dispute", "reversal"]),
  recovery: new Set(["transfer"]),
};

const terminalStatuses: Record<DrainProviderReference["kind"], ReadonlySet<string>> = {
  payment_intent: new Set(["succeeded"]),
  dispute: new Set(["won", "lost"]),
  transfer: new Set(["succeeded"]),
  reversal: new Set(["succeeded"]),
  refund: new Set(["succeeded"]),
};

export const isDrainObservationAllowed = (
  moneyKind: MoneyKind,
  reference: DrainProviderReference,
  observation: DrainProviderObservation,
) => (observation.kind === reference.kind || (moneyKind === "external_dispute" && reference.kind === "transfer" && observation.kind === "reversal"))
  && providerKindsByMoneyKind[moneyKind].has(observation.kind)
  && terminalStatuses[observation.kind].has(observation.status);

/** Recovers claims left behind when the process died after a Stripe side effect. */
export async function reconcilePayments(repository: Repository, stripe: StripePayments, now = new Date(), staleAfterMs = 5 * 60_000): Promise<ReconciliationSummary> {
  const claims = await repository.stuckMoneyClaims(new Date(now.getTime() - staleAfterMs).toISOString());
  const summary: ReconciliationSummary = { runId: `reconcile-${now.toISOString()}`, startedAt: now.toISOString(), finishedAt: now.toISOString(), inspected: claims.length, completed: 0, retried: 0, failed: 0, outcomes: [] };
  const context: CommandContext = { actor: { id: "payment-reconciler", role: "operator" }, accessToken: "", now: now.toISOString() };
  for (const claim of claims) {
    try {
      if (claim.kind === "settlement") {
        const transferId = await stripe.findTransfer(claim.claimId);
        if (transferId) {
          await repository.completeMoney("settlement", claim.claimId, transferId, context);
          summary.completed++;
          summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "existing_transfer_completed", providerReference: transferId });
        } else {
          await repository.failMoney("settlement", claim.claimId, "stripe_transfer_not_found", context);
          summary.retried++;
          summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "transfer_not_found" });
        }
        continue;
      }
      if (claim.kind === "external_dispute" && claim.providerReference && claim.amountCents > 0) {
        const stableKey = claim.providerIdempotencyKey ?? `reversal:${claim.claimId}`;
        const reversalId = await stripe.findReversal(claim.providerReference, stableKey) ?? await stripe.reverse(claim.providerReference, claim.amountCents, stableKey);
        await repository.completeMoney("external_dispute", claim.claimId, reversalId, context);
        summary.completed++;
        summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "reversal_completed", providerReference: reversalId });
        continue;
      }
      if (claim.kind === "recovery") {
        const transferId = await stripe.findTransfer(claim.claimId) ?? await stripe.transfer(claim.amountCents, claim.destinationAccount, claim.claimId);
        await repository.completeMoney("recovery", claim.claimId, transferId, context);
        summary.completed++;
        summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "recovery_transfer_completed", providerReference: transferId });
        continue;
      }
      await repository.failMoney(claim.kind, claim.claimId, "manual_reconciliation_required", context);
      summary.retried++;
      summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "manual_reconciliation_required" });
    } catch (error) {
      await repository.failMoney(claim.kind, claim.claimId, error instanceof Error ? error.message : "reconciliation_failed", context);
      summary.failed++;
      summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "failed" });
    }
  }
  summary.finishedAt = new Date().toISOString();
  return summary;
}

export async function runScheduledReconciliation(repository: Repository, stripe: StripePayments, emit: (record: ReconciliationSummary) => void = console.info) {
  const result = await reconcilePayments(repository, stripe);
  emit(result);
  return result;
}

/**
 * Drain mode only observes provider objects whose references were persisted
 * before the run. It never attempts to recreate a missing provider side effect.
 */
export async function reconcilePersistedObligationsForDrain(
  repository: Repository,
  stripe: DrainPayments,
  now = new Date(),
  staleAfterMs = 5 * 60_000,
): Promise<ReconciliationSummary> {
  const claims = (await repository.stuckMoneyClaims(new Date(now.getTime() - staleAfterMs).toISOString()))
    .filter((claim) => Boolean(claim.providerReference));
  const summary: ReconciliationSummary = { runId: `drain-reconcile-${now.toISOString()}`, startedAt: now.toISOString(), finishedAt: now.toISOString(), inspected: claims.length, completed: 0, retried: 0, failed: 0, outcomes: [] };
  const context: CommandContext = { actor: { id: "payment-drain-reconciler", role: "operator" }, accessToken: "", now: now.toISOString() };

  for (const claim of claims) {
    const providerReference = claim.providerReference!;
    const typedReference = parseDrainProviderReference(providerReference);
    const recoveryLookup = claim.kind === "external_dispute" && typedReference?.kind === "transfer" && Boolean(claim.providerIdempotencyKey);
    if (!typedReference || (!providerKindsByMoneyKind[claim.kind].has(typedReference.kind) && !recoveryLookup)) {
      summary.retried++;
      summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "provider_reference_kind_mismatch", providerReference });
      continue;
    }
    try {
      const existing = recoveryLookup
        ? await stripe.retrieveExistingObligation(typedReference, claim)
        : await stripe.retrieveExistingObligation(typedReference);
      if (!existing) {
        summary.retried++;
        summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "persisted_provider_reference_not_found", providerReference });
        continue;
      }
      if (!isDrainObservationAllowed(claim.kind, typedReference, existing)) {
        summary.retried++;
        summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "provider_status_not_terminal", providerReference });
        continue;
      }
      await repository.observeMoneyProviderStatus(claim.kind, claim.claimId, providerReference, existing.status, context);
      summary.completed++;
      summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "terminal_provider_status_observed", providerReference });
    } catch {
      // A drain failure remains pending for a later authorized recovery run.
      summary.failed++;
      summary.outcomes.push({ claimId: claim.claimId, kind: claim.kind, outcome: "retrieval_failed", providerReference });
    }
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}
