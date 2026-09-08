begin;
create table care_bundles(id uuid primary key default gen_random_uuid(),customer_id uuid not null references profiles(id),service_address text not null,primary_request_id uuid not null references service_requests(id),scope_snapshot jsonb not null,status text not null default 'active' check(status in('active','released')),created_at timestamptz not null default now());
create table care_bundle_items(bundle_id uuid not null references care_bundles(id),request_id uuid primary key references service_requests(id));
create table care_dedicated(id uuid primary key default gen_random_uuid(),customer_id uuid not null references profiles(id),provider_id uuid not null references profiles(id),source_request_id uuid not null unique references jobs(request_id),service_address text not null,category text not null,status text not null default 'proposed' check(status in('proposed','active','released')),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index care_dedicated_active on care_dedicated(customer_id,service_address,category) where status='active';
create table care_priority(request_id uuid primary key references service_requests(id),customer_id uuid not null references profiles(id),provider_id uuid not null references profiles(id),status text not null default 'offered' check(status in('offered','accepted','fallback')),expires_at timestamptz not null,created_at timestamptz not null default now());
create table care_maintenance(request_id uuid primary key references jobs(request_id),customer_id uuid not null references profiles(id),provider_id uuid not null references profiles(id),service_address text not null,asset_name text not null,parts jsonb not null default '[]',warranty_until timestamptz,completed_at timestamptz not null,updated_at timestamptz not null default now());
create table care_reminders(id uuid primary key default gen_random_uuid(),request_id uuid not null references care_maintenance(request_id),customer_id uuid not null references profiles(id),kind text not null check(kind in('warranty','maintenance')),due_at timestamptz not null,dismissed_at timestamptz,unique(request_id,kind));

create function care_eligible(p_provider uuid,p_category text,p_area text) returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from profiles where id=p_provider and role='provider' and provider_status='approved' and license_verified and license_expires_at>now() and insurance_verified and insurance_expires_at>now() and p_category=any(service_categories) and p_area=any(service_areas)); $$;

create function care_create_bundle(p_requests uuid[]) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_address text; v_count integer;
begin
 if cardinality(p_requests) not between 2 and 5 or cardinality(p_requests)<>(select count(distinct x) from unnest(p_requests) x) then raise exception 'bundle requires 2 to 5 distinct requests'; end if;
 perform 1 from service_requests where id=any(p_requests) order by id for update;
 select count(*),min(service_address) into v_count,v_address from service_requests r where r.id=any(p_requests) and r.customer_id=auth.uid() and r.intake_assessment_id is not null and r.service_category='handyman' and r.safety_status='cleared' and r.workflow_status in('intake','matched') and coalesce(r.triage->>'urgency','')<>'emergency' and coalesce(jsonb_array_length(r.triage->'hazards'),0)=0 and r.work_scope_snapshot is not null and not exists(select 1 from jobs where request_id=r.id) and not exists(select 1 from quotes where request_id=r.id);
 if v_count<>cardinality(p_requests) or (select count(distinct service_address) from service_requests where id=any(p_requests))<>1 then raise exception 'bundle scope forbidden' using errcode='42501'; end if;
 insert into care_bundles(customer_id,service_address,primary_request_id,scope_snapshot) values(auth.uid(),v_address,p_requests[1],(select jsonb_agg(jsonb_build_object('requestId',id,'description',description,'workScope',work_scope_snapshot) order by id) from service_requests where id=any(p_requests))) returning id into v_id;
 insert into care_bundle_items select v_id,x from unnest(p_requests) x;
 return v_id;
end; $$;

