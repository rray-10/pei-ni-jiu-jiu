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

// 組出儀表板需要的資料（只含登入者自己的家庭）；lineUid 必須先通過 members 查核
async function buildSource({db, lineUid, days, nowMs = Date.now()}) {
  const mine = await db.select('members', {select: 'family_id', line_uid: 'eq.' + lineUid, limit: '1'});
  if (!mine[0]) throw Object.assign(new Error('[NOT_MEMBER] 尚未加入照護家庭'), {code: 'NOT_MEMBER'});
  const familyId = mine[0].family_id;
  const today = taipeiToday(nowMs);
  const since = isoDate(new Date(Date.parse(today) - (days - 1) * 86400000));

  const [families, members, links, records, appts, settings] = await Promise.all([
    db.select('families', {select: 'family_id,patient_name,birth_year,conditions,allergies', family_id: 'eq.' + familyId, deleted_at: 'is.null'}),
    db.select('members', {select: 'family_id,line_uid,role,display_name', family_id: 'eq.' + familyId}),
    db.select('family_patients', {select: 'family_id,patient_id', family_id: 'eq.' + familyId}),
    db.select('daily_records', {
      select: '*', family_id: 'eq.' + familyId,
      and: `(record_date.gte.${since},record_date.lte.${today})`,
      order: 'record_date.desc,recorded_at.desc'
    }),
    db.select('appointments', {select: '*', family_id: 'eq.' + familyId}),
    db.select('tracking_settings', {select: 'metric_key,enabled,systolic_low,systolic_high,diastolic_low,diastolic_high,alert_low,alert_high', family_id: 'eq.' + familyId})
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
  return {src, familyId, today, nowIso: new Date(nowMs).toISOString(), targets: targetsFrom(settings)};
}

const SLOT_ORDER = ['早餐後', '午餐後', '晚餐後', '睡前'];

// 用藥紀錄（依時段）：明細永遠列出四個時段（LINE 打卡也是四個）。
// 應吃只算「有啟用中藥物的時段」：應吃 = 每天的藥物時段數 × 天數；已吃 = 這些時段裡 med_logs 為 taken 的筆數。
// 沒有藥物的時段即使打了卡，仍顯示在明細，但不計入比例。取消（cancelled）與未打卡（none）都不算已吃。
function medicationSummary({activeMeds, logs, days, today}) {
  const slots = SLOT_ORDER.filter(slot => activeMeds.some(m => String(m.times || '').split('、').includes(slot)));
  const byKey = new Map(logs.map(l => [`${l.log_date}|${l.slot}`, l.status]));
  const rows = [];
  for (let i = 0; i < days; i++) {
    const date = isoDate(new Date(Date.parse(today) - i * 86400000));
    rows.push({date, slots: SLOT_ORDER.map(slot => ({slot, counted: slots.includes(slot),
      status: byKey.get(`${date}|${slot}`) || 'none'}))});
  }
  const total = rows.length * slots.length;
  const taken = rows.reduce((n, r) => n + r.slots.filter(s => s.counted && s.status === 'taken').length, 0);
  return {taken, total, rate: total ? Math.round(100 * taken / total) : null, slots, allSlots: SLOT_ORDER, rows};
}

async function loadMedication({db, familyId, days, today}) {
  const since = isoDate(new Date(Date.parse(today) - (days - 1) * 86400000));
  const [activeMeds, logs] = await Promise.all([
    db.select('medications', {select: 'times', family_id: 'eq.' + familyId, active: 'eq.true'}),
    db.select('med_logs', {select: 'log_date,slot,status', family_id: 'eq.' + familyId,
      and: `(log_date.gte.${since},log_date.lte.${today})`})
  ]);
  return medicationSummary({activeMeds, logs, days, today});
}

// 目標範圍：血壓（收縮、舒張）、血糖。只有上下限都填了才回傳，前端據此畫淺色帶。
function targetsFrom(rows) {
  const by = new Map(rows.map(r => [r.metric_key, r]));
  const range = (row, low, high) => {
    if (!row || row[low] == null || row[high] == null) return null;
    return {low: Number(row[low]), high: Number(row[high])};
  };
  const bp = by.get('blood_pressure'), glucose = by.get('blood_glucose');
  return {systolic: range(bp, 'systolic_low', 'systolic_high'), diastolic: range(bp, 'diastolic_low', 'diastolic_high'),
    glucose: range(glucose, 'alert_low', 'alert_high')};
}

async function loadDashboard(args) {
  const {src, nowIso, targets, familyId, today} = await buildSource(args);
  const dashboard = DashboardService.getDashboardData(src, args.lineUid, null, args.days, nowIso);
  const medication = await loadMedication({db: args.db, familyId, days: args.days, today});
  return {...dashboard, targets, medication};
}

// 就診摘要：與 GAS getVisitSummary 相同（含最高／最低）
async function loadVisitSummary(args) {
  const {src, nowIso, familyId, today} = await buildSource(args);
  const summary = DashboardService.getVisitSummary(src, args.lineUid, null, args.days, nowIso);
  return {...summary, medication: await loadMedication({db: args.db, familyId, days: args.days, today})};
}

module.exports = {loadDashboard, loadVisitSummary, legacyRecord, taipeiToday, targetsFrom, medicationSummary};
