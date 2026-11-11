'use strict';

const { modes, newData, sum, cycleSlots, charges, addPayment, preservePayments, reminders, validateBackup } = AgendaModel;
const key = 'agenda-vitoria-v1';
const $ = selector => document.querySelector(selector);
const today = () => iso(new Date());
const iso = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map((value, index) => index ? String(value).padStart(2, '0') : value).join('-');
const shift = (date, days) => {
  const value = new Date(date + 'T12:00');
  value.setDate(value.getDate() + days);
  return iso(value);
};
const weekStart = date => shift(date, -((new Date(date + 'T12:00').getDay() + 6) % 7));
const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dayLabel = value => value ? value.split('-').reverse().join('/') : 'A definir';
const monthLabel = value => new Date(value + '-01T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const statusLabel = {
  agendada: 'Agendada', realizada: 'Realizada', perdida: 'Perdida',
  cancelada: 'Cancelada', decidir: 'Falta · decidir', remarcar: 'A remarcar'
};
const nav = { agenda: 'Agenda da semana', pendencias: 'Pendências', pacientes: 'Pacientes', financeiro: 'Financeiro', indicadores: 'Indicadores', conta: 'Conta e backups' };
const weekdayNames = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const id = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
const btn = (label, action, value = '', variant = '') =>
  `<button type="button" class="${variant}" data-action="${action}" data-id="${esc(value)}">${label}</button>`;
const patient = patientId => data.patients.find(p => p.id === patientId);
const patientName = patientId => esc(patient(patientId)?.name ?? 'Paciente');
const formValue = (form, name) => new FormData(form).get(name);
const cents = (form, name) => Math.round(Number(formValue(form, name)) * 100);
const amountField = (label, value = '', max = '') =>
  `<label>${label}<input name="amount" type="number" min="0.01" step="0.01" value="${value}" ${max ? 'max="' + max + '"' : ''} required></label>`;
const option = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;

let snapshot;
let data;
let view = 'agenda';
let week = weekStart(today());
let month = today().slice(0, 7);
let financeMonth = month;
const cloudMode = location.protocol !== 'file:';
let revision = 0;
let saving = false;
let signedIn = false;

function reload() {
  snapshot = localStorage.getItem(key);
  data = snapshot ? JSON.parse(snapshot) : newData();
}

function change(mutate, message = '') {
  if (saving) return;
  if (cloudMode) {
    const next = structuredClone(data);
    mutate(next);
    saving = true;
    AgendaCloud.save(next, revision).then(row => {
      revision = row.revision;
      data = row.payload;
      completeChange(message);
    }).catch(async error => {
      if (!AgendaCloud.hasSession()) {
        showGate(error.message);
        return;
      }
      if (error.conflict) {
        try {
          applyCloud(await AgendaCloud.load());
          if ($('#dialog').open) $('#dialog').close();
          render();
        } catch {
          error = new Error('Não foi possível atualizar os dados. Reabra o app e tente novamente.');
        }
      }
      const target = $('#dialog').open ? $('#dialog .error') : $('#feedback');
      target.textContent = error.message;
    }).finally(() => { saving = false; });
    return;
  }
  if (localStorage.getItem(key) !== snapshot) {
    reload();
    throw new Error('Os registros mudaram em outra aba. Feche este formulário e tente novamente.');
  }
  const next = JSON.parse(JSON.stringify(data));
  mutate(next);
  const serialized = JSON.stringify(next);
  localStorage.setItem(key, serialized);
  snapshot = serialized;
  data = next;
  completeChange(message);
}

function completeChange(message) {
  const returnFocus = $('#dialog').open && $('#dialog').contains(document.activeElement);
  if ($('#dialog').open) $('#dialog').close();
  render();
  if (returnFocus) $('#alert-panel').hidden ? $('#title').focus() : $('#alert-toggle').focus();
  $('#feedback').textContent = message;
}

function applyCloud(row) {
  data = row.payload ?? newData();
  revision = row.revision;
}

function showGate(message = '') {
  signedIn = false;
  data = null;
  revision = 0;
  if ($('#dialog').open) $('#dialog').close();
  $('#content').replaceChildren();
  $('#alert-list').replaceChildren();
  $('#feedback').textContent = '';
  setAlerts(false);
  document.body.classList.add('signed-out');
  $('#account-gate').hidden = false;
  $('#account-message').textContent = message;
}

function enter(row) {
  applyCloud(row);
  signedIn = true;
  view = 'agenda';
  document.body.classList.remove('signed-out');
  $('#account-gate').hidden = true;
  $('#account-nav').hidden = false;
  render();
}

function setAlerts(open) {
  $('#alert-panel').hidden = !open;
  $('#alert-toggle').setAttribute('aria-expanded', String(open));
}

function dialog(title, fields, submit, saveLabel = 'Salvar') {
  const box = $('#dialog');
  $('#dialog-body').innerHTML = `<form><h2>${title}</h2>${fields}<p class="error" role="alert"></p>
    <div class="actions">${btn('Voltar', 'close-dialog')} <button class="primary">${saveLabel}</button></div></form>`;
  $('#dialog-body form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try { await submit(form); }
    catch (error) { form.querySelector('.error').textContent = error.message; }
  };
  if (!box.open) box.showModal();
}

function pendingItems(entries) {
  const now = Date.parse(localStamp() + 'Z');
  const unrecorded = data.sessions.filter(s => s.status === 'agendada' &&
    Date.parse(s.at + 'Z') + (s.duration ?? 60) * 60000 <= now)
    .sort((a, b) => a.at.localeCompare(b.at));
  return [...unrecorded.map(session => ({ type: 'session', session })), ...reminders(data, entries, today())];
}

function renderAlerts(items) {
  const counter = $('#alert-count');
  counter.hidden = items.length === 0;
  counter.textContent = items.length;
  counter.setAttribute('aria-label', items.length + ' pendentes');
  $('#alert-list').innerHTML = items.slice(0, 4).map(pendingCard).join('') || '<p>Nenhum alerta pendente.</p>';
}

