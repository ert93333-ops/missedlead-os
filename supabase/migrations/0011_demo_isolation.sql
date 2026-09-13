-- 데모 격리: profiles.is_demo 추가 + guard_demo_profile 트리거로
-- 데모 계정의 operator·금융 접근을 차단한다.
begin;
alter table profiles add column is_demo boolean not null default false;
create function guard_demo_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (TG_OP='INSERT' and new.is_demo) or (TG_OP='UPDATE' and new.is_demo is distinct from old.is_demo) then
  if auth.role() is distinct from 'service_role' then raise exception 'demo_marker_service_only' using errcode='42501'; end if;
  if TG_OP='UPDATE' and (exists(select 1 from service_requests where customer_id=new.id) or exists(select 1 from request_matches where provider_id=new.id)) then raise exception 'demo_marker_in_use' using errcode='42501'; end if;
 end if;
 if new.is_demo and (new.role='operator' or new.stripe_account_id is not null or new.stripe_charges_enabled or new.stripe_payouts_enabled) then raise exception 'demo_financial_access_disabled' using errcode='42501'; end if;
 return new;
end; $$;
create trigger demo_profile_guard before insert or update on profiles for each row execute function guard_demo_profile();
create function guard_demo_match() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (select is_demo from profiles where id=new.provider_id) is distinct from (select p.is_demo from service_requests r join profiles p on p.id=r.customer_id where r.id=new.request_id) then raise exception 'demo_match_isolation' using errcode='42501'; end if;
 return new;
end; $$;
create trigger demo_match_guard before insert or update on request_matches for each row execute function guard_demo_match();
create function guard_demo_money() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from service_requests r join profiles p on p.id=r.customer_id where r.id=new.request_id and p.is_demo) then raise exception 'demo_payments_disabled' using errcode='42501'; end if;
 return new;
