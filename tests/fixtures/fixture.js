// 全部為虛構資料（結構仿 F1 DailyRecords / 回診 appointments）。UID 為假值。
const NOW = '2026-11-23T04:00:00.000Z'; // 台北 2026-11-23 12:00

const families = [
  { familyId: 'F_TEST_A', patientName: '測試阿嬤' },
  { familyId: 'F_TEST_B', patientName: '測試爺爺' }
];
const members = [
  { familyId: 'F_TEST_A', lineUid: 'U_TEST_A1', role: 'admin' },
  { familyId: 'F_TEST_A', lineUid: 'U_TEST_A2', role: 'member' },
  { familyId: 'F_TEST_B', lineUid: 'U_TEST_B1', role: 'admin' }
];
const familyPatients = [{ familyId: 'F_TEST_B', patientId: 'p_b' }]; // A 未設定 → 預設 pt_F_TEST_A

let n = 0;
const rec = (o) => Object.assign({
  recordId: 'r' + (++n), familyId: 'F_TEST_A', lineUid: 'U_TEST_A1', recordedAt: '2026-11-22T10:00:00.000Z',
  metricKey: 'blood_pressure', metricName: '血壓', value: '132/84', unit: 'mmHg', note: '', source: 'LIFF',
  createdAt: '2026-11-22T10:00:00.000Z', createdBy: 'U_TEST_A1', route: 'record_write', recordDate: '2026-11-22', period: 'morning', isRecorded: ''
}, o);

const dailyRecords = [
  rec({}),                                                                                   // 132/84 正常
  rec({ metricKey: 'blood_glucose', metricName: '血糖', value: '110', unit: 'mg/dL' }),
  rec({ metricKey: 'blood_glucose', metricName: '血糖', value: '8455', unit: 'mg/dL', period: 'evening' }), // 異常
  rec({ metricKey: 'blood_pressure', value: '162/300', period: 'evening' }),                  // 異常
  rec({ metricKey: 'blood_pressure', value: '124/78', recordedAt: '2026-11-23T01:00:00.000Z', createdAt: '2026-11-23T01:00:00.000Z', recordDate: '', period: '' }), // 無 recordDate/period；台北 11-23
  rec({ metricKey: 'medication', metricName: '用藥打卡', value: 'TRUE', unit: '' }),
  rec({ metricKey: 'medication', metricName: '用藥打卡', value: 'FALSE', unit: '', period: 'evening' }),
  rec({ metricKey: 'medication', metricName: '用藥打卡', value: '{"morning":true,"noon":false,"evening":true,"bedtime":true}', unit: '', recordedAt: '2026-11-21T10:00:00.000Z', recordDate: '', period: '' }),
  rec({ metricKey: 'temperature', metricName: '體溫', value: '36.8', unit: '°C' }),
  rec({ source: 'TEST', value: '150/95', period: 'morning', recordedAt: '2026-11-22T11:00:00.000Z' }),        // 測試資料排除
  // 重複：同家庭+日期+時段+metric，後寫入者勝
  rec({ metricKey: 'blood_glucose', value: '100', unit: 'mg/dL', period: 'noon', createdAt: '2026-11-22T05:00:00.000Z', recordedAt: '2026-11-22T05:00:00.000Z' }),
  rec({ metricKey: 'blood_glucose', value: '105', unit: 'mg/dL', period: 'noon', createdAt: '2026-11-22T05:30:00.000Z', recordedAt: '2026-11-22T05:30:00.000Z' }),
  // 另一個家庭
  rec({ familyId: 'F_TEST_B', lineUid: 'U_TEST_B1', value: '150/90' }),
  // 超出 90 天窗口
  rec({ recordedAt: '2026-06-01T10:00:00.000Z', recordDate: '2026-06-01', value: '140/90' })
];

const appointments = [
  { appt_id: 'A1', patient_id: 'pt_F_TEST_A', date: '2026-11-29', session: '12:00', hospital: '榮總', department: '心臟內科', status: 'scheduled' },
  { appt_id: 'A2', patient_id: 'pt_F_TEST_A', date: '2026-11-27', session: '早診', hospital: '榮總', department: '眼科', status: 'cancelled' },
  { appt_id: 'A3', patient_id: 'pt_F_TEST_A', date: '2026-11-22', session: '午診', hospital: '長庚', department: '腎臟科', status: 'scheduled' }, // 已過
  { appt_id: 'A4', patient_id: 'p_b', date: '2026-12-01', session: '晚診', hospital: '台大', department: '牙醫科', status: 'scheduled' }
];

const src = () => structuredClone({ families, members, familyPatients, dailyRecords, appointments });
module.exports = { NOW, src, rec };
