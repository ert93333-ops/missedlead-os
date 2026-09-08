begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(3);

insert into profiles(id,role,display_name) values('00000000-0000-0000-0000-000000000006','customer','quota test');
select set_config('request.jwt.claim.role','service_role',true);
create temp table usage_results(step text primary key,result jsonb);

insert into usage_results values(
  'first',
  reserve_intake_usage('00000000-0000-0000-0000-000000000006',2,2,3,2,1)
);
select ok(
  (select (result->>'allowed')::boolean from usage_results where step='first'),
  'first reservation is allowed'
);

insert into usage_results values(
  'active',
  reserve_intake_usage('00000000-0000-0000-0000-000000000006',1,2,3,2,1)
);
select is(
  (select result->>'reason' from usage_results where step='active'),
  'account_active',
  'single flight is enforced'
);

select release_intake_usage(
  (select (result->>'leaseId')::uuid from usage_results where step='first'),
  '00000000-0000-0000-0000-000000000006'
);
insert into usage_results values(
  'quota',
  reserve_intake_usage('00000000-0000-0000-0000-000000000006',1,2,3,2,1)
);
select is(
  (select result->>'reason' from usage_results where step='quota'),
  'account_quota',
  'daily quota is enforced'
);

select * from finish();
rollback;