function pendingCard(item) {
    if (item.type === 'cycle') return `<article class="card"><h3>Ciclo perto do fim</h3>
      <p>${esc(item.patient.name)} · Resta 1 sessão</p><p>Próximo vencimento: ${dayLabel(item.next)}</p>
      <div class="actions">${btn('Ver agenda', 'patient-agenda', item.patient.id)}</div></article>`;
    if (item.type === 'conexa') return `<article class="card"><h3>Conferir repasse Conexa</h3>
      <p>${monthLabel(item.month)} · ${money(item.balance)} em aberto</p>
      <div class="actions">${btn('Conciliar sessões', 'reconcile', item.month)}</div></article>`;
    if (item.type === 'session') {
      const missing = item.session.status === 'agendada';
      return `<article class="card"><h3>${missing ? 'Sessão sem registro' : statusLabel[item.session.status]}</h3>
      <p>${patientName(item.session.patientId)} · ${appointmentTime(item.session)}</p>
      <div class="actions">${btn(missing ? 'Registrar atendimento' : 'Resolver', 'session', item.session.id, 'primary')}</div></article>`;
    }
    const { charge } = item;
    const due = data.reminders[charge.id]?.date || charge.due;
    return `<article class="card"><h3>${due < today() ? 'Cobrança vencida' : 'Pagamento previsto para hoje'}</h3>
      <p>${patientName(charge.patientId)} · ${money(charge.balance)}</p>
      <p>Vencimento: ${dayLabel(data.reminders[charge.id]?.date || charge.due)}</p>
      <div class="actions">${btn('Sim, recebi', 'pay', charge.id, 'primary')}</div>
      <details><summary>Ainda não recebi</summary><div class="actions">
      ${btn('Prorrogar cobrança', 'defer', charge.id)}${btn('Suspender aviso', 'pause', charge.id)}
      ${patient(charge.patientId)?.active ? btn('Encerrar acompanhamento', 'end', charge.patientId) : ''}
      </div></details></article>`;
}

function pendingPage(items) {
  const groups = [
    ['Atendimentos', ['session']], ['Financeiro', ['payment', 'conexa']], ['Próximos ciclos', ['cycle']]
  ];
  return groups.map(([title, types]) => {
    const group = items.filter(item => types.includes(item.type));
    return group.length ? `<section class="pending-group"><h2>${title} <span class="badge">${group.length}</span></h2>
      <div class="pending-grid">${group.map(pendingCard).join('')}</div></section>` : '';
  }).join('') || '<p class="record">Nenhuma pendência no momento.</p>';
}

function slotStarts(day) {
  const index = (new Date(day + 'T12:00').getDay() + 6) % 7;
  return data.hours.filter(hour => hour.day === index).flatMap(hour => {
    const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const starts = [];
    for (let time = toMinutes(hour.start); time + 60 <= toMinutes(hour.end); time += 60) {
      starts.push([Math.floor(time / 60), time % 60].map(n => String(n).padStart(2, '0')).join(':'));
    }
    return starts;
  });
}

function schedule() {
  const days = weekdayNames.map((name, index) => {
    const date = shift(week, index);
    const sessions = data.sessions.filter(s => s.at.slice(0, 10) === date)
      .sort((a, b) => a.at.localeCompare(b.at));
    const starts = slotStarts(date);
    const times = [...new Set([...starts, ...sessions.map(s => s.at.slice(11, 16))])].sort();
    return `<section class="day ${date === today() ? 'today' : ''}"><h2>${name}<small>${dayLabel(date).slice(0, 5)}</small></h2>
      ${times.map(time => {
        const scheduled = sessions.filter(s => s.at.slice(11, 16) === time);
        const cards = scheduled.map(s => {
          const index = s.mode === 'ciclo' ? cycleSlots(data.sessions, s.patientId).findIndex(slot => slot.id === s.id) : -1;
          const label = index >= 0 ? 'Sessão ' + (index % 4 + 1) + ' de 4' : modes[s.mode];
          return btn(`<strong>${patientName(s.patientId)}</strong><small>${label}</small><small>${statusLabel[s.status]}</small>`,
            'session', s.id, 'session');
        }).join('');
        return `<div class="time"><span>${time}</span>${cards}${starts.includes(time) && !data.sessions.some(s => blocksTime(s) && overlaps(s, { at: date + 'T' + time })) ?
          btn('Livre', 'book', date + 'T' + time, 'free') : ''}</div>`;
      }).join('') || '<p class="empty">Sem horários</p>'}</section>`;
  }).join('');
  return `<div class="toolbar">${btn('← Semana anterior', 'week', '-7')}${btn('Hoje', 'week', '0')}
    ${btn('Próxima semana →', 'week', '7')}<span class="spacer"></span>
    ${btn('Disponibilidade', 'hours')}${btn('Sincronizar Google', 'google')}${btn('+ Nova sessão', 'book', '', 'primary')}</div>
    <div class="week">${days}</div>`;
}

function patientsPage() {
  return `<div class="toolbar">${btn('+ Novo paciente', 'patient', '', 'primary')}</div>
    ${data.patients.map(p => `<article class="record"><div><h2>${esc(p.name)}</h2>
      <p>${modes[p.mode]}${p.mode === 'conexa' ? '' : ' · ' + money(p.amount)} · ${p.active ? 'Ativo' : 'Encerrado'}</p>
      ${p.contact ? '<p>' + esc(p.contact) + '</p>' : ''}</div><div class="actions">
      ${btn('Editar', 'patient', p.id)}${p.active ? btn('Encerrar acompanhamento', 'end', p.id) : btn('Reativar', 'activate', p.id)}
      ${btn('Excluir paciente', 'delete-patient', p.id, 'danger')}
      </div></article>`).join('') || '<p>Cadastre o primeiro paciente para começar.</p>'}`;
}

function chargeRow(entry) {
  const rule = data.reminders[entry.id];
  const label = entry.mode === 'ciclo' ? 'Ciclo ' + entry.number + ' · ' + entry.consumed + '/4 utilizadas' : modes[entry.mode];
  const due = rule?.date || entry.due;
  const status = entry.balance === 0 ? 'Recebido' : due && due < today() ? 'Vencido' : 'Em aberto';
  return `<article class="record"><div><h3>${patientName(entry.patientId)}</h3>
    <p>${label} · ${status} · Vencimento: ${dayLabel(due)}
    ${rule?.date && rule.originalDue ? ' · Original: ' + dayLabel(rule.originalDue) : ''}</p>
    <p>Previsto ${money(entry.amount)} · Recebido ${money(entry.paid)} · Saldo ${money(entry.balance)}</p></div>
    <div class="actions">${entry.balance > 0 ? btn('Registrar recebimento', 'pay', entry.id, 'primary') : ''}
    ${entry.mode === 'ciclo' ? btn('Editar ciclo', 'edit-cycle', entry.id) : btn('Editar sessão', 'edit-session', entry.id)}
    ${rule ? btn('Limpar ajuste do aviso', 'clear-reminder', entry.id) : ''}
    ${entry.balance > 0 && rule?.paused ? btn('Reativar aviso', 'resume', entry.id) : ''}</div></article>`;
}

