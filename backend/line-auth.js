'use strict';
// LIFF access token 驗證（與 GAS 的 f1Identity_ 相同規則），結果快取 5 分鐘。
// 快取鍵是 token 的 SHA-256 雜湊，記憶體內不存明文 token。
const {createHash} = require('node:crypto');

const TTL_MS = 5 * 60 * 1000;

function createLineAuth({channelId, fetcher = fetch, now = () => Date.now()}) {
  const cache = new Map();
  const keyOf = token => createHash('sha256').update(token).digest('hex');

  async function verify(token) {
    if (typeof token !== 'string' || !token || !channelId) throw Object.assign(new Error('請重新登入 LINE'), {status: 401});
    const key = keyOf(token);
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.uid;

    const verifyRes = await fetcher('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(token),
      {signal: AbortSignal.timeout(8000)});
    if (!verifyRes.ok) throw Object.assign(new Error('LINE 登入憑證已失效'), {status: 401});
    const verified = await verifyRes.json();
    if (String(verified.client_id) !== String(channelId) || !(verified.expires_in > 0)) {
      throw Object.assign(new Error('LINE 登入憑證無效'), {status: 401});
    }
    const profileRes = await fetcher('https://api.line.me/v2/profile', {headers: {Authorization: 'Bearer ' + token},
      signal: AbortSignal.timeout(8000)});
    if (!profileRes.ok) throw Object.assign(new Error('無法取得 LINE 身分'), {status: 401});
    const uid = (await profileRes.json()).userId;
    if (!uid) throw Object.assign(new Error('無法取得 LINE 身分'), {status: 401});

    // 快取時間不超過 token 本身的剩餘有效期
    const ttl = Math.min(TTL_MS, Number(verified.expires_in) * 1000);
    cache.set(key, {uid, expires: now() + ttl});
    return uid;
  }

  return {verify, _cacheSize: () => cache.size};
}

module.exports = {createLineAuth};
