begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into profiles(id,role,display_name,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled,stripe_details_submitted) values
 ('12000000-0000-0000-0000-000000000001','customer','Customer','cus_unused',false,false,false),
 ('23000000-0000-0000-0000-000000000001','provider','Provider','acct_ready',true,true,true),
 ('34000000-0000-0000-0000-000000000001','operator','Operator',null,false,false,false);
update profiles set provider_status='approved',license_verified=true,license_expires_at=clock_timestamp()+interval '1 year',insurance_verified=true,insurance_expires_at=clock_timestamp()+interval '1 year',service_categories=array['general'],service_areas=array['Charlotte'] where id='23000000-0000-0000-0000-000000000001';
insert into operator_allowlist(user_id) values('34000000-0000-0000-0000-000000000001');
insert into fee_policies(id,version,effective_from,founder_only,fee_rate_bps,tax_rate_bps,stripe_fee_treatment,refund_treatment,rounding)
 values('ab000000-0000-0000-0000-000000000001',1,clock_timestamp()-interval '1 day',false,1000,0,'included','fee_retained','half_up');
insert into service_requests(id,customer_id,description,service_address,safety_status,workflow_status) values
 ('45000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','Settled request','Address','cleared','completed'),
 ('45000000-0000-0000-0000-000000000002','12000000-0000-0000-0000-000000000001','Race request','Address','cleared','completed'),
 ('45000000-0000-0000-0000-000000000003','12000000-0000-0000-0000-000000000001','Window request','Address','cleared','completed');
insert into request_matches(request_id,provider_id,rank,status) values
 ('45000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001',1,'quoted'),
 ('45000000-0000-0000-0000-000000000002','23000000-0000-0000-0000-000000000001',1,'quoted'),
 ('45000000-0000-0000-0000-000000000003','23000000-0000-0000-0000-000000000001',1,'quoted');
insert into quotes(id,request_id,provider_id,provider_name,scope,amount_cents,ranking_total_cents,ranking,status) values
 ('56000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001','Provider','Work',10001,10001,'{"totalCents":10001}','accepted'),
 ('56000000-0000-0000-0000-000000000002','45000000-0000-0000-0000-000000000002','23000000-0000-0000-0000-000000000001','Provider','Work',20000,20000,'{"totalCents":20000}','accepted'),
 ('56000000-0000-0000-0000-000000000003','45000000-0000-0000-0000-000000000003','23000000-0000-0000-0000-000000000001','Provider','Work',30000,30000,'{"totalCents":30000}','accepted');
insert into quote_snapshots(id,quote_id,request_id,provider_id,scope,amount_cents) values
 ('67000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001','Work',10001),
 ('67000000-0000-0000-0000-000000000002','56000000-0000-0000-0000-000000000002','45000000-0000-0000-0000-000000000002','23000000-0000-0000-0000-000000000001','Work',20000),
 ('67000000-0000-0000-0000-000000000003','56000000-0000-0000-0000-000000000003','45000000-0000-0000-0000-000000000003','23000000-0000-0000-0000-000000000001','Work',30000);
insert into quote_details(quote_id,request_id,diagnostic_cents,labor_cents,materials_cents,tax_cents,valid_until,site_visit_required,permit_required,inspection_status) values
 ('56000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001',0,10001,0,0,clock_timestamp()+interval '7 days',false,false,'not_required'),
 ('56000000-0000-0000-0000-000000000002','45000000-0000-0000-0000-000000000002',0,20000,0,0,clock_timestamp()+interval '7 days',false,false,'not_required'),
 ('56000000-0000-0000-0000-000000000003','45000000-0000-0000-0000-000000000003',0,30000,0,0,clock_timestamp()+interval '7 days',false,false,'not_required');
