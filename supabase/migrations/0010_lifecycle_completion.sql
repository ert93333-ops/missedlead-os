begin;
create table public.service_zips(zip text primary key check(zip ~ '^[0-9]{5}$'),updated_at timestamptz not null default now());
alter table public.service_zips enable row level security;
create policy coverage_read on public.service_zips for select to authenticated using(true);
grant select on public.service_zips to authenticated;
create function public.set_service_zips(p_zips text[]) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_operator() then raise exception 'operator_required'; end if;
 if p_zips is null or cardinality(p_zips) not between 1 and 50 or exists(select 1 from unnest(p_zips) z where z is null or z !~ '^[0-9]{5}$') then raise exception 'invalid_zip_codes'; end if;
 delete from service_zips;
 insert into service_zips(zip) select distinct unnest(p_zips);
 perform append_audit('coverage_updated',null,'coverage','pilot','operator updated service area',gen_random_uuid()::text);
end $$;
create table public.customer_properties(id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.profiles(id),label text not null,address text not null,zip text not null check(zip ~ '^[0-9]{5}$'),building_type text not null check(building_type in('house','condo','apartment','commercial')),created_at timestamptz not null default now());
alter table public.customer_properties enable row level security;
create policy properties_owner on public.customer_properties for all to authenticated using(customer_id=auth.uid()) with check(customer_id=auth.uid());
grant select,insert,update,delete on public.customer_properties to authenticated;

