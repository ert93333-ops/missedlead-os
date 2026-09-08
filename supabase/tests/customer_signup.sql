begin;

create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(9);

insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
values(
  '16000000-0000-0000-0000-000000000001',
  'malicious-role@example.com',
  '{"display_name":"New Customer","role":"operator","provider_status":"approved"}',
  '{"role":"operator","provider_status":"approved"}'
);

select is((select role from profiles where id='16000000-0000-0000-0000-000000000001'),'customer','signup always creates a customer role');
select is((select display_name from profiles where id='16000000-0000-0000-0000-000000000001'),'New Customer','signup preserves the customer display name');
select is((select provider_status from profiles where id='16000000-0000-0000-0000-000000000001'),null,'signup metadata cannot approve a provider');
select is((select count(*) from operator_allowlist where user_id='16000000-0000-0000-0000-000000000001'),0::bigint,'forged signup metadata cannot add an operator allowlist entry');

insert into profiles(id,role,display_name,provider_status)
values('16000000-0000-0000-0000-000000000002','provider','Existing Provider','pending');
insert into auth.users(id,email,raw_user_meta_data)
values(
  '16000000-0000-0000-0000-000000000002',
  'existing-provider@example.com',
  '{"display_name":"Overwrite Attempt","role":"operator"}'
);

select is((select role from profiles where id='16000000-0000-0000-0000-000000000002'),'provider','signup does not downgrade an existing profile');
select is((select display_name from profiles where id='16000000-0000-0000-0000-000000000002'),'Existing Provider','signup does not overwrite an existing profile');
select is((select count(*) from auth.users u left join profiles p on p.id=u.id where p.id is null),0::bigint,'all existing auth users have a profile after backfill');
select ok(exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='auth_user_created_customer_profile' and not tgisinternal),'customer profile trigger is installed');
select ok(
  not has_function_privilege('anon','public.handle_new_customer_profile()','EXECUTE')
  and not has_function_privilege('authenticated','public.handle_new_customer_profile()','EXECUTE'),
  'client roles cannot execute the trigger function directly'
);

select * from finish();
rollback;
