import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type IntakeUsageLimits = {
  readonly accountDailyCredits: number;
  readonly totalDailyCredits: number;
  readonly globalActive: number;
  readonly accountActive: number;
};

export type UsageReservation =
  | { readonly allowed: true; readonly leaseId: string }
  | { readonly allowed: false; readonly reason: "account_quota" | "total_quota" | "account_active" | "global_active" };

export interface IntakeUsageBudget {
  reserve(actorId: string, credits: number, now: Date): Promise<UsageReservation>;
  release(leaseId: string, actorId: string): Promise<void>;
}

const DEFAULT_LIMITS: IntakeUsageLimits = { accountDailyCredits: 40, totalDailyCredits: 200, globalActive: 4, accountActive: 1 };
const rpcResultSchema = z.object({ allowed: z.boolean(), leaseId: z.string().uuid().optional(), reason: z.enum(["account_quota", "total_quota", "account_active", "global_active"]).optional() });
const positiveInteger = (value: string | undefined, fallback: number): number => z.coerce.number().int().positive().catch(fallback).parse(value);

export const intakeUsageLimits = (env: NodeJS.ProcessEnv = process.env): IntakeUsageLimits => ({
  accountDailyCredits: positiveInteger(env.INTAKE_ACCOUNT_DAILY_CREDITS, DEFAULT_LIMITS.accountDailyCredits),
  totalDailyCredits: positiveInteger(env.INTAKE_TOTAL_DAILY_CREDITS, DEFAULT_LIMITS.totalDailyCredits),
  globalActive: positiveInteger(env.INTAKE_GLOBAL_ACTIVE_LIMIT, DEFAULT_LIMITS.globalActive),
  accountActive: positiveInteger(env.INTAKE_ACCOUNT_ACTIVE_LIMIT, DEFAULT_LIMITS.accountActive),
});

export class SupabaseIntakeUsageBudget implements IntakeUsageBudget {
  private readonly client: SupabaseClient;
  constructor(url: string, serviceKey: string, private readonly limits: IntakeUsageLimits) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  async reserve(actorId: string, credits: number): Promise<UsageReservation> {
    const response = await this.client.rpc("reserve_intake_usage", {
      p_actor_id: actorId, p_credits: credits, p_account_daily_limit: this.limits.accountDailyCredits,
      p_total_daily_limit: this.limits.totalDailyCredits, p_global_active_limit: this.limits.globalActive,
      p_account_active_limit: this.limits.accountActive,
    });
    if (response.error) throw response.error;
    const parsed = rpcResultSchema.parse(response.data);
    if (parsed.allowed && parsed.leaseId) return { allowed: true, leaseId: parsed.leaseId };
    if (!parsed.allowed && parsed.reason) return { allowed: false, reason: parsed.reason };
    throw new Error("invalid intake usage reservation response");
  }
  async release(leaseId: string, actorId: string): Promise<void> {
    const response = await this.client.rpc("release_intake_usage", { p_lease_id: leaseId, p_actor_id: actorId });
    if (response.error) throw response.error;
  }
}

export type InMemoryUsageState = {
  readonly events: { readonly actorId: string; readonly credits: number; readonly day: string }[];
  readonly leases: Map<string, { readonly actorId: string; readonly expiresAt: number }>;
};

export const emptyUsageState = (): InMemoryUsageState => ({ events: [], leases: new Map() });

export class InMemoryIntakeUsageBudget implements IntakeUsageBudget {
  constructor(private readonly state = emptyUsageState(), private readonly limits: IntakeUsageLimits = DEFAULT_LIMITS) {}
  async reserve(actorId: string, credits: number, now: Date): Promise<UsageReservation> {
    for (const [leaseId, lease] of this.state.leases) if (lease.expiresAt <= now.getTime()) this.state.leases.delete(leaseId);
    const active = [...this.state.leases.values()];
    if (active.filter((lease) => lease.actorId === actorId).length >= this.limits.accountActive) return { allowed: false, reason: "account_active" };
    if (active.length >= this.limits.globalActive) return { allowed: false, reason: "global_active" };
    const day = now.toISOString().slice(0, 10);
    const events = this.state.events.filter((event) => event.day === day);
    if (events.filter((event) => event.actorId === actorId).reduce((sum, event) => sum + event.credits, 0) + credits > this.limits.accountDailyCredits) return { allowed: false, reason: "account_quota" };
    if (events.reduce((sum, event) => sum + event.credits, 0) + credits > this.limits.totalDailyCredits) return { allowed: false, reason: "total_quota" };
    const leaseId = randomUUID();
    this.state.events.push({ actorId, credits, day });
    this.state.leases.set(leaseId, { actorId, expiresAt: now.getTime() + 120_000 });
    return { allowed: true, leaseId };
  }
  async release(leaseId: string, actorId: string): Promise<void> {
    const lease = this.state.leases.get(leaseId);
    if (lease?.actorId === actorId) this.state.leases.delete(leaseId);
  }
}

export const createIntakeUsageBudget = (env: NodeJS.ProcessEnv = process.env): IntakeUsageBudget | undefined => {
  const url = env.SUPABASE_URL, serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceKey ? new SupabaseIntakeUsageBudget(url, serviceKey, intakeUsageLimits(env)) : undefined;
};