create table public.safety_reports(id uuid primary key,customer_id uuid not null references public.profiles(id),category text not null,summary text not null,guidance text not null,hazards text[] not null,created_at timestamptz not null default now(),resolved_at timestamptz,resolution text);
alter table public.safety_reports enable row level security;
create policy safety_read on public.safety_reports for select to authenticated using(customer_id=auth.uid() or public.is_operator());
grant select on public.safety_reports to authenticated;
create function public.resolve_safety_report(p_id uuid,p_resolution text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_operator() or length(trim(p_resolution))<3 then raise exception 'operator_required'; end if;
 update safety_reports set resolved_at=now(),resolution=p_resolution where id=p_id;
 perform append_audit('safety_report_resolved',null,'safety_report',p_id::text,p_resolution,gen_random_uuid()::text);
end $$;

create table public.schedule_history(id uuid primary key default gen_random_uuid(),request_id uuid not null references public.service_requests(id),starts_at timestamptz not null,time_zone text not null,status text not null,changed_at timestamptz not null default now(),changed_by uuid references public.profiles(id));
alter table public.schedule_history enable row level security;
create policy schedule_history_read on public.schedule_history for select to authenticated using(public.can_access_request(request_id));
grant select on public.schedule_history to authenticated;
create function public.capture_schedule_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into schedule_history(request_id,starts_at,time_zone,status,changed_by) values(new.request_id,new.starts_at,new.time_zone,new.status,auth.uid());
 return new;
end $$;
create trigger request_schedule_history after insert or update on public.request_schedules for each row execute function public.capture_schedule_history();

create table public.completion_acknowledgments(request_id uuid primary key references public.jobs(request_id),customer_id uuid not null references public.profiles(id),accepted_at timestamptz not null default now());
alter table public.completion_acknowledgments enable row level security;
create policy completion_ack_read on public.completion_acknowledgments for select to authenticated using(public.can_access_request(request_id));
grant select on public.completion_acknowledgments to authenticated;
create function public.acknowledge_completion(p_request uuid) returns public.completion_acknowledgments language plpgsql security definer set search_path=public as $$
declare result completion_acknowledgments;
begin
 perform 1 from jobs j join service_requests r on r.id=j.request_id where r.id=p_request and r.customer_id=auth.uid() and j.completed_at is not null for update of j;
 if not found then raise exception 'completion_not_available'; end if;
 insert into completion_acknowledgments(request_id,customer_id) values(p_request,auth.uid()) on conflict(request_id) do nothing;
 select * into result from completion_acknowledgments where request_id=p_request;
 perform append_audit('customer_completion_acknowledged',p_request,'job',p_request::text,'customer reviewed completed work',gen_random_uuid()::text);
 return result;
end $$;

create table public.evidence_media(evidence_id uuid primary key references public.evidence(id),request_id uuid not null references public.jobs(request_id),file_name text not null,content_type text not null,size_bytes bigint not null check(size_bytes between 1 and 25000000),object_path text not null unique,checksum text not null,note text not null);
alter table public.evidence_media enable row level security;
create policy evidence_media_read on public.evidence_media for select to authenticated using(public.can_access_request(request_id));
grant select on public.evidence_media to authenticated;
create function public.commit_evidence_file(p_actor uuid,p_request uuid,p_kind text,p_note text,p_name text,p_type text,p_bytes bigint,p_path text,p_checksum text) returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 perform 1 from jobs j join service_requests r on r.id=j.request_id where r.id=p_request and (r.customer_id=p_actor or exists(select 1 from request_matches m where m.request_id=p_request and m.provider_id=p_actor and provider_is_eligible(p_actor,p_request))) for update of j;
 if not found then raise exception 'evidence_access_required'; end if;
 if p_kind not in('before','during','after','receipt','warranty') or length(p_note)<3 or p_checksum!~'^[a-f0-9]{64}$' or p_path not like p_actor::text||'/'||p_request::text||'/evidence/%' then raise exception 'invalid_evidence'; end if;
 select e.id into result from evidence e join evidence_media m on m.evidence_id=e.id where e.request_id=p_request and e.submitted_by=p_actor and e.kind=p_kind and m.checksum=p_checksum;
 if result is not null then return result; end if;
 if (select count(*) from evidence e join evidence_media m on m.evidence_id=e.id where e.request_id=p_request)>=100 then raise exception 'evidence_limit_exceeded'; end if;
 insert into evidence(request_id,submitted_by,kind,storage_path,sha256) values(p_request,p_actor,p_kind,p_path,p_checksum) returning id into result;
 insert into evidence_media values(result,p_request,p_name,p_type,p_bytes,p_path,p_checksum,p_note);
 perform append_audit('evidence_file_added',p_request,'evidence',result::text,'sanitized file stored',gen_random_uuid()::text,'{}',p_actor);
 return result;
end $$;

create table public.job_permits(request_id uuid primary key references public.service_requests(id),permit_number text not null,inspection_status text not null check(inspection_status in('pending','passed','failed')),verified boolean not null default false,verification_reference text,verified_by uuid references public.profiles(id),updated_at timestamptz not null default now());
alter table public.job_permits enable row level security;
create policy permit_read on public.job_permits for select to authenticated using(public.can_access_request(request_id));
grant select on public.job_permits to authenticated;
create function public.record_job_permit(p_request uuid,p_number text,p_inspection text,p_reference text default null) returns public.job_permits language plpgsql security definer set search_path=public as $$
declare result job_permits;
begin
 if not can_access_request(p_request) or not (is_operator() or provider_is_eligible(auth.uid(),p_request)) then raise exception 'permit_forbidden'; end if;
 if length(trim(p_number))<2 or p_inspection not in('pending','passed','failed') then raise exception 'invalid_permit'; end if;
 if is_operator() and length(coalesce(p_reference,''))<5 then raise exception 'verification_reference_required'; end if;
 insert into job_permits(request_id,permit_number,inspection_status,verified,verification_reference,verified_by) values(p_request,p_number,p_inspection,is_operator(),case when is_operator() then p_reference end,case when is_operator() then auth.uid() end)
 on conflict(request_id) do update set permit_number=excluded.permit_number,inspection_status=excluded.inspection_status,verified=excluded.verified,verification_reference=excluded.verification_reference,verified_by=excluded.verified_by,updated_at=now() returning * into result;
 perform append_audit('permit_recorded',p_request,'permit',p_number,'permit verification state updated',gen_random_uuid()::text);
 return result;
end $$;
create function public.guard_job_readiness() returns trigger language plpgsql security definer set search_path=public as $$
declare details quote_details; permit job_permits;
begin
 select d.* into details from quote_details d join quote_snapshots s on s.quote_id=d.quote_id where s.id=new.accepted_quote_snapshot_id;
 if tg_op='INSERT' and (details.quote_id is null or details.valid_until<=now() or details.site_visit_required) then raise exception 'current_final_quote_required'; end if;
 if new.work_status in('in_progress','completed') and details.permit_required then
  select * into permit from job_permits where request_id=new.request_id;
  if permit.request_id is null or not permit.verified or permit.inspection_status='failed' then raise exception 'verified_permit_required'; end if;
  if new.work_status='completed' and permit.inspection_status<>'passed' then raise exception 'passed_inspection_required'; end if;
 end if;
 return new;
end $$;
create trigger job_readiness_guard before insert or update of work_status on public.jobs for each row execute function public.guard_job_readiness();
create function public.guard_pilot_amount() returns trigger language plpgsql security definer set search_path=public as $$
declare base bigint; changes bigint;
begin
 if tg_table_name='quotes' then
  if new.amount_cents>=4000000 then raise exception 'pilot_project_limit'; end if;
 else
  perform 1 from jobs where request_id=new.request_id for update;
  select s.amount_cents into base from jobs j join quote_snapshots s on s.id=j.accepted_quote_snapshot_id where j.request_id=new.request_id;
  select coalesce(sum(amount_cents),0) into changes from change_orders where request_id=new.request_id and approval_status='approved' and id<>new.id;
  if coalesce(base,0)+changes+new.amount_cents>=4000000 then raise exception 'pilot_project_limit'; end if;
 end if;
 return new;
end $$;
create trigger quote_pilot_limit before insert or update of amount_cents on public.quotes for each row execute function public.guard_pilot_amount();
create trigger change_pilot_limit before insert or update of amount_cents,approval_status on public.change_orders for each row execute function public.guard_pilot_amount();

create function public.reference_price(p_category text) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if auth.uid() is null or p_category not in('plumbing','hvac','handyman') then raise exception 'invalid_category'; end if;
 with completed as (select r.id,j.settled_at,sum(case when p.kind='refund' then -p.amount_cents else p.amount_cents end)::bigint amount from service_requests r join jobs j on j.request_id=r.id join payments p on p.request_id=r.id where r.service_category=p_category and j.settled_at>=now()-interval '365 days' and p.status='succeeded' and p.kind in('deposit','balance','refund') group by r.id,j.settled_at having sum(case when p.kind='refund' then -p.amount_cents else p.amount_cents end)>0)
 select jsonb_build_object('category',p_category,'source','completed_paid_jobs','sampleCount',count(*),'updatedAt',max(settled_at),'lowCents',case when count(*)>=30 then round((percentile_cont(0.25) within group(order by amount))::numeric)::bigint end,'highCents',case when count(*)>=30 then round((percentile_cont(0.75) within group(order by amount))::numeric)::bigint end,'currency','USD','confidence',case when count(*)>=30 then 'observed_range' else 'insufficient_samples' end) into result from completed;
 return result;
end $$;
revoke all on function public.set_service_zips(text[]),public.resolve_safety_report(uuid,text),public.capture_schedule_history(),public.acknowledge_completion(uuid),public.commit_evidence_file(uuid,uuid,text,text,text,text,bigint,text,text),public.record_job_permit(uuid,text,text,text),public.guard_job_readiness(),public.guard_pilot_amount(),public.reference_price(text) from public,anon;
grant execute on function public.set_service_zips(text[]),public.resolve_safety_report(uuid,text),public.acknowledge_completion(uuid),public.record_job_permit(uuid,text,text,text),public.reference_price(text) to authenticated;
grant execute on function public.commit_evidence_file(uuid,uuid,text,text,text,text,bigint,text,text) to service_role;
create policy payment_attempts_customer_read on public.payment_attempts for select to authenticated using(exists(select 1 from public.service_requests r where r.id=request_id and r.customer_id=auth.uid()));
grant select on public.payment_attempts to authenticated;
commit;
