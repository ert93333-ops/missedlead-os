-- 공급자 완성: provider_applications, 검증 필드, 지원서 저장/검토 RPC.
begin;
create table public.provider_applications (
 provider_id uuid primary key references public.profiles(id), organization_name text not null, contact_name text not null,
 contact_email text not null, contact_phone text not null, categories text[] not null, zip_codes text[] not null,
 languages text[] not null, availability text not null, diagnostic_fee_cents bigint not null check(diagnostic_fee_cents between 0 and 3999999),
 license_number text not null, license_expires_at timestamptz not null, insurance_expires_at timestamptz not null,
 workers_comp_required boolean not null, status text not null default 'pending' check(status in('pending','approved','rejected')),
 review_reason text, verification_reference text, verified_at timestamptz, reviewed_by uuid references public.profiles(id),
 updated_at timestamptz not null default now(), check(cardinality(categories)>0 and cardinality(zip_codes)>0 and cardinality(languages)>0)
);
create table public.provider_documents (
 id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.provider_applications(provider_id),
 kind text not null check(kind in('license','coi','workers_comp','w9')), file_name text not null, object_path text not null unique,
 created_at timestamptz not null default now()
);
create table public.quote_details (
 quote_id uuid primary key references public.quotes(id), request_id uuid not null references public.service_requests(id), bundle_id uuid,
 diagnostic_cents bigint not null check(diagnostic_cents>=0), labor_cents bigint not null check(labor_cents>=0),
 materials_cents bigint not null check(materials_cents>=0), tax_cents bigint not null check(tax_cents>=0),
 valid_until timestamptz not null, site_visit_required boolean not null, permit_required boolean not null,
 permit_number text, inspection_status text not null check(inspection_status in('not_required','pending','passed'))
);
alter table provider_applications enable row level security;
alter table provider_applications force row level security;
alter table provider_documents enable row level security;
alter table provider_documents force row level security;
alter table quote_details enable row level security;
alter table quote_details force row level security;
create policy application_read on provider_applications for select to authenticated using(provider_id=auth.uid() or is_operator());
create policy provider_document_read on provider_documents for select to authenticated using(provider_id=auth.uid() or is_operator());
create policy quote_detail_read on quote_details for select to authenticated using(can_access_request(request_id));
grant select on provider_applications,provider_documents,quote_details to authenticated;
grant all on provider_applications,provider_documents,quote_details to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('provider-documents-private','provider-documents-private',false,10000000,array['application/pdf','image/jpeg','image/png']);

create function save_provider_application(p_data jsonb) returns provider_applications
language plpgsql security definer set search_path=public as $$
declare v provider_applications;
begin
 if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and role in('customer','provider')) then raise exception 'provider_application_forbidden'; end if;
 if (p_data->>'licenseExpiresAt')::timestamptz<=now() or (p_data->>'insuranceExpiresAt')::timestamptz<=now() then raise exception 'credentials_expired'; end if;
 insert into provider_applications(provider_id,organization_name,contact_name,contact_email,contact_phone,categories,zip_codes,languages,availability,diagnostic_fee_cents,license_number,license_expires_at,insurance_expires_at,workers_comp_required)
 values(auth.uid(),p_data->>'organizationName',p_data->>'contactName',p_data->>'contactEmail',p_data->>'contactPhone',array(select jsonb_array_elements_text(p_data->'categories')),array(select jsonb_array_elements_text(p_data->'zipCodes')),array(select jsonb_array_elements_text(p_data->'languages')),p_data->>'availability',(p_data->>'diagnosticFeeCents')::bigint,p_data->>'licenseNumber',(p_data->>'licenseExpiresAt')::timestamptz,(p_data->>'insuranceExpiresAt')::timestamptz,(p_data->>'workersCompRequired')::boolean)
 on conflict(provider_id) do update set organization_name=excluded.organization_name,contact_name=excluded.contact_name,contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,categories=excluded.categories,zip_codes=excluded.zip_codes,languages=excluded.languages,availability=excluded.availability,diagnostic_fee_cents=excluded.diagnostic_fee_cents,license_number=excluded.license_number,license_expires_at=excluded.license_expires_at,insurance_expires_at=excluded.insurance_expires_at,workers_comp_required=excluded.workers_comp_required,status='pending',review_reason=null,verification_reference=null,verified_at=null,reviewed_by=null,updated_at=now() returning * into v;
 update profiles set provider_status='pending',license_verified=false,insurance_verified=false where id=auth.uid() and role='provider';
 return v;
end $$;

