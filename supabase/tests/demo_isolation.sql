begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(8);
select set_config('request.jwt.claim.role','service_role',true);
insert into service_zips(zip) values('28202') on conflict(zip) do nothing;
insert into profiles(id,role,display_name,is_demo) values
 ('18000000-0000-0000-0000-000000000001','customer','Demo',true),
 ('18000000-0000-0000-0000-000000000002','customer','Real',false);
insert into profiles(id,role,display_name,is_demo,provider_status,license_verified,license_expires_at,insurance_verified,insurance_expires_at,service_categories,service_areas)
values ('18000000-0000-0000-0000-000000000003','provider','Fictional test',true,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('18000000-0000-0000-0000-000000000004','provider','Real provider',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}');
select is(demo_seed_ready(),true,'service can check isolation contract');
select confirm_intake('18000000-0000-0000-0000-000000000001','Demo','28202','Leak','plumbing','{}','{"category":"plumbing","hazards":[]}','{}','demo-isolation');
select confirm_intake('18000000-0000-0000-0000-000000000002','Real','28202','Leak','plumbing','{}','{"category":"plumbing","hazards":[]}','{}','real-isolation');
select is((select count(*) from request_matches m join profiles p on p.id=m.provider_id join service_requests r on r.id=m.request_id where r.customer_id='18000000-0000-0000-0000-000000000001' and not p.is_demo),0::bigint,'demo never matches real providers');
select is((select count(*) from request_matches m join profiles p on p.id=m.provider_id join service_requests r on r.id=m.request_id where r.customer_id='18000000-0000-0000-0000-000000000002' and p.is_demo),0::bigint,'real never matches fictional providers');
select throws_ok($$insert into request_matches(request_id,provider_id,rank) select id,'18000000-0000-0000-0000-000000000004',3 from service_requests where customer_id='18000000-0000-0000-0000-000000000001'$$,'42501','demo_match_isolation','manual matching cannot cross boundary');
select throws_ok($$update profiles set role='operator' where id='18000000-0000-0000-0000-000000000001'$$,'42501','demo_financial_access_disabled','demo cannot become operator');
select throws_ok($$insert into money_operations(kind,idempotency_key,fingerprint,request_id,amount_cents) select 'deposit','demo-money','{}',id,100 from service_requests where customer_id='18000000-0000-0000-0000-000000000001'$$,'42501','demo_payments_disabled','demo cannot reserve a real payment');
select throws_ok($$update profiles set is_demo=false where id='18000000-0000-0000-0000-000000000001'$$,'42501','demo_marker_in_use','used demo cannot be relabeled');
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$insert into profiles(id,role,display_name,is_demo) values(gen_random_uuid(),'customer','Untrusted',true)$$,'42501','demo_marker_service_only','caller cannot opt into demo access');
select * from finish();
rollback;
