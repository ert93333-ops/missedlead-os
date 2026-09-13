/**
 * 사용량 크레딧/동시성 제한 테스트.
 */
import { describe, expect, it } from "vitest";
import { emptyUsageState, InMemoryIntakeUsageBudget } from "./intake/usage.js";

const limits = { accountDailyCredits: 2, totalDailyCredits: 3, globalActive: 2, accountActive: 1 };

describe("durable intake usage budget", () => {
  it("shares daily quota across adapter instances", async () => {
    const state = emptyUsageState();
    const first = new InMemoryIntakeUsageBudget(state, limits);
    const restarted = new InMemoryIntakeUsageBudget(state, limits);
    const now = new Date("2026-09-05T12:00:00.000Z");
    const reservation = await first.reserve("customer", 2, now);
    expect(reservation.allowed).toBe(true);
    if (reservation.allowed) await first.release(reservation.leaseId, "customer");
    await expect(restarted.reserve("customer", 1, now)).resolves.toEqual({ allowed: false, reason: "account_quota" });
  });

  it("releases active leases and expires abandoned leases", async () => {
    const budget = new InMemoryIntakeUsageBudget(emptyUsageState(), { ...limits, accountDailyCredits: 10 });
    const now = new Date("2026-09-05T12:00:00.000Z");
    const first = await budget.reserve("customer", 1, now);
    expect(first.allowed).toBe(true);
    await expect(budget.reserve("customer", 1, now)).resolves.toEqual({ allowed: false, reason: "account_active" });
    if (first.allowed) await budget.release(first.leaseId, "customer");
    expect((await budget.reserve("customer", 1, now)).allowed).toBe(true);
    expect((await budget.reserve("other", 1, new Date(now.getTime() + 120_001))).allowed).toBe(true);
  });
});
