const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../adapters/dashboard-service.js');
const { NOW, src, rec } = require('./fixtures/fixture.js');

const dash = (uid, days = 7, pid) => S.getDashboardData(src(), uid, pid, days, NOW);
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('#1 已加入家庭者可讀自己的資料', () => {
  const d = dash('U_TEST_A1');
  assert.equal(d.familyId, 'F_TEST_A');
  assert.equal(d.patient.name, '測試阿嬤');
  assert.ok(d.bp.length > 0);
});
test('#1b 同家庭第二位成員讀到同一份資料', () => {
  assert.deepEqual(dash('U_TEST_A2').bp, dash('U_TEST_A1').bp);
});
test('#2 未加入家庭／未驗證身分無法讀取', () => {
  assert.equal(code(() => dash('U_TEST_STRANGER')), 'NOT_MEMBER');
  assert.equal(code(() => dash('')), 'UNAUTHENTICATED');
  assert.equal(code(() => dash(undefined)), 'UNAUTHENTICATED');
  assert.equal(code(() => S.getSessionContext(src(), 'U_TEST_STRANGER')), 'NOT_MEMBER');
});
test('#3 不同家庭資料隔離（含前端偽造 patientId）', () => {
  const a = dash('U_TEST_A1'), b = dash('U_TEST_B1');
  assert.equal(b.patient.name, '測試爺爺');
  assert.equal(b.latestBP.systolic, 150);
  assert.notEqual(a.latestBP.systolic, 150);
  assert.equal(code(() => dash('U_TEST_A1', 7, 'p_b')), 'FORBIDDEN');          // A 想讀 B 的患者
  assert.equal(code(() => dash('U_TEST_A1', 7, 'pt_F_TEST_B')), 'FORBIDDEN');
  assert.equal(b.nextAppointment.department, '牙醫科');                        // B 只看到自己的回診
  assert.notEqual(a.nextAppointment.department, '牙醫科');
});
test('#3b 不得以輸入的 familyId 覆蓋授權（即使 src 裡有別家資料）', () => {
  const d = dash('U_TEST_A1', 90);
  assert.ok(d.bp.every(x => x.systolic !== 150));
});
test('#4 新增每日紀錄後儀表板顯示最新資料', () => {
  const s = src();
  s.dailyRecords.push(rec({ recordId: 'new1', value: '118/76', recordedAt: '2026-11-23T03:00:00.000Z', createdAt: '2026-11-23T03:00:00.000Z', recordDate: '2026-11-23', period: 'morning' }));
  const d = S.getDashboardData(s, 'U_TEST_A1', null, 7, NOW);
  assert.deepEqual([d.latestBP.systolic, d.latestBP.diastolic], [118, 76]);
});
test('#5 血壓正確解析與平均；異常值與測試資料被排除', () => {
  const d = dash('U_TEST_A1');
  // 有效：132/84（11-22）、124/78（11-23，無 recordDate）；162/300 與 TEST 150/95 排除
  assert.equal(d.bp.length, 2);
  assert.deepEqual(d.bpAverage, { sys: 128, dia: 81 });
  assert.equal(d.quality.excludedTest >= 1, true);
  assert.equal(d.quality.excludedInvalid >= 2, true);
  assert.deepEqual([d.latestBP.systolic, d.latestBP.diastolic], [124, 78]);
});
test('#6 血糖單位與去重（8455 排除；100/105 同時段取後者）', () => {
  const d = dash('U_TEST_A1');
  assert.deepEqual(d.glucose.map(g => g.value).sort(), [105, 110]);
  assert.ok(d.glucose.every(g => g.unit === 'mg/dL'));
  assert.equal(d.glucoseAverage, 108); // round(107.5)
});
test('#5b 日期窗口：7 天排除舊資料、90 天仍排除 6 月資料', () => {
  assert.equal(dash('U_TEST_A1', 7).bp.some(x => x.measured_at.startsWith('2026-06')), false);
  assert.equal(dash('U_TEST_A1', 90).bp.some(x => x.measured_at.startsWith('2026-06')), false); // 6/1 距 11/23 > 90 天
});
test('#7 新增回診後顯示正確日期；#8 取消／過期不再顯示', () => {
  let d = dash('U_TEST_A1');
  assert.equal(d.nextAppointment.date, '2026-11-29');
  const s = src();
  s.appointments.push({ appt_id: 'A9', patient_id: 'pt_F_TEST_A', date: '2026-11-25', session: '14:00', hospital: '台大', department: '家醫科', status: 'scheduled' });
  d = S.getDashboardData(s, 'U_TEST_A1', null, 7, NOW);
  assert.equal(d.nextAppointment.date, '2026-11-25');
  s.appointments.find(a => a.appt_id === 'A9').status = 'cancelled';
  d = S.getDashboardData(s, 'U_TEST_A1', null, 7, NOW);
  assert.equal(d.nextAppointment.date, '2026-11-29'); // 取消後回到下一筆
  s.appointments.find(a => a.appt_id === 'A1').status = 'cancelled';
  d = S.getDashboardData(s, 'U_TEST_A1', null, 7, NOW);
  assert.equal(d.nextAppointment, null);              // A2 已取消、A3 已過期 → 無
});
test('用藥回報率：TRUE/FALSE 與 JSON 混合', () => {
  const d = dash('U_TEST_A1', 7);
  // TRUE(1/1) + FALSE(0/1) ；JSON 該筆為 11-21 → 7 天窗口內(11-17..11-23)：3/4
  assert.deepEqual(d.medication, { taken: 4, total: 6, rate: 67 });
});
test('空資料：家庭無紀錄 → 空陣列與 null，不拋錯', () => {
  const s = src(); s.dailyRecords = []; s.appointments = [];
  const d = S.getDashboardData(s, 'U_TEST_A1', null, 30, NOW);
  assert.deepEqual([d.bp, d.glucose, d.latestBP, d.bpAverage.sys, d.medication.rate, d.nextAppointment], [[], [], null, null, null, null]);
});
test('期間參數驗證與多家庭資料異常', () => {
  assert.equal(code(() => dash('U_TEST_A1', 14)), 'BAD_REQUEST');
  const s = src(); s.members.push({ familyId: 'F_TEST_B', lineUid: 'U_TEST_A1', role: 'member' });
  assert.equal(code(() => S.getSessionContext(s, 'U_TEST_A1')), 'DATA_INTEGRITY');
});
test('輸出不含 lineUid / createdBy', () => {
  const json = JSON.stringify(dash('U_TEST_A1', 90));
  assert.equal(/U_TEST_/.test(json), false);
});
