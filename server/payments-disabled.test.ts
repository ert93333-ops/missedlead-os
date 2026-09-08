import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, InMemoryRepository, SupabaseJwtAuthAdapter } from "./app.js";

const auth = { async authenticate() { return { id: "customer", role: "customer" as const }; } };

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPERATOR_ALLOWLIST;
});

describe("disabled payment mode", () => {
  it("keeps non-payment APIs available and does not construct a Stripe adapter", async () => {
    const repository = new InMemoryRepository();
    const stripeFactory = vi.fn(() => { throw new Error("must not construct Stripe"); });
    const drainPaymentsFactory = vi.fn(() => { throw new Error("must not construct drain Stripe"); });
    const app = createApp({ repository, paymentsMode: "disabled", stripeFactory, drainPaymentsFactory, auth });

    const response = await request(app).get("/api/dashboard").set("Authorization", "Bearer customer");

    expect(response.status).toBe(200);
    expect(response.body.requests).toEqual([]);
    expect(stripeFactory).not.toHaveBeenCalled();
    expect(drainPaymentsFactory).not.toHaveBeenCalled();
    const capabilities = await request(app).get("/api/capabilities");
    expect(capabilities.body.payments).toEqual({ mode: "disabled", enabled: false, provider: "stripe" });
  });

  it("does not construct Stripe when an enabled request has no valid owner receipt", async () => {
    const stripeFactory = vi.fn(() => { throw new Error("must not construct Stripe"); });
    const app = createApp({ repository: new InMemoryRepository(), paymentsMode: "enabled", stripeFactory, auth });

    const response = await request(app).post("/api/requests/request/deposit").send({});

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("payments_not_enabled");
    expect(stripeFactory).not.toHaveBeenCalled();
  });

  it.each([
    "/api/requests/request/deposit",
    "/api/requests/request/balance",
    "/api/requests/request/settle",
    "/api/requests/request/settlement-preflight",
    "/api/requests/request/refunds",
    "/api/internal/jobs/reconcile-payments",
    "/api/webhooks/stripe",
  ])("rejects %s before authentication, parsing, or money mutation", async (path) => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, paymentsMode: "disabled", auth });

    const response = await request(app).post(path).send(Buffer.from("not-json"));

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("payments_not_enabled");
    expect(repository.inspect((state) => ({ claims: Object.keys(state.claims), payments: state.payments, audit: state.audit }))).toEqual({ claims: [], payments: [], audit: [] });
  });

  it("applies DB operator allowlist additions and removals immediately and ignores process allowlists", async () => {
    let isOperator = true;
    process.env.OPERATOR_ALLOWLIST = "operator";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "operator", email: "operator@example.test" });
      if (url.includes("/rest/v1/profiles?")) return Response.json([{ role: "operator" }]);
      if (url.endsWith("/rest/v1/rpc/is_operator")) return Response.json(isOperator);
      return new Response(null, { status: 404 });
    }));
    const app = createApp({
      repository: new InMemoryRepository(),
      paymentsMode: "disabled",
      auth: new SupabaseJwtAuthAdapter("https://project.test", "anon"),
      operatorAllowlist: ["operator"],
    });

    await request(app).get("/api/dashboard").set("Authorization", "Bearer operator").expect(200);
    isOperator = false;
    const removed = await request(app).get("/api/dashboard").set("Authorization", "Bearer operator");

    expect(removed.status).toBe(403);
    expect(removed.body).toEqual({ error: "operator_not_allowlisted" });
  });
});
