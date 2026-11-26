const {test} = require('node:test');
const assert = require('node:assert/strict');
const m = require('../backend/membership.js');

// 記憶體版資料庫：只實作 membership 會用到的操作
function memoryDb() {
  const tables = {families:[], family_patients:[], members:[], family_invites:[], tracking_settings:[],
    metric_definitions:[{metric_key:'blood_pressure',metric_name:'血壓',unit:'mmHg',is_active:true},
      {metric_key:'blood_glucose',metric_name:'血糖',unit:'mg/dL',is_active:true}]};
  const match = (row, query) => Object.entries(query || {}).every(([col, expr]) => {
    if (['select','limit','order'].includes(col)) return true;
    if (expr === 'is.null') return row[col] == null;
    if (expr.startsWith('eq.')) return String(row[col]) === expr.slice(3);
    return true;
  });
  const key = {members:'line_uid', family_patients:'family_id', families:'family_id', family_invites:'code_hash', tracking_settings:'family_id,metric_key'};
  return {
    tables,
    async select(t, q) { const rows = tables[t].filter(r => match(r, q)); return q.limit ? rows.slice(0, Number(q.limit)) : rows; },
    async insert(t, rows) { tables[t].push(...rows.map(r => ({...r}))); return rows; },
    async insertIgnoreDuplicates(t, rows, onConflict) {
      const cols = onConflict.split(',');
      for (const r of rows) if (!tables[t].some(x => cols.every(c => String(x[c]) === String(r[c])))) tables[t].push({...r});
      return rows;
    },
    async update(t, q, patch) {
      const hit = tables[t].filter(r => match(r, q));
      hit.forEach(r => Object.assign(r, patch));
      return hit;
    },
    async remove(t, q) { tables[t] = tables[t].filter(r => !match(r, q)); }
  };
}

const ADMIN = 'U' + 'a'.repeat(32), MEMBER = 'U' + 'b'.repeat(32), OTHER = 'U' + 'c'.repeat(32);
const REQ = '22222222-2222-4222-8222-222222222222';

test('create family: same request is idempotent, and the creator becomes admin with tracking rows', async () => {
  const db = memoryDb();
  const made = await m.createFamily({db, uid: ADMIN, body: {patientName: '阿嬤', requestId: REQ, birthYear: '1956',
    conditions: ['高血壓'], metrics: ['blood_pressure'], thresholds: {blood_pressure: {systolic_high: 140}}}});
  assert.equal(made.role, 'admin');
  assert.match(made.patientId, /^P_/);
  assert.equal(db.tables.tracking_settings.length, 1);
  assert.equal(db.tables.tracking_settings[0].systolic_high, 140);
  const again = await m.createFamily({db, uid: ADMIN, body: {patientName: '重送', requestId: REQ}});
  assert.equal(again.familyId, made.familyId);          // already bound: no second family
  assert.equal(db.tables.families.length, 1);
  assert.equal((await m.memberStatus({db, uid: ADMIN})).patientName, '阿嬤');
});

test('invite → preview → join is single-use; a member cannot create invites; invites die with the family', async () => {
  const db = memoryDb();
  await m.createFamily({db, uid: ADMIN, body: {patientName: '阿嬤', requestId: REQ}});
  const {inviteCode} = await m.createInvite({db, uid: ADMIN});
  assert.equal((await m.previewInvite({db, uid: MEMBER, body: {inviteCode}})).preview.patientName, '阿嬤');
  const joined = await m.joinFamily({db, uid: MEMBER, body: {inviteCode}});
  assert.equal(joined.role, 'member');
  await assert.rejects(() => m.joinFamily({db, uid: OTHER, body: {inviteCode}}), /邀請碼無效/);  // already claimed
  await assert.rejects(() => m.createInvite({db, uid: MEMBER}), /只有家庭管理者/);
  await assert.rejects(() => m.joinFamily({db, uid: MEMBER, body: {inviteCode}}), /請先離開/);  // already bound
  await assert.rejects(() => m.deleteFamily({db, uid: MEMBER}), /只有管理者/);
  assert.equal((await m.unbind({db, uid: MEMBER})).bound, false);
  await assert.rejects(() => m.unbind({db, uid: ADMIN}), /刪除照護家庭/);
  await m.deleteFamily({db, uid: ADMIN});
  assert.equal((await m.memberStatus({db, uid: ADMIN})).bound, false);
  assert.ok(db.tables.families[0].deleted_at);
  await assert.rejects(() => m.joinFamily({db, uid: OTHER, body: {inviteCode}}), /邀請碼無效/);
});

test('bad input is rejected before anything is written', async () => {
  const db = memoryDb();
  await assert.rejects(() => m.createFamily({db, uid: ADMIN, body: {patientName: ''}}), /稱呼/);
  await assert.rejects(() => m.createFamily({db, uid: ADMIN, body: {patientName: 'x', proxy: true}}), /同意/);
  await assert.rejects(() => m.createFamily({db, uid: ADMIN, body: {patientName: 'x', metrics: ['nope']}}), /追蹤項目/);
  await assert.rejects(() => m.createFamily({db, uid: ADMIN, body: {patientName: 'x', metrics: ['blood_pressure'],
    thresholds: {blood_pressure: {bogus: 1}}}}), /警示值/);
  assert.equal(db.tables.families.length, 0);
});
