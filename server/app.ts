import { registerEmergencyRoute } from './intake/emergency.js';
import { registerDemoRoutes } from './features/demo/routes.js';
import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import Stripe from "stripe";
import { checkedStripeAmount, compositeQuoteScore, createProductionRepository, explorationSelected, RANKING_POLICY_VERSION, type Actor, type Command, type Repository, type RepositoryState } from "./repository.js";
import { isDrainObservationAllowed, parseDrainProviderReference, reconcilePersistedObligationsForDrain, runScheduledReconciliation, type DrainPayments, type DrainProviderObservation } from "./jobs/reconcilePayments.js";
import { parsePaymentMode, paymentApprovalFromEnvironment, type PaymentApprovalValidation } from "./paymentModes.js";
import { createIntakeProvider, type IntakeAiProvider } from "./intake/provider.js";
import { registerIntakeRoutes } from "./intake/routes.js";
import { registerIntakeMediaRoutes, type IntakeMediaStore } from "./intake/mediaStorage.js";
import { createIntakeUsageBudget, type IntakeUsageBudget } from "./intake/usage.js";
import { registerProviderRoutes } from './features/providers/index.js';
import { registerCareRoutes, applyCarePriority } from './features/care/index.js';
import { registerBusinessRoutes } from './features/business/routes.js';
import { registerLifecycleRoutes, validateCoverage, recordSafetyReport } from './features/lifecycle/index.js';
import { featureError, featureService } from './features/context.js';
export { InMemoryRepository, emptyState } from "./repository.js";

