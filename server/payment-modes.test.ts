import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, type StripePayments } from "./app.js";
import { reconcilePersistedObligationsForDrain, type DrainPayments } from "./jobs/reconcilePayments.js";
import { parsePaymentMode, type PaymentApprovalBinding, type PaymentApprovalReceipt } from "./paymentModes.js";
import type { MoneyClaim, MoneyKind, Repository, Result } from "./repository.js";

const now = new Date("2026-09-06T00:00:00.000Z");
const binding: PaymentApprovalBinding = {
  environmentHash: "env-hash",
  projectHash: "project-hash",
  gitSha: "git-sha",
  migrationHead: "migration-head",
  capabilityHashes: { routeMatrix: "route-hash", reconciliation: "reconcile-hash" },
};
const receipt: PaymentApprovalReceipt = {
  ...binding,
  mode: "enabled",
  issuedAt: "2026-09-05T00:00:00.000Z",
  expiresAt: "2026-09-07T00:00:00.000Z",
  keyId: "owner-key-1",
  signature: "synthetic-signature",
};
const approval = { receipt, expectedBinding: binding, now, verifySignature: vi.fn(() => true) };

const obligation = (overrides: Partial<MoneyClaim & { kind: MoneyKind }> = {}): MoneyClaim & { kind: MoneyKind } => ({
  claimId: "claim-existing",
  state: "claimed",
  amountCents: 2500,
  requestId: "request-existing",
  providerReference: "pi_existing",
  claimedAt: "2026-09-05T00:00:00.000Z",
  kind: "payment_succeeded",
  ...overrides,
});

function repositoryFake(claims: Array<MoneyClaim & { kind: MoneyKind }> = []) {
  const completeMoney = vi.fn(async (): Promise<Result> => ({ status: 201, data: { reconciled: true } }));
  const observeMoneyProviderStatus = vi.fn(async () => undefined);
  const fake = {
    stuckMoneyClaims: vi.fn(async () => claims),
    completeMoney,
    observeMoneyProviderStatus,
    claimMoney: vi.fn(),
    failMoney: vi.fn(),
    execute: vi.fn(),
  } as unknown as Repository;
  return { fake, completeMoney, observeMoneyProviderStatus, raw: fake as Repository & { claimMoney: ReturnType<typeof vi.fn>; failMoney: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> } };
}

function drainFake(eventObjectId = "pi_existing", eventRequestId = "request-existing") {
  const forbidden = {
    createCustomerPayment: vi.fn(),
    transfer: vi.fn(),
    reverse: vi.fn(),
    refund: vi.fn(),
    createClaim: vi.fn(),
    originateSettlement: vi.fn(),
  };
  const retrieveExistingObligation = vi.fn(async (reference: { kind: "payment_intent" | "dispute" | "transfer" | "reversal" | "refund"; id: string }) => ({ kind: reference.kind, status: "succeeded" }));
  const adapter = {
    ...forbidden,
    retrieveExistingObligation,
    constructWebhook: vi.fn(() => ({ id: "evt_signed", type: "payment_intent.succeeded", data: { object: { id: eventObjectId, metadata: { requestId: eventRequestId }, status: "succeeded" } } })),
  } satisfies DrainPayments & typeof forbidden;
  return { adapter, forbidden, retrieveExistingObligation };
}

const expectNoForbiddenCalls = (forbidden: ReturnType<typeof drainFake>["forbidden"]) => {
  for (const spy of Object.values(forbidden)) expect(spy).not.toHaveBeenCalled();
};

describe("payment mode parser", () => {
  it.each([undefined, "", false, true, "false", "true", " enabled", "enabled ", "unknown", "PAYMENTS_ENABLED=true"])("fails closed for %s", (value) => {
    expect(parsePaymentMode(value, approval)).toBe("disabled");
  });

  it("accepts exact drain without an approval receipt", () => {
    expect(parsePaymentMode("drain")).toBe("drain");
  });

  it("enables only an exact, current, signature-verified, fully bound receipt", () => {
    expect(parsePaymentMode("enabled", approval)).toBe("enabled");
    expect(approval.verifySignature).toHaveBeenCalledWith(receipt);

    expect(parsePaymentMode("enabled", { ...approval, receipt: { ...receipt, expiresAt: now.toISOString() } })).toBe("disabled");
    expect(parsePaymentMode("enabled", { ...approval, receipt: { ...receipt, projectHash: "other-project" } })).toBe("disabled");
    expect(parsePaymentMode("enabled", { ...approval, receipt: { ...receipt, capabilityHashes: { routeMatrix: "stale" } } })).toBe("disabled");
    expect(parsePaymentMode("enabled", { ...approval, verifySignature: () => false })).toBe("disabled");
    expect(parsePaymentMode("enabled", { ...approval, receipt: "malformed" })).toBe("disabled");
  });
});