function finance(entries) {
  const particular = entries.filter(e => e.mode !== 'conexa').sort((a, b) =>
    Number(a.balance === 0) - Number(b.balance === 0) || (a.due || '9999').localeCompare(b.due || '9999'));
  const conexa = entries.filter(e => e.mode === 'conexa');
  const months = [...new Set(conexa.map(e => e.month))].sort().reverse();
  const summary = (label, charges) => {
    const batch = charges.filter(entry => entry.month === financeMonth);
    const expected = sum(batch, entry => entry.amount);
    const received = sum(batch, entry => entry.paid);
    return `<article class="metric"><h3>${label}</h3><dl class="totals">
      <dt>Previsto</dt><dd>${money(expected)}</dd>
      <dt>Recebido dessas cobranças</dt><dd>${money(received)}</dd>
      <dt>Saldo em aberto</dt><dd>${money(expected - received)}</dd></dl></article>`;
  };
  return `<section class="month-close"><h2>Conferência mensal</h2>
    <label>Mês das cobranças e dos atendimentos <input type="month" id="finance-month" value="${financeMonth}"></label>
    <div class="metrics">${summary('Particulares', particular)}${summary('Conexa', conexa)}</div>
    <p class="hint">O total recebido inclui pagamentos vinculados a esse mês, mesmo quando entraram depois.</p></section>
    <div class="toolbar">${btn('Dia de conferência Conexa', 'conexa-day')}</div>
    <h2>Cobranças particulares</h2>${particular.map(chargeRow).join('') || '<p>Nenhuma cobrança registrada.</p>'}
    <h2 class="section-title">Repasses Conexa</h2>${months.map(value => {
      const batch = conexa.filter(e => e.month === value);
      const remaining = sum(batch, e => e.balance);
      return `<details class="record batch" ${remaining > 0 ? 'open' : ''}>
        <summary>${monthLabel(value)} · Previsto ${money(sum(batch, e => e.amount))} · Saldo ${money(remaining)}</summary>
        ${remaining > 0 ? '<div class="actions">' + btn('Conciliar sessões', 'reconcile', value) + '</div>' : ''}
        ${batch.map(chargeRow).join('')}</details>`;
    }).join('') || '<p>Nenhuma sessão da Conexa concluída.</p>'}
    <h2 class="section-title">Histórico de recebimentos</h2>
    ${data.payments.map((payment, index) => ({ payment, index }))
      .sort((a, b) => b.payment.date.localeCompare(a.payment.date)).map(({ payment, index }) => {
      const entry = entries.find(e => e.id === payment.chargeId);
      return `<div class="record"><div><span>${dayLabel(payment.date)} · ${patientName(entry?.patientId)} · ${modes[payment.mode]}</span>
        <p><strong>${money(payment.amount)}</strong></p></div><div class="actions">
        ${btn('Editar recebimento', 'edit-payment', index)}${btn('Excluir recebimento', 'delete-payment', index, 'danger')}</div></div>`;
    }).join('') || '<p>Nenhum recebimento registrado.</p>'}`;
}

function timeline(title, description, months, series, format, breakdown = []) {
  const plot = { left: 108, right: 790, top: 20, bottom: 201 };
  const maximum = Math.max(0, ...series.flatMap(line => line.values));
  const unit = format === money ? 100 : 1;
  const quarter = unit * Math.max(1, Math.ceil(maximum / (4 * unit)));
  const x = index => plot.left + (plot.right - plot.left) * index / (months.length - 1);
  const y = value => plot.bottom - (plot.bottom - plot.top) * value / (quarter * 4);
  const shortMonth = value => value.slice(5) + '/' + value.slice(2, 4);
  const grid = [0, 1, 2, 3, 4].map(tick => {
    const value = tick * quarter;
    return `<line class="chart-grid" x1="${plot.left}" x2="${plot.right}" y1="${y(value)}" y2="${y(value)}"/>
      <text x="${plot.left - 9}" y="${y(value) + 4}" text-anchor="end">${format(value)}</text>`;
  }).join('');
  const lines = series.map((line, index) => `<g class="chart-series series-${index}">
    <polyline points="${line.values.map((value, i) => x(i) + ',' + y(value)).join(' ')}"/>
    ${line.values.map((value, i) => `<circle cx="${x(i)}" cy="${y(value)}" r="4">
      <title>${monthLabel(months[i])} · ${line.label} · ${format(value)}</title></circle>`).join('')}</g>`).join('');
  const columns = [...series, ...breakdown];
  return `<section class="timeline"><h2>${title}</h2><p>${description}</p>
    ${series.length > 1 ? `<ul class="chart-legend">${series.map((line, index) =>
      `<li class="series-${index}">${line.label}</li>`).join('')}</ul>` : ''}
    <div class="chart-scroll"><svg viewBox="0 0 820 238" role="img" aria-label="${title}. Valores na tabela abaixo.">
      ${grid}${lines}
      ${months.map((value, i) => `<text x="${x(i)}" y="224" text-anchor="middle">${shortMonth(value)}</text>`).join('')}
    </svg></div>
    <details><summary>Ver valores por mês</summary>
      <table class="chart-values"><thead><tr><th scope="col">Mês</th>${columns.map(line => `<th scope="col">${line.label}</th>`).join('')}</tr></thead>
      <tbody>${months.map((value, i) => `<tr><th scope="row">${monthLabel(value)}</th>
        ${columns.map(line => `<td>${format(line.values[i])}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </details></section>`;
}

function indicators(entries) {
  const [year, number] = month.split('-').map(Number);
  const months = Array.from({ length: 12 }, (_, index) => iso(new Date(year, number - 12 + index, 1)).slice(0, 7));
  const reportable = entries.filter(e => e.mode !== 'ciclo' || e.consumed > 0 || e.paid > 0);
  const generatedFor = value => sum(reportable.filter(e => e.month === value), e => e.amount);
  const receivedFor = (value, include = () => true) =>
    sum(data.payments.filter(p => p.date.startsWith(value) && include(p)), p => p.amount);
  const patientsFor = value => new Set(data.sessions.filter(s => s.status === 'realizada' && s.at.startsWith(value))
    .map(s => s.patientId)).size;
  const selectedPayments = data.payments.filter(p => p.date.startsWith(month));
  const selectedSessions = data.sessions.filter(s => s.at.startsWith(month));
  const received = sum(selectedPayments, p => p.amount);
  const generated = generatedFor(month);
  const open = sum(entries, e => e.balance);
  const metric = (label, value) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
  const days = Array.from({ length: new Date(year, number, 0).getDate() }, (_, index) => shift(month + '-01', index));
  const available = days.flatMap(day => slotStarts(day).map(time => day + 'T' + time));
  const occupied = selectedSessions.filter(blocksTime);
  const occupancy = available.length ? Math.round(100 * available.filter(slot => occupied.some(s => overlaps(s, { at: slot }))).length / available.length) + '%' : 'A definir';
  return `<div class="toolbar"><label>Mês de referência <input type="month" id="report-month" value="${month}"></label></div>
    <div class="metrics">${metric('Recebido no mês', money(received))}${metric('Gerado no mês', money(generated))}
      ${metric('Saldo em aberto · todos os meses', money(open))}${metric('Ocupação · horários atuais', occupancy)}
      ${metric('Realizadas', selectedSessions.filter(s => s.status === 'realizada').length)}
      ${metric('Faltas registradas', selectedSessions.filter(s => s.absent).length + (data.absences ?? []).filter(a => (a.at ?? a).startsWith(month)).length)}
      ${metric('Canceladas ou em remarcação', selectedSessions.filter(s => ['cancelada', 'remarcar'].includes(s.status)).length)}</div>
    ${timeline('Evolução do faturamento', 'Últimos 12 meses até o mês selecionado. O gerado segue o mês da cobrança ou do atendimento da Conexa. O recebido segue a data do pagamento.', months, [
      { label: 'Recebido', values: months.map(value => receivedFor(value)) },
      { label: 'Gerado', values: months.map(generatedFor) }
    ], money, [
      { label: 'Recebido · Particular', values: months.map(value => receivedFor(value, p => p.mode !== 'conexa')) },
      { label: 'Recebido · Conexa', values: months.map(value => receivedFor(value, p => p.mode === 'conexa')) }
    ])}
    ${timeline('Evolução dos pacientes atendidos', 'Cada paciente conta uma vez no mês em que teve pelo menos uma sessão realizada.', months, [
      { label: 'Pacientes atendidos', values: months.map(patientsFor) }
    ], String)}`;
}

function render() {
  const entries = charges(data);
  const items = pendingItems(entries);
  $('#title').textContent = nav[view];
  $('#title').tabIndex = -1;
  $('#subtitle').textContent = view === 'agenda' ? dayLabel(week) + ' a ' + dayLabel(shift(week, 6)) : '';
  for (const button of document.querySelectorAll('nav [data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('selected', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#content').innerHTML = view === 'pendencias' ? pendingPage(items)
    : { agenda: schedule, pacientes: patientsPage, financeiro: finance, indicadores: indicators, conta: accountPage }[view](entries);
  renderAlerts(items);
}

function accountPage() {
  if (!cloudMode) return `<p>Baixe uma cópia para transferir os registros locais à sua conta.</p>
    <div class="toolbar">${btn('Baixar meus dados', 'export')}</div>`;
  return `<p>Os registros são salvos no servidor. As cópias diárias ficam disponíveis por até 30 dias.</p>
    <div class="toolbar">${btn('Ver cópias disponíveis', 'backups')}${btn('Baixar meus dados', 'export')}
    ${revision === 0 ? btn('Importar dados locais', 'import-local') : ''}${btn('Sair', 'sign-out')}</div>
    <h2>Notificações neste dispositivo</h2>
    <p>Quando houver pendências, você poderá receber um aviso pela manhã. No iPhone, adicione o app à Tela de Início e abra por ela para ativar.</p>
    <div class="toolbar">${btn('Ativar notificações', 'push-on')}${btn('Desativar notificações', 'push-off')}</div>`;
}

async function configurePush(enable) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Este navegador não oferece notificações neste modo. No iPhone, abra o app pela Tela de Início.');
  }
  if (enable && await Notification.requestPermission() !== 'granted') {
    throw new Error('Permita notificações nas configurações do navegador para ativar.');
  }
  await navigator.serviceWorker.register('./sw.js', { scope: './agenda.html' });
  const worker = await navigator.serviceWorker.ready;
  let subscription = await worker.pushManager.getSubscription();
  if (enable) {
    if (!subscription) {
      const publicKey = await AgendaCloud.pushKey();
      if (!publicKey) throw new Error('O serviço de notificações ainda está sendo preparado.');
      const raw = publicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(publicKey.length / 4) * 4, '=');
      subscription = await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(atob(raw), char => char.charCodeAt(0))
      });
    }
    await AgendaCloud.saveDevice(subscription);
  } else if (subscription) {
    await AgendaCloud.deleteDevice(subscription.endpoint);
    await subscription.unsubscribe();
  }
  $('#feedback').textContent = enable ? 'Notificações ativadas neste dispositivo.' : 'Notificações desativadas neste dispositivo.';
}

