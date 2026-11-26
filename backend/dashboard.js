'use strict';
// Supabase 版儀表板：只讀登入者自己的家庭，轉成既有 DashboardService 認識的格式，計算邏輯沿用 adapters/。
const DashboardService = require('../adapters/dashboard-service.js');

const isoDate = d => d.toISOString().slice(0, 10);

function taipeiToday(nowMs) { return isoDate(new Date(nowMs + 8 * 3600000)); }

function legacyRecord(row) {
  return {
    recordId: row.record_id, familyId: row.family_id, patientId: row.patient_id || '',
    metricKey: row.metric_key, metricName: row.metric_name || '', value: row.value,
    valueNumeric: row.value_numeric ?? '', valueSystolic: row.value_systolic ?? '', valueDiastolic: row.value_diastolic ?? '',
    unit: row.unit || '', period: row.period || '', recordDate: row.record_date, recordedAt: row.recorded_at,
    createdAt: row.created_at, isRecorded: row.is_recorded ? 'TRUE' : 'FALSE', source: row.source || 'LIFF', note: row.note || ''
  };
}

// 讀取一個家庭的儀表板所需資料；lineUid 必須先通過 members 查核
async function loadDashboard({db, lineUid, days, nowMs = Date.now()}) {
  const mine = await db.select('members', {select: 'family_id', line_uid: 'eq.' + lineUid, limit: '1'});
  if (!mine[0]) throw Object.assign(new Error('[NOT_MEMBER] 尚未加入照護家庭'), {code: 'NOT_MEMBER'});
  const familyId = mine[0].family_id;
  const today = taipeiToday(nowMs);
  const since = isoDate(new Date(Date.parse(today) - (days - 1) * 86400000));

  const [families, members, links, records, appts] = await Promise.all([
    db.select('families', {select: 'family_id,patient_name,birth_year,conditions,allergies', family_id: 'eq.' + familyId, deleted_at: 'is.null'}),
    db.select('members', {select: 'family_id,line_uid,role,display_name', family_id: 'eq.' + familyId}),
    db.select('family_patients', {select: 'family_id,patient_id', family_id: 'eq.' + familyId}),
    db.select('daily_records', {
      select: '*', family_id: 'eq.' + familyId,
      and: `(record_date.gte.${since},record_date.lte.${today})`,
      order: 'record_date.desc,recorded_at.desc'
    }),
    db.select('appointments', {select: '*', family_id: 'eq.' + familyId})
  ]);
  const src = {
    families: families.map(f => ({familyId: f.family_id, patientName: f.patient_name, birthYear: f.birth_year ?? '',
      conditions: f.conditions || '', allergies: f.allergies || ''})),
    members: members.map(m => ({familyId: m.family_id, lineUid: m.line_uid, role: m.role})),
    familyPatients: links.map(l => ({familyId: l.family_id, patientId: l.patient_id})),
    dailyRecords: records.map(legacyRecord),
    appointments: appts.map(a => ({appt_id: a.appt_id, patient_id: a.patient_id, date: a.date, session: a.session || '',
      hospital: a.hospital || '', department: a.department || '', status: a.status}))
  };
  const nowIso = new Date(nowMs).toISOString();
  return DashboardService.getDashboardData(src, lineUid, null, days, nowIso);
}

module.exports = {loadDashboard, legacyRecord, taipeiToday};
