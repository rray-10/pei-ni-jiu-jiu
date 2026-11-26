'use strict';
// 藥物清單（MVP）：所有成員都能新增、修改、停用。停用不刪除。
// 時段與 n8n 用藥打卡的四個時段相同。
const {randomBytes} = require('node:crypto');

const SLOTS = ['早餐後', '午餐後', '晚餐後', '睡前'];

function fail(code, message) { return Object.assign(new Error(message), {code}); }
const text = v => String(v == null ? '' : v).trim();

async function membershipOf(db, uid) {
  const rows = await db.select('members', {select: 'family_id,role', line_uid: 'eq.' + uid, limit: '1'});
  if (!rows[0]) throw fail('NOT_MEMBER', '尚未加入照護家庭');
  return rows[0];
}

// 與健康標準相同：只有管理者能新增、修改、停用；成員只能查看
async function adminFamilyId(db, uid) {
  const me = await membershipOf(db, uid);
  if (me.role !== 'admin') throw fail('FORBIDDEN', '只有家庭管理者可以設定用藥');
  return me.family_id;
}

async function listMedications({db, uid}) {
  const familyId = (await membershipOf(db, uid)).family_id;
  const rows = await db.select('medications', {select: 'medication_id,name,dose,times,note', family_id: 'eq.' + familyId,
    active: 'eq.true', order: 'created_at.asc'});
  return {ok: true, medications: rows.map(r => ({medicationId: r.medication_id, name: r.name, dose: r.dose || '',
    slots: r.times ? r.times.split('、') : [], note: r.note || ''}))};
}

function parseInput(body) {
  const name = text(body.name);
  if (!name || name.length > 60) throw fail('BAD_REQUEST', '請輸入藥名（60 字以內）');
  const dose = text(body.dose);
  if (dose.length > 60) throw fail('BAD_REQUEST', '劑量請在 60 字以內');
  const slots = Array.isArray(body.slots) ? body.slots.map(text) : [];
  if (!slots.length || new Set(slots).size !== slots.length || slots.some(s => !SLOTS.includes(s))) {
    throw fail('BAD_REQUEST', '請至少選擇一個服用時段');
  }
  const note = text(body.note);
  if (note.length > 200) throw fail('BAD_REQUEST', '備註請在 200 字以內');
  return {name, dose: dose || null, times: slots.join('、'), schedule_per_day: slots.length, note: note || null};
}

async function saveMedication({db, uid, body, nowMs = Date.now()}) {
  const familyId = await adminFamilyId(db, uid);
  const fields = parseInput(body);
  const at = new Date(nowMs).toISOString();
  const id = text(body.medicationId);
  if (id) {
    const hit = await db.update('medications', {medication_id: 'eq.' + id, family_id: 'eq.' + familyId, active: 'eq.true'},
      {...fields, updated_at: at});
    if (!hit.length) throw fail('BAD_REQUEST', '找不到這筆藥物，請重新整理頁面');
  } else {
    await db.insert('medications', [{medication_id: 'M_' + randomBytes(12).toString('hex'), family_id: familyId,
      ...fields, active: true, created_by: uid, created_at: at, updated_at: at}]);
  }
  return listMedications({db, uid});
}

async function disableMedication({db, uid, body, nowMs = Date.now()}) {
  const familyId = await adminFamilyId(db, uid);
  const id = text(body.medicationId);
  if (!id) throw fail('BAD_REQUEST', '找不到這筆藥物');
  const hit = await db.update('medications', {medication_id: 'eq.' + id, family_id: 'eq.' + familyId},
    {active: false, updated_at: new Date(nowMs).toISOString()});
  if (!hit.length) throw fail('BAD_REQUEST', '找不到這筆藥物');
  return listMedications({db, uid});
}

// 建立家庭時一起寫入（管理者本人）。驗證與單筆儲存相同，任一筆不合格就整批不寫。
function parseBatch(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 10) throw fail('BAD_REQUEST', '藥物最多 10 項');
  return list.map(item => parseInput(item || {}));
}

async function insertMedications({db, familyId, uid, list, nowMs = Date.now()}) {
  const rows = parseBatch(list);
  const at = new Date(nowMs).toISOString();
  if (!rows.length) return 0;
  await db.insert('medications', rows.map(fields => ({medication_id: 'M_' + randomBytes(12).toString('hex'),
    family_id: familyId, ...fields, active: true, created_by: uid, created_at: at, updated_at: at})));
  return rows.length;
}

module.exports = {SLOTS, parseBatch, insertMedications, listMedications, saveMedication, disableMedication};