function download(payload, date) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'agenda-vitoria-' + date + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function accountAction(action, value) {
  if (action === 'push-on' || action === 'push-off') {
    await configurePush(action === 'push-on');
  } else if (action === 'sign-out') {
    showGate();
    await AgendaCloud.signOut();
  } else if (action === 'export') {
    download(data, today());
  } else if (action === 'backups') {
    const list = await AgendaCloud.backups();
    if (!signedIn) return;
    dialog('Cópias disponíveis', list.map(row => `<div class="record">${dayLabel(row.backup_day)}
      <div class="actions">${btn('Baixar', 'backup-download', row.backup_day)}${btn('Restaurar', 'backup-restore', row.backup_day)}</div></div>`)
      .join('') || '<p>A primeira cópia será feita após o primeiro dia de uso.</p>', () => $('#dialog').close(), 'Fechar');
  } else if (action === 'import-local') {
    dialog('Importar dados locais', '<label>Arquivo baixado da Agenda Vitória<input type="file" name="backup" accept=".json,application/json" required></label>',
      async form => {
        const file = formValue(form, 'backup');
        if (file.size > 5000000) throw new Error('Selecione um arquivo com até 5 MB.');
        const payload = validateBackup(JSON.parse(await file.text()));
        if (revision !== 0) throw new Error('A conta já tem registros.');
        change(next => Object.assign(next, payload), 'Dados locais copiados.');
      }, 'Importar');
  } else {
    const payload = await AgendaCloud.readBackup(value);
    if (!signedIn) return;
    if (!payload) throw new Error('A cópia selecionada não está mais disponível.');
    if (action === 'backup-download') download(payload, value);
    else dialog('Restaurar cópia', `<p>A cópia de ${dayLabel(value)} substituirá os registros atuais. Uma cópia dos registros atuais será baixada antes da restauração.</p>`,
      () => {
        download(data, today());
        change(next => {
          for (const name of Object.keys(next)) delete next[name];
          Object.assign(next, payload);
        }, 'Cópia restaurada.');
      }, 'Restaurar');
  }
}

const localStamp = () => {
  const now = new Date();
  return today() + 'T' + now.toTimeString().slice(0, 5);
};
const blocksTime = session => ['agendada', 'realizada', 'perdida', 'decidir'].includes(session.status);
const appointmentTime = session => dayLabel(session.at.slice(0, 10)) + ' às ' + session.at.slice(11, 16);
function overlaps(a, b) {
  const first = Date.parse(a.at + 'Z');
  const second = Date.parse(b.at + 'Z');
  return first < second + (b.duration ?? 60) * 60000 && second < first + (a.duration ?? 60) * 60000;
}

