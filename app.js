'use strict';

const { modes, newData, sum, cycleSlots, charges, addPayment, reminders } = AgendaModel;
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
const nav = { agenda: 'Agenda da semana', pacientes: 'Pacientes', financeiro: 'Financeiro', indicadores: 'Indicadores' };
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

function reload() {
  snapshot = localStorage.getItem(key);
  data = snapshot ? JSON.parse(snapshot) : newData();
}

function change(mutate, message = '') {
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
  const returnFocus = $('#dialog').open && $('#dialog').contains(document.activeElement);
  if ($('#dialog').open) $('#dialog').close();
  render();
  if (returnFocus) $('#alert-panel').hidden ? $('#title').focus() : $('#alert-toggle').focus();
  $('#feedback').textContent = message;
}

function setAlerts(open) {
  $('#alert-panel').hidden = !open;
  $('#alert-toggle').setAttribute('aria-expanded', String(open));
}

function dialog(title, fields, submit, saveLabel = 'Salvar') {
  const box = $('#dialog');
  $('#dialog-body').innerHTML = `<form><h2>${title}</h2>${fields}<p class="error" role="alert"></p>
    <div class="actions">${btn('Voltar', 'close-dialog')} <button class="primary">${saveLabel}</button></div></form>`;
  $('#dialog-body form').onsubmit = event => {
    event.preventDefault();
    try { submit(event.currentTarget); }
    catch (error) { event.currentTarget.querySelector('.error').textContent = error.message; }
  };
  if (!box.open) box.showModal();
}

