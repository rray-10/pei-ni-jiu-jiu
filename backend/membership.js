'use strict';
// Supabase 版綁定：建立家庭、邀請、加入、離開、刪除。授權一律以 members 為準。
// 尚未包含：好友確認與待確認綁定（需要 LINE_OA_ACCESS_TOKEN，Node 目前沒有）、刪除後復原。
const {createHash, randomBytes} = require('node:crypto');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const DAY_MS = 24 * 3600 * 1000;
const {parseBatch, insertMedications} = require('./medications.js');
const DEFAULT_METRICS = ['blood_pressure', 'blood_glucose'];
const THRESHOLD_FIELDS = ['alert_low','alert_high','systolic_low','systolic_high','diastolic_low','diastolic_high',
  'change_threshold','systolic_change_threshold','diastolic_change_threshold'];

function fail(code, message) { return Object.assign(new Error(message), {code}); }
const text = v => String(v == null ? '' : v).trim();

async function currentMembership(db, uid) {
  const rows = await db.select('members', {select: 'family_id,line_uid,role', line_uid: 'eq.' + uid, limit: '1'});
  return rows[0] || null;
}

async function familyView(db, familyId) {
  const [fam] = await db.select('families', {select: 'patient_name', family_id: 'eq.' + familyId, limit: '1'});
  const [link] = await db.select('family_patients', {select: 'patient_id', family_id: 'eq.' + familyId, limit: '1'});
  return {patientName: fam ? fam.patient_name : '', patientId: link ? link.patient_id : ''};
}

const RESTORE_MONTHS = 3;

// 刪除時間 + 3 個月；月底回到該月最後一天（與 GAS 相同規則）
function restoreUntil(deletedAt) {
  const until = new Date(deletedAt);
  if (isNaN(until)) return null;
  const day = until.getUTCDate();
  until.setUTCMonth(until.getUTCMonth() + RESTORE_MONTHS);
  if (until.getUTCDate() !== day) until.setUTCDate(0);
  return until;
}

async function restorableFor(db, uid, nowMs) {
  const rows = await db.select('families', {select: 'family_id,patient_name,deleted_at,deleted_by', deleted_by: 'eq.' + uid});
  return rows.filter(r => r.deleted_at).map(r => ({familyId: r.family_id, patientName: r.patient_name,
    restoreUntil: restoreUntil(r.deleted_at), deletedAt: r.deleted_at}))
    .filter(r => r.restoreUntil && r.restoreUntil.getTime() > nowMs)
    .map(({deletedAt, ...rest}) => ({...rest, restoreUntil: rest.restoreUntil.toISOString()}));
}

async function memberStatus({db, uid, nowMs = Date.now()}) {
  const me = await currentMembership(db, uid);
  if (!me) return {ok: true, bound: false, restorable: await restorableFor(db, uid, nowMs)};
  return {ok: true, bound: true, familyId: me.family_id, role: me.role, ...(await familyView(db, me.family_id))};
}

function parseProfile(body) {
  const name = text(body.patientName);
  if (!name || name.length > 60) throw fail('BAD_REQUEST', '請輸入 1 到 60 字的稱呼');
  if (body.proxy && body.consent !== true) throw fail('BAD_REQUEST', '替家人建立前，請先確認已取得患者同意');
  const year = text(body.birthYear);
  if (year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > new Date().getFullYear())) throw fail('BAD_REQUEST', '出生年請輸入 1900 到今年之間的西元年（例如 1956）');
  const conditions = (Array.isArray(body.conditions) ? body.conditions : (body.conditions ? [body.conditions] : []))
    .map(text).filter(Boolean);
  if (conditions.length > 10 || conditions.some(c => c.length > 30)) throw fail('BAD_REQUEST', '慢性病內容過長');
  const allergies = text(body.allergies);
  if (allergies.length > 200) throw fail('BAD_REQUEST', '過敏史請在 200 字內');
  return {
    patient_name: name, birth_year: year ? Number(year) : null,
    conditions: conditions.length ? conditions.join('、') : null, allergies: allergies || null,
    created_for: body.proxy ? 'proxy' : 'self'
  };
}

function parseThresholds(body, metrics) {
  const input = body.thresholds && typeof body.thresholds === 'object' && !Array.isArray(body.thresholds) ? body.thresholds : {};
  return metrics.map(metric => {
    const fields = input[metric] && typeof input[metric] === 'object' ? input[metric] : {};
    const out = {};
    for (const [field, value] of Object.entries(fields)) {
      if (!THRESHOLD_FIELDS.includes(field)) throw fail('BAD_REQUEST', '警示值欄位無效');
      if (value === '' || value == null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) throw fail('BAD_REQUEST', '警示值請輸入數字');
      out[field] = value;
    }
    return {metric, out};
  });
}

