'use strict';

const GoogleAgenda = (() => {
  const scope = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';
  const zone = 'America/Sao_Paulo';
  let loading;

  function prepare() {
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = () => {
        loading = undefined;
        script.remove();
        reject(new Error('Não foi possível carregar a conexão com o Google.'));
      };
      document.head.append(script);
    });
    return loading;
  }

  function authorize(clientId) {
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error('A autorização do Google foi interrompida. Tente novamente.'));
      const auth = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope, include_granted_scopes: false,
        callback: result => result.access_token && google.accounts.oauth2.hasGrantedAllScopes(result, scope)
          ? resolve(result.access_token) : fail(),
        error_callback: fail
      });
      auth.requestAccessToken({ prompt: 'select_account' });
    });
  }

  const localFormat = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });

  async function events(token, start, end) {
    const upper = new Date(Date.parse(end + 'T00:00:00Z') + 86400000);
    const params = new URLSearchParams({
      timeMin: start + 'T00:00:00Z', timeMax: upper.toISOString(),
      timeZone: zone, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      eventTypes: 'default', fields: 'nextPageToken,items(id,iCalUID,summary,start(dateTime),end(dateTime),status)'
    });
    const results = new Map();
    do {
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + params, {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store'
      });
      if (!response.ok) throw new Error('Não foi possível ler o calendário principal. Confira a permissão e tente novamente.');
      const page = await response.json();
      for (const event of page.items ?? []) {
        if (!event.start?.dateTime || !event.end?.dateTime || event.status === 'cancelled') continue;
        const from = new Date(event.start.dateTime);
        const to = new Date(event.end.dateTime);
        const duration = Math.round((to - from) / 60000);
        if (!Number.isFinite(duration) || duration <= 0) continue;
        const at = localFormat.format(from).replace(' ', 'T');
        if (at.slice(0, 10) < start || at.slice(0, 10) >= end) continue;
        const ref = (event.iCalUID ?? '') + '/' + event.id;
        results.set(ref, { ref, title: event.summary || 'Evento sem título', at, duration });
      }
      if (!page.nextPageToken) return [...results.values()];
      params.set('pageToken', page.nextPageToken);
    } while (true);
  }

  return { prepare, authorize, events };
})();