function googleDialog() {
  if (!cloudMode) {
    dialog('Sincronizar Google Calendário',
      '<p>A conexão com o Google fica disponível na versão com login, em um endereço autorizado no Google Cloud. A prévia local usa dados fictícios.</p>',
      () => $('#dialog').close(), 'Fechar');
    return;
  }
  if (!data.patients.some(p => p.active)) throw new Error('Cadastre ao menos um paciente ativo antes de importar.');
  const configKey = 'agenda-vitoria-google-client-id';
  dialog('Sincronizar Google Calendário', `
    <p>Escolha o período do calendário principal da Vitória. Depois, selecione quais eventos são atendimentos.</p>
    <label>De<input name="start" type="date" value="${shift(today(), -30)}" required></label>
    <label>Até<input name="end" type="date" value="${shift(today(), 60)}" required></label>
    <details ${localStorage.getItem(configKey) ? '' : 'open'}>
      <summary>Configuração da conexão</summary>
      <label>ID do cliente OAuth do Google<input name="client" value="${esc(localStorage.getItem(configKey))}" placeholder="…apps.googleusercontent.com" required></label>
    </details>
    <p class="hint">O Google será consultado em modo de leitura.</p>`, async form => {
    const client = formValue(form, 'client').trim();
    const start = formValue(form, 'start');
    const end = formValue(form, 'end');
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(client)) throw new Error('Informe um ID de cliente OAuth válido.');
    if (start > end || end > shift(start, 366)) throw new Error('Escolha um intervalo de até um ano.');
    const submit = form.querySelector('button.primary');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const token = await GoogleAgenda.authorize(client);
      const events = await GoogleAgenda.events(token, start, shift(end, 1));
      if (!form.isConnected || !$('#dialog').open || !signedIn) return;
      localStorage.setItem(configKey, client);
      reviewGoogle(events);
    } finally { submit.disabled = false; }
  }, 'Conectar e buscar eventos');
  const form = $('#dialog form');
  const submit = form.querySelector('button.primary');
  submit.disabled = true;
  GoogleAgenda.prepare().then(() => { submit.disabled = false; })
    .catch(error => { form.querySelector('.error').textContent = error.message; });
}

function reviewGoogle(events) {
  const people = data.patients.filter(p => p.active);
  const known = new Map(data.sessions.filter(s => s.googleRef).map(s => [s.googleRef, s]));
  const candidates = events.filter(event => {
    const existing = known.get(event.ref);
    return !existing || existing.status === 'agendada' && (existing.at !== event.at || existing.duration !== event.duration);
  });
  const rows = candidates.map((event, index) => {
    const existing = known.get(event.ref);
    const choices = existing ? people.filter(p => p.id === existing.patientId) : people;
    return `<label class="record google-review"><span><strong>${esc(event.title)}</strong>
      <span class="badge">${existing ? 'Remarcação' : 'Novo evento'}</span>
      ${existing ? `<small>Na Agenda: ${appointmentTime(existing)} · ${existing.duration ?? 60} min</small>` : ''}
      <small>No Google: ${appointmentTime(event)} · ${event.duration} min</small></span>
      <select name="event-${index}">${option('', 'Ignorar evento')}
      ${choices.map(p => option(p.id, existing ? 'Atualizar horário de ' + p.name : 'Importar para ' + p.name)).join('')}
      </select></label>`;
  }).join('');
  dialog('Revisar eventos do Google', `
    <p>Vincule apenas os atendimentos. Sessões importadas ficam agendadas, sem registrar pagamento ou presença.</p>
    ${rows || '<p>Nenhum evento novo ou horário alterado neste período.</p>'}`, form => {
    if (!candidates.length) { $('#dialog').close(); return; }
    const selected = candidates.map((event, index) => ({ event, person: patient(formValue(form, 'event-' + index)) }))
      .filter(item => item.person?.active);
    if (!selected.length) throw new Error('Selecione ao menos um evento para importar ou atualizar.');
    change(next => {
      const refs = new Set(selected.map(item => item.event.ref));
      const occupied = next.sessions.filter(s => blocksTime(s) && !refs.has(s.googleRef));
      for (const { event, person } of selected) {
        const existing = next.sessions.find(s => s.googleRef === event.ref);
        if (existing && (existing.status !== 'agendada' || existing.patientId !== person.id)) {
          throw new Error('Uma sessão já mudou na Agenda Vitória. Atualize a página e tente novamente.');
        }
        if (occupied.some(s => overlaps(s, event))) {
          throw new Error('Conflito de horário em ' + dayLabel(event.at.slice(0, 10)) + ' às ' + event.at.slice(11) + '. Confira a agenda ou ignore esse evento.');
        }
        const slot = { at: event.at, duration: event.duration };
        if (existing) Object.assign(existing, slot);
        else next.sessions.push({ ...slot, id: id(), patientId: person.id, mode: person.mode,
          amount: person.amount, status: 'agendada', googleRef: event.ref });
        occupied.push(slot);
      }
      preservePayments(data, next);
    }, selected.length + ' atendimento(s) importado(s) ou atualizado(s).');
  }, candidates.length ? 'Salvar selecionados' : 'Fechar');
}

function patientDialog(existing) {
  dialog(existing ? 'Editar paciente' : 'Novo paciente', `
    <label>Nome<input name="name" maxlength="100" value="${esc(existing?.name)}" required></label>
    <label>Contato<input name="contact" maxlength="120" value="${esc(existing?.contact)}"></label>
    <label>Modalidade<select name="mode">${Object.entries(modes).map(([value, label]) =>
      option(value, label, existing?.mode)).join('')}</select></label>
    <div id="patient-amount">${amountField('Valor por sessão ou ciclo (R$)', existing?.amount ? existing.amount / 100 : '')}</div>
    <p class="hint">Alterações de modalidade e valor valem para novos agendamentos.</p>`, form => {
    const name = formValue(form, 'name').trim();
    const mode = formValue(form, 'mode');
    if (!name) throw new Error('Informe o nome.');
    const record = { id: existing?.id ?? id(), active: existing?.active ?? true, name,
      contact: formValue(form, 'contact').trim(), mode, amount: mode === 'conexa' ? 0 : cents(form, 'amount') };
    if (mode !== 'conexa' && (!Number.isSafeInteger(record.amount) || record.amount <= 0)) throw new Error('Informe um valor válido.');
    change(next => {
      if (existing) next.patients[next.patients.findIndex(p => p.id === existing.id)] = record;
      else next.patients.push(record);
    }, 'Paciente salvo.');
  });
  const select = $('#dialog select');
  const update = () => {
    $('#patient-amount').hidden = select.value === 'conexa';
    $('#patient-amount input').disabled = select.value === 'conexa';
  };
  select.addEventListener('change', update);
  update();
}

function bookDialog(at, existing) {
  const people = data.patients.filter(p => p.active);
  if (!people.length || existing && !patient(existing.patientId)?.active) {
    throw new Error('Cadastre ou reative o paciente antes de agendar.');
  }
  dialog(existing ? 'Remarcar sessão' : 'Nova sessão', `
    ${existing ? '<p>' + patientName(existing.patientId) + '</p>' :
      '<label>Paciente<select name="patient">' + people.map(p => option(p.id, p.name)).join('') + '</select></label>'}
    <label>Data e horário<input type="datetime-local" name="at" value="${at || localStamp()}" required></label>
    ${existing ? '' : '<label>Repetir por quantas semanas?<input name="weeks" type="number" min="1" max="52" value="1" required></label>'}
    <p class="hint">Esta sessão reserva ${existing?.duration ?? 60} minutos.</p>`, form => {
    const time = formValue(form, 'at');
    const number = existing ? 1 : Number(formValue(form, 'weeks'));
    const person = patient(existing?.patientId ?? formValue(form, 'patient'));
    const times = Array.from({ length: number }, (_, index) => shift(time.slice(0, 10), index * 7) + time.slice(10));
    if (times.some(start => data.sessions.some(s => s.id !== existing?.id && blocksTime(s) &&
      overlaps({ at: start, duration: existing?.duration }, s)))) {
      throw new Error('Um dos horários se sobrepõe a outra sessão.');
    }
    change(next => {
      if (existing) {
        const previous = next.sessions.find(s => s.id === existing.id);
        if (previous.absent) next.absences = [...(next.absences ?? []), { at: previous.at, sessionId: previous.id }];
        Object.assign(previous, { at: time, status: 'agendada', absent: false });
      } else {
        for (const start of times) next.sessions.push({ id: id(), patientId: person.id, at: start,
          status: 'agendada', mode: person.mode, amount: person.amount });
      }
      week = weekStart(time.slice(0, 10));
    }, existing ? 'Sessão remarcada.' : 'Agendamento salvo.');
  });
}

