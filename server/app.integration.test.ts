/**
 * Supabase 로컬 스택 대상 API 통합 테스트. 자격증명 없으면 스킵.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`test:integration requires ${name}`);
  return value;
};

const url = required("SUPABASE_TEST_URL");
const anonKey = required("SUPABASE_TEST_ANON_KEY");
const serviceKey = required("SUPABASE_TEST_SERVICE_ROLE_KEY");
const apiUrl = required("INTEGRATION_API_URL");
const customerToken = required("SUPABASE_TEST_CUSTOMER_TOKEN");
const providerToken = required("SUPABASE_TEST_PROVIDER_TOKEN");
const operatorToken = required("SUPABASE_TEST_OPERATOR_TOKEN");
const stripeFixtureUrl=required("INTEGRATION_STRIPE_FIXTURE_URL");
const stripeFixtureSecret=required("INTEGRATION_STRIPE_FIXTURE_SECRET");
const customerId=JSON.parse(Buffer.from(customerToken.split(".")[1],"base64url").toString("utf8")).sub as string;
const providerId=JSON.parse(Buffer.from(providerToken.split(".")[1],"base64url").toString("utf8")).sub as string;
const operatorId=JSON.parse(Buffer.from(operatorToken.split(".")[1],"base64url").toString("utf8")).sub as string;
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const expectOk = <T>(value: { data: T; error: { message: string } | null }) => {
  if (value.error) throw new Error(value.error.message);
  return value.data;
};
const requireRow=<T>(value:T,message:string):NonNullable<T>=>{if(value===null||value===undefined)throw new Error(message);return value};

describe.sequential("production Supabase money contract", () => {
  it("uses the actual authenticated API, never a route mock", async () => {
    expectOk(await service.from("profiles").upsert({
      id: customerId,
      role: "customer",
      display_name: "integration customer",
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
      founder_eligible: false,
      license_verified: false,
      insurance_verified: false,
      service_categories: [],
      service_areas: [],
    }));
    const health=await fetch(`${apiUrl}/api/health`,{headers:{Authorization:`Bearer ${customerToken}`}});
    expect(health.ok).toBe(true);
    const consent=await fetch(`${apiUrl}/api/privacy/consent`,{method:"POST",headers:{Authorization:`Bearer ${customerToken}`,"Content-Type":"application/json"},body:JSON.stringify({version:`integration-${randomUUID()}`,accepted:true})});
    expect(consent.ok).toBe(true);
  });
  it("has one prefixed RPC signature, grants, forced RLS, and webhook/recovery schema", () => {
    const sql = readFileSync("supabase/migrations/0001_mvp.sql", "utf8");
    for (const name of ["settlement_claim", "settlement_complete", "recovery_complete", "recovery_fail"])
      expect(sql.match(new RegExp(`create (?:or replace )?function ${name}\\(`, "g"))).toHaveLength(1);
    expect(sql).toMatch(/settlement_claim\(p_request_id uuid,p_authorization_token uuid/);
    expect(sql).toMatch(/grant execute on function [^;]*recovery_complete\(uuid,text,jsonb\),recovery_fail\(uuid,text\) to service_role/);
    expect(sql).toMatch(/money_operations force row level security/);
    expect(sql).toMatch(/stripe_webhook_events/);
    expect(sql).not.toContain("deposit_succeeded_claim");
  });

  it("runs the structured booking and money lifecycle through the actual API",async()=>{
    const auth=(token:string)=>({Authorization:`Bearer ${token}`,"Content-Type":"application/json"});
    const call=async(path:string,token:string,method:string,data?:unknown,key?:string)=>{const response=await fetch(`${apiUrl}${path}`,{method,headers:{...auth(token),...(key?{"Idempotency-Key":key}:{})},body:data===undefined?undefined:JSON.stringify(data)});if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);return response.json()};
    expectOk(await service.from("profiles").upsert([
      { id: customerId, role: "customer", display_name: "API customer", stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, founder_eligible: false, license_verified: false, insurance_verified: false, service_categories: [], service_areas: [] },
      { id: providerId, role: "provider", display_name: "API provider", provider_status: "approved", license_verified: true, license_expires_at: "2030-01-01T00:00:00Z", insurance_verified: true, insurance_expires_at: "2030-01-01T00:00:00Z", service_categories: ["general"], service_areas: ["Charlotte"], stripe_account_id: `acct_${providerId.replaceAll("-", "")}`, stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true, founder_eligible: false },
      { id: operatorId, role: "operator", display_name: "API operator", stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, founder_eligible: false, license_verified: false, insurance_verified: false, service_categories: [], service_areas: [] },
    ]));
    expectOk(await service.from("operator_allowlist").upsert({user_id:operatorId}));
    expectOk(await service.from("fee_policies").upsert({ version: 1, effective_from: "2000-01-01T00:00:00Z", founder_only: false, fee_rate_bps: 1000, tax_rate_bps: 0, stripe_fee_treatment: "included", refund_treatment: "fee_retained", rounding: "half_up" }, { onConflict: "version,founder_only" }));
    const created=await call("/api/requests",customerToken,"POST",{customerName:"Integration Customer",description:"Structured plumbing repair request",address:"Charlotte",hazards:["none"]});
    const requestId=created.id as string;
    const details=await call(`/api/requests/${requestId}/details`,customerToken,"POST",{workScope:{symptom:"Leaking drain trap",location:"Kitchen sink",dimensions:"1.5 inch",access:"Open cabinet",desiredTime:"2026-09-08T14:00:00Z",photos:[],exclusions:["Cabinet replacement"]},triage:{category:"plumbing",urgency:"routine",possibleCauses:["Loose trap"],confidence:.8,questions:["When did it start?"],hazards:[]},priceDisclosure:{source:"regional_completed_jobs",sampleCount:12,updatedAt:"2026-09-05T00:00:00Z",confidence:.5,priceCents:10000}});
    expect(details.priceDisclosure.priceCents).toBeUndefined();
    const overwrite=await fetch(`${apiUrl}/api/requests/${requestId}/details`,{method:"POST",headers:auth(customerToken),body:JSON.stringify({workScope:{symptom:"Overwrite attempt",location:"Kitchen",dimensions:"x",access:"x",desiredTime:"2026-09-08T14:00:00Z",photos:[],exclusions:[]},triage:{category:"plumbing",urgency:"routine",possibleCauses:["x"],confidence:.5,questions:[],hazards:[]},priceDisclosure:{source:"x",sampleCount:30,updatedAt:"2026-09-05T00:00:00Z",confidence:.5,priceCents:1}})});expect(overwrite.status).toBe(409);
    await call("/api/privacy/deletion",customerToken,"POST",{});
    for (const [path, token, method] of [
      [`/api/requests/${requestId}/media`, customerToken, "POST"],
      ["/api/media/retired/upload-url", customerToken, "POST"],
      ["/api/media/retired/complete", customerToken, "POST"],
      ["/api/media/retired/sanitization", operatorToken, "PATCH"],
    ] as const) {
      const retired=await fetch(`${apiUrl}${path}`,{method,headers:auth(token),body:"{}"});
      expect(retired.status,path).toBe(404);
    }
    const storedDetails=expectOk(await service.from("service_requests").select("work_scope_snapshot,triage,price_disclosure").eq("id",requestId).single());if(!storedDetails)throw new Error("structured request details missing");expect(storedDetails.work_scope_snapshot).toMatchObject({symptom:"Leaking drain trap",location:"Kitchen sink"});expect(storedDetails.price_disclosure.priceCents).toBeUndefined();
    await call(`/api/requests/${requestId}/match`,operatorToken,"POST",{providerIds:[providerId]});
    await call(`/api/requests/${requestId}/messages`,customerToken,"POST",{text:"Integration persisted message"});
    await call(`/api/requests/${requestId}/schedule`,customerToken,"PUT",{startsAt:"2026-09-08T14:00:00Z",timeZone:"America/New_York",status:"confirmed"});
    const quote=await call(`/api/requests/${requestId}/quotes`,providerToken,"POST",{providerName:"API provider",scope:"Replace trap and test drain",amountCents:10000,ranking:{totalCents:10000,earliestStartAt:"2026-09-08T14:00:00Z",warrantyDays:90,licenseVerified:true,insuranceVerified:true,rating:0,distanceMiles:4,responseMinutes:5,languages:["en"]}});
    const deposit=await call(`/api/requests/${requestId}/deposit`,customerToken,"POST",{quoteId:quote.id},`deposit:${requestId}`);
    const confirm=async(kind:string,reference:string)=>{const r=await fetch(stripeFixtureUrl,{method:"POST",headers:{"x-fixture-secret":stripeFixtureSecret,"Content-Type":"application/json"},body:JSON.stringify({kind,requestId,providerReference:reference})});if(!r.ok)throw new Error(`Stripe fixture failed: ${r.status} ${await r.text()}`)};
    await confirm("deposit",deposit.providerReference);
    await call(`/api/requests/${requestId}/start`,providerToken,"POST",{});
    const before=await call(`/api/requests/${requestId}/evidence`,providerToken,"POST",{kind:"before",note:"Before evidence"});
    await call(`/api/requests/${requestId}/evidence`,providerToken,"POST",{kind:"after",note:"After evidence"});
    const change=await call(`/api/requests/${requestId}/changes`,providerToken,"POST",{description:"Replace damaged coupling",amountCents:1000,items:[{description:"Coupling",quantity:1,unitCents:1000}],evidenceIds:[before.id]});
    await call(`/api/changes/${change.id}/approve`,customerToken,"POST",{});
    await call(`/api/requests/${requestId}/complete`,providerToken,"POST",{});
    const balance=await call(`/api/requests/${requestId}/balance`,customerToken,"POST",{},`balance:${requestId}`);await confirm("balance",balance.providerReference);
    const staleAuthorizationToken=randomUUID();
    expectOk(await service.from("jobs").update({completed_at:"2000-01-01T00:00:00Z",authorization_token:staleAuthorizationToken}).eq("request_id",requestId));
    const beforeDispute=requireRow(expectOk(await service.from("jobs").select("authorization_version").eq("request_id",requestId).single()),"completed job missing before dispute");
    expectOk(await service.from("settlement_authorizations").insert({request_id:requestId,quote_cents:"10000",approved_change_cents:"1000",deposit_cents:"2000",authorized_by:operatorId,authorization_version:beforeDispute.authorization_version,authorization_token:staleAuthorizationToken}));
    expectOk(await service.from("jobs").update({completed_at:new Date().toISOString()}).eq("request_id",requestId));
    expect(requireRow(expectOk(await service.from("settlement_authorizations").select("request_id").eq("request_id",requestId).single()),"preflight authorization missing").request_id).toBe(requestId);
    const internalDispute=await call(`/api/requests/${requestId}/disputes`,customerToken,"POST",{source:"internal",reason:"Integration completion quality dispute"});
    const heldJob=requireRow(expectOk(await service.from("jobs").select("dispute_status,authorization_version,authorization_token").eq("request_id",requestId).single()),"held job missing");
    expect(internalDispute).toMatchObject({request_id:requestId,source:"internal",status:"open"});
    expect(heldJob).toMatchObject({dispute_status:"open",authorization_token:null});
    expect(Number(heldJob.authorization_version)).toBe(Number(beforeDispute.authorization_version)+1);
    expect(requireRow(expectOk(await service.from("disputes").select("source,status,external_version").eq("id",internalDispute.id).single()),"internal dispute row missing")).toMatchObject({source:"internal",status:"open",external_version:0});
    expect(requireRow(expectOk(await service.from("settlement_authorizations").select("request_id").eq("request_id",requestId)),"authorization query failed")).toHaveLength(0);
    await call(`/api/disputes/${internalDispute.id}/resolve`,operatorToken,"POST",{});
    const resolvedInternal=requireRow(expectOk(await service.from("disputes").select("status,resolved_at").eq("id",internalDispute.id).single()),"resolved internal dispute missing");
    const resolvedJob=requireRow(expectOk(await service.from("jobs").select("dispute_status,authorization_version,authorization_token").eq("request_id",requestId).single()),"resolved job missing");
    expect(resolvedInternal.status).toBe("resolved");expect(resolvedInternal.resolved_at).toBeTruthy();
    expect(resolvedJob).toMatchObject({dispute_status:"resolved",authorization_token:null});
    expect(Number(resolvedJob.authorization_version)).toBe(Number(heldJob.authorization_version)+1);
    expectOk(await service.from("jobs").update({completed_at:"2000-01-01T00:00:00Z"}).eq("request_id",requestId));
    const preflight=await call(`/api/requests/${requestId}/settlement-preflight`,operatorToken,"POST",{});
    await call(`/api/requests/${requestId}/settle`,operatorToken,"POST",preflight,`settle:${requestId}`);
    const final=expectOk(await service.from("jobs").select("settlement_state,work_status,payment_status").eq("request_id",requestId).single());
    expect(final).toMatchObject({settlement_state:"settled",work_status:"settled",payment_status:"paid"});
    await call(`/api/requests/${requestId}/reviews`,customerToken,"POST",{rating:5,text:"Integration completed work review"});
    const ranking=requireRow(expectOk(await service.from("quote_ranking_snapshots").select("*").eq("quote_id",quote.id).single()),"ranking snapshot missing");expect(ranking).toMatchObject({policy_version:1,license_verified:true,insurance_verified:true,price_cents:10000,distance_miles:4,response_minutes:5,languages:["en"]});expect(Number(ranking.score)).toBeGreaterThan(0);expect(typeof ranking.exploration_selected).toBe("boolean");
    await call(`/api/requests/${requestId}/refunds`,operatorToken,"POST",{amountCents:500,reason:"Integration partial refund"},`refund:${requestId}`);
    expect(Number(requireRow(expectOk(await service.from("payments").select("amount_cents").eq("request_id",requestId).eq("kind","refund").single()),"refund ledger row missing").amount_cents)).toBe(500);
    const disputeId=`dp_${requestId.replaceAll("-","")}`;
    const disputeEvent=async(eventType:string,status:string,eventId:string)=>{const r=await fetch(stripeFixtureUrl,{method:"POST",headers:{"x-fixture-secret":stripeFixtureSecret,"Content-Type":"application/json"},body:JSON.stringify({kind:"dispute",requestId,externalId:disputeId,eventId,eventType,status,amountCents:1000})});if(!r.ok)throw new Error(`Dispute fixture failed: ${r.status} ${await r.text()}`)};
    await disputeEvent("charge.dispute.created","needs_response",`evt_dp_created_${requestId}`);
    await disputeEvent("charge.dispute.updated","under_review",`evt_dp_updated_${requestId}`);
    await disputeEvent("charge.dispute.closed","won",`evt_dp_closed_${requestId}`);
    const disputeRow=requireRow(expectOk(await service.from("disputes").select("status,external_version").eq("external_id",disputeId).single()),"dispute lifecycle row missing");expect(disputeRow).toMatchObject({status:"won",external_version:3});
    expect(Number(requireRow(expectOk(await service.from("payments").select("amount_cents").eq("request_id",requestId).eq("kind","reversal").single()),"reversal ledger row missing").amount_cents)).toBe(1000);
    const recovery=requireRow(expectOk(await service.from("money_operations").select("id,state,amount_cents").eq("request_id",requestId).eq("kind","recovery").single()),"recovery claim missing");expect(Number(recovery.amount_cents)).toBe(1000);
    expectOk(await service.rpc("recovery_complete",{p_claim_id:recovery.id,p_provider_reference:`tr_recovery_${requestId}`,p_detail:{}}));
    expect(requireRow(expectOk(await service.from("money_operations").select("state").eq("id",recovery.id).single()),"completed recovery missing").state).toBe("completed");
    const dashboard=await call("/api/dashboard",operatorToken,"GET");expect(dashboard.messages.some((value:{text:string})=>value.text==="Integration persisted message")).toBe(true);expect(dashboard.schedules.some((value:{status:string})=>value.status==="confirmed")).toBe(true);expect(dashboard.reviews.some((value:{rating:number})=>value.rating===5)).toBe(true);expect(dashboard.recoveryClaims.some((value:{claimId:string})=>value.claimId===recovery.id)).toBe(true);
    const audits=expectOk(await service.from("audit_events").select("actor_id,actor,action,resource_type,resource_id,rationale,correlation_id,request_id").eq("request_id",requestId))??[];expect(audits.length).toBeGreaterThan(0);expect(audits.every(value=>value.actor&&value.action&&value.resource_type&&value.resource_id&&value.rationale&&value.correlation_id)).toBe(true);expect(audits.some(value=>value.action==="money_operations.insert")).toBe(true);
  },60_000);

  it("enforces quote cardinality, bigint boundary, consumed settlement authorization, recovery, and RLS", async () => {
    const customer = customerId, provider = providerId, requestId = randomUUID(), quoteId = randomUUID(), snapshotId = randomUUID();
    expectOk(await service.from("profiles").upsert([
      { id: customer, role: "customer", display_name: "integration customer", stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, founder_eligible: false, license_verified: false, insurance_verified: false, service_categories: [], service_areas: [] },
      {
        id: provider,
        role: "provider",
        display_name: "integration provider",
        provider_status: "approved",
        organization_name: "Integration Provider",
        license_verified: true,
        license_expires_at: "2099-01-01T00:00:00Z",
        insurance_verified: true,
        insurance_expires_at: "2099-01-01T00:00:00Z",
        service_categories: ["general"],
        service_areas: ["Charlotte"],
        stripe_account_id: `acct_${provider.replaceAll("-", "")}`,
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
        founder_eligible: false,
      },
      { id: operatorId, role: "operator", display_name: "integration operator", stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, founder_eligible: false, license_verified: false, insurance_verified: false, service_categories: [], service_areas: [] }
    ]));
    expectOk(await service.from("operator_allowlist").upsert({user_id:operatorId}));
    expectOk(await service.from("fee_policies").upsert({ version: 1, effective_from: "2000-01-01T00:00:00Z", founder_only: false, fee_rate_bps: 1000, tax_rate_bps: 0, stripe_fee_treatment: "included", refund_treatment: "fee_retained", rounding: "half_up" },{onConflict:"version,founder_only"}));
    expectOk(await service.from("service_requests").insert({ id: requestId, customer_id: customer, description: "integration settlement fixture", service_address: "test", workflow_status: "completed", safety_status: "cleared" }));
    expect(expectOk(await service.rpc("provider_is_eligible", { p_provider_id: provider, p_request_id: requestId }))).toBe(true);
    expectOk(await service.from("quotes").insert({ id: quoteId, request_id: requestId, provider_id: provider, provider_name: "Integration Provider", scope: "integration fixture scope", amount_cents: "10000" }));
    const duplicate = await service.from("quotes").insert({ request_id: requestId, provider_id: provider, provider_name: "Integration Provider", scope: "duplicate", amount_cents: "1" });
    expect(duplicate.error?.message).toMatch(/duplicate|unique/i);
    const overflow = await service.from("quotes").insert({ request_id: requestId, provider_id: randomUUID(), provider_name: "Overflow Provider", scope: "overflow", amount_cents: "100000000" });
    expect(overflow.error?.message).toMatch(/check|amount/i);
    expectOk(await service.from("quote_snapshots").insert({ id: snapshotId, quote_id: quoteId, request_id: requestId, provider_id: provider, scope: "integration fixture scope", amount_cents: "10000" }));
    expectOk(await service.from("jobs").insert({ request_id: requestId, accepted_quote_snapshot_id: snapshotId, work_status: "in_progress", payment_status: "paid", deposit_cents: "2000", settlement_state: "none", authorization_version: "1" }));
    const booking=expectOk(await service.from("booking_fee_snapshots").select("*").eq("request_id",requestId).single());
    expect(booking).toMatchObject({policy_version:1,fee_rate_bps:1000});
    const mutateBooking=await service.from("booking_fee_snapshots").update({fee_rate_bps:999}).eq("request_id",requestId);
    expect(mutateBooking.error?.message).toMatch(/immutable/i);
    const providerClient=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${providerToken}`}},auth:{persistSession:false}});
    const customerClient=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${customerToken}`}},auth:{persistSession:false}});
    const evidence=expectOk(await service.from("evidence").insert({request_id:requestId,submitted_by:provider,kind:"during",storage_path:"integration",sha256:"0".repeat(64)}).select("id").single());
    if(!evidence)throw new Error("evidence insert returned no row");
    const proposed=expectOk(await providerClient.rpc("propose_change_order",{p_request_id:requestId,p_description:"approved integration change",p_amount_cents:"1000",p_items:[{description:"part",quantity:1,unitCents:1000}],p_evidence_ids:[evidence.id]}));
    expectOk(await customerClient.rpc("approve_change_order",{p_change_id:proposed.id}));
    const changeFee=expectOk(await service.from("change_fee_snapshots").select("*").eq("request_id",requestId).single());
    const mutateChangeFee=await service.from("change_fee_snapshots").delete().eq("change_snapshot_id",changeFee.change_snapshot_id);
    expect(mutateChangeFee.error?.message).toMatch(/immutable/i);
    expectOk(await service.from("jobs").update({work_status:"completed",completed_at:"2000-01-01T00:00:00Z"}).eq("request_id",requestId));
    expectOk(await service.from("payments").insert({request_id:requestId,kind:"deposit",status:"succeeded",amount_cents:"2000",provider_reference:`pi_dep_${requestId}`,idempotency_key:`dep:${requestId}`}));
    const balance=expectOk(await customerClient.rpc("balance_claim",{p_request_id:requestId,p_idempotency_key:`balance:${requestId}`}));
    expect(balance.amount_cents).toBe(9000);
    const balanceIntent=`pi_bal_${requestId}`;
    expectOk(await service.rpc("balance_complete",{p_claim_id:balance.claim_id,p_provider_reference:balanceIntent,p_detail:{clientSecret:`${balanceIntent}_secret`}}));
    const succeeded=expectOk(await service.rpc("payment_succeeded_claim",{p_request_id:requestId,p_provider_reference:balanceIntent,p_event_id:`evt_bal_${requestId}`,p_payload_sha256:"1".repeat(64),p_idempotency_key:`evt_bal_${requestId}`}));
    expectOk(await service.rpc("payment_succeeded_complete",{p_claim_id:succeeded.claim_id,p_provider_reference:balanceIntent,p_detail:{}}));
    const operatorClient=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${operatorToken}`}},auth:{persistSession:false}});
    const preflight=expectOk(await operatorClient.rpc("operator_settlement_preflight",{p_request_id:requestId}));
    expect(preflight).toMatchObject({approved_change_cents:1000,captured_amount_cents:11000,fee_amount_cents:1100});
    const args = { p_request_id: requestId, p_authorization_token: preflight.authorization_token, p_authorization_version: "1", p_fee_version: "1", p_fee_rate_bps: 1000, p_fee_amount_cents: "1100" };
    const first = await service.rpc("settlement_claim", { ...args, p_idempotency_key: `settle:${requestId}:a` });
    expect(first.error).toBeNull();
    const second = await service.rpc("settlement_claim", { ...args, p_idempotency_key: `settle:${requestId}:b` });
    expect(second.error?.message).toMatch(/stale|consumed/i);
    const job = expectOk(await service.from("jobs").select("settlement_state,authorization_token").eq("request_id", requestId).single());
    expect(job).toMatchObject({ settlement_state: "transferring", authorization_token: null });
    const recoveryId = randomUUID();
    expectOk(await service.from("money_operations").insert({ id: recoveryId, kind: "recovery", idempotency_key: `recovery:${requestId}`, fingerprint: {}, request_id: requestId, state: "claimed", amount_cents: "1", destination_account: `acct_${provider}` }));
    const recovered = await service.rpc("recovery_complete", { p_claim_id: recoveryId, p_provider_reference: `tr_${recoveryId}`, p_detail: {} });
    expect(recovered.error).toBeNull();
    const webhook = { event_id: `evt_${requestId}`, event_type: "payment_intent.succeeded", object_id: `pi_${requestId}`, request_id: requestId, payload_sha256: "0".repeat(64) };
    expectOk(await service.from("stripe_webhook_events").insert(webhook));
    const duplicateWebhook = await service.from("stripe_webhook_events").insert(webhook);
    expect(duplicateWebhook.error?.message).toMatch(/duplicate|unique/i);
    const denied = await anon.from("money_operations").select("id").limit(1);
    expect(denied.error).not.toBeNull();
    expect((await customerClient.from("service_requests").select("id").eq("id",requestId)).data).toHaveLength(1);
    expect((await providerClient.from("service_requests").select("id").eq("id",requestId)).data).toHaveLength(0);
    expect((await operatorClient.from("service_requests").select("id").eq("id",requestId)).data).toHaveLength(1);
    const deniedRecovery = await anon.rpc("recovery_complete", { p_claim_id: recoveryId, p_provider_reference: "forbidden", p_detail: {} });
    expect(deniedRecovery.error).not.toBeNull();
  }, 30_000);
});
