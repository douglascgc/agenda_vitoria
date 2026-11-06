alter table agenda_private.push_config
  add column request_nonce uuid,
  add column request_expires timestamptz;

create function public.agenda_push_claim(in_nonce uuid)
returns table(public_key text, private_key text)
language sql security invoker set search_path = '' as $$
  update agenda_private.push_config c
  set request_nonce = null, request_expires = null
  where c.request_nonce = in_nonce and c.request_expires > statement_timestamp()
  returning c.public_key, c.private_key;
$$;
revoke execute on function public.agenda_push_claim(uuid) from public, anon, authenticated;
grant execute on function public.agenda_push_claim(uuid) to service_role;

create function public.agenda_push_set_keys(in_public text, in_private text)
returns void language sql security invoker set search_path = '' as $$
  update agenda_private.push_config set public_key = in_public, private_key = in_private where public_key is null;
$$;
revoke execute on function public.agenda_push_set_keys(text,text) from public, anon, authenticated;
grant execute on function public.agenda_push_set_keys(text,text) to service_role;

select cron.schedule('agenda-vitoria-alerts', '0,15,30,45 11 * * *', $job$
  with ticket as (
    update agenda_private.push_config
    set request_nonce = gen_random_uuid(), request_expires = now() + interval '2 minutes'
    returning request_nonce
  )
  select net.http_post(
    url := 'https://xuuxfguvgkcpxidxrqjw.supabase.co/functions/v1/agenda-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Agenda-Token', request_nonce),
    body := '{}'::jsonb
  ) from ticket;
$job$);
