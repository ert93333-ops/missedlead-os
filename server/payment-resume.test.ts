import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { emptyState, InMemoryRepository, SupabaseRepository, type CommandContext, type PaymentKind } from "./repository.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

const customerContext = (id = "customer-1"): CommandContext => ({
  actor: { id, role: "customer" },
  accessToken: `${id}-token`,
  idempotencyKey: "payment-key",
  now: "2026-09-05T12:00:00.000Z",
});

const repositoryWithPayment = (kind: Extract<PaymentKind, "deposit" | "balance">, status: "pending" | "succeeded") => {
  const state = emptyState();
  state.requests["request-1"] = {
    id: "request-1",
    customerId: "customer-1",
    customerName: "Customer",
    description: "Leaking pipe",
    address: "Charlotte",
    safetyStatus: "cleared",
    status: "quoted",
    providerIds: [],
    expandedSearch: false,
    createdAt: "2026-09-05T10:00:00.000Z",
  };
  state.claims["payment-key"] = {
    claimId: "claim-1",
    kind,
    fingerprint: "fixture",
    status: "completed",
    state: "completed",
    amountCents: 2_000,
    providerReference: "pi-existing",
    requestId: "request-1",
  };
  state.payments.push({
    id: "payment-1",
    requestId: "request-1",
    kind,
    status,
    amountCents: 2_000,
    providerReference: "pi-existing",
    clientSecret: "existing-client-secret",
    createdAt: "2026-09-05T11:00:00.000Z",
  });
  return new InMemoryRepository(state);
};

describe("InMemoryRepository.resumeCustomerPayment", () => {
  it.each(["deposit", "balance"] as const)("returns the existing pending %s payment secret", async (kind) => {
    // Given
    const repository = repositoryWithPayment(kind, "pending");

    // When
    const result = await repository.resumeCustomerPayment(kind, "claim-1", customerContext());

    // Then
    expect(result).toEqual({
      status: 202,
      data: { clientSecret: "existing-client-secret", providerReference: "pi-existing" },
    });
  });

  it("rejects a payment that already succeeded", async () => {
    // Given
    const repository = repositoryWithPayment("deposit", "succeeded");

    // When
    const result = await repository.resumeCustomerPayment("deposit", "claim-1", customerContext());

    // Then
    expect(result).toEqual({ status: 409, data: { error: "pending_payment_not_found" } });
  });

  it("rejects a customer who does not own the payment request", async () => {
    // Given
    const repository = repositoryWithPayment("deposit", "pending");

    // When
    const result = await repository.resumeCustomerPayment("deposit", "claim-1", customerContext("customer-2"));

    // Then
    expect(result).toEqual({ status: 403, data: { error: "forbidden" } });
  });
});

describe("SupabaseRepository.resumeCustomerPayment", () => {
  it("returns a pending payment secret after the user-scoped ownership check", async () => {
    // Given
    const reads: Array<{ readonly path: string; readonly authorization: string }> = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      reads.push({ path, authorization: String(request.headers.authorization) });
      response.setHeader("Content-Type", "application/json");
      if (path === "/rest/v1/payment_attempts") {
        response.end(JSON.stringify({ request_id: "request-1", provider_reference: "pi-existing", client_secret: "existing-client-secret", idempotency_key: "payment-key" }));
        return;
      }
      if (path === "/rest/v1/service_requests") {
        response.end(JSON.stringify({ id: "request-1" }));
        return;
      }
      if (path === "/rest/v1/money_operations") {
        response.end(JSON.stringify({ id: "claim-1" }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "unexpected request" }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind to a TCP port");
    const repository = new SupabaseRepository(`http://127.0.0.1:${address.port}`, "anon-key", "service-key");

    // When
    const result = await repository.resumeCustomerPayment("deposit", "claim-1", customerContext());

    // Then
    expect(result).toEqual({ status: 202, data: { clientSecret: "existing-client-secret", providerReference: "pi-existing" } });
    expect(reads).toEqual([
      { path: "/rest/v1/payment_attempts", authorization: "Bearer customer-1-token" },
      { path: "/rest/v1/service_requests", authorization: "Bearer customer-1-token" },
      { path: "/rest/v1/money_operations", authorization: "Bearer service-key" },
    ]);
  });
});
