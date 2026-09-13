/**
 * 역할별 /api/dashboard 및 features 읽기 라우트 접근 검증.
 */
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, InMemoryRepository } from "./app.js";

describe("dashboard reads", () => {
  it("does not run global matching while a customer loads their dashboard", async () => {
    const repository = new InMemoryRepository();
    const expansion = vi.spyOn(repository, "expandStaleQuoteRequests")
      .mockRejectedValue(new Error("matching temporarily unavailable"));
    const app = createApp({
      repository,
      auth: { async authenticate() { return { id: "customer", role: "customer" }; } },
      paymentsMode: "disabled",
    });

    const response = await request(app).get("/api/dashboard")
      .set("Authorization", "Bearer test-customer");

    expect(response.status).toBe(200);
    expect(response.body.requests).toEqual([]);
    expect(expansion).not.toHaveBeenCalled();
  });
});
