'use strict';

const AgendaCloud = (() => {
  const base = 'https://xuuxfguvgkcpxidxrqjw.supabase.co';
  const publicKey = 'sb_publishable_1gug-1lqevpmZ9awQFHp6g_EI4-BxT4';
  const sessionKey = 'agenda-vitoria-session';
  let session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
  let refreshRequest;

  function setSession(value) {
    session = value;
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  }

  async function request(path, { method = 'GET', token, body, prefer } = {}) {
    const response = await fetch(base + path, {
      method, cache: 'no-store',
      headers: {
        apikey: publicKey,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const error = new Error('Não foi possível concluir a solicitação ao servidor.');
      error.status = response.status;
      throw error;
    }
    const content = await response.text();
    return content ? JSON.parse(content) : null;
  }

  async function token() {
    if (!session) throw new Error('Entre novamente para continuar.');
    if (session.expires_at > Date.now() / 1000 + 60) return session.access_token;
    const previous = session;
    refreshRequest ??= request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: previous.refresh_token }
    }).then(value => {
      if (session !== previous) throw new Error('A sessão foi encerrada.');
      setSession(value);
      return value.access_token;
    }).catch(error => {
      if (session === previous && [400, 401, 403].includes(error.status)) setSession(null);
      throw error;
    }).finally(() => { refreshRequest = null; });
    return refreshRequest;
  }

  async function dataRequest(path, options = {}) {
    return request('/rest/v1/' + path, { ...options, token: await token() });
  }

  async function load() {
    const allowed = await dataRequest('agenda_access?select=email&limit=1');
    if (!allowed.length) {
      setSession(null);
      throw new Error('Esta conta ainda não tem acesso à Agenda Vitória.');
    }
    const [row] = await dataRequest('agenda_state?select=payload,revision&limit=1');
    return row ?? { payload: null, revision: 0 };
  }

  async function save(payload, revision) {
    const query = revision ? 'agenda_state?revision=eq.' + revision : 'agenda_state';
    let rows;
    try {
      rows = await dataRequest(query, {
        method: revision ? 'PATCH' : 'POST',
        body: { revision: revision + 1, payload },
        prefer: 'return=representation'
      });
    } catch (error) {
      if (error.status !== 409) throw error;
    }
    return savedRow(rows);
  }

  function savedRow(rows) {
    if (!rows?.length) {
      const error = new Error('Outro dispositivo salvou antes. Os dados foram atualizados. Abra a ação novamente.');
      error.conflict = true;
      throw error;
    }
    return rows[0];
  }

  async function saveClinicalSession(payload, revision, record) {
    return savedRow(await dataRequest('rpc/agenda_save_clinical_session', {
      method: 'POST', body: { in_revision: revision, in_payload: payload, in_record: record }
    }));
  }

  async function clinicalRows(fields, patientId) {
    const query = new URLSearchParams({ select: fields, order: 'created_at.desc,id.desc', limit: '250' });
    if (patientId) query.set('patient_id', 'eq.' + patientId);
    const rows = [];
    while (true) {
      query.set('offset', String(rows.length));
      const batch = await dataRequest('agenda_clinical?' + query);
      rows.push(...batch);
      if (batch.length < 250) return rows;
    }
  }

  const clinicalIndex = () => clinicalRows('patient_id,patient_name,session_id');
  const clinicalHistory = patientId => clinicalRows('id,patient_id,patient_name,kind,session_id,session_at,parent_id,content,created_at', patientId);
  const appendClinical = record => dataRequest('agenda_clinical', { method: 'POST', body: record });

  async function signIn(email, password) {
    try {
      setSession(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }));
    } catch (error) {
      if ([400, 401, 403].includes(error.status)) throw new Error('Confira o e-mail e a senha.');
      throw error;
    }
    return load();
  }

  async function signOut() {
    const access = session?.access_token;
    setSession(null);
    if (access) await request('/auth/v1/logout?scope=local', { method: 'POST', token: access });
  }

  const backups = () => dataRequest('agenda_backup?select=backup_day,revision&order=backup_day.desc');
  const readBackup = async day => (await dataRequest('agenda_backup?select=payload&backup_day=eq.' + day))[0]?.payload;
  const pushKey = () => dataRequest('rpc/agenda_push_public_key', { method: 'POST', body: {} });
  async function saveDevice(subscription) {
    try {
      await dataRequest('agenda_push_devices', {
        method: 'POST', body: { endpoint: subscription.endpoint, keys: subscription.toJSON().keys }
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      const [device] = await dataRequest('agenda_push_devices?select=endpoint&endpoint=eq.' + encodeURIComponent(subscription.endpoint));
      if (!device) throw error;
    }
  }
  const deleteDevice = endpoint => dataRequest('agenda_push_devices?endpoint=eq.' + encodeURIComponent(endpoint), { method: 'DELETE' });

  return { load, save, saveClinicalSession, clinicalIndex, clinicalHistory, appendClinical,
    signIn, signOut, backups, readBackup, pushKey, saveDevice, deleteDevice,
    accountEmail: () => session?.user?.email ?? '', hasSession: () => Boolean(session) };
})();
