begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(10);
insert into profiles(id,role,display_name) values
 ('1a000000-0000-0000-0000-000000000001','customer','Lifecycle owner'),
 ('1a000000-0000-0000-0000-000000000002','customer','Lifecycle other'),
 ('1a000000-0000-0000-0000-000000000003','operator','Lifecycle operator');
insert into operator_allowlist(user_id) values('1a000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','1a000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
select lives_ok($$select set_service_zips(array['28202'])$$,'operator configures coverage');
insert into customer_properties(customer_id,label,address,zip,building_type) values('1a000000-0000-0000-0000-000000000001','Home','123 Example Street','28202','house');
select lives_ok($$select set_service_zips(array['28203'])$$,'coverage can change after a saved property');
select is((select zip from customer_properties where customer_id='1a000000-0000-0000-0000-000000000001'),'28202','saved property keeps historical address');
select throws_ok($$select set_service_zips(null)$$,'P0001','invalid_zip_codes','null coverage rejected');
select throws_ok($$select set_service_zips(array[null]::text[])$$,'P0001','invalid_zip_codes','null ZIP rejected');
insert into service_requests(id,customer_id,description,service_address) values('1a000000-0000-0000-0000-000000000004','1a000000-0000-0000-0000-000000000001','Test plumbing issue','123 Example Street 28202');
insert into payment_attempts(request_id,kind,amount_cents,provider_reference,client_secret,idempotency_key) values('1a000000-0000-0000-0000-000000000004','deposit',100,'pi_lifecycle_test','test-secret','lifecycle-test');
set local role authenticated;
select set_config('request.jwt.claim.sub','1a000000-0000-0000-0000-000000000001',true);
select is((select count(*) from payment_attempts where idempotency_key='lifecycle-test'),1::bigint,'customer reads own pending payment');
select throws_ok($$update payment_attempts set state='succeeded' where idempotency_key='lifecycle-test'$$,'42501',null,'customer cannot change payment state');
select throws_ok($$select set_service_zips(array['28202'])$$,'P0001','operator_required','customer cannot change coverage');
select set_config('request.jwt.claim.sub','1a000000-0000-0000-0000-000000000002',true);
select is((select count(*) from payment_attempts where idempotency_key='lifecycle-test'),0::bigint,'another customer cannot read payment secret');
select is((select count(*) from customer_properties where customer_id='1a000000-0000-0000-0000-000000000001'),0::bigint,'another customer cannot read saved address');
reset role;
select * from finish();
rollback;
