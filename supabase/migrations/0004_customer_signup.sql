-- 신규 가입자 profiles 자동 생성 트리거(handle_new_customer_profile).
begin;

create function public.handle_new_customer_profile()
returns trigger
language plpgsql
security definer
set search_path=''
as $new_customer$
begin
  insert into public.profiles(id,role,display_name)
  values(
    new.id,
    'customer',
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'),''),
      nullif(trim(new.raw_user_meta_data->>'full_name'),''),
      nullif(split_part(coalesce(new.email,''),'@',1),''),
      'Customer'
    )
  )
  on conflict(id) do nothing;
  return new;
end;
$new_customer$;

revoke all on function public.handle_new_customer_profile() from public,anon,authenticated;

create trigger auth_user_created_customer_profile
after insert on auth.users
for each row execute function public.handle_new_customer_profile();

insert into public.profiles(id,role,display_name)
select
  u.id,
  'customer',
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'),''),
    nullif(trim(u.raw_user_meta_data->>'full_name'),''),
    nullif(split_part(coalesce(u.email,''),'@',1),''),
    'Customer'
  )
from auth.users u
where not exists(select 1 from public.profiles p where p.id=u.id)
on conflict(id) do nothing;

commit;
