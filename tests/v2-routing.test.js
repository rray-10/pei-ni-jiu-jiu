const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createServer} = require('../frontend/server.js');

const UID = 'U' + 'a'.repeat(32);
const ENDPOINT = 'https://hub.example.test';

// 假的 LINE、Supabase 與 GAS：依網址回應；GAS 被呼叫就記下來
function fakeWorld() {
  const gasCalls = [];
  const fetcher = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/oauth2/v2.1/verify')) return new Response(JSON.stringify({client_id:'CH', expires_in:600}));
    if (u.endsWith('/v2/profile')) return new Response(JSON.stringify({userId: UID}));
    if (u.includes('/rest/v1/families')) return new Response(JSON.stringify([{family_id:'F_mine', patient_name:'阿嬤', birth_year:1956, conditions:'高血壓', allergies:null, deleted_at:null}]));
    if (u.includes('/rest/v1/members')) return new Response(JSON.stringify([{family_id:'F_mine', line_uid:UID, role:'admin', display_name:'我'}]));
    if (u.includes('/rest/v1/family_patients')) return new Response(JSON.stringify([{family_id:'F_mine', patient_id:'P_mine'}]));
    if (u.includes('/rest/v1/metric_definitions')) return new Response(JSON.stringify([{metric_key:'blood_pressure', metric_name:'血壓', input_type:'bloodPressure', unit:'mmHg', is_active:true}]));
    if (u.includes('/rest/v1/tracking_settings')) return new Response(JSON.stringify([{metric_key:'blood_pressure', enabled:true, systolic_high:140}]));
    if (u.includes('script.google.com')) { gasCalls.push(u); return new Response(JSON.stringify({ok:true,from:'gas'})); }
    return new Response('[]', {status:200});
  };
  return {fetcher, gasCalls};
}

function env(extra = {}) {
  return {LIFF_ENDPOINT: ENDPOINT + '/', LIFF_ID: 'fixture', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k',
    LINE_LOGIN_CHANNEL_ID: 'CH', F1_API_URL: 'https://script.google.com/macros/s/AAA/exec',
    MEMBER_GAS_URL: 'https://script.google.com/macros/s/AAA/exec', DASHBOARD_GAS_URL: 'https://script.google.com/macros/s/BBB/exec', ...extra};
}

async function call(server, path, body) {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const res = await fetch(base + path, {method:'POST', headers:{'Content-Type':'application/json', Origin: ENDPOINT},
      body: JSON.stringify(body)});
    return {status: res.status, body: await res.json()};
  } finally { server.close(); }
}

test('with USE_V2_WEB=true the daily read goes to Supabase, not GAS', async () => {
  const world = fakeWorld();
  const server = createServer(env({USE_V2_WEB:'true'}), world.fetcher);
  const out = await call(server, '/api/daily', {action:'read', accessToken:'tok'});
  assert.equal(out.status, 200);
  assert.equal(out.body.familyId, 'F_mine');
  assert.equal(out.body.metrics[0].metricKey, 'blood_pressure');
  assert.equal(out.body.metrics[0].systolicHigh, 140);
  assert.equal(out.body.settings.blood_pressure, true);
  assert.equal(world.gasCalls.length, 0);
});

test('without the flag the same request still goes to GAS', async () => {
  const world = fakeWorld();
  const server = createServer(env(), world.fetcher);
  const out = await call(server, '/api/daily', {action:'read', accessToken:'tok'});
  assert.equal(out.body.from, 'gas');
  assert.equal(world.gasCalls.length, 1);
});

test('actions without a v2 version stay on GAS even with the flag on', async () => {
  const world = fakeWorld();
  const server = createServer(env({USE_V2_WEB:'true'}), world.fetcher);
  const out = await call(server, '/api/dashboard', {action:'someLegacyAction', idToken:'tok', days:7});
  assert.equal(out.body.from, 'gas');
  assert.equal(world.gasCalls.length, 1);
});

test('the visit PDF is generated in Node and handed out as a short-lived download URL', async () => {
  const world = fakeWorld();
  const server = createServer(env({USE_V2_WEB:'true'}), world.fetcher);
  const out = await call(server, '/api/dashboard', {action:'generateVisitPdf', idToken:'tok', days:7});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(world.gasCalls.length, 0);
  assert.equal(out.body.data.base64, undefined);
  assert.match(out.body.data.filename, /健康摘要_P_mine_7天\.pdf$/);
  const path = new URL(out.body.data.url).pathname;
  await new Promise(r => { server.listen(0, r); });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const file = await fetch(base + path);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(bytes.length > 2000);
  } finally { server.close(); }
});

test('/api/status says which backend is serving', async () => {
  const get = async (e) => {
    const server = createServer(e, fakeWorld().fetcher);
    await new Promise(r => server.listen(0, r));
    try { return await (await fetch('http://127.0.0.1:' + server.address().port + '/api/status')).json(); }
    finally { server.close(); }
  };
  assert.equal((await get(env({USE_V2_WEB:'true', RENDER_GIT_COMMIT:'abcdef123456'}))).backend, 'node+supabase');
  const gas = await get(env());
  assert.equal(gas.backend, 'gas');
  assert.equal(gas.commit, 'local');
});
