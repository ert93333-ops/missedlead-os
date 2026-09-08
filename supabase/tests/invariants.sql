begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(33);

insert into profiles(id,role,display_name,founder_eligible) values
 ('11000000-0000-0000-0000-000000000001','customer','Customer',false),
 ('22000000-0000-0000-0000-000000000001','provider','Provider',false);
insert into fee_policies(id,version,effective_from,founder_only,fee_rate_bps,tax_rate_bps,stripe_fee_treatment,refund_treatment,rounding)
 values('aa000000-0000-0000-0000-000000000001',1,clock_timestamp()-interval '1 day',false,1000,1300,'included','fee_retained','half_up');
insert into service_requests(id,customer_id,description,service_address,safety_status,workflow_status)
 values('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Request','Address','cleared','quoted');
insert into request_matches(request_id,provider_id,rank,status)
 values('44000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001',1,'quoted');
insert into quotes(id,request_id,provider_id,provider_name,scope,amount_cents,ranking_total_cents,ranking,status)
 values('55000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','Provider','Base scope',10001,10001,'{"totalCents":10001}','accepted');
insert into quote_snapshots(id,quote_id,request_id,provider_id,scope,amount_cents)
 values('66000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','Base scope',10001);
insert into quote_details(quote_id,request_id,diagnostic_cents,labor_cents,materials_cents,tax_cents,valid_until,site_visit_required,permit_required,inspection_status)
 values('55000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000001',0,10001,0,0,clock_timestamp()+interval '7 days',false,false,'not_required');
insert into jobs(request_id,accepted_quote_snapshot_id,deposit_cents)
 values('44000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001',2000);

select throws_ok(
 $$update quote_snapshots set scope='tampered' where id='66000000-0000-0000-0000-000000000001'$$,
 'P0001','quote_snapshots is immutable','quote snapshots reject update'
);
select throws_ok(
 $$delete from quote_snapshots where id='66000000-0000-0000-0000-000000000001'$$,
 'P0001','quote_snapshots is immutable','quote snapshots reject delete'
);
insert into audit_events(id,actor_id,actor,action,resource_type,resource_id,rationale,request_id,correlation_id,detail,created_at)
 values(
  '77000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'created',
  'service_request',
  '44000000-0000-0000-0000-000000000001',
  'immutability fixture',
  '44000000-0000-0000-0000-000000000001',
  'invariants-audit-fixture',
  '{}',
  clock_timestamp()
 );
select throws_ok(
 $$update audit_events set action='tampered' where id='77000000-0000-0000-0000-000000000001'$$,
 'P0001','audit_events is immutable','audit rejects update'
);
select throws_ok(
 $$delete from audit_events where id='77000000-0000-0000-0000-000000000001'$$,
 'P0001','audit_events is immutable','audit rejects delete'
);

select throws_ok(
 $$insert into quotes(request_id,provider_id,provider_name,scope,amount_cents,ranking_total_cents,ranking) values('44000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','Provider','Duplicate',20000,20000,'{"totalCents":20000}')$$,
 '23505',null,'one quote per provider and request'
);
select throws_ok(
 $$update quotes set status='withdrawn' where id='55000000-0000-0000-0000-000000000001'$$,
 '23514',null,'quote state is constrained'
);
alter table quotes disable trigger quote_pilot_limit;
select throws_ok(
 $$insert into quotes(request_id,provider_id,provider_name,scope,amount_cents,ranking_total_cents,ranking) values('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Customer','Too large',100000000,100000000,'{"totalCents":100000000}')$$,
 '23514',null,'quote Stripe maximum is enforced'
);
alter table quotes enable trigger quote_pilot_limit;
select throws_ok(
 $$insert into payments(request_id,kind,amount_cents,idempotency_key) values('44000000-0000-0000-0000-000000000001','deposit',100000000,'too-large')$$,
 '23514',null,'payment Stripe maximum is enforced'
);
select throws_ok(
 $$update jobs set deposit_cents=2001 where request_id='44000000-0000-0000-0000-000000000001'$$,
 'P0001','deposit must be the rounded 20 percent quote amount','deposit must equal rounded 20 percent'
);

insert into change_orders(id,request_id,description,amount_cents,items,evidence_ids,approval_status,approved_at)
 values('88000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000001','Approved addition',3333,'[]','{}','approved',clock_timestamp());
insert into change_snapshots(id,change_order_id,request_id,description,amount_cents,approved_at)
 select '99000000-0000-0000-0000-000000000001',id,request_id,description,amount_cents,approved_at from change_orders where id='88000000-0000-0000-0000-000000000001';
select is(
 (select basis_cents from change_fee_snapshots where change_snapshot_id='99000000-0000-0000-0000-000000000001'),
 3333::bigint,'approved change fee preserves basis'
);
select is(
 (select fee_cents from change_fee_snapshots where change_snapshot_id='99000000-0000-0000-0000-000000000001'),
 333::bigint,'approved change fee rounds half up'
);
select is(
 (select tax_cents from change_fee_snapshots where change_snapshot_id='99000000-0000-0000-0000-000000000001'),
 43::bigint,'approved change fee tax rounds half up'
);
select throws_ok(
 $$update change_snapshots set amount_cents=1 where id='99000000-0000-0000-0000-000000000001'$$,
 'P0001','change_snapshots is immutable','approved change snapshot is immutable'
);
select throws_ok(
 $$insert into change_orders(request_id,description,amount_cents,items,evidence_ids,approval_status,approved_at) values('44000000-0000-0000-0000-000000000001','Overflow',99990000,'[]','{}','approved',clock_timestamp())$$,
 'P0001','stripe aggregate amount limit exceeded','quote plus approved changes respects Stripe maximum'
);

