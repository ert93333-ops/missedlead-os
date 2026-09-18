/**
 * 레거시 인메모리 repository: 요청/견적/변경/작업/분쟁/증빙/결제/감사 도메인 로직과
 * 명령 디스패치. Supabase RPC로 대체 진행 중이며 테스트·레거시 라우트가 사용한다.
 * 견적 랭킹(compositeQuoteScore), 15% 탐색 선택, Stripe 금액 검증 유틸 포함.
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
export const STRIPE_MAX_CENTS = 99_999_999n;
export const checkedStripeAmount = (value: number | string | bigint) => { const cents = typeof value === "bigint" ? value : BigInt(value); if (cents <= 0n || cents > STRIPE_MAX_CENTS || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("stripe_amount_out_of_range"); return Number(cents); };

export type Role = "customer" | "provider" | "operator";
export interface Actor { id: string; role: Role; email?: string }
export interface Result { status: number; data: unknown }
export interface CommandContext { actor: Actor; accessToken: string; idempotencyKey?: string; now: string }
export type Command = "create_request" | "confirm_intake" | "match_request" | "provider_slot" | "provider_eligibility" | "submit_quote" | "start_job" | "submit_evidence" | "propose_change" | "approve_change" | "complete_job" | "open_internal_dispute" | "resolve_dispute" | "settlement_preflight" | "privacy_consent" | "privacy_delete" | "request_details" | "message_create" | "schedule_upsert" | "review_create" | "recovery_list" | "receivable_resolve";
export interface ProviderEligibility { status: "pending"|"approved"|"suspended"; organizationName: string; licenseVerified: boolean; licenseExpiresAt: string; insuranceVerified: boolean; insuranceExpiresAt: string; serviceCategories: string[]; serviceAreas: string[] }
export type MoneyKind = "deposit" | "balance" | "payment_succeeded" | "settlement" | "refund" | "external_dispute" | "recovery";
export type CustomerPaymentKind = Extract<MoneyKind, "deposit" | "balance">;
export interface RefundAllocation { paymentId: string; paymentIntentId: string; amountCents: number }
export interface MoneyClaim { claimId: string; state: "claimed" | "completed"; amountCents: number; amountCentsDecimal?: string; destinationAccount?: string; providerReference?: string; providerIdempotencyKey?: string; requestId: string; allocations?: RefundAllocation[]; claimedAt?: string }
export type IntakeCategory = "plumbing" | "hvac" | "handyman";
export interface ServiceRequest { id: string; customerId: string; customerName: string; description: string; address: string; safetyStatus: "cleared" | "blocked"; hazardReason?: string; status: string; providerIds: string[]; expandedSearch: boolean; category?: IntakeCategory; workScopeSnapshot?: Record<string,unknown>; triageSnapshot?: Record<string,unknown>; priceDisclosure?: Record<string,unknown>; myMatchStatus?: string; createdAt: string }
export interface Quote { id: string; requestId: string; providerId: string; providerName: string; scope: string; amountCents: number; ranking: { totalCents: number; earliestStartAt: string; warrantyDays: number; licenseVerified?:boolean; insuranceVerified?:boolean; rating?:number; distanceMiles?:number; responseMinutes?:number; languages?:string[] }; rankingScore?: number; rankingPolicyVersion?: number; explorationSelected?: boolean; createdAt: string }
export interface Change { id: string; requestId: string; description: string; amountCents: number; items: Array<{ description: string; quantity: number; unitCents: number }>; evidenceIds: string[]; approvedAt?: string; createdAt: string }
export interface Evidence { id: string; requestId: string; providerId: string; kind: "before" | "during" | "after" | "receipt" | "warranty"; note: string; createdAt: string }
export type PaymentKind = "deposit" | "balance" | "transfer" | "refund" | "reversal";
export interface Payment { id: string; requestId: string; kind: PaymentKind; status: "pending" | "succeeded" | "failed"; amountCents: number; providerReference: string; sourcePaymentId?: string; clientSecret?: string; createdAt: string }
export interface FeePolicy { id: string; version: number; effectiveFrom: string; effectiveUntil?: string; founderOnly: boolean; rateBps: number; taxRateBps: number; stripeFeeTreatment: "included" | "deduct_actual"; refundTreatment: "fee_refundable" | "fee_retained"; rounding: "half_up" }
export interface FeeSnapshot { policyId: string; version: number; rateBps: number; taxRateBps: number; basisCents: number; feeCents: number; taxCents: number; stripeFeeTreatment: FeePolicy["stripeFeeTreatment"]; refundTreatment: FeePolicy["refundTreatment"]; rounding: FeePolicy["rounding"]; amountCents: number; capturedAt: string }
export interface Job { requestId: string; quoteId: string; depositCents: number; providerId: string; completedAt?: string; settledAt?: string; settlementState: "none" | "authorized" | "transferring" | "reconciliation_required" | "settled" | "reversed" | "manual_action"; authorizationVersion: number; authorizationToken?: string; providerEligible?: boolean; providerFounderEligible?: boolean; feeSnapshot?: FeeSnapshot }
export interface Receivable { id: string; requestId: string; disputeId: string; amountCents: number; status: "open" | "resolved"; reason: string; createdAt: string }
export interface Dispute { id: string; requestId: string; source: "internal" | "external"; externalId?: string; reason: string; status: "open" | "resolved" | "under_review" | "won" | "lost"; createdAt: string; updatedAt?: string; objectVersion?: number }
export interface Audit { id: string; actorId: string; action: string; resourceType?: string; resourceId?: string; rationale?: string; correlationId?: string; requestId?: string; at: string; detail: Record<string, unknown> }
export interface PrivacyRecord { actorId: string; consentVersion: string; consentedAt: string; deletionRequestedAt?: string }
export interface MediaRecord { id: string; requestId: string; ownerId: string; fileName: string; contentType: string; sizeBytes: number; objectPath:string; sanitizedObjectPath?:string; uploadStatus:"pending"|"uploaded"; status: "pending_scan" | "sanitized" | "rejected"; private: true; exifRemovalStatus:"pending"|"removed"|"failed"; retryCount:number; checksum:string; privacyDeletionId?:string; createdAt: string }
export interface MessageRecord { id: string; requestId: string; senderId: string; text: string; createdAt: string }
export interface ScheduleRecord { requestId: string; startsAt: string; timeZone: string; status: "proposed" | "confirmed" }
export interface ReviewRecord { id: string; requestId: string; customerId: string; providerId: string; rating: number; text: string; createdAt: string }
export interface MoneyProviderObservation { claimId: string; kind: MoneyKind; providerReference: string; providerStatus: string; providerEventId?: string; observedAt: string }
interface ClaimRecord extends MoneyClaim { kind: MoneyKind; fingerprint: string; status: "claimed" | "completed" | "failed"; failureReason?: string }
export interface RepositoryState { sequence: number; requests: Record<string, ServiceRequest>; confirmedIntakes: Record<string, string>; providerEligibility:Record<string,ProviderEligibility>; quotes: Record<string, Quote>; changes: Record<string, Change>; jobs: Record<string, Job>; disputes: Record<string, Dispute>; evidence: Evidence[]; payments: Payment[]; audit: Audit[]; claims: Record<string, ClaimRecord>; moneyObservations: MoneyProviderObservation[]; webhookEvents: Record<string, string>; webhookObjects: Record<string, { status: Dispute["status"]; version: number }>; feePolicies: FeePolicy[]; receivables: Receivable[]; privacy: Record<string, PrivacyRecord>; media: MediaRecord[]; messages: MessageRecord[]; schedules: Record<string, ScheduleRecord>; reviews: ReviewRecord[] }
export const emptyState = (): RepositoryState => ({ sequence: 0, requests: {}, confirmedIntakes: {}, providerEligibility:{}, quotes: {}, changes: {}, jobs: {}, disputes: {}, evidence: [], payments: [], audit: [], claims: {}, moneyObservations: [], webhookEvents: {}, webhookObjects: {}, feePolicies: [{ id: "standard-v1", version: 1, effectiveFrom: "2026-01-01T00:00:00.000Z", founderOnly: false, rateBps: 1_000, taxRateBps: 0, stripeFeeTreatment: "included", refundTreatment: "fee_retained", rounding: "half_up" }], receivables: [], privacy: {}, media: [], messages: [], schedules: {}, reviews: [] });

export interface Repository {
  dashboard(actor: Actor, accessToken: string): Promise<unknown>;
  expandStaleQuoteRequests(now:string):Promise<void>;
  execute(command: Command, args: Record<string, unknown>, context: CommandContext, testImplementation: (state: RepositoryState) => Result): Promise<Result>;
  claimMoney(kind: MoneyKind, args: Record<string, unknown>, context: CommandContext): Promise<MoneyClaim>;
  resumeCustomerPayment(kind: CustomerPaymentKind, claimId: string, context: CommandContext): Promise<Result>;
  completeMoney(kind: MoneyKind, claimId: string, providerReference: string | undefined, context: CommandContext, detail?: Record<string, unknown>): Promise<Result>;
  observeMoneyProviderStatus(kind: MoneyKind, claimId: string, providerReference: string, providerStatus: string, context: CommandContext, detail?: Record<string, unknown>): Promise<void>;
  failMoney(kind: MoneyKind, claimId: string, reason: string, context: CommandContext): Promise<void>;
  stuckMoneyClaims(before: string): Promise<Array<MoneyClaim & { kind: MoneyKind }>>;
}
export const explorationSelected=(requestId:string,providerId:string)=>Number.parseInt(createHash("sha256").update(`${requestId}:${providerId}`).digest("hex").slice(0,8),16)%100<15;
export const RANKING_POLICY_VERSION=1;
export const compositeQuoteScore=(quote:Quote)=>{
  if(quote.rankingScore!==undefined)return quote.rankingScore;
  const scheduleDays=Math.max(0,(new Date(quote.ranking.earliestStartAt).getTime()-new Date(quote.createdAt).getTime())/86_400_000);
  return (quote.ranking.licenseVerified?1500:0)+(quote.ranking.insuranceVerified?1500:0)
    +Math.max(0,Math.min(5,quote.ranking.rating??0))*600
    +Math.max(0,1200-Math.max(0,quote.ranking.distanceMiles??9999)*40)
    +Math.max(0,1000-Math.max(0,quote.ranking.responseMinutes??2147483647)/2)
    +Math.max(0,800-scheduleDays*50)+(quote.ranking.languages?.length?500:0)
    +Math.max(0,2000-quote.amountCents/100)+(quote.explorationSelected?1500:0);
};

const isOpenDispute = (d: Dispute) => d.status === "open" || d.status === "under_review";
const totalDue = (state: RepositoryState, job: Job) => state.quotes[job.quoteId].amountCents + Object.values(state.changes).filter((v) => v.requestId === job.requestId && v.approvedAt).reduce((n, v) => n + v.amountCents, 0);
const captured = (state: RepositoryState, requestId: string, kind?: "deposit" | "balance") => state.payments.filter((p) => p.requestId === requestId && p.status === "succeeded" && (!kind || p.kind === kind) && (p.kind === "deposit" || p.kind === "balance"));
const refundedFor = (state: RepositoryState, paymentId: string) => state.payments.filter((p) => p.kind === "refund" && p.status === "succeeded" && p.sourcePaymentId === paymentId).reduce((n, p) => n + p.amountCents, 0);
const providerEligibleState=(state:RepositoryState,providerId:string,requestId:string,at:string)=>{const p=state.providerEligibility[providerId],r=state.requests[requestId];return Boolean(p&&r&&p.status==="approved"&&p.licenseVerified&&p.insuranceVerified&&p.licenseExpiresAt>at&&p.insuranceExpiresAt>at&&p.serviceCategories.includes(r.category??"general")&&p.serviceAreas.includes("Charlotte"));};
const intakeObject=(value:unknown):Record<string,unknown>|undefined=>typeof value==="object"&&value!==null&&!Array.isArray(value)?structuredClone(Object.fromEntries(Object.entries(value))):undefined;
const confirmIntakeInMemory=(state:RepositoryState,args:Record<string,unknown>,context:CommandContext):Result=>{
  if(context.actor.role!=="customer")return{status:403,data:{error:"customer_required"}};
  const assessmentId=typeof args.assessmentId==="string"?args.assessmentId:"",category=args.category;
  const customerName=typeof args.customerName==="string"?args.customerName:"",address=typeof args.address==="string"?args.address:"",description=typeof args.description==="string"?args.description:"";
  const workScope=intakeObject(args.workScope),triage=intakeObject(args.triage),priceDisclosure=intakeObject(args.priceDisclosure);
  if(!assessmentId||!customerName||!address||!description||(category!=="plumbing"&&category!=="hvac"&&category!=="handyman")||!workScope||!triage||!priceDisclosure)return{status:409,data:{error:"confirmed_intake_invalid"}};
  const idempotencyKey=`${context.actor.id}:${assessmentId}`,existingId=state.confirmedIntakes[idempotencyKey],existing=existingId?state.requests[existingId]:undefined;
  if(existing)return{status:201,data:{requestId:existing.id,status:existing.status,matchCount:existing.providerIds.length}};
  const requestId=`request_${++state.sequence}`;
  const providerIds=Object.keys(state.providerEligibility).filter(providerId=>{
    const provider=state.providerEligibility[providerId];
    return Boolean(provider&&provider.status==="approved"&&provider.licenseVerified&&provider.insuranceVerified&&provider.licenseExpiresAt>context.now&&provider.insuranceExpiresAt>context.now&&provider.serviceCategories.includes(category)&&provider.serviceAreas.includes("Charlotte"));
  }).sort().slice(0,3);
  const status=providerIds.length>0?"matched":"intake";
  state.requests[requestId]={id:requestId,customerId:context.actor.id,customerName,description,address,safetyStatus:"cleared",status,providerIds,expandedSearch:providerIds.length<3,category,workScopeSnapshot:workScope,triageSnapshot:triage,priceDisclosure,createdAt:context.now};
  state.confirmedIntakes[idempotencyKey]=requestId;
  return{status:201,data:{requestId,status,matchCount:providerIds.length}};
};
const snapshotFee = (state: RepositoryState, job: Job, basisCents: number, at: string) => {
  const policies = state.feePolicies.filter((p) => p.effectiveFrom <= at && (!p.effectiveUntil || at < p.effectiveUntil) && (!p.founderOnly || job.providerFounderEligible));
  if (policies.length !== 1) throw new Error(policies.length ? "fee_policy_overlap" : "fee_policy_missing");
  const policy = policies[0], feeCents = Number((BigInt(basisCents) * BigInt(policy.rateBps) + 5_000n) / 10_000n), taxCents = Number((BigInt(feeCents) * BigInt(policy.taxRateBps) + 5_000n) / 10_000n);
  return { policyId: policy.id, version: policy.version, rateBps: policy.rateBps, taxRateBps: policy.taxRateBps, basisCents, feeCents, taxCents, stripeFeeTreatment: policy.stripeFeeTreatment, refundTreatment: policy.refundTreatment, rounding: policy.rounding, amountCents: feeCents + taxCents, capturedAt: at };
};

export class InMemoryRepository implements Repository {
  private state: RepositoryState;
  constructor(seed: RepositoryState = emptyState()) { this.state = structuredClone(seed); }
  async dashboard(actor: Actor) { const eligible=actor.role!=="provider"||(()=>{const p=this.state.providerEligibility[actor.id],at=new Date().toISOString();return Boolean(p&&p.status==="approved"&&p.licenseVerified&&p.insuranceVerified&&p.licenseExpiresAt>at&&p.insuranceExpiresAt>at)})();const requests = Object.values(this.state.requests).filter((r) => actor.role === "operator" || r.customerId === actor.id || (eligible&&r.providerIds.includes(actor.id))); const ids = new Set(requests.map((r) => r.id)); return { requests, quotes: Object.values(this.state.quotes).filter((v) => ids.has(v.requestId)).sort((a,b)=>compositeQuoteScore(b)-compositeQuoteScore(a)||a.id.localeCompare(b.id)), changes: Object.values(this.state.changes).filter((v) => ids.has(v.requestId)), jobs: Object.values(this.state.jobs).filter((v) => ids.has(v.requestId)), disputes: Object.values(this.state.disputes).filter((v) => ids.has(v.requestId)), evidence: this.state.evidence.filter((v) => ids.has(v.requestId)), media:this.state.media.filter(v=>ids.has(v.requestId)), messages:this.state.messages.filter(v=>ids.has(v.requestId)), schedules:Object.values(this.state.schedules).filter(v=>ids.has(v.requestId)), reviews:this.state.reviews.filter(v=>ids.has(v.requestId)), privacy:{consents:(actor.role==="operator"?Object.values(this.state.privacy):Object.values(this.state.privacy).filter(v=>v.actorId===actor.id)),deletions:(actor.role==="operator"?Object.values(this.state.privacy):Object.values(this.state.privacy).filter(v=>v.actorId===actor.id)).filter(v=>v.deletionRequestedAt).map(v=>({actorId:v.actorId,status:"pending",requestedAt:v.deletionRequestedAt}))}, receivables:actor.role==="operator"?this.state.receivables.filter(v=>ids.has(v.requestId)):[], recoveryClaims:actor.role==="operator"?Object.values(this.state.claims).filter(v=>v.kind==="recovery"&&ids.has(v.requestId)):[], payments: actor.role === "operator" ? this.state.payments.filter((v) => ids.has(v.requestId)) : [], audit: actor.role === "operator" ? this.state.audit.filter((v) => !v.requestId || ids.has(v.requestId)) : [] }; }
  async expandStaleQuoteRequests(now:string) { for(const request of Object.values(this.state.requests)){const quoteCount=Object.values(this.state.quotes).filter(q=>q.requestId===request.id).length;if(!["matched","quoted"].includes(request.status)||quoteCount>=3||new Date(now).getTime()-new Date(request.createdAt).getTime()<86_400_000)continue;const candidates=Object.keys(this.state.providerEligibility).filter(id=>!request.providerIds.includes(id)&&providerEligibleState(this.state,id,request.id,now)).sort((a,b)=>Number(explorationSelected(request.id,b))-Number(explorationSelected(request.id,a))||a.localeCompare(b));request.providerIds.push(...candidates.slice(0,3-request.providerIds.length));request.expandedSearch=request.providerIds.length<3;} }
  async execute(command: Command, args: Record<string, unknown>, context: CommandContext, implementation: (state: RepositoryState) => Result) { const result=command==="confirm_intake"?confirmIntakeInMemory(this.state,args,context):implementation(this.state);if(result.status<400){const requestId=typeof args.request_id==="string"?args.request_id:undefined,id=`audit_${++this.state.sequence}`;this.state.audit.push({id,actorId:context.actor.id,action:RPC[command],resourceType:"rpc",resourceId:String(requestId??args.change_id??args.dispute_id??args.media_id??args.receivable_id??context.actor.id),rationale:String(args.reason??command),correlationId:context.idempotencyKey??id,requestId,detail:{command},at:context.now});}return result; }
  async claimMoney(kind: MoneyKind, args: Record<string, unknown>, context: CommandContext): Promise<MoneyClaim> {
    const key = context.idempotencyKey;
    if (!key) throw new Error("idempotency_key_required");
    const fingerprint = JSON.stringify([kind, args]);
    const prior = this.state.claims[key];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("idempotency_key_reused");
      if (prior.status === "failed") prior.status = "claimed";
      return { ...prior, state: prior.status === "completed" ? "completed" : "claimed" };
    }
    const requestId = String(args.request_id);
    const item = this.state.requests[requestId];
    const job = this.state.jobs[requestId];
    let amountCents = 0;
    let destinationAccount: string | undefined;
    let providerReference: string | undefined;
    let allocations: RefundAllocation[] | undefined;
    if (kind === "deposit") {
      const q = this.state.quotes[String(args.quote_id)];
      if (!item || !q || q.requestId !== requestId) throw new Error("quote_not_found");
      if (item.customerId !== context.actor.id) throw new Error("forbidden");
      if (item.status !== "quoted") throw new Error("invalid_deposit_transition");
      if (this.state.payments.some((p) => p.requestId === requestId && p.kind === "deposit" && p.status !== "failed")) throw new Error("deposit_exists");
      amountCents = Number((BigInt(q.amountCents) * 20n + 50n) / 100n);
    }
    if (kind === "balance") {
      if (!item || item.customerId !== context.actor.id) throw new Error("forbidden");
      if (!job?.completedAt) throw new Error("completion_required");
      if (!captured(this.state, requestId, "deposit").length) throw new Error("captured_deposit_required");
      if (this.state.payments.some((p) => p.requestId === requestId && p.kind === "balance" && p.status !== "failed")) throw new Error("balance_exists");
      amountCents = totalDue(this.state, job) - job.depositCents;
      if (amountCents <= 0) throw new Error("balance_not_due");
    }
    if (kind === "payment_succeeded") {
      const payment = this.state.payments.find((p) => p.providerReference === args.provider_reference && (p.kind === "deposit" || p.kind === "balance"));
      if (!payment || payment.requestId !== requestId) throw new Error("payment_not_found");
      amountCents = payment.amountCents;
      providerReference = payment.providerReference;
    }
    if (kind === "settlement") {
      if (context.actor.role !== "operator" || !job?.completedAt || job.settlementState !== "authorized" || job.authorizationToken !== args.authorization_token || job.authorizationVersion !== args.authorization_version) throw new Error("settlement_authorization_stale");
      if (Object.values(this.state.disputes).some((v) => v.requestId === requestId && isOpenDispute(v))) throw new Error("open_dispute");
      if (this.state.claims && Object.values(this.state.claims).some((v) => v.requestId === requestId && v.kind === "refund" && v.status === "claimed")) throw new Error("pending_refund");
      if (!job.providerEligible) throw new Error("provider_account_ineligible");
      const customerCaptured = captured(this.state, requestId).reduce((n, p) => n + p.amountCents, 0);
      if (customerCaptured !== totalDue(this.state, job)) throw new Error("captured_balance_required");
      const fee = job.feeSnapshot;
      if (!fee || fee.version !== args.fee_version || fee.rateBps !== args.fee_rate_bps || fee.amountCents !== args.fee_amount_cents || fee.basisCents !== customerCaptured) throw new Error("fee_snapshot_stale");
      amountCents = customerCaptured - fee.amountCents;
      destinationAccount = `acct_${job.providerId}`;
      job.settlementState = "transferring";
    }
    if (kind === "recovery") {
      if (!job?.providerEligible || job.settlementState !== "reconciliation_required") throw new Error("recovery_not_eligible");
      amountCents = Number(args.amount_cents);
      if (amountCents <= 0) throw new Error("recovery_amount_invalid");
      destinationAccount = `acct_${job.providerId}`;
    }
    if (kind === "refund") {
      if (context.actor.role !== "operator") throw new Error("forbidden");
      amountCents = Number(args.amount_cents);
      let remaining = amountCents;
      allocations = [];
      for (const payment of captured(this.state, requestId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const reserved = Object.values(this.state.claims).filter((v) => v.kind === "refund" && v.status === "claimed").flatMap((v) => v.allocations ?? []).filter((v) => v.paymentId === payment.id).reduce((n, v) => n + v.amountCents, 0);
        const available = payment.amountCents - refundedFor(this.state, payment.id) - reserved;
        const assigned = Math.min(remaining, available);
        if (assigned > 0) allocations.push({ paymentId: payment.id, paymentIntentId: payment.providerReference, amountCents: assigned });
        remaining -= assigned;
        if (!remaining) break;
      }
      if (amountCents <= 0 || remaining > 0) throw new Error("refund_limit_exceeded");
      providerReference = allocations[0]?.paymentIntentId;
    }
    if (kind === "external_dispute") {
      if (this.state.webhookEvents[String(args.event_id)]) {
        const existing = this.state.claims[this.state.webhookEvents[String(args.event_id)]];
        return { ...existing, state: existing.status === "completed" ? "completed" : "claimed" };
      }
      if (!job) throw new Error("funded_job_required");
      const lifecycle = String(args.lifecycle) as Dispute["status"];
      const objectId = String(args.external_id);
      const previous = this.state.webhookObjects[objectId];
      const version = (previous?.version ?? 0) + 1;
      this.state.webhookObjects[objectId] = { status: lifecycle, version };
      const transfer = this.state.payments.find((p) => p.requestId === requestId && p.kind === "transfer" && p.status === "succeeded");
      const reversed = this.state.payments.filter((p) => p.requestId === requestId && p.kind === "reversal" && p.status === "succeeded").reduce((n, p) => n + p.amountCents, 0);
      const requested = Number(args.amount_cents || transfer?.amountCents || 0);
      amountCents = (lifecycle === "under_review" || lifecycle === "lost") && transfer ? Math.max(0, Math.min(requested, transfer.amountCents) - reversed) : 0;
      providerReference = transfer?.providerReference;
      if (job.settlementState === "transferring") job.settlementState = "reconciliation_required";
    }
    const claimId = `claim_${++this.state.sequence}`;
    const claim: ClaimRecord = { claimId, kind, fingerprint, status: "claimed", state: "claimed", amountCents, destinationAccount, providerReference, providerIdempotencyKey: kind === "external_dispute" ? `reversal:${claimId}` : claimId, requestId, allocations, claimedAt: context.now };
    this.state.claims[key] = claim;
    if (kind === "external_dispute") this.state.webhookEvents[String(args.event_id)] = key;
    return claim;
  }
  async resumeCustomerPayment(kind: CustomerPaymentKind, claimId: string, context: CommandContext): Promise<Result> {
    const entry = Object.entries(this.state.claims).find(([key, claim]) => key === context.idempotencyKey && claim.claimId === claimId && claim.kind === kind && claim.status === "completed");
    if (!entry) return { status: 409, data: { error: "claim_not_found" } };
    const claim = entry[1], request = this.state.requests[claim.requestId];
    if (request?.customerId !== context.actor.id) return { status: 403, data: { error: "forbidden" } };
    const payment = this.state.payments.find(value => value.requestId === claim.requestId && value.kind === kind && value.providerReference === claim.providerReference && value.status === "pending" && value.clientSecret);
    return payment
      ? { status: 202, data: { clientSecret: payment.clientSecret, providerReference: payment.providerReference } }
      : { status: 409, data: { error: "pending_payment_not_found" } };
  }
  async completeMoney(kind: MoneyKind, claimId: string, providerReference: string | undefined, context: CommandContext, detail: Record<string, unknown> = {}): Promise<Result> {
    const claim = Object.values(this.state.claims).find((v) => v.claimId === claimId);
    if (!claim || claim.kind !== kind) return { status: 409, data: { error: "claim_not_found" } };
    if (claim.status === "completed") return { status: 200, data: claim };
    if (claim.status === "failed") return { status: 409, data: { error: "claim_terminal_failed" } };
    const claimAmount = BigInt(claim.amountCents) === 0n ? 0 : checkedStripeAmount(claim.amountCents);
    claim.status = "completed"; claim.state = "completed"; claim.providerReference = providerReference ?? claim.providerReference;
    const item = this.state.requests[claim.requestId];
    if (kind === "deposit" || kind === "balance") this.state.payments.push({ id: `pay_${++this.state.sequence}`, requestId: claim.requestId, kind, status: "pending", amountCents: claimAmount, providerReference: claim.providerReference!, clientSecret: String(detail.clientSecret ?? ""), createdAt: context.now });
    if (kind === "payment_succeeded") {
      const payment = this.state.payments.find((p) => p.providerReference === claim.providerReference)!;
      payment.status = "succeeded";
      if (payment.kind === "deposit") { const q = Object.values(this.state.quotes).find((v) => v.requestId === claim.requestId)!; const job: Job = { requestId: claim.requestId, quoteId: q.id, providerId: q.providerId, depositCents: payment.amountCents, settlementState: "none", authorizationVersion: 0, providerEligible: true }; job.feeSnapshot = snapshotFee(this.state, job, q.amountCents, context.now); this.state.jobs[claim.requestId] = job; item.status = "funded"; }
    }
    if (kind === "settlement") {
      this.state.payments.push({ id: `pay_${++this.state.sequence}`, requestId: claim.requestId, kind: "transfer", status: "succeeded", amountCents: claimAmount, providerReference: claim.providerReference!, createdAt: context.now });
      const job = this.state.jobs[claim.requestId];
      if (job.settlementState === "reconciliation_required") {
        const disputeClaim = Object.values(this.state.claims).filter((v) => v.requestId === claim.requestId && v.kind === "external_dispute").at(-1);
        const args = disputeClaim ? JSON.parse(disputeClaim.fingerprint)[1] as Record<string, unknown> : {};
        const amount = Math.min(Number(args.amount_cents ?? claimAmount), claimAmount);
        const key = `reconcile:${claim.claimId}`;
        const reconciliationClaimId = `claim_${++this.state.sequence}`;
        this.state.claims[key] = { claimId: reconciliationClaimId, kind: "external_dispute", fingerprint: JSON.stringify(["external_dispute", args]), status: "claimed", state: "claimed", amountCents: amount, providerReference: claim.providerReference, providerIdempotencyKey: `reversal:${reconciliationClaimId}`, requestId: claim.requestId, claimedAt: context.now };
      } else {
        job.settlementState = "settled"; job.settledAt = context.now; item.status = "settled";
      }
      job.authorizationToken = undefined;
    }
    if (kind === "refund") { const references = detail.refunds as Array<{ paymentId: string; refundId: string; amountCents: number }> | undefined; for (const allocation of claim.allocations ?? []) { const result = references?.find((v) => v.paymentId === allocation.paymentId); this.state.payments.push({ id: `pay_${++this.state.sequence}`, requestId: claim.requestId, kind: "refund", status: "succeeded", amountCents: allocation.amountCents, providerReference: result?.refundId ?? providerReference!, sourcePaymentId: allocation.paymentId, createdAt: context.now }); } }
    if (kind === "external_dispute") {
      const args = JSON.parse(claim.fingerprint)[1] as Record<string, unknown>;
      const externalId = String(args.external_id); const lifecycle = String(args.lifecycle) as Dispute["status"];
      let value = Object.values(this.state.disputes).find((v) => v.externalId === externalId);
      if (!value) { const id = `dispute_${++this.state.sequence}`; value = this.state.disputes[id] = { id, requestId: claim.requestId, source: "external", externalId, reason: String(args.reason), status: lifecycle, createdAt: context.now, objectVersion: 1 }; }
      else { value.status = lifecycle; value.reason = String(args.reason); value.updatedAt = context.now; value.objectVersion = (value.objectVersion ?? 1) + 1; }
      const job = this.state.jobs[claim.requestId]; job.authorizationVersion += 1; job.authorizationToken = undefined; job.feeSnapshot = undefined;
      if (claimAmount > 0 && providerReference) { this.state.payments.push({ id: `pay_${++this.state.sequence}`, requestId: claim.requestId, kind: "reversal", status: "succeeded", amountCents: claimAmount, providerReference, createdAt: context.now }); job.settlementState = claimAmount < (this.state.payments.find((p) => p.kind === "transfer" && p.requestId === claim.requestId)?.amountCents ?? 0) ? "manual_action" : "reversed"; }
      if (lifecycle === "won") job.settlementState = this.state.payments.some((p) => p.requestId === claim.requestId && p.kind === "reversal") ? "manual_action" : "none";
      if (lifecycle === "won") {
        const reversed = this.state.payments.filter((p) => p.requestId === claim.requestId && p.kind === "reversal").reduce((n, p) => n + p.amountCents, 0);
        if (reversed > 0 && job.providerEligible) {
          const key = `recovery:${externalId}:${job.authorizationVersion}`;
          this.state.claims[key] = { claimId: key, kind: "recovery", fingerprint: JSON.stringify(["recovery", { external_id: externalId }]), status: "claimed", state: "claimed", amountCents: reversed, destinationAccount: `acct_${job.providerId}`, providerIdempotencyKey: key, requestId: claim.requestId, claimedAt: context.now };
          job.settlementState = "reconciliation_required";
        }
      }
      if (lifecycle === "lost" && job.settlementState === "manual_action") {
        const transfer = this.state.payments.find((p) => p.requestId === claim.requestId && p.kind === "transfer")?.amountCents ?? 0;
        const reversed = this.state.payments.filter((p) => p.requestId === claim.requestId && p.kind === "reversal").reduce((n, p) => n + p.amountCents, 0);
        const outstanding = Math.max(0, Number(args.amount_cents ?? transfer) - reversed);
        if (outstanding) this.state.receivables.push({ id: `recv_${++this.state.sequence}`, requestId: claim.requestId, disputeId: externalId, amountCents: outstanding, status: "open", reason: "partial_dispute_recovery", createdAt: context.now });
      }
    }
    if (kind === "recovery") { this.state.payments.push({ id: `pay_${++this.state.sequence}`, requestId: claim.requestId, kind: "transfer", status: "succeeded", amountCents: claimAmount, providerReference: claim.providerReference!, createdAt: context.now }); this.state.jobs[claim.requestId].settlementState = "settled"; }
    return { status: kind === "deposit" || kind === "balance" ? 202 : 201, data: { ...claim, clientSecret: detail.clientSecret } };
  }
  async observeMoneyProviderStatus(kind: MoneyKind, claimId: string, providerReference: string, providerStatus: string, context: CommandContext, detail: Record<string, unknown> = {}) {
    const claim = Object.values(this.state.claims).find((value) => value.claimId === claimId);
    if (!claim || claim.kind !== kind || claim.providerReference !== providerReference) throw new Error("persisted_obligation_required");
    const providerEventId = typeof detail.providerEventId === "string" ? detail.providerEventId : undefined;
    if (!this.state.moneyObservations.some((value) => value.claimId === claimId && value.providerStatus === providerStatus && value.providerEventId === providerEventId)) {
      this.state.moneyObservations.push({ claimId, kind, providerReference, providerStatus, providerEventId, observedAt: context.now });
    }
  }
  async failMoney(kind: MoneyKind, claimId: string, reason: string) { const claim = Object.values(this.state.claims).find((v) => v.claimId === claimId && v.kind === kind); if (claim) { claim.status = "failed"; claim.failureReason = reason; if (kind === "settlement" && this.state.jobs[claim.requestId].settlementState === "transferring") this.state.jobs[claim.requestId].settlementState = "authorized"; } }
  async stuckMoneyClaims(before: string) { return Object.values(this.state.claims).filter((v) => (v.status === "claimed" || v.status === "failed") && (v.claimedAt ?? "") < before).map((v) => ({ ...v, state: "claimed" as const })); }
  inspect<T>(reader: (state: Readonly<RepositoryState>) => T) { return reader(this.state); }
}

const RPC: Record<Command, string> = { create_request:"create_service_request",confirm_intake:"confirm_intake",match_request:"operator_match_request",provider_slot:"operator_add_provider_slot",provider_eligibility:"operator_update_provider_eligibility",submit_quote:"submit_quote",start_job:"start_assigned_job",submit_evidence:"submit_job_evidence",propose_change:"propose_change_order",approve_change:"approve_change_order",complete_job:"complete_assigned_job",open_internal_dispute:"open_internal_dispute",resolve_dispute:"operator_resolve_dispute",settlement_preflight:"operator_settlement_preflight",privacy_consent:"record_privacy_consent",privacy_delete:"request_privacy_deletion",request_details:"update_request_details",message_create:"create_request_message",schedule_upsert:"upsert_request_schedule",review_create:"create_provider_review",recovery_list:"operator_recovery_list",receivable_resolve:"operator_resolve_receivable" };
export class SupabaseRepository implements Repository {
  private service: SupabaseClient;
  constructor(private url: string, private anonKey: string, serviceKey: string) { this.service = createClient(url, serviceKey, { auth: { persistSession: false } }); }
  private user(token: string) { return createClient(this.url, this.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }); }
  async expandStaleQuoteRequests(now:string) {
    const expansion=await this.service.rpc("expand_stale_quote_requests",{p_now:now});
    if(expansion.error)throw expansion.error;
  }
  async dashboard(actor: Actor, token: string) {
    const client=this.user(token);
    const names=["service_requests","request_matches","quotes","quote_ranking_snapshots","change_orders","jobs","disputes","evidence","request_media","request_messages","request_schedules","reviews","privacy_consents","deletion_requests"] as const;
    const values=await Promise.all(names.map(name=>client.from(name).select("*")));
    const error=values.find(value=>value.error)?.error;if(error)throw error;
    const [requests,matches,quotes,rankingSnapshots,changes,jobs,disputes,evidence,media,messages,schedules,reviews,consents,deletions]=values.map(value=>value.data as Record<string,unknown>[]);
    const requestIds=new Set(requests.map(value=>String(value.id))), providerIds=(id:unknown)=>matches.filter(value=>value.request_id===id).map(value=>value.provider_id);
    let payments:Record<string,unknown>[]=[],audit:Record<string,unknown>[]=[],receivables:Record<string,unknown>[]=[],recoveryClaims:Record<string,unknown>[]=[];
    if(actor.role==="operator"&&requestIds.size){
      const allowed=[...requestIds];
      const scoped=await Promise.all([this.service.from("payments").select("*").in("request_id",allowed),this.service.from("audit_events").select("*").in("request_id",allowed),this.service.from("receivables").select("*").in("request_id",allowed),this.service.from("money_operations").select("*").eq("kind","recovery").in("request_id",allowed)]);
      const scopedError=scoped.find(value=>value.error)?.error;if(scopedError)throw scopedError;
      [payments,audit,receivables,recoveryClaims]=scoped.map(value=>value.data as Record<string,unknown>[]);
    }
    const rankByQuote=new Map(rankingSnapshots.map(value=>[String(value.quote_id),value]));
    return {
      requests:requests.map(v=>({id:v.id,customerId:v.customer_id,customerName:"",description:v.description,address:v.service_address,safetyStatus:v.safety_status,hazardReason:v.hazard_reason,status:v.workflow_status,providerIds:providerIds(v.id),expandedSearch:v.expanded_search,workScopeSnapshot:v.work_scope_snapshot,triageSnapshot:v.triage,priceDisclosure:v.price_disclosure,myMatchStatus:actor.role==="provider"?String(matches.find(value=>value.request_id===v.id&&value.provider_id===actor.id)?.status??"")||undefined:undefined,createdAt:v.created_at})),
      quotes:quotes.map(v=>{const snapshot=rankByQuote.get(String(v.id));const submitted=(v.ranking??{}) as Quote["ranking"];const ranking:Quote["ranking"]={...submitted,licenseVerified:submitted.licenseVerified??Boolean(snapshot?.license_verified),insuranceVerified:submitted.insuranceVerified??Boolean(snapshot?.insurance_verified),rating:submitted.rating??(snapshot?.rating!=null?Number(snapshot.rating):undefined),distanceMiles:submitted.distanceMiles??(snapshot?.distance_miles!=null?Number(snapshot.distance_miles):undefined),responseMinutes:submitted.responseMinutes??(snapshot?.response_minutes!=null?Number(snapshot.response_minutes):undefined),languages:submitted.languages??(snapshot?.languages as string[]|undefined),earliestStartAt:submitted.earliestStartAt??String(snapshot?.schedule_at??"")};return{id:String(v.id),requestId:String(v.request_id),providerId:String(v.provider_id),providerName:String(v.provider_name??"Provider"),scope:String(v.scope),amountCents:Number(v.amount_cents),ranking,rankingScore:Number(snapshot?.score??0),rankingPolicyVersion:Number(snapshot?.policy_version??0),explorationSelected:Boolean(snapshot?.exploration_selected),createdAt:String(v.created_at)}}).sort((a,b)=>compositeQuoteScore(b)-compositeQuoteScore(a)||a.id.localeCompare(b.id)),
      changes:changes.map(v=>({id:v.id,requestId:v.request_id,description:v.description,amountCents:Number(v.amount_cents),items:v.items,evidenceIds:v.evidence_ids,approvedAt:v.approved_at,createdAt:v.created_at})),jobs:jobs.map(v=>({requestId:v.request_id,quoteId:v.quote_id??v.accepted_quote_snapshot_id,depositCents:Number(v.deposit_cents),providerId:v.provider_id,completedAt:v.completed_at,settledAt:v.settled_at,settlementState:v.settlement_state,authorizationVersion:v.authorization_version,feeSnapshot:v.fee_snapshot})),disputes:disputes.map(v=>({...v,requestId:v.request_id})),evidence:evidence.map(v=>({id:v.id,requestId:v.request_id,providerId:v.submitted_by,kind:v.kind,note:v.storage_path,createdAt:v.created_at})),
      media:media.filter(v=>requestIds.has(String(v.request_id))).map(v=>({id:v.id,requestId:v.request_id,ownerId:v.owner_id,fileName:v.file_name,contentType:v.content_type,sizeBytes:Number(v.size_bytes),objectPath:v.object_path,sanitizedObjectPath:v.sanitized_object_path,uploadStatus:v.upload_status,status:v.sanitization_status,private:v.is_private,exifRemovalStatus:v.exif_removal_status,retryCount:Number(v.retry_count),checksum:v.checksum,privacyDeletionId:v.privacy_deletion_id,createdAt:v.created_at})),messages:messages.filter(v=>requestIds.has(String(v.request_id))).map(v=>({id:v.id,requestId:v.request_id,senderId:v.sender_id,text:v.body,createdAt:v.created_at})),schedules:schedules.filter(v=>requestIds.has(String(v.request_id))).map(v=>({requestId:v.request_id,startsAt:v.starts_at,timeZone:v.time_zone,status:v.status})),reviews:reviews.filter(v=>requestIds.has(String(v.request_id))).map(v=>({id:v.id,requestId:v.request_id,customerId:v.customer_id,providerId:v.provider_id,rating:Number(v.rating),text:v.body,createdAt:v.created_at})),privacy:{consents:consents.map(v=>({actorId:v.profile_id,consentVersion:v.version,consentedAt:v.accepted_at})),deletions:deletions.map(v=>({id:v.id,actorId:v.profile_id,status:v.status,requestedAt:v.requested_at}))},receivables:receivables.map(v=>({id:v.id,requestId:v.request_id,disputeId:v.external_dispute_id,amountCents:Number(v.amount_cents),status:v.status,reason:v.reason,createdAt:v.created_at})),recoveryClaims:recoveryClaims.map(v=>({claimId:v.id,requestId:v.request_id,state:v.state,amountCents:Number(v.amount_cents),claimedAt:v.claimed_at})),payments,audit:audit.map(v=>({id:v.id,actorId:v.actor_id??v.actor,action:v.action,resourceType:v.resource_type,resourceId:v.resource_id,rationale:v.rationale,correlationId:v.correlation_id,requestId:v.request_id,detail:v.detail,at:v.created_at}))
    };
  }
  async execute(command: Command, args: Record<string, unknown>, context: CommandContext, _implementation: (state: RepositoryState) => Result) {
    const mappings: Record<Command, Record<string, unknown>> = {
      create_request: { p_customer_name: args.customerName, p_description: args.description, p_address: args.address, p_hazards: args.hazards },
      confirm_intake: { p_customer_id:context.actor.id,p_customer_name:args.customerName,p_address:args.address,p_description:args.description,p_category:args.category,p_work_scope:args.workScope,p_triage:args.triage,p_price_disclosure:args.priceDisclosure,p_assessment_id:args.assessmentId },
      match_request: { p_request_id: args.request_id, p_provider_ids: args.providerIds },
      provider_slot:{p_request_id:args.request_id,p_provider_id:args.providerId},
      provider_eligibility:{p_provider_id:args.providerId,p_status:args.status,p_organization_name:args.organizationName,p_license_verified:args.licenseVerified,p_license_expires_at:args.licenseExpiresAt,p_insurance_verified:args.insuranceVerified,p_insurance_expires_at:args.insuranceExpiresAt,p_service_categories:args.serviceCategories,p_service_areas:args.serviceAreas},
      submit_quote: { p_request_id: args.request_id, p_provider_name: args.providerName, p_scope: args.scope, p_amount_cents: String(args.amountCents),p_ranking:args.ranking },
      start_job: { p_request_id: args.request_id },
      submit_evidence: { p_request_id: args.request_id, p_kind: args.kind, p_note: args.note },
      propose_change: { p_request_id: args.request_id, p_description: args.description, p_amount_cents: String(args.amountCents),p_items:args.items,p_evidence_ids:args.evidenceIds },
      approve_change: { p_change_id: args.change_id },
      complete_job: { p_request_id: args.request_id },
      open_internal_dispute: { p_request_id: args.request_id, p_source: args.source, p_reason: args.reason },
      resolve_dispute: { p_dispute_id: args.dispute_id },
      settlement_preflight: { p_request_id: args.request_id }
      ,privacy_consent: { p_version: args.version },
      privacy_delete: {},
      request_details: { p_request_id: args.request_id, p_work_scope: args.workScope, p_triage: args.triage, p_price_disclosure: args.priceDisclosure },
      message_create: { p_request_id: args.request_id, p_text: args.text },
      schedule_upsert: { p_request_id: args.request_id, p_starts_at: args.startsAt, p_time_zone: args.timeZone, p_status: args.status },
      review_create: { p_request_id: args.request_id, p_rating: args.rating, p_text: args.text },
      recovery_list: {},
      receivable_resolve: { p_receivable_id: args.receivable_id }
    };
    if(command==="confirm_intake"&&context.actor.role!=="customer")return{status:403,data:{error:"customer_required"}};
    const response = await (command==="confirm_intake"?this.service:this.user(context.accessToken)).rpc(RPC[command], mappings[command]);
    if(response.error)return { status: response.error.code === "42501" ? 403 : 409, data: { error: response.error.message } };
    const row=response.data as Record<string,unknown>;
    if(command==="confirm_intake")return{status:201,data:{requestId:row.requestId,status:row.status,matchCount:Number(row.matchCount)}};
    if(command==="request_details")return{status:200,data:{workScope:row.work_scope_snapshot,triage:row.triage,priceDisclosure:row.price_disclosure}};
    if(command==="settlement_preflight")return{status:200,data:{authorizationToken:row.authorization_token,authorizationVersion:Number(row.authorization_version),feeVersion:Number(row.fee_version),feeRateBps:Number(row.fee_rate_bps),feeAmountCents:Number(row.fee_amount_cents),approvedChangeCents:Number(row.approved_change_cents),capturedAmountCents:Number(row.captured_amount_cents)}};
    const created:Command[]=["privacy_consent","message_create","review_create","provider_slot"];
    return { status:command==="privacy_delete"?202:created.includes(command)?201:200, data: response.data };
  }
  async claimMoney(kind: MoneyKind, args: Record<string, unknown>, context: CommandContext) { const client = kind === "deposit" || kind === "balance" ? this.user(context.accessToken) : this.service; const prefixed = Object.fromEntries(Object.entries(args).map(([key, value]) => [`p_${key}`, typeof value === "number" && key.includes("cents") ? String(value) : value])); const response = await client.rpc(`${kind}_claim`, { ...prefixed, p_idempotency_key: context.idempotencyKey }); if (response.error) throw new Error(response.error.message); const v = response.data as Record<string, unknown>, amountCentsDecimal = String(v.amount_cents); return { claimId: String(v.claim_id), state: v.claim_state as MoneyClaim["state"], amountCents: BigInt(amountCentsDecimal) === 0n ? 0 : checkedStripeAmount(amountCentsDecimal), amountCentsDecimal, destinationAccount: v.destination_account as string | undefined, providerReference: v.provider_reference as string | undefined, providerIdempotencyKey: v.provider_idempotency_key as string | undefined, requestId: String(v.request_id), allocations: v.allocations as RefundAllocation[] | undefined, claimedAt: v.claimed_at as string | undefined }; }
  async resumeCustomerPayment(kind: CustomerPaymentKind, claimId: string, context: CommandContext): Promise<Result> {
    if (!context.idempotencyKey) return { status: 409, data: { error: "claim_not_found" } };
    const client = this.user(context.accessToken);
    const attempt = await client.from("payment_attempts").select("request_id,provider_reference,client_secret,idempotency_key").eq("idempotency_key", context.idempotencyKey).eq("kind", kind).eq("state", "pending").maybeSingle();
    if (attempt.error || !attempt.data?.client_secret) return { status: 409, data: { error: "pending_payment_not_found" } };
    const owned = await client.from("service_requests").select("id").eq("id", attempt.data.request_id).eq("customer_id", context.actor.id).maybeSingle();
    if (owned.error || !owned.data) return { status: 403, data: { error: "forbidden" } };
    const claim = await this.service.from("money_operations").select("id").eq("id", claimId).eq("request_id", attempt.data.request_id).eq("idempotency_key", attempt.data.idempotency_key).eq("kind", kind).eq("state", "completed").maybeSingle();
    if (claim.error || !claim.data) return { status: 409, data: { error: "claim_not_found" } };
    return { status: 202, data: { clientSecret: String(attempt.data.client_secret), providerReference: String(attempt.data.provider_reference) } };
  }
  async completeMoney(kind: MoneyKind, claimId: string, providerReference: string | undefined, _context: CommandContext, detail: Record<string, unknown> = {}) {
    const response = await this.service.rpc(`${kind}_complete`, { p_claim_id: claimId, p_provider_reference: providerReference ?? null, p_detail: detail });
    if (response.error) return { status: 409, data: { error: response.error.message } };
    const row = response.data as Record<string, unknown>;
    const data = kind === "deposit" || kind === "balance"
      ? { ...row, providerReference: row.provider_reference, clientSecret: row.clientSecret ?? row.client_secret }
      : row;
    return { status: kind === "deposit" || kind === "balance" ? 202 : 201, data };
  }
  async observeMoneyProviderStatus(kind: MoneyKind, claimId: string, providerReference: string, providerStatus: string, _context: CommandContext, detail: Record<string, unknown> = {}) {
    const response = await this.service.rpc("observe_money_provider_status", {
      p_claim_id: claimId,
      p_kind: kind,
      p_provider_reference: providerReference,
      p_provider_status: providerStatus,
      p_provider_event_id: typeof detail.providerEventId === "string" ? detail.providerEventId : "",
    });
    if (response.error) throw new Error(response.error.message);
  }
  async failMoney(kind: MoneyKind, claimId: string, reason: string) { const response = await this.service.rpc(`${kind}_fail`, { p_claim_id: claimId, p_failure_reason: reason }); if (response.error) throw new Error(response.error.message); }
  async stuckMoneyClaims(before: string) { const response = await this.service.rpc("stuck_money_claims", { p_before_at: before }); if (response.error) throw new Error(response.error.message); return (response.data as Array<Record<string, unknown>>).map((v) => { const amountCentsDecimal=String(v.amount_cents); return { ...v, amountCents: BigInt(amountCentsDecimal)===0n?0:checkedStripeAmount(amountCentsDecimal), amountCentsDecimal, claimId: String(v.claim_id), requestId: String(v.request_id), providerIdempotencyKey: v.provider_idempotency_key as string | undefined }; }) as Array<MoneyClaim & { kind: MoneyKind }>; }
}
export function createProductionRepository(env: NodeJS.ProcessEnv = process.env): Repository { const url = env.SUPABASE_URL, anon = env.SUPABASE_ANON_KEY, service = env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !anon || !service) throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required; production never falls back to memory"); return new SupabaseRepository(url.replace(/\/$/, ""), anon, service); }