const WINDOW_MS = 72 * 60 * 60 * 1_000;
export interface AuthAdapter {
  authenticate(token: string): Promise<Actor | null>;
  authorizeOperator?(token: string): Promise<boolean>;
}
export class SupabaseJwtAuthAdapter implements AuthAdapter {
  constructor(private readonly url: string, private readonly anonKey: string) {}
  async authorizeOperator(token: string): Promise<boolean> {
    const operatorResponse = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/rpc/is_operator`, {
      method: "POST",
      headers: { apikey: this.anonKey, Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15000),
    });
    return operatorResponse.ok && await operatorResponse.json() === true;
  }
  async authenticate(token: string): Promise<Actor | null> {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: this.anonKey, Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const user = await response.json() as { id?: string; email?: string; app_metadata?: { role?: unknown } };
    const profileResponse = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id ?? "")}&select=role`, { headers: { apikey: this.anonKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!profileResponse.ok) return null;
    const profiles = z.array(z.object({ role: z.enum(['customer', 'provider', 'operator']) })).safeParse(await profileResponse.json());
    const role = profiles.success ? profiles.data[0]?.role : undefined;
    if (!role) return null;
    if (!user.id) return null;
    if (await this.authorizeOperator(token)) return { id: user.id, email: user.email, role: "operator" };
    return { id: user.id, email: user.email, role };
  }
}
const deploymentHash = z.string().regex(/^[a-f0-9]{64}$/);
const deploymentIdentity = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  .refine((value) => !/(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+|(?:gh[pousr]_|AKIA)[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{10,}\./i.test(value));
const deploymentHashRecord = z.record(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/), deploymentHash)
  .refine((value) => Object.keys(value).length > 0)
  .refine((value) => Object.keys(value).every((name) => !/(?:secret|token|password|private|credential|api[-_]?key|authorization|cookie|signed[-_]?url|object[-_]?path|address|transcript)/i.test(name)));
const deploymentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  environmentHash: deploymentHash,
  projectHash: deploymentHash,
  apiOriginHash: deploymentHash,
  gitSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  migrationHead: deploymentIdentity,
  capabilityResultHashes: deploymentHashRecord,
  evidenceHashes: deploymentHashRecord,
  approvalReceiptId: deploymentIdentity,
  rotationOwner: deploymentIdentity,
  revocationOwner: deploymentIdentity,
  paymentsMode: z.enum(["disabled", "drain", "enabled"]),
}).strict();
export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;
export interface AppOptions { repository?: Repository; auth?: AuthAdapter; stripe?: StripePayments; stripeFactory?: () => StripePayments; drainPayments?: DrainPayments; drainPaymentsFactory?: () => DrainPayments; now?: () => Date; operatorAllowlist?: string[]; reconciliationSecret?: string; paymentsMode?: unknown; paymentApproval?: PaymentApprovalValidation; deploymentManifest?: unknown; intakeProvider?: IntakeAiProvider; intakeSigningSecret?: string; intakeMediaStore?: IntakeMediaStore; intakeUsageBudget?: IntakeUsageBudget }
export interface CustomerPaymentIntent { id: string; clientSecret: string }
export interface StripePayments {
  createCustomerPayment(amountCents: number, requestId: string, kind: "deposit" | "balance", idempotencyKey: string): Promise<CustomerPaymentIntent>;
  transfer(amountCents: number, destination: string | undefined, idempotencyKey: string): Promise<string>;
  refund(paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<string>;
  reverse(transferId: string, amountCents: number, idempotencyKey: string): Promise<string>;
  findTransfer(idempotencyKey: string): Promise<string | undefined>;
  findReversal(transferId: string, idempotencyKey: string): Promise<string | undefined>;
  constructWebhook(payload: Buffer, signature: string): { id: string; type: string; data: { object: { id: string; metadata?: Record<string, string>; reason?: string; status?: string; amount?: number } } };
}
export class StripeSdkPayments implements StripePayments {
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string) { this.stripe = new Stripe(secretKey); }
  async createCustomerPayment(amountCents: number, requestId: string, kind: "deposit" | "balance", key: string) { const value = await this.stripe.paymentIntents.create({ amount: amountCents, currency: "usd", capture_method: "automatic", metadata: { requestId, kind } }, { idempotencyKey: key }); if (!value.client_secret) throw new Error("payment_intent_client_secret_missing"); return { id: value.id, clientSecret: value.client_secret }; }
  async transfer(amountCents: number, destination: string | undefined, key: string) { if (!destination) throw new Error("provider_destination_missing"); const value = await this.stripe.transfers.create({ amount: amountCents, currency: "usd", destination, metadata: { claimKey: key } }, { idempotencyKey: key }); return value.id; }
  async refund(paymentIntentId: string, amountCents: number, key: string) { const value = await this.stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents }, { idempotencyKey: key }); return value.id; }
  async reverse(transferId: string, amountCents: number, key: string) { const value = await this.stripe.transfers.createReversal(transferId, { amount: amountCents, metadata: { reason: "external_dispute_reversal", claimKey: key } }, { idempotencyKey: key }); return value.id; }
  async findTransfer(key: string) { const values = await this.stripe.transfers.list({ limit: 100 }); return values.data.find((value) => value.metadata?.claimKey === key)?.id; }
  async findReversal(transferId: string, key: string) { const values = await this.stripe.transfers.listReversals(transferId, { limit: 100 }); return values.data.find((value) => value.metadata?.claimKey === key)?.id; }
  constructWebhook(payload: Buffer, signature: string) { return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret) as ReturnType<StripePayments["constructWebhook"]>; }
}
export class StripeDrainSdkPayments implements DrainPayments {
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string) { this.stripe = new Stripe(secretKey); }
  constructWebhook(payload: Buffer, signature: string) { return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret) as ReturnType<StripePayments["constructWebhook"]>; }
  async retrieveExistingObligation(providerReference: Parameters<DrainPayments["retrieveExistingObligation"]>[0], claim?: Parameters<DrainPayments["retrieveExistingObligation"]>[1]): Promise<DrainProviderObservation | undefined> {
    try {
      if (providerReference.kind === "transfer" && claim?.kind === "external_dispute" && claim.providerIdempotencyKey) {
        const reversals = await this.stripe.transfers.listReversals(providerReference.id, { limit: 100 });
        const reversal = reversals.data.find((value) => value.metadata?.claimKey === claim.providerIdempotencyKey);
        return reversal ? { kind: "reversal", status: "succeeded" } : undefined;
      }
      if (providerReference.kind === "transfer") return { kind: "transfer", status: (await this.stripe.transfers.retrieve(providerReference.id)).reversed ? "reversed" : "succeeded" };
      if (providerReference.kind === "refund") return { kind: "refund", status: (await this.stripe.refunds.retrieve(providerReference.id)).status ?? "unknown" };
      if (providerReference.kind === "dispute") return { kind: "dispute", status: (await this.stripe.disputes.retrieve(providerReference.id)).status ?? "unknown" };
      if (providerReference.kind === "reversal") return undefined;
      return { kind: "payment_intent", status: (await this.stripe.paymentIntents.retrieve(providerReference.id)).status };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) return undefined;
      throw error;
    }
  }
}
class IntegrationStripePayments implements StripePayments {
  private readonly stripe = new Stripe("sk_test_fixture");
  constructor(private readonly webhookSecret: string) {}
  async createCustomerPayment(_amountCents: number, _requestId: string, _kind: "deposit" | "balance", key: string) { return { id: `pi_${key}`, clientSecret: `pi_${key}_secret_fixture` }; }
  async transfer(_amountCents: number, _destination: string | undefined, key: string) { return `tr_${key}`; }
  async refund(_paymentIntentId: string, _amountCents: number, key: string) { return `re_${key}`; }
  async reverse(_transferId: string, _amountCents: number, key: string) { return `rv_${key}`; }
  async findTransfer(key: string) { return `tr_${key}`; }
  async findReversal(_transferId: string, key: string) { return `rv_${key}`; }
  constructWebhook(payload: Buffer, signature: string) { return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret) as ReturnType<StripePayments["constructWebhook"]>; }
}
const intake = z.object({ customerName: z.string().trim().min(1), description: z.string().trim().min(10), address: z.string().trim().min(3), hazards: z.array(z.enum(["none", "gas", "fire", "structural", "electrical"])).min(1) }).superRefine((v, c) => { if (v.hazards.includes("none") && v.hazards.length > 1) c.addIssue({ code: "custom", message: "none cannot be combined", path: ["hazards"] }); });
const match = z.object({ providerIds: z.array(z.string().min(1)).min(1).max(3) });
const quote = z.object({ providerName: z.string().min(1), scope: z.string().min(5), amountCents: z.number().int().positive().max(99_999_999), ranking: z.object({ totalCents: z.number().int().positive().max(99_999_999), earliestStartAt: z.string().datetime(), warrantyDays: z.number().int().nonnegative(),licenseVerified:z.boolean().optional(),insuranceVerified:z.boolean().optional(),rating:z.number().min(0).max(5).optional(),distanceMiles:z.number().nonnegative().optional(),responseMinutes:z.number().int().nonnegative().optional(),languages:z.array(z.string().min(1)).optional() }) }).superRefine((v,c)=>{if(v.ranking.totalCents!==v.amountCents)c.addIssue({code:"custom",message:"ranking total must equal amountCents",path:["ranking","totalCents"]})});
const change = z.object({ description: z.string().min(3), amountCents: z.number().int().min(0).max(99_999_999), items: z.array(z.object({ description:z.string().min(1),quantity:z.number().int().positive(),unitCents:z.number().int().nonnegative().max(99_999_999)})).min(1), evidenceIds:z.array(z.string().min(1)).min(1) }).superRefine((v,c)=>{if(v.items.reduce((n,i)=>n+i.quantity*i.unitCents,0)!==v.amountCents)c.addIssue({code:"custom",message:"item total must equal amountCents",path:["items"]})});
const evidence = z.object({ kind: z.enum(["before", "during", "after", "receipt", "warranty"]), note: z.string().min(3) });
const dispute = z.object({ source: z.enum(["internal", "external"]), externalId: z.string().min(1).optional(), reason: z.string().min(3) });
const refund = z.object({ amountCents: z.number().int().positive(), reason: z.string().min(3) });
const structuredWorkScope=z.object({symptom:z.string().min(3),location:z.string().min(2),dimensions:z.string().min(1),access:z.string().min(1),desiredTime:z.string().datetime(),photos:z.array(z.string().min(1)).max(10),exclusions:z.array(z.string().min(1))});
const structuredTriage=z.object({category:z.string().min(1),urgency:z.enum(["routine","urgent","emergency"]),possibleCauses:z.array(z.string().min(1)).min(1).optional(),possibleCause:z.union([z.string().min(1),z.array(z.string().min(1)).min(1)]).optional(),confidence:z.number().min(0).max(1),questions:z.array(z.string().min(1)).optional(),additionalQuestions:z.array(z.string().min(1)).optional(),occupied:z.boolean().optional(),utilitiesShutoffKnown:z.boolean().optional(),hazards:z.array(z.enum(["gas","fire","structural","electrical"])).default([])}).superRefine((v,c)=>{if(!v.possibleCauses&&!v.possibleCause)c.addIssue({code:"custom",message:"possible cause required",path:["possibleCauses"]});if(!v.questions&&!v.additionalQuestions)c.addIssue({code:"custom",message:"questions required",path:["questions"]})}).transform(v=>({...v,possibleCauses:v.possibleCauses??(Array.isArray(v.possibleCause)?v.possibleCause:[v.possibleCause!]),questions:v.questions??v.additionalQuestions!}));
const priceDisclosure=z.object({source:z.string().min(1),sampleCount:z.number().int().nonnegative(),updatedAt:z.string().datetime(),confidence:z.number().min(0).max(1),priceCents:z.number().int().nonnegative().optional()}).transform(v=>({...v,priceCents:v.sampleCount<30?undefined:v.priceCents}));
const requestDetails = z.object({ workScope:z.union([z.string().trim().min(10),structuredWorkScope]), triage:z.union([z.object({ urgency:z.enum(["routine","urgent","emergency"]),occupied:z.boolean(),utilitiesShutoffKnown:z.boolean() }),structuredTriage]), priceDisclosure:z.optional(priceDisclosure),priceDisclosureAccepted:z.literal(true).optional() }).superRefine((v,c)=>{if("hazards" in v.triage&&v.triage.hazards.length)c.addIssue({code:"custom",message:"hazard triage is blocked",path:["triage","hazards"]});if(v.triage.urgency==="emergency")c.addIssue({code:"custom",message:"emergency triage is blocked",path:["triage","urgency"]});if(!v.priceDisclosure&&!v.priceDisclosureAccepted)c.addIssue({code:"custom",message:"price disclosure required",path:["priceDisclosure"]})});
export const maskMessage=(text:string)=>text
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email masked]")
  .replace(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g,"[phone masked]");
