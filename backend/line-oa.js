'use strict';
// 官方帳號（Messaging API）：好友確認、Rich Menu 綁定與解除。需要 LINE_OA_ACCESS_TOKEN（只放在伺服器）。

const menuIdOk = value => /^richmenu-[0-9a-zA-Z]+$/.test(String(value || ''));

function createLineOa({token, boundMenu, fetcher = fetch}) {
  const auth = {Authorization: 'Bearer ' + token};
  const enabled = !!token;

  // 200 = 好友，404 = 不是好友或已封鎖；其他狀況丟錯（不能把「不確定」當成「不是好友」）
  async function isFriend(uid) {
    if (!enabled) throw Object.assign(new Error('[CONFIG] 尚未設定官方帳號憑證'), {code: 'CONFIG'});
    const res = await fetcher('https://api.line.me/v2/bot/profile/' + encodeURIComponent(uid), {headers: auth,
      signal: AbortSignal.timeout(8000)});
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw Object.assign(new Error('暫時無法確認官方帳號好友狀態，請稍後再試'), {code: 'UNAVAILABLE'});
  }

  // 綁定後套用「已綁定」選單；失敗不影響綁定本身（之後可重試）
  async function linkBound(uid) {
    if (!enabled || !menuIdOk(boundMenu)) return 'unconfigured';
    try {
      const res = await fetcher('https://api.line.me/v2/bot/user/' + encodeURIComponent(uid) + '/richmenu/' + encodeURIComponent(boundMenu),
        {method: 'POST', headers: auth, signal: AbortSignal.timeout(8000)});
      return res.ok ? 'linked' : 'retry';
    } catch (_) { return 'retry'; }
  }

  // 解除綁定後移除個人選單，回到官方預設（未綁定）選單
  async function unlinkBound(uid) {
    if (!enabled) return 'unconfigured';
    try {
      const res = await fetcher('https://api.line.me/v2/bot/user/' + encodeURIComponent(uid) + '/richmenu',
        {method: 'DELETE', headers: auth, signal: AbortSignal.timeout(8000)});
      return res.ok ? 'unlinked' : 'retry';
    } catch (_) { return 'retry'; }
  }

  return {enabled, isFriend, linkBound, unlinkBound};
}

module.exports = {createLineOa};
