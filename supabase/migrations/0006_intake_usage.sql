-- intake_usage_events 테이블: 일일 크레딧/동시성 제한의 사용량 기록.
create table if not exists intake_usage_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references profiles(id) on delete cascade,
  usage_day date not null default (timezone('utc', now()))::date,
  credits integer not null check (credits > 0),
  created_at timestamptz not null default now()
);
create index if not exists intake_usage_events_day_actor_idx on intake_usage_events(usage_day,actor_id);

create table if not exists intake_usage_leases (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists intake_usage_leases_expiry_idx on intake_usage_leases(expires_at);
create index if not exists intake_usage_leases_actor_idx on intake_usage_leases(actor_id);

alter table intake_usage_events enable row level security;
alter table intake_usage_events force row level security;
alter table intake_usage_leases enable row level security;
alter table intake_usage_leases force row level security;
revoke all on intake_usage_events,intake_usage_leases from public,anon,authenticated;

create or replace function reserve_intake_usage(p_actor_id uuid,p_credits integer,p_account_daily_limit integer,p_total_daily_limit integer,p_global_active_limit integer,p_account_active_limit integer) returns jsonb
language plpgsql security definer set search_path=public as $reserve_intake_usage$
declare v_day date := (timezone('utc', clock_timestamp()))::date; v_account_used integer; v_total_used integer; v_account_active integer; v_global_active integer; v_lease_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  if p_credits<1 or p_account_daily_limit<1 or p_total_daily_limit<1 or p_global_active_limit<1 or p_account_active_limit<1 then raise exception 'invalid usage limits'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wecover_intake_usage',0));
  delete from intake_usage_leases where expires_at<=clock_timestamp();
  select count(*)::integer,count(*) filter(where actor_id=p_actor_id)::integer into v_global_active,v_account_active from intake_usage_leases;
  if v_account_active>=p_account_active_limit then return jsonb_build_object('allowed',false,'reason','account_active'); end if;
  if v_global_active>=p_global_active_limit then return jsonb_build_object('allowed',false,'reason','global_active'); end if;
  select coalesce(sum(credits),0)::integer,coalesce(sum(credits) filter(where actor_id=p_actor_id),0)::integer into v_total_used,v_account_used from intake_usage_events where usage_day=v_day;
  if v_account_used+p_credits>p_account_daily_limit then return jsonb_build_object('allowed',false,'reason','account_quota'); end if;
  if v_total_used+p_credits>p_total_daily_limit then return jsonb_build_object('allowed',false,'reason','total_quota'); end if;
  insert into intake_usage_events(actor_id,usage_day,credits) values(p_actor_id,v_day,p_credits);
  insert into intake_usage_leases(actor_id,expires_at) values(p_actor_id,clock_timestamp()+interval '2 minutes') returning id into v_lease_id;
  return jsonb_build_object('allowed',true,'leaseId',v_lease_id);
end;$reserve_intake_usage$;

create or replace function release_intake_usage(p_lease_id uuid,p_actor_id uuid) returns void
language plpgsql security definer set search_path=public as $release_intake_usage$
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  delete from intake_usage_leases where id=p_lease_id and actor_id=p_actor_id;
end;$release_intake_usage$;

revoke all on function reserve_intake_usage(uuid,integer,integer,integer,integer,integer),release_intake_usage(uuid,uuid) from public,anon,authenticated;
grant execute on function reserve_intake_usage(uuid,integer,integer,integer,integer,integer),release_intake_usage(uuid,uuid) to service_role;
grant select,insert,delete on intake_usage_events,intake_usage_leases to service_role;
