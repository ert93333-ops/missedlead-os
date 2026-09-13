-- ZIP 기반 매칭: 지원서 저장 RPC 개편, 서비스 지역·카테고리로 공급자 후보를 선택한다.
begin;

create or replace function save_provider_application(p_data jsonb) returns provider_applications
language plpgsql security definer set search_path=public as $$
declare
  v provider_applications;
  v_zip_codes text[];
begin
  if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and role in('customer','provider')) then
    raise exception 'provider_application_forbidden';
  end if;
  if jsonb_typeof(p_data->'zipCodes') is distinct from 'array' then
    raise exception 'invalid_zip_codes';
  end if;
  v_zip_codes:=array(select jsonb_array_elements_text(p_data->'zipCodes'));
  if cardinality(v_zip_codes) not between 1 and 100
    or exists(select 1 from unnest(v_zip_codes) as application_zip(zip) where application_zip.zip is null or application_zip.zip !~ '^[0-9]{5}$')
  then
    raise exception 'invalid_zip_codes';
  end if;
  if (p_data->>'licenseExpiresAt')::timestamptz<=now() or (p_data->>'insuranceExpiresAt')::timestamptz<=now() then
    raise exception 'credentials_expired';
  end if;
  insert into provider_applications(
    provider_id,organization_name,contact_name,contact_email,contact_phone,categories,zip_codes,languages,
    availability,diagnostic_fee_cents,license_number,license_expires_at,insurance_expires_at,workers_comp_required
  ) values(
    auth.uid(),p_data->>'organizationName',p_data->>'contactName',p_data->>'contactEmail',p_data->>'contactPhone',
    array(select jsonb_array_elements_text(p_data->'categories')),v_zip_codes,
    array(select jsonb_array_elements_text(p_data->'languages')),p_data->>'availability',
    (p_data->>'diagnosticFeeCents')::bigint,p_data->>'licenseNumber',(p_data->>'licenseExpiresAt')::timestamptz,
    (p_data->>'insuranceExpiresAt')::timestamptz,(p_data->>'workersCompRequired')::boolean
  )
  on conflict(provider_id) do update set
    organization_name=excluded.organization_name,contact_name=excluded.contact_name,contact_email=excluded.contact_email,
    contact_phone=excluded.contact_phone,categories=excluded.categories,zip_codes=excluded.zip_codes,languages=excluded.languages,
    availability=excluded.availability,diagnostic_fee_cents=excluded.diagnostic_fee_cents,license_number=excluded.license_number,
    license_expires_at=excluded.license_expires_at,insurance_expires_at=excluded.insurance_expires_at,
    workers_comp_required=excluded.workers_comp_required,status='pending',review_reason=null,verification_reference=null,
    verified_at=null,reviewed_by=null,updated_at=now()
  returning * into v;
  update profiles set provider_status='pending',license_verified=false,insurance_verified=false
  where id=auth.uid() and role='provider';
  return v;
end $$;

create or replace function review_provider_application(p_provider_id uuid,p_decision text,p_reason text,p_reference text) returns provider_applications
language plpgsql security definer set search_path=public as $$
declare
  v provider_applications;
  required_kind text;
begin
  if not is_operator() then raise exception 'operator_required' using errcode='42501'; end if;
  select * into v from provider_applications where provider_id=p_provider_id for update;
  if v.provider_id is null or v.status<>'pending' then raise exception 'pending_application_required'; end if;
  if p_decision not in('approved','rejected') or length(trim(p_reason))<3 or length(trim(p_reference))<3 then
    raise exception 'verification_reference_required';
  end if;
  if p_decision='approved' then
    if cardinality(v.zip_codes) not between 1 and 100
      or exists(select 1 from unnest(v.zip_codes) as application_zip(zip) where application_zip.zip is null or application_zip.zip !~ '^[0-9]{5}$')
    then
      raise exception 'invalid_zip_codes';
    end if;
    if v.license_expires_at<=now() or v.insurance_expires_at<=now() then raise exception 'credentials_expired'; end if;
    foreach required_kind in array (case when v.workers_comp_required then array['license','coi','w9','workers_comp'] else array['license','coi','w9'] end) loop
      if not exists(
        select 1 from provider_documents d
        join storage.objects o on o.bucket_id='provider-documents-private' and o.name=d.object_path
        where d.provider_id=p_provider_id and d.kind=required_kind
      ) then
        raise exception 'required_document_missing';
      end if;
    end loop;
    update profiles set
      role='provider',provider_status='approved',organization_name=v.organization_name,
      license_verified=true,license_expires_at=v.license_expires_at,
      insurance_verified=true,insurance_expires_at=v.insurance_expires_at,
      service_categories=v.categories,
      service_areas=v.zip_codes||array(
        select legacy_area
        from unnest(profiles.service_areas) as existing_area(legacy_area)
        where existing_area.legacy_area !~ '^[0-9]{5}$'
      )
    where id=p_provider_id and role in('customer','provider');
  else
    update profiles set provider_status='pending',license_verified=false,insurance_verified=false
    where id=p_provider_id and role='provider';
  end if;
  update provider_applications set
    status=p_decision,review_reason=p_reason,verification_reference=p_reference,
    verified_at=now(),reviewed_by=auth.uid(),updated_at=now()
  where provider_id=p_provider_id
  returning * into v;
  perform append_audit(
    'review_provider_application',null,'provider',p_provider_id::text,p_reason,gen_random_uuid()::text,
    jsonb_build_object('decision',p_decision,'verificationReference',p_reference)
  );
  return v;
end $$;

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
  v_zip text;
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

  select r.* into v_request from service_requests r
  where r.customer_id=p_customer_id and r.intake_assessment_id=p_assessment_id;

  if v_request.id is null then
    v_zip:=(regexp_match(p_address,'(^|[^0-9])([0-9]{5})([^0-9]|$)'))[2];
    if v_zip is null then raise exception 'confirmed_intake_zip_invalid'; end if;
    if not exists(select 1 from service_zips where zip=v_zip) then raise exception 'service_zip_unavailable'; end if;
    if coalesce((p_price_disclosure->>'sampleCount')::integer,0)<30 then
      v_price_disclosure:=p_price_disclosure-'priceCents';
    end if;

    insert into service_requests(
      customer_id,description,service_address,workflow_status,safety_status,
      expanded_search,service_category,service_area,triage,work_scope_snapshot,
      price_disclosure,price_disclosure_accepted,intake_assessment_id
    ) values(
      p_customer_id,trim(p_description),trim(p_address),'intake','cleared',true,
      p_category,v_zip,p_triage,p_work_scope,v_price_disclosure,true,p_assessment_id
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
        where p.is_demo=(select is_demo from profiles where id=p_customer_id)
          and p.role='provider' and p.provider_status='approved'
          and p.license_verified and p.license_expires_at>statement_timestamp()
          and p.insurance_verified and p.insurance_expires_at>statement_timestamp()
          and p_category=any(p.service_categories) and v_zip=any(p.service_areas)
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

revoke all on function save_provider_application(jsonb),review_provider_application(uuid,text,text,text) from public,anon;
grant execute on function save_provider_application(jsonb),review_provider_application(uuid,text,text,text) to authenticated;
revoke all on function confirm_intake(uuid,text,text,text,text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function confirm_intake(uuid,text,text,text,text,jsonb,jsonb,jsonb,text) to service_role;

commit;
