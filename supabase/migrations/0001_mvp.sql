begin;

create extension if not exists pgcrypto;

create table profiles (
  id uuid primary key,
  role text not null check (role in ('customer', 'provider', 'operator')),
  display_name text not null,
  stripe_account_id text unique,
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,
  stripe_details_submitted boolean not null default false,
  founder_eligible boolean not null default false,
  provider_status text check (role <> 'provider' or provider_status in ('pending','approved','suspended')),
  organization_name text,
  license_verified boolean not null default false,
  license_expires_at timestamptz,
  insurance_verified boolean not null default false,
  insurance_expires_at timestamptz,
  service_categories text[] not null default '{}',
  service_areas text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table privacy_consents(id uuid primary key default gen_random_uuid(),profile_id uuid not null references profiles(id),version text not null,accepted_at timestamptz not null default now(),unique(profile_id,version));
create table deletion_requests(id uuid primary key default gen_random_uuid(),profile_id uuid not null references profiles(id),status text not null default 'pending' check(status in('pending','completed','rejected')),requested_at timestamptz not null default now());
create table service_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id),
  description text not null,
  service_address text not null,
  workflow_status text not null default 'intake' check (workflow_status in ('intake', 'matched', 'quoted', 'funded', 'in_progress', 'completed', 'settled', 'cancelled')),
  safety_status text not null default 'pending' check (safety_status in ('pending', 'cleared', 'blocked')),
  hazard_reason text,
  expanded_search boolean not null default false,
  service_category text not null default 'general',
  service_area text not null default 'Charlotte',
  work_scope text,
  triage jsonb,
  work_scope_snapshot jsonb,
  price_disclosure jsonb,
  price_disclosure_accepted boolean not null default false,
  created_at timestamptz not null default now(),
  check ((safety_status = 'blocked') = (hazard_reason is not null))
);

create table request_matches (
  request_id uuid not null references service_requests(id),
  provider_id uuid not null references profiles(id),
  rank smallint not null check (rank between 1 and 3),
  status text not null default 'invited' check (status in ('invited', 'viewed', 'declined', 'quoted')),
  exploration_selected boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (request_id, provider_id),
  unique (request_id, rank)
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references service_requests(id),
  provider_id uuid not null references profiles(id),
  provider_name text not null,
  scope text not null,
  amount_cents bigint not null check (amount_cents > 0),
  ranking_total_cents bigint check(ranking_total_cents>0),
  earliest_start_at timestamptz,
  warranty_days integer check(warranty_days>=0),
  ranking jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'rejected', 'expired')),
  created_at timestamptz not null default now()
);

create table quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id),
  request_id uuid not null,
  provider_id uuid not null,
  scope text not null,
  amount_cents bigint not null check (amount_cents > 0),
  captured_at timestamptz not null default now()
);
create table ranking_policies(version bigint primary key,effective_from timestamptz not null,effective_until timestamptz,weights jsonb not null,exploration_percent integer not null check(exploration_percent between 0 and 100),exploration_bonus numeric not null check(exploration_bonus>=0),check(effective_until is null or effective_until>effective_from));
insert into ranking_policies(version,effective_from,weights,exploration_percent,exploration_bonus) values(1,'2026-01-01T00:00:00Z','{"license":1500,"insurance":1500,"rating":600,"distance":40,"response":0.5,"schedule":50,"language":500,"price":0.01}',15,1500);
create table quote_ranking_snapshots(id uuid primary key default gen_random_uuid(),quote_id uuid not null unique references quotes(id),request_id uuid not null references service_requests(id),provider_id uuid not null references profiles(id),policy_version bigint not null references ranking_policies(version),score numeric not null,license_verified boolean not null,insurance_verified boolean not null,rating numeric(3,2) not null,distance_miles numeric(8,2) not null,response_minutes integer not null,schedule_at timestamptz not null,languages text[] not null default '{}',price_cents bigint not null,exploration_selected boolean not null,captured_at timestamptz not null default clock_timestamp());
create function snapshot_quote_ranking() returns trigger language plpgsql security definer set search_path=public as $quote_ranking$ declare v_policy ranking_policies;v_license boolean;v_insurance boolean;v_rating numeric;v_distance numeric;v_response integer;v_schedule timestamptz;v_languages text[];v_exploration boolean;v_score numeric;begin select rp.* into v_policy from ranking_policies rp where rp.effective_from<=new.created_at and (rp.effective_until is null or new.created_at<rp.effective_until) order by rp.version desc limit 1;if v_policy.version is null then raise exception 'ranking policy missing';end if;select p.license_verified,p.insurance_verified,coalesce((select avg(rv.rating) from reviews rv where rv.provider_id=new.provider_id),0),coalesce((new.ranking->>'distanceMiles')::numeric,9999),coalesce((new.ranking->>'responseMinutes')::integer,2147483647),coalesce(new.earliest_start_at,new.created_at),coalesce(array(select jsonb_array_elements_text(new.ranking->'languages')),'{}'),coalesce(m.exploration_selected,false) into v_license,v_insurance,v_rating,v_distance,v_response,v_schedule,v_languages,v_exploration from profiles p left join request_matches m on m.provider_id=p.id and m.request_id=new.request_id where p.id=new.provider_id;v_score:=(case when v_license then (v_policy.weights->>'license')::numeric else 0 end)+(case when v_insurance then (v_policy.weights->>'insurance')::numeric else 0 end)+least(5,v_rating)*(v_policy.weights->>'rating')::numeric+greatest(0,1200-v_distance*(v_policy.weights->>'distance')::numeric)+greatest(0,1000-v_response*(v_policy.weights->>'response')::numeric)+greatest(0,800-greatest(0,extract(epoch from(v_schedule-new.created_at))/86400)*(v_policy.weights->>'schedule')::numeric)+(case when cardinality(v_languages)>0 then (v_policy.weights->>'language')::numeric else 0 end)+greatest(0,2000-new.amount_cents*(v_policy.weights->>'price')::numeric)+(case when v_exploration then v_policy.exploration_bonus else 0 end);insert into quote_ranking_snapshots(quote_id,request_id,provider_id,policy_version,score,license_verified,insurance_verified,rating,distance_miles,response_minutes,schedule_at,languages,price_cents,exploration_selected) values(new.id,new.request_id,new.provider_id,v_policy.version,v_score,v_license,v_insurance,v_rating,v_distance,v_response,v_schedule,v_languages,new.amount_cents,v_exploration);return new;end;$quote_ranking$;
create trigger quotes_snapshot_ranking after insert on quotes for each row execute function snapshot_quote_ranking();
create unique index quotes_one_per_provider_request on quotes(request_id,provider_id);

create table jobs (
  request_id uuid primary key references service_requests(id),
  accepted_quote_snapshot_id uuid not null references quote_snapshots(id),
  work_status text not null default 'funded' check (work_status in ('funded', 'in_progress', 'completed', 'settled', 'cancelled')),
  payment_status text not null default 'deposit_due' check (payment_status in ('deposit_due', 'deposit_paid', 'balance_due', 'paid', 'partially_refunded', 'refunded')),
  dispute_status text not null default 'none' check (dispute_status in ('none', 'open', 'resolved')),
  deposit_cents bigint not null check (deposit_cents >= 0),
  completed_at timestamptz,
  settled_at timestamptz,
  check (settled_at is null or completed_at is not null)
);

create table change_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references jobs(request_id),
  description text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  items jsonb,
  evidence_ids uuid[],
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((approval_status = 'approved') = (approved_at is not null))
);

create table change_snapshots (
  id uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references change_orders(id),
  request_id uuid not null,
  description text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  approved_at timestamptz not null,
  captured_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references service_requests(id),
  kind text not null check (kind in ('deposit', 'balance', 'refund')),
  amount_cents bigint not null check (amount_cents > 0),
  provider_reference text unique,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table payment_snapshots (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  request_id uuid not null,
  kind text not null,
  amount_cents bigint not null check (amount_cents > 0),
  provider_reference text,
  captured_at timestamptz not null default now()
);

create table fee_policies (
  id uuid primary key default gen_random_uuid(),
  version bigint not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  founder_only boolean not null default false,
  fee_rate_bps integer not null check (fee_rate_bps between 0 and 10000),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  stripe_fee_treatment text not null check(stripe_fee_treatment in('included','deduct_actual')),
  refund_treatment text not null check(refund_treatment in('fee_refundable','fee_retained')),
  rounding text not null check(rounding='half_up'),
  unique(version,founder_only),
  check(effective_until is null or effective_until>effective_from)
);

create table fee_snapshots (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references jobs(request_id),
  basis_cents bigint not null check (basis_cents >= 0),
  fee_cents bigint not null check (fee_cents >= 0),
  fee_rate_bps integer not null check (fee_rate_bps between 0 and 10000),
  version bigint not null,
  policy_id uuid not null references fee_policies(id),
  tax_rate_bps integer not null,
  tax_cents bigint not null,
  stripe_fee_treatment text not null,
  refund_treatment text not null,
  rounding text not null,
  captured_at timestamptz not null default now()
);
alter table fee_policies enable row level security;
alter table fee_policies force row level security;
create unique index fee_snapshots_request_version on fee_snapshots(request_id, version);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references jobs(request_id),
  source text not null check (source in ('internal', 'external')),
  status text not null default 'open' check (status in ('open', 'resolved', 'under_review', 'won', 'lost')),
  reason text not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  external_version bigint not null default 0,
  updated_at timestamptz
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references jobs(request_id),
  submitted_by uuid not null references profiles(id),
  kind text not null check (kind in ('before', 'during', 'after', 'receipt', 'warranty', 'message')),
  storage_path text not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);

create table settlement_authorizations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references jobs(request_id),
  quote_cents bigint not null check (quote_cents > 0),
  approved_change_cents bigint not null check (approved_change_cents >= 0),
  deposit_cents bigint not null check (deposit_cents >= 0),
  balance_cents bigint generated always as (quote_cents + approved_change_cents - deposit_cents) stored,
  authorized_by uuid not null references profiles(id),
  authorized_at timestamptz not null default now(),
  check (quote_cents + approved_change_cents >= deposit_cents)
);

