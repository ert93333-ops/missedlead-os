import { expect, test, type Page, type Route } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { maskMessage } from "../../server/app";
import { AssessmentTokenSigner } from "../../server/intake/token";
import { compositeQuoteScore, explorationSelected, InMemoryRepository } from "../../server/repository";
import { resolve } from "node:path";

type RecordMap = Record<string, unknown>;
const blank = () => ({ requests: [] as RecordMap[], quotes: [] as RecordMap[], changes: [] as RecordMap[], jobs: [] as RecordMap[], disputes: [] as RecordMap[], evidence: [] as RecordMap[], payments: [] as RecordMap[], audit: [] as RecordMap[] });

test("message contact masking removes raw phone and email",()=>{
  const value=maskMessage("Call (704) 555-0199 or owner@example.com");
  expect(value).toBe("Call [phone masked] or [email masked]");
  expect(value).not.toContain("704");
  expect(value).not.toContain("@");
});

test("15 percent exploration and composite quote ordering are deterministic",()=>{
  const requestId="req-ranking";
  const selections=Array.from({length:1000},(_,index)=>explorationSelected(requestId,`provider-${index}`));
  const selected=selections.filter(Boolean).length;
  expect(selected).toBeGreaterThan(120);
  expect(selected).toBeLessThan(180);
  expect(explorationSelected(requestId,"provider-42")).toBe(explorationSelected(requestId,"provider-42"));
  const base={id:"q",requestId,providerId:"p",providerName:"P",scope:"Repair",createdAt:new Date().toISOString()};
  const quick={...base,amountCents:10_000,ranking:{totalCents:10_000,earliestStartAt:new Date().toISOString(),warrantyDays:90}};
  const expensive={...base,id:"q2",amountCents:20_000,ranking:{totalCents:20_000,earliestStartAt:new Date(Date.now()+86_400_000).toISOString(),warrantyDays:30}};
  expect(compositeQuoteScore(quick)).toBeGreaterThan(compositeQuoteScore(expensive));
});

test("24-hour expansion adds eligible providers and leaves fresh requests unchanged",async()=>{
  const repository=new InMemoryRepository();
  repository.inspect(state=>{
    state.requests.stale={id:"stale",customerId:"c",customerName:"C",description:"Old repair request",address:"Charlotte",safetyStatus:"cleared",status:"matched",providerIds:[],expandedSearch:false,createdAt:"2026-09-01T00:00:00.000Z"};
    state.requests.fresh={...state.requests.stale,id:"fresh",providerIds:[],createdAt:"2026-09-02T11:30:00.000Z"};
    for(let index=0;index<5;index++)state.providerEligibility[`p-${index}`]={status:"approved",organizationName:`P${index}`,licenseVerified:true,licenseExpiresAt:"2027-01-01T00:00:00.000Z",insuranceVerified:true,insuranceExpiresAt:"2027-01-01T00:00:00.000Z",serviceCategories:["general"],serviceAreas:["Charlotte"]};
  });
  await repository.expandStaleQuoteRequests("2026-09-02T12:00:00.000Z");
  expect(repository.inspect(state=>state.requests.stale.providerIds)).toHaveLength(3);
  expect(repository.inspect(state=>state.requests.fresh.providerIds)).toHaveLength(0);
});

test("renders server-ranked higher score first even when its price is higher",async({page})=>{
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1","Deterministic mock lane is disabled in integration mode.");
  const request={id:"req-ranked",customerName:"Customer",description:"Ranked repair request",address:"Charlotte",safetyStatus:"cleared",status:"quoted",providerIds:["p-high","p-low"],expandedSearch:false,createdAt:"2026-09-01T00:00:00.000Z"};
  const approvedFactors={earliestStartAt:"2026-09-06T13:00:00.000Z",warrantyDays:90,licenseVerified:true,insuranceVerified:true,rating:4.9,distanceMiles:3,responseMinutes:8,languages:["English","Spanish"]};
  const quotes=[
    {id:"quote-high",requestId:request.id,providerName:"Higher Score Provider",scope:"Premium repair",amountCents:18000,rankingScore:96,rankingPolicyVersion:3,ranking:{...approvedFactors,totalCents:18000}},
    {id:"quote-low",requestId:request.id,providerName:"Lower Score Provider",scope:"Budget repair",amountCents:12000,rankingScore:72,rankingPolicyVersion:3,ranking:{...approvedFactors,totalCents:12000,rating:3.8,distanceMiles:18,responseMinutes:90}},
  ];
  await page.route("**/api/dashboard",route=>route.fulfill({json:{requests:[request],quotes,changes:[],jobs:[],disputes:[],evidence:[],payments:[],audit:[]}}));
  await actor(page,"customer");
  const comparison=page.getByTestId("quote-comparison");
  await expect(comparison.getByTestId("ranked-quote-1")).toContainText("Higher Score Provider");
  await expect(comparison.getByTestId("ranked-quote-1")).toContainText("score 96 · policy 3");
  await expect(comparison.getByTestId("ranked-quote-1")).toContainText("$180.00");
  await expect(comparison.getByTestId("ranked-quote-1")).toContainText("License verified · Insurance verified · Rating 4.9 · Distance 3mi · Response 8 min · Languages English, Spanish");
  await expect(comparison.getByTestId("ranked-quote-2")).toContainText("Lower Score Provider");
});

