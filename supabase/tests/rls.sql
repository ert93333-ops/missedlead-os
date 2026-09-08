begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(21);

insert into profiles(id, role, display_name) values
  ('10000000-0000-0000-0000-000000000001','customer','Customer A'),
  ('10000000-0000-0000-0000-000000000002','customer','Customer B'),
  ('20000000-0000-0000-0000-000000000001','provider','Invited provider'),
  ('20000000-0000-0000-0000-000000000002','provider','Uninvited provider'),
  ('20000000-0000-0000-0000-000000000003','provider','Suspended provider'),
  ('30000000-0000-0000-0000-000000000001','operator','Operator');
insert into operator_allowlist(user_id) values ('30000000-0000-0000-0000-000000000001');
update profiles set provider_status='approved',license_verified=true,license_expires_at=clock_timestamp()+interval '1 year',insurance_verified=true,insurance_expires_at=clock_timestamp()+interval '1 year',service_categories=array['general'],service_areas=array['Charlotte'] where id='20000000-0000-0000-0000-000000000001';
update profiles set provider_status='suspended',license_verified=true,license_expires_at=clock_timestamp()+interval '1 year',insurance_verified=true,insurance_expires_at=clock_timestamp()+interval '1 year',service_categories=array['general'],service_areas=array['Charlotte'] where id='20000000-0000-0000-0000-000000000003';
insert into service_requests(id, customer_id, description, service_address, safety_status) values
  ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A request','A address','cleared'),
  ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','B request','B address','cleared');
insert into request_matches(request_id, provider_id, rank, status) values
  ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'invited'),
  ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',2,'invited');
update service_requests set workflow_status='matched'
  where id='40000000-0000-0000-0000-000000000001';

set local role anon;
select throws_ok(
  $$select * from service_requests$$,
  '42501', null, 'anon has no direct request access'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*) from service_requests), 1::bigint, 'customer A sees only A');
select is((select id from service_requests), '40000000-0000-0000-0000-000000000001'::uuid, 'customer A sees its request');
select is((select count(*) from profiles), 1::bigint, 'customer A sees only own profile');
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"operator"},"user_metadata":{"role":"operator"}}',
  true
);
select is((select count(*) from service_requests), 1::bigint, 'forged JWT role metadata cannot widen customer RLS');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select is((select count(*) from service_requests), 1::bigint, 'customer B sees only B');
select is((select id from service_requests), '40000000-0000-0000-0000-000000000002'::uuid, 'customer B cannot see A');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*) from service_requests), 1::bigint, 'invited provider sees matched request');
select lives_ok(
  $$select submit_itemized_quote(
    '40000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'scope','Scoped work',
      'diagnosticCents',1000,
      'laborCents',7000,
      'materialsCents',1500,
      'taxCents',500,
      'totalCents',10000,
      'validUntil',clock_timestamp()+interval '7 days',
      'earliestStartAt',clock_timestamp()+interval '1 day',
      'warrantyDays',30,
      'siteVisitRequired',false,
      'permitRequired',false,
      'inspectionStatus','not_required'
    )
  )$$,
  'invited provider can submit a quote'
);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*) from service_requests), 0::bigint, 'uninvited provider sees no request');
select throws_ok(
  $$insert into quotes(request_id,provider_id,provider_name,scope,amount_cents,ranking_total_cents,ranking) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Uninvited provider','Forbidden',10000,10000,'{"totalCents":10000}')$$,
  '42501', null, 'uninvited provider cannot quote'
);

-- The migration has no provider suspension entity. A suspended identity is therefore
-- represented by removal of its active assignment, the only access grant in can_access_request.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*) from service_requests), 0::bigint, 'suspended assigned provider immediately loses read access');
select throws_ok(
  $$insert into evidence(request_id,submitted_by,kind,storage_path,sha256) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','before','x','x')$$,
  '42501', null, 'suspended provider cannot add evidence'
);

reset role;
update profiles set provider_status='approved',license_expires_at=clock_timestamp()-interval '1 second' where id='20000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*) from service_requests),0::bigint,'expired license denies assigned provider reads');
select throws_ok(
  $$select submit_itemized_quote(
    '40000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'scope','Denied scope',
      'diagnosticCents',1000,
      'laborCents',7000,
      'materialsCents',1500,
      'taxCents',500,
      'totalCents',10000,
      'validUntil',clock_timestamp()+interval '7 days',
      'earliestStartAt',clock_timestamp()+interval '1 day',
      'warrantyDays',30,
      'siteVisitRequired',false,
      'permitRequired',false,
      'inspectionStatus','not_required'
    )
  )$$,
  'P0001','provider ineligible','expired provider RPC is denied'
);

select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select is((select count(*) from service_requests), 2::bigint, 'allowlisted operator sees all requests');
select cmp_ok((select count(*) from audit_events), '>', 0::bigint, 'allowlisted operator can inspect immutable audit events');

reset role;
delete from operator_allowlist where user_id='30000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select is((select count(*) from service_requests), 0::bigint, 'removed operator immediately loses request access');
select is((select count(*) from audit_events), 0::bigint, 'removed operator immediately loses audit access');

reset role;
insert into operator_allowlist(user_id) values ('30000000-0000-0000-0000-000000000001');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is((select count(*) from service_requests), 2::bigint, 'service role bypasses request RLS');
select lives_ok(
  $$insert into audit_events(actor_id,actor,action,resource_type,resource_id,rationale,request_id,correlation_id,detail,created_at)
    values(
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      'service-test',
      'service_request',
      '40000000-0000-0000-0000-000000000001',
      'service role audit fixture',
      '40000000-0000-0000-0000-000000000001',
      'rls-service-audit-fixture',
      '{}',
      clock_timestamp()
    )$$,
  'service role can write server-owned audit events'
);

select * from finish();
rollback;
