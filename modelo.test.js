'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newData, charges, addPayment, reminders } = require('./modelo');

function scenario() {
  const data = newData();
  data.patients.push({ id: 'p', name: 'Exemplo', mode: 'ciclo', amount: 40000, active: true });
  return data;
}

function session(data, date, status, mode = 'ciclo', amount = 40000) {
  data.sessions.push({ id: 's' + data.sessions.length, patientId: 'p', at: date + 'T10:00', mode, status, amount });
}

test('quinta sessão abre outro ciclo, inclusive na virada do mês', () => {
  const data = scenario();
  for (const day of ['03', '10', '17']) session(data, '2026-11-' + day, 'realizada');
  session(data, '2026-11-24', 'agendada');
  session(data, '2026-12-01', 'agendada');
  const entries = charges(data);
  assert.deepEqual(entries.map(c => [c.due, c.consumed]), [['2026-11-03', 3], ['2026-12-01', 0]]);
  assert.equal(reminders(data, entries, '2026-11-17').find(item => item.type === 'cycle').next, '2026-12-01');
});

test('remarcações e faltas a decidir preservam o saldo do ciclo', () => {
  const data = scenario();
  for (const day of ['03', '10', '17']) session(data, '2026-11-' + day, 'realizada');
  session(data, '2026-11-24', 'decidir');
  assert.equal(charges(data)[0].consumed, 3);
  data.sessions[3].status = 'remarcar';
  assert.equal(charges(data)[0].consumed, 3);
  data.sessions[3].status = 'perdida';
  assert.equal(charges(data)[0].consumed, 4);
});

test('saldo parcial permanece, suspensão só remove aviso e prorrogação tem data', () => {
  const data = scenario();
  session(data, '2026-11-03', 'agendada');
  const charge = charges(data)[0];
  addPayment(data, charge, 15000, '2026-11-03');
  let entries = charges(data);
  assert.equal(entries[0].balance, 25000);
  data.reminders[charge.id] = { date: '2026-11-10', paused: false };
  assert.equal(reminders(data, entries, '2026-11-09').length, 0);
  assert.equal(reminders(data, entries, '2026-11-10').length, 1);
  data.reminders[charge.id].paused = true;
  assert.equal(reminders(data, entries, '2026-11-10').length, 0);
  assert.throws(() => addPayment(data, entries[0], 25001, '2026-11-10'));
  data.sessions[0].status = 'cancelada';
  entries = charges(data);
  assert.equal(entries[0].balance, 25000);
});

test('Conexa agrupa a competência de dezembro e registra o caixa em janeiro', () => {
  const data = scenario();
  session(data, '2026-12-01', 'realizada', 'conexa', 5500);
  session(data, '2026-12-10', 'realizada', 'conexa', 6000);
  let entries = charges(data);
  assert.equal(entries[0].due, '2027-01-05');
  assert.equal(reminders(data, entries, '2027-01-04').length, 0);
  assert.deepEqual(reminders(data, entries, '2027-01-05'), [{ type: 'conexa', month: '2026-12', balance: 11500 }]);
  addPayment(data, entries[0], 5500, '2027-01-05');
  entries = charges(data);
  assert.equal(entries[0].month, '2026-12');
  assert.equal(data.payments[0].date, '2027-01-05');
  assert.equal(reminders(data, entries, '2027-01-05')[0].balance, 6000);
});