function hoursDialog() {
  dialog('Disponibilidade semanal', `<p class="hint">Deixe os dois campos vazios nos dias sem atendimento.</p>
    ${weekdayNames.map((name, index) => {
      const hour = data.hours.find(item => item.day === index);
      return `<fieldset><legend>${name}</legend><label>Início<input type="time" name="start-${index}" value="${hour?.start ?? ''}"></label>
        <label>Fim<input type="time" name="end-${index}" value="${hour?.end ?? ''}"></label></fieldset>`;
    }).join('')}`, form => {
    const hours = weekdayNames.map((name, day) => {
      const start = formValue(form, 'start-' + day);
      const end = formValue(form, 'end-' + day);
      if (!start && !end) return null;
      if (!start || !end || new Date('2000-01-01T' + end) - new Date('2000-01-01T' + start) < 3600000) {
        throw new Error('Informe pelo menos uma hora de disponibilidade para ' + name.toLowerCase() + '.');
      }
      return { day, start, end };
    }).filter(Boolean);
    change(next => { next.hours = hours; }, 'Disponibilidade salva.');
  });
}

function updateSession(session, changes, message) {
  change(next => {
    Object.assign(next.sessions.find(s => s.id === session.id), changes);
    preservePayments(data, next);
  }, message);
}

function sessionDialog(session) {
  const active = patient(session.patientId)?.active;
  const edit = session.status === 'agendada';
  const decide = session.status === 'decidir';
  const actions = edit ? [
    btn('Concluir sessão', 'complete', session.id, 'primary'),
    btn('Registrar falta', 'absent', session.id),
    btn('Registrar cancelamento', 'cancel-session', session.id),
    ...(active ? [btn('Alterar horário', 'rebook', session.id)] : [])
  ] : decide ? [
    btn('Contar como perdida', 'lost', session.id),
    btn('Preservar para remarcação', 'preserve', session.id)
  ] : session.status === 'remarcar' && active ? [btn('Escolher novo horário', 'rebook', session.id, 'primary')] : [];
  dialog('Atendimento', `<p><strong>${patientName(session.patientId)}</strong> · ${modes[session.mode]}</p>
    <p>${dayLabel(session.at.slice(0, 10))} às ${session.at.slice(11)} · ${session.duration ?? 60} min · ${statusLabel[session.status]}</p>
    <div class="actions">${actions.join('')}${btn('Editar sessão', 'edit-session', session.id)}
    ${btn('Excluir sessão', 'delete-session', session.id, 'danger')}</div>`, () => $('#dialog').close(), 'Fechar');
  $('#dialog form button[type="button"][data-action="close-dialog"]').hidden = true;
}

function completionDialog(session) {
  if (session.at > localStamp()) throw new Error('A sessão ainda não começou.');
  const conexa = session.mode === 'conexa';
  dialog('Concluir sessão', `<p>${patientName(session.patientId)}</p>${conexa ? amountField('Repasse previsto (R$)') : ''}
    ${session.mode === 'sessao' ? `<p>Valor da sessão: ${money(session.amount)}</p>
      <label class="check"><input name="paid" type="checkbox"> Recebido hoje</label>` : ''}`, form => {
    const amount = conexa ? cents(form, 'amount') : session.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Informe um valor válido.');
    change(next => {
      Object.assign(next.sessions.find(s => s.id === session.id), { status: 'realizada', amount });
      if (formValue(form, 'paid')) addPayment(next, charges(next).find(entry => entry.id === session.id), amount, today());
    }, 'Sessão concluída.');
  });
}

function cancellationDialog(session) {
  dialog('Registrar cancelamento', `<p>${patientName(session.patientId)}</p>
    <label>Quando o paciente avisou?<input name="notice" type="datetime-local" value="${localStamp()}" max="${localStamp()}" required></label>
    <p class="hint">Com duas horas ou mais de antecedência, a sessão do ciclo fica disponível para remarcação.</p>`, form => {
    const notice = formValue(form, 'notice');
    const timely = new Date(session.at) - new Date(notice) >= 7200000;
    const status = session.mode === 'ciclo' ? (timely ? 'remarcar' : 'decidir') : 'cancelada';
    updateSession(session, { status, notice }, status === 'decidir' ? 'Cancelamento registrado. Decida se a sessão será preservada.' : 'Cancelamento registrado.');
  });
}

function paymentDialog(entry) {
  dialog('Registrar recebimento', `<p>${patientName(entry.patientId)} · Saldo ${money(entry.balance)}</p>
    ${amountField('Valor recebido (R$)', entry.balance / 100, entry.balance / 100)}
    <label>Data do recebimento<input type="date" name="date" value="${today()}" max="${today()}" required></label>`,
    form => change(next => addPayment(next, entry, cents(form, 'amount'), formValue(form, 'date')), 'Recebimento registrado.'));
}

