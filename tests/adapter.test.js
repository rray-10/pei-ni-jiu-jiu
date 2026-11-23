const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../adapters/health-adapter.js');

test('血壓 132/84 解析', () => {
  assert.deepEqual(A.parseBloodPressure('132/84'), { ok: true, systolic: 132, diastolic: 84 });
  assert.equal(A.parseBloodPressure(' 120 ／ 80 ').ok, true);
});
test('血壓異常值與格式錯誤', () => {
  assert.equal(A.parseBloodPressure('162/300').reason, 'out_of_range');
  assert.equal(A.parseBloodPressure('80/120').reason, 'out_of_range'); // 收縮壓需大於舒張壓
  assert.equal(A.parseBloodPressure('abc').reason, 'format');
  assert.equal(A.parseBloodPressure('').reason, 'format');
});
test('血糖數值與單位預設 mg/dL', () => {
  assert.equal(A.parseNumber('110', 'blood_glucose').value, 110);
  assert.equal(A.parseNumber('8455', 'blood_glucose').reason, 'out_of_range');
  const r = A.normalizeDailyRecord({ recordId: 'x', familyId: 'F', recordedAt: '2026-11-22T10:00:00.000Z', metricKey: 'blood_glucose', value: '70', unit: '' });
  assert.equal(r.unit, 'mg/dL'); assert.ok(r.quality.includes('unit_defaulted'));
});
test('用藥：TRUE/FALSE 與 JSON 兩種格式', () => {
  assert.deepEqual(A.parseMedication('TRUE'), { ok: true, taken: 1, total: 1 });
  assert.deepEqual(A.parseMedication(false), { ok: true, taken: 0, total: 1 });
  assert.deepEqual(A.parseMedication('{"morning":true,"noon":false,"evening":true,"bedtime":true}'), { ok: true, taken: 3, total: 4 });
  assert.equal(A.parseMedication('yes').ok, false);
});
test('時區：UTC 轉台北日期；缺 recordDate 時由 recordedAt 推導', () => {
  assert.equal(A.taipeiDate('2026-11-22T16:30:00.000Z'), '2026-11-23');
  const r = A.normalizeDailyRecord({ recordId: 'x', familyId: 'F', recordedAt: '2026-11-22T16:30:00.000Z', metricKey: 'temperature', value: '36.5' });
  assert.equal(r.recordDate, '2026-11-23');
});
test('打卡時段規則（規格 F2，含跨日）', () => {
  assert.deepEqual(A.periodForTaipei('2026-11-23T18:00:00Z'), { date: '2026-11-23', period: 'bedtime' }.date ? A.periodForTaipei('2026-11-23T18:00:00Z') : null);
  // 11/24 02:00 台北 = 11/23 18:00Z → 記入 11/23 睡前
  assert.deepEqual(A.periodForTaipei('2026-11-23T18:00:00Z'), { date: '2026-11-23', period: 'bedtime' });
  assert.deepEqual(A.periodForTaipei('2026-11-23T21:00:00Z'), { date: '2026-11-24', period: 'breakfast' }); // 05:00
  assert.deepEqual(A.periodForTaipei('2026-11-23T20:59:00Z').period, 'bedtime');                          // 04:59
  assert.equal(A.periodForTaipei('2026-11-24T03:00:00Z').period, 'lunch');                                // 11:00
  assert.equal(A.periodForTaipei('2026-11-24T09:00:00Z').period, 'dinner');                               // 17:00
  assert.equal(A.periodForTaipei('2026-11-24T13:00:00Z').period, 'bedtime');                              // 21:00
});
test('去重：同家庭+日期+時段+metric 後寫入者勝；無 period 者不被誤合併', () => {
  const mk = (id, createdAt, v, period) => A.normalizeDailyRecord({ recordId: id, familyId: 'F', recordedAt: createdAt, createdAt, recordDate: '2026-11-22', period, metricKey: 'blood_glucose', value: v });
  const out = A.dedupe([mk('1', '2026-11-22T05:00:00Z', '100', 'noon'), mk('2', '2026-11-22T05:30:00Z', '105', 'noon'), mk('3', '2026-11-22T06:00:00Z', '90', ''), mk('4', '2026-11-22T07:00:00Z', '91', '')]);
  assert.equal(out.length, 3);
  assert.equal(out.find(r => r.period === 'noon').value, 105);
});
test('回診：取消不算即將回診；過去不算；排序', () => {
  const now = '2026-11-23T04:00:00Z';
  const rows = [
    { appt_id: 'a', patient_id: 'p', date: '2026-12-23', status: 'scheduled' },
    { appt_id: 'b', patient_id: 'p', date: '2026-11-27', status: 'cancelled' },
    { appt_id: 'c', patient_id: 'p', date: '2026-11-22', status: 'scheduled' },
    { appt_id: 'd', patient_id: 'p', date: '2026-11-23', status: 'scheduled' }
  ].map(A.normalizeAppointment);
  assert.deepEqual(A.upcomingAppointments(rows, now).map(a => a.appointmentId), ['d', 'a']);
});