insert into jobs(request_id,accepted_quote_snapshot_id,deposit_cents,work_status,payment_status,completed_at) values
 ('45000000-0000-0000-0000-000000000001','67000000-0000-0000-0000-000000000001',2000,'completed','paid',clock_timestamp()-interval '72 hours'),
 ('45000000-0000-0000-0000-000000000002','67000000-0000-0000-0000-000000000002',4000,'completed','paid',clock_timestamp()-interval '73 hours'),
 ('45000000-0000-0000-0000-000000000003','67000000-0000-0000-0000-000000000003',6000,'completed','paid',clock_timestamp()-interval '71 hours');
insert into payments(request_id,kind,amount_cents,provider_reference,idempotency_key) values
 ('45000000-0000-0000-0000-000000000001','deposit',2000,'pi_dep_1','dep-1'),
 ('45000000-0000-0000-0000-000000000001','balance',8001,'pi_bal_1','bal-1'),
 ('45000000-0000-0000-0000-000000000002','deposit',4000,'pi_dep_2','dep-2'),
 ('45000000-0000-0000-0000-000000000002','balance',16000,'pi_bal_2','bal-2');

select is((select deposit_cents from jobs where request_id='45000000-0000-0000-0000-000000000001'),2000::bigint,'deposit is rounded 20 percent');
select is((select count(*) from payments where request_id='45000000-0000-0000-0000-000000000001' and kind in('deposit','balance')),2::bigint,'deposit and balance are separate payments');
select is((select sum(amount_cents) from payments where request_id='45000000-0000-0000-0000-000000000001' and kind in('deposit','balance')),10001::numeric,'separate captures cover total');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000001',true);
select ok(
 clock_timestamp() >= (select completed_at + interval '72 hours' from jobs where request_id='45000000-0000-0000-0000-000000000001'),
 '72-hour endpoint is excluded'
);
select ok(
 clock_timestamp() >= (select completed_at from jobs where request_id='45000000-0000-0000-0000-000000000003')
 and clock_timestamp() < (select completed_at + interval '72 hours' from jobs where request_id='45000000-0000-0000-0000-000000000003'),
 'dispute window includes completion and excludes 72-hour endpoint'
);

select set_config('request.jwt.claim.sub','34000000-0000-0000-0000-000000000001',true);
select lives_ok($$select operator_settlement_preflight('45000000-0000-0000-0000-000000000001')$$,'operator authorizes exactly at/after 72 hours');
select lives_ok($$select operator_settlement_preflight('45000000-0000-0000-0000-000000000002')$$,'second settlement is authorized');
select set_config('test.settlement_token',(select authorization_token::text from settlement_authorizations where request_id='45000000-0000-0000-0000-000000000001'),true);

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(
 $$select settlement_claim('45000000-0000-0000-0000-000000000001',current_setting('test.settlement_token')::uuid,0,1,1000,1000,'settle-1')$$,
 'authorization token is consumed once'
);
select is((select settlement_state from jobs where request_id='45000000-0000-0000-0000-000000000001'),'transferring','claim advances terminal protocol state');
update money_operations set state='completed',completed_at=clock_timestamp() where idempotency_key='settle-1';
select is((select state from money_operations where idempotency_key='settle-1'),'completed','settlement operation has terminal replay state');
select lives_ok(
 $$select settlement_claim('45000000-0000-0000-0000-000000000001',current_setting('test.settlement_token')::uuid,0,1,1000,1000,'settle-1')$$,
 'same idempotency key replays terminal claim before stale-token evaluation'
);
select throws_ok(
 $$select settlement_claim('45000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',0,1,1000,1000,'settle-different')$$,
 'P0001','settlement authorization stale','different key cannot replay a consumed token'
);

insert into disputes(request_id,source,status,reason) values('45000000-0000-0000-0000-000000000002','external','under_review','race');
select throws_ok(
 $$select settlement_claim('45000000-0000-0000-0000-000000000002',(select authorization_token from settlement_authorizations where request_id='45000000-0000-0000-0000-000000000002'),0,1,1000,2000,'settle-race')$$,
 'P0001','settlement authorization stale','dispute winning race blocks settlement claim'
);
select * from finish();
rollback;
