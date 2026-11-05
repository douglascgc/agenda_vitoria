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

  const model = { newData, modes, sum, cycleSlots, charges, addPayment, reminders };
  if (typeof module === 'object') module.exports = model;
  else root.AgendaModel = model;
})(globalThis);
