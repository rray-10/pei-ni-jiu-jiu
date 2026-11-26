'use strict';
// 每日紀錄頁與健康標準設定頁用的讀取／儲存（對應 GAS 的 read、update）。
const THRESHOLDS = ['alert_low','alert_high','systolic_low','systolic_high','diastolic_low','diastolic_high',
  'change_threshold','systolic_change_threshold','diastolic_change_threshold'];
const CAMEL = {alert_low:'alertLow',alert_high:'alertHigh',systolic_low:'systolicLow',systolic_high:'systolicHigh',
  diastolic_low:'diastolicLow',diastolic_high:'diastolicHigh',change_threshold:'changeThreshold',
  systolic_change_threshold:'systolicChangeThreshold',diastolic_change_threshold:'diastolicChangeThreshold'};

function fail(code, message) { return Object.assign(new Error(message), {code}); }

async function membershipRow(db, uid) {
  const rows = await db.select('members', {select: 'family_id,role', line_uid: 'eq.' + uid, limit: '1'});
  if (!rows[0]) throw fail('NOT_MEMBER', '尚未加入照護家庭');
  return rows[0];
}

// 回傳：{familyId, role, patientId, metrics:[…], settings:{key:bool}}，與 GAS read 的形狀一致
async function readSettings({db, uid}) {
  const me = await membershipRow(db, uid);
  const [link] = await db.select('family_patients', {select: 'patient_id', family_id: 'eq.' + me.family_id, limit: '1'});
  const defs = await db.select('metric_definitions', {select: 'metric_key,metric_name,input_type,unit,is_active', is_active: 'eq.true'});
  const saved = await db.select('tracking_settings', {select: '*', family_id: 'eq.' + me.family_id});
  const latest = new Map(saved.map(row => [row.metric_key, row]));
  const metrics = defs.map(d => {
    const s = latest.get(d.metric_key) || {};
    const item = {metricKey: d.metric_key, metricName: s.metric_name || d.metric_name, inputType: d.input_type,
      unit: s.unit || d.unit || '', isActive: true};
    for (const field of THRESHOLDS) item[CAMEL[field]] = s[field] == null ? null : Number(s[field]);
    return item;
  });
  const settings = Object.fromEntries(defs.map(d => [d.metric_key, latest.get(d.metric_key)?.enabled === true]));
  const [fam] = await db.select('families', {select: 'patient_name', family_id: 'eq.' + me.family_id, limit: '1'});
  return {ok: true, familyId: me.family_id, role: me.role, patientId: link ? link.patient_id : '',
    patientName: fam ? fam.patient_name : '', metrics, settings};
}

// 只有管理者能儲存；每個項目都必須是目前有效的定義
async function updateSettings({db, uid, body, nowMs = Date.now()}) {
  const me = await membershipRow(db, uid);
  if (me.role !== 'admin') throw fail('FORBIDDEN', '只有家庭管理者可修改設定');
  const input = Array.isArray(body.settings) ? body.settings : [];
  if (!input.length) throw fail('BAD_REQUEST', '設定格式無效');
  const defs = new Map((await db.select('metric_definitions', {select: 'metric_key,metric_name,unit', is_active: 'eq.true'}))
    .map(d => [d.metric_key, d]));
  const at = new Date(nowMs).toISOString();
  const rows = input.map(item => {
    const def = defs.get(item && item.metricKey);
    if (!def || typeof item.enabled !== 'boolean') throw fail('BAD_REQUEST', '設定包含無效項目');
    const row = {family_id: me.family_id, metric_key: def.metric_key, enabled: item.enabled, metric_name: def.metric_name,
      unit: def.unit || null, updated_by: uid, updated_at: at};
    for (const field of THRESHOLDS) {
      const value = item[CAMEL[field]];
      if (value === '' || value == null) { row[field] = null; continue; }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) throw fail('BAD_REQUEST', '門檻格式無效');
      row[field] = value;
    }
    return row;
  });
  await db.upsert('tracking_settings', rows, 'family_id,metric_key');
  return readSettings({db, uid});
}

module.exports = {readSettings, updateSettings};
