'use strict';
// Supabase 版每日紀錄寫入：驗證規則與 GAS f1Record_ 相同，寫入 daily_records。
const {legacyRecord} = require('./dashboard.js');
const HealthAdapter = require('../adapters/health-adapter.js');

const PERIODS = ['morning', 'noon', 'evening', 'bedtime'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) { return Object.assign(new Error(message), {code: 'BAD_REQUEST'}); }

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === value;
}

// 依家庭目前啟用的項目，檢查並整理本次輸入
function buildRows({values, catalog, familyId, lineUid, requestId, recordDate, period, note, now}) {
  const byKey = new Map(catalog.map(item => [item.metric_key, item]));
  const rows = [];
  for (const [key, value] of Object.entries(values || {})) {
    const def = byKey.get(key);
    if (!def || !def.enabled) throw fail('輸入包含未啟用的項目');
    let numeric = null, systolic = null, diastolic = null, text;
    if (def.input_type === 'bloodPressure') {
      if (typeof value !== 'string') throw fail('紀錄格式不正確');
      const parsed = HealthAdapter.parseBloodPressure(value);
      if (!parsed.ok) throw fail('血壓數值不合理，請確認「收縮壓／舒張壓」是否填對（收縮壓 50–260、舒張壓 30–180，且收縮壓要大於舒張壓）');
      systolic = parsed.systolic; diastolic = parsed.diastolic; text = `${systolic}/${diastolic}`;
    } else if (def.input_type === 'boolean') {
      if (typeof value !== 'boolean') throw fail('紀錄格式不正確');
      text = String(value);
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw fail('紀錄格式不正確');
      if (key === 'blood_glucose') {
        const [low, high] = /mmol/i.test(def.unit || '') ? [1.1, 33.3] : [20, 600];
        if (value < low || value > high) throw fail('血糖數值不合理，請確認數字與單位');
      }
      numeric = value; text = String(value);
    }
    rows.push({
      record_id: [familyId, lineUid, requestId, key].join(':'),
      family_id: familyId, line_uid: lineUid, recorded_at: now.toISOString(), record_date: recordDate, period,
      metric_key: key, metric_name: def.metric_name, value: text, value_numeric: numeric,
      value_systolic: systolic, value_diastolic: diastolic, unit: def.unit || '', note: String(note || '').slice(0, 500),
      source: 'LIFF', is_recorded: true, created_by: lineUid, created_at: now.toISOString()
    });
  }
  if (!rows.length) throw fail('請至少輸入一個項目');
  return rows;
}

async function writeDaily({db, lineUid, body, nowMs = Date.now()}) {
  if (!UUID.test(String(body.requestId || ''))) throw fail('請重新送出紀錄');
  if (!validDate(String(body.recordDate || ''))) throw fail('日期無效');
  if (!PERIODS.includes(body.period)) throw fail('時段無效');
  const mine = await db.select('members', {select: 'family_id', line_uid: 'eq.' + lineUid, limit: '1'});
  if (!mine[0]) throw Object.assign(new Error('[NOT_MEMBER] 尚未加入照護家庭'), {code: 'NOT_MEMBER'});
  const familyId = mine[0].family_id;
  const settings = await db.select('tracking_settings', {select: 'metric_key,enabled', family_id: 'eq.' + familyId});
  const defs = await db.select('metric_definitions', {select: 'metric_key,metric_name,input_type,unit,is_active', is_active: 'eq.true'});
  const enabled = new Map(settings.map(s => [s.metric_key, s.enabled === true]));
  const catalog = defs.map(d => ({...d, enabled: enabled.get(d.metric_key) === true}));
  const now = new Date(nowMs);
  const rows = buildRows({values: body.values, catalog, familyId, lineUid, requestId: body.requestId,
    recordDate: body.recordDate, period: body.period, note: body.note, now});
  // 同一次送出重試：record_id 相同，資料庫忽略重複，不會重複寫入
  await db.insertIgnoreDuplicates('daily_records', rows, 'record_id');
  return {ok: true, savedCount: rows.length, recordedAt: now.toISOString(), recordDate: body.recordDate, period: body.period, warnings: []};
}

module.exports = {writeDaily, buildRows, validDate};
