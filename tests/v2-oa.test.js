const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createV2} = require('../backend/v2.js');

// 記憶體版資料庫 + 假的 LINE（驗證、profile、選單）
function world({friends = new Set()} = {}) {
  const tables = {families:[], family_patients:[], members:[], family_invites:[], tracking_settings:[], pending_links:[],
    metric_definitions:[{metric_key:'blood_pressure',metric_name:'血壓',unit:'mmHg',is_active:true},
      {metric_key:'blood_glucose',metric_name:'血糖',unit:'mg/dL',is_active:true}]};
  const match = (row, q) => Object.entries(q || {}).every(([c, e]) => {
    if (['select','limit','order'].includes(c)) return true;
    if (e === 'is.null') return row[c] == null;
    if (e.startsWith('eq.')) return String(row[c]) === e.slice(3);
    return true;
  });
  const menuCalls = [];
  const db = {
    async select(t, q) { const r = tables[t].filter(x => match(x, q)); return q.limit ? r.slice(0, +q.limit) : r; },
    async insert(t, rows) { tables[t].push(...rows.map(r => ({...r}))); return rows; },
    async upsert(t, rows, on) { for (const r of rows) { const i = tables[t].findIndex(x => String(x[on]) === String(r[on])); if (i >= 0) tables[t][i] = {...r}; else tables[t].push({...r}); } return rows; },
    async insertIgnoreDuplicates(t, rows, on) { const cols = on.split(','); for (const r of rows) if (!tables[t].some(x => cols.every(c => String(x[c]) === String(r[c])))) tables[t].push({...r}); return rows; },
    async update(t, q, patch) { const hit = tables[t].filter(r => match(r, q)); hit.forEach(r => Object.assign(r, patch)); return hit; },
    async remove(t, q) { tables[t] = tables[t].filter(r => !match(r, q)); }
  };
  const fetcher = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/oauth2/v2.1/verify')) return new Response(JSON.stringify({client_id:'CH',expires_in:600}));
    if (u.endsWith('/v2/profile')) {
      const auth = opts.headers.Authorization;
      const uid = auth.includes('tok-b') ? UID_B : auth.includes('tok-c') ? 'U' + 'c'.repeat(32) : UID_A;
      return new Response(JSON.stringify({userId: uid}));
    }
    if (u.includes('/v2/bot/profile/')) {
      const uid = decodeURIComponent(u.split('/profile/')[1]);
      return new Response('{}', {status: friends.has(uid) ? 200 : 404});
    }
    if (u.includes('/richmenu')) { menuCalls.push({method: opts.method || 'GET', url: u}); return new Response('{}', {status: 200}); }
    if (u.includes('supabase.co')) return new Response('[]', {status: 200});
    return new Response('{}', {status: 404});
  };
  return {db, tables, menuCalls, fetcher};
}
const UID_A = 'U' + 'a'.repeat(32), UID_B = 'U' + 'b'.repeat(32);
const MENU = 'richmenu-' + 'c'.repeat(32);
const REQ = '33333333-3333-4333-8333-333333333333';

function handlerFor(w, extra = {}) {
  return createV2({url:'https://x.supabase.co', serviceKey:'k', channelId:'CH', fetcher:w.fetcher, db:w.db,
    oaToken:'oa-token', boundMenu:MENU, requireFriend:true, activateKey:'gate-key', ...extra});
}

test('a non-friend joins as pending, and the follow event completes the binding', async () => {
  const w = world({friends: new Set([UID_A])});   // A 是好友，B 不是
  const handle = handlerFor(w);
  const adminHandle = handle;
  const made = await adminHandle('/api/v2/member', {action:'createFamily', accessToken:'tok-a', patientName:'阿嬤', requestId: REQ});
  assert.equal(made.status, 200);
  const invite = await adminHandle('/api/v2/member', {action:'createInvite', accessToken:'tok-a'});
  assert.equal(invite.body.ok, true);

  // B 不是好友：加入 → 待確認，不綁定，也不套用選單
  w.menuCalls.length = 0; // only count what happens to B from here on
  const joined = await handle('/api/v2/member', {action:'joinFamily', accessToken:'tok-b', inviteCode: invite.body.inviteCode});
  assert.equal(joined.body.pending, true);
  assert.equal(joined.body.bound, false);
  assert.equal(w.menuCalls.length, 0);
  assert.equal(w.tables.pending_links.length, 1);
  assert.equal((await handle('/api/v2/member', {action:'memberStatus', accessToken:'tok-b'})).body.bound, false);

  // follow 事件（n8n 轉來）：正式綁定，並套用已綁定選單
  const denied = await handle('/api/v2/activate-pending', {lineUid: UID_B, gatewayKey:'wrong'});
  assert.equal(denied.status, 401);
  const activated = await handle('/api/v2/activate-pending', {lineUid: UID_B, gatewayKey:'gate-key'});
  assert.equal(activated.body.activated, true);
  assert.equal(activated.body.menu, 'linked');
  assert.equal(w.tables.pending_links.length, 0);
  assert.equal((await handle('/api/v2/member', {action:'memberStatus', accessToken:'tok-b'})).body.bound, true);
  // 重複的 follow 不會再綁定
  assert.equal((await handle('/api/v2/activate-pending', {lineUid: UID_B, gatewayKey:'gate-key'})).body.reason, 'none');
});

