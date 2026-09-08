begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(20);

insert into profiles(id,role,display_name,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled,stripe_details_submitted) values
 ('13000000-0000-0000-0000-000000000001','customer','Customer',null,false,false,false),
 ('24000000-0000-0000-0000-000000000001','provider','Provider','acct_recovery',true,true,true);
insert into fee_policies(id,version,effective_from,founder_only,fee_rate_bps,tax_rate_bps,stripe_fee_treatment,refund_treatment,rounding)
 values('ac000000-0000-0000-0000-000000000001',1,clock_timestamp()-interval '1 day',false,1000,0,'included','fee_retained','half_up');
insert into service_requests(id,customer_id,description,service_address,safety_status,workflow_status) values
 ('46000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','Recovery request','Address','cleared','settled'),
 ('46000000-0000-0000-0000-000000000002','13000000-0000-0000-0000-000000000001','Stuck request','Address','cleared','funded');
insert into quotes(id,request_id,provider_id,provider_name,scope,amount_cents,ranking_total_cents,ranking,status) values
 ('57000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','Provider','Work',10000,10000,'{"totalCents":10000}','accepted'),
 ('57000000-0000-0000-0000-000000000002','46000000-0000-0000-0000-000000000002','24000000-0000-0000-0000-000000000001','Provider','Work',10000,10000,'{"totalCents":10000}','accepted');
insert into quote_snapshots(id,quote_id,request_id,provider_id,scope,amount_cents) values
 ('68000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','Work',10000),
 ('68000000-0000-0000-0000-000000000002','57000000-0000-0000-0000-000000000002','46000000-0000-0000-0000-000000000002','24000000-0000-0000-0000-000000000001','Work',10000);
insert into quote_details(quote_id,request_id,diagnostic_cents,labor_cents,materials_cents,tax_cents,valid_until,site_visit_required,permit_required,inspection_status) values
 ('57000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001',0,10000,0,0,clock_timestamp()+interval '7 days',false,false,'not_required'),
 ('57000000-0000-0000-0000-000000000002','46000000-0000-0000-0000-000000000002',0,10000,0,0,clock_timestamp()+interval '7 days',false,false,'not_required');
insert into jobs(request_id,accepted_quote_snapshot_id,deposit_cents,work_status,payment_status,completed_at,settled_at,settlement_state) values
 ('46000000-0000-0000-0000-000000000001','68000000-0000-0000-0000-000000000001',2000,'settled','paid',clock_timestamp()-interval '4 days',clock_timestamp()-interval '1 day','settled'),
 ('46000000-0000-0000-0000-000000000002','68000000-0000-0000-0000-000000000002',2000,'funded','deposit_paid',null,null,'none');

insert into stripe_webhook_events(event_id,event_type,object_id,request_id,payload_sha256)
 values('evt_once','charge.dispute.created','dp_once','46000000-0000-0000-0000-000000000001','hash');
select throws_ok(
 $$insert into stripe_webhook_events(event_id,event_type,object_id,request_id,payload_sha256) values('evt_once','charge.dispute.updated','dp_other','46000000-0000-0000-0000-000000000001','hash2')$$,
 '23505',null,'webhook event id is idempotent'
);
insert into stripe_dispute_objects(external_id,request_id,status)
 values('dp_once','46000000-0000-0000-0000-000000000001','under_review');
select throws_ok(
 $$insert into stripe_dispute_objects(external_id,request_id,status) values('dp_once','46000000-0000-0000-0000-000000000002','lost')$$,
 '23505',null,'external dispute object id is idempotent'
);

insert into money_operations(id,kind,idempotency_key,fingerprint,request_id,external_object_id,amount_cents,claimed_at)
 values('79000000-0000-0000-0000-000000000001','external_dispute','dispute:dp_once:1','{"amount_cents":10000}','46000000-0000-0000-0000-000000000001','dp_once',10000,clock_timestamp()-interval '2 hours');
select is(
 (select provider_idempotency_key from money_operations where id='79000000-0000-0000-0000-000000000001'),
 'reversal:79000000-0000-0000-0000-000000000001','reversal retry key is stable from claim id'
);
update money_operations set state='failed',failure_reason='temporary' where id='79000000-0000-0000-0000-000000000001';
select is(
 (select provider_idempotency_key from money_operations where id='79000000-0000-0000-0000-000000000001'),
 'reversal:79000000-0000-0000-0000-000000000001','failure does not rotate reversal retry key'
);

