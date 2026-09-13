-- 지연 매칭: expand_stale_quote_requests로 일정 시간 후 검색 범위를 넓힌다.
begin;

create function expand_stale_quote_requests(p_now timestamptz) returns integer
language plpgsql
security definer
set search_path=public
as $expand_stale_quote_requests$
declare
  v_request service_requests;
  v_match_count integer;
  v_inserted integer;
  v_total_inserted integer:=0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if p_now is null then
    raise exception 'expansion time required';
  end if;

  for v_request in
    select r.*
    from service_requests r
    where r.workflow_status in('intake','matched','quoted')
      and r.created_at<=p_now-interval '24 hours'
      and r.safety_status='cleared'
      and r.intake_assessment_id is not null
      and coalesce(jsonb_array_length(r.triage->'hazards'),0)=0
      and coalesce(r.triage->>'urgency','')<>'emergency'
      and (select count(*) from quotes q where q.request_id=r.id)<3
    order by r.created_at,r.id
    for update of r skip locked
  loop
    select count(*)::integer into v_match_count
    from request_matches m
    where m.request_id=v_request.id;

    if v_match_count<3 then
      with available_ranks as (
        select slot.rank, row_number() over(order by slot.rank) as sequence
        from generate_series(1,3) as slot(rank)
        where not exists(
          select 1 from request_matches existing
          where existing.request_id=v_request.id and existing.rank=slot.rank
        )
      ), candidates as (
        select p.id,
          row_number() over(
            order by ranking_exploration_selected(v_request.id,p.id) desc,p.id
          ) as sequence
        from profiles p
        where p.is_demo=(select customer.is_demo from profiles customer where customer.id=v_request.customer_id)
          and provider_is_eligible(p.id,v_request.id)
          and not exists(
            select 1 from request_matches existing
            where existing.request_id=v_request.id and existing.provider_id=p.id
          )
      )
      insert into request_matches(request_id,provider_id,rank,exploration_selected)
      select v_request.id,candidate.id,available.rank::smallint,
        ranking_exploration_selected(v_request.id,candidate.id)
      from candidates candidate
      join available_ranks available using(sequence);
      get diagnostics v_inserted=row_count;
      v_total_inserted:=v_total_inserted+v_inserted;
    end if;

    select count(*)::integer into v_match_count
    from request_matches m
    where m.request_id=v_request.id;
    update service_requests r
    set expanded_search=v_match_count<3,
        workflow_status=case when r.workflow_status='intake' and v_match_count>0 then 'matched' else r.workflow_status end
    where r.id=v_request.id;
  end loop;

  return v_total_inserted;
end;
$expand_stale_quote_requests$;

revoke all on function expand_stale_quote_requests(timestamptz) from public,anon,authenticated;
grant execute on function expand_stale_quote_requests(timestamptz) to service_role;

commit;
