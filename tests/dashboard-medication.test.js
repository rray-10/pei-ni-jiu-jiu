const {test} = require('node:test');
const assert = require('node:assert/strict');
const {medicationSummary} = require('../backend/dashboard.js');

test('应吃 counts only slots with active medication; taken only counts there', () => {
  const activeMeds = [{times: '早餐後、睡前'}, {times: '早餐後'}];
  const logs = [
    {log_date: '2026-11-27', slot: '早餐後', status: 'taken'},
    {log_date: '2026-11-27', slot: '睡前', status: 'cancelled'},
    {log_date: '2026-11-27', slot: '午餐後', status: 'taken'},   // LINE punch, no medication at lunch: shown, not counted
    {log_date: '2026-11-26', slot: '早餐後', status: 'taken'},
    {log_date: '2026-11-26', slot: '睡前', status: 'taken'}
  ];
  const m = medicationSummary({activeMeds, logs, days: 3, today: '2026-11-27'});
  assert.deepEqual(m.slots, ['早餐後', '睡前']);
  assert.deepEqual(m.allSlots, ['早餐後', '午餐後', '晚餐後', '睡前']);
  assert.deepEqual([m.taken, m.total, m.rate], [3, 6, 50]);
  assert.deepEqual(m.rows[0].slots.map(s => [s.status, s.counted]),
    [['taken', true], ['taken', false], ['none', false], ['cancelled', true]]);
});

test('no medication: rate is null, punches still listed in four columns', () => {
  const logs = [{log_date: '2026-11-27', slot: '睡前', status: 'taken'}];
  const m = medicationSummary({activeMeds: [], logs, days: 7, today: '2026-11-27'});
  assert.deepEqual([m.taken, m.total, m.rate, m.slots], [0, 0, null, []]);
  assert.equal(m.rows[0].slots[3].status, 'taken');
  assert.equal(m.rows[0].slots[3].counted, false);
});
