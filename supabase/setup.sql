create table public.agenda_access (
  email text primary key check (email = lower(email))
);
alter table public.agenda_access enable row level security;
revoke all on public.agenda_access from anon, authenticated;
grant select on public.agenda_access to authenticated;
create policy agenda_access_self on public.agenda_access for select to authenticated
using (email = lower((select auth.jwt()->>'email')));

create table public.agenda_state (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 5000000)
);
alter table public.agenda_state enable row level security;
revoke all on public.agenda_state from anon, authenticated;
grant select, insert, update on public.agenda_state to authenticated;
create policy agenda_state_self on public.agenda_state for all to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.agenda_access))
with check (user_id = (select auth.uid()) and exists (select 1 from public.agenda_access));

create table public.agenda_backup (
  user_id uuid not null references auth.users(id) on delete cascade,
  backup_day date not null,
  revision integer not null,
  payload jsonb not null,
  primary key (user_id, backup_day)
);
alter table public.agenda_backup enable row level security;
revoke all on public.agenda_backup from anon, authenticated;
grant select on public.agenda_backup to authenticated;
create policy agenda_backup_self on public.agenda_backup for select to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.agenda_access));

create extension if not exists pg_cron;
select cron.schedule('agenda-vitoria-backup', '0 6 * * *', $job$
  insert into public.agenda_backup (user_id, backup_day, revision, payload)
  select user_id, (now() at time zone 'America/Sao_Paulo')::date, revision, payload
  from public.agenda_state on conflict do nothing;
  delete from public.agenda_backup
  where backup_day <= (now() at time zone 'America/Sao_Paulo')::date - 30;
$job$);
