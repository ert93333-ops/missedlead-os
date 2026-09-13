begin;

create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(12);

insert into service_zips(zip) values('28202') on conflict(zip) do nothing;

insert into profiles(id,role,display_name,provider_status,license_verified,license_expires_at,insurance_verified,insurance_expires_at,service_categories,service_areas) values
 ('15000000-0000-0000-0000-000000000001','customer','Customer',null,false,null,false,null,'{}','{}'),
 ('25000000-0000-0000-0000-000000000001','provider','Plumber 1','approved',true,clock_timestamp()+interval '1 year',true,clock_timestamp()+interval '1 year',array['plumbing'],array['28202']),
 ('25000000-0000-0000-0000-000000000002','provider','Plumber 2','approved',true,clock_timestamp()+interval '1 year',true,clock_timestamp()+interval '1 year',array['plumbing'],array['28202']),
 ('25000000-0000-0000-0000-000000000003','provider','Plumber 3','approved',true,clock_timestamp()+interval '1 year',true,clock_timestamp()+interval '1 year',array['plumbing'],array['28202']),
 ('25000000-0000-0000-0000-000000000004','provider','Plumber 4','approved',true,clock_timestamp()+interval '1 year',true,clock_timestamp()+interval '1 year',array['plumbing'],array['28202']),
 ('25000000-0000-0000-0000-000000000005','provider','HVAC only','approved',true,clock_timestamp()+interval '1 year',true,clock_timestamp()+interval '1 year',array['hvac'],array['28202']),
 ('25000000-0000-0000-0000-000000000006','provider','Expired','approved',true,clock_timestamp()-interval '1 second',true,clock_timestamp()+interval '1 year',array['plumbing'],array['28202']),
 ('25000000-0000-0000-0000-000000000007','provider','Other area','approved',true,clock_timestamp()+interval '1 year',true,clock_timestamp()+interval '1 year',array['plumbing'],array['28203']);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
select throws_ok(
  $$select confirm_intake('15000000-0000-0000-0000-000000000001','Customer','Address','Description','plumbing','{}','{"category":"plumbing","urgency":"routine","hazards":[]}','{}','direct-rpc')$$,
  '42501','service role required','authenticated clients cannot invoke trusted intake confirmation directly'
);
select set_config('request.jwt.claim.role','service_role',true);
select set_config('test.intake_result',confirm_intake(
  '15000000-0000-0000-0000-000000000001',
  'Customer','101 Tryon St, Charlotte, NC 28202','Water is leaking below the sink','plumbing',
  '{"symptom":"leak","location":"kitchen sink"}',
  '{"category":"plumbing","urgency":"routine","possibleCauses":["trap"],"confidence":0.8,"questions":[],"hazards":[]}',
  '{"source":"regional","sampleCount":40,"updatedAt":"2026-09-05T12:00:00Z","confidence":0.7,"priceCents":12500}',
  'assessment-signed-1'
)::text,true);

select is((current_setting('test.intake_result')::jsonb->>'status'),'matched','eligible providers move intake to matched');
select is((current_setting('test.intake_result')::jsonb->>'matchCount')::integer,3,'matching is capped at three providers');
select is((select count(*) from request_matches where request_id=(current_setting('test.intake_result')::jsonb->>'requestId')::uuid),3::bigint,'three match records are created atomically');
select is((select service_category from service_requests where id=(current_setting('test.intake_result')::jsonb->>'requestId')::uuid),'plumbing','confirmed category is stored');
select is((select work_scope_snapshot->>'symptom' from service_requests where id=(current_setting('test.intake_result')::jsonb->>'requestId')::uuid),'leak','approved work scope is stored');
select is((select triage->>'category' from service_requests where id=(current_setting('test.intake_result')::jsonb->>'requestId')::uuid),'plumbing','approved triage is stored');
select ok((select price_disclosure?'priceCents' from service_requests where id=(current_setting('test.intake_result')::jsonb->>'requestId')::uuid),'qualified price disclosure is preserved');
select is(
  confirm_intake('15000000-0000-0000-0000-000000000001','Changed','Changed','Changed','plumbing','{"symptom":"changed"}','{"category":"plumbing","urgency":"routine","hazards":[]}','{"source":"regional","sampleCount":0}','assessment-signed-1')->>'requestId',
  current_setting('test.intake_result')::jsonb->>'requestId',
  'repeated assessment confirmation returns the original request'
);
select is((select count(*) from service_requests where customer_id='15000000-0000-0000-0000-000000000001' and intake_assessment_id='assessment-signed-1'),1::bigint,'idempotent confirmation creates no duplicate request');
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok(
  format('update service_requests set work_scope_snapshot=''{"symptom":"tampered"}'' where id=%L',(current_setting('test.intake_result')::jsonb->>'requestId')::uuid),
  'P0001','work scope snapshot is immutable','confirmed intake snapshots cannot be overwritten'
);

select throws_ok(
  $$select confirm_intake('25000000-0000-0000-0000-000000000001','Provider','Address','Description','plumbing','{}','{"category":"plumbing","urgency":"routine","hazards":[]}','{}','provider-assessment')$$,
  '42501','customer required','providers cannot create customer intake through the definer function'
);

select * from finish();
rollback;