function editSession(session) {
  const people = data.patients.filter(p => p.active || p.id === session.patientId);
  const outcome = session.status === 'decidir' && !session.absent ? 'cancelamento-pendente'
    : session.status === 'remarcar' && session.absent ? 'falta-remarcar'
    : session.status === 'perdida' && !session.absent ? 'cancelamento-perdido' : session.status;
  const outcomes = { ...statusLabel, perdida: 'Falta · contar como perdida',
    'cancelamento-pendente': 'Cancelamento tardio · decidir',
    'falta-remarcar': 'Falta · preservar para remarcação',
    'cancelamento-perdido': 'Cancelamento tardio · contar como perdida' };
  dialog('Editar sessão', `
    <label>Paciente<select name="patient">${people.map(p => option(p.id, p.name, session.patientId)).join('')}</select></label>
    <label>Data e horário<input type="datetime-local" name="at" value="${esc(session.at)}" required></label>
    <label>Modalidade<select name="mode">${Object.entries(modes).map(([value, label]) => option(value, label, session.mode)).join('')}</select></label>
    <label>Situação<select name="status">${Object.entries(outcomes).map(([value, label]) => option(value, label, outcome)).join('')}</select></label>
    <label>Valor da sessão, ciclo ou repasse previsto (R$)
      <input name="amount" type="number" min="0" step="0.01" value="${session.amount / 100}" required></label>
    <label>Data e hora do aviso de cancelamento <input name="notice" type="datetime-local" value="${esc(session.notice)}" max="${localStamp()}"></label>
    <p class="hint">Alterar uma sessão do ciclo pode atualizar a contagem e o vencimento. Recebimentos já registrados continuam vinculados à cobrança original.</p>`, form => {
    const chosen = formValue(form, 'status');
    const status = { 'cancelamento-pendente': 'decidir', 'falta-remarcar': 'remarcar', 'cancelamento-perdido': 'perdida' }[chosen] ?? chosen;
    const updated = { ...session, patientId: formValue(form, 'patient'), at: formValue(form, 'at'),
      mode: formValue(form, 'mode'), status, amount: cents(form, 'amount'),
      notice: formValue(form, 'notice'), absent: ['decidir', 'perdida', 'falta-remarcar'].includes(chosen) };
    if (!Number.isSafeInteger(updated.amount) || updated.amount < 0 ||
      (updated.mode !== 'conexa' || status === 'realizada') && updated.amount === 0) throw new Error('Informe um valor válido.');
    if (status !== 'agendada' && status !== 'cancelada' && status !== 'remarcar' && updated.at > localStamp()) {
      throw new Error('A sessão ainda não começou.');
    }
    if (blocksTime(updated) && data.sessions.some(s => s.id !== session.id && blocksTime(s) && overlaps(s, updated))) {
      throw new Error('O horário se sobrepõe a outra sessão.');
    }
    updateSession(session, updated, 'Sessão atualizada.');
  });
}

function editPayment(index, entry, payment) {
  const available = entry.balance + payment.amount;
  dialog('Editar recebimento', `<p>${patientName(entry.patientId)}</p>
    ${amountField('Valor recebido (R$)', payment.amount / 100, available / 100)}
    <label>Data do recebimento<input type="date" name="date" value="${esc(payment.date)}" max="${today()}" required></label>`, form => {
    const amount = cents(form, 'amount');
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > available) throw new Error('Informe um valor até o saldo da cobrança.');
    change(next => Object.assign(next.payments[index], { amount, date: formValue(form, 'date') }), 'Recebimento atualizado.');
  });
}

function editCycle(entry) {
  const rule = data.reminders[entry.id];
  dialog('Editar ciclo', `<p>${patientName(entry.patientId)} · Ciclo ${entry.number}</p>
    ${amountField('Valor do ciclo (R$)', entry.amount / 100)}
    <label>Vencimento ajustado<input type="date" name="date" value="${esc(rule?.date)}"></label>
    <p class="hint">Deixe o vencimento vazio para seguir a primeira sessão do ciclo.</p>`, form => {
    const amount = cents(form, 'amount');
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount < entry.paid) throw new Error('O valor precisa cobrir o que já foi recebido.');
    change(next => {
      next.cycles ??= [];
      const saved = next.cycles.find(c => c.patientId === entry.patientId && c.number === entry.number);
      if (saved) saved.amount = amount;
      else next.cycles.push({ patientId: entry.patientId, number: entry.number, amount });
      const date = formValue(form, 'date');
      if (date || rule?.paused) next.reminders[entry.id] = { date, originalDue: rule?.originalDue || entry.due, paused: Boolean(rule?.paused) };
      else delete next.reminders[entry.id];
    }, 'Ciclo atualizado.');
  });
}

function confirmDelete(title, description, mutate, message) {
  dialog(title, `<p>${description}</p>`, () => change(mutate, message), 'Confirmar exclusão');
}

function reconcileDialog(reference, entries) {
  const open = entries.filter(e => e.mode === 'conexa' && e.month === reference && e.balance > 0);
  dialog('Conciliar repasse Conexa', `<p>${monthLabel(reference)} · Informe quanto entrou para cada sessão. Deixe vazio quando ainda não houver crédito.</p>
    <label>Data do crédito<input type="date" name="date" value="${today()}" max="${today()}" required></label>
    ${open.map(entry => `<label>${patientName(entry.patientId)} · ${dayLabel(data.sessions.find(s => s.id === entry.id).at.slice(0, 10))}
      · Saldo ${money(entry.balance)}<input name="${entry.id}" type="number" min="0.01" max="${entry.balance / 100}" step="0.01"></label>`).join('')}`, form => {
    const included = open.filter(entry => formValue(form, entry.id));
    if (!included.length) throw new Error('Informe o valor recebido de pelo menos uma sessão.');
    change(next => {
      for (const entry of included) addPayment(next, entry, cents(form, entry.id), formValue(form, 'date'));
    }, 'Repasse conciliado.');
  });
}

function navigate(destination) {
  view = destination;
  setAlerts(false);
  render();
  $('#title').focus();
}

