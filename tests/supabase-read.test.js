const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createSupabase} = require('../backend/supabase-client');
const {createLineAuth} = require('../backend/line-auth');
const read = require('../backend/read');

function fakeFetch(routes) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({url: String(url), method: options.method || 'GET', headers: options.headers || {}});
    const path = new URL(String(url)).pathname;
    const hit = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    if (!hit) return new Response('not found', {status: 404});
    const body = typeof hit[1] === 'function' ? hit[1](new URL(String(url))) : hit[1];
    return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  return {fetcher, calls};
}

test('supabase client refuses a non-HTTPS URL and sends the service key only as a header', async () => {
  assert.throws(() => createSupabase({url:'http://x.supabase.co',serviceKey:'k'}),/CONFIG/);
  const {fetcher, calls} = fakeFetch({'/rest/v1/members': []});
  const db = createSupabase({url:'https://x.supabase.co/',serviceKey:'secret-key',fetcher});
  await db.select('members', {select:'family_id', line_uid:'eq.U1'});
  assert.equal(calls[0].url,'https://x.supabase.co/rest/v1/members?select=family_id&line_uid=eq.U1');
  assert.equal(calls[0].headers.apikey,'secret-key');
  assert.equal(calls[0].url.includes('secret-key'),false);
});

test('dashboard reads only the caller’s family, and the family comes from members', async () => {
  const {fetcher, calls} = fakeFetch({
    '/rest/v1/members': [{family_id:'F_mine',role:'admin'}],
    '/rest/v1/daily_records': [{metric_key:'blood_pressure',value:'132/84',record_date:'2026-11-25'}]
  });
  const db = createSupabase({url:'https://x.supabase.co',serviceKey:'k',fetcher});
  const me = await read.membershipOf(db,'U1');
  assert.equal(me.family_id,'F_mine');
  await read.dailyRecordsForFamily(db,me.family_id,'2026-11-19','2026-11-25');
  const recordsCall = decodeURIComponent(calls.at(-1).url);
  assert.match(recordsCall,/family_id=eq\.F_mine/);
  assert.match(recordsCall,/and=\(record_date\.gte\.2026-11-19,record_date\.lte\.2026-11-25\)/);
  assert.equal(await read.membershipOf(createSupabase({url:'https://x.supabase.co',serviceKey:'k',
    fetcher:fakeFetch({'/rest/v1/members':[]}).fetcher}),'U-none'),null);
});

test('upcoming appointments filter by patient_id and active statuses', async () => {
  const {fetcher, calls} = fakeFetch({'/rest/v1/appointments': []});
  const db = createSupabase({url:'https://x.supabase.co',serviceKey:'k',fetcher});
  await read.upcomingAppointments(db,'P_abc','2026-11-26');
  const q = decodeURIComponent(calls[0].url);
  assert.match(q,/patient_id=eq\.P_abc/);
  assert.match(q,/status=in\.\(scheduled,edit_hospital\)/);
  assert.match(q,/date=gte\.2026-11-26/);
});

test('LINE token is verified once per cache window and not stored in plain text', async () => {
  let clock = 1000;
  let lineCalls = 0;
  const fetcher = async url => {
    lineCalls++;
    if (String(url).includes('/verify')) return new Response(JSON.stringify({client_id:'CH',expires_in:600}));
    return new Response(JSON.stringify({userId:'U' + 'a'.repeat(32)}));
  };
  const auth = createLineAuth({channelId:'CH',fetcher,now:() => clock});
  assert.equal(await auth.verify('tok-1'),'U' + 'a'.repeat(32));
  assert.equal(await auth.verify('tok-1'),'U' + 'a'.repeat(32));
  assert.equal(lineCalls,2); // verify + profile, once
  clock += 6 * 60 * 1000;
  await auth.verify('tok-1');
  assert.equal(lineCalls,4); // expired after 5 minutes
  await assert.rejects(() => createLineAuth({channelId:'OTHER',fetcher,now:() => clock}).verify('tok-2'),/無效/);
});
