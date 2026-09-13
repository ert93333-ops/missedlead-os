begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(24);
select set_config('request.jwt.claim.role','service_role',true);

insert into profiles(id,role,display_name,is_demo) values
 ('31000000-0000-0000-0000-000000000001','customer','Real customer',false),
 ('31000000-0000-0000-0000-000000000002','customer','Demo customer',true);
insert into profiles(
  id,role,display_name,is_demo,provider_status,license_verified,license_expires_at,
  insurance_verified,insurance_expires_at,service_categories,service_areas
) values
 ('31000000-0000-0000-0000-000000000011','provider','Plumber 1',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('31000000-0000-0000-0000-000000000012','provider','Plumber 2',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('31000000-0000-0000-0000-000000000013','provider','Plumber 3',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('31000000-0000-0000-0000-000000000014','provider','Plumber 4',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('31000000-0000-0000-0000-000000000015','provider','General only',false,'approved',true,'2099-01-01',true,'2099-01-01','{general}','{28202,28204}'),
 ('31000000-0000-0000-0000-000000000016','provider','Other ZIP',false,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28203}'),
 ('31000000-0000-0000-0000-000000000017','provider','Demo plumber',true,'approved',true,'2099-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('31000000-0000-0000-0000-000000000018','provider','Expired plumber',false,'approved',true,'2000-01-01',true,'2099-01-01','{plumbing}','{28202}'),
 ('31000000-0000-0000-0000-000000000019','provider','Expired handyman',false,'approved',true,'2000-01-01',true,'2099-01-01','{handyman}','{28202}'),
 ('31000000-0000-0000-0000-000000000020','provider','HVAC provider',false,'approved',true,'2099-01-01',true,'2099-01-01','{hvac}','{28202}');

insert into service_requests(
  id,customer_id,description,service_address,workflow_status,safety_status,expanded_search,
  service_category,service_area,triage,work_scope_snapshot,price_disclosure_accepted,intake_assessment_id,created_at
) values
 ('41000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','Zero match','Address','intake','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-zero','2026-09-07T11:59:59Z'),
 ('41000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002','Demo','Address','intake','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-demo','2026-09-07T11:59:59Z'),
 ('41000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000001','ZIP','Address','intake','cleared',true,'plumbing','28203','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-zip','2026-09-07T11:59:59Z'),
 ('41000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000001','Exact boundary','Address','intake','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-exact','2026-09-07T12:00:00Z'),
 ('41000000-0000-0000-0000-000000000005','31000000-0000-0000-0000-000000000001','Too new','Address','intake','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-new','2026-09-07T12:00:00.000001Z'),
 ('41000000-0000-0000-0000-000000000006','31000000-0000-0000-0000-000000000001','Funded','Address','funded','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-funded','2026-09-01T00:00:00Z'),
 ('41000000-0000-0000-0000-000000000007','31000000-0000-0000-0000-000000000001','Emergency','Address','intake','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"emergency","hazards":[]}','{}',true,'delayed-emergency','2026-09-01T00:00:00Z'),
 ('41000000-0000-0000-0000-000000000008','31000000-0000-0000-0000-000000000001','Unconfirmed','Address','intake','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,null,'2026-09-01T00:00:00Z'),
 ('41000000-0000-0000-0000-000000000009','31000000-0000-0000-0000-000000000001','Expired only','Address','intake','cleared',true,'handyman','28202','{"category":"handyman","urgency":"routine","hazards":[]}','{}',true,'delayed-expired','2026-09-01T00:00:00Z'),
 ('41000000-0000-0000-0000-000000000010','31000000-0000-0000-0000-000000000001','Rank hole','Address','matched','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-hole','2026-09-01T00:00:00Z'),
 ('41000000-0000-0000-0000-000000000012','31000000-0000-0000-0000-000000000001','Quoted','Address','quoted','cleared',true,'plumbing','28202','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-quoted','2026-09-01T00:00:00Z'),
 ('41000000-0000-0000-0000-000000000013','31000000-0000-0000-0000-000000000001','General is not plumbing','Address','intake','cleared',true,'plumbing','28204','{"category":"plumbing","urgency":"routine","hazards":[]}','{}',true,'delayed-general','2026-09-01T00:00:00Z');
insert into request_matches(request_id,provider_id,rank) values
 ('41000000-0000-0000-0000-000000000010','31000000-0000-0000-0000-000000000011',1),
 ('41000000-0000-0000-0000-000000000010','31000000-0000-0000-0000-000000000012',3);

select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok(
  $$select expand_stale_quote_requests('2026-09-08T12:00:00Z')$$,
  '42501','service role required','clients cannot run delayed matching'
);
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select expand_stale_quote_requests('2026-09-08T12:00:00Z')$$,'service expands eligible stale requests');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000001'),3::bigint,'zero-match intake fills up to three slots');
select is((select workflow_status from service_requests where id='41000000-0000-0000-0000-000000000001'),'matched','new match promotes intake to matched');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000013'),0::bigint,'general-only provider is excluded from a plumbing request');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000001' and provider_id='31000000-0000-0000-0000-000000000018'),0::bigint,'expired provider is excluded');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000003' and provider_id='31000000-0000-0000-0000-000000000016'),1::bigint,'request matches the exact ZIP');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000002' and provider_id='31000000-0000-0000-0000-000000000017'),1::bigint,'demo request matches a demo provider');
select is((select count(*) from request_matches m join profiles p on p.id=m.provider_id where m.request_id='41000000-0000-0000-0000-000000000002' and not p.is_demo),0::bigint,'demo request excludes real providers');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000004'),3::bigint,'request exactly 24 hours old is eligible');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000005'),0::bigint,'request newer than 24 hours is not eligible');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000006'),0::bigint,'terminal request receives no matches');
select is((select workflow_status from service_requests where id='41000000-0000-0000-0000-000000000006'),'funded','terminal request status stays unchanged');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000007'),0::bigint,'emergency request is skipped');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000008'),0::bigint,'unconfirmed request is skipped');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000009'),0::bigint,'expired-only category remains unmatched');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000010' and rank=2),1::bigint,'rank gap is filled');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000010'),3::bigint,'existing matches remain capped at three');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000012'),3::bigint,'quoted request can fill remaining match slots');
select is((select workflow_status from service_requests where id='41000000-0000-0000-0000-000000000012'),'quoted','quoted request status stays unchanged');
select lives_ok($$select expand_stale_quote_requests('2026-09-08T12:00:00Z')$$,'repeated expansion is safe');
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000001'),3::bigint,'repeated expansion creates no duplicate matches');

insert into service_requests(
  id,customer_id,description,service_address,workflow_status,safety_status,expanded_search,
  service_category,service_area,triage,work_scope_snapshot,price_disclosure_accepted,intake_assessment_id,created_at
) values (
  '41000000-0000-0000-0000-000000000011','31000000-0000-0000-0000-000000000001','Rollback','Address','intake','cleared',true,
  'hvac','28202','{"category":"hvac","urgency":"routine","hazards":[]}','{}',true,'delayed-rollback','2026-09-01T00:00:00Z'
);
create function fail_delayed_matching_update() returns trigger language plpgsql as $$
begin
  if old.id='41000000-0000-0000-0000-000000000011' then raise exception 'forced delayed matching update failure'; end if;
  return new;
end $$;
create trigger fail_delayed_matching_update before update on service_requests for each row execute function fail_delayed_matching_update();
select throws_ok(
  $$select expand_stale_quote_requests('2026-09-08T12:00:00Z')$$,
  'P0001','forced delayed matching update failure','request update error aborts expansion'
);
select is((select count(*) from request_matches where request_id='41000000-0000-0000-0000-000000000011'),0::bigint,'failed request update rolls back inserted matches');

select * from finish();
rollback;