function handle(action, value) {
  const entries = charges(data);
  const entry = entries.find(c => c.id === value);
  const session = data.sessions.find(s => s.id === value);
  switch (action) {
    case 'week':
      week = Number(value) ? shift(week, Number(value)) : weekStart(today());
      render();
      $('#title').focus();
      break;
    case 'hours': hoursDialog(); break;
    case 'google': googleDialog(); break;
    case 'book': bookDialog(value); break;
    case 'rebook': bookDialog(session.at, session); break;
    case 'patient': patientDialog(patient(value)); break;
    case 'delete-patient': {
      const sessions = new Set(data.sessions.filter(s => s.patientId === value).map(s => s.id));
      const relatedCharge = chargeId => sessions.has(chargeId) || chargeId.startsWith(value + '-ciclo-');
      const payments = data.payments.filter(p => relatedCharge(p.chargeId)).length;
      confirmDelete('Excluir paciente',
        `${patientName(value)} será excluído junto com ${sessions.size} atendimento(s), ${payments} recebimento(s) e as cobranças vinculadas. Os indicadores serão recalculados.`,
        next => {
          next.patients = next.patients.filter(p => p.id !== value);
          next.sessions = next.sessions.filter(s => !sessions.has(s.id));
          next.payments = next.payments.filter(p => !relatedCharge(p.chargeId));
          if (next.cycles) next.cycles = next.cycles.filter(c => c.patientId !== value);
          if (next.absences) next.absences = next.absences.filter(a => !sessions.has(a.sessionId));
          for (const chargeId of Object.keys(next.reminders)) if (relatedCharge(chargeId)) delete next.reminders[chargeId];
        }, 'Paciente e registros vinculados excluídos.');
      break;
    }
    case 'session': sessionDialog(session); break;
    case 'edit-session': editSession(session); break;
    case 'delete-session':
      confirmDelete('Excluir sessão',
        'A sessão será removida da agenda. A cobrança avulsa ou o repasse vinculado será removido, e a contagem do ciclo será recalculada.',
        next => {
          next.sessions = next.sessions.filter(s => s.id !== value);
          if (next.absences) next.absences = next.absences.filter(a => a.sessionId !== value);
          delete next.reminders[value];
          preservePayments(data, next);
        }, 'Sessão excluída.');
      break;
    case 'complete': completionDialog(session); break;
    case 'cancel-session': cancellationDialog(session); break;
    case 'absent':
      if (session.at > localStamp()) throw new Error('A sessão ainda não começou.');
      updateSession(session, { absent: true, status: 'decidir' }, 'Falta registrada. Decida se a sessão será preservada.');
      break;
    case 'lost': updateSession(session, { status: 'perdida' }, 'Sessão marcada como perdida.'); break;
    case 'preserve': updateSession(session, { status: 'remarcar' }, 'Sessão disponível para remarcação.'); break;
    case 'pay': paymentDialog(entry); break;
    case 'edit-cycle': editCycle(entry); break;
    case 'clear-reminder':
      confirmDelete('Limpar ajuste do aviso', 'O alerta voltará a seguir o vencimento da cobrança.',
        next => { delete next.reminders[value]; }, 'Ajuste removido.');
      break;
    case 'edit-payment': {
      const payment = data.payments[Number(value)];
      const charge = entries.find(c => c.id === payment.chargeId);
      if (!charge) throw new Error('A cobrança original não está disponível.');
      editPayment(Number(value), charge, payment);
      break;
    }
    case 'delete-payment':
      confirmDelete('Excluir recebimento', 'O valor será retirado do caixa e o saldo da cobrança será recalculado.',
        next => { next.payments.splice(Number(value), 1); }, 'Recebimento excluído.');
      break;
    case 'finance': navigate('financeiro'); break;
    case 'patient-agenda': {
      const upcoming = data.sessions.filter(s => s.patientId === value && s.status === 'agendada' && s.at >= localStamp())
        .sort((a, b) => a.at.localeCompare(b.at))[0];
      week = weekStart(upcoming?.at.slice(0, 10) ?? today());
      navigate('agenda');
      if (upcoming) sessionDialog(upcoming);
      break;
    }
    case 'reconcile': reconcileDialog(value, entries); break;
    case 'defer':
      dialog('Prorrogar cobrança', `<p>${patientName(entry.patientId)} · ${money(entry.balance)}</p>
        <label>Nova data<input name="date" type="date" min="${shift(today(), 1)}" required></label>`, form => {
        change(next => {
          const originalDue = next.reminders[value]?.originalDue ?? entry.due;
          next.reminders[value] = { date: formValue(form, 'date'), originalDue, paused: false };
        }, 'Cobrança prorrogada.');
      });
      break;
    case 'pause':
    case 'resume':
      change(next => { next.reminders[value] = { ...next.reminders[value], paused: action === 'pause' }; },
        action === 'pause' ? 'Aviso suspenso. O saldo continua em aberto.' : 'Aviso reativado.');
      $('#alert-toggle').focus();
      break;
    case 'end':
      dialog('Encerrar acompanhamento', `<p>${patientName(value)}. O histórico e os saldos ficam disponíveis.</p>
        <label class="check"><input type="checkbox" name="cancel" checked> Cancelar sessões futuras e descartar remarcações pendentes</label>`, form => {
        change(next => {
          next.patients.find(p => p.id === value).active = false;
          for (const charge of entries.filter(c => c.patientId === value && c.mode !== 'conexa' && c.balance > 0 &&
            ((c.due && c.due <= today()) || c.paid > 0 || next.reminders[c.id]))) {
            next.reminders[charge.id] = { ...next.reminders[charge.id], paused: true };
            if (charge.mode === 'ciclo') {
              next.cycles ??= [];
              const saved = next.cycles.find(c => c.patientId === value && c.number === charge.number);
              if (saved) saved.due = charge.due;
              else next.cycles.push({ patientId: value, number: charge.number, amount: charge.amount, due: charge.due });
            }
          }
          if (formValue(form, 'cancel')) for (const item of next.sessions.filter(s => s.patientId === value)) {
            if (item.status === 'remarcar' || item.status === 'agendada' && item.at >= localStamp()) item.status = 'cancelada';
          }
        }, 'Acompanhamento encerrado.');
      }, 'Confirmar encerramento');
      break;
    case 'activate':
      change(next => { next.patients.find(p => p.id === value).active = true; }, 'Paciente reativado.');
      break;
    case 'conexa-day':
      dialog('Conferência de repasses', `<label>Dia do mês seguinte<input name="day" type="number" min="1" max="15" value="${data.conexaDay}" required></label>`,
        form => change(next => { next.conexaDay = Number(formValue(form, 'day')); }, 'Dia de conferência salvo.'));
      break;
    case 'close-dialog': $('#dialog').close(); break;
  }
}

$('#alert-toggle').addEventListener('click', () => setAlerts($('#alert-panel').hidden));
document.addEventListener('click', async event => {
  if (!event.target.closest('.alerts, dialog')) setAlerts(false);
  const navigation = event.target.closest('[data-view]');
  if (navigation) navigate(navigation.dataset.view);
  const button = event.target.closest('[data-action]');
  if (button) {
    if (saving) return;
    try {
      const { action, id: value } = button.dataset;
      if (['sign-out', 'export', 'backups', 'import-local', 'backup-download', 'backup-restore', 'push-on', 'push-off'].includes(action)) {
        await accountAction(action, value);
      } else handle(action, value);
    }
    catch (error) {
      const target = $('#dialog').open ? $('#dialog .error') : $('#feedback');
      target.textContent = error.message;
    }
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#dialog').open && !$('#alert-panel').hidden) {
    setAlerts(false);
    $('#alert-toggle').focus();
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'finance-month' && event.target.value) {
    financeMonth = event.target.value;
    render();
    $('#finance-month').focus();
  }
  if (event.target.id === 'report-month' && event.target.value) {
    month = event.target.value;
    render();
    $('#report-month').focus();
  }
});
window.addEventListener('storage', event => {
  if (!cloudMode && event.key === key && !$('#dialog').open) {
    reload();
    render();
  }
});
window.addEventListener('focus', async () => {
  if (cloudMode) {
    if (!signedIn || saving || $('#dialog').open) return;
    const previous = revision;
    try {
      const row = await AgendaCloud.load();
      if (signedIn && !saving && !$('#dialog').open && revision === previous) {
        applyCloud(row);
        render();
      }
    } catch (error) {
      if (!AgendaCloud.hasSession()) showGate(error.message);
    }
  } else if (!$('#dialog').open) {
    reload();
    if (view === 'pendencias') render();
    else renderAlerts(pendingItems(charges(data)));
  }
});

if (cloudMode) {
  showGate();
  $('#login').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    $('#account-message').textContent = 'Entrando…';
    try { enter(await AgendaCloud.signIn(formValue(form, 'email'), formValue(form, 'password'))); }
    catch (error) { showGate(error.message); }
    finally {
      form.elements.password.value = '';
      button.disabled = false;
    }
  });
  if (AgendaCloud.hasSession()) AgendaCloud.load().then(enter).catch(error => showGate(error.message));
} else {
  reload();
  $('#account-nav').hidden = false;
  render();
}