test('leaving or a deleted family unlinks the rich menu for everyone affected', async () => {
  const w = world({friends: new Set([UID_A, UID_B])});
  const handle = handlerFor(w);
  const made = await handle('/api/v2/member', {action:'createFamily', accessToken:'tok-a', patientName:'阿嬤', requestId: REQ});
  assert.equal(made.body.ok, true, JSON.stringify(made.body));
  const inv = await handle('/api/v2/member', {action:'createInvite', accessToken:'tok-a'});
  const joined = await handle('/api/v2/member', {action:'joinFamily', accessToken:'tok-b', inviteCode: inv.body.inviteCode});
  assert.equal(joined.body.bound, true, JSON.stringify(joined.body));
  assert.equal(joined.body.menu, 'linked');
  assert.ok(w.menuCalls.some(c => c.method === 'POST' && c.url.endsWith('/richmenu/' + MENU)));

  w.menuCalls.length = 0;
  await handle('/api/v2/member', {action:'unbind', accessToken:'tok-b'});
  assert.deepEqual(w.menuCalls.map(c => c.method), ['DELETE']);

  w.menuCalls.length = 0;
  const removed = await handle('/api/v2/member', {action:'deleteFamily', accessToken:'tok-a'});
  assert.equal(removed.body.deleted, true);
  assert.deepEqual(w.menuCalls.map(c => c.method), ['DELETE']);
  assert.equal(removed.body._unlinkUids, undefined); // internal field never reaches the app
});

test('without an OA token the app still works, just without friend checks or menus', async () => {
  const w = world();
  const handle = handlerFor(w, {oaToken:'', requireFriend:true});
  const out = await handle('/api/v2/member', {action:'createFamily', accessToken:'tok-a', patientName:'阿嬤', requestId: REQ});
  assert.equal(out.body.bound, true);
  assert.equal(w.menuCalls.length, 0);
});

const UID_C = 'U' + 'c'.repeat(32);
const SECOND = '44444444-4444-4444-8444-444444444444';

test('deleted family can be restored within three months, only by the one who deleted it', async () => {
  const w = world({friends: new Set([UID_A, UID_B])});
  const handle = handlerFor(w);
  const made = await handle('/api/v2/member', {action:'createFamily', accessToken:'tok-a', patientName:'阿嬤', requestId: REQ});
  const familyId = made.body.familyId;
  await handle('/api/v2/member', {action:'deleteFamily', accessToken:'tok-a'});

  const status = await handle('/api/v2/member', {action:'memberStatus', accessToken:'tok-a'});
  assert.equal(status.body.bound, false);
  assert.equal(status.body.restorable.length, 1);
  assert.equal(status.body.restorable[0].familyId, familyId);

  const restored = await handle('/api/v2/member', {action:'restoreFamily', accessToken:'tok-a', familyId});
  assert.equal(restored.body.ok, true, JSON.stringify(restored.body));
  assert.equal(restored.body.role, 'admin');
  assert.equal((await handle('/api/v2/member', {action:'memberStatus', accessToken:'tok-a'})).body.bound, true);

  // 其他人不能復原；過期也不能復原
  await handle('/api/v2/member', {action:'deleteFamily', accessToken:'tok-a'});
  const other = await handle('/api/v2/member', {action:'restoreFamily', accessToken:'tok-b', familyId});
  assert.equal(other.body.ok, false);
  w.tables.families[0].deleted_at = new Date(Date.now() - 100 * 86400000).toISOString();
  const late = await handle('/api/v2/member', {action:'restoreFamily', accessToken:'tok-a', familyId});
  assert.equal(late.body.ok, false);
});