create table request_media(id uuid primary key default gen_random_uuid(),request_id uuid not null references service_requests(id),owner_id uuid not null references profiles(id),file_name text not null,content_type text not null check(content_type in('image/jpeg','image/png','video/mp4','audio/webm','audio/mpeg')),size_bytes bigint not null check(size_bytes between 1 and 25000000),object_path text not null unique,sanitized_object_path text unique,upload_status text not null default 'pending' check(upload_status in('pending','uploaded')),is_private boolean not null default true check(is_private),sanitization_status text not null default 'pending_scan' check(sanitization_status in('pending_scan','sanitized','rejected')),exif_removal_status text not null default 'pending' check(exif_removal_status in('pending','removed','failed')),retry_count integer not null default 0 check(retry_count between 0 and 5),checksum text not null check(checksum~'^[a-f0-9]{64}$'),privacy_deletion_id uuid references deletion_requests(id),created_at timestamptz not null default now(),unique(request_id,owner_id,checksum),check(sanitization_status<>'sanitized' or (exif_removal_status='removed' and sanitized_object_path is not null)));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('request-media-private','request-media-private',false,25000000,array['image/jpeg','image/png','video/mp4','audio/webm','audio/mpeg'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table request_messages(id uuid primary key default gen_random_uuid(),request_id uuid not null references service_requests(id),sender_id uuid not null references profiles(id),body text not null check(length(body) between 1 and 2000),created_at timestamptz not null default now());
create table request_schedules(request_id uuid primary key references service_requests(id),starts_at timestamptz not null,time_zone text not null,status text not null check(status in('proposed','confirmed')),updated_at timestamptz not null default now());
create table reviews(id uuid primary key default gen_random_uuid(),request_id uuid not null unique references jobs(request_id),customer_id uuid not null references profiles(id),provider_id uuid not null references profiles(id),rating integer not null check(rating between 1 and 5),body text not null check(length(body) between 3 and 2000),created_at timestamptz not null default now());
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  actor text not null,
  request_id uuid references service_requests(id),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  rationale text not null,
  correlation_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create function append_audit(p_action text,p_request_id uuid,p_resource_type text,p_resource_id text,p_rationale text,p_correlation_id text,p_detail jsonb default '{}'::jsonb,p_actor_id uuid default auth.uid()) returns void language sql security definer set search_path=public as $audit$ insert into audit_events(actor_id,actor,request_id,action,resource_type,resource_id,rationale,correlation_id,detail) values(p_actor_id,coalesce(p_actor_id::text,auth.role(),'system'),p_request_id,p_action,p_resource_type,p_resource_id,coalesce(nullif(p_rationale,''),p_action),coalesce(nullif(p_correlation_id,''),gen_random_uuid()::text),coalesce(p_detail,'{}'::jsonb)) $audit$;

create table idempotency_records (
  key text primary key,
  operation text not null,
  request_hash text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now()
);

create table stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  object_id text not null,
  request_id uuid not null references service_requests(id),
  payload_sha256 text not null,
  processed_at timestamptz not null default clock_timestamp()
);

create function validate_job_deposit() returns trigger language plpgsql as $$
declare
  quote_amount bigint;
begin
  select amount_cents into quote_amount from quote_snapshots where id = new.accepted_quote_snapshot_id;
  if quote_amount is null or new.deposit_cents <> ((quote_amount * 20 + 50) / 100) then
    raise exception 'deposit must be the rounded 20 percent quote amount';
  end if;
  return new;
end;
$$;

create trigger jobs_deposit_guard before insert or update of accepted_quote_snapshot_id, deposit_cents on jobs for each row execute function validate_job_deposit();

create function reject_immutable_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is immutable', tg_table_name;
end;
$$;

create function protect_work_scope_snapshot() returns trigger language plpgsql as $work_scope_immutable$ begin if old.work_scope_snapshot is not null and (new.work_scope_snapshot is distinct from old.work_scope_snapshot or new.triage is distinct from old.triage or new.price_disclosure is distinct from old.price_disclosure) then raise exception 'work scope snapshot is immutable';end if;return new;end;$work_scope_immutable$;
create trigger service_requests_work_scope_immutable before update of work_scope_snapshot,triage,price_disclosure on service_requests for each row execute function protect_work_scope_snapshot();
create trigger ranking_policies_immutable before update or delete on ranking_policies for each row execute function reject_immutable_mutation();
create trigger quote_ranking_snapshots_immutable before update or delete on quote_ranking_snapshots for each row execute function reject_immutable_mutation();
create trigger quote_snapshots_immutable before update or delete on quote_snapshots for each row execute function reject_immutable_mutation();
create trigger change_snapshots_immutable before update or delete on change_snapshots for each row execute function reject_immutable_mutation();
create trigger payments_immutable before update or delete on payments for each row execute function reject_immutable_mutation();
create trigger payment_snapshots_immutable before update or delete on payment_snapshots for each row execute function reject_immutable_mutation();
create trigger fee_snapshots_immutable before update or delete on fee_snapshots for each row execute function reject_immutable_mutation();
create trigger audit_events_immutable before update or delete on audit_events for each row execute function reject_immutable_mutation();
create trigger stripe_webhook_events_immutable before update or delete on stripe_webhook_events for each row execute function reject_immutable_mutation();

create function audit_domain_mutation() returns trigger language plpgsql security definer set search_path=public as $audit_mutation$ declare v_row jsonb;v_request_id uuid;v_resource_id text;v_correlation text;begin v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;v_request_id:=case when tg_table_name='service_requests' and tg_op<>'DELETE' then (v_row->>'id')::uuid when tg_table_name='service_requests' then null else nullif(v_row->>'request_id','')::uuid end;v_resource_id:=coalesce(v_row->>'id',v_row->>'request_id',v_row->>'profile_id','unknown');v_correlation:=coalesce(current_setting('request.headers',true)::jsonb->>'x-request-id',v_row->>'idempotency_key',gen_random_uuid()::text);perform append_audit(lower(tg_table_name)||'.'||lower(tg_op),v_request_id,tg_table_name,v_resource_id,'authorized production mutation',v_correlation,jsonb_build_object('operation',tg_op));return case when tg_op='DELETE' then old else new end;end;$audit_mutation$;

create function validate_settlement_authorization() returns trigger language plpgsql as $$
declare
  completion timestamptz;
  expected_quote bigint;
  expected_changes bigint;
  expected_deposit bigint;
  expected_version bigint;
  expected_token uuid;
begin
  new.authorized_at := clock_timestamp();
  select j.completed_at, qs.amount_cents, j.deposit_cents, j.authorization_version, j.authorization_token
    into completion, expected_quote, expected_deposit, expected_version, expected_token
    from jobs j join quote_snapshots qs on qs.id = j.accepted_quote_snapshot_id
    where j.request_id = new.request_id;
  if completion is null or new.authorized_at < completion + interval '72 hours' then
    raise exception 'settlement hold is active';
  end if;
  if exists (select 1 from disputes d where d.request_id = new.request_id and d.status = 'open') then
    raise exception 'settlement blocked by open internal or external dispute';
  end if;
  if expected_token is null or new.authorization_token <> expected_token or new.authorization_version <> expected_version then
    raise exception 'settlement authorization is stale';
  end if;
  select coalesce(sum(cs.amount_cents), 0) into expected_changes from change_snapshots cs where cs.request_id = new.request_id;
  if new.quote_cents <> expected_quote or new.approved_change_cents <> expected_changes or new.deposit_cents <> expected_deposit then
    raise exception 'settlement snapshot totals do not match immutable sources';
  end if;
  return new;
end;
$$;

create trigger settlement_authorization_guard before insert or update on settlement_authorizations for each row execute function validate_settlement_authorization();

alter table profiles enable row level security;
alter table service_requests enable row level security;
alter table request_matches enable row level security;
alter table quotes enable row level security;
alter table quote_ranking_snapshots enable row level security;
alter table quote_snapshots enable row level security;
alter table jobs enable row level security;
alter table change_orders enable row level security;
alter table change_snapshots enable row level security;
alter table payments enable row level security;
alter table payment_snapshots enable row level security;
alter table fee_snapshots enable row level security;
alter table disputes enable row level security;
alter table evidence enable row level security;
alter table settlement_authorizations enable row level security;
alter table audit_events enable row level security;
alter table idempotency_records enable row level security;
alter table stripe_webhook_events enable row level security;

alter table profiles force row level security;
alter table service_requests force row level security;
alter table request_matches force row level security;
alter table quotes force row level security;
alter table quote_ranking_snapshots force row level security;
alter table quote_snapshots force row level security;
alter table jobs force row level security;
alter table change_orders force row level security;
alter table change_snapshots force row level security;
alter table payments force row level security;
alter table payment_snapshots force row level security;
alter table fee_snapshots force row level security;
alter table disputes force row level security;
alter table evidence force row level security;
alter table settlement_authorizations force row level security;
alter table audit_events force row level security;
alter table idempotency_records force row level security;
alter table stripe_webhook_events force row level security;

create table operator_allowlist (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table operator_allowlist enable row level security;
alter table operator_allowlist force row level security;

alter table jobs
  add column settlement_state text not null default 'none' check (settlement_state in ('none', 'settled', 'reversed')),
  add column authorization_version bigint not null default 0,
  add column authorization_token uuid;
alter table disputes add column external_id text unique;
alter table payments drop constraint payments_kind_check;
alter table payments add check (kind in ('deposit', 'balance', 'transfer', 'refund', 'reversal'));
alter table payments add column source_payment_id uuid references payments(id);
alter table settlement_authorizations
  add column authorization_version bigint not null default 0,
  add column authorization_token uuid not null default gen_random_uuid(),
  add column fee_snapshot_id uuid references fee_snapshots(id),
  add column fee_version bigint,
  add column fee_rate_bps integer,
  add column fee_amount_cents bigint,
  add column captured_amount_cents bigint;

create function is_operator() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from operator_allowlist where user_id = auth.uid()) $$;
revoke all on function is_operator() from public;
grant execute on function is_operator() to authenticated;

create function provider_is_eligible(p_provider_id uuid,p_request_id uuid) returns boolean
language sql stable security definer set search_path=public as $provider_eligible$
  select exists(
    select 1 from profiles p cross join service_requests r
    where p.id=p_provider_id and p.role='provider' and p.provider_status='approved'
      and p.license_verified and p.license_expires_at>clock_timestamp()
      and p.insurance_verified and p.insurance_expires_at>clock_timestamp()
      and r.id=p_request_id and r.service_category=any(p.service_categories)
      and r.service_area=any(p.service_areas)
  )
$provider_eligible$;
revoke all on function provider_is_eligible(uuid,uuid) from public;
grant execute on function provider_is_eligible(uuid,uuid) to authenticated,service_role;

create function ranking_exploration_selected(p_request_id uuid,p_provider_id uuid) returns boolean language sql stable security definer set search_path=public as $exploration$ select ((('x'||substr(encode(extensions.digest(p_request_id::text||':'||p_provider_id::text,'sha256'),'hex'),1,8))::bit(32)::bigint%100)<rp.exploration_percent) from ranking_policies rp where rp.effective_from<=statement_timestamp() and (rp.effective_until is null or statement_timestamp()<rp.effective_until) order by rp.version desc limit 1 $exploration$;

create function can_access_request(target uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select is_operator()
    or exists (select 1 from service_requests r where r.id = target and r.customer_id = auth.uid())
    or exists (select 1 from request_matches m where m.request_id = target and m.provider_id = auth.uid() and provider_is_eligible(auth.uid(),target))
$$;
revoke all on function can_access_request(uuid) from public;
grant execute on function can_access_request(uuid) to authenticated;

create policy profiles_self_select on profiles for select to authenticated using (id = auth.uid() or is_operator());
create policy requests_scope_select on service_requests for select to authenticated using (can_access_request(id));
create policy requests_customer_insert on service_requests for insert to authenticated with check (customer_id = auth.uid() and safety_status in ('pending', 'cleared', 'blocked'));
create policy matches_scope_select on request_matches for select to authenticated using (can_access_request(request_id));
create policy quotes_scope_select on quotes for select to authenticated using (can_access_request(request_id));
create policy quote_ranking_scope_select on quote_ranking_snapshots for select to authenticated using(can_access_request(request_id));
create policy quotes_assigned_provider_insert on quotes for insert to authenticated
  with check (provider_id = auth.uid() and provider_is_eligible(auth.uid(),request_id) and exists (select 1 from request_matches m where m.request_id = quotes.request_id and m.provider_id = auth.uid()));
create policy jobs_scope_select on jobs for select to authenticated using (can_access_request(request_id));
create policy changes_scope_select on change_orders for select to authenticated using (can_access_request(request_id));
create policy changes_assigned_provider_insert on change_orders for insert to authenticated
  with check (provider_is_eligible(auth.uid(),request_id) and exists (select 1 from request_matches m where m.request_id = change_orders.request_id and m.provider_id = auth.uid()));
create policy evidence_scope_select on evidence for select to authenticated using (can_access_request(request_id));
create policy evidence_assigned_provider_insert on evidence for insert to authenticated
  with check (submitted_by = auth.uid() and provider_is_eligible(auth.uid(),request_id) and exists (select 1 from request_matches m where m.request_id = evidence.request_id and m.provider_id = auth.uid()));
create policy disputes_scope_select on disputes for select to authenticated using (can_access_request(request_id));
create policy disputes_customer_insert on disputes for insert to authenticated
  with check (source = 'internal' and exists (select 1 from service_requests r where r.id = disputes.request_id and r.customer_id = auth.uid()));
create policy quote_snapshots_scope_select on quote_snapshots for select to authenticated using (can_access_request(request_id));
create policy change_snapshots_scope_select on change_snapshots for select to authenticated using (can_access_request(request_id));
create policy payment_snapshots_scope_select on payment_snapshots for select to authenticated using (can_access_request(request_id));
create policy fee_snapshots_scope_select on fee_snapshots for select to authenticated using (can_access_request(request_id));
create policy payments_operator_select on payments for select to authenticated using (is_operator());
create policy settlement_operator_select on settlement_authorizations for select to authenticated using (is_operator());
create policy audit_operator_select on audit_events for select to authenticated using (is_operator());
create policy allowlist_self_select on operator_allowlist for select to authenticated using (user_id = auth.uid());

alter table quotes add constraint quotes_identity unique (id, request_id, provider_id);
alter table quote_snapshots add constraint quote_snapshots_quote_same_request_provider
  foreign key (quote_id, request_id, provider_id) references quotes(id, request_id, provider_id);
alter table change_orders add constraint change_orders_identity unique (id, request_id);
alter table change_snapshots add constraint change_snapshots_change_same_request
  foreign key (change_order_id, request_id) references change_orders(id, request_id);
alter table payments add constraint payments_identity unique (id, request_id);
alter table payment_snapshots add constraint payment_snapshots_payment_same_request
  foreign key (payment_id, request_id) references payments(id, request_id);

create function start_assigned_job(p_request_id uuid) returns jobs
language plpgsql security definer set search_path = public
as $$
declare result jobs;
begin
  if not provider_is_eligible(auth.uid(),p_request_id) then raise exception 'provider ineligible'; end if;
  update service_requests r set workflow_status = 'in_progress'
    where r.id = p_request_id and r.workflow_status = 'funded'
      and exists (select 1 from jobs j join quote_snapshots q on q.id = j.accepted_quote_snapshot_id
                  where j.request_id = r.id and q.provider_id = auth.uid());
  if not found then raise exception 'invalid transition or provider assignment'; end if;
  update jobs set work_status = 'in_progress' where jobs.request_id = p_request_id returning * into result;
  return result;
end;
$$;

create function complete_assigned_job(p_request_id uuid) returns jobs
language plpgsql security definer set search_path = public
as $$
declare v_result jobs; v_provider_id uuid;
begin
  if not provider_is_eligible(auth.uid(),p_request_id) then raise exception 'provider ineligible'; end if;
  select q.provider_id into v_provider_id from jobs j join quote_snapshots q on q.id = j.accepted_quote_snapshot_id
    where j.request_id = p_request_id and j.work_status = 'in_progress';
  if v_provider_id is distinct from auth.uid() then raise exception 'invalid transition or provider assignment'; end if;
  if not exists (select 1 from evidence e where e.request_id = p_request_id and e.submitted_by = v_provider_id and e.kind = 'before')
     or not exists (select 1 from evidence e where e.request_id = p_request_id and e.submitted_by = v_provider_id and e.kind = 'after')
  then raise exception 'before and after evidence required'; end if;
  update jobs j set work_status = 'completed', completed_at = clock_timestamp(), authorization_version = j.authorization_version + 1
    where j.request_id = p_request_id returning j.* into v_result;
  update service_requests r set workflow_status = 'completed' where r.id = p_request_id;
  return v_result;
end;
$$;

create function create_service_request(p_customer_name text,p_description text,p_address text,p_hazards text[]) returns service_requests
language plpgsql security definer set search_path = public as $$
declare v_result service_requests; v_dangerous text[];
begin
  v_dangerous := array(select hazard from unnest(p_hazards) as input(hazard) where hazard <> 'none');
  insert into service_requests(customer_id, description, service_address, safety_status, hazard_reason)
    values (auth.uid(), p_description, p_address, case when cardinality(v_dangerous)>0 then 'blocked' else 'cleared' end,
      case when cardinality(v_dangerous)>0 then array_to_string(v_dangerous, ', ') end) returning * into v_result;
  return v_result;
end; $$;

create function operator_match_request(p_request_id uuid,p_provider_ids uuid[]) returns service_requests
language plpgsql security definer set search_path = public as $$
declare result service_requests;
begin
  if not is_operator() then raise exception 'operator allowlist required'; end if;
  if cardinality(p_provider_ids) not between 1 and 3 then raise exception 'one to three providers required'; end if;
  if not exists(select 1 from service_requests sr where sr.id=p_request_id and sr.safety_status='cleared' and sr.workflow_status='intake') then raise exception 'invalid request transition'; end if;
  if exists(select 1 from unnest(p_provider_ids) as candidate(provider_id) where not provider_is_eligible(candidate.provider_id,p_request_id)) then raise exception 'provider ineligible'; end if;
  delete from request_matches where request_matches.request_id=p_request_id;
  insert into request_matches(request_id,provider_id,rank,exploration_selected)
    select p_request_id,candidate.provider_id,candidate.rank,
      not exists(select 1 from reviews rv where rv.provider_id=candidate.provider_id) and ranking_exploration_selected(p_request_id,candidate.provider_id)
    from unnest(p_provider_ids) with ordinality as candidate(provider_id,rank);
  update service_requests sr set workflow_status='matched', expanded_search=cardinality(p_provider_ids)<3 where sr.id=p_request_id returning * into result;
  return result;
end; $$;

create function submit_quote(p_request_id uuid, p_provider_name text, p_scope text, p_amount_cents bigint,p_ranking jsonb) returns quotes
language plpgsql security definer set search_path = public as $submit_quote$
declare v_result quotes; v_status text; v_workflow text;
begin
  if not provider_is_eligible(auth.uid(),p_request_id) then raise exception 'provider ineligible'; end if;
  select rm.status,r.workflow_status into v_status,v_workflow from request_matches rm join service_requests r on r.id=rm.request_id where rm.request_id=p_request_id and rm.provider_id=auth.uid() for update of rm,r;
  if v_workflow is null or v_workflow not in ('matched','quoted') then raise exception 'request is not accepting quotes'; end if;
  if v_status is null or v_status not in ('invited','viewed') then raise exception 'provider not matched or already quoted'; end if;
  if exists(select 1 from quotes q where q.request_id=p_request_id and q.provider_id=auth.uid()) then raise exception 'provider quote already exists'; end if;
  if p_amount_cents<=0 or p_amount_cents>99999999 then raise exception 'stripe amount limit exceeded'; end if;
  if p_ranking is null or (p_ranking->>'totalCents')::bigint<>p_amount_cents then raise exception 'complete ranking required';end if;
  insert into quotes(request_id,provider_id,provider_name,scope,amount_cents,ranking_total_cents,earliest_start_at,warranty_days,ranking) values(p_request_id,auth.uid(),p_provider_name,p_scope,p_amount_cents,p_amount_cents,(p_ranking->>'earliestStartAt')::timestamptz,(p_ranking->>'warrantyDays')::integer,p_ranking) returning * into v_result;
  insert into quote_snapshots(quote_id,request_id,provider_id,scope,amount_cents) values(v_result.id,v_result.request_id,v_result.provider_id,v_result.scope,v_result.amount_cents);
  update request_matches rm set status='quoted' where rm.request_id=p_request_id and rm.provider_id=auth.uid();
  update service_requests r set workflow_status='quoted',expanded_search=(select count(distinct q.provider_id)<3 from quotes q where q.request_id=p_request_id) where r.id=p_request_id;
  return v_result;
end; $submit_quote$;

create function operator_add_provider_slot(p_request_id uuid,p_provider_id uuid) returns request_matches
language plpgsql security definer set search_path=public as $provider_slot$
declare v_result request_matches;v_rank integer;
begin
 if not is_operator() then raise exception 'operator required';end if;
 if not provider_is_eligible(p_provider_id,p_request_id) then raise exception 'provider ineligible';end if;
 select count(*)+1 into v_rank from request_matches rm where rm.request_id=p_request_id for update;
 if v_rank>3 then raise exception 'provider slots full';end if;
 insert into request_matches(request_id,provider_id,rank,exploration_selected) values(p_request_id,p_provider_id,v_rank,not exists(select 1 from reviews rv where rv.provider_id=p_provider_id) and ranking_exploration_selected(p_request_id,p_provider_id)) returning * into v_result;
 update service_requests r set expanded_search=v_rank<3 where r.id=p_request_id;
 return v_result;
end;$provider_slot$;

create function submit_job_evidence(p_request_id uuid,p_kind text,p_note text) returns evidence
language plpgsql security definer set search_path = public as $$
declare result evidence;
begin
  if not provider_is_eligible(auth.uid(),p_request_id) then raise exception 'provider ineligible'; end if;
  if not exists(select 1 from jobs j join quote_snapshots q on q.id=j.accepted_quote_snapshot_id where j.request_id=p_request_id and q.provider_id=auth.uid()) then raise exception 'provider not assigned to accepted quote'; end if;
  insert into evidence(request_id,submitted_by,kind,storage_path,sha256) values(p_request_id,auth.uid(),p_kind,'note:'||encode(extensions.digest(p_note,'sha256'),'hex'),encode(extensions.digest(p_note,'sha256'),'hex')) returning * into result;
  return result;
end; $$;

create function propose_change_order(p_request_id uuid,p_description text,p_amount_cents bigint,p_items jsonb,p_evidence_ids uuid[]) returns change_orders
language plpgsql security definer set search_path = public as $$
declare result change_orders;
begin
  if not provider_is_eligible(auth.uid(),p_request_id) then raise exception 'provider ineligible'; end if;
  if not exists(select 1 from jobs j join quote_snapshots q on q.id=j.accepted_quote_snapshot_id where j.request_id=p_request_id and q.provider_id=auth.uid() and j.work_status='in_progress') then raise exception 'provider not assigned or job not active'; end if;
  if p_items is null or jsonb_array_length(p_items)=0 or cardinality(p_evidence_ids)=0 or exists(select 1 from unnest(p_evidence_ids) e where not exists(select 1 from evidence ev where ev.id=e and ev.request_id=p_request_id and ev.submitted_by=auth.uid())) then raise exception 'itemized evidence required';end if;
  insert into change_orders(request_id,description,amount_cents,items,evidence_ids) values(p_request_id,p_description,p_amount_cents,p_items,p_evidence_ids) returning * into result;
  return result;
end; $$;

create function approve_change_order(p_change_id uuid) returns change_orders
language plpgsql security definer set search_path = public as $$
declare v_result change_orders;
begin
  update change_orders c set approval_status='approved',approved_at=clock_timestamp() from service_requests r where c.id=p_change_id and r.id=c.request_id and r.customer_id=auth.uid() and c.approval_status='pending' returning c.* into v_result;
  if v_result.id is null then raise exception 'change unavailable'; end if;
  insert into change_snapshots(change_order_id,request_id,description,amount_cents,approved_at) values(v_result.id,v_result.request_id,v_result.description,v_result.amount_cents,v_result.approved_at);
  return v_result;
end; $$;

create function open_internal_dispute(p_request_id uuid,p_source text,p_reason text) returns disputes
language plpgsql security definer set search_path = public as $$
declare v_result disputes; v_completed_at timestamptz; v_now timestamptz:=clock_timestamp();
begin
  if p_source is distinct from 'internal' then raise exception 'external disputes require webhook'; end if;
  select j.completed_at into v_completed_at
    from jobs j
    join service_requests r on r.id=j.request_id
    where j.request_id=p_request_id and r.customer_id=auth.uid()
    for update of j;
  if not found then raise exception 'request unavailable'; end if;
  if v_completed_at is null or v_now<v_completed_at or v_now>=v_completed_at+interval '72 hours' then raise exception 'dispute window closed'; end if;
  insert into disputes as d(request_id,source,reason)
    values(p_request_id,'internal',p_reason)
    returning d.* into v_result;
  update jobs j
    set dispute_status='open',authorization_version=j.authorization_version+1,authorization_token=null
    where j.request_id=p_request_id;
  delete from settlement_authorizations sa where sa.request_id=p_request_id;
  return v_result;
end; $$;

create function operator_resolve_dispute(p_dispute_id uuid) returns disputes
language plpgsql security definer set search_path = public as $$
declare v_result disputes;
begin
  if not is_operator() then raise exception 'operator allowlist required'; end if;
  update disputes d set status='resolved',resolved_at=clock_timestamp() where d.id=p_dispute_id and d.status='open' returning d.* into v_result;
  if v_result.id is null then raise exception 'dispute unavailable'; end if;
  update jobs j set dispute_status=case when exists(select 1 from disputes d where d.request_id=v_result.request_id and d.status='open') then 'open' else 'resolved' end, authorization_version=j.authorization_version+1,authorization_token=null where j.request_id=v_result.request_id;
  delete from settlement_authorizations sa where sa.request_id=v_result.request_id;
  return v_result;
end; $$;

alter table payments add column status text not null default 'succeeded' check (status in ('pending','succeeded','failed'));
alter table jobs drop constraint jobs_settlement_state_check;
alter table jobs add check (settlement_state in ('none','authorized','transferring','reconciliation_required','settled','reversed','manual_action'));
create table payment_attempts (id uuid primary key default gen_random_uuid(),request_id uuid not null references service_requests(id),quote_id uuid references quotes(id),kind text not null check(kind in ('deposit','balance')),amount_cents bigint not null check(amount_cents>0),provider_reference text not null unique,client_secret text,idempotency_key text not null unique,state text not null default 'pending' check(state in ('pending','succeeded','failed')),created_at timestamptz not null default clock_timestamp());
alter table payment_attempts enable row level security; alter table payment_attempts force row level security;
alter table quotes add constraint quotes_stripe_amount_max check(amount_cents<=99999999);
alter table payments add constraint payments_stripe_amount_max check(amount_cents<=99999999);
alter table payment_attempts add constraint payment_attempts_stripe_amount_max check(amount_cents<=99999999);
create function enforce_request_stripe_aggregate() returns trigger language plpgsql as $amount_guard$ declare v_quote bigint; v_changes bigint; begin select qs.amount_cents into v_quote from jobs j join quote_snapshots qs on qs.id=j.accepted_quote_snapshot_id where j.request_id=new.request_id; select coalesce(sum(co.amount_cents),0) into v_changes from change_orders co where co.request_id=new.request_id and co.approval_status='approved' and co.id<>coalesce(new.id,gen_random_uuid()); if coalesce(v_quote,0)+v_changes+new.amount_cents>99999999 then raise exception 'stripe aggregate amount limit exceeded'; end if; return new; end; $amount_guard$;
create trigger change_orders_stripe_aggregate before insert or update of amount_cents,approval_status on change_orders for each row when(new.approval_status='approved') execute function enforce_request_stripe_aggregate();
create table money_operations (id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('deposit','balance','settlement','refund','external_dispute','payment_succeeded','recovery')),idempotency_key text not null unique,fingerprint jsonb not null,request_id uuid not null references service_requests(id),external_object_id text,state text not null default 'claimed' check(state in ('claimed','completed','failed')),amount_cents bigint not null check(amount_cents between 0 and 99999999),destination_account text,provider_reference text,provider_idempotency_key text unique,failure_reason text,claimed_at timestamptz not null default clock_timestamp(),completed_at timestamptz);
alter table money_operations enable row level security; alter table money_operations force row level security;
create function assign_provider_idempotency_key() returns trigger language plpgsql as $provider_key$ begin if new.provider_idempotency_key is null then new.provider_idempotency_key:=case when new.kind='external_dispute' then 'reversal:'||new.id else new.id::text end; end if; return new; end; $provider_key$;
create trigger money_operations_provider_key before insert on money_operations for each row execute function assign_provider_idempotency_key();
create trigger money_operations_no_delete before delete on money_operations for each row execute function reject_immutable_mutation();
create unique index one_deposit_operation_per_request on money_operations(request_id) where kind='deposit';
create unique index one_balance_operation_per_request on money_operations(request_id) where kind='balance';
create table refund_allocations (operation_id uuid not null references money_operations(id),payment_id uuid not null references payments(id),amount_cents bigint not null check(amount_cents>0),refund_reference text,primary key(operation_id,payment_id));
create table stripe_dispute_objects (external_id text primary key,request_id uuid not null references service_requests(id),status text not null check(status in('under_review','won','lost')),version bigint not null default 1,updated_at timestamptz not null default clock_timestamp());

create function claim_result(op money_operations) returns jsonb language plpgsql volatile security definer set search_path=public as $claim_result$ declare v_result jsonb;begin
  v_result:=jsonb_build_object('claim_id',op.id,'claim_state',case when op.state='completed' then 'completed' else 'claimed' end,
    'amount_cents',op.amount_cents,'destination_account',op.destination_account,'provider_reference',op.provider_reference,'provider_idempotency_key',op.provider_idempotency_key,'request_id',op.request_id,'claimed_at',op.claimed_at,
    'allocations',(select coalesce(jsonb_agg(jsonb_build_object('paymentId',ra.payment_id,'paymentIntentId',p.provider_reference,'amountCents',ra.amount_cents)),'[]'::jsonb) from refund_allocations ra join payments p on p.id=ra.payment_id where ra.operation_id=op.id));
  perform append_audit('money.'||op.kind||'.'||op.state,op.request_id,'money_operation',op.id::text,'money lifecycle state returned',op.idempotency_key,jsonb_build_object('state',op.state));
  return v_result;
end;$claim_result$;

create function money_operation_fail(p_claim_id uuid,p_failure_reason text) returns void language plpgsql security definer set search_path=public as $money_fail$ declare v_op money_operations; begin if auth.role()<>'service_role' then raise exception 'service role required'; end if; update money_operations m set state='failed',failure_reason=p_failure_reason where m.id=p_claim_id and m.state='claimed' returning m.* into v_op; if v_op.kind='settlement' then update jobs j set settlement_state='authorized' where j.request_id=v_op.request_id and j.settlement_state='transferring'; end if; end; $money_fail$;
create function deposit_fail(p_claim_id uuid,p_failure_reason text) returns void language sql security definer set search_path=public as $deposit_fail$ select money_operation_fail(p_claim_id,p_failure_reason) $deposit_fail$;
create function balance_fail(p_claim_id uuid,p_failure_reason text) returns void language sql security definer set search_path=public as $balance_fail$ select money_operation_fail(p_claim_id,p_failure_reason) $balance_fail$;
create function payment_succeeded_fail(p_claim_id uuid,p_failure_reason text) returns void language sql security definer set search_path=public as $payment_fail$ select money_operation_fail(p_claim_id,p_failure_reason) $payment_fail$;
create function settlement_fail(p_claim_id uuid,p_failure_reason text) returns void language sql security definer set search_path=public as $settlement_fail$ select money_operation_fail(p_claim_id,p_failure_reason) $settlement_fail$;
create function refund_fail(p_claim_id uuid,p_failure_reason text) returns void language sql security definer set search_path=public as $refund_fail$ select money_operation_fail(p_claim_id,p_failure_reason) $refund_fail$;
create function external_dispute_fail(p_claim_id uuid,p_failure_reason text) returns void language sql security definer set search_path=public as $dispute_fail$ select money_operation_fail(p_claim_id,p_failure_reason) $dispute_fail$;

-- Money lifecycle v2 RPCs share the in-memory contract.
create table booking_fee_snapshots(request_id uuid primary key references jobs(request_id),policy_id uuid not null references fee_policies(id),policy_version bigint not null,fee_rate_bps integer not null,tax_rate_bps integer not null,stripe_fee_treatment text not null,refund_treatment text not null,rounding text not null,captured_at timestamptz not null default clock_timestamp());
create table change_fee_snapshots(change_snapshot_id uuid primary key references change_snapshots(id),request_id uuid not null references jobs(request_id),policy_id uuid not null references fee_policies(id),basis_cents bigint not null,fee_cents bigint not null,tax_cents bigint not null,captured_at timestamptz not null default clock_timestamp());
alter table booking_fee_snapshots enable row level security; alter table booking_fee_snapshots force row level security;
alter table change_fee_snapshots enable row level security; alter table change_fee_snapshots force row level security;
create trigger booking_fee_snapshots_immutable before update or delete on booking_fee_snapshots for each row execute function reject_immutable_mutation();
create trigger change_fee_snapshots_immutable before update or delete on change_fee_snapshots for each row execute function reject_immutable_mutation();
create policy booking_fee_scope on booking_fee_snapshots for select to authenticated using(can_access_request(request_id));
create policy change_fee_scope on change_fee_snapshots for select to authenticated using(can_access_request(request_id));
create function snapshot_booking_fee() returns trigger language plpgsql security definer set search_path=public as $booking_fee$ declare v_policy fee_policies; v_policy_id uuid; v_matches integer; v_founder boolean; begin select p.founder_eligible into v_founder from quote_snapshots qs join profiles p on p.id=qs.provider_id where qs.id=new.accepted_quote_snapshot_id; select count(*),min(fp.id::text)::uuid into v_matches,v_policy_id from fee_policies fp where fp.effective_from<=clock_timestamp() and (fp.effective_until is null or clock_timestamp()<fp.effective_until) and (not fp.founder_only or v_founder); if v_matches<>1 then raise exception 'effective fee policy missing or overlapping'; end if; select fp.* into v_policy from fee_policies fp where fp.id=v_policy_id; insert into booking_fee_snapshots(request_id,policy_id,policy_version,fee_rate_bps,tax_rate_bps,stripe_fee_treatment,refund_treatment,rounding) values(new.request_id,v_policy.id,v_policy.version,v_policy.fee_rate_bps,v_policy.tax_rate_bps,v_policy.stripe_fee_treatment,v_policy.refund_treatment,v_policy.rounding);return new;end;$booking_fee$;
create function snapshot_approved_change_fee() returns trigger language plpgsql security definer set search_path=public as $change_fee$ declare v_booking booking_fee_snapshots; v_fee bigint; v_tax bigint; begin select bfs.* into v_booking from booking_fee_snapshots bfs where bfs.request_id=new.request_id; if v_booking.request_id is null then raise exception 'booking fee snapshot missing'; end if; v_fee:=((new.amount_cents*v_booking.fee_rate_bps+5000)/10000);v_tax:=((v_fee*v_booking.tax_rate_bps+5000)/10000);insert into change_fee_snapshots(change_snapshot_id,request_id,policy_id,basis_cents,fee_cents,tax_cents) values(new.id,new.request_id,v_booking.policy_id,new.amount_cents,v_fee,v_tax);return new;end;$change_fee$;
create trigger change_snapshots_fee after insert on change_snapshots for each row execute function snapshot_approved_change_fee();
create trigger jobs_snapshot_booking_fee after insert on jobs for each row execute function snapshot_booking_fee();
create function deposit_claim(p_request_id uuid,p_quote_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=public as $deposit_claim$ declare v_op money_operations; v_quote quotes; v_cents bigint; v_fp jsonb:=jsonb_build_object('request_id',p_request_id,'quote_id',p_quote_id); begin select m.* into v_op from money_operations m where m.idempotency_key=p_idempotency_key for update; if found then if v_op.fingerprint<>v_fp then raise exception 'idempotency key reused'; end if; if v_op.state='completed' then return claim_result(v_op); end if; if v_op.state='failed' then update money_operations m set state='claimed',failure_reason=null where m.id=v_op.id returning m.* into v_op; end if; return claim_result(v_op); end if; select q.* into v_quote from quotes q join service_requests r on r.id=q.request_id where q.id=p_quote_id and q.request_id=p_request_id and r.customer_id=auth.uid() and r.workflow_status='quoted' and r.safety_status='cleared' for update; if v_quote.id is null then raise exception 'quote unavailable'; end if; v_cents:=((v_quote.amount_cents*20+50)/100); if v_cents<=0 or v_cents>99999999 then raise exception 'stripe amount limit exceeded'; end if; insert into money_operations(kind,idempotency_key,fingerprint,request_id,amount_cents) values('deposit',p_idempotency_key,v_fp,p_request_id,v_cents) returning * into v_op; return claim_result(v_op); end; $deposit_claim$;
create function balance_claim(p_request_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_op money_operations; v_job jobs; v_cents bigint; v_fp jsonb:=jsonb_build_object('request_id',p_request_id); begin select m.* into v_op from money_operations m where m.idempotency_key=p_idempotency_key for update; if found then return claim_result(v_op); end if; select job.* into v_job from jobs job join service_requests r on r.id=job.request_id where job.request_id=p_request_id and r.customer_id=auth.uid() and job.completed_at is not null for update of job; if v_job.request_id is null then raise exception 'completion required or forbidden'; end if; select qs.amount_cents+coalesce((select sum(cs.amount_cents) from change_snapshots cs where cs.request_id=v_job.request_id),0)-v_job.deposit_cents into v_cents from quote_snapshots qs where qs.id=v_job.accepted_quote_snapshot_id; if v_cents<=0 or exists(select 1 from payment_attempts pa where pa.request_id=v_job.request_id and pa.kind='balance' and pa.state<>'failed') then raise exception 'balance unavailable'; end if; insert into money_operations(kind,idempotency_key,fingerprint,request_id,amount_cents) values('balance',p_idempotency_key,v_fp,p_request_id,v_cents) returning * into v_op; return claim_result(v_op); end; $$;
create function customer_payment_complete(p_claim_id uuid,p_provider_reference text,p_detail jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_op money_operations; begin select m.* into v_op from money_operations m where m.id=p_claim_id and m.kind in('deposit','balance') for update; if v_op.id is null or v_op.state='failed' then raise exception 'claim missing or terminally failed'; end if; if v_op.state='completed' then return claim_result(v_op); end if; insert into payment_attempts(request_id,quote_id,kind,amount_cents,provider_reference,client_secret,idempotency_key) values(v_op.request_id,case when v_op.kind='deposit' then (v_op.fingerprint->>'quote_id')::uuid end,v_op.kind,v_op.amount_cents,p_provider_reference,p_detail->>'clientSecret',v_op.idempotency_key); update money_operations m set state='completed',provider_reference=p_provider_reference,completed_at=clock_timestamp() where m.id=v_op.id returning m.* into v_op; return claim_result(v_op)||jsonb_build_object('clientSecret',p_detail->>'clientSecret'); end; $$;
create function deposit_complete(p_claim_id uuid,p_provider_reference text,p_detail jsonb) returns jsonb language sql security definer set search_path=public as $$select customer_payment_complete(p_claim_id,p_provider_reference,p_detail)$$;
create function balance_complete(p_claim_id uuid,p_provider_reference text,p_detail jsonb) returns jsonb language sql security definer set search_path=public as $$select customer_payment_complete(p_claim_id,p_provider_reference,p_detail)$$;
create function payment_succeeded_claim(p_request_id uuid,p_provider_reference text,p_event_id text,p_payload_sha256 text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_op money_operations; v_attempt payment_attempts; begin select m.* into v_op from money_operations m where m.idempotency_key=p_idempotency_key for update; if found then return claim_result(v_op); end if; insert into stripe_webhook_events(event_id,event_type,object_id,request_id,payload_sha256) values(p_event_id,'payment_intent.succeeded',p_provider_reference,p_request_id,p_payload_sha256) on conflict do nothing; if not found then raise exception 'webhook already claimed'; end if; select pa.* into v_attempt from payment_attempts pa where pa.provider_reference=p_provider_reference and pa.state='pending' for update; if v_attempt.id is null then raise exception 'pending payment missing'; end if; insert into money_operations(kind,idempotency_key,fingerprint,request_id,amount_cents,provider_reference) values('payment_succeeded',p_idempotency_key,jsonb_build_object('event_id',p_event_id),p_request_id,v_attempt.amount_cents,p_provider_reference) returning * into v_op; return claim_result(v_op); end; $$;
create function payment_succeeded_complete(p_claim_id uuid,p_provider_reference text,p_detail jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_op money_operations; v_attempt payment_attempts; v_paid payments; v_snapshot_id uuid; begin select m.* into v_op from money_operations m where m.id=p_claim_id for update; if v_op.id is null or v_op.state='failed' then raise exception 'claim missing or terminally failed'; end if; if v_op.state='completed' then return claim_result(v_op); end if; update payment_attempts pa set state='succeeded' where pa.provider_reference=p_provider_reference returning pa.* into v_attempt; insert into payments(request_id,kind,status,amount_cents,provider_reference,idempotency_key) values(v_op.request_id,v_attempt.kind,'succeeded',v_op.amount_cents,p_provider_reference,'succeeded:'||v_op.idempotency_key) returning * into v_paid; insert into payment_snapshots(payment_id,request_id,kind,amount_cents,provider_reference) values(v_paid.id,v_paid.request_id,v_paid.kind,v_paid.amount_cents,v_paid.provider_reference); if v_attempt.kind='deposit' then select qs.id into v_snapshot_id from quote_snapshots qs where qs.quote_id=v_attempt.quote_id; insert into jobs(request_id,accepted_quote_snapshot_id,deposit_cents,payment_status) values(v_op.request_id,v_snapshot_id,v_op.amount_cents,'deposit_paid'); update service_requests r set workflow_status='funded' where r.id=v_op.request_id; else update jobs j set payment_status='paid' where j.request_id=v_op.request_id; end if; update money_operations m set state='completed',completed_at=clock_timestamp() where m.id=v_op.id returning m.* into v_op; return claim_result(v_op); end; $$;
create or replace function operator_settlement_preflight(p_request_id uuid) returns settlement_authorizations language plpgsql security definer set search_path=public as $settlement_preflight$
declare v_result settlement_authorizations; v_job jobs; v_quote bigint; v_changes bigint; v_captured bigint; v_booking booking_fee_snapshots; v_fee bigint; v_tax bigint; v_snapshot_id uuid; v_token uuid:=gen_random_uuid();
begin
 if not is_operator() then raise exception 'operator allowlist required'; end if; select j.* into v_job from jobs j where j.request_id=p_request_id for update;
 if v_job.work_status<>'completed' or v_job.completed_at is null or v_job.settlement_state<>'none' or clock_timestamp()<v_job.completed_at+interval '72 hours' then raise exception 'job not completed, settlement not pristine, or hold active'; end if;
 if exists(select 1 from disputes d where d.request_id=p_request_id and d.status in('open','under_review')) or exists(select 1 from money_operations m where m.request_id=p_request_id and m.kind='refund' and m.state='claimed') then raise exception 'dispute or refund pending'; end if;
 select bfs.* into v_booking from booking_fee_snapshots bfs where bfs.request_id=p_request_id; if v_booking.request_id is null then raise exception 'booking fee snapshot missing'; end if;
 select qs.amount_cents into v_quote from quote_snapshots qs where qs.id=v_job.accepted_quote_snapshot_id; select coalesce(sum(cs.amount_cents),0) into v_changes from change_snapshots cs where cs.request_id=p_request_id; select coalesce(sum(pay.amount_cents),0) into v_captured from payments pay where pay.request_id=p_request_id and pay.kind in('deposit','balance') and pay.status='succeeded'; if v_captured<>v_quote+v_changes then raise exception 'captured balance required'; end if;
 v_fee:=((v_captured*v_booking.fee_rate_bps+5000)/10000);v_tax:=((v_fee*v_booking.tax_rate_bps+5000)/10000);
 insert into fee_snapshots(request_id,basis_cents,fee_cents,fee_rate_bps,version,policy_id,tax_rate_bps,tax_cents,stripe_fee_treatment,refund_treatment,rounding) values(p_request_id,v_captured,v_fee+v_tax,v_booking.fee_rate_bps,v_booking.policy_version,v_booking.policy_id,v_booking.tax_rate_bps,v_tax,v_booking.stripe_fee_treatment,v_booking.refund_treatment,v_booking.rounding) returning id into v_snapshot_id;
 update jobs j set authorization_token=v_token,settlement_state='authorized' where j.request_id=p_request_id;
 insert into settlement_authorizations(request_id,quote_cents,approved_change_cents,deposit_cents,authorized_by,authorization_version,authorization_token,fee_snapshot_id,fee_version,fee_rate_bps,fee_amount_cents,captured_amount_cents) values(p_request_id,v_quote,v_changes,v_job.deposit_cents,auth.uid(),v_job.authorization_version,v_token,v_snapshot_id,v_booking.policy_version,v_booking.fee_rate_bps,v_fee+v_tax,v_captured) returning * into v_result;return v_result;
end;$settlement_preflight$;
create function settlement_claim(p_request_id uuid,p_authorization_token uuid,p_authorization_version bigint,p_fee_version bigint,p_fee_rate_bps integer,p_fee_amount_cents bigint,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path=public as $settlement_claim$
declare v_op money_operations; v_auth settlement_authorizations; v_job jobs; v_destination text; v_fp jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'service role required'; end if;
 v_fp:=jsonb_build_object('authorization_token',p_authorization_token,'authorization_version',p_authorization_version,'fee_version',p_fee_version,'fee_rate_bps',p_fee_rate_bps,'fee_amount_cents',p_fee_amount_cents);
 select m.* into v_op from money_operations m where m.idempotency_key=p_idempotency_key for update;
 if found then if v_op.fingerprint<>v_fp then raise exception 'idempotency key reused'; end if; return claim_result(v_op); end if;
 select j.* into v_job from jobs j where j.request_id=p_request_id for update;
 if v_job.request_id is null or v_job.settlement_state<>'authorized' or v_job.authorization_token is distinct from p_authorization_token or v_job.authorization_version<>p_authorization_version then raise exception 'settlement authorization stale'; end if;
 select sa.* into v_auth from settlement_authorizations sa where sa.request_id=p_request_id and sa.authorization_token=p_authorization_token and sa.authorization_version=p_authorization_version and sa.fee_version=p_fee_version and sa.fee_rate_bps=p_fee_rate_bps and sa.fee_amount_cents=p_fee_amount_cents for update;
 if v_auth.id is null or exists(select 1 from disputes d where d.request_id=p_request_id and d.status in('open','under_review')) or exists(select 1 from money_operations m where m.request_id=p_request_id and m.kind='refund' and m.state='claimed') then raise exception 'settlement authorization stale'; end if;
 select p.stripe_account_id into v_destination from quote_snapshots qs join profiles p on p.id=qs.provider_id where qs.id=v_job.accepted_quote_snapshot_id and p.stripe_charges_enabled and p.stripe_payouts_enabled and p.stripe_details_submitted;
 if v_destination is null then raise exception 'provider account ineligible'; end if;
 update jobs j set settlement_state='transferring',authorization_token=null where j.request_id=p_request_id and j.settlement_state='authorized' and j.authorization_token=p_authorization_token and j.authorization_version=p_authorization_version;
 if not found then raise exception 'settlement authorization already consumed'; end if;
 delete from settlement_authorizations sa where sa.id=v_auth.id;
 insert into money_operations(kind,idempotency_key,fingerprint,request_id,amount_cents,destination_account) values('settlement',p_idempotency_key,v_fp,p_request_id,v_auth.captured_amount_cents-v_auth.fee_amount_cents,v_destination) returning * into v_op;
 return claim_result(v_op);
end; $settlement_claim$;
create function settlement_complete(p_claim_id uuid,p_provider_reference text,p_detail jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_op money_operations; begin select m.* into v_op from money_operations m where m.id=p_claim_id and m.kind='settlement' for update; if v_op.id is null or v_op.state='failed' then raise exception 'claim missing or terminally failed'; end if; if v_op.state='completed' then return claim_result(v_op); end if; insert into payments(request_id,kind,status,amount_cents,provider_reference,idempotency_key) values(v_op.request_id,'transfer','succeeded',v_op.amount_cents,p_provider_reference,v_op.idempotency_key); update jobs j set settlement_state=case when j.settlement_state='reconciliation_required' then j.settlement_state else 'settled' end,work_status=case when j.settlement_state='reconciliation_required' then j.work_status else 'settled' end,settled_at=case when j.settlement_state='reconciliation_required' then null else clock_timestamp() end,authorization_token=null where j.request_id=v_op.request_id; update money_operations m set state='completed',provider_reference=p_provider_reference,completed_at=clock_timestamp() where m.id=v_op.id returning m.* into v_op; return claim_result(v_op); end; $$;
create function refund_complete(p_claim_id uuid,p_provider_reference text,p_detail jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_op money_operations; v_allocation refund_allocations; v_ref jsonb; begin select m.* into v_op from money_operations m where m.id=p_claim_id and m.kind='refund' for update; if v_op.id is null or v_op.state='failed' then raise exception 'claim missing or terminally failed'; end if; if v_op.state='completed' then return claim_result(v_op); end if; for v_allocation in select ra.* from refund_allocations ra where ra.operation_id=v_op.id loop select e.value into v_ref from jsonb_array_elements(p_detail->'refunds') e where e.value->>'paymentId'=v_allocation.payment_id::text; insert into payments(request_id,kind,status,amount_cents,provider_reference,idempotency_key,source_payment_id) values(v_op.request_id,'refund','succeeded',v_allocation.amount_cents,v_ref->>'refundId',v_op.idempotency_key||':'||v_allocation.payment_id,v_allocation.payment_id); end loop; update money_operations m set state='completed',provider_reference=p_provider_reference,completed_at=clock_timestamp() where m.id=v_op.id returning m.* into v_op; return claim_result(v_op); end; $$;
create function stuck_money_claims(p_before_at timestamptz) returns setof jsonb language plpgsql security definer set search_path=public as $stuck_claims$ begin if auth.role()<>'service_role' then raise exception 'service role required';end if;perform append_audit('stuck_money_claims',null,'money_operation','stuck','scheduled reconciliation inspected stuck claims',gen_random_uuid()::text);return query select claim_result(m)||jsonb_build_object('kind',m.kind) from money_operations m where m.state in('claimed','failed') and m.claimed_at<p_before_at order by m.claimed_at for update skip locked;end;$stuck_claims$;
create or replace function refund_claim(p_request_id uuid,p_amount_cents bigint,p_reason text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=public as $refund_claim$ declare v_op money_operations;v_payment payments;v_remaining bigint:=p_amount_cents;v_available bigint;v_assigned bigint;v_fp jsonb:=jsonb_build_object('request_id',p_request_id,'amount_cents',p_amount_cents,'reason',p_reason);begin select m.* into v_op from money_operations m where m.idempotency_key=p_idempotency_key for update;if found then if v_op.fingerprint<>v_fp then raise exception 'idempotency key reused';end if;return claim_result(v_op);end if;if p_amount_cents<=0 then raise exception 'refund limit exceeded';end if;insert into money_operations(kind,idempotency_key,fingerprint,request_id,amount_cents) values('refund',p_idempotency_key,v_fp,p_request_id,p_amount_cents) returning * into v_op;for v_payment in select pay.* from payments pay where pay.request_id=p_request_id and pay.kind in('deposit','balance') and pay.status='succeeded' order by pay.created_at,pay.id for update loop select v_payment.amount_cents-coalesce(sum(r.amount_cents),0)-coalesce((select sum(ra.amount_cents) from refund_allocations ra join money_operations m on m.id=ra.operation_id where ra.payment_id=v_payment.id and m.state='claimed'),0) into v_available from payments r where r.source_payment_id=v_payment.id and r.kind='refund' and r.status='succeeded';v_assigned:=least(v_remaining,v_available);if v_assigned>0 then insert into refund_allocations(operation_id,payment_id,amount_cents) values(v_op.id,v_payment.id,v_assigned);v_remaining:=v_remaining-v_assigned;end if;exit when v_remaining=0;end loop;if v_remaining>0 then raise exception 'refund limit exceeded';end if;return claim_result(v_op);end;$refund_claim$;
create function external_dispute_claim(p_request_id uuid,p_external_id text,p_reason text,p_event_id text,p_event_type text,p_lifecycle text,p_amount_cents bigint,p_payload_sha256 text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=public as $dispute_claim$ declare v_op money_operations;v_transfer payments;v_already bigint;v_reverse_cents bigint:=0;v_fp jsonb;begin insert into stripe_webhook_events(event_id,event_type,object_id,request_id,payload_sha256) values(p_event_id,p_event_type,p_external_id,p_request_id,p_payload_sha256) on conflict do nothing;if not found then select m.* into v_op from money_operations m where m.idempotency_key=p_idempotency_key;return claim_result(v_op);end if;insert into stripe_dispute_objects(external_id,request_id,status) values(p_external_id,p_request_id,p_lifecycle) on conflict(external_id) do update set status=excluded.status,version=stripe_dispute_objects.version+1,updated_at=clock_timestamp();select pay.* into v_transfer from payments pay where pay.request_id=p_request_id and pay.kind='transfer' and pay.status='succeeded' order by pay.created_at desc limit 1;select coalesce(sum(pay.amount_cents),0) into v_already from payments pay where pay.request_id=p_request_id and pay.kind='reversal' and pay.status='succeeded';if p_lifecycle in('under_review','lost') and v_transfer.id is not null then v_reverse_cents:=greatest(0,least(p_amount_cents,v_transfer.amount_cents)-v_already);end if;update jobs j set settlement_state=case when j.settlement_state='transferring' then 'reconciliation_required' else j.settlement_state end where j.request_id=p_request_id;v_fp:=jsonb_build_object('external_id',p_external_id,'reason',p_reason,'event_id',p_event_id,'event_type',p_event_type,'lifecycle',p_lifecycle,'amount_cents',p_amount_cents);insert into money_operations(kind,idempotency_key,fingerprint,request_id,external_object_id,amount_cents,provider_reference) values('external_dispute',p_idempotency_key,v_fp,p_request_id,p_external_id,v_reverse_cents,v_transfer.provider_reference) returning * into v_op;return claim_result(v_op);end;$dispute_claim$;
create function external_dispute_complete(p_claim_id uuid,p_provider_reference text,p_detail jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_op money_operations; v_fp jsonb; v_lifecycle text; begin select m.* into v_op from money_operations m where m.id=p_claim_id and m.kind='external_dispute' for update; if v_op.id is null or v_op.state='failed' then raise exception 'claim missing or terminally failed'; end if; if v_op.state='completed' then return claim_result(v_op); end if; v_fp:=v_op.fingerprint; v_lifecycle:=v_fp->>'lifecycle'; insert into disputes(request_id,source,external_id,reason,status,external_version,updated_at) values(v_op.request_id,'external',v_op.external_object_id,v_fp->>'reason',v_lifecycle,1,clock_timestamp()) on conflict(external_id) do update set reason=excluded.reason,status=excluded.status,external_version=disputes.external_version+1,updated_at=clock_timestamp(); update jobs j set dispute_status=case when v_lifecycle='under_review' then 'open' else 'resolved' end,authorization_version=j.authorization_version+1,authorization_token=null,settlement_state=case when v_op.amount_cents>0 and v_lifecycle<>'won' then case when v_op.amount_cents<(select pay.amount_cents from payments pay where pay.request_id=v_op.request_id and pay.kind='transfer' limit 1) then 'manual_action' else 'reversed' end when v_lifecycle='won' and exists(select 1 from payments pay where pay.request_id=v_op.request_id and pay.kind='reversal') then 'manual_action' when v_lifecycle='won' then 'none' else j.settlement_state end where j.request_id=v_op.request_id; delete from settlement_authorizations sa where sa.request_id=v_op.request_id; if v_op.amount_cents>0 then insert into payments(request_id,kind,status,amount_cents,provider_reference,idempotency_key) values(v_op.request_id,'reversal','succeeded',v_op.amount_cents,p_provider_reference,'reversal:'||v_op.external_object_id||':'||v_lifecycle) on conflict(idempotency_key) do nothing; end if; update money_operations m set state='completed',provider_reference=coalesce(p_provider_reference,m.provider_reference),completed_at=clock_timestamp() where m.id=v_op.id returning m.* into v_op; return claim_result(v_op); end; $$;
create table receivables(id uuid primary key default gen_random_uuid(),request_id uuid not null references jobs(request_id),external_dispute_id text not null,amount_cents bigint not null check(amount_cents>0),status text not null default 'open' check(status in('open','resolved')),reason text not null,created_at timestamptz not null default clock_timestamp());
create table manual_resolution_commands(id uuid primary key default gen_random_uuid(),request_id uuid not null references jobs(request_id),receivable_id uuid references receivables(id),command text not null check(command in('collect_receivable','review_partial_reversal')),state text not null default 'pending' check(state in('pending','completed')),created_at timestamptz not null default clock_timestamp());
alter table refund_allocations enable row level security; alter table refund_allocations force row level security;
alter table stripe_dispute_objects enable row level security; alter table stripe_dispute_objects force row level security;
alter table receivables enable row level security; alter table receivables force row level security;
alter table manual_resolution_commands enable row level security; alter table manual_resolution_commands force row level security;
create function queue_transfer_reconciliation() returns trigger language plpgsql security definer set search_path=public as $$ declare source money_operations; requested bigint; begin if new.kind<>'transfer' or not exists(select 1 from jobs where request_id=new.request_id and settlement_state='reconciliation_required') then return new; end if; select * into source from money_operations where request_id=new.request_id and kind='external_dispute' order by claimed_at desc limit 1; requested:=least(coalesce((source.fingerprint->>'amount_cents')::bigint,new.amount_cents),new.amount_cents); insert into money_operations(kind,idempotency_key,fingerprint,request_id,external_object_id,amount_cents,provider_reference) values('external_dispute','reconcile:'||new.id,source.fingerprint,new.request_id,source.external_object_id,requested,new.provider_reference) on conflict(idempotency_key) do nothing; return new; end; $$;
create trigger payments_queue_transfer_reconciliation after insert on payments for each row execute function queue_transfer_reconciliation();
create function resolve_receivable(p_command_id uuid) returns manual_resolution_commands language plpgsql security definer set search_path=public as $$ declare result manual_resolution_commands; command_id uuid:=p_command_id; begin if not is_operator() then raise exception 'operator required'; end if; update manual_resolution_commands set state='completed' where id=command_id and state='pending' returning * into result; if result.id is null then raise exception 'command unavailable'; end if; update receivables set status='resolved' where id=result.receivable_id; return result; end; $$;
create function queue_won_recovery() returns trigger language plpgsql security definer set search_path=public as $won_recovery$ declare cents bigint; destination text; begin if new.status<>'won' or old.status='won' then return new; end if; select coalesce(sum(amount_cents),0) into cents from payments where request_id=new.request_id and kind='reversal' and status='succeeded'; select p.stripe_account_id into destination from jobs j join quote_snapshots q on q.id=j.accepted_quote_snapshot_id join profiles p on p.id=q.provider_id where j.request_id=new.request_id and p.stripe_charges_enabled and p.stripe_payouts_enabled and p.stripe_details_submitted; update jobs set authorization_version=authorization_version+1,authorization_token=null,settlement_state=case when cents>0 and destination is not null then 'reconciliation_required' else settlement_state end where request_id=new.request_id; if cents>0 and destination is not null then insert into money_operations(kind,idempotency_key,fingerprint,request_id,amount_cents,destination_account) values('recovery','recovery:'||new.external_id||':'||new.external_version,jsonb_build_object('external_id',new.external_id),new.request_id,cents,destination) on conflict(idempotency_key) do nothing; end if; return new; end; $won_recovery$;
create trigger disputes_queue_won_recovery after update on disputes for each row execute function queue_won_recovery();
create function record_partial_reversal_receivable() returns trigger language plpgsql security definer set search_path=public as $$ declare source money_operations; requested bigint; outstanding bigint; rid uuid; begin if new.kind<>'reversal' then return new; end if; select * into source from money_operations where request_id=new.request_id and kind='external_dispute' order by claimed_at desc limit 1; requested:=coalesce((source.fingerprint->>'amount_cents')::bigint,new.amount_cents); outstanding:=greatest(0,requested-(select coalesce(sum(amount_cents),0) from payments where request_id=new.request_id and kind='reversal' and status='succeeded')); if outstanding>0 then insert into receivables(request_id,external_dispute_id,amount_cents,reason) values(new.request_id,source.external_object_id,outstanding,'partial dispute reversal debit') returning id into rid; insert into manual_resolution_commands(request_id,receivable_id,command) values(new.request_id,rid,'collect_receivable'); update jobs set settlement_state='manual_action' where request_id=new.request_id; end if; return new; end; $$;
create trigger reversal_records_receivable after insert on payments for each row execute function record_partial_reversal_receivable();
create function recovery_complete(p_claim_id uuid,p_provider_reference text,p_detail jsonb) returns jsonb language plpgsql security definer set search_path=public as $recovery_complete$ declare v_op money_operations; begin if auth.role()<>'service_role' then raise exception 'service role required'; end if; select m.* into v_op from money_operations m where m.id=p_claim_id and m.kind='recovery' for update; if v_op.id is null then raise exception 'recovery claim missing'; end if; if v_op.id is null or v_op.state='failed' then raise exception 'claim missing or terminally failed'; end if; if v_op.state='completed' then return claim_result(v_op); end if; insert into payments(request_id,kind,status,amount_cents,provider_reference,idempotency_key) values(v_op.request_id,'transfer','succeeded',v_op.amount_cents,p_provider_reference,v_op.provider_idempotency_key); update jobs j set settlement_state='settled',settled_at=coalesce(j.settled_at,clock_timestamp()) where j.request_id=v_op.request_id; update money_operations m set state='completed',provider_reference=p_provider_reference,completed_at=clock_timestamp() where m.id=v_op.id returning m.* into v_op; return claim_result(v_op); end;$recovery_complete$;
create function recovery_fail(p_claim_id uuid,p_failure_reason text) returns void language sql security definer set search_path=public as $recovery_fail$ select money_operation_fail(p_claim_id,p_failure_reason) $recovery_fail$;
create table money_provider_observations(
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references money_operations(id),
  kind text not null,
  provider_reference text not null,
  provider_status text not null,
  provider_event_id text not null default '',
  observed_at timestamptz not null default clock_timestamp(),
  unique(claim_id,provider_status,provider_event_id)
);
alter table money_provider_observations enable row level security;
alter table money_provider_observations force row level security;
create function observe_money_provider_status(p_claim_id uuid,p_kind text,p_provider_reference text,p_provider_status text,p_provider_event_id text) returns void
language plpgsql security definer set search_path=public as $observe_provider_status$
declare v_operation money_operations;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select m.* into v_operation from money_operations m where m.id=p_claim_id and m.kind=p_kind and m.provider_reference=p_provider_reference;
  if v_operation.id is null then raise exception 'persisted obligation required'; end if;
  insert into money_provider_observations(claim_id,kind,provider_reference,provider_status,provider_event_id)
    values(p_claim_id,p_kind,p_provider_reference,p_provider_status,coalesce(p_provider_event_id,''))
    on conflict(claim_id,provider_status,provider_event_id) do nothing;
end;$observe_provider_status$;
alter table privacy_consents enable row level security;alter table privacy_consents force row level security;
alter table deletion_requests enable row level security;alter table deletion_requests force row level security;
alter table request_media enable row level security;alter table request_media force row level security;
alter table request_messages enable row level security;alter table request_messages force row level security;
alter table request_schedules enable row level security;alter table request_schedules force row level security;
alter table reviews enable row level security;alter table reviews force row level security;
create policy privacy_self on privacy_consents for select to authenticated using(profile_id=auth.uid());create policy deletion_self on deletion_requests for select to authenticated using(profile_id=auth.uid());
create policy media_scope on request_media for select to authenticated using(upload_status='uploaded' and sanitization_status='sanitized' and exif_removal_status='removed' and sanitized_object_path is not null and (owner_id=auth.uid() or is_operator() or exists(select 1 from service_requests r where r.id=request_id and r.customer_id=auth.uid()) or can_access_request(request_id)));create policy messages_scope on request_messages for select to authenticated using(can_access_request(request_id));create policy schedules_scope on request_schedules for select to authenticated using(can_access_request(request_id));create policy reviews_scope on reviews for select to authenticated using(can_access_request(request_id));
create function record_privacy_consent(p_version text) returns privacy_consents language plpgsql security definer set search_path=public as $privacy$ declare v privacy_consents;begin if length(trim(p_version))=0 then raise exception 'version required';end if;insert into privacy_consents(profile_id,version) values(auth.uid(),p_version) on conflict(profile_id,version) do update set accepted_at=excluded.accepted_at returning * into v;return v;end;$privacy$;
create function request_privacy_deletion() returns deletion_requests language plpgsql security definer set search_path=public as $deletion$ declare v deletion_requests;begin if not exists(select 1 from privacy_consents pc where pc.profile_id=auth.uid()) then raise exception 'privacy consent required';end if;insert into deletion_requests(profile_id) values(auth.uid()) returning * into v;return v;end;$deletion$;
create function update_request_details(p_request_id uuid,p_work_scope jsonb,p_triage jsonb,p_price_disclosure jsonb) returns service_requests language plpgsql security definer set search_path=public as $details$ declare v service_requests;v_samples integer;begin if p_work_scope is null or p_triage is null or p_price_disclosure is null or not (p_work_scope ?& array['symptom','location','dimensions','access','desiredTime','photos','exclusions']) or not (p_triage ?& array['category','urgency','possibleCauses','confidence','questions','hazards']) or not (p_price_disclosure ?& array['source','sampleCount','updatedAt','confidence']) then raise exception 'structured details required';end if;if coalesce(jsonb_array_length(p_triage->'hazards'),0)>0 or p_triage->>'urgency'='emergency' then raise exception 'hazard triage blocked';end if;v_samples:=coalesce((p_price_disclosure->>'sampleCount')::integer,0);if v_samples<30 then p_price_disclosure:=p_price_disclosure-'priceCents';end if;update service_requests r set work_scope_snapshot=p_work_scope,triage=p_triage,price_disclosure=p_price_disclosure,price_disclosure_accepted=true where r.id=p_request_id and r.customer_id=auth.uid() and r.work_scope_snapshot is null returning * into v;if v.id is null then raise exception 'request forbidden or scope immutable';end if;return v;end;$details$;
create function reserve_intake_media(p_id uuid,p_request_id uuid,p_owner_id uuid,p_file_name text,p_content_type text,p_size_bytes bigint,p_checksum text,p_object_path text) returns request_media language plpgsql set search_path=public as $reserve_media$ declare v request_media;begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v from request_media where request_id=p_request_id and owner_id=p_owner_id and checksum=p_checksum;
  if v.id is not null then return v;end if;
  if not exists(select 1 from service_requests where id=p_request_id and customer_id=p_owner_id) or p_object_path!~('^'||p_owner_id::text||'/'||p_request_id::text||'/intake/'||p_checksum||'\.[a-z0-9]+$') then raise exception 'invalid intake media reservation';end if;
  if (select count(*) from request_media where request_id=p_request_id)>=10 then raise exception 'media limit exceeded';end if;
  insert into request_media(id,request_id,owner_id,file_name,content_type,size_bytes,checksum,object_path)
    values(p_id,p_request_id,p_owner_id,p_file_name,p_content_type,p_size_bytes,p_checksum,p_object_path) returning * into v;
  return v;
end;$reserve_media$;
create function mask_contact_details(p_text text) returns text language sql immutable as $$select regexp_replace(regexp_replace(p_text,'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[email masked]','gi'),'(\+?1[ .-]?)?(\([0-9]{3}\)|[0-9]{3})[ .-]?[0-9]{3}[ .-]?[0-9]{4}','[phone masked]','g')$$;
create function create_request_message(p_request_id uuid,p_text text) returns request_messages language plpgsql security definer set search_path=public as $message$ declare v request_messages;v_masked text:=mask_contact_details(trim(p_text));begin if not can_access_request(p_request_id) or length(v_masked) not between 1 and 2000 then raise exception 'message forbidden';end if;insert into request_messages(request_id,sender_id,body) values(p_request_id,auth.uid(),v_masked) returning * into v;return v;end;$message$;
create function upsert_request_schedule(p_request_id uuid,p_starts_at timestamptz,p_time_zone text,p_status text) returns request_schedules language plpgsql security definer set search_path=public as $schedule$ declare v request_schedules;begin if not can_access_request(p_request_id) or p_status not in('proposed','confirmed') then raise exception 'schedule forbidden';end if;insert into request_schedules(request_id,starts_at,time_zone,status) values(p_request_id,p_starts_at,p_time_zone,p_status) on conflict(request_id) do update set starts_at=excluded.starts_at,time_zone=excluded.time_zone,status=excluded.status,updated_at=clock_timestamp() returning * into v;return v;end;$schedule$;
create function create_provider_review(p_request_id uuid,p_rating integer,p_text text) returns reviews language plpgsql security definer set search_path=public as $review$ declare v reviews;begin insert into reviews(request_id,customer_id,provider_id,rating,body) select p_request_id,auth.uid(),qs.provider_id,p_rating,p_text from jobs j join service_requests r on r.id=j.request_id join quote_snapshots qs on qs.id=j.accepted_quote_snapshot_id where j.request_id=p_request_id and r.customer_id=auth.uid() and j.settlement_state='settled' returning * into v;if v.id is null then raise exception 'settled job required';end if;return v;end;$review$;
create function operator_recovery_list() returns jsonb language plpgsql security definer set search_path=public as $recovery_list$ begin if not is_operator() then raise exception 'operator required';end if;perform append_audit('operator_recovery_list',null,'recovery','open','operator reviewed recovery queue',gen_random_uuid()::text);return jsonb_build_object('claims',(select coalesce(jsonb_agg(claim_result(m)),'[]') from money_operations m where m.state<>'completed'),'receivables',(select coalesce(jsonb_agg(r),'[]') from receivables r where r.status='open'));end;$recovery_list$;
create function operator_resolve_receivable(p_receivable_id uuid) returns receivables language plpgsql security definer set search_path=public as $resolve_receivable$ declare v receivables;begin if not is_operator() then raise exception 'operator required';end if;update receivables r set status='resolved' where r.id=p_receivable_id and r.status='open' returning * into v;if v.id is null then raise exception 'receivable unavailable';end if;return v;end;$resolve_receivable$;
create function operator_update_provider_eligibility(p_provider_id uuid,p_status text,p_organization_name text,p_license_verified boolean,p_license_expires_at timestamptz,p_insurance_verified boolean,p_insurance_expires_at timestamptz,p_service_categories text[],p_service_areas text[]) returns profiles language plpgsql security definer set search_path=public as $provider_admin$ declare v profiles;begin if not is_operator() then raise exception 'operator required';end if;if p_status not in('pending','approved','suspended') or cardinality(p_service_categories)=0 or cardinality(p_service_areas)=0 then raise exception 'invalid provider eligibility';end if;update profiles p set provider_status=p_status,organization_name=p_organization_name,license_verified=p_license_verified,license_expires_at=p_license_expires_at,insurance_verified=p_insurance_verified,insurance_expires_at=p_insurance_expires_at,service_categories=p_service_categories,service_areas=p_service_areas where p.id=p_provider_id and p.role='provider' returning * into v;if v.id is null then raise exception 'provider missing';end if;perform append_audit('operator_update_provider_eligibility',null,'provider',p_provider_id::text,'eligibility status and credentials updated',gen_random_uuid()::text,jsonb_build_object('status',p_status,'license_expires_at',p_license_expires_at,'insurance_expires_at',p_insurance_expires_at));return v;end;$provider_admin$;
revoke all on function create_service_request(text,text,text,text[]),submit_quote(uuid,text,text,bigint,jsonb),submit_job_evidence(uuid,text,text),propose_change_order(uuid,text,bigint,jsonb,uuid[]),approve_change_order(uuid),open_internal_dispute(uuid,text,text),start_assigned_job(uuid),complete_assigned_job(uuid) from public,anon;
grant execute on function create_service_request(text,text,text,text[]),submit_quote(uuid,text,text,bigint,jsonb),submit_job_evidence(uuid,text,text),propose_change_order(uuid,text,bigint,jsonb,uuid[]),approve_change_order(uuid),open_internal_dispute(uuid,text,text),start_assigned_job(uuid),complete_assigned_job(uuid) to authenticated;
revoke all on function operator_match_request(uuid,uuid[]),operator_add_provider_slot(uuid,uuid),operator_resolve_dispute(uuid),operator_settlement_preflight(uuid) from public,anon;
grant execute on function operator_match_request(uuid,uuid[]),operator_add_provider_slot(uuid,uuid),operator_resolve_dispute(uuid),operator_settlement_preflight(uuid) to authenticated;
revoke all on table money_operations from public,anon,authenticated;
revoke all on function deposit_claim(uuid,uuid,text) from public,anon; grant execute on function deposit_claim(uuid,uuid,text) to authenticated;
revoke all on function balance_claim(uuid,text) from public,anon; grant execute on function balance_claim(uuid,text) to authenticated;
revoke all on function customer_payment_complete(uuid,text,jsonb),deposit_complete(uuid,text,jsonb),balance_complete(uuid,text,jsonb),payment_succeeded_claim(uuid,text,text,text,text),payment_succeeded_complete(uuid,text,jsonb),settlement_claim(uuid,uuid,bigint,bigint,integer,bigint,text),settlement_complete(uuid,text,jsonb),refund_claim(uuid,bigint,text,text),refund_complete(uuid,text,jsonb),external_dispute_claim(uuid,text,text,text,text,text,bigint,text,text),external_dispute_complete(uuid,text,jsonb),stuck_money_claims(timestamptz),money_operation_fail(uuid,text),deposit_fail(uuid,text),balance_fail(uuid,text),payment_succeeded_fail(uuid,text),settlement_fail(uuid,text),refund_fail(uuid,text),external_dispute_fail(uuid,text),recovery_complete(uuid,text,jsonb),recovery_fail(uuid,text) from public,anon,authenticated;
grant execute on function customer_payment_complete(uuid,text,jsonb),deposit_complete(uuid,text,jsonb),balance_complete(uuid,text,jsonb),payment_succeeded_claim(uuid,text,text,text,text),payment_succeeded_complete(uuid,text,jsonb),settlement_claim(uuid,uuid,bigint,bigint,integer,bigint,text),settlement_complete(uuid,text,jsonb),refund_claim(uuid,bigint,text,text),refund_complete(uuid,text,jsonb),external_dispute_claim(uuid,text,text,text,text,text,bigint,text,text),external_dispute_complete(uuid,text,jsonb),stuck_money_claims(timestamptz),money_operation_fail(uuid,text),deposit_fail(uuid,text),balance_fail(uuid,text),payment_succeeded_fail(uuid,text),settlement_fail(uuid,text),refund_fail(uuid,text),external_dispute_fail(uuid,text),recovery_complete(uuid,text,jsonb),recovery_fail(uuid,text) to service_role;
revoke all on function observe_money_provider_status(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function observe_money_provider_status(uuid,text,text,text,text) to service_role;
revoke all on function reserve_intake_media(uuid,uuid,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function reserve_intake_media(uuid,uuid,uuid,text,text,bigint,text,text) to service_role;
revoke all on function record_privacy_consent(text),request_privacy_deletion(),update_request_details(uuid,jsonb,jsonb,jsonb),create_request_message(uuid,text),upsert_request_schedule(uuid,timestamptz,text,text),create_provider_review(uuid,integer,text),operator_recovery_list(),operator_resolve_receivable(uuid) from public,anon;
grant execute on function record_privacy_consent(text),request_privacy_deletion(),update_request_details(uuid,jsonb,jsonb,jsonb),create_request_message(uuid,text),upsert_request_schedule(uuid,timestamptz,text,text),create_provider_review(uuid,integer,text),operator_recovery_list(),operator_resolve_receivable(uuid) to authenticated;
revoke all on function mask_contact_details(text) from public,anon;grant execute on function mask_contact_details(text) to authenticated,service_role;
revoke all on function operator_update_provider_eligibility(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text[],text[]) from public,anon;
grant execute on function operator_update_provider_eligibility(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text[],text[]) to authenticated;
revoke all on function append_audit(text,uuid,text,text,text,text,jsonb,uuid),audit_domain_mutation(),claim_result(money_operations),ranking_exploration_selected(uuid,uuid) from public,anon,authenticated;
create trigger audit_profiles_mutation after insert or update or delete on profiles for each row execute function audit_domain_mutation();
create trigger audit_privacy_consents_mutation after insert or update or delete on privacy_consents for each row execute function audit_domain_mutation();
create trigger audit_deletion_requests_mutation after insert or update or delete on deletion_requests for each row execute function audit_domain_mutation();
create trigger audit_service_requests_mutation after insert or update or delete on service_requests for each row execute function audit_domain_mutation();
create trigger audit_request_matches_mutation after insert or update or delete on request_matches for each row execute function audit_domain_mutation();
create trigger audit_quotes_mutation after insert or update or delete on quotes for each row execute function audit_domain_mutation();
create trigger audit_jobs_mutation after insert or update or delete on jobs for each row execute function audit_domain_mutation();
create trigger audit_change_orders_mutation after insert or update or delete on change_orders for each row execute function audit_domain_mutation();
create trigger audit_payments_mutation after insert or update or delete on payments for each row execute function audit_domain_mutation();
create trigger audit_disputes_mutation after insert or update or delete on disputes for each row execute function audit_domain_mutation();
create trigger audit_evidence_mutation after insert or update or delete on evidence for each row execute function audit_domain_mutation();
create trigger audit_settlement_authorizations_mutation after insert or update or delete on settlement_authorizations for each row execute function audit_domain_mutation();
create trigger audit_payment_attempts_mutation after insert or update or delete on payment_attempts for each row execute function audit_domain_mutation();
create trigger audit_money_operations_mutation after insert or update or delete on money_operations for each row execute function audit_domain_mutation();
create trigger audit_refund_allocations_mutation after insert or update or delete on refund_allocations for each row execute function audit_domain_mutation();
create trigger audit_stripe_dispute_objects_mutation after insert or update or delete on stripe_dispute_objects for each row execute function audit_domain_mutation();
create trigger audit_receivables_mutation after insert or update or delete on receivables for each row execute function audit_domain_mutation();
create trigger audit_manual_resolution_commands_mutation after insert or update or delete on manual_resolution_commands for each row execute function audit_domain_mutation();
create trigger audit_request_media_mutation after insert or update or delete on request_media for each row execute function audit_domain_mutation();
create trigger audit_request_messages_mutation after insert or update or delete on request_messages for each row execute function audit_domain_mutation();
create trigger audit_request_schedules_mutation after insert or update or delete on request_schedules for each row execute function audit_domain_mutation();
create trigger audit_reviews_mutation after insert or update or delete on reviews for each row execute function audit_domain_mutation();

grant usage on schema public to authenticated,service_role;
grant select on all tables in schema public to authenticated;
grant insert on table evidence to authenticated;
grant all privileges on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

commit;