create function review_provider_application(p_provider_id uuid,p_decision text,p_reason text,p_reference text) returns provider_applications
language plpgsql security definer set search_path=public as $$
declare v provider_applications; required_kind text;
begin
 if not is_operator() then raise exception 'operator_required' using errcode='42501'; end if;
 select * into v from provider_applications where provider_id=p_provider_id for update;
 if v.provider_id is null or v.status<>'pending' then raise exception 'pending_application_required'; end if;
 if p_decision not in('approved','rejected') or length(trim(p_reason))<3 or length(trim(p_reference))<3 then raise exception 'verification_reference_required'; end if;
 if p_decision='approved' then
  if v.license_expires_at<=now() or v.insurance_expires_at<=now() then raise exception 'credentials_expired'; end if;
  foreach required_kind in array (case when v.workers_comp_required then array['license','coi','w9','workers_comp'] else array['license','coi','w9'] end) loop
   if not exists(select 1 from provider_documents d join storage.objects o on o.bucket_id='provider-documents-private' and o.name=d.object_path where d.provider_id=p_provider_id and d.kind=required_kind) then raise exception 'required_document_missing'; end if;
  end loop;
  update profiles set role='provider',provider_status='approved',organization_name=v.organization_name,license_verified=true,license_expires_at=v.license_expires_at,insurance_verified=true,insurance_expires_at=v.insurance_expires_at,service_categories=v.categories,service_areas=array['Charlotte'] where id=p_provider_id and role in('customer','provider');
 else
  update profiles set provider_status='pending',license_verified=false,insurance_verified=false where id=p_provider_id and role='provider';
 end if;
 update provider_applications set status=p_decision,review_reason=p_reason,verification_reference=p_reference,verified_at=now(),reviewed_by=auth.uid(),updated_at=now() where provider_id=p_provider_id returning * into v;
 perform append_audit('review_provider_application',null,'provider',p_provider_id::text,p_reason,gen_random_uuid()::text,jsonb_build_object('decision',p_decision,'verificationReference',p_reference));
 return v;
end $$;

create function respond_provider_match(p_request_id uuid,p_decision text) returns request_matches
language plpgsql security definer set search_path=public as $$
declare v request_matches;
begin
 if p_decision not in('accept','decline') or not provider_is_eligible(auth.uid(),p_request_id) then raise exception 'provider_response_forbidden'; end if;
 update request_matches set status=case when p_decision='accept' then 'viewed' else 'declined' end where request_id=p_request_id and provider_id=auth.uid() and status in('invited','viewed') returning * into v;
 if v.request_id is null then raise exception 'invitation_unavailable'; end if;
 return v;
end $$;

create function submit_itemized_quote(p_request_id uuid,p_data jsonb) returns quotes
language plpgsql security definer set search_path=public as $$
declare v quotes; total bigint; provider_name text;
begin
 total:=(p_data->>'diagnosticCents')::bigint+(p_data->>'laborCents')::bigint+(p_data->>'materialsCents')::bigint+(p_data->>'taxCents')::bigint;
 if total is null or total<>(p_data->>'totalCents')::bigint or total not between 1 and 3999999 then raise exception 'quote_total_invalid'; end if;
 if (p_data->>'validUntil')::timestamptz<=now() or (p_data->>'earliestStartAt')::timestamptz<=now() then raise exception 'quote_expired'; end if;
 select coalesce(organization_name,display_name) into provider_name from profiles where id=auth.uid();
 v:=submit_quote(p_request_id,provider_name,p_data->>'scope',total,jsonb_build_object('totalCents',total,'earliestStartAt',p_data->>'earliestStartAt','warrantyDays',p_data->'warrantyDays','languages',coalesce((select to_jsonb(languages) from provider_applications where provider_id=auth.uid()),'[]'::jsonb)));
 insert into quote_details(quote_id,request_id,bundle_id,diagnostic_cents,labor_cents,materials_cents,tax_cents,valid_until,site_visit_required,permit_required,permit_number,inspection_status)
 values(v.id,p_request_id,(p_data->>'bundleId')::uuid,(p_data->>'diagnosticCents')::bigint,(p_data->>'laborCents')::bigint,(p_data->>'materialsCents')::bigint,(p_data->>'taxCents')::bigint,(p_data->>'validUntil')::timestamptz,(p_data->>'siteVisitRequired')::boolean,(p_data->>'permitRequired')::boolean,p_data->>'permitNumber',p_data->>'inspectionStatus');
 return v;
end $$;
create function guard_quote_expiry() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='accepted' and old.status<>'accepted' and exists(select 1 from quote_details where quote_id=new.id and valid_until<=now()) then raise exception 'quote_expired'; end if;
 return new;
end $$;
create trigger quote_expiry_guard before update of status on quotes for each row execute function guard_quote_expiry();
create trigger quote_details_immutable before update or delete on quote_details for each row execute function reject_immutable_mutation();
revoke insert on quotes from authenticated;
revoke execute on function submit_quote(uuid,text,text,bigint,jsonb) from authenticated;
create or replace function operator_update_provider_eligibility(p_provider_id uuid,p_status text,p_organization_name text,p_license_verified boolean,p_license_expires_at timestamptz,p_insurance_verified boolean,p_insurance_expires_at timestamptz,p_service_categories text[],p_service_areas text[]) returns profiles
language plpgsql security definer set search_path=public as $$
declare v profiles;
begin
 if not is_operator() then raise exception 'operator_required'; end if;
 if p_status not in('pending','suspended') then raise exception 'document_review_required'; end if;
 update profiles set provider_status=p_status,license_verified=false,insurance_verified=false where id=p_provider_id and role='provider' returning * into v;
 if v.id is null then raise exception 'provider_missing'; end if;
 return v;
end $$;
revoke all on function save_provider_application(jsonb),review_provider_application(uuid,text,text,text),respond_provider_match(uuid,text),submit_itemized_quote(uuid,jsonb),guard_quote_expiry() from public,anon;
grant execute on function save_provider_application(jsonb),review_provider_application(uuid,text,text,text),respond_provider_match(uuid,text),submit_itemized_quote(uuid,jsonb) to authenticated;
commit;
