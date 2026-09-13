-- service_role 권한 부여: service_zips/safety_reports 쓰기, evidence_media 읽기.
begin;
grant select,insert,update on public.service_zips,public.safety_reports to service_role;
grant select on public.evidence_media to service_role;
commit;