create function care_completed_job() returns trigger language plpgsql security definer set search_path=public as $$
declare r service_requests; q quote_snapshots; v_days integer;
begin
 if new.completed_at is null or new.work_status not in('completed','settled') then return new; end if;
 select * into r from service_requests where id=new.request_id;
 select * into q from quote_snapshots where id=new.accepted_quote_snapshot_id;
 select warranty_days into v_days from quotes where id=q.quote_id;
 insert into care_maintenance(request_id,customer_id,provider_id,service_address,asset_name,warranty_until,completed_at) values(r.id,r.customer_id,q.provider_id,r.service_address,r.description,case when v_days>0 then new.completed_at+make_interval(days=>v_days) end,new.completed_at) on conflict do nothing;
 insert into care_dedicated(customer_id,provider_id,source_request_id,service_address,category) values(r.customer_id,q.provider_id,r.id,r.service_address,r.service_category) on conflict(source_request_id) do nothing;
 if v_days>0 then insert into care_reminders(request_id,customer_id,kind,due_at) values(r.id,r.customer_id,'warranty',new.completed_at+make_interval(days=>greatest(0,v_days-7))) on conflict do nothing; end if;
 return new;
end; $$;
create trigger care_job_completion after insert or update of completed_at,work_status on jobs for each row execute function care_completed_job();

create function care_set_dedicated(p_id uuid,p_action text) returns care_dedicated language plpgsql security definer set search_path=public as $$
declare v care_dedicated;
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,8));
 select * into v from care_dedicated where id=p_id and customer_id=auth.uid() for update;
 if v.id is null then raise exception 'dedicated forbidden' using errcode='42501'; end if;
 if p_action='accept' then
  if v.status='released' or not care_eligible(v.provider_id,v.category,'Charlotte') then raise exception 'provider unavailable'; end if;
  update care_dedicated set status='released',updated_at=now() where customer_id=v.customer_id and service_address=v.service_address and category=v.category and status='active' and id<>v.id;
  update care_dedicated set status='active',updated_at=now() where id=v.id returning * into v;
 elsif p_action='release' then update care_dedicated set status='released',updated_at=now() where id=v.id returning * into v;
 else raise exception 'invalid action'; end if;
 return v;
end; $$;

create function care_apply_priority(p_request uuid) returns void language plpgsql security definer set search_path=public as $$
declare r service_requests; v_provider uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 select * into r from service_requests where id=p_request for update;
 if r.id is null or r.intake_assessment_id is null or r.safety_status<>'cleared' or coalesce(jsonb_array_length(r.triage->'hazards'),0)>0 or r.triage->>'urgency'='emergency' or r.workflow_status not in('intake','matched') or exists(select 1 from care_priority where request_id=r.id) or exists(select 1 from quotes where request_id=r.id) or exists(select 1 from jobs where request_id=r.id) or exists(select 1 from request_matches where request_id=r.id and status<>'invited') then return; end if;
 select provider_id into v_provider from care_dedicated where customer_id=r.customer_id and service_address=r.service_address and category=r.service_category and status='active' and care_eligible(provider_id,r.service_category,r.service_area);
 if v_provider is null then return; end if;
 delete from request_matches where request_id=r.id;
 insert into request_matches(request_id,provider_id,rank) values(r.id,v_provider,1);
 insert into care_priority(request_id,customer_id,provider_id,expires_at) values(r.id,r.customer_id,v_provider,now()+interval '30 minutes');
 update service_requests set workflow_status='matched',expanded_search=false where id=r.id;
end; $$;

create function care_fallback(p_request uuid) returns void language plpgsql security definer set search_path=public as $$
declare r service_requests; v care_priority;
begin
 select * into r from service_requests where id=p_request for update;
 select * into v from care_priority where request_id=p_request for update;
 if v.request_id is null or v.status='fallback' or exists(select 1 from jobs where request_id=p_request) then return; end if;
 if v.status='accepted' and v.expires_at>now() and care_eligible(v.provider_id,r.service_category,r.service_area) then return; end if;
 if v.status='offered' and v.expires_at>now() and care_eligible(v.provider_id,r.service_category,r.service_area) then return; end if;
 if exists(select 1 from quotes where request_id=p_request and status='submitted' and care_eligible(provider_id,r.service_category,r.service_area)) then update care_priority set status='accepted' where request_id=p_request; return; end if;
 delete from request_matches where request_id=p_request;
 insert into request_matches(request_id,provider_id,rank) select r.id,p.id,row_number() over(order by p.id) from profiles p where p.id<>v.provider_id and care_eligible(p.id,r.service_category,r.service_area) order by p.id limit 3;
 update care_priority set status='fallback' where request_id=p_request;
 update service_requests set expanded_search=(select count(*)<3 from request_matches where request_id=p_request),workflow_status=case when exists(select 1 from request_matches where request_id=p_request) then 'matched' else 'intake' end where id=p_request;