function renderAlerts(entries) {
  const items = reminders(data, entries, today());
  const counter = $('#alert-count');
  counter.hidden = items.length === 0;
  counter.textContent = items.length;
  counter.setAttribute('aria-label', items.length + ' pendentes');
  $('#alert-list').innerHTML = items.map(item => {
    if (item.type === 'cycle') return `<article class="card"><h3>Ciclo perto do fim</h3>
      <p>${esc(item.patient.name)} · Resta 1 sessão</p><p>Próximo vencimento: ${dayLabel(item.next)}</p></article>`;
    if (item.type === 'conexa') return `<article class="card"><h3>Conferir repasse Conexa</h3>
      <p>${monthLabel(item.month)} · ${money(item.balance)} em aberto</p>
      <div class="actions">${btn('Ver repasse', 'finance')}</div></article>`;
    if (item.type === 'session') return `<article class="card"><h3>${statusLabel[item.session.status]}</h3>
      <p>${patientName(item.session.patientId)} · ${dayLabel(item.session.at.slice(0, 10))}</p>
      <div class="actions">${btn('Resolver', 'session', item.session.id)}</div></article>`;
    const { charge } = item;
    return `<article class="card"><h3>Confirme o pagamento</h3>
      <p>${patientName(charge.patientId)} · ${money(charge.balance)}</p>
      <p>Vencimento: ${dayLabel(data.reminders[charge.id]?.date || charge.due)}</p>
      <div class="actions">${btn('Sim, recebi', 'pay', charge.id, 'primary')}</div>
      <details><summary>Ainda não recebi</summary><div class="actions">
      ${btn('Prorrogar cobrança', 'defer', charge.id)}${btn('Suspender aviso', 'pause', charge.id)}
      ${patient(charge.patientId)?.active ? btn('Encerrar acompanhamento', 'end', charge.patientId) : ''}
      </div></details></article>`;
  }).join('') || '<p>Nenhum alerta pendente.</p>';
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
        return `<div class="time"><span>${time}</span>${cards}${starts.includes(time) && !sessions.some(s => blocksTime(s) && overlaps(s.at, date + 'T' + time)) ?
          btn('Livre', 'book', date + 'T' + time, 'free') : ''}</div>`;
      }).join('') || '<p class="empty">Sem horários</p>'}</section>`;
  }).join('');
  return `<div class="toolbar">${btn('← Semana anterior', 'week', '-7')}${btn('Hoje', 'week', '0')}
    ${btn('Próxima semana →', 'week', '7')}<span class="spacer"></span>
    ${btn('Disponibilidade', 'hours')}${btn('+ Nova sessão', 'book', '', 'primary')}</div>
    <div class="week">${days}</div>`;
}

function patientsPage() {
  return `<div class="toolbar">${btn('+ Novo paciente', 'patient', '', 'primary')}</div>
    ${data.patients.map(p => `<article class="record"><div><h2>${esc(p.name)}</h2>
      <p>${modes[p.mode]}${p.mode === 'conexa' ? '' : ' · ' + money(p.amount)} · ${p.active ? 'Ativo' : 'Encerrado'}</p>
      ${p.contact ? '<p>' + esc(p.contact) + '</p>' : ''}</div><div class="actions">
      ${btn('Editar', 'patient', p.id)}${p.active ? btn('Encerrar acompanhamento', 'end', p.id) : btn('Reativar', 'activate', p.id)}
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
    ${entry.balance > 0 && rule?.paused ? btn('Reativar aviso', 'resume', entry.id) : ''}</div></article>`;
}

function finance(entries) {
  const particular = entries.filter(e => e.mode !== 'conexa').sort((a, b) =>
    Number(a.balance === 0) - Number(b.balance === 0) || (a.due || '9999').localeCompare(b.due || '9999'));
  const conexa = entries.filter(e => e.mode === 'conexa');
  const months = [...new Set(conexa.map(e => e.month))].sort().reverse();
  return `<div class="toolbar">${btn('Dia de conferência Conexa', 'conexa-day')}</div>
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
    ${[...data.payments].sort((a, b) => b.date.localeCompare(a.date)).map(payment => {
      const entry = entries.find(e => e.id === payment.chargeId);
      return `<div class="record"><span>${dayLabel(payment.date)} · ${patientName(entry?.patientId)} · ${modes[payment.mode]}</span><strong>${money(payment.amount)}</strong></div>`;
    }).join('') || '<p>Nenhum recebimento registrado.</p>'}`;
}

function indicators(entries) {
  const months = [...new Set([month, ...data.payments.map(p => p.date.slice(0, 7))])].sort().reverse().slice(0, 12);
  const selectedPayments = data.payments.filter(p => p.date.startsWith(month));
  const selectedSessions = data.sessions.filter(s => s.at.startsWith(month));
  const selectedCharges = entries.filter(e => e.month === month);
  const received = sum(selectedPayments, p => p.amount);
  const generated = sum(selectedCharges.filter(e => e.mode !== 'ciclo' || e.consumed > 0 || e.paid > 0), e => e.amount);
  const open = sum(entries, e => e.balance);
  const metric = (label, value) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
  const [year, number] = month.split('-').map(Number);
  const days = Array.from({ length: new Date(year, number, 0).getDate() }, (_, index) => shift(month + '-01', index));
  const available = days.flatMap(day => slotStarts(day).map(time => day + 'T' + time));
  const occupied = selectedSessions.filter(blocksTime);
  const occupancy = available.length ? Math.round(100 * available.filter(slot => occupied.some(s => overlaps(s.at, slot))).length / available.length) + '%' : 'A definir';
  const max = Math.max(1, ...months.map(value => sum(data.payments.filter(p => p.date.startsWith(value)), p => p.amount)));
  return `<div class="toolbar"><label>Mês de referência <input type="month" id="report-month" value="${month}"></label></div>
    <div class="metrics">${metric('Recebido no mês', money(received))}${metric('Gerado no mês', money(generated))}
      ${metric('Saldo em aberto · todos os meses', money(open))}${metric('Ocupação · horários atuais', occupancy)}
      ${metric('Realizadas', selectedSessions.filter(s => s.status === 'realizada').length)}
      ${metric('Faltas registradas', selectedSessions.filter(s => s.absent).length + (data.absences ?? []).filter(at => at.startsWith(month)).length)}
      ${metric('Canceladas ou em remarcação', selectedSessions.filter(s => ['cancelada', 'remarcar'].includes(s.status)).length)}</div>
    <h2 class="section-title">Recebido por mês</h2>
    ${months.map(value => {
      const payments = data.payments.filter(p => p.date.startsWith(value));
      const particular = sum(payments.filter(p => p.mode !== 'conexa'), p => p.amount);
      const conexa = sum(payments.filter(p => p.mode === 'conexa'), p => p.amount);
      return `<article class="record trend"><div><strong>${monthLabel(value)}</strong>
        <p>Particular ${money(particular)} · Conexa ${money(conexa)}</p></div>
        <div class="bar" aria-hidden="true"><span style="width:${100 * particular / max}%"></span><span style="width:${100 * conexa / max}%"></span></div>
        <strong>${money(particular + conexa)}</strong></article>`;
    }).join('')}`;
}

function render() {
  const entries = charges(data);
  $('#title').textContent = nav[view];
  $('#title').tabIndex = -1;
  $('#subtitle').textContent = view === 'agenda' ? dayLabel(week) + ' a ' + dayLabel(shift(week, 6)) : '';
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('selected', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#content').innerHTML = { agenda: schedule, pacientes: patientsPage, financeiro: finance, indicadores: indicators }[view](entries);
  renderAlerts(entries);
}

const localStamp = () => {
  const now = new Date();
  return today() + 'T' + now.toTimeString().slice(0, 5);
};
const blocksTime = session => ['agendada', 'realizada', 'perdida', 'decidir'].includes(session.status);
const overlaps = (a, b) => Math.abs(new Date(a) - new Date(b)) < 3600000;

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
    <p class="hint">Cada sessão reserva uma hora.</p>`, form => {
    const time = formValue(form, 'at');
    const number = existing ? 1 : Number(formValue(form, 'weeks'));
    const person = patient(existing?.patientId ?? formValue(form, 'patient'));
    const times = Array.from({ length: number }, (_, index) => shift(time.slice(0, 10), index * 7) + time.slice(10));
    if (times.some(start => data.sessions.some(s => s.id !== existing?.id && blocksTime(s) && overlaps(start, s.at)))) {
      throw new Error('Um dos horários se sobrepõe a outra sessão.');
    }
    change(next => {
      if (existing) {
        const previous = next.sessions.find(s => s.id === existing.id);
        if (previous.absent) next.absences = [...(next.absences ?? []), previous.at];
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
  change(next => Object.assign(next.sessions.find(s => s.id === session.id), changes), message);
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
    <p>${dayLabel(session.at.slice(0, 10))} às ${session.at.slice(11)} · ${statusLabel[session.status]}</p>
    <div class="actions">${actions.join('')}</div>`, () => $('#dialog').close(), 'Fechar');
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
    case 'book': bookDialog(value); break;
    case 'rebook': bookDialog(session.at, session); break;
    case 'patient': patientDialog(patient(value)); break;
    case 'session': sessionDialog(session); break;
    case 'complete': completionDialog(session); break;
    case 'cancel-session': cancellationDialog(session); break;
    case 'absent':
      if (session.at > localStamp()) throw new Error('A sessão ainda não começou.');
      updateSession(session, { absent: true, status: 'decidir' }, 'Falta registrada. Decida se a sessão será preservada.');
      break;
    case 'lost': updateSession(session, { status: 'perdida' }, 'Sessão marcada como perdida.'); break;
    case 'preserve': updateSession(session, { status: 'remarcar' }, 'Sessão disponível para remarcação.'); break;
    case 'pay': paymentDialog(entry); break;
    case 'finance': navigate('financeiro'); break;
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
document.addEventListener('click', event => {
  if (!event.target.closest('.alerts, dialog')) setAlerts(false);
  const navigation = event.target.closest('[data-view]');
  if (navigation) navigate(navigation.dataset.view);
  const button = event.target.closest('[data-action]');
  if (button) {
    try { handle(button.dataset.action, button.dataset.id); }
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
  if (event.target.id === 'report-month' && event.target.value) {
    month = event.target.value;
    render();
    $('#report-month').focus();
  }
});
window.addEventListener('storage', event => {
  if (event.key === key && !$('#dialog').open) {
    reload();
    render();
  }
});
window.addEventListener('focus', () => {
  if (!$('#dialog').open) {
    reload();
    renderAlerts(charges(data));
  }
});
reload();
render();