const body = <T>(schema: z.ZodType<T>, req: Request, res: Response) => { const parsed = schema.safeParse(req.body); if (!parsed.success) res.status(400).json({ error: "invalid_request", issues: parsed.error.issues }); return parsed.success ? parsed.data : undefined; };
const actor = (res: Response) => res.locals.actor as Actor;
const owns = (state: RepositoryState, requestId: string, who: Actor) => { const item = state.requests[requestId]; return Boolean(item && (who.role === "operator" || item.customerId === who.id || item.providerIds.includes(who.id))); };
const providerEligible = (state:RepositoryState,providerId:string,requestId:string,at:string) => { const p=state.providerEligibility[providerId],r=state.requests[requestId];return Boolean(p&&r&&p.status==="approved"&&p.licenseVerified&&p.insuranceVerified&&p.licenseExpiresAt>at&&p.insuranceExpiresAt>at&&p.serviceCategories.includes(r.category??"general")&&p.serviceAreas.includes("Charlotte")); };

export function createApp(options: AppOptions = {}) {
  const repository = options.repository ?? createProductionRepository();
  const now = options.now ?? (() => new Date());
  const deploymentManifest = deploymentManifestSchema.safeParse(options.deploymentManifest);
  const requestedPaymentsMode = options.paymentsMode ?? process.env.PAYMENTS_MODE;
  const paymentApproval = options.paymentApproval ?? paymentApprovalFromEnvironment(process.env, now());
  const paymentsMode = parsePaymentMode(
    requestedPaymentsMode,
    paymentApproval,
  );
  const stripe = paymentsMode !== "enabled" ? undefined : options.stripe ?? options.stripeFactory?.() ?? (() => {
    const key = process.env.STRIPE_SECRET_KEY, secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (process.env.NODE_ENV === "test" && process.env.INTEGRATION_STRIPE_FIXTURE_URL && secret) return new IntegrationStripePayments(secret);
    if (!key || !secret) throw new Error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required; production never simulates payments");
    return new StripeSdkPayments(key, secret);
  })();
  const drainPayments = paymentsMode !== "drain" ? undefined : options.drainPayments ?? options.drainPaymentsFactory?.() ?? (() => {
    const key = process.env.STRIPE_SECRET_KEY, secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!key || !secret) throw new Error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required for payment drain");
    return new StripeDrainSdkPayments(key, secret);
  })();
  const auth = options.auth ?? (() => { const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY; if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required"); return new SupabaseJwtAuthAdapter(url, key); })();
  const app = express();
  app.get("/api/capabilities", (_req, res) => res.json({ payments: { mode: paymentsMode, enabled: paymentsMode === "enabled", provider: "stripe" } }));
  app.use((req, res, next) => {
    const originationPath = /^\/api\/requests\/[^/]+\/(deposit|balance|settle|refunds|settlement-preflight)\/?$/.test(req.path);
    const paymentPath = originationPath || req.path === "/api/webhooks/stripe" || req.path === "/api/internal/jobs/reconcile-payments";
    if (paymentsMode === "disabled" && paymentPath) return res.status(503).json({ error: "payments_not_enabled", guidance: "Payments are not available yet. Your request is saved; no payment has been taken." });
    if (paymentsMode === "drain" && originationPath) return res.status(503).json({ error: "payments_draining", guidance: "Payments are temporarily limited to recovery of existing obligations; no payment has been taken." });
    next();
  });
  app.post("/api/internal/jobs/reconcile-payments", express.json(), async (req, res) => {
    const secret = options.reconciliationSecret ?? process.env.RECONCILIATION_JOB_SECRET;
    if (!secret || req.header("x-job-secret") !== secret) return res.status(403).json({ error: "scheduled_job_forbidden" });
    const result = paymentsMode === "drain"
      ? await reconcilePersistedObligationsForDrain(repository, drainPayments!, now())
      : await runScheduledReconciliation(repository, stripe!);
    return res.json(result);
  });
  app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "100kb" }), async (req, res) => {
    const signature=req.header("stripe-signature"); if(!signature||!Buffer.isBuffer(req.body)) return res.status(400).json({error:"invalid_webhook_signature"});
    const webhookPayments = paymentsMode === "drain" ? drainPayments! : stripe!;
    let event: ReturnType<StripePayments["constructWebhook"]>; try{event=webhookPayments.constructWebhook(req.body,signature)}catch{return res.status(400).json({error:"invalid_webhook_signature"})}
    const requestId=event.data.object.metadata?.requestId; if(!requestId) return res.status(400).json({error:"request_id_missing"});
    const context={actor:{id:"stripe",role:"operator" as const},accessToken:"",idempotencyKey:event.id,now:now().toISOString()};
    if(paymentsMode==="drain") {
      const obligations=await repository.stuckMoneyClaims(new Date(now().getTime()+1).toISOString());
      const obligation=obligations.find(value=>value.requestId===requestId&&value.providerReference===event.data.object.id);
      if(!obligation)return res.status(409).json({error:"persisted_obligation_required"});
      const reference=parseDrainProviderReference(event.data.object.id);
      const eventKind=event.type.startsWith("payment_intent.")?"payment_intent"
        :event.type.startsWith("charge.dispute.")?"dispute"
        :event.type.startsWith("transfer.reversal.")?"reversal"
        :event.type.startsWith("transfer.")?"transfer"
        :event.type.startsWith("refund.")?"refund"
        :undefined;
      const observation:DrainProviderObservation|undefined=reference&&eventKind&&event.data.object.status
        ?{kind:eventKind,status:event.data.object.status}
        :undefined;
      if(!reference||!observation||!isDrainObservationAllowed(obligation.kind,reference,observation))return res.status(202).json({received:true,pending:true});
      await repository.observeMoneyProviderStatus(obligation.kind,obligation.claimId,obligation.providerReference!,observation.status,context,{providerEventId:event.id});
      return res.json({received:true});
    }
    const payloadHash=(await import("node:crypto")).createHash("sha256").update(req.body).digest("hex");
    if(event.type==="payment_intent.succeeded") { const claim=await repository.claimMoney("payment_succeeded",{request_id:requestId,provider_reference:event.data.object.id,event_id:event.id,payload_sha256:payloadHash},context); const result=await repository.completeMoney("payment_succeeded",claim.claimId,event.data.object.id,context); return res.status(result.status).json(result.data); }
    if(!event.type.startsWith("charge.dispute.")) return res.json({received:true});
    const lifecycle = event.type === "charge.dispute.closed"
      ? (event.data.object.status === "won" ? "won" : "lost")
      : "under_review";
    const args={request_id:requestId,external_id:event.data.object.id,reason:event.data.object.reason??event.type,event_id:event.id,event_type:event.type,lifecycle,amount_cents:event.data.object.amount??0,payload_sha256:payloadHash};
    const claim=await repository.claimMoney("external_dispute",args,context); if(claim.state==="completed") return res.json(claim);
    try { const reversalReference=BigInt(claim.amountCents)>0n&&claim.providerReference?await stripe!.reverse(claim.providerReference,checkedStripeAmount(claim.amountCents),claim.providerIdempotencyKey!):undefined; const result=await repository.completeMoney("external_dispute",claim.claimId,reversalReference,context); return res.status(result.status).json(result.data); }
    catch(error){await repository.failMoney("external_dispute",claim.claimId,error instanceof Error?error.message:"stripe_error",context);throw error}
  });
  app.use(express.json({ limit: "100kb" }));
  registerEmergencyRoute(app);
  registerDemoRoutes(app);
  app.use("/api", async (req, res, next) => { const value = req.header("Authorization"); if (!value?.startsWith("Bearer ")) return res.status(401).json({ error: "authentication_required" }); const token=value.slice(7);const found = await auth.authenticate(token); if (!found) return res.status(401).json({ error: "invalid_token" });if(found.role==="operator"&&auth.authorizeOperator&&!await auth.authorizeOperator(token))return res.status(403).json({error:"operator_not_allowlisted"}); res.locals.actor = found; next(); });
  registerProviderRoutes(app);
  registerCareRoutes(app);
  registerBusinessRoutes(app);
  registerLifecycleRoutes(app);
  registerIntakeRoutes(app, { beforeConfirm: options.repository ? undefined : validateCoverage,
    onSafety: options.repository ? undefined : recordSafetyReport,
    onConfirmed: options.repository ? undefined : async (requestId) => { await applyCarePriority(requestId); const service=featureService(); const matches=await service.from('request_matches').select('provider_id',{count:'exact',head:true}).eq('request_id',requestId); const request=await service.from('service_requests').select('workflow_status').eq('id',requestId).single(); if(matches.error) throw matches.error; if(request.error) throw request.error; return {matchCount:matches.count??0,status:request.data.workflow_status}; }, repository, provider: options.intakeProvider ?? createIntakeProvider(), signingSecret: options.intakeSigningSecret ?? process.env.INTAKE_SIGNING_SECRET ?? process.env.SESSION_SECRET, usageBudget: options.intakeUsageBudget ?? createIntakeUsageBudget(), now });
  registerIntakeMediaRoutes(app, { repository, signingSecret: options.intakeSigningSecret ?? process.env.INTAKE_SIGNING_SECRET ?? process.env.SESSION_SECRET, now, store: options.intakeMediaStore });
  const requireRole = (roles: Actor["role"][]) => (_req: Request, res: Response, next: NextFunction) => roles.includes(actor(res).role) ? next() : res.status(403).json({ error: "forbidden" });
  const commandFor: Record<string, Command> = { "request.create": "create_request", "request.match": "match_request", "quote.create": "submit_quote", "job.start": "start_job", "evidence.create": "submit_evidence", "change.create": "propose_change", "change.approve": "approve_change", "job.complete": "complete_job", "dispute.open": "open_internal_dispute", "dispute.resolve": "resolve_dispute", "settlement.preflight": "settlement_preflight" };
  const mutate = async (req: Request, res: Response, operation: string, fn: (s: RepositoryState, who: Actor) => { status: number; data: unknown }, idempotent = false, extra: Record<string, unknown> = {}) => {
    const key = req.header("Idempotency-Key"); if (idempotent && !key) return res.status(400).json({ error: "idempotency_key_required" });
    const who = actor(res); const accessToken = req.header("Authorization")?.slice(7) ?? "";
    const commandArgs = Object.keys(extra).length ? { ...extra, request_id: req.params.requestId } : { ...req.body, request_id: req.params.requestId, change_id: req.params.changeId, dispute_id: req.params.disputeId };
    const result = await repository.execute(commandFor[operation], commandArgs, { actor: who, accessToken, idempotencyKey: key, now: now().toISOString() }, (s) => fn(s, who));
    return res.status(result.status).json(result.data);
  };
  const addAudit = (s: RepositoryState, who: Actor, action: string, requestId?: string, detail: Record<string, unknown> = {}) => { const id = `audit_${++s.sequence}`; s.audit.push({ id, actorId: who.id, action, resourceType:"request",resourceId:requestId??who.id,rationale:String(detail.reason??action),correlationId:id,requestId,detail,at: now().toISOString() }); };
  const missing = { status: 404, data: { error: "request_not_found" } };

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/ops/readiness",requireRole(["operator"]),(_req,res)=>{
    const manifest=deploymentManifest.success?deploymentManifest.data:undefined;
    const receipt=paymentApproval?.receipt as {mode?:unknown;keyId?:unknown}|undefined;
    const expected=paymentApproval?.expectedBinding;
    const receiptModeBound=!receipt||receipt.mode===manifest?.paymentsMode;
    const approvalBound=receiptModeBound&&(manifest?.paymentsMode!=="enabled"||(
        paymentsMode==="enabled"
        && receipt?.keyId===manifest.approvalReceiptId
        && expected?.environmentHash===manifest.environmentHash
        && expected?.projectHash===manifest.projectHash
        && expected?.gitSha===manifest.gitSha
        && expected?.migrationHead===manifest.migrationHead
        && JSON.stringify(Object.entries(expected?.capabilityHashes??{}).sort())===JSON.stringify(Object.entries(manifest.capabilityResultHashes).sort())
      ));
    const paymentState=Boolean(manifest&&manifest.paymentsMode===paymentsMode&&approvalBound);
    const ready=Boolean(manifest&&paymentState);
    const sorted=(values:Record<string,string>)=>Object.fromEntries(Object.entries(values).sort(([left],[right])=>left.localeCompare(right)));
    return res.status(ready?200:503).json({
      ready,
      payments:{mode:paymentsMode,state:paymentState?"ready":"blocked"},
      capabilities:manifest?Object.fromEntries(Object.entries(sorted(manifest.capabilityResultHashes)).map(([name,resultHash])=>[name,{state:"bound",resultHash}])):{},
      hashes:manifest?{environment:manifest.environmentHash,project:manifest.projectHash,apiOrigin:manifest.apiOriginHash,git:manifest.gitSha,evidence:sorted(manifest.evidenceHashes)}:{},
    });
  });
  app.get("/api/dashboard", async (req, res) => { await repository.expandStaleQuoteRequests(now().toISOString());const data = await repository.dashboard(actor(res), req.header("Authorization")?.slice(7) ?? ""); res.json(data); });
  app.put("/api/operators/providers/:providerId/eligibility",requireRole(["operator"]),async(req,res)=>{const input=body(z.object({status:z.enum(["pending","approved","suspended"]),organizationName:z.string().min(1),licenseVerified:z.boolean(),licenseExpiresAt:z.string().datetime(),insuranceVerified:z.boolean(),insuranceExpiresAt:z.string().datetime(),serviceCategories:z.array(z.string().min(1)).min(1),serviceAreas:z.array(z.string().min(1)).min(1)}),req,res);if(!input)return;await repository.execute("provider_eligibility",{...input,providerId:String(req.params.providerId)},{actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{const value=s.providerEligibility[String(req.params.providerId)]={...input};addAudit(s,actor(res),"provider.eligibility_updated",undefined,{providerId:req.params.providerId,status:input.status});return{status:200,data:value}}).then(v=>res.status(v.status).json(v.data))});
  app.get("/api/ops/recovery",requireRole(["operator"]),async(req,res)=>{await repository.execute("recovery_list",{}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>({status:200,data:{claims:Object.values(s.claims).filter(c=>c.state!=="completed"),receivables:s.receivables.filter(r=>r.status==="open")}})).then(v=>res.status(v.status).json(v.data))});
  app.post("/api/ops/recovery/receivables/:receivableId/resolve",requireRole(["operator"]),async(req,res)=>{await repository.execute("receivable_resolve",{receivable_id:String(req.params.receivableId)}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{const value=s.receivables.find(r=>r.id===String(req.params.receivableId));if(!value)return{status:404,data:{error:"receivable_not_found"}};value.status="resolved";return{status:200,data:value}}).then(v=>res.status(v.status).json(v.data))});
  app.post("/api/privacy/consent", async (req,res)=>{const input=body(z.object({version:z.string().min(1),accepted:z.literal(true)}),req,res);if(!input)return;await repository.execute("privacy_consent",{version:input.version}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{s.privacy[actor(res).id]={actorId:actor(res).id,consentVersion:input.version,consentedAt:now().toISOString()};return{status:201,data:s.privacy[actor(res).id]}}).then(v=>res.status(v.status).json(v.data))});
  app.post("/api/privacy/deletion", async (req,res)=>{await repository.execute("privacy_delete",{}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{const p=s.privacy[actor(res).id];if(!p)return{status:409,data:{error:"privacy_consent_required"}};p.deletionRequestedAt=now().toISOString();return{status:202,data:p}}).then(v=>res.status(v.status).json(v.data))});
  app.post("/api/requests/:requestId/details",requireRole(["customer"]),async(req,res)=>{const input=body(requestDetails,req,res);if(!input)return;await repository.execute("request_details",{...input,priceDisclosure:input.priceDisclosure??{source:"legacy_acceptance",sampleCount:0,updatedAt:now().toISOString(),confidence:0},request_id:String(req.params.requestId)}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{const r=s.requests[String(req.params.requestId)];if(!r||r.customerId!==actor(res).id)return{status:403,data:{error:"forbidden"}};if(r.workScopeSnapshot)return{status:409,data:{error:"work_scope_immutable"}};r.workScopeSnapshot=typeof input.workScope==="string"?{symptom:input.workScope,location:r.address,dimensions:"unspecified",access:"unspecified",desiredTime:now().toISOString(),photos:[],exclusions:[]}:input.workScope;r.triageSnapshot=input.triage;r.priceDisclosure=input.priceDisclosure??{source:"legacy_acceptance",sampleCount:0,updatedAt:now().toISOString(),confidence:0};addAudit(s,actor(res),"request.details_disclosed",r.id,input);return{status:200,data:{...input,priceDisclosure:r.priceDisclosure}}}).then(v=>res.status(v.status).json(v.data))});
  app.post("/api/requests/:requestId/messages",async(req,res)=>{const input=body(z.object({text:z.string().trim().min(1).max(2000)}),req,res);if(!input)return;const masked=maskMessage(input.text);await repository.execute("message_create",{text:masked,request_id:String(req.params.requestId)}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{const id=String(req.params.requestId);if(!owns(s,id,actor(res)))return{status:403,data:{error:"forbidden"}};const value={id:`msg_${++s.sequence}`,requestId:id,senderId:actor(res).id,text:masked,createdAt:now().toISOString()};s.messages.push(value);return{status:201,data:value}}).then(v=>res.status(v.status).json(v.data))});
  app.put("/api/requests/:requestId/schedule",async(req,res)=>{const input=body(z.object({startsAt:z.string().datetime(),timeZone:z.string().min(1),status:z.enum(["proposed","confirmed"])}),req,res);if(!input)return;await repository.execute("schedule_upsert",{...input,request_id:String(req.params.requestId)}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{const id=String(req.params.requestId);if(!owns(s,id,actor(res)))return{status:403,data:{error:"forbidden"}};return{status:200,data:s.schedules[id]={requestId:id,...input}}}).then(v=>res.status(v.status).json(v.data))});
  app.post("/api/requests/:requestId/reviews",requireRole(["customer"]),async(req,res)=>{const input=body(z.object({rating:z.number().int().min(1).max(5),text:z.string().trim().min(3).max(2000)}),req,res);if(!input)return;await repository.execute("review_create",{...input,request_id:String(req.params.requestId)}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{const id=String(req.params.requestId),j=s.jobs[id],r=s.requests[id];if(!j||r?.customerId!==actor(res).id||j.settlementState!=="settled")return{status:409,data:{error:"settled_job_required"}};if(s.reviews.some(v=>v.requestId===id))return{status:409,data:{error:"review_exists"}};const value={id:`review_${++s.sequence}`,requestId:id,customerId:actor(res).id,providerId:j.providerId,...input,createdAt:now().toISOString()};s.reviews.push(value);return{status:201,data:value}}).then(v=>res.status(v.status).json(v.data))});

  app.post("/api/requests", requireRole(["customer"]), async (req, res) => { const input = body(intake, req, res); if (!input) return; await mutate(req, res, "request.create", (s, who) => { const hazards = input.hazards.filter((v) => v !== "none"); const id = `req_${++s.sequence}`; const item = s.requests[id] = { id, customerId: who.id, customerName: input.customerName, description: input.description, address: input.address, safetyStatus: hazards.length ? "blocked" : "cleared", hazardReason: hazards.join(", ") || undefined, status: "intake", providerIds: [], expandedSearch: false, createdAt: now().toISOString() }; addAudit(s, who, hazards.length ? "request.hazard_blocked" : "request.created", id); return hazards.length ? { status: 422, data: { error: "hazard_blocked", request: item, guidance: "즉시 중단하고 911 또는 공공기관에 연락하세요." } } : { status: 201, data: item }; }); });
  app.post("/api/requests/:requestId/match", requireRole(["operator"]), async (req, res) => { const input = body(match, req, res); if (!input) return; await mutate(req, res, "request.match", (s, who) => { const item = s.requests[String(req.params.requestId)]; if (!item) return missing; if (item.safetyStatus !== "cleared") return { status: 409, data: { error: "safety_clearance_required" } };if(input.providerIds.some(id=>!providerEligible(s,id,item.id,now().toISOString())))return{status:409,data:{error:"provider_ineligible"}}; item.providerIds = [...new Set(input.providerIds)].slice(0, 3); item.expandedSearch = item.providerIds.length < 3; item.status = "matched"; addAudit(s, who, "request.matched", item.id); return { status: 200, data: item }; }); });
  app.post("/api/requests/:requestId/provider-slot",requireRole(["operator"]),async(req,res)=>{const input=body(z.object({providerId:z.string().min(1)}),req,res);if(!input)return;await repository.execute("provider_slot",{request_id:String(req.params.requestId),providerId:input.providerId}, {actor:actor(res),accessToken:req.header("Authorization")?.slice(7)??"",now:now().toISOString()},s=>{const r=s.requests[String(req.params.requestId)];if(!r)return missing;if(r.providerIds.includes(input.providerId))return{status:409,data:{error:"provider_already_matched"}};if(r.providerIds.length>=3)return{status:409,data:{error:"provider_slots_full"}};r.providerIds.push(input.providerId);r.expandedSearch=r.providerIds.length<3;return{status:201,data:r}}).then(v=>res.status(v.status).json(v.data))});
  app.post("/api/requests/:requestId/quotes", requireRole(["provider"]), async (req, res) => { const input = body(quote, req, res); if (!input) return; await mutate(req, res, "quote.create", (s, who) => { const item = s.requests[String(req.params.requestId)]; if (!item) return missing; if (!providerEligible(s,who.id,item.id,now().toISOString()) || !item.providerIds.includes(who.id) || !["matched","quoted"].includes(item.status)) return { status: 403, data: { error: "provider_not_assigned" } }; if(Object.values(s.quotes).some(q=>q.requestId===item.id&&q.providerId===who.id))return{status:409,data:{error:"provider_quote_exists"}}; const id = `quote_${++s.sequence}`,createdAt=now().toISOString(),eligibility=s.providerEligibility[who.id],providerReviews=s.reviews.filter(review=>review.providerId===who.id),isExploration=providerReviews.length===0&&explorationSelected(item.id,who.id); const value = { id, requestId: item.id, providerId: who.id, ...input, ranking:{...input.ranking,licenseVerified:eligibility.licenseVerified,insuranceVerified:eligibility.insuranceVerified,rating:providerReviews.length?providerReviews.reduce((sum,review)=>sum+review.rating,0)/providerReviews.length:0},rankingPolicyVersion:RANKING_POLICY_VERSION,explorationSelected:isExploration,createdAt,rankingScore:0 };value.rankingScore=compositeQuoteScore({...value,rankingScore:undefined});s.quotes[id]=value; item.expandedSearch = new Set(Object.values(s.quotes).filter((q) => q.requestId === item.id).map((q) => q.providerId)).size < 3; item.status = "quoted"; addAudit(s, who, "quote.created", item.id); return { status: 201, data: value }; }); });
  const customerPayment = (kind: "deposit" | "balance") => async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId);
    const input = body(kind === "deposit" ? z.object({ quoteId: z.string().min(1) }) : z.object({}), req, res);
    if (!input) return;
    const key = req.header("Idempotency-Key");
    if (!key) return res.status(400).json({ error: "idempotency_key_required" });
    const context = { actor: actor(res), accessToken: req.header("Authorization")!.slice(7), idempotencyKey: key, now: now().toISOString() };
    let claim;
    try { claim = await repository.claimMoney(kind, { request_id: requestId, ...(kind === "deposit" ? { quote_id: (input as unknown as { quoteId: string }).quoteId } : {}) }, context); }
    catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : `${kind}_claim_failed` }); }
    if (claim.state === "completed") { const resumed=await repository.resumeCustomerPayment(kind,claim.claimId,context); return res.status(resumed.status).json(resumed.data); }
    try {
      const intent = await stripe!.createCustomerPayment(checkedStripeAmount(claim.amountCents), claim.requestId, kind, claim.claimId);
      const result = await repository.completeMoney(kind, claim.claimId, intent.id, context, { clientSecret: intent.clientSecret });
      return res.status(result.status).json(result.data);
    } catch (error) { await repository.failMoney(kind, claim.claimId, error instanceof Error ? error.message : "stripe_error", context); throw error; }
  };
  app.post("/api/requests/:requestId/deposit", requireRole(["customer"]), customerPayment("deposit"));
  app.post("/api/requests/:requestId/balance", requireRole(["customer"]), customerPayment("balance"));
  app.post("/api/requests/:requestId/start", requireRole(["provider"]), async (req, res) => { await mutate(req, res, "job.start", (s, who) => { const item = s.requests[String(req.params.requestId)], job = s.jobs[String(req.params.requestId)]; if (!item || !job) return missing; if (job.providerId !== who.id || !providerEligible(s,who.id,item.id,now().toISOString())) return { status: 403, data: { error: "forbidden" } }; if (item.status !== "funded") return { status: 409, data: { error: "invalid_job_transition" } }; item.status = "in_progress"; addAudit(s, who, "job.started", item.id); return { status: 200, data: item }; }); });
  app.post("/api/requests/:requestId/evidence", requireRole(["provider"]), async (req, res) => { const input = body(evidence, req, res); if (!input) return; await mutate(req, res, "evidence.create", (s, who) => { if (!providerEligible(s,who.id,String(req.params.requestId),now().toISOString()) || !owns(s, String(req.params.requestId), who) || !s.requests[String(req.params.requestId)]?.providerIds.includes(who.id)) return { status: 403, data: { error: "forbidden" } }; const value = { id: `evidence_${++s.sequence}`, requestId: String(req.params.requestId), providerId: who.id, ...input, createdAt: now().toISOString() }; s.evidence.push(value); addAudit(s, who, "evidence.submitted", value.requestId); return { status: 201, data: value }; }); });
  app.post("/api/requests/:requestId/changes", requireRole(["provider"]), async (req, res) => { const input = body(change, req, res); if (!input) return; await mutate(req, res, "change.create", (s, who) => { const item = s.requests[String(req.params.requestId)]; if (!item?.providerIds.includes(who.id) || !providerEligible(s,who.id,item.id,now().toISOString())) return { status: 403, data: { error: "forbidden" } }; if (input.evidenceIds.some((id) => !s.evidence.some((e) => e.id === id && e.requestId === item.id && e.providerId === who.id))) return { status: 409, data: { error: "change_evidence_missing" } }; const id = `change_${++s.sequence}`; const value = s.changes[id] = { id, requestId: item.id, ...input, createdAt: now().toISOString() }; addAudit(s, who, "change.proposed", item.id); return { status: 201, data: value }; }); });
  app.post("/api/changes/:changeId/approve", requireRole(["customer"]), async (req, res) => { await mutate(req, res, "change.approve", (s, who) => { const value = s.changes[String(req.params.changeId)]; if (!value) return { status: 404, data: { error: "change_not_found" } }; if (s.requests[value.requestId]?.customerId !== who.id) return { status: 403, data: { error: "forbidden" } }; const job=s.jobs[value.requestId],quote=job&&s.quotes[job.quoteId];const aggregate=(quote?.amountCents??0)+Object.values(s.changes).filter(v=>v.requestId===value.requestId&&v.approvedAt&&v.id!==value.id).reduce((n,v)=>n+v.amountCents,0)+value.amountCents;if(aggregate>99_999_999)return{status:409,data:{error:"stripe_aggregate_amount_limit_exceeded"}}; value.approvedAt ??= now().toISOString(); addAudit(s, who, "change.approved", value.requestId); return { status: 200, data: value }; }); });
  app.post("/api/requests/:requestId/complete", requireRole(["provider"]), async (req, res) => { await mutate(req, res, "job.complete", (s, who) => { const item = s.requests[String(req.params.requestId)], job = s.jobs[String(req.params.requestId)]; if (!item || !job) return missing; if (job.providerId !== who.id || !providerEligible(s,who.id,item.id,now().toISOString())) return { status: 403, data: { error: "forbidden" } }; if (item.status !== "in_progress") return { status: 409, data: { error: "job_not_in_progress" } }; const kinds = new Set(s.evidence.filter((v) => v.requestId === item.id && v.providerId === who.id).map((v) => v.kind)); if (!kinds.has("before") || !kinds.has("after")) return { status: 409, data: { error: "before_after_evidence_required" } }; job.completedAt = now().toISOString(); job.authorizationVersion += 1; item.status = "completed"; addAudit(s, who, "job.completed", item.id); return { status: 200, data: { ...job, disputeWindowEndsAt: new Date(now().getTime() + WINDOW_MS).toISOString() } }; }); });
  app.post("/api/requests/:requestId/disputes", requireRole(["customer"]), async (req, res) => { const input = body(dispute, req, res); if (!input) return; if (input.source !== "internal") return res.status(403).json({ error: "external_disputes_require_signed_webhook" }); await mutate(req, res, "dispute.open", (s, who) => { const item = s.requests[String(req.params.requestId)], job = s.jobs[String(req.params.requestId)]; if (!item || !job?.completedAt) return { status: 409, data: { error: "completion_required" } }; if (item.customerId !== who.id) return { status: 403, data: { error: "forbidden" } }; const elapsed = now().getTime() - new Date(job.completedAt).getTime(); if (elapsed < 0 || elapsed >= WINDOW_MS) return { status: 409, data: { error: "dispute_window_closed" } }; const id = `dispute_${++s.sequence}`; const value = s.disputes[id] = { id, requestId: item.id, source: "internal", reason: input.reason, status: "open", createdAt: now().toISOString() }; job.authorizationVersion += 1; job.authorizationToken = undefined; addAudit(s, who, "dispute.opened", item.id); return { status: 201, data: value }; }); });
  app.post("/api/disputes/:disputeId/resolve", requireRole(["operator"]), async (req, res) => { await mutate(req, res, "dispute.resolve", (s, who) => { const value = s.disputes[String(req.params.disputeId)]; if (!value) return { status: 404, data: { error: "dispute_not_found" } }; value.status = "resolved"; s.jobs[value.requestId].authorizationVersion += 1; addAudit(s, who, "dispute.resolved", value.requestId); return { status: 200, data: value }; }); });
  app.post("/api/requests/:requestId/settlement-preflight", requireRole(["operator"]), async (req, res) => { await mutate(req, res, "settlement.preflight", (s, who) => {
    const item = s.requests[String(req.params.requestId)], job = s.jobs[String(req.params.requestId)];
    if (!item || !job?.completedAt) return { status: 409, data: { error: "completion_required" } };
    if (item.status !== "completed" || job.settlementState !== "none") return { status: 409, data: { error: "settlement_not_pristine" } };
    if (now().getTime() < new Date(job.completedAt).getTime() + WINDOW_MS) return { status: 409, data: { error: "hold_active" } };
    if (Object.values(s.disputes).some((v) => v.requestId === item.id && (v.status === "open" || v.status === "under_review"))) return { status: 409, data: { error: "open_dispute" } };
    if (Object.values(s.claims).some((v) => v.requestId === item.id && v.kind === "refund" && v.status === "claimed")) return { status: 409, data: { error: "pending_refund" } };
    if (!job.providerEligible) return { status: 409, data: { error: "provider_account_ineligible" } };
    const basisCents = s.payments.filter((p) => p.requestId === item.id && p.status === "succeeded" && (p.kind === "deposit" || p.kind === "balance")).reduce((n, p) => n + p.amountCents, 0);
    const dueCents = s.quotes[job.quoteId].amountCents + Object.values(s.changes).filter((v) => v.requestId === item.id && v.approvedAt).reduce((n, v) => n + v.amountCents, 0);
    if (basisCents !== dueCents || !s.payments.some((p) => p.requestId === item.id && p.kind === "balance" && p.status === "succeeded")) return { status: 409, data: { error: "captured_balance_required" } };
    if (!job.feeSnapshot || job.feeSnapshot.basisCents !== basisCents) return { status: 409, data: { error: "booking_fee_snapshot_missing_or_stale" } };
    const amountCents = job.feeSnapshot.amountCents, rateBps = job.feeSnapshot.rateBps;
    job.authorizationToken = randomUUID(); job.settlementState = "authorized";
    addAudit(s, who, "settlement.preflight", item.id, { ...job.feeSnapshot });
    return { status: 200, data: { authorizationToken: job.authorizationToken, authorizationVersion: job.authorizationVersion, feeVersion: job.feeSnapshot.version, feeRateBps: rateBps, feeAmountCents: amountCents, capturedAmountCents: basisCents, transferAmountCents: basisCents - amountCents } };
  }); });
  app.post("/api/requests/:requestId/settle",requireRole(["operator"]),async(req,res)=>{const input=body(z.object({authorizationToken:z.string().uuid(),authorizationVersion:z.number().int().nonnegative(),feeVersion:z.number().int().nonnegative(),feeRateBps:z.number().int().nonnegative(),feeAmountCents:z.number().int().nonnegative()}),req,res);if(!input)return;const key=req.header("Idempotency-Key");if(!key)return res.status(400).json({error:"idempotency_key_required"});const context={actor:actor(res),accessToken:req.header("Authorization")!.slice(7),idempotencyKey:key,now:now().toISOString()};let claim;try{claim=await repository.claimMoney("settlement",{request_id:req.params.requestId,authorization_token:input.authorizationToken,authorization_version:input.authorizationVersion,fee_version:input.feeVersion,fee_rate_bps:input.feeRateBps,fee_amount_cents:input.feeAmountCents},context)}catch(error){return res.status(409).json({error:error instanceof Error?error.message:"settlement_claim_failed"})}if(claim.state==="completed")return res.status(200).json(claim);try{const reference=await stripe!.transfer(checkedStripeAmount(claim.amountCents),claim.destinationAccount,claim.claimId);const result=await repository.completeMoney("settlement",claim.claimId,reference,context);return res.status(result.status).json(result.data)}catch(error){await repository.failMoney("settlement",claim.claimId,error instanceof Error?error.message:"stripe_error",context);throw error}});
  app.post("/api/requests/:requestId/refunds",requireRole(["operator"]),async(req,res)=>{const input=body(refund,req,res);if(!input)return;const key=req.header("Idempotency-Key");if(!key)return res.status(400).json({error:"idempotency_key_required"});const context={actor:actor(res),accessToken:req.header("Authorization")!.slice(7),idempotencyKey:key,now:now().toISOString()};let claim;try{claim=await repository.claimMoney("refund",{request_id:req.params.requestId,amount_cents:input.amountCents,reason:input.reason},context)}catch(error){return res.status(409).json({error:error instanceof Error?error.message:"refund_claim_failed"})}if(claim.state==="completed")return res.status(200).json(claim);try{const refunds=[];for(const allocation of claim.allocations??[]){const refundId=await stripe!.refund(allocation.paymentIntentId,checkedStripeAmount(allocation.amountCents),`${claim.claimId}:${allocation.paymentId}`);refunds.push({paymentId:allocation.paymentId,refundId,amountCents:allocation.amountCents})}const result=await repository.completeMoney("refund",claim.claimId,refunds[0]?.refundId,context,{refunds});return res.status(result.status).json(result.data)}catch(error){await repository.failMoney("refund",claim.claimId,error instanceof Error?error.message:"stripe_error",context);throw error}});
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => featureError(res, error));
  return app;
}
