'use strict';
// /api/v2/*：Supabase 版路由（與 GAS 並行，尚未切換）。
const {createSupabase} = require('./supabase-client.js');
const {createLineAuth} = require('./line-auth.js');
const {loadDashboard} = require('./dashboard.js');
const {writeDaily} = require('./daily.js');
const membership = require('./membership.js');

function createV2({url, serviceKey, channelId, fetcher = fetch}) {
  const db = createSupabase({url, serviceKey, fetcher});
  const auth = createLineAuth({channelId, fetcher});

  // 回傳 {status, body}；錯誤一律是 {ok:false,error}，不回傳內部細節
  return async function handle(path, body) {
    try {
      const lineUid = await auth.verify(body.accessToken || body.idToken);
      if (path === '/api/v2/dashboard') {
        const days = Number(body.days || 7);
        if (![7, 30, 90].includes(days)) return {status: 400, body: {ok: false, error: '期間無效'}};
        return {status: 200, body: {ok: true, data: await loadDashboard({db, lineUid, days})}};
      }
      if (path === '/api/v2/daily/record') return {status: 200, body: await writeDaily({db, lineUid, body})};
      if (path === '/api/v2/member') {
        const actions = {memberStatus: membership.memberStatus, createFamily: membership.createFamily,
          createInvite: membership.createInvite, previewInvite: membership.previewInvite,
          joinFamily: membership.joinFamily, unbind: membership.unbind, deleteFamily: membership.deleteFamily};
        const run = actions[body.action];
        if (!run) return {status: 400, body: {ok: false, error: '操作無效'}};
        return {status: 200, body: await run({db, uid: lineUid, body})};
      }
      return {status: 404, body: {ok: false}};
    } catch (err) {
      if (err.status === 401) return {status: 401, body: {ok: false, error: err.message}};
      if (err.code === 'BAD_REQUEST') return {status: 400, body: {ok: false, error: err.message}};
      if (err.code === 'NOT_MEMBER' || err.code === 'FORBIDDEN') return {status: 200, body: {ok: false, error: err.message}};
      console.error('v2 failed:', path, err.message); // 細節只留在伺服器
      return {status: 502, body: {ok: false, error: '服務暫時無法完成操作'}};
    }
  };
}

module.exports = {createV2};
