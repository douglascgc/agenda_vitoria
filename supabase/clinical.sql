create table public.agenda_clinical (
  owner_id uuid not null default auth.uid(),
  id uuid not null,
  patient_id text not null check (length(patient_id) between 1 and 100),
  patient_name text not null check (length(btrim(patient_name)) between 1 and 150),
  kind text not null check (kind in ('profile','session','amendment')),
  session_id text,
  session_at timestamp,
  parent_id uuid,
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 50000),
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id,id),
  foreign key (owner_id,parent_id) references public.agenda_clinical(owner_id,id),
  check (
    (kind = 'profile' and session_id is null and session_at is null and parent_id is null) or
    (kind = 'session' and session_id is not null and session_at is not null and parent_id is null
      and coalesce(length(btrim(content->>'evolution')),0) > 0
      and coalesce(length(btrim(content->>'procedures')),0) > 0) or
    (kind = 'amendment' and session_id is null and session_at is null and parent_id is not null
      and coalesce(length(btrim(content->>'amendment')),0) > 0)
  )
);

create unique index agenda_clinical_session on public.agenda_clinical(owner_id,session_id) where kind = 'session';
create index agenda_clinical_history on public.agenda_clinical(owner_id,patient_id,created_at desc);
create index agenda_clinical_parent on public.agenda_clinical(owner_id,parent_id) where parent_id is not null;
alter table public.agenda_clinical enable row level security;
revoke all on public.agenda_clinical from public, anon, authenticated, service_role;
grant select on public.agenda_clinical to authenticated;
grant insert (id,patient_id,patient_name,kind,session_id,session_at,parent_id,content) on public.agenda_clinical to authenticated;
create policy agenda_clinical_read on public.agenda_clinical for select to authenticated
using (owner_id = (select auth.uid()) and exists (select 1 from public.agenda_access));
create policy agenda_clinical_insert on public.agenda_clinical for insert to authenticated
with check (owner_id = (select auth.uid()) and exists (select 1 from public.agenda_access));

create function public.agenda_save_clinical_session(in_revision integer, in_payload jsonb, in_record jsonb)
returns table(revision integer, payload jsonb)
language plpgsql security invoker set search_path = '' as $$
declare
  current_payload jsonb;
  clinical_session jsonb;
  session_key text := in_record->>'session_id';
begin
  select s.payload into current_payload from public.agenda_state s
    where s.user_id = (select auth.uid()) and s.revision = in_revision for update;
  if not found then return; end if;

  select item into clinical_session from jsonb_array_elements(in_payload->'sessions') item
    where item->>'id' = session_key and item->>'status' = 'realizada'
      and item->>'patientId' = in_record->>'patient_id' and item->>'clinicalPending' = 'false';
  if clinical_session is null or not exists (
    select from jsonb_array_elements(current_payload->'sessions') item
    where item->>'id' = session_key and item->>'patientId' = in_record->>'patient_id'
      and item->>'at' = clinical_session->>'at'
  ) then
    raise exception 'Atendimento inválido para registro clínico';
  end if;

  insert into public.agenda_clinical (id, patient_id, patient_name, kind, session_id, session_at, content)
    values ((in_record->>'id')::uuid, in_record->>'patient_id', in_record->>'patient_name',
      'session', session_key, (clinical_session->>'at')::timestamp, in_record->'content');

  return query update public.agenda_state s set revision = s.revision + 1, payload = in_payload
    where s.user_id = (select auth.uid()) returning s.revision,s.payload;
end;
$$;
revoke execute on function public.agenda_save_clinical_session(integer,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.agenda_save_clinical_session(integer,jsonb,jsonb) to authenticated;