end; $$;
create trigger demo_money_guard before insert or update on money_operations for each row execute function guard_demo_money();
create trigger demo_payment_guard before insert or update on payment_attempts for each row execute function guard_demo_money();
create function demo_seed_ready() returns boolean language sql stable security definer set search_path=public as $$ select auth.role()='service_role'; $$;
revoke all on function demo_seed_ready() from public,anon,authenticated;
grant execute on function demo_seed_ready() to service_role;
create or replace function confirm_intake(
  p_customer_id uuid,
  p_customer_name text,
  p_address text,
  p_description text,
  p_category text,
  p_work_scope jsonb,
  p_triage jsonb,
  p_price_disclosure jsonb,
  p_assessment_id text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $confirm_intake$
declare
  v_request service_requests;
  v_match_count integer;
  v_price_disclosure jsonb:=p_price_disclosure;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if not exists(select 1 from profiles p where p.id=p_customer_id and p.role='customer') then
    raise exception 'customer required' using errcode='42501';
  end if;
  if length(trim(p_customer_name))<1 or length(trim(p_address))<1 or length(trim(p_description))<1
    or length(trim(p_assessment_id)) not between 1 and 200
    or p_category not in('plumbing','hvac','handyman')
    or jsonb_typeof(p_work_scope)<>'object'
    or jsonb_typeof(p_triage)<>'object'
    or jsonb_typeof(p_price_disclosure)<>'object'
    or p_triage->>'category' is distinct from p_category
  then
    raise exception 'confirmed intake invalid';
  end if;
  if coalesce(jsonb_array_length(p_triage->'hazards'),0)>0 or p_triage->>'urgency'='emergency' then
    raise exception 'hazard triage blocked';
  end if;
  if coalesce((p_price_disclosure->>'sampleCount')::integer,0)<30 then
    v_price_disclosure:=p_price_disclosure-'priceCents';
  end if;

  select r.* into v_request from service_requests r
  where r.customer_id=p_customer_id and r.intake_assessment_id=p_assessment_id;
  if v_request.id is null then
    insert into service_requests(
      customer_id,description,service_address,workflow_status,safety_status,
      expanded_search,service_category,service_area,triage,work_scope_snapshot,
      price_disclosure,price_disclosure_accepted,intake_assessment_id
    ) values(
      p_customer_id,trim(p_description),trim(p_address),'intake','cleared',true,
      p_category,'Charlotte',p_triage,p_work_scope,v_price_disclosure,true,p_assessment_id
    )
    on conflict(customer_id,intake_assessment_id) where intake_assessment_id is not null do nothing
    returning * into v_request;
    if v_request.id is null then
      select r.* into v_request from service_requests r
      where r.customer_id=p_customer_id and r.intake_assessment_id=p_assessment_id;
    else
      insert into request_matches(request_id,provider_id,rank,exploration_selected)
      select v_request.id,candidate.id,candidate.rank,ranking_exploration_selected(v_request.id,candidate.id)
      from (
        select p.id,row_number() over(order by p.id)::smallint as rank
        from profiles p
        where p.is_demo=(select is_demo from profiles where id=p_customer_id) and p.role='provider' and p.provider_status='approved'
          and p.license_verified and p.license_expires_at>statement_timestamp()
          and p.insurance_verified and p.insurance_expires_at>statement_timestamp()
          and p_category=any(p.service_categories) and 'Charlotte'=any(p.service_areas)
        order by p.id limit 3
      ) candidate;
      select count(*)::integer into v_match_count from request_matches rm where rm.request_id=v_request.id;
      update service_requests r
      set workflow_status=case when v_match_count>0 then 'matched' else 'intake' end,
          expanded_search=v_match_count<3
      where r.id=v_request.id returning * into v_request;
    end if;
  end if;
  select count(*)::integer into v_match_count from request_matches rm where rm.request_id=v_request.id;
  return jsonb_build_object('requestId',v_request.id,'status',v_request.workflow_status,'matchCount',v_match_count);
end;
$confirm_intake$;

revoke all on function confirm_intake(uuid,text,text,text,text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function confirm_intake(uuid,text,text,text,text,jsonb,jsonb,jsonb,text) to service_role;

create or replace function care_apply_priority(p_request uuid) returns void language plpgsql security definer set search_path=public as $$
declare r service_requests; v_provider uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 select * into r from service_requests where id=p_request for update;
 if r.id is null or r.intake_assessment_id is null or r.safety_status<>'cleared' or coalesce(jsonb_array_length(r.triage->'hazards'),0)>0 or r.triage->>'urgency'='emergency' or r.workflow_status not in('intake','matched') or exists(select 1 from care_priority where request_id=r.id) or exists(select 1 from quotes where request_id=r.id) or exists(select 1 from jobs where request_id=r.id) or exists(select 1 from request_matches where request_id=r.id and status<>'invited') then return; end if;
 select provider_id into v_provider from care_dedicated where customer_id=r.customer_id and service_address=r.service_address and category=r.service_category and (select is_demo from profiles where id=provider_id)=(select is_demo from profiles where id=r.customer_id) and status='active' and care_eligible(provider_id,r.service_category,r.service_area);
 if v_provider is null then return; end if;
 delete from request_matches where request_id=r.id;
 insert into request_matches(request_id,provider_id,rank) values(r.id,v_provider,1);
 insert into care_priority(request_id,customer_id,provider_id,expires_at) values(r.id,r.customer_id,v_provider,now()+interval '30 minutes');
 update service_requests set workflow_status='matched',expanded_search=false where id=r.id;
end; $$;

create or replace function care_fallback(p_request uuid) returns void language plpgsql security definer set search_path=public as $$
declare r service_requests; v care_priority;
begin
 select * into r from service_requests where id=p_request for update;
 select * into v from care_priority where request_id=p_request for update;
 if v.request_id is null or v.status='fallback' or exists(select 1 from jobs where request_id=p_request) then return; end if;
 if v.status='accepted' and v.expires_at>now() and care_eligible(v.provider_id,r.service_category,r.service_area) then return; end if;
 if v.status='offered' and v.expires_at>now() and care_eligible(v.provider_id,r.service_category,r.service_area) then return; end if;
 if exists(select 1 from quotes where request_id=p_request and status='submitted' and care_eligible(provider_id,r.service_category,r.service_area)) then update care_priority set status='accepted' where request_id=p_request; return; end if;
 delete from request_matches where request_id=p_request;
 insert into request_matches(request_id,provider_id,rank) select r.id,p.id,row_number() over(order by p.id) from profiles p where p.is_demo=(select is_demo from profiles where id=r.customer_id) and p.id<>v.provider_id and care_eligible(p.id,r.service_category,r.service_area) order by p.id limit 3;
 update care_priority set status='fallback' where request_id=p_request;
 update service_requests set expanded_search=(select count(*)<3 from request_matches where request_id=p_request),workflow_status=case when exists(select 1 from request_matches where request_id=p_request) then 'matched' else 'intake' end where id=p_request;
end; $$;


commit;