async function createFamily({db, uid, body, nowMs = Date.now(), oa = null, requireFriend = false}) {
  const existing = await currentMembership(db, uid);
  if (existing) return {ok: true, ...(await memberStatus({db, uid}))};   // 同一帳號重送：回傳目前狀態
  const profile = parseProfile(body);
  const medList = parseBatch(body.medications);   // 先驗證，不合格就不建立任何資料
  if (requireFriend && oa && !(await oa.isFriend(uid))) throw fail('FORBIDDEN', '請先加入官方帳號為好友，才能完成綁定');
  const request = /^[0-9a-f-]{36}$/i.test(text(body.requestId)) ? text(body.requestId) : randomBytes(16).toString('hex');
  const key = sha256(uid + ':' + request);
  const familyId = 'F_' + key.slice(0, 32);
  const patientId = 'P_' + key.slice(32);

  const metrics = Array.isArray(body.metrics) ? body.metrics : DEFAULT_METRICS;
  if (!metrics.length || new Set(metrics).size !== metrics.length) throw fail('BAD_REQUEST', '請至少選擇一個有效的追蹤項目');
  const defs = await db.select('metric_definitions', {select: 'metric_key,metric_name,unit', is_active: 'eq.true'});
  const defByKey = new Map(defs.map(d => [d.metric_key, d]));
  if (metrics.some(m => !defByKey.has(m))) throw fail('BAD_REQUEST', '請至少選擇一個有效的追蹤項目');
  const thresholds = parseThresholds(body, metrics);

  const family = await db.select('families', {select: 'family_id,deleted_at', family_id: 'eq.' + familyId, limit: '1'});
  if (family[0] && family[0].deleted_at) throw fail('BAD_REQUEST', '這個照護家庭已刪除，請重新整理頁面');
  if (!family[0]) await db.insert('families', [{family_id: familyId, ...profile}]);
  await db.insertIgnoreDuplicates('family_patients', [{family_id: familyId, patient_id: patientId}], 'family_id');
  await db.insertIgnoreDuplicates('members', [{line_uid: uid, family_id: familyId, role: 'admin', joined_at: new Date(nowMs).toISOString()}], 'line_uid');
  await db.insertIgnoreDuplicates('tracking_settings', metrics.map(metric => {
    const {out} = thresholds.find(t => t.metric === metric);
    return {family_id: familyId, metric_key: metric, enabled: true, metric_name: defByKey.get(metric).metric_name,
      unit: defByKey.get(metric).unit, updated_by: uid, updated_at: new Date(nowMs).toISOString(), ...out};
  }), 'family_id,metric_key');
  await insertMedications({db, familyId, uid, list: medList, nowMs});
  return {ok: true, bound: true, familyId, role: 'admin', patientId, patientName: profile.patient_name};
}

async function createInvite({db, uid, nowMs = Date.now()}) {
  const me = await currentMembership(db, uid);
  if (!me) throw fail('NOT_MEMBER', '尚未加入照護家庭');
  if (me.role !== 'admin') throw fail('FORBIDDEN', '只有家庭管理者可產生邀請碼');
  const code = randomBytes(16).toString('hex');
  await db.insert('family_invites', [{code_hash: sha256(code), family_id: me.family_id,
    expires_at: new Date(nowMs + DAY_MS).toISOString(), claimed_by: null}]);
  return {ok: true, inviteCode: code};
}

async function usableInvite(db, code, uid, nowMs) {
  const normalized = text(code).toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) throw fail('BAD_REQUEST', '邀請碼無效或已過期');
  const [invite] = await db.select('family_invites', {select: '*', code_hash: 'eq.' + sha256(normalized), limit: '1'});
  const valid = invite && Date.parse(invite.expires_at) > nowMs && (!invite.claimed_by || invite.claimed_by === uid);
  if (!valid) throw fail('BAD_REQUEST', '邀請碼無效或已過期');
  const members = await db.select('members', {select: 'line_uid', family_id: 'eq.' + invite.family_id, limit: '1'});
  if (!members.length) throw fail('BAD_REQUEST', '邀請碼無效或已過期');   // 家庭已沒有成員
  return {invite, normalized};
}

async function previewInvite({db, uid, body, nowMs = Date.now()}) {
  const {invite} = await usableInvite(db, body.inviteCode, uid, nowMs);
  return {ok: true, preview: await familyView(db, invite.family_id)};
}

