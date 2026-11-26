'use strict';
// 最小的 Supabase REST 客戶端（PostgREST）。不依賴套件，只用 fetch。
// 只在伺服器端使用：service key 不可以出現在瀏覽器。

function createSupabase({url, serviceKey, fetcher = fetch}) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) || !serviceKey) throw new Error('[CONFIG] 尚未設定 SUPABASE_URL 或 SUPABASE_SERVICE_KEY');
  const headers = {apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json'};

  async function request(method, table, query, body, extra = {}) {
    const qs = new URLSearchParams(query || {}).toString();
    const response = await fetcher(base + '/rest/v1/' + table + (qs ? '?' + qs : ''), {
      method, headers: {...headers, ...extra.headers}, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('[DB] ' + table + ' ' + response.status);
    const text = await response.text();
    return text ? JSON.parse(text) : [];
  }

  return {
    // eq 篩選：select(table, {select:'*', line_uid:'eq.U…'})；欄位值一律用 PostgREST 語法
    select: (table, query) => request('GET', table, query),
    insert: (table, rows) => request('POST', table, {}, rows, {headers: {Prefer: 'return=representation'}}),
    upsert: (table, rows, onConflict) =>
      request('POST', table, {on_conflict: onConflict}, rows, {headers: {Prefer: 'resolution=merge-duplicates,return=representation'}}),
    insertIgnoreDuplicates: (table, rows, onConflict) =>
      request('POST', table, {on_conflict: onConflict}, rows, {headers: {Prefer: 'resolution=ignore-duplicates,return=representation'}}),
    update: (table, query, patch) => request('PATCH', table, query, patch, {headers: {Prefer: 'return=representation'}}),
    remove: (table, query) => request('DELETE', table, query, undefined, {headers: {Prefer: 'return=representation'}})
  };
}

module.exports = {createSupabase};
