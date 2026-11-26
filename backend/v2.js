'use strict';
// /api/v2/*：Supabase 版路由（與 GAS 並行，尚未切換）。
const {timingSafeEqual} = require('node:crypto');
const {createSupabase} = require('./supabase-client.js');
const {createLineAuth} = require('./line-auth.js');
const {createLineOa} = require('./line-oa.js');
const {loadDashboard} = require('./dashboard.js');
const {writeDaily} = require('./daily.js');
const membership = require('./membership.js');
const settings = require('./settings.js');

// 這些動作會改變「誰已綁定」，之後要同步 Rich Menu
const MENU_ACTIONS = new Set(['createFamily', 'joinFamily', 'unbind', 'deleteFamily', 'restoreFamily', 'switchFamily', 'removeMember']);

function sameSecret(given, expected) {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createV2({url, serviceKey, channelId, fetcher = fetch, oaToken = '', boundMenu = '', requireFriend = false,
  activateKey = '', db: injectedDb = null}) {
  // injectedDb 只給測試使用；正式環境一律用 Supabase
  const db = injectedDb || createSupabase({url, serviceKey, fetcher});
  const auth = createLineAuth({channelId, fetcher});
  const oa = createLineOa({token: oaToken, boundMenu, fetcher});

  // 綁定／解除後同步 Rich Menu（失敗不影響資料）
  async function syncMenu(result, fallbackUid) {
    const unlink = Array.isArray(result._unlinkUids) ? result._unlinkUids : [];
    delete result._unlinkUids;
    for (const uid of unlink) await oa.unlinkBound(uid);
    if (result.bound === true && result.familyId) {
      result.menu = await oa.linkBound(fallbackUid);
    }
    return result;
  }

  async function memberAction(action, uid, body) {
    const deps = {db, uid, body, oa, requireFriend: requireFriend && oa.enabled};
    const actions = {
      restoreFamily: () => membership.restoreFamily(deps),
      listMembers: () => membership.listMembers({db, uid}),
      removeMember: () => membership.removeMember({db, uid, body}),
      promoteMember: () => membership.promoteMember({db, uid, body}),
      switchFamily: () => membership.switchFamily(deps),
      memberStatus: () => membership.memberStatus({db, uid}),
      createFamily: () => membership.createFamily(deps),
      createInvite: () => membership.createInvite({db, uid}),
      previewInvite: () => membership.previewInvite({db, uid, body}),
      joinFamily: () => membership.joinFamily(deps),
      unbind: () => membership.unbind({db, uid}),
      deleteFamily: () => membership.deleteFamily({db, uid})
    };
    if (!actions[action]) return null;
    const result = await actions[action]();
    return MENU_ACTIONS.has(action) ? syncMenu(result, uid) : result;
  }

  // 回傳 {status, body}；錯誤一律是 {ok:false,error}，不回傳內部細節
  return async function handle(path, body) {
    try {
      if (path === '/api/v2/activate-pending') {
        // 由 n8n 的 follow 分支呼叫，驗 gateway key；不使用 LIFF token
        if (!sameSecret(body.gatewayKey, activateKey)) return {status: 401, body: {ok: false, error: '未授權'}};
        const uid = String(body.lineUid || '');
        if (!/^U[0-9a-f]{32}$/.test(uid)) return {status: 400, body: {ok: false, error: 'userId 無效'}};
        const result = await membership.activatePending({db, uid});
        if (result.activated) result.menu = await oa.linkBound(uid);
        return {status: 200, body: result};
      }
      const lineUid = await auth.verify(body.accessToken || body.idToken);
      if (path === '/api/v2/dashboard') {
        const days = Number(body.days || 7);
        if (![7, 30, 90].includes(days)) return {status: 400, body: {ok: false, error: '期間無效'}};
        return {status: 200, body: {ok: true, data: await loadDashboard({db, lineUid, days})}};
      }
      if (path === '/api/v2/daily/record') return {status: 200, body: await writeDaily({db, lineUid, body})};
      if (path === '/api/v2/daily/read') return {status: 200, body: await settings.readSettings({db, uid: lineUid})};
      if (path === '/api/v2/daily/update') return {status: 200, body: await settings.updateSettings({db, uid: lineUid, body})};
      if (path === '/api/v2/dashboard/hub') {
        // 與 GAS getHubData 相同的形狀：{context, dashboard, meta}
        const days = Number(body.days || 7);
        if (![7, 30, 90].includes(days)) return {status: 400, body: {ok: false, error: '期間無效'}};
        const dashboard = await loadDashboard({db, lineUid, days});
        const me = await membership.memberStatus({db, uid: lineUid});
        const context = {familyId: me.familyId, role: me.role, patients: [{id: dashboard.patient.id, name: dashboard.patient.name, role: me.role}]};
        return {status: 200, body: {ok: true, data: {context, dashboard, meta: {devMode: false, timings: {}}}}};
      }
      if (path === '/api/v2/member') {
        const out = await memberAction(body.action, lineUid, body);
        if (!out) return {status: 400, body: {ok: false, error: '操作無效'}};
        return {status: 200, body: {ok: true, ...out}};
      }
      return {status: 404, body: {ok: false}};
    } catch (err) {
      if (err.status === 401) return {status: 401, body: {ok: false, error: err.message}};
      if (err.code === 'BAD_REQUEST') return {status: 400, body: {ok: false, error: err.message}};
      if (err.code === 'NOT_MEMBER' || err.code === 'FORBIDDEN' || err.code === 'UNAVAILABLE' || err.code === 'CONFIG' || err.code === 'BAD_REQUEST') {
        return {status: 200, body: {ok: false, error: err.message}};
      }
      console.error('v2 failed:', path, err.message); // 細節只留在伺服器
      return {status: 502, body: {ok: false, error: '服務暫時無法完成操作'}};
    }
  };
}

module.exports = {createV2};
