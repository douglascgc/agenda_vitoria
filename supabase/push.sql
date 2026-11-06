create schema if not exists agenda_private;
revoke all on schema agenda_private from public;
grant usage on schema agenda_private to service_role;

create table agenda_private.push_config (
  singleton boolean primary key default true check (singleton),
  cron_token uuid not null default gen_random_uuid(),
  public_key text,
  private_key text
);
insert into agenda_private.push_config default values;
grant select, update on agenda_private.push_config to service_role;

create table public.agenda_push_devices (
  endpoint text primary key check (length(endpoint) between 1 and 2048),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  keys jsonb not null check (jsonb_typeof(keys) = 'object' and octet_length(keys::text) < 1024),
  notified_on date
);
create index agenda_push_devices_user on public.agenda_push_devices(user_id);
alter table public.agenda_push_devices enable row level security;
revoke all on public.agenda_push_devices from anon, authenticated;
grant select (endpoint, user_id, keys), insert (endpoint, user_id, keys), delete
on public.agenda_push_devices to authenticated;
grant select, update, delete on public.agenda_push_devices to service_role;
create policy agenda_push_devices_self on public.agenda_push_devices for all to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.agenda_access))
with check (user_id = (select auth.uid()) and exists (select 1 from public.agenda_access));

create function public.agenda_push_settings(in_token uuid)
returns table(public_key text, private_key text)
language sql security invoker set search_path = '' as $$
  select c.public_key, c.private_key from agenda_private.push_config c where c.cron_token = in_token;
$$;
revoke execute on function public.agenda_push_settings(uuid) from public, anon, authenticated;
grant execute on function public.agenda_push_settings(uuid) to service_role;

create function public.agenda_push_initialize(in_token uuid, in_public text, in_private text)
returns void language sql security invoker set search_path = '' as $$
  update agenda_private.push_config
  set public_key = in_public, private_key = in_private
  where cron_token = in_token and public_key is null;
$$;
revoke execute on function public.agenda_push_initialize(uuid,text,text) from public, anon, authenticated;
grant execute on function public.agenda_push_initialize(uuid,text,text) to service_role;

create function agenda_private.push_public_key()
returns text language sql security definer set search_path = '' as $$
  select c.public_key from agenda_private.push_config c
  where exists (select 1 from public.agenda_access a where a.email = lower((select auth.jwt()->>'email')));
$$;
revoke execute on function agenda_private.push_public_key() from public, anon;
grant usage on schema agenda_private to authenticated;
grant execute on function agenda_private.push_public_key() to authenticated;

create function public.agenda_push_public_key()
returns text language sql security invoker set search_path = '' as $$
  select agenda_private.push_public_key();
$$;
revoke execute on function public.agenda_push_public_key() from public, anon;
grant execute on function public.agenda_push_public_key() to authenticated;

create function agenda_private.push_queue(in_day date)
returns table(endpoint text, keys jsonb, payload jsonb)
language sql security definer set search_path = '' as $$
  select d.endpoint, d.keys, s.payload
  from public.agenda_push_devices d
  join public.agenda_state s using (user_id)
  join auth.users u on u.id = d.user_id
  join public.agenda_access a on a.email = lower(u.email)
  where d.notified_on is distinct from in_day and u.email_confirmed_at is not null;
$$;
revoke execute on function agenda_private.push_queue(date) from public, anon, authenticated;
grant execute on function agenda_private.push_queue(date) to service_role;

create function public.agenda_push_queue(in_day date)
returns table(endpoint text, keys jsonb, payload jsonb)
language sql security invoker set search_path = '' as $$
  select * from agenda_private.push_queue(in_day);
$$;
revoke execute on function public.agenda_push_queue(date) from public, anon, authenticated;
grant select on public.agenda_state, public.agenda_access to service_role;
grant execute on function public.agenda_push_queue(date) to service_role;

create extension if not exists pg_net;
select cron.schedule('agenda-vitoria-alerts', '0,15,30,45 11 * * *', $job$
  select net.http_post(
    url := 'https://xuuxfguvgkcpxidxrqjw.supabase.co/functions/v1/agenda-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Agenda-Token',
      (select cron_token from agenda_private.push_config)),
    body := '{}'::jsonb
  );
$job$);