async function actor(page: Page, role: "customer" | "provider" | "operator") {
  if (await page.getByRole("button", { name: /Sign out|Cerrar sesión/ }).count()) await page.getByRole("button", { name: /Sign out|Cerrar sesión/ }).click();
  else await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("demo-actor-selector")).toBeVisible();
  await page.getByTestId(`demo-${role}`).click();
  await expect(page).toHaveURL(new RegExp(`/${role}$`));
  await expect(page.getByTestId("derived-role")).toBeVisible();
}

async function shot(page: Page, name: string) {
  const path = resolve("artifacts", name);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function integrationActor(page: Page, role: "customer" | "provider" | "operator", token: string, userId: string) {
  const supabaseUrl = process.env.E2E_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("E2E_SUPABASE_URL is required");
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: storageKey,
    value: { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "integration-session", user: { id: userId, aud: "authenticated", app_metadata: { role }, user_metadata: {} } },
  });
  await page.goto(`/${role}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(`${role}-workspace`)).toBeVisible();
}

async function selectRequest(page: Page, marker: string) {
  const picker = page.getByLabel("Select a job");
  const value = await picker.locator("option").filter({ hasText: marker }).getAttribute("value");
  if (!value) throw new Error(`Integration request not visible: ${marker}`);
  await picker.selectOption(value);
}

async function stripeSuccess(page:Page,requestId:string,paymentIntentId:string,secret:string,suffix:string){
  const payload=JSON.stringify({id:`evt_e2e_${suffix}_${Date.now()}`,type:"payment_intent.succeeded",data:{object:{id:paymentIntentId,metadata:{requestId}}}});
  const timestamp=Math.floor(Date.now()/1000),signature=createHmac("sha256",secret).update(`${timestamp}.${payload}`).digest("hex");
  const response=await page.request.post("/api/webhooks/stripe",{headers:{"content-type":"application/json","stripe-signature":`t=${timestamp},v1=${signature}`},data:payload});
  expect(response.ok(),await response.text()).toBeTruthy();
}

test("Supabase integration executes customer, operator, provider quote and evidence-backed change", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION !== "1", "Requires explicit Supabase integration mode.");
  const customerToken = process.env.E2E_CUSTOMER_TOKEN, customerId = process.env.E2E_CUSTOMER_ID;
  const providerToken = process.env.E2E_PROVIDER_TOKEN, providerId = process.env.E2E_PROVIDER_ID;
  const operatorToken = process.env.E2E_OPERATOR_TOKEN, operatorId = process.env.E2E_OPERATOR_ID;
  const webhookSecret=process.env.E2E_STRIPE_WEBHOOK_SECRET??process.env.STRIPE_WEBHOOK_SECRET;
  const serviceKey=process.env.E2E_SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl=process.env.E2E_SUPABASE_URL??process.env.VITE_SUPABASE_URL;
  const intakeSigningSecret=process.env.INTAKE_SIGNING_SECRET??process.env.SESSION_SECRET;
  test.skip(!customerToken || !customerId || !providerToken || !providerId || !operatorToken || !operatorId || !webhookSecret || !serviceKey || !supabaseUrl || !intakeSigningSecret, "Integration actors, intake signing, Stripe webhook, and Supabase service credentials are required.");
  if (!intakeSigningSecret) throw new Error("INTAKE_SIGNING_SECRET or SESSION_SECRET is required");
  const marker = `integration repair ${Date.now()}`;

  const assessment={reply:"The sink drain connection is the likely source. Review this provisional scope before matching.",category:"plumbing" as const,summary:`${marker} with verified access details`,issueCandidates:[{id:"drain-trap-leak",label:"Drain trap leak",likelihood:"high" as const,reason:"The reported location and symptom fit a leaking drain connection.",evidenceNeeded:[]}],questions:[],details:{location:"Kitchen sink",access:"Cabinet access available"},safety:{level:"normal" as const,hazards:[],guidance:""},readyToConfirm:true};
  const assessmentToken=new AssessmentTokenSigner(intakeSigningSecret).sign({version:1,assessmentId:crypto.randomUUID(),actorId:customerId!,expiresAt:new Date(Date.now()+30*60_000).toISOString(),locale:"en",assessment,skippedQuestionIds:[],uncertaintyAcknowledged:false,attachmentTypes:[],attachmentNames:[],attachmentDigests:[],history:[{role:"user",content:`${marker} with verified access details`}],translations:[]});
  await page.route("**/api/intake/analyze",async route=>{
    const body=route.request().postDataBuffer()?.toString("utf8")??"";
    expect(body).toContain(marker);
    await route.fulfill({json:{...assessment,locale:"en",assessmentToken}});
  });

  await integrationActor(page, "customer", customerToken!, customerId!);
  await page.getByLabel("Describe the problem or answer the question").fill(`${marker} with verified access details`);
  await page.getByRole("button",{name:"Send"}).click();
  await expect(page.getByRole("heading",{name:"Review your repair request"})).toBeVisible();
  await page.getByLabel("Your name").fill("Integration Customer");
  await page.getByLabel("Service address").fill("Charlotte, NC");
  await page.getByText("I understand this is a provisional scope",{exact:false}).click();
  await page.getByRole("button",{name:"Confirm and find technicians"}).click();
  await expect(page.getByRole("heading", { name: new RegExp(marker) })).toBeVisible();

  await integrationActor(page, "provider", providerToken!, providerId!);
  await selectRequest(page, marker);
  await page.getByLabel("Business name").fill("Integration Provider");
  await page.getByLabel("Scope of work").fill("Inspect, repair, test, and clean the work area");
  await page.getByLabel("Total quote USD").fill("125");
  await page.getByLabel("Earliest start").fill("2026-09-06T09:00");
  await page.getByLabel("Warranty days").fill("90");
  await page.getByRole("button", { name: "Submit quote" }).click();
  await expect(page.getByRole("status")).toContainText("ranking factors");

  await integrationActor(page, "customer", customerToken!, customerId!);
  await selectRequest(page, marker);
  await expect(page.getByTestId("quote-comparison")).toContainText("Integration Provider");
  const customerDashboard=await page.request.get("/api/dashboard",{headers:{Authorization:`Bearer ${customerToken}`}});
  expect(customerDashboard.ok()).toBeTruthy();
  const customerState=await customerDashboard.json() as {requests:Array<{id:string;description:string}>;quotes:Array<{id:string;requestId:string}>};
  const requestId=customerState.requests.find(value=>value.description.includes(marker))?.id;
  const quoteId=customerState.quotes.find(value=>value.requestId===requestId)?.id;
  expect(requestId).toBeTruthy();expect(quoteId).toBeTruthy();
  const deposit=await page.request.post(`/api/requests/${requestId}/deposit`,{headers:{Authorization:`Bearer ${customerToken}`,"Idempotency-Key":`e2e-deposit-${Date.now()}`},data:{quoteId}});
  expect(deposit.ok(),await deposit.text()).toBeTruthy();
  const depositBody=await deposit.json() as {provider_reference?:string;providerReference?:string};
  await stripeSuccess(page,requestId!,depositBody.providerReference??depositBody.provider_reference!,webhookSecret!,"deposit");

  await integrationActor(page,"provider",providerToken!,providerId!);
  await selectRequest(page,marker);
  await page.getByRole("button",{name:"Start job"}).click();
  const proof=page.getByTestId("provider-evidence");
  await proof.getByLabel("Evidence description").fill("Integration before condition evidence");
  await proof.getByRole("button",{name:"Record evidence"}).click();
  await page.getByLabel("Reason for change").fill("Integration condition requires added part");
  await page.getByLabel("Item description").fill("Additional replacement part");
  await page.getByLabel("Quantity").fill("1");
  await page.getByLabel("Unit price USD").fill("25");
  await page.getByLabel("Linked evidence (at least 1)").selectOption({index:0});
  await page.getByRole("button",{name:"Request change approval"}).click();
  await expect(page.getByRole("status")).toContainText("Change approval");

  await integrationActor(page,"customer",customerToken!,customerId!);
  await selectRequest(page,marker);
  await page.getByRole("button",{name:"Approve change"}).click();
  await expect(page.getByRole("status")).toContainText("Change approved");

  await integrationActor(page,"provider",providerToken!,providerId!);
  await selectRequest(page,marker);
  const completionProof=page.getByTestId("provider-evidence");
  await completionProof.getByLabel("Stage").selectOption("after");
  await completionProof.getByLabel("Evidence description").fill("Integration after repair evidence");
  await completionProof.getByRole("button",{name:"Record evidence"}).click();
  await page.getByRole("button",{name:"Submit completion"}).click();
  await expect(page.getByRole("status")).toContainText("72-hour");

  const balance=await page.request.post(`/api/requests/${requestId}/balance`,{headers:{Authorization:`Bearer ${customerToken}`,"Idempotency-Key":`e2e-balance-${Date.now()}`},data:{}});
  expect(balance.ok(),await balance.text()).toBeTruthy();
  const balanceBody=await balance.json() as {provider_reference?:string;providerReference?:string};
  await stripeSuccess(page,requestId!,balanceBody.providerReference??balanceBody.provider_reference!,webhookSecret!,"balance");
  const admin=createClient(supabaseUrl!,serviceKey!,{auth:{persistSession:false}});
  const heldAt=new Date(Date.now()-72*60*60*1000-1000).toISOString();
  const aged=await admin.from("jobs").update({completed_at:heldAt}).eq("request_id",requestId!);
  expect(aged.error?.message).toBeUndefined();

  await integrationActor(page,"operator",operatorToken!,operatorId!);
  await selectRequest(page,marker);
  await page.getByRole("button",{name:"Run settlement"}).click();
  await expect(page.getByRole("status")).toContainText("Settlement executed");
  await shot(page, "e2e-supabase-integration-flow.png");
});

test("customer full flow renders every role and enforces lifecycle API contracts", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  const state = blank();
  let phase = "empty";
  const fulfill = (route: Route, status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    if (url === "/api/capabilities" && request.method() === "GET") return fulfill(route, 200, { payments: { enabled: true, provider: "stripe" } });
    expect(request.headers().authorization).toMatch(/^Bearer demo\./);
    if (url === "/api/dashboard" && request.method() === "GET") return fulfill(route, 200, state);
    if (url === "/api/intake/analyze" && request.method() === "POST") {
      expect(phase).toBe("empty");
      const body=request.postDataBuffer()?.toString("utf8")??"";
      expect(body).toContain("Replace the leaking kitchen sink trap and test the drain.");
      expect(body).toContain("intake.webm");
      expect(body).toContain('"mediaConsent":true');
      phase="assessed";
      return fulfill(route,200,{reply:"The trap connection is the likely source. Review the provisional scope.",locale:"en",category:"plumbing",summary:"Replace the leaking kitchen sink trap and test the drain.",issueCandidates:[{id:"trap-leak",label:"Leaking drain trap",likelihood:"high",reason:"The visible drip is below the sink.",evidenceNeeded:[]}],questions:[],details:{location:"Kitchen sink",dimensions:"1.5 inch",access:"Below sink"},safety:{level:"normal",hazards:[],guidance:""},readyToConfirm:true,assessmentToken:"signed.assessment.fixture"});
    }
    if (url === "/api/intake/confirm" && request.method() === "POST") {
      expect(phase).toBe("assessed");
      expect(request.postDataJSON()).toEqual({assessmentToken:"signed.assessment.fixture",acceptedIssueIds:["trap-leak"],warningAcknowledged:true,customerName:"Charlotte Customer",address:"101 Mint St, Charlotte, NC"});
      state.requests.push({id:"req-1",customerName:"Charlotte Customer",description:"Replace the leaking kitchen sink trap and test the drain.",address:"101 Mint St, Charlotte, NC",safetyStatus:"cleared",status:"matched",providerIds:["demo-provider","provider-2"],expandedSearch:true,workScopeSnapshot:{symptom:"Replace the leaking kitchen sink trap and test the drain.",location:"Kitchen sink",dimensions:"1.5 inch",access:"Below sink",exclusions:["Cabinet replacement"]},triageSnapshot:{category:"plumbing",urgency:"urgent",possibleCauses:["Leaking drain trap"],confidence:.8,questions:[],hazards:[]},priceDisclosure:{source:"ai_intake_no_market_sample",sampleCount:0,updatedAt:"2026-09-05T09:00:00.000Z",confidence:0},createdAt:"2026-09-01T00:00:00.000Z"});
      phase="matched";
      return fulfill(route,201,{requestId:"req-1",status:"matched",matchCount:2});
    }
    if (url === "/api/requests/req-1/intake-media" && request.method() === "POST") {
      expect(phase).toBe("matched");
      const body=request.postDataBuffer()?.toString("utf8")??"";
      expect(body).toContain("signed.assessment.fixture");
      expect(body).toContain("intake.webm");
      return fulfill(route,201,{media:[{id:"media-1",requestId:"req-1",fileName:"intake.webm",contentType:"audio/webm",sanitizationStatus:"sanitized",exifRemovalStatus:"removed",sourceRetention:"discarded_after_sanitization"}]});
    }
    if (url === "/api/requests/req-1/intake-media" && request.method() === "GET") {
      expect(phase).not.toBe("empty");
      return fulfill(route,200,{media:[{id:"media-1",fileName:"intake.webm",contentType:"audio/webm",sizeBytes:3,url:"data:audio/webm;base64,AQID",expiresInSeconds:60}]});
    }
    if (url === "/api/requests/req-1/quotes" && request.method() === "POST") {
      expect(phase).toBe("matched");
      const submitted = request.postDataJSON() as { providerName: string; scope: string; amountCents: number; ranking: { totalCents: number; earliestStartAt: string; warrantyDays: number } };
      expect(submitted).toMatchObject({ providerName: "Mint Plumbing", scope: "Replace trap, pressure test, and clean work area", amountCents: 12500, ranking: { totalCents: 12500, warrantyDays: 90 } });
      expect(new Date(submitted.ranking.earliestStartAt).toString()).not.toBe("Invalid Date");
      const quote = { id: "quote-1", requestId: "req-1", ...submitted };
      state.quotes.push(quote); Object.assign(state.requests[0], { status: "quoted" }); phase = "quoted";
      return fulfill(route, 201, quote);
    }
    if (url === "/api/requests/req-1/deposit" && request.method() === "POST") {
      expect(phase).toBe("quoted"); expect(request.postDataJSON()).toEqual({ quoteId: "quote-1" }); expect(request.headers()["idempotency-key"]).toBeTruthy();
      state.jobs.push({ requestId: "req-1", quoteId: "quote-1", depositCents: 2500 }); state.payments.push({ id: "pay-deposit", requestId: "req-1", kind: "deposit", amountCents: 2500, status: "succeeded" });
      Object.assign(state.requests[0], { status: "funded" }); phase = "funded";
      return fulfill(route, 200, { state: "completed" });
    }
    if (url === "/api/requests/req-1/start" && request.method() === "POST") {
      expect(phase).toBe("funded"); expect(request.postDataJSON()).toEqual({});
      Object.assign(state.requests[0], { status: "in_progress" }); phase = "in_progress";
      return fulfill(route, 200, state.requests[0]);
    }
    if (url === "/api/requests/req-1/evidence" && request.method() === "POST") {
      expect(phase).toMatch(/in_progress|before|change/);
      const body = request.postDataJSON() as { kind: string; note: string };
      expect(body).toEqual(body.kind === "before" ? { kind: "before", note: "Dry cabinet before replacement" } : { kind: "after", note: "New trap installed and leak tested" });
      const evidence = { id: `evidence-${body.kind}`, requestId: "req-1", ...body }; state.evidence.push(evidence); phase = body.kind;
      return fulfill(route, 201, evidence);
    }
    if (url === "/api/requests/req-1/changes" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ description: "Corroded shutoff requires replacement", amountCents: 3000, items: [{ description: "Replace shutoff valve", quantity: 1, unitCents: 3000 }], evidenceIds: ["evidence-before"] });
      const change = { id: "change-1", requestId: "req-1", ...request.postDataJSON() as object }; state.changes.push(change); phase = "change";
      return fulfill(route, 201, change);
    }
    if (url === "/api/requests/req-1/complete" && request.method() === "POST") {
      expect(phase).toBe("after"); expect(request.postDataJSON()).toEqual({});
      Object.assign(state.requests[0], { status: "completed" }); Object.assign(state.jobs[0], { completedAt: "2026-09-01T00:00:00.000Z" }); phase = "completed";
      return fulfill(route, 200, state.jobs[0]);
    }
    if (url === "/api/requests/req-1/balance" && request.method() === "POST") {
      expect(phase).toBe("completed"); expect(request.postDataJSON()).toEqual({}); expect(request.headers()["idempotency-key"]).toBeTruthy();
      state.payments.push({ id: "pay-balance", requestId: "req-1", kind: "balance", amountCents: 10000, status: "succeeded" }); phase = "paid";
      return fulfill(route, 200, { state: "completed" });
    }
    throw new Error(`Unexpected API request: ${request.method()} ${url}`);
  });
  await actor(page, "customer");
  const intake = page.getByTestId("customer-intake");
  await intake.getByLabel("Add photos, video, or audio").setInputFiles({name:"intake.webm",mimeType:"audio/webm",buffer:Buffer.from([1,2,3])});
  await intake.getByText("I agree to secure AI processing",{exact:false}).click();
  await intake.getByLabel("Describe the problem or answer the question").fill("Replace the leaking kitchen sink trap and test the drain.");
  await intake.getByRole("button",{name:"Send"}).click();
  await expect(page.getByRole("heading",{name:"Review your repair request"})).toBeVisible();
  await page.getByLabel("Your name").fill("Charlotte Customer");
  await page.getByLabel("Service address").fill("101 Mint St, Charlotte, NC");
  await page.getByText("I understand this is a provisional scope",{exact:false}).click();
  await page.getByRole("button",{name:"Confirm and find technicians"}).click();
  await expect(page.getByRole("heading", { name: /Replace the leaking/ })).toBeVisible();
  await expect(page.getByTestId("chat-scope-summary")).toContainText("Kitchen sink");
  await expect(page.getByTestId("request-details")).toHaveCount(0);

  await actor(page, "provider");
  await page.getByLabel("Business name").fill("Mint Plumbing");
  await page.getByLabel("Scope of work").fill("Replace trap, pressure test, and clean work area");
  await page.getByLabel("Total quote USD").fill("125");
  await page.getByLabel("Earliest start").fill("2026-09-06T09:00");
  await page.getByLabel("Warranty days").fill("90");
  await page.getByRole("button", { name: "Submit quote" }).click();
  await expect(page.getByRole("status")).toContainText("sent to the customer");

  await actor(page, "customer");
  await page.getByRole("button", { name: "Choose this quote" }).click();
  await expect(page.getByTestId("payment-confirmation")).toContainText("$25.00");
  await page.getByTestId("payment-confirmation").getByRole("button", { name: "Confirm payment" }).click();
  await expect(page.getByTestId("change-orders")).toBeVisible();

  await actor(page, "provider");
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByRole("status")).toContainText("Job started");
  const evidence = page.getByTestId("provider-evidence");
  await evidence.getByLabel("Evidence description").fill("Dry cabinet before replacement");
  await evidence.getByRole("button", { name: "Record evidence" }).click();
  await expect(evidence).toContainText("Dry cabinet before replacement");
  await page.getByLabel("Reason for change").fill("Corroded shutoff requires replacement");
  await page.getByLabel("Item description").fill("Replace shutoff valve");
  await page.getByLabel("Quantity").fill("1");
  await page.getByLabel("Unit price USD").fill("30");
  await page.getByLabel("Linked evidence (at least 1)").selectOption("evidence-before");
  await page.getByRole("button", { name: "Request change approval" }).click();
  await expect(page.getByRole("status")).toContainText("Change approval");
  await evidence.getByLabel("Stage").selectOption("after");
  await evidence.getByLabel("Evidence description").fill("New trap installed and leak tested");
  await evidence.getByRole("button", { name: "Record evidence" }).click();
  await page.getByRole("button", { name: "Submit completion" }).click();
  await expect(page.getByRole("status")).toContainText("72-hour");

  await actor(page, "customer");
  await expect(page.getByTestId("completion-protection")).toBeVisible();
  await page.getByRole("button", { name: "Pay balance" }).click();
  await expect(page.getByTestId("payment-confirmation")).toContainText("$100.00");
  await page.getByTestId("payment-confirmation").getByRole("button", { name: "Confirm payment" }).click();
  await expect(page.getByRole("status")).toContainText("Payment confirmed");
  expect(phase).toBe("paid");
  await shot(page, "e2e-customer-full-flow.png");
});

test("claim-derived route cannot be switched by URL", async ({ page }) => {
  test.skip(process.env.REQUIRE_SUPABASE_INTEGRATION === "1", "Deterministic mock lane is disabled in integration mode.");
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: blank() }));
  await actor(page, "provider");
  await page.evaluate(() => { window.history.pushState(null, "", "/operator"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page).toHaveURL(/\/provider$/);
  await expect(page.getByTestId("operator-console")).toHaveCount(0);
});
