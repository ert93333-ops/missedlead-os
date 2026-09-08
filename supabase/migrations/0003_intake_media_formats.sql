do $migration$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.request_media'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%content_type%'
  loop
    execute format('alter table public.request_media drop constraint %I', constraint_name);
  end loop;
end
$migration$;

alter table public.request_media
  add constraint request_media_content_type_supported
  check (content_type in (
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/wav', 'audio/x-wav'
  ));

update storage.buckets
set file_size_limit = 25000000,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/wav', 'audio/x-wav'
    ]
where id = 'request-media-private';
