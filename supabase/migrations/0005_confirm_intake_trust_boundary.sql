begin;

drop function if exists confirm_intake(text,text,text,text,jsonb,jsonb,jsonb,text);

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
        where p.role='provider' and p.provider_status='approved'
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

commit;