async function joinFamily({db, uid, body, nowMs = Date.now(), oa = null, requireFriend = false}) {
  if (await currentMembership(db, uid)) throw fail('BAD_REQUEST', '請先離開目前的照護家庭，再加入其他家庭');
  const {invite, normalized} = await usableInvite(db, body.inviteCode, uid, nowMs);
  // 條件式更新：只有尚未被使用的邀請碼能被認領，避免兩人同時加入
  const claimed = await db.update('family_invites', {code_hash: 'eq.' + sha256(normalized), claimed_by: 'is.null'}, {claimed_by: uid});
  if (!claimed.length && invite.claimed_by !== uid) throw fail('BAD_REQUEST', '邀請碼無效或已過期');
  // 非好友：先記成待確認（24 小時），加好友的 follow 事件到了才正式綁定
  if (requireFriend && oa && !(await oa.isFriend(uid))) {
    await db.upsert('pending_links', [{line_uid: uid, family_id: invite.family_id, role: 'member',
      created_at: new Date(nowMs).toISOString(), expires_at: new Date(nowMs + DAY_MS).toISOString()}], 'line_uid');
    return {ok: true, bound: false, pending: true, ...(await familyView(db, invite.family_id))};
  }
  await db.insertIgnoreDuplicates('members', [{line_uid: uid, family_id: invite.family_id, role: 'member',
    joined_at: new Date(nowMs).toISOString()}], 'line_uid');
  return {ok: true, bound: true, familyId: invite.family_id, role: 'member', ...(await familyView(db, invite.family_id))};
}

// 一般成員離開：只刪自己的成員列。管理者不能直接離開（請用刪除家庭）。
async function unbind({db, uid}) {
  const me = await currentMembership(db, uid);
  if (!me) throw fail('BAD_REQUEST', '尚未加入照護家庭');
  if (me.role === 'admin') throw fail('FORBIDDEN', '管理者請使用「刪除照護家庭」');
  await db.remove('members', {line_uid: 'eq.' + uid});
  return {ok: true, bound: false, unbound: true, _unlinkUids: [uid]};
}

// 管理者刪除家庭：所有成員解除綁定、邀請碼失效。資料保留（復原功能待補）。
async function deleteFamily({db, uid, nowMs = Date.now()}) {
  const me = await currentMembership(db, uid);
  if (!me) throw fail('BAD_REQUEST', '尚未加入照護家庭');
  if (me.role !== 'admin') throw fail('FORBIDDEN', '只有管理者可以刪除家庭');
  const at = new Date(nowMs).toISOString();
  const everyone = await db.select('members', {select: 'line_uid', family_id: 'eq.' + me.family_id});
  await db.update('families', {family_id: 'eq.' + me.family_id}, {deleted_at: at, deleted_by: uid});
  await db.update('family_invites', {family_id: 'eq.' + me.family_id}, {expires_at: at});
  await db.remove('members', {family_id: 'eq.' + me.family_id});
  return {ok: true, bound: false, unbound: true, deleted: true, restoreUntil: restoreUntil(at).toISOString(),
    _unlinkUids: everyone.map(row => row.line_uid)};
}

// 3 個月內，刪除的人可以復原；復原後只有他一位成員（管理者），其他人用新邀請重新加入
async function restoreFamily({db, uid, body, nowMs = Date.now()}) {
  if (await currentMembership(db, uid)) throw fail('BAD_REQUEST', '請先離開目前的照護家庭，再復原');
  const familyId = text(body.familyId);
  const hit = (await restorableFor(db, uid, nowMs)).find(f => f.familyId === familyId);
  if (!hit) throw fail('BAD_REQUEST', '這個照護家庭已超過復原期限或不存在');
  const left = await db.select('members', {select: 'line_uid', family_id: 'eq.' + familyId, limit: '1'});
  if (left.length) throw fail('BAD_REQUEST', '這個照護家庭已有成員');
  await db.update('families', {family_id: 'eq.' + familyId}, {deleted_at: null, deleted_by: null});
  await db.insert('members', [{line_uid: uid, family_id: familyId, role: 'admin', joined_at: new Date(nowMs).toISOString()}]);
  return {ok: true, bound: true, familyId, role: 'admin', ...(await familyView(db, familyId))};
}

// 成員列表（所有成員都能看；key 與 GAS 相同的算法，前端用來指定對象）
const memberKeyOf = uid => sha256(uid).slice(0, 16);

