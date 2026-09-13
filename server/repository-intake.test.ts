/**
 * repository 인테이크 저장·조회 로직 테스트.
 */
import { describe, expect, it } from "vitest";
import { emptyState, InMemoryRepository, type ProviderEligibility, type Result } from "./repository.js";

const now="2026-09-05T12:00:00.000Z";
const approvedProvider=(categories:string[],area="Charlotte"):ProviderEligibility=>({status:"approved",organizationName:"Provider",licenseVerified:true,licenseExpiresAt:"2027-09-05T12:00:00.000Z",insuranceVerified:true,insuranceExpiresAt:"2027-09-05T12:00:00.000Z",serviceCategories:categories,serviceAreas:[area]});
const intake={customerName:"Ana",address:"101 Tryon St, Charlotte, NC",description:"Water is leaking below the sink",category:"plumbing",workScope:{symptom:"leak",location:"kitchen sink"},triage:{category:"plumbing",urgency:"routine",possibleCauses:["trap"],confidence:0.8,questions:[],hazards:[]},priceDisclosure:{source:"regional",sampleCount:40,updatedAt:now,confidence:0.7},assessmentId:"assessment-signed-1"};
const unusedImplementation=():Result=>{throw new Error("confirm_intake must be repository-owned");};

describe("InMemoryRepository confirm_intake",()=>{
  it("creates immutable intake snapshots and matches at most three eligible providers",async()=>{
    // Given
    const seed=emptyState();
    seed.providerEligibility={
      provider4:approvedProvider(["plumbing"]),provider2:approvedProvider(["plumbing"]),provider1:approvedProvider(["plumbing"]),provider3:approvedProvider(["plumbing"]),
      hvac:approvedProvider(["hvac"]),outside:approvedProvider(["plumbing"],"Raleigh"),expired:{...approvedProvider(["plumbing"]),licenseExpiresAt:"2026-09-05T11:59:59.000Z"},
    };
    const repository=new InMemoryRepository(seed);

    // When
    const result=await repository.execute("confirm_intake",intake,{actor:{id:"customer-1",role:"customer"},accessToken:"token",now},unusedImplementation);

    // Then
    expect(result).toEqual({status:201,data:{requestId:"request_1",status:"matched",matchCount:3}});
    expect(repository.inspect(state=>state.requests.request_1)).toMatchObject({customerId:"customer-1",category:"plumbing",status:"matched",providerIds:["provider1","provider2","provider3"],workScopeSnapshot:intake.workScope,triageSnapshot:intake.triage,priceDisclosure:intake.priceDisclosure});
  });

  it("returns the original request when the same customer confirms an assessment again",async()=>{
    // Given
    const repository=new InMemoryRepository();
    const context={actor:{id:"customer-1",role:"customer"} as const,accessToken:"token",now};
    const first=await repository.execute("confirm_intake",intake,context,unusedImplementation);

    // When
    const repeated=await repository.execute("confirm_intake",{...intake,description:"changed after confirmation"},context,unusedImplementation);

    // Then
    expect(repeated).toEqual(first);
    expect(repository.inspect(state=>Object.values(state.requests))).toHaveLength(1);
    expect(repository.inspect(state=>state.requests.request_1?.description)).toBe(intake.description);
  });

  it("keeps the request in intake when no provider is eligible",async()=>{
    // Given
    const repository=new InMemoryRepository();

    // When
    const result=await repository.execute("confirm_intake",intake,{actor:{id:"customer-1",role:"customer"},accessToken:"token",now},unusedImplementation);

    // Then
    expect(result).toEqual({status:201,data:{requestId:"request_1",status:"intake",matchCount:0}});
  });
});
