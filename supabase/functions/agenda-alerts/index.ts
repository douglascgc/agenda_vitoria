import webpush from 'npm:web-push@3.6.7';
import './modelo.js';

const base = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const model = (globalThis as any).AgendaModel;

async function database(path: string, method: string, body?: unknown) {
  const response = await fetch(base + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: key, Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Operação no banco falhou: ' + response.status);
  return response.status === 204 ? null : await response.json();
}

function validEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com'].includes(url.hostname) ||
        url.hostname.endsWith('.notify.windows.com'));
  } catch {
    return false;
  }
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const token = request.headers.get('X-Agenda-Token') ?? '';
  if (!/^[a-f0-9-]{36}$/i.test(token)) return new Response(null, { status: 401 });
  try {
    let [config] = await database('rpc/agenda_push_claim', 'POST', { in_nonce: token });
    if (!config) return new Response(null, { status: 401 });
    if (!config.public_key) {
      const keys = webpush.generateVAPIDKeys();
      await database('rpc/agenda_push_set_keys', 'POST', {
        in_public: keys.publicKey, in_private: keys.privateKey
      });
      config = { public_key: keys.publicKey, private_key: keys.privateKey };
    }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const devices = await database('rpc/agenda_push_queue', 'POST', { in_day: today });
    let sent = 0;
    let failed = 0;
    for (const { endpoint, keys, payload } of devices) {
      if (!validEndpoint(endpoint)) continue;
      const address = 'agenda_push_devices?endpoint=eq.' + encodeURIComponent(endpoint);
      try {
        const pending = model.reminders(payload, model.charges(payload), today);
        if (!pending.length) continue;
        const claimed = await database(address + '&or=(notified_on.is.null,notified_on.neq.' + today + ')', 'PATCH', { notified_on: today });
        if (!claimed.length) continue;
        try {
          await webpush.sendNotification({ endpoint, keys }, JSON.stringify({ count: pending.length }), {
            TTL: 43200,
            timeout: 8000,
            vapidDetails: { subject: 'https://github.com/douglascgc/agenda_vitoria', publicKey: config.public_key, privateKey: config.private_key }
          });
          sent++;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await database(address, 'DELETE');
          else {
            await database(address + '&notified_on=eq.' + today, 'PATCH', { notified_on: null });
            failed++;
          }
        }
      } catch {
        failed++;
      }
    }
    return Response.json({ sent, failed });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Falha no processamento de alertas');
    return Response.json({ error: 'Falha no processamento de alertas' }, { status: 500 });
  }
});