insert into disputes(id,request_id,source,status,reason,external_id,external_version)
 values('8a000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','external','under_review','chargeback','dp_once',1);
insert into payments(request_id,kind,status,amount_cents,provider_reference,idempotency_key)
 values('46000000-0000-0000-0000-000000000001','reversal','succeeded',6000,'reversal_partial','reverse-1');
select is((select amount_cents from receivables where request_id='46000000-0000-0000-0000-000000000001'),4000::bigint,'partial lost reversal creates receivable');
select is((select command from manual_resolution_commands where request_id='46000000-0000-0000-0000-000000000001'),'collect_receivable','lost amount queues collection command');
select is((select settlement_state from jobs where request_id='46000000-0000-0000-0000-000000000001'),'manual_action','lost partial reversal requires manual action');

update disputes set status='won',external_version=2 where id='8a000000-0000-0000-0000-000000000001';
select is((select count(*) from money_operations where request_id='46000000-0000-0000-0000-000000000001' and kind='recovery'),1::bigint,'won dispute queues one retransfer');
select is((select amount_cents from money_operations where request_id='46000000-0000-0000-0000-000000000001' and kind='recovery'),6000::bigint,'won retransfer matches reversed funds');
select is((select destination_account from money_operations where request_id='46000000-0000-0000-0000-000000000001' and kind='recovery'),'acct_recovery','won retransfer preserves provider destination');
update disputes set reason='duplicate delivery' where id='8a000000-0000-0000-0000-000000000001';
select is((select count(*) from money_operations where request_id='46000000-0000-0000-0000-000000000001' and kind='recovery'),1::bigint,'won recovery is not queued twice');

insert into money_operations(id,kind,idempotency_key,fingerprint,request_id,amount_cents,claimed_at,state) values
 ('79000000-0000-0000-0000-000000000002','deposit','stuck-claimed','{}','46000000-0000-0000-0000-000000000002',2000,clock_timestamp()-interval '2 hours','claimed');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is((select count(*) from stuck_money_claims(clock_timestamp()-interval '1 hour') c where c->>'claim_id'='79000000-0000-0000-0000-000000000002'),1::bigint,'stuck claim is recoverable');
select lives_ok(
 $$select recovery_complete((select id from money_operations where request_id='46000000-0000-0000-0000-000000000001' and kind='recovery'),'tr_recovered','{}')$$,
 'won retransfer recovery completes'
);
select is((select state from money_operations where request_id='46000000-0000-0000-0000-000000000001' and kind='recovery'),'completed','completed recovery is terminal');

insert into payments(request_id,kind,status,amount_cents,provider_reference,idempotency_key) values
 ('46000000-0000-0000-0000-000000000002','deposit','succeeded',2000,'pi_refund_dep','refund-dep'),
 ('46000000-0000-0000-0000-000000000002','balance','succeeded',8000,'pi_refund_bal','refund-bal');
select lives_ok($$select refund_claim('46000000-0000-0000-0000-000000000002',2500,'partial refund','refund-claim')$$,'refund claim executes with qualified identifiers');
select is((select sum(amount_cents) from refund_allocations where operation_id=(select id from money_operations where idempotency_key='refund-claim')),2500::numeric,'refund allocations cover exact amount');

insert into payments(request_id,kind,status,amount_cents,provider_reference,idempotency_key) values
 ('46000000-0000-0000-0000-000000000001','transfer','succeeded',10000,'tr_dispute_lifecycle','transfer-lifecycle');
select lives_ok($$select external_dispute_claim('46000000-0000-0000-0000-000000000001','dp_lifecycle','created','evt_lifecycle_created','charge.dispute.created','under_review',1000,'hash-created','evt_lifecycle_created')$$,'external dispute create is ingested');
select lives_ok($$select external_dispute_complete((select id from money_operations where idempotency_key='evt_lifecycle_created'),null,'{}')$$,'external dispute create completes');
select lives_ok($$select external_dispute_claim('46000000-0000-0000-0000-000000000001','dp_lifecycle','updated','evt_lifecycle_updated','charge.dispute.updated','under_review',1000,'hash-updated','evt_lifecycle_updated')$$,'external dispute update is independently ingested');
select lives_ok($$select external_dispute_claim('46000000-0000-0000-0000-000000000001','dp_lifecycle','closed','evt_lifecycle_closed','charge.dispute.closed','won',1000,'hash-closed','evt_lifecycle_closed')$$,'external dispute close is independently ingested');

select * from finish();
rollback;