async function listMembers({db, uid}) {
  const me = await currentMembership(db, uid);
  if (!me) throw fail('NOT_MEMBER', '尚未加入照護家庭');
  const rows = await db.select('members', {select: 'line_uid,role,display_name,joined_at', family_id: 'eq.' + me.family_id});
  return {ok: true, bound: true, familyId: me.family_id, role: me.role,
    members: rows.map(r => ({key: memberKeyOf(r.line_uid), displayName: text(r.display_name), role: r.role,
      isSelf: r.line_uid === uid, joinedAt: r.joined_at || ''}))};
}

// 管理者：移除成員（不含自己、不含其他管理者）或把成員升為管理者
async function changeMember({db, uid, body, promote}) {
  const me = await currentMembership(db, uid);
  if (!me) throw fail('NOT_MEMBER', '尚未加入照護家庭');
  if (me.role !== 'admin') throw fail('FORBIDDEN', '只有管理者可管理成員');
  const key = text(body.memberKey);
  const rows = await db.select('members', {select: 'line_uid,role', family_id: 'eq.' + me.family_id});
  const target = rows.find(r => memberKeyOf(r.line_uid) === key);
  if (!key || !target) throw fail('BAD_REQUEST', '找不到這位成員');
  if (target.line_uid === uid) throw fail('BAD_REQUEST', '不能對自己執行這個操作');
  if (target.role === 'admin') throw fail('BAD_REQUEST', '這位成員已經是管理者');
  if (promote) {
    await db.update('members', {line_uid: 'eq.' + target.line_uid}, {role: 'admin'});
    return {ok: true, bound: true, familyId: me.family_id, role: me.role, promoted: true};
  }
  await db.remove('members', {line_uid: 'eq.' + target.line_uid});
  return {ok: true, bound: true, familyId: me.family_id, role: me.role, removed: true, _unlinkUids: [target.line_uid]};
}

// 加入其他家庭：先驗證邀請碼，再離開目前的家庭，最後加入。管理者要先刪除目前的家庭（需明確同意）。
async function switchFamily({db, uid, body, oa = null, requireFriend = false, nowMs = Date.now()}) {
  const me = await currentMembership(db, uid);
  if (!me) return joinFamily({db, uid, body, oa, requireFriend, nowMs});
  const {invite} = await usableInvite(db, body.inviteCode, uid, nowMs);
  if (invite.family_id === me.family_id) throw fail('BAD_REQUEST', '你已經是這個家庭的成員');
  if (me.role === 'admin' && body.deleteFamily !== true) {
    throw fail('BAD_REQUEST', '你是目前家庭的管理者，加入新家庭前要先刪除目前的照護家庭');
  }
  let unlink = [];
  if (me.role === 'admin') {
    unlink = (await deleteFamily({db, uid, nowMs}))._unlinkUids;
  } else {
    await db.remove('members', {line_uid: 'eq.' + uid});
    unlink = [uid];
  }
  const joined = await joinFamily({db, uid, body, oa, requireFriend, nowMs});
  // 管理者刪除時 unlink 已包含家庭所有人；一般成員只解除自己
  return {...joined, _unlinkUids: unlink};
}

// follow 事件（n8n 轉來）：把待確認的人正式綁定。回傳 {activated, reason}。
async function activatePending({db, uid, nowMs = Date.now()}) {
  const rows = await db.select('pending_links', {select: '*', line_uid: 'eq.' + uid, limit: '1'});
  const row = rows[0];
  const drop = () => db.remove('pending_links', {line_uid: 'eq.' + uid});
  if (!row || Date.parse(row.expires_at) <= nowMs) { await drop(); return {ok: true, activated: false, reason: 'none'}; }
  if (await currentMembership(db, uid)) { await drop(); return {ok: true, activated: false, reason: 'bound'}; }
  const [fam] = await db.select('families', {select: 'family_id,deleted_at', family_id: 'eq.' + row.family_id, limit: '1'});
  if (!fam || fam.deleted_at) { await drop(); return {ok: true, activated: false, reason: 'family_gone'}; }
  await db.insertIgnoreDuplicates('members', [{line_uid: uid, family_id: row.family_id, role: row.role,
    joined_at: new Date(nowMs).toISOString()}], 'line_uid');
  await drop();
  return {ok: true, activated: true, reason: '', bound: true, familyId: row.family_id, role: row.role,
    ...(await familyView(db, row.family_id))};
}

module.exports = {memberStatus, createFamily, createInvite, previewInvite, joinFamily, unbind, deleteFamily, activatePending,
  restoreFamily, listMembers,
  removeMember: ({db, uid, body}) => changeMember({db, uid, body, promote: false}),
  promoteMember: ({db, uid, body}) => changeMember({db, uid, body, promote: true}),
  switchFamily};
