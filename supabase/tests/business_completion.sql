begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(30);
insert into profiles(id,role,display_name) values
('19000000-0000-0000-0000-000000000001','customer','Owner'),
('19000000-0000-0000-0000-000000000002','customer','Approver'),
('19000000-0000-0000-0000-000000000003','customer','Outsider');
insert into service_requests(id,customer_id,description,service_address,created_at) values
('39000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Door repair','100 Test Road', '2026-06-01'),
('39000000-0000-0000-0000-000000000002','19000000-0000-0000-0000-000000000003','Other repair','200 Other Road','2026-06-01');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
select set_config('test.org',(business_create_organization('Test Business')).id::text,true);
select set_config('test.location',(business_add_location(current_setting('test.org')::uuid,'Shop','100 Test Road')).id::text,true);
select lives_ok($$select business_set_member(current_setting('test.org')::uuid,'19000000-0000-0000-0000-000000000002','approver')$$,'owner adds existing approver');
select lives_ok($$select business_link_request(current_setting('test.org')::uuid,current_setting('test.location')::uuid,'39000000-0000-0000-0000-000000000001',true,'Shop cannot open')$$,'own real request linked');
select throws_ok($$select business_link_request(current_setting('test.org')::uuid,current_setting('test.location')::uuid,'39000000-0000-0000-0000-000000000002',false,'')$$,'42501','own request and membership required','cannot attach another customer request');
select is((business_annual_report(current_setting('test.org')::uuid,2026)->>'request_count')::integer,1,'annual report counts actual linked request');
select is((business_annual_report(current_setting('test.org')::uuid,2026)->>'paid_cents')::bigint,0::bigint,'no invented payments');
select is((business_annual_report(current_setting('test.org')::uuid,2026)->>'interruption_count')::integer,1,'business interruption is reported');
select throws_ok($$select business_link_request(current_setting('test.org')::uuid,current_setting('test.location')::uuid,'39000000-0000-0000-0000-000000000001',false,'changed')$$,'22023','request association is immutable','cannot rewrite request association');
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000003',true);
select throws_ok($$select business_annual_report(current_setting('test.org')::uuid,2026)$$,'42501','membership required','outsider cannot report');
set local role authenticated;
select is((select count(*) from business_organizations),0::bigint,'RLS hides organization from outsider');
select is((select count(*) from business_locations),0::bigint,'RLS hides locations from outsider');
select throws_ok($$insert into business_organizations(owner_id,name) values(auth.uid(),'Bypass')$$,'42501',null,'direct writes denied');
reset role;
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select count(*) from business_locations),1::bigint,'member can read organization location');
select throws_ok($$select business_set_member(current_setting('test.org')::uuid,'19000000-0000-0000-0000-000000000003','approver')$$,'42501','owner required','approver cannot assign roles');
select throws_ok($$select notify_user(auth.uid(),null,'test','Fake','Fake','fake-key')$$,'42501',null,'clients cannot forge notifications');
reset role;
select notify_user('19000000-0000-0000-0000-000000000001',null,'test','Notice','Body','business-test-notice');
select notify_user('19000000-0000-0000-0000-000000000001',null,'test','Notice','Body','business-test-notice');
select is((select count(*) from user_notifications where event_key='business-test-notice'),1::bigint,'notification producer is idempotent');
select throws_ok(format('select notification_mark_read(%L)',(select id from user_notifications where event_key='business-test-notice')),'42501','notification not found','cannot read another inbox item');
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
select ok((notification_mark_read((select id from user_notifications where event_key='business-test-notice'))).read_at is not null,'recipient marks read');
select is((business_annual_report(current_setting('test.org')::uuid,2025)->>'request_count')::integer,0,'calendar year excludes later request');
select ok((select count(*) from audit_events where action='business.request_linked' and request_id='39000000-0000-0000-0000-000000000001')>0,'request association audit retained');
select throws_ok($$select business_annual_report(current_setting('test.org')::uuid,1999)$$,'22023','invalid year','year validated');
insert into profiles(id,role,display_name,provider_status) values('29000000-0000-0000-0000-000000000001','provider','Test technician','approved');
insert into quotes(id,request_id,provider_id,provider_name,scope,amount_cents,created_at) values('49000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','Test technician','Door repair',12000,'2026-06-02');
select set_config('test.approval',(business_request_approval(current_setting('test.org')::uuid,'49000000-0000-0000-0000-000000000001')).id::text,true);
select is((select amount_cents from business_approvals where id=current_setting('test.approval')::uuid),12000::bigint,'approval amount comes from actual quote');
select throws_ok($$select business_decide_approval(current_setting('test.approval')::uuid,'approved','My quote')$$,'42501','another approver required','requester cannot self approve');
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000002',true);
select is((business_decide_approval(current_setting('test.approval')::uuid,'approved','Reviewed scope')).status,'approved','designated approver decides');
select throws_ok($$select business_decide_approval(current_setting('test.approval')::uuid,'rejected','Changed mind')$$,'22023','approval decision is immutable','decision cannot be rewritten');
select is((select count(*) from payments where request_id='39000000-0000-0000-0000-000000000001'),0::bigint,'internal approval does not charge');
select is((select status from quotes where id='49000000-0000-0000-0000-000000000001'),'submitted','internal approval does not accept quote');
insert into payments(request_id,kind,status,amount_cents,idempotency_key,created_at) values
('39000000-0000-0000-0000-000000000001','deposit','succeeded',2400,'business-test-deposit','2026-06-02'),
('39000000-0000-0000-0000-000000000001','balance','failed',9600,'business-test-failed','2026-06-02'),
('39000000-0000-0000-0000-000000000001','transfer','succeeded',2000,'business-test-transfer','2026-06-02'),
('39000000-0000-0000-0000-000000000001','refund','succeeded',400,'business-test-refund','2026-06-03');
select is((business_annual_report(current_setting('test.org')::uuid,2026)->>'paid_cents')::bigint,2400::bigint,'cash report excludes failed payments and provider transfers');
select is((business_annual_report(current_setting('test.org')::uuid,2026)->>'net_paid_cents')::bigint,2000::bigint,'cash report subtracts actual refund');
select is((select count(*) from user_notifications where kind='quote' and request_id='39000000-0000-0000-0000-000000000001'),1::bigint,'actual quote insertion creates inbox event');
select ok(exists(select 1 from audit_events where action='business.approval_approved' and resource_id=current_setting('test.approval')),'expense decision has immutable audit');
select * from finish();
rollback;
