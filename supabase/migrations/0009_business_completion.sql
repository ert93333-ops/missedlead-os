begin;
create table business_organizations(id uuid primary key default gen_random_uuid(),owner_id uuid not null references profiles(id),name text not null check(length(btrim(name)) between 1 and 120),created_at timestamptz not null default now());
create table business_members(organization_id uuid not null references business_organizations(id),profile_id uuid not null references profiles(id),role text not null check(role in('member','approver')),created_at timestamptz not null default now(),primary key(organization_id,profile_id));
create table business_locations(id uuid primary key default gen_random_uuid(),organization_id uuid not null references business_organizations(id),name text not null check(length(btrim(name)) between 1 and 120),address text not null check(length(btrim(address)) between 5 and 500),created_at timestamptz not null default now());
create table business_requests(request_id uuid primary key references service_requests(id),organization_id uuid not null references business_organizations(id),location_id uuid not null references business_locations(id),business_interruption boolean not null default false,impact_note text not null default '' check(length(impact_note)<=2000),created_at timestamptz not null default now());
create table business_approvals(id uuid primary key default gen_random_uuid(),organization_id uuid not null references business_organizations(id),request_id uuid not null references service_requests(id),quote_id uuid not null unique references quotes(id),requested_by uuid not null references profiles(id),amount_cents bigint not null check(amount_cents>0),status text not null default 'pending' check(status in('pending','approved','rejected')),decided_by uuid references profiles(id),decision_note text,decided_at timestamptz,created_at timestamptz not null default now(),check((status='pending')=(decided_at is null)),check((status='pending')=(decided_by is null)));
create table user_notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid not null references profiles(id),request_id uuid references service_requests(id),kind text not null check(length(kind) between 1 and 80),title text not null check(length(title) between 1 and 160),body text not null check(length(body)<=2000),event_key text not null unique,created_at timestamptz not null default now(),read_at timestamptz);
create index user_notifications_recipient_created on user_notifications(recipient_id,created_at desc);
create index business_requests_organization on business_requests(organization_id);
create function business_access(p_org uuid,p_approve boolean default false) returns boolean language sql stable security definer set search_path=public as $$
select auth.uid() is not null and exists(select 1 from business_organizations o where o.id=p_org and (o.owner_id=auth.uid() or exists(select 1 from business_members m where m.organization_id=o.id and m.profile_id=auth.uid() and (not p_approve or m.role='approver')))) $$;
revoke all on function business_access(uuid,boolean) from public,anon;
grant execute on function business_access(uuid,boolean) to authenticated;
alter table business_organizations enable row level security;
alter table business_organizations force row level security;
alter table business_members enable row level security;
alter table business_members force row level security;
alter table business_locations enable row level security;
alter table business_locations force row level security;
alter table business_requests enable row level security;
alter table business_requests force row level security;
alter table business_approvals enable row level security;
alter table business_approvals force row level security;
alter table user_notifications enable row level security;
alter table user_notifications force row level security;
create policy business_org_read on business_organizations for select to authenticated using(business_access(id));
create policy business_member_read on business_members for select to authenticated using(business_access(organization_id));
create policy business_location_read on business_locations for select to authenticated using(business_access(organization_id));
create policy business_request_read on business_requests for select to authenticated using(business_access(organization_id));
create policy business_approval_read on business_approvals for select to authenticated using(business_access(organization_id));
create policy notification_read on user_notifications for select to authenticated using(recipient_id=auth.uid());
revoke all on business_organizations,business_members,business_locations,business_requests,business_approvals,user_notifications from anon,authenticated;
grant select on business_organizations,business_members,business_locations,business_requests,business_approvals,user_notifications to authenticated;
create function notify_user(p_recipient uuid,p_request uuid,p_kind text,p_title text,p_body text,p_event_key text) returns void language sql security definer set search_path=public as $$
insert into user_notifications(recipient_id,request_id,kind,title,body,event_key) values(p_recipient,p_request,p_kind,p_title,p_body,p_event_key) on conflict(event_key) do nothing $$;
revoke all on function notify_user(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function notify_user(uuid,uuid,text,text,text,text) to service_role;
create function business_create_organization(p_name text) returns business_organizations language plpgsql security definer set search_path=public as $$
declare v business_organizations;
begin
 if not exists(select 1 from profiles where id=auth.uid() and role='customer') then raise exception 'customer required' using errcode='42501'; end if;
 insert into business_organizations(owner_id,name) values(auth.uid(),p_name) returning * into v;
 perform append_audit('business.organization_created',null,'business_organization',v.id::text,'Organization created','',jsonb_build_object('name',v.name));
 return v;
end $$;
create function business_set_member(p_org uuid,p_profile uuid,p_role text) returns business_members language plpgsql security definer set search_path=public as $$
declare v business_members;
begin
 if not exists(select 1 from business_organizations where id=p_org and owner_id=auth.uid()) then raise exception 'owner required' using errcode='42501'; end if;
 if p_profile=auth.uid() or not exists(select 1 from profiles where id=p_profile and role='customer') then raise exception 'existing customer member required' using errcode='22023'; end if;
 insert into business_members(organization_id,profile_id,role) values(p_org,p_profile,p_role) on conflict(organization_id,profile_id) do update set role=excluded.role returning * into v;
 perform append_audit('business.member_updated',null,'business_organization',p_org::text,'Member role assigned','',jsonb_build_object('profile_id',p_profile,'role',p_role));
 return v;
end $$;
create function business_add_location(p_org uuid,p_name text,p_address text) returns business_locations language plpgsql security definer set search_path=public as $$
declare v business_locations;
begin
 if not business_access(p_org,true) then raise exception 'approver required' using errcode='42501'; end if;
 insert into business_locations(organization_id,name,address) values(p_org,p_name,p_address) returning * into v;
 perform append_audit('business.location_created',null,'business_location',v.id::text,'Location created','',jsonb_build_object('organization_id',p_org));
 return v;
end $$;
create function business_link_request(p_org uuid,p_location uuid,p_request uuid,p_interruption boolean,p_impact text) returns business_requests language plpgsql security definer set search_path=public as $$
declare v business_requests;
begin
 if not business_access(p_org) or not exists(select 1 from service_requests where id=p_request and customer_id=auth.uid()) then raise exception 'own request and membership required' using errcode='42501'; end if;
 if not exists(select 1 from business_locations where id=p_location and organization_id=p_org) then raise exception 'organization location required' using errcode='22023'; end if;
 insert into business_requests(request_id,organization_id,location_id,business_interruption,impact_note) values(p_request,p_org,p_location,p_interruption,p_impact) on conflict(request_id) do nothing;
 select * into v from business_requests where request_id=p_request;
 if v.organization_id<>p_org or v.location_id<>p_location or v.business_interruption is distinct from p_interruption or v.impact_note is distinct from p_impact then raise exception 'request association is immutable' using errcode='22023'; end if;
 perform append_audit('business.request_linked',p_request,'business_location',p_location::text,'Request linked','',jsonb_build_object('interruption',p_interruption));
 return v;
end $$;
create function business_request_approval(p_org uuid,p_quote uuid) returns business_approvals language plpgsql security definer set search_path=public as $$
declare v business_approvals; q quotes; recipient uuid;
begin
 if not business_access(p_org) then raise exception 'membership required' using errcode='42501'; end if;
 select q1.* into q from quotes q1 join business_requests br on br.request_id=q1.request_id where q1.id=p_quote and br.organization_id=p_org;
 if q.id is null or q.status in('rejected','expired') then raise exception 'active organization quote required' using errcode='22023'; end if;
 insert into business_approvals(organization_id,request_id,quote_id,requested_by,amount_cents) values(p_org,q.request_id,q.id,auth.uid(),q.amount_cents) on conflict(quote_id) do nothing returning * into v;
 if v.id is null then select * into v from business_approvals where quote_id=p_quote; return v; end if;
 for recipient in select owner_id from business_organizations where id=p_org union select profile_id from business_members where organization_id=p_org and role='approver' loop
 perform notify_user(recipient,q.request_id,'business_approval','Expense approval requested','A quote is awaiting internal approval.','business_approval:'||v.id||':'||recipient);
 end loop;
 perform append_audit('business.approval_requested',q.request_id,'business_approval',v.id::text,'Expense approval requested','',jsonb_build_object('amount_cents',v.amount_cents));
 return v;
end $$;
create function business_decide_approval(p_approval uuid,p_decision text,p_note text) returns business_approvals language plpgsql security definer set search_path=public as $$
declare v business_approvals;
begin
 select * into v from business_approvals where id=p_approval for update;
 if v.id is null or not business_access(v.organization_id,true) then raise exception 'approver required' using errcode='42501'; end if;
 if v.requested_by=auth.uid() then raise exception 'another approver required' using errcode='42501'; end if;
 if p_decision not in('approved','rejected') or length(btrim(p_note)) not between 1 and 2000 then raise exception 'decision and note required' using errcode='22023'; end if;
 if v.status<>'pending' then
 if v.status=p_decision and v.decided_by=auth.uid() and v.decision_note=p_note then return v; end if;
 raise exception 'approval decision is immutable' using errcode='22023';
 end if;
 update business_approvals set status=p_decision,decided_by=auth.uid(),decision_note=p_note,decided_at=now() where id=p_approval returning * into v;
 perform append_audit('business.approval_'||p_decision,v.request_id,'business_approval',v.id::text,p_note,'',jsonb_build_object('amount_cents',v.amount_cents));
 perform notify_user(v.requested_by,v.request_id,'business_approval','Expense approval updated','The expense request was '||p_decision||'.','business_decision:'||v.id);
 return v;
end $$;
create function business_annual_report(p_org uuid,p_year integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; start_at timestamptz; end_at timestamptz;
begin
 if not business_access(p_org) then raise exception 'membership required' using errcode='42501'; end if;
 if p_year not between 2000 and 2100 then raise exception 'invalid year' using errcode='22023'; end if;
 start_at:=make_timestamptz(p_year,1,1,0,0,0,'UTC'); end_at:=make_timestamptz(p_year+1,1,1,0,0,0,'UTC');
 with requests as(select br.*,r.created_at request_created,j.completed_at from business_requests br join service_requests r on r.id=br.request_id left join jobs j on j.request_id=r.id where br.organization_id=p_org),
 cash as(select br.location_id,p.kind,p.amount_cents from business_requests br join payments p on p.request_id=br.request_id where br.organization_id=p_org and p.created_at>=start_at and p.created_at<end_at and p.kind in('deposit','balance','refund') and p.status='succeeded')
 select jsonb_build_object('year',p_year,'organization_id',p_org,
 'request_count',(select count(*) from requests where request_created>=start_at and request_created<end_at),
 'completed_count',(select count(*) from requests where completed_at>=start_at and completed_at<end_at),
 'interruption_count',(select count(*) from requests where business_interruption and request_created>=start_at and request_created<end_at),
 'paid_cents',(select coalesce(sum(amount_cents),0) from cash where kind<>'refund'),
 'refunded_cents',(select coalesce(sum(amount_cents),0) from cash where kind='refund'),
 'net_paid_cents',(select coalesce(sum(case when kind='refund' then -amount_cents else amount_cents end),0) from cash),
 'locations',(select coalesce(jsonb_agg(jsonb_build_object('location_id',l.id,'name',l.name,'request_count',(select count(*) from requests r where r.location_id=l.id and request_created>=start_at and request_created<end_at),'paid_cents',(select coalesce(sum(amount_cents),0) from cash c where c.location_id=l.id and kind<>'refund'),'refunded_cents',(select coalesce(sum(amount_cents),0) from cash c where c.location_id=l.id and kind='refund')) order by l.created_at),'[]'::jsonb) from business_locations l where l.organization_id=p_org)) into result;
 return result;
end $$;
create function notification_mark_read(p_notification uuid) returns user_notifications language plpgsql security definer set search_path=public as $$
declare v user_notifications;
begin
 update user_notifications set read_at=coalesce(read_at,now()) where id=p_notification and recipient_id=auth.uid() returning * into v;
 if v.id is null then raise exception 'notification not found' using errcode='42501'; end if;
 return v;
end $$;
create function notify_request_change() returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid; event_kind text; event_body text; event_key text;
begin
 if tg_table_name='quotes' then event_kind:='quote'; event_body:='A new quote is available for your request.'; event_key:='quote:'||new.id;
 else
 if tg_op='UPDATE' and new.starts_at=old.starts_at and new.status=old.status then return new; end if;
 event_kind:='schedule'; event_body:='Your service schedule was updated.'; event_key:='schedule:'||new.request_id||':'||new.updated_at||':'||new.starts_at||':'||new.status;
 end if;
 for recipient in select customer_id from service_requests where id=new.request_id union select provider_id from request_matches where request_id=new.request_id and tg_table_name='request_schedules' loop
 perform notify_user(recipient,new.request_id,event_kind,case when event_kind='quote' then 'New quote' else 'Schedule updated' end,event_body,event_key||':'||recipient);
 end loop;
 return new;
end $$;
create trigger quote_inbox after insert on quotes for each row execute function notify_request_change();
create trigger schedule_inbox after insert or update on request_schedules for each row execute function notify_request_change();
revoke all on function notify_request_change() from public,anon,authenticated;
revoke all on function business_create_organization(text),business_set_member(uuid,uuid,text),business_add_location(uuid,text,text),business_link_request(uuid,uuid,uuid,boolean,text),business_request_approval(uuid,uuid),business_decide_approval(uuid,text,text),business_annual_report(uuid,integer),notification_mark_read(uuid) from public,anon;
grant execute on function business_create_organization(text),business_set_member(uuid,uuid,text),business_add_location(uuid,text,text),business_link_request(uuid,uuid,uuid,boolean,text),business_request_approval(uuid,uuid),business_decide_approval(uuid,text,text),business_annual_report(uuid,integer),notification_mark_read(uuid) to authenticated;
commit;
