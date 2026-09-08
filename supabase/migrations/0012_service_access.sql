begin;
grant select,insert,update on public.service_zips,public.safety_reports to service_role;
grant select on public.evidence_media to service_role;
commit;