end; $$;

create function care_refresh_priority() returns void language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
 for v in select request_id from care_priority where status<>'fallback' and (customer_id=auth.uid() or auth.role()='service_role') loop perform care_fallback(v); end loop;
end; $$;
create function care_respond_priority(p_request uuid,p_action text) returns void language plpgsql security definer set search_path=public as $$
declare v care_priority; r service_requests;
begin
 select * into r from service_requests where id=p_request for update;
 select * into v from care_priority where request_id=p_request and provider_id=auth.uid() for update;
 if v.request_id is null then raise exception 'offer forbidden' using errcode='42501'; end if;
 if v.status<>'offered' or v.expires_at<=now() or not care_eligible(v.provider_id,r.service_category,r.service_area) then raise exception 'offer expired'; end if;
 if p_action='accept' then update care_priority set status='accepted' where request_id=p_request;
 elsif p_action='decline' then update care_priority set expires_at=now() where request_id=p_request; perform care_fallback(p_request);
 else raise exception 'invalid action'; end if;
end; $$;

create function care_record_maintenance(p_request uuid,p_asset text,p_parts jsonb,p_next timestamptz default null) returns care_maintenance language plpgsql security definer set search_path=public as $$
declare v care_maintenance;
begin
 if length(trim(p_asset)) not between 1 and 160 or jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)>30 or exists(select 1 from jsonb_array_elements(p_parts) p where jsonb_typeof(p)<>'object' or coalesce(length(trim(p->>'name')),0) not between 1 and 160 or coalesce(p->>'quantity','') !~ '^[1-9][0-9]{0,2}$') or (p_next is not null and (p_next<=now() or p_next>now()+interval '10 years')) then raise exception 'maintenance invalid'; end if;
 update care_maintenance set asset_name=trim(p_asset),parts=p_parts,updated_at=now() where request_id=p_request and provider_id=auth.uid() returning * into v;
 if v.request_id is null then raise exception 'completed provider required' using errcode='42501'; end if;
 if p_next is not null then insert into care_reminders(request_id,customer_id,kind,due_at) values(v.request_id,v.customer_id,'maintenance',p_next) on conflict(request_id,kind) do update set due_at=excluded.due_at,dismissed_at=null; end if;
 return v;
