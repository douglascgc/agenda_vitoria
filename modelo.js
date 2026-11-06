(function (root) {
  'use strict';
  const consuming = ['realizada', 'perdida'];
  const modes = { sessao: 'Particular por sessão', ciclo: 'Particular · 4 sessões', conexa: 'Conexa' };
  const newData = () => ({ patients: [], sessions: [], hours: [], payments: [], reminders: {}, conexaDay: 5 });
  const sum = (items, value) => items.reduce((total, item) => total + value(item), 0);

  function nextMonth(month) {
    const [year, number] = month.split('-').map(Number);
    return number === 12 ? (year + 1) + '-01' : year + '-' + String(number + 1).padStart(2, '0');
  }

  function cycleSlots(sessions, patientId) {
    return sessions.filter(s => s.patientId === patientId && s.mode === 'ciclo' &&
      (consuming.includes(s.status) || ['agendada', 'decidir', 'remarcar'].includes(s.status)))
      .sort((a, b) => {
        const rank = s => consuming.includes(s.status) ? 0 : s.status === 'agendada' ? 2 : 1;
        return rank(a) - rank(b) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
      });
  }

  function charges(data) {
    const entries = data.sessions.filter(s => s.mode !== 'ciclo' &&
      (s.status === 'realizada' || s.status === 'perdida' && s.mode === 'sessao'))
      .map(s => ({ id: s.id, patientId: s.patientId, mode: s.mode, amount: s.amount,
        due: s.mode === 'conexa'
          ? nextMonth(s.at.slice(0, 7)) + '-' + String(data.conexaDay).padStart(2, '0')
          : s.at.slice(0, 10), month: s.at.slice(0, 7) }));
    for (const patient of data.patients) {
      const slots = cycleSlots(data.sessions, patient.id);
      const recorded = data.cycles?.filter(c => c.patientId === patient.id) ?? [];
      const count = Math.max(Math.ceil(slots.length / 4), ...recorded.map(c => c.number), 0);
      for (let index = 0; index < count; index++) {
        const group = slots.slice(index * 4, index * 4 + 4);
        const first = group[0];
        const saved = recorded.find(c => c.number === index + 1);
        const due = first && !['decidir', 'remarcar'].includes(first.status) ? first.at.slice(0, 10) : saved?.due ?? '';
        entries.push({ id: patient.id + '-ciclo-' + (index + 1), patientId: patient.id, mode: 'ciclo',
          amount: saved?.amount ?? first?.amount ?? patient.amount, due, month: due.slice(0, 7),
          number: index + 1, consumed: group.filter(s => consuming.includes(s.status)).length });
      }
    }
    return entries.map(entry => {
      const paid = sum(data.payments.filter(p => p.chargeId === entry.id), p => p.amount);
      return { ...entry, paid, balance: entry.amount - paid };
    });
  }

  function addPayment(data, charge, amount, date) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > charge.balance || !date) {
      throw new Error('Informe um valor positivo até o saldo em aberto e a data do recebimento.');
    }
    if (charge.mode === 'ciclo') {
      data.cycles ??= [];
      if (!data.cycles.some(c => c.patientId === charge.patientId && c.number === charge.number)) {
        data.cycles.push({ patientId: charge.patientId, number: charge.number, amount: charge.amount });
      }
    }
    data.payments.push({ chargeId: charge.id, mode: charge.mode, amount, date });
  }

  function reminders(data, entries, today) {
    const list = [];
    const byMonth = new Map();
    for (const charge of entries) {
      if (charge.balance <= 0) continue;
      if (charge.mode === 'conexa') {
        if (charge.due <= today) byMonth.set(charge.month, (byMonth.get(charge.month) ?? 0) + charge.balance);
        continue;
      }
      const rule = data.reminders[charge.id];
      const due = rule?.date || charge.due;
      if (due && due <= today && !rule?.paused) list.push({ type: 'payment', charge });
    }
    for (const [month, balance] of byMonth) list.push({ type: 'conexa', month, balance });
    for (const patient of data.patients.filter(p => p.active)) {
      const cycle = entries.find(c => c.patientId === patient.id && c.mode === 'ciclo' && c.consumed === 3);
      if (cycle) list.push({ type: 'cycle', patient, next: entries.find(c => c.patientId === patient.id &&
        c.mode === 'ciclo' && c.number === cycle.number + 1)?.due });
    }
    for (const session of data.sessions.filter(s => ['decidir', 'remarcar'].includes(s.status))) {
      if (session.status === 'decidir' || data.patients.some(p => p.id === session.patientId && p.active)) {
        list.push({ type: 'session', session });
      }
    }
    return list;
  }

  function validateBackup(value) {
    const date = text => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text);
    const time = text => typeof text === 'string' && /^\d{2}:\d{2}$/.test(text);
    const stamp = text => typeof text === 'string' && date(text.slice(0, 10)) &&
      text[10] === 'T' && time(text.slice(11));
    const id = text => typeof text === 'string' && /^[a-f0-9-]{9,100}$/i.test(text);
    const amount = n => Number.isSafeInteger(n) && n >= 0;
    const mode = name => Object.hasOwn(modes, name);
    const list = (records, valid) => Array.isArray(records) && records.every(record => record && valid(record));
    const object = item => item && typeof item === 'object' && !Array.isArray(item);
    if (!(object(value) &&
      list(value.patients, p => id(p.id) && typeof p.name === 'string' && typeof p.contact === 'string' &&
        typeof p.active === 'boolean' && mode(p.mode) && amount(p.amount)) &&
      list(value.sessions, s => id(s.id) && id(s.patientId) && stamp(s.at) && mode(s.mode) && amount(s.amount) &&
        ['agendada', 'realizada', 'perdida', 'cancelada', 'decidir', 'remarcar'].includes(s.status)) &&
      list(value.hours, h => Number.isInteger(h.day) && h.day >= 0 && h.day < 7 && time(h.start) && time(h.end)) &&
      list(value.payments, p => typeof p.chargeId === 'string' && mode(p.mode) && amount(p.amount) && date(p.date)) &&
      list(value.cycles ?? [], c => id(c.patientId) && Number.isInteger(c.number) && c.number > 0 &&
        c.number <= value.sessions.length + 1 && amount(c.amount) && (!c.due || date(c.due))) &&
      list(value.absences ?? [], stamp) && object(value.reminders) &&
      Object.values(value.reminders).every(r => object(r) && typeof r.paused === 'boolean' &&
        (!r.date || date(r.date)) && (!r.originalDue || date(r.originalDue))) &&
      Number.isInteger(value.conexaDay) && value.conexaDay >= 1 && value.conexaDay <= 15)) {
      throw new Error('O arquivo não é uma cópia válida da Agenda Vitória.');
    }
    const { patients, sessions, hours, payments, reminders, conexaDay, cycles, absences } = value;
    return { patients, sessions, hours, payments, reminders, conexaDay, cycles, absences };
  }

  const model = { newData, modes, sum, cycleSlots, charges, addPayment, reminders, validateBackup };
  if (typeof module === 'object') module.exports = model;
  else root.AgendaModel = model;
})(globalThis);