update service_requests set work_scope_snapshot='{"symptom":"leak","location":"sink","dimensions":"1.5in","access":"open","desiredTime":"2026-09-08T00:00:00Z","photos":[],"exclusions":[]}',triage='{"category":"plumbing","urgency":"routine","possibleCauses":["trap"],"confidence":0.8,"questions":[],"hazards":[]}',price_disclosure='{"source":"regional","sampleCount":12,"updatedAt":"2026-09-05T00:00:00Z","confidence":0.5}' where id='44000000-0000-0000-0000-000000000001';
select throws_ok($$update service_requests set work_scope_snapshot='{"symptom":"tampered"}' where id='44000000-0000-0000-0000-000000000001'$$,'P0001','work scope snapshot is immutable','work scope cannot be overwritten');
select ok(not ((select price_disclosure from service_requests where id='44000000-0000-0000-0000-000000000001')?'priceCents'),'low-sample disclosure contains no price');
select is((select price_cents from quote_ranking_snapshots where quote_id='55000000-0000-0000-0000-000000000001'),10001::bigint,'quote ranking freezes price');
select throws_ok($$delete from quote_ranking_snapshots where quote_id='55000000-0000-0000-0000-000000000001'$$,'P0001','quote_ranking_snapshots is immutable','quote ranking snapshot is immutable');
insert into deletion_requests(id,profile_id) values('ab000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001');
insert into request_media(id,request_id,owner_id,file_name,content_type,size_bytes,object_path,checksum,privacy_deletion_id) values('ac000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','sink.jpg','image/jpeg',100,'44000000-0000-0000-0000-000000000001/11000000-0000-0000-0000-000000000001/ac000000-0000-0000-0000-000000000001-sink.jpg','0000000000000000000000000000000000000000000000000000000000000000','ab000000-0000-0000-0000-000000000001');
select ok((select is_private from request_media where id='ac000000-0000-0000-0000-000000000001'),'media is always private');
select is(
  (reserve_intake_media('ac000000-0000-0000-0000-000000000002','44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','reserved.jpg','image/jpeg',100,'1111111111111111111111111111111111111111111111111111111111111111','11000000-0000-0000-0000-000000000001/44000000-0000-0000-0000-000000000001/intake/1111111111111111111111111111111111111111111111111111111111111111.jpg')).id,
  'ac000000-0000-0000-0000-000000000002'::uuid,'canonical media reservation creates a pending claim'
);
select is(
  (reserve_intake_media('ac000000-0000-0000-0000-000000000003','44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','retry.jpg','image/jpeg',100,'1111111111111111111111111111111111111111111111111111111111111111','11000000-0000-0000-0000-000000000001/44000000-0000-0000-0000-000000000001/intake/1111111111111111111111111111111111111111111111111111111111111111.jpg')).id,
  'ac000000-0000-0000-0000-000000000002'::uuid,'reservation conflict atomically returns the canonical claim'
);
select ok(not has_function_privilege('authenticated','reserve_intake_media(uuid,uuid,uuid,text,text,bigint,text,text)','execute'),'canonical reservation is service-only');
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
select is((select count(*) from request_media),0::bigint,'pending reservation is absent from authenticated inventory');
reset role;
select throws_ok($$update request_media set sanitization_status='sanitized',exif_removal_status='failed' where id='ac000000-0000-0000-0000-000000000001'$$,'23514',null,'sanitized media requires EXIF removal');
select throws_ok(
  $$insert into request_media(id,request_id,owner_id,file_name,content_type,size_bytes,object_path,checksum) values('ac000000-0000-0000-0000-000000000002','44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','retry.jpg','image/jpeg',100,'retry-object','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '23505',null,'owner request and checksum uniquely identify canonical media'
);
select is(to_regprocedure('create_request_media(uuid,text,text,bigint,text,uuid)'),null,'legacy raw media create RPC is absent');
select is(to_regprocedure('resume_request_media(uuid)'),null,'legacy raw media resume RPC is absent');
select is(to_regprocedure('complete_request_media(uuid)'),null,'legacy raw media complete RPC is absent');
select is(to_regprocedure('operator_sanitize_media(uuid,text,text,text)'),null,'legacy operator sanitize RPC is absent');
select ok((select count(*) between 1400 and 1600 from generate_series(1,10000) n where ((get_byte(digest(n::text,'sha256'),0)*256+get_byte(digest(n::text,'sha256'),1))%100)<15),'new-provider exploration hash is approximately 15 percent');
insert into money_operations(id,kind,idempotency_key,fingerprint,request_id,amount_cents,provider_reference)
  values('ad000000-0000-0000-0000-000000000001','deposit','drain-observation','{}','44000000-0000-0000-0000-000000000001',2000,'pi_existing');
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(
  $$select observe_money_provider_status('ad000000-0000-0000-0000-000000000001','deposit','pi_existing','succeeded','evt_existing')$$,
  'drain records provider observation without completing money'
);
select is((select count(*) from money_provider_observations where claim_id='ad000000-0000-0000-0000-000000000001'),1::bigint,'drain provider observation is durable');
select is((select state from money_operations where id='ad000000-0000-0000-0000-000000000001'),'claimed','drain observation does not advance money state');

select * from finish();
rollback;
