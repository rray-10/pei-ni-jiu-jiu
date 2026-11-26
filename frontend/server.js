'use strict';
const http = require('node:http');
const { createHmac, timingSafeEqual, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const gas = path.join(__dirname, '../gas');
const read = (dir, name) => readFileSync(path.join(gas, dir, name + '.html'), 'utf8');
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function https(value) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Expected HTTPS URL');
  return url.href;
}

function render(page, env) {
  const base = https(env.LIFF_ENDPOINT);
  page = ['daily','settings','summary','member','appointments','bind'].includes(page) ? page : 'dashboard';
  const portal = ['member','appointments','bind'].includes(page);
  const titles = {bind:'綁定家庭',member:'會員中心',appointments:'回診管理',dashboard:'健康摘要',summary:'就診摘要',daily:'健康紀錄',settings:'追蹤設定'};
  const titled = markup => markup.replace(/<title>[^<]*<\/title>/,'').replace('</head>','<title>陪你久久｜' + titles[page] + '</title></head>');
  const member = readFileSync(path.join(__dirname,'member.html'),'utf8');
  const controller = readFileSync(path.join(__dirname,'member.js'),'utf8');
  const hasMenu = ['dashboard','summary','daily'].includes(page);
  const shell = '<style>html{background:#f7faf6}body{margin:0;background:#f7faf6;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;color:#25362e}' +
    (hasMenu ? '' : '.sidebar,.menu-btn,.scrim,.daily-nav,.wrap>.brand{display:none!important}.content{margin-left:0!important}') +
    '</style>';
  const gate = '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>' + shell + member +
    '<script>window.MEMBER_CONFIG=' + scriptJSON({liffId:env.LIFF_ID,page,module:!portal,links:{
      '健康摘要':base,'每日紀錄':base+'?page=daily','會員中心':base+'?page=member',
      '回到 LINE 官方帳號':https(env.LINE_CHAT_URL || env.NAV_APPOINTMENTS_URL)
    }}) + ';' + controller + '</script>';
  const sdk = '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>';
  const gated = markup => titled(markup).replace(sdk,'').replace('<body>','<body>'+gate+'<div id="hubModule" hidden>')
    .replace('</body>','</div></body>');
  if (portal) return titled('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'+gate+'</body></html>');
  const config = {
    liffId: env.LIFF_ID || '',
    apiUrl: '/api/dashboard',
    page,
    devMode: false,
    nav: {
      dashboard: base,
      daily: base + '?page=daily',
      settings: base + '?page=settings',
      member: base + '?page=member',
      summary: base + '?page=summary',
      medication: https(env.NAV_MEDICATION_URL),
      appointments: '' // 尚未完成（需 n8n），選單顯示為不可點
    }
  };
  const fillNav = markup => markup
    .replace(/<\?= config\.nav\.(\w+) \|\| '([^']*)' \?>/g, (_, key, fallback) => escape(config.nav[key] || fallback))
    .replace(/<\?= config\.nav\.(\w+) \? '' : 'disabled' \?>/g, (_, key) => config.nav[key] ? '' : 'disabled');
  // 每日紀錄沿用健康摘要的同一份漢堡選單
  const withMenu = markup => markup
    .replace('<!--hub-menu-->', '<button type="button" class="menu-btn" id="menuBtn" aria-expanded="false" aria-label="開啟選單" aria-controls="sidebar">☰</button>')
    .replace('</head>', () => '<style>:root{--green:#38775c;--light:#eaf4ed;--ink:#25362e;--muted:#697b72;--line:#dce7df}@media(min-width:801px){body{padding-left:220px}}</style>' + read('dashboard','NavStyles') + '</head>')
    .replace('</body>', () => fillNav(read('dashboard','NavMenu')).replace(' aria-current="page"','').replace('id="navDaily"','id="navDaily" aria-current="page"') + read('dashboard','NavScripts') + '</body>');
  if (page === 'daily' || page === 'settings') {
    const daily = read('daily', page === 'daily' ? 'Index' : 'Settings')
      .replace('<?!= JSON.stringify(app) ?>', () => scriptJSON({
        liffId: config.liffId, apiUrl: '/api/daily', dashboardUrl:base, lineChatUrl: https(env.LINE_CHAT_URL)
      }));
    return gated(page === 'daily' ? withMenu(daily) : daily);
  }
  return gated(fillNav(read('dashboard', 'Index')
    .replace(/<\?!= include\('([A-Za-z]+)'\) \?>/g, (_, name) => read('dashboard', name))
    .replace(/<\?!= JSON.stringify\(config\).*?\?>/, () => scriptJSON(config))
    .replace(/<\? if \(config.liffId\) \{ \?>(.*?)<\? \} \?>/, '$1')));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validSignature(body, signature, secret) {
  if (!secret || typeof signature !== 'string') return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(signature, 'base64');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const WEB_PATHS = new Set(['/api/member', '/api/daily', '/api/dashboard']);

// 網頁動作 → Supabase 版路徑（沒有列出的動作留在 GAS）
function webToV2(pathname, action) {
  if (pathname === '/api/member') return '/api/v2/member';
  if (pathname === '/api/daily') return {read:'/api/v2/daily/read', record:'/api/v2/daily/record', update:'/api/v2/daily/update'}[action] || null;
  if (pathname === '/api/dashboard') return {getHubData:'/api/v2/dashboard/hub', getDashboardData:'/api/v2/dashboard'}[action] || null;
  return null;
}

function createServer(env = process.env, fetcher = fetch) {
  const endpoint = https(env.LIFF_ENDPOINT);
  if (!endpoint || !env.LIFF_ID) throw new Error('LIFF_ENDPOINT and LIFF_ID are required');
  // Short-lived PDF hand-off: LINE's in-app browser cannot save blob: downloads, so the PDF is served from a random one-use-window URL.
  const pdfs = new Map();
  const PDF_TTL_MS = 3 * 60 * 1000;
  const storePdf = (filename, bytes) => {
    const now = Date.now();
    for (const [key, item] of pdfs) if (item.expires < now) pdfs.delete(key);
    if (pdfs.size >= 50) pdfs.delete(pdfs.keys().next().value);
    const id = randomBytes(16).toString('hex');
    pdfs.set(id, {filename, bytes, expires: now + PDF_TTL_MS});
    return id;
  };
  const upstreams = {
    '/api/daily': https(env.F1_API_URL),
    '/api/member': https(env.MEMBER_GAS_URL || env.F1_API_URL),
    '/api/dashboard': https(env.DASHBOARD_GAS_URL),
    '/line/events': https(env.LINE_MAIN_WEBHOOK_URL)
  };
  // Supabase 版 API（/api/v2/*）：只有設定 SUPABASE_URL 才啟用，和 GAS 並行，尚未切換。
  const v2 = env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY
    ? require('../backend/v2.js').createV2({url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY,
        channelId: env.LINE_LOGIN_CHANNEL_ID, fetcher, oaToken: env.LINE_OA_ACCESS_TOKEN || '',
        boundMenu: env.BOUND_RICH_MENU_ID || '', requireFriend: env.REQUIRE_OA_FRIEND === 'true',
        activateKey: env.ACTIVATE_GATEWAY_KEY || ''})
    : null;
  return http.createServer(async (req, res) => {
    const send = (status, type, data) => {
      res.writeHead(status, {'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
      res.end(data);
    };
    const json = (status, data) => send(status, 'application/json; charset=utf-8', JSON.stringify(data));
    try {
      const url = new URL(req.url, endpoint);
      if (req.method === 'GET' && url.pathname === new URL(endpoint).pathname) {
        const page = url.searchParams.get('page');
        return send(200, 'text/html; charset=utf-8', render(page, env));
      }
      // 確認目前跑的是哪一套後端：node+supabase 或 gas
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const backend = env.USE_V2_WEB === 'true' && env.SUPABASE_URL ? 'node+supabase' : 'gas';
        return json(200, {ok:true, backend, commit: String(env.RENDER_GIT_COMMIT || '').slice(0,7) || 'local'});
      }
      const pdfMatch = req.method === 'GET' && /^\/pdf\/([0-9a-f]{32})$/.exec(url.pathname);
      if (pdfMatch) {
        const item = pdfs.get(pdfMatch[1]);
        if (!item || item.expires < Date.now()) return json(404, {ok:false});
        res.writeHead(200, {'Content-Type':'application/pdf','Content-Length':item.bytes.length,'Cache-Control':'no-store',
          'Content-Disposition':"attachment; filename*=UTF-8''" + encodeURIComponent(item.filename),'X-Content-Type-Options':'nosniff'});
        return res.end(item.bytes);
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/v2/')) {
        if (!v2) return json(503, {ok:false,error:'[CONFIG] 尚未設定 Supabase'});
        if (req.headers.origin !== new URL(endpoint).origin) return json(403, {ok:false});
        let body;
        try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return json(400, {ok:false,error:'格式錯誤'}); }
        const out = await v2(url.pathname, body);
        return json(out.status, out.body);
      }
      if (req.method !== 'POST' || !Object.hasOwn(upstreams, url.pathname)) return json(404, {ok:false});
      let rawBody = null; // 已讀取的內容，讓後面的 GAS 轉送可以重用
      // 網頁的 API 可切到 Supabase 版（USE_V2_WEB=true）。沒有對應的 v2 動作（例如 PDF）仍走 GAS。
      if (env.USE_V2_WEB === 'true' && v2 && WEB_PATHS.has(url.pathname)) {
        if (req.headers.origin !== new URL(endpoint).origin) return json(403, {ok:false});
        rawBody = await readBody(req);
        let parsed;
        try { parsed = JSON.parse(rawBody.toString('utf8') || '{}'); } catch { return json(400, {ok:false,error:'格式錯誤'}); }
        const target = webToV2(url.pathname, parsed.action);
        if (target) {
          const out = await v2(target, parsed);
          return json(out.status, out.body);
        }
      }
      const upstream = upstreams[url.pathname];
      if (!upstream) return json(503, {ok:false,error:'[CONFIG] 尚未設定服務'});
      const headers = {'Content-Type':'application/json'};
      if (url.pathname !== '/line/events' && req.headers.origin !== new URL(endpoint).origin) return json(403, {ok:false});
      const body = rawBody || await readBody(req);
      if (url.pathname === '/line/events') {
        if (!validSignature(body, req.headers['x-line-signature'], env.LINE_MESSAGING_CHANNEL_SECRET)) return json(401, {ok:false});
        if (!env.LINE_WEBHOOK_GATEWAY_KEY) return json(503, {ok:false});
        headers['X-Hub-Gateway-Key'] = env.LINE_WEBHOOK_GATEWAY_KEY;
      }
      const response = await fetcher(upstream, {method:'POST', headers, body, redirect:'manual', signal:AbortSignal.timeout(55000)});
      if (url.pathname === '/line/events') return json(response.ok ? 200 : 502, {ok:response.ok});
      let result = response;
      if (response.status === 302 || response.status === 303) {
        const location = new URL(response.headers.get('location'), upstream);
        if (new URL(upstream).hostname !== 'script.google.com' || location.origin !== 'https://script.googleusercontent.com') return json(502, {ok:false});
        result = await fetcher(location, {redirect:'error',signal:AbortSignal.timeout(55000)});
      }
      const payload = await result.json();
      if (payload && payload.detail !== undefined) {
        console.error(url.pathname, payload.error, payload.detail); // diagnostics stay server-side
        delete payload.detail;
      }
      const generated = url.pathname === '/api/dashboard' && payload && payload.ok && payload.data && typeof payload.data.base64 === 'string';
      if (generated) {
        const id = storePdf(String(payload.data.filename || 'summary.pdf'), Buffer.from(payload.data.base64, 'base64'));
        return json(result.status, {ok:true,data:{filename:payload.data.filename,url:new URL('/pdf/' + id, endpoint).href}});
      }
      return json(result.status, payload);
    } catch {
      return json(502, {ok:false,error:'服務暫時無法完成操作'});
    }
  });
}

if (require.main === module) createServer().listen(Number(process.env.PORT || 8080));
module.exports = { createServer, render, validSignature };