test('admin can list, remove and promote members; rules protect self and other admins', async () => {
  const w = world({friends: new Set([UID_A, UID_B, UID_C])});
  const handle = handlerFor(w);
  await handle('/api/v2/member', {action:'createFamily', accessToken:'tok-a', patientName:'阿嬤', requestId: REQ});
  const inv = await handle('/api/v2/member', {action:'createInvite', accessToken:'tok-a'});
  await handle('/api/v2/member', {action:'joinFamily', accessToken:'tok-b', inviteCode: inv.body.inviteCode});
  await handle('/api/v2/member', {action:'joinFamily', accessToken:'tok-c', inviteCode: (await handle('/api/v2/member', {action:'createInvite', accessToken:'tok-a'})).body.inviteCode});

  const list = await handle('/api/v2/member', {action:'listMembers', accessToken:'tok-a'});
  assert.equal(list.body.members.length, 3);
  assert.equal(list.body.members.filter(m => m.isSelf).length, 1);
  assert.ok(!JSON.stringify(list.body).includes(UID_B));   // 不回傳 LINE userId
  const bKey = list.body.members.find(m => m.key === require('node:crypto').createHash('sha256').update(UID_B).digest('hex').slice(0,16)).key;
  const cKey = require('node:crypto').createHash('sha256').update(UID_C).digest('hex').slice(0,16);

  const notAdmin = await handle('/api/v2/member', {action:'removeMember', accessToken:'tok-b', memberKey: cKey});
  assert.equal(notAdmin.body.ok, false);

  const promoted = await handle('/api/v2/member', {action:'promoteMember', accessToken:'tok-a', memberKey: bKey});
  assert.equal(promoted.body.ok, true, JSON.stringify(promoted.body));
  assert.equal((await handle('/api/v2/member', {action:'memberStatus', accessToken:'tok-b'})).body.role, 'admin');
  const again = await handle('/api/v2/member', {action:'promoteMember', accessToken:'tok-a', memberKey: bKey});
  assert.equal(again.body.ok, false);                      // already admin
  const self = await handle('/api/v2/member', {action:'removeMember', accessToken:'tok-a', memberKey: require('node:crypto').createHash('sha256').update(UID_A).digest('hex').slice(0,16)});
  assert.equal(self.body.ok, false);                       // never yourself

  const removed = await handle('/api/v2/member', {action:'removeMember', accessToken:'tok-b', memberKey: cKey});
  assert.equal(removed.body.ok, true, JSON.stringify(removed.body));
  assert.equal((await handle('/api/v2/member', {action:'memberStatus', accessToken:'tok-c'})).body.bound, false);
});

test('switching families: a member leaves and joins; an admin must delete first, and the invite is checked before anything is left', async () => {
  const w = world({friends: new Set([UID_A, UID_B])});
  const handle = handlerFor(w);
  await handle('/api/v2/member', {action:'createFamily', accessToken:'tok-a', patientName:'阿嬤', requestId: REQ});
  const toA = await handle('/api/v2/member', {action:'createInvite', accessToken:'tok-a'});
  await handle('/api/v2/member', {action:'createFamily', accessToken:'tok-b', patientName:'爸爸', requestId: SECOND});
  const toB = await handle('/api/v2/member', {action:'createInvite', accessToken:'tok-b'});

  // 管理者 B 要加入 A 的家庭，沒有同意刪除 → 不離開
  const refused = await handle('/api/v2/member', {action:'switchFamily', accessToken:'tok-b', inviteCode: toA.body.inviteCode});
  assert.equal(refused.body.ok, false);
  assert.equal((await handle('/api/v2/member', {action:'memberStatus', accessToken:'tok-b'})).body.bound, true);

  // 一般成員 B 加入 A 的家庭（先讓 B 變成成員）
  await handle('/api/v2/member', {action:'deleteFamily', accessToken:'tok-b'});
  await handle('/api/v2/member', {action:'joinFamily', accessToken:'tok-b', inviteCode: toA.body.inviteCode});
  const bad = await handle('/api/v2/member', {action:'switchFamily', accessToken:'tok-b', inviteCode:'0'.repeat(32)});
  assert.equal(bad.body.ok, false);
  assert.equal((await handle('/api/v2/member', {action:'memberStatus', accessToken:'tok-b'})).body.bound, true); // 無效邀請不離開
  const same = await handle('/api/v2/member', {action:'switchFamily', accessToken:'tok-b', inviteCode: toA.body.inviteCode});
  assert.equal(same.body.ok, false);                        // already a member here
  const switched = await handle('/api/v2/member', {action:'switchFamily', accessToken:'tok-b', inviteCode: toB.body.inviteCode});
  assert.equal(switched.body.ok, false);                    // 邀請碼已被用過（B 不能再次認領）
});
