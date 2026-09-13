begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(35);

select set_config('request.jwt.claim.role','service_role',true);
insert into service_zips(zip) values('28202'),('28203') on conflict(zip) do nothing;
insert into profiles(id,role,display_name,is_demo) values
 ('29000000-0000-0000-0000-000000000001','customer','ZIP customer',false),
 ('29000000-0000-0000-0000-000000000002','customer','No match customer',false),
 ('29000000-0000-0000-0000-000000000003','customer','Demo ZIP customer',true),
 ('29000000-0000-0000-0000-000000000004','customer','Provider applicant',false),
 ('29000000-0000-0000-0000-000000000005','operator','ZIP reviewer',false);
insert into operator_allowlist(user_id) values('29000000-0000-0000-0000-000000000005');
insert into profiles(
  id,role,display_name,is_demo,provider_status,license_verified,license_expires_at,
  insurance_verified,insurance_expires_at,service_categories,service_areas
) values
 ('29000000-0000-0000-0000-000000000011','provider','28202 plumber',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('29000000-0000-0000-0000-000000000012','provider','28203 plumber',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28203}'),
 ('29000000-0000-0000-0000-000000000013','provider','Demo 28202 plumber',true,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('29000000-0000-0000-0000-000000000014','provider','General 28202 provider',false,'approved',true,'2099-01-01',true,'2099-01-01','{general}','{28202}');

select set_config('test.zip_28203',confirm_intake(
  '29000000-0000-0000-0000-000000000001','ZIP customer','100 Trade St, Charlotte, NC 28203','Leaking pipe','plumbing','{}',
  '{"category":"plumbing","urgency":"routine","hazards":[]}','{}','zip-28203'
)::text,true);
select is((current_setting('test.zip_28203')::jsonb->>'matchCount')::integer,1,'28203 request has one same-ZIP match');
select is((select service_area from service_requests where id=(current_setting('test.zip_28203')::jsonb->>'requestId')::uuid),'28203','validated address ZIP is stored as service area');
select is((select count(*) from request_matches where request_id=(current_setting('test.zip_28203')::jsonb->>'requestId')::uuid and provider_id='29000000-0000-0000-0000-000000000011'),0::bigint,'28202 provider is not matched to 28203 request');
select is((select count(*) from request_matches where request_id=(current_setting('test.zip_28203')::jsonb->>'requestId')::uuid and provider_id='29000000-0000-0000-0000-000000000012'),1::bigint,'28203 provider is matched to 28203 request');
select is(provider_is_eligible('29000000-0000-0000-0000-000000000011',(current_setting('test.zip_28203')::jsonb->>'requestId')::uuid),false,'eligibility rejects a different ZIP');
select is(provider_is_eligible('29000000-0000-0000-0000-000000000012',(current_setting('test.zip_28203')::jsonb->>'requestId')::uuid),true,'eligibility accepts the same ZIP');

select set_config('test.zip_28202',confirm_intake(
  '29000000-0000-0000-0000-000000000001','ZIP customer','200 Trade St, Charlotte, NC 28202-1234','Blocked drain','plumbing','{}',
  '{"category":"plumbing","urgency":"routine","hazards":[]}','{}','zip-28202'
)::text,true);
select is((current_setting('test.zip_28202')::jsonb->>'matchCount')::integer,1,'ZIP+4 address matches by its five-digit ZIP');
select is((select count(*) from request_matches where request_id=(current_setting('test.zip_28202')::jsonb->>'requestId')::uuid and provider_id='29000000-0000-0000-0000-000000000011'),1::bigint,'same 28202 ZIP provider is matched');
select is((select count(*) from request_matches where request_id=(current_setting('test.zip_28202')::jsonb->>'requestId')::uuid and provider_id='29000000-0000-0000-0000-000000000014'),0::bigint,'general-only provider does not consume a plumbing match slot');

select set_config('test.zero_match',confirm_intake(
  '29000000-0000-0000-0000-000000000002','No match customer','300 Trade St, Charlotte, NC 28202','Broken furnace','hvac','{}',
  '{"category":"hvac","urgency":"routine","hazards":[]}','{}','zip-zero-match'
)::text,true);
select is((current_setting('test.zero_match')::jsonb->>'matchCount')::integer,0,'initial intake can safely have zero matches');
select is(current_setting('test.zero_match')::jsonb->>'status','intake','zero-match request remains in intake');
select is(
  confirm_intake('29000000-0000-0000-0000-000000000002','Changed','Changed address','Changed description','hvac','{}','{"category":"hvac","urgency":"routine","hazards":[]}','{}','zip-zero-match')->>'requestId',
  current_setting('test.zero_match')::jsonb->>'requestId','retry returns the original request without re-parsing changed address data'
);
select is((select count(*) from service_requests where customer_id='29000000-0000-0000-0000-000000000002' and intake_assessment_id='zip-zero-match'),1::bigint,'retry creates no duplicate request');

select set_config('test.demo_zip',confirm_intake(
  '29000000-0000-0000-0000-000000000003','Demo ZIP customer','400 Trade St, Charlotte, NC 28202','Demo leak','plumbing','{}',
  '{"category":"plumbing","urgency":"routine","hazards":[]}','{}','zip-demo'
)::text,true);
select is((current_setting('test.demo_zip')::jsonb->>'matchCount')::integer,1,'demo request matches within the demo boundary');
select is((select count(*) from request_matches where request_id=(current_setting('test.demo_zip')::jsonb->>'requestId')::uuid and provider_id='29000000-0000-0000-0000-000000000013'),1::bigint,'demo request includes the same-ZIP demo provider');
select is((select count(*) from request_matches m join profiles p on p.id=m.provider_id where m.request_id=(current_setting('test.demo_zip')::jsonb->>'requestId')::uuid and not p.is_demo),0::bigint,'demo request excludes real providers');
select throws_ok(
  $$select confirm_intake('29000000-0000-0000-0000-000000000001','ZIP customer','No postal code here','Leak','plumbing','{}','{"category":"plumbing","urgency":"routine","hazards":[]}','{}','zip-invalid')$$,
  'P0001','confirmed_intake_zip_invalid','address without a five-digit ZIP fails closed'
);
select throws_ok(
  $$select confirm_intake('29000000-0000-0000-0000-000000000001','ZIP customer','500 Trade St 99999','Leak','plumbing','{}','{"category":"plumbing","urgency":"routine","hazards":[]}','{}','zip-unavailable')$$,
  'P0001','service_zip_unavailable','ZIP outside configured coverage fails closed'
);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000004',true);
select lives_ok($$select save_provider_application('{"organizationName":"ZIP Provider","contactName":"Owner","contactEmail":"zip@example.com","contactPhone":"5551234567","categories":["plumbing"],"zipCodes":["28202"],"languages":["en"],"availability":"Weekdays","diagnosticFeeCents":1000,"licenseNumber":"ZIP-1","licenseExpiresAt":"2099-01-01T00:00:00Z","insuranceExpiresAt":"2099-01-01T00:00:00Z","workersCompRequired":false}')$$,'provider can submit a valid ZIP application');
reset role;
insert into provider_documents(provider_id,kind,file_name,object_path)
select '29000000-0000-0000-0000-000000000004',kind,kind||'.pdf','zip-matching/'||kind
from unnest(array['license','coi','w9']) kind;
insert into storage.objects(bucket_id,name)
select 'provider-documents-private','zip-matching/'||kind from unnest(array['license','coi','w9']) kind;
select set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000005',true);
select set_config('request.jwt.claim.role','authenticated',true);
select lives_ok($$select review_provider_application('29000000-0000-0000-0000-000000000004','approved','ZIP verified','zip-registry-1')$$,'operator can approve the ZIP application');
select is((select service_areas from profiles where id='29000000-0000-0000-0000-000000000004'),array['28202'],'approval copies application ZIP into provider service areas');

select set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000004',true);
select lives_ok($$select save_provider_application('{"organizationName":"ZIP Provider","contactName":"Owner","contactEmail":"zip@example.com","contactPhone":"5551234567","categories":["plumbing"],"zipCodes":["28203"],"languages":["en"],"availability":"Weekdays","diagnosticFeeCents":1000,"licenseNumber":"ZIP-1","licenseExpiresAt":"2099-01-01T00:00:00Z","insuranceExpiresAt":"2099-01-01T00:00:00Z","workersCompRequired":false}')$$,'approved provider can submit a ZIP renewal');
select is((select service_areas from profiles where id='29000000-0000-0000-0000-000000000004'),array['28202'],'pending renewal preserves prior service areas while eligibility is disabled');
select set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000005',true);
select lives_ok($$select review_provider_application('29000000-0000-0000-0000-000000000004','approved','ZIP renewed','zip-registry-2')$$,'operator can approve the ZIP renewal');
select is((select service_areas from profiles where id='29000000-0000-0000-0000-000000000004'),array['28203'],'renewal replaces service areas with the newly approved ZIP');
select is(provider_is_eligible('29000000-0000-0000-0000-000000000004',(current_setting('test.zip_28203')::jsonb->>'requestId')::uuid),true,'renewed provider is eligible for the new ZIP');
select is(provider_is_eligible('29000000-0000-0000-0000-000000000004',(current_setting('test.zip_28202')::jsonb->>'requestId')::uuid),false,'renewed provider is no longer eligible for the old ZIP');
select set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000004',true);
select throws_ok(
  $$select save_provider_application('{"organizationName":"ZIP Provider","contactName":"Owner","contactEmail":"zip@example.com","contactPhone":"5551234567","categories":["plumbing"],"zipCodes":["2820X"],"languages":["en"],"availability":"Weekdays","diagnosticFeeCents":1000,"licenseNumber":"ZIP-1","licenseExpiresAt":"2099-01-01T00:00:00Z","insuranceExpiresAt":"2099-01-01T00:00:00Z","workersCompRequired":false}')$$,
  'P0001','invalid_zip_codes','application RPC rejects malformed ZIP data'
);
reset role;
update provider_applications set status='pending',zip_codes=array['bad'] where provider_id='29000000-0000-0000-0000-000000000004';
select set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000005',true);
select throws_ok(
  $$select review_provider_application('29000000-0000-0000-0000-000000000004','approved','ZIP checked','zip-registry-3')$$,
  'P0001','invalid_zip_codes','approval rejects malformed stored ZIP data'
);
select is((select service_areas from profiles where id='29000000-0000-0000-0000-000000000004'),array['28203'],'failed malformed review preserves the last approved ZIP');

insert into profiles(id,role,display_name,is_demo) values
 ('29000000-0000-0000-0000-000000000006','customer','Legacy request owner',false);
insert into profiles(
  id,role,display_name,is_demo,provider_status,license_verified,license_expires_at,
  insurance_verified,insurance_expires_at,service_categories,service_areas
) values(
  '29000000-0000-0000-0000-000000000015','provider','Legacy Charlotte plumber',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{Charlotte,28202}'
);
insert into service_requests(id,customer_id,description,service_address,service_category,service_area)
values('29000000-0000-0000-0000-000000000016','29000000-0000-0000-0000-000000000006','Legacy leak','Legacy Charlotte address','plumbing','Charlotte');
insert into request_matches(request_id,provider_id,rank)
values('29000000-0000-0000-0000-000000000016','29000000-0000-0000-0000-000000000015',1);
insert into provider_applications(
  provider_id,organization_name,contact_name,contact_email,contact_phone,categories,zip_codes,languages,
  availability,diagnostic_fee_cents,license_number,license_expires_at,insurance_expires_at,workers_comp_required
) values(
  '29000000-0000-0000-0000-000000000015','Legacy ZIP Provider','Owner','legacy-zip@example.com','5551234567',
  '{plumbing}','{28203}','{en}','Weekdays',1000,'LEGACY-ZIP-1','2099-01-01','2099-01-01',false
);
insert into provider_documents(provider_id,kind,file_name,object_path)
select '29000000-0000-0000-0000-000000000015',kind,kind||'.pdf','zip-matching/legacy-'||kind
from unnest(array['license','coi','w9']) kind;
insert into storage.objects(bucket_id,name)
select 'provider-documents-private','zip-matching/legacy-'||kind from unnest(array['license','coi','w9']) kind;
select set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000005',true);
select lives_ok($$select review_provider_application('29000000-0000-0000-0000-000000000015','approved','Legacy ZIP renewed','zip-registry-legacy')$$,'legacy provider can complete ZIP reapproval');
select is((select service_areas from profiles where id='29000000-0000-0000-0000-000000000015'),array['28203','Charlotte'],'reapproval replaces old ZIPs while preserving non-ZIP legacy areas');
select is(provider_is_eligible('29000000-0000-0000-0000-000000000015','29000000-0000-0000-0000-000000000016'),true,'reapproved provider keeps access to an existing Charlotte assignment');
select is(provider_is_eligible('29000000-0000-0000-0000-000000000015',(current_setting('test.zip_28203')::jsonb->>'requestId')::uuid),true,'reapproved provider gains its newly approved ZIP');
select is(provider_is_eligible('29000000-0000-0000-0000-000000000015',(current_setting('test.zip_28202')::jsonb->>'requestId')::uuid),false,'reapproval removes prior five-digit ZIPs not in the new application');

select * from finish();
rollback;