end; $$;
create function care_dismiss_reminder(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin update care_reminders set dismissed_at=now() where id=p_id and customer_id=auth.uid(); if not found then raise exception 'reminder forbidden' using errcode='42501'; end if; end; $$;

alter table care_bundles enable row level security;
alter table care_bundle_items enable row level security;
alter table care_dedicated enable row level security;
alter table care_priority enable row level security;
alter table care_maintenance enable row level security;
alter table care_reminders enable row level security;
create policy care_bundle_read on care_bundles for select using(customer_id=auth.uid());
create policy care_bundle_item_read on care_bundle_items for select using(exists(select 1 from care_bundles where id=bundle_id and customer_id=auth.uid()));
create policy care_dedicated_read on care_dedicated for select using(customer_id=auth.uid() or provider_id=auth.uid());
create policy care_priority_read on care_priority for select using(customer_id=auth.uid() or provider_id=auth.uid());
create policy care_maintenance_read on care_maintenance for select using(customer_id=auth.uid() or provider_id=auth.uid());
create policy care_reminder_read on care_reminders for select using(customer_id=auth.uid());
revoke all on care_bundles,care_bundle_items,care_dedicated,care_priority,care_maintenance,care_reminders from anon,authenticated;
grant select on care_bundles,care_bundle_items,care_dedicated,care_priority,care_maintenance,care_reminders to authenticated;
grant all on care_bundles,care_bundle_items,care_dedicated,care_priority,care_maintenance,care_reminders to service_role;
revoke all on function care_eligible(uuid,text,text),care_completed_job(),care_fallback(uuid),care_apply_priority(uuid),care_create_bundle(uuid[]),care_set_dedicated(uuid,text),care_refresh_priority(),care_respond_priority(uuid,text),care_record_maintenance(uuid,text,jsonb,timestamptz),care_dismiss_reminder(uuid) from public,anon,authenticated;
grant execute on function care_create_bundle(uuid[]),care_set_dedicated(uuid,text),care_refresh_priority(),care_respond_priority(uuid,text),care_record_maintenance(uuid,text,jsonb,timestamptz),care_dismiss_reminder(uuid) to authenticated;
grant execute on function care_apply_priority(uuid),care_refresh_priority() to service_role;
alter table quotes add column bundle_scope_snapshot jsonb;
alter table quote_snapshots add column bundle_scope_snapshot jsonb;
create function care_bundle_quote_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare v care_bundles;
begin
 select b.* into v from care_bundles b join care_bundle_items i on i.bundle_id=b.id where i.request_id=new.request_id and b.status='active' for update of b;
 if v.id is not null then
  if v.primary_request_id<>new.request_id then raise exception 'bundle_primary_request_required'; end if;
  new.bundle_scope_snapshot:=v.scope_snapshot;
 end if;
 return new;
end; $$;
create trigger care_bundle_quote before insert on quotes for each row execute function care_bundle_quote_guard();
create trigger care_bundle_quote_snapshot before insert on quote_snapshots for each row execute function care_bundle_quote_guard();
create function care_bundle_visit_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from care_bundle_items i join care_bundles b on b.id=i.bundle_id where i.request_id=new.request_id and b.status='active' and b.primary_request_id<>new.request_id) then raise exception 'bundle_primary_request_required'; end if;
 return new;
end; $$;
create trigger care_bundle_booking before insert on jobs for each row execute function care_bundle_visit_guard();
create trigger care_bundle_schedule before insert or update on request_schedules for each row execute function care_bundle_visit_guard();
create function care_release_bundle(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v care_bundles;
begin
 select * into v from care_bundles where id=p_id and customer_id=auth.uid() for update;
 if v.id is null then raise exception 'bundle_forbidden' using errcode='42501'; end if;
 if exists(select 1 from quotes where request_id=v.primary_request_id) or exists(select 1 from jobs where request_id=v.primary_request_id) then raise exception 'bundle_already_quoted'; end if;
 update care_bundles set status='released' where id=v.id;
 delete from care_bundle_items where bundle_id=v.id;
end; $$;
revoke all on function care_bundle_quote_guard(),care_bundle_visit_guard(),care_release_bundle(uuid) from public,anon,authenticated;
grant execute on function care_release_bundle(uuid) to authenticated;
alter table quote_details add constraint quote_details_bundle_fk foreign key(bundle_id) references care_bundles(id);
create function care_quote_details_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 select b.id into v_id from quotes q join care_bundles b on b.primary_request_id=q.request_id and b.status='active' where q.id=new.quote_id;
 if v_id is distinct from new.bundle_id then raise exception 'bundle_scope_acknowledgment_required'; end if;
 return new;
end; $$;
create trigger care_quote_details before insert on quote_details for each row execute function care_quote_details_guard();
revoke all on function care_quote_details_guard() from public,anon,authenticated;
create policy care_bundle_provider_read on care_bundles for select using(exists(select 1 from request_matches m where m.request_id=primary_request_id and m.provider_id=auth.uid()));
create policy care_bundle_items_provider_read on care_bundle_items for select using(exists(select 1 from care_bundles b join request_matches m on m.request_id=b.primary_request_id where b.id=bundle_id and m.provider_id=auth.uid()));
alter table care_bundles force row level security;
alter table care_bundle_items force row level security;
alter table care_dedicated force row level security;
alter table care_priority force row level security;
alter table care_maintenance force row level security;
alter table care_reminders force row level security;
commit;