describe("drain payment mode", () => {
  it.each(["deposit", "balance", "settle", "settlement-preflight", "refunds"])("rejects %s origination before mutation", async (operation) => {
    const repository = repositoryFake();
    const { adapter, forbidden } = drainFake();
    const app = createApp({ repository: repository.fake, paymentsMode: "drain", drainPayments: adapter, auth: { async authenticate() { return null; } } });

    const response = await request(app).post(`/api/requests/request/${operation}`).send({});

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("payments_draining");
    expect(repository.raw.claimMoney).not.toHaveBeenCalled();
    expect(repository.raw.execute).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it("rejects invalid webhook signatures before repository mutation", async () => {
    const repository = repositoryFake([obligation()]);
    const { adapter, forbidden } = drainFake();
    adapter.constructWebhook.mockImplementationOnce(() => { throw new Error("bad signature"); });
    const app = createApp({ repository: repository.fake, paymentsMode: "drain", drainPayments: adapter, auth: { async authenticate() { return null; } } });

    const response = await request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", "bad").send("{}");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_webhook_signature");
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expect(repository.observeMoneyProviderStatus).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it("drain rejects unknown obligations without provider writes", async () => {
    const repository = repositoryFake([obligation()]);
    const { adapter, forbidden, retrieveExistingObligation } = drainFake("pi_unknown", "request-unknown");
    const app = createApp({ repository: repository.fake, paymentsMode: "drain", drainPayments: adapter, auth: { async authenticate() { return null; } } });

    const response = await request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", "signed").send("{}");

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("persisted_obligation_required");
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expect(repository.observeMoneyProviderStatus).not.toHaveBeenCalled();
    expect(retrieveExistingObligation).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it("accepts a signed webhook bound to a persisted obligation using status updates only", async () => {
    const repository = repositoryFake([obligation()]);
    const { adapter, forbidden } = drainFake();
    const app = createApp({ repository: repository.fake, paymentsMode: "drain", drainPayments: adapter, auth: { async authenticate() { return null; } } });

    const response = await request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", "signed").send("{}");

    expect(response.status).toBe(200);
    expect(repository.observeMoneyProviderStatus).toHaveBeenCalledWith("payment_succeeded", "claim-existing", "pi_existing", "succeeded", expect.anything(), expect.objectContaining({ providerEventId: "evt_signed" }));
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expect(repository.raw.claimMoney).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it.each([
    ["payment_intent.processing", "processing"],
    ["payment_intent.canceled", "canceled"],
    ["refund.succeeded", "succeeded"],
  ])("keeps signed but unsafe webhook %s pending", async (eventType, status) => {
    const repository = repositoryFake([obligation()]);
    const { adapter, forbidden } = drainFake();
    adapter.constructWebhook.mockReturnValueOnce({
      id: "evt_signed",
      type: eventType,
      data: { object: { id: "pi_existing", metadata: { requestId: "request-existing" }, status } },
    });
    const app = createApp({ repository: repository.fake, paymentsMode: "drain", drainPayments: adapter, auth: { async authenticate() { return null; } } });

    const response = await request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", "signed").send("{}");

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ received: true, pending: true });
    expect(repository.observeMoneyProviderStatus).not.toHaveBeenCalled();
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expect(repository.raw.claimMoney).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it("rejects bad job authorization without retrieval or mutation", async () => {
    const repository = repositoryFake([obligation()]);
    const { adapter, forbidden, retrieveExistingObligation } = drainFake();
    const app = createApp({ repository: repository.fake, paymentsMode: "drain", drainPayments: adapter, reconciliationSecret: "correct", auth: { async authenticate() { return null; } } });

    const response = await request(app).post("/api/internal/jobs/reconcile-payments").set("x-job-secret", "wrong").send({});

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("scheduled_job_forbidden");
    expect(retrieveExistingObligation).not.toHaveBeenCalled();
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it.each([
    ["payment_succeeded", "pi_existing", "payment_intent", "succeeded"],
    ["settlement", "tr_existing", "transfer", "succeeded"],
    ["refund", "re_existing", "refund", "succeeded"],
    ["external_dispute", "dp_existing", "dispute", "won"],
    ["external_dispute", "trr_existing", "reversal", "succeeded"],
    ["recovery", "tr_recovery", "transfer", "succeeded"],
  ] as const)("drain observes terminal %s %s without completing money", async (kind, providerReference, referenceKind, status) => {
    const repository = repositoryFake([obligation({ kind, providerReference })]);
    const { adapter, forbidden, retrieveExistingObligation } = drainFake();
    retrieveExistingObligation.mockResolvedValueOnce({ kind: referenceKind, status });
    const app = createApp({ repository: repository.fake, paymentsMode: "drain", drainPayments: adapter, reconciliationSecret: "correct", now: () => now, auth: { async authenticate() { return null; } } });

    const response = await request(app).post("/api/internal/jobs/reconcile-payments").set("x-job-secret", "correct").send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ inspected: 1, completed: 1, retried: 0, failed: 0 });
    expect(retrieveExistingObligation).toHaveBeenCalledWith({ id: providerReference, kind: referenceKind });
    expect(repository.observeMoneyProviderStatus).toHaveBeenCalledWith(kind, "claim-existing", providerReference, status, expect.anything());
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expect(repository.raw.claimMoney).not.toHaveBeenCalled();
    expect(repository.raw.failMoney).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it("recovers an interrupted external-dispute reversal from its persisted parent transfer and idempotency key", async () => {
    const claim = obligation({
      kind: "external_dispute",
      providerReference: "tr_parent",
      providerIdempotencyKey: "reversal:claim-existing",
    });
    const repository = repositoryFake([claim]);
    const { adapter, forbidden, retrieveExistingObligation } = drainFake();
    retrieveExistingObligation.mockResolvedValueOnce({ kind: "reversal", status: "succeeded" });

    const result = await reconcilePersistedObligationsForDrain(repository.fake, adapter, now, 0);

    expect(result).toMatchObject({ inspected: 1, completed: 1, retried: 0, failed: 0 });
    expect(retrieveExistingObligation).toHaveBeenCalledWith(
      { id: "tr_parent", kind: "transfer" },
      expect.objectContaining({ kind: "external_dispute", providerIdempotencyKey: "reversal:claim-existing" }),
    );
    expect(repository.observeMoneyProviderStatus).toHaveBeenCalledWith(
      "external_dispute", "claim-existing", "tr_parent", "succeeded", expect.anything(),
    );
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it("drain reconciliation never invokes createCustomerPayment, transfer, reverse, refund, new claim, or settlement", async () => {
    const repository = repositoryFake([obligation(), obligation({ claimId: "claim-missing", providerReference: "pi_missing" })]);
    const { adapter, forbidden, retrieveExistingObligation } = drainFake();
    retrieveExistingObligation.mockResolvedValueOnce({ kind: "payment_intent", status: "succeeded" }).mockResolvedValueOnce(undefined);

    const result = await reconcilePersistedObligationsForDrain(repository.fake, adapter, now, 0);

    expect(result).toMatchObject({ inspected: 2, completed: 1, retried: 1, failed: 0 });
    expect(repository.observeMoneyProviderStatus).toHaveBeenCalledTimes(1);
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expect(repository.raw.claimMoney).not.toHaveBeenCalled();
    expect(repository.raw.failMoney).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });

  it.each([
    ["payment_succeeded", "tr_wrong", "transfer", "succeeded"],
    ["payment_succeeded", "pi_pending", "payment_intent", "processing"],
    ["payment_succeeded", "pi_canceled", "payment_intent", "canceled"],
    ["refund", "re_failed", "refund", "failed"],
    ["refund", "re_unknown", "refund", "unknown"],
    ["external_dispute", "dp_mismatch", "refund", "succeeded"],
  ] as const)("keeps unsafe %s observation pending (%s)", async (kind, providerReference, observedKind, status) => {
    const repository = repositoryFake([obligation({ kind, providerReference })]);
    const { adapter, forbidden, retrieveExistingObligation } = drainFake();
    retrieveExistingObligation.mockResolvedValueOnce({ kind: observedKind, status });

    const result = await reconcilePersistedObligationsForDrain(repository.fake, adapter, now, 0);

    expect(result).toMatchObject({ completed: 0, retried: 1, failed: 0 });
    expect(repository.observeMoneyProviderStatus).not.toHaveBeenCalled();
    expect(repository.completeMoney).not.toHaveBeenCalled();
    expect(repository.raw.claimMoney).not.toHaveBeenCalled();
    expect(repository.raw.failMoney).not.toHaveBeenCalled();
    expectNoForbiddenCalls(forbidden);
  });
});

describe("enabled payment mode", () => {
  it("preserves webhook and scheduled reconciliation behavior after receipt validation", async () => {
    const repository = repositoryFake();
    const stripe: StripePayments = {
      createCustomerPayment: vi.fn(), transfer: vi.fn(), refund: vi.fn(), reverse: vi.fn(), findTransfer: vi.fn(), findReversal: vi.fn(),
      constructWebhook: vi.fn(() => { throw new Error("bad signature"); }),
    };
    const app = createApp({ repository: repository.fake, paymentsMode: "enabled", paymentApproval: approval, stripe, reconciliationSecret: "correct", auth: { async authenticate() { return null; } } });

    const capabilities = await request(app).get("/api/capabilities");
    const webhook = await request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", "bad").send("{}");
    const job = await request(app).post("/api/internal/jobs/reconcile-payments").set("x-job-secret", "wrong").send({});
    const authorizedJob = await request(app).post("/api/internal/jobs/reconcile-payments").set("x-job-secret", "correct").send({});

    expect(capabilities.body.payments).toEqual({ mode: "enabled", enabled: true, provider: "stripe" });
    expect(webhook.status).toBe(400);
    expect(webhook.body.error).toBe("invalid_webhook_signature");
    expect(job.status).toBe(403);
    expect(job.body.error).toBe("scheduled_job_forbidden");
    expect(authorizedJob.status).toBe(200);
    expect(authorizedJob.body).toMatchObject({ inspected: 0, completed: 0, retried: 0, failed: 0 });
  });
});
