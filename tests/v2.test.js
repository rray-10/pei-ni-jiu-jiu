const {test} = require('node:test');
const assert = require('node:assert/strict');
const {writeDaily} = require('../backend/daily.js');
const {loadDashboard} = require('../backend/dashboard.js');
const {createV2} = require('../backend/v2.js');

const UID = 'U' + 'a'.repeat(32);
const NOW = Date.parse('2026-11-26T04:00:00Z'); // 台北 2026-11-26 12:00
const REQ = '11111111-1111-4111-8111-111111111111';

function fakeDb(tables) {
  const inserted = [];
  const queries = [];
  return {
    inserted, queries,
    async select(table, query) {
      queries.push({table, query});
      const rows = tables[table] || [];
      const out = rows.filter(row => Object.entries(query).every(([col, expr]) => {
        if (['select','order','limit','and'].includes(col)) return true;
        const m = /^eq\.(.*)$/.exec(expr);
        if (m) return String(row[col]) === m[1];
        if (expr === 'is.null') return row[col] == null || row[col] === '';
        return true;
      }));
      return query.limit ? out.slice(0, Number(query.limit)) : out;
    },
    async insertIgnoreDuplicates(table, rows) { inserted.push({table, rows}); return rows; }
  };
}

const baseTables = {
  members: [{family_id:'F_mine', line_uid:UID, role:'admin', display_name:'我'}],
  tracking_settings: [{family_id:'F_mine', metric_key:'blood_pressure', enabled:true}, {family_id:'F_mine', metric_key:'blood_glucose', enabled:false}],
  metric_definitions: [
    {metric_key:'blood_pressure', metric_name:'血壓', input_type:'bloodPressure', unit:'mmHg', is_active:true},
    {metric_key:'blood_glucose', metric_name:'血糖', input_type:'number', unit:'mg/dL', is_active:true}
  ]
};

test('daily write saves only enabled items with the same validation rules as GAS', async () => {
  const db = fakeDb(baseTables);
  const out = await writeDaily({db, lineUid:UID, nowMs:NOW, body:{requestId:REQ, recordDate:'2026-11-26', period:'morning',
    values:{blood_pressure:'132/84'}, note:'飯後'}});
  assert.equal(out.savedCount,1);
  const row = db.inserted[0].rows[0];
  assert.equal(row.record_id,'F_mine:' + UID + ':' + REQ + ':blood_pressure');
  assert.equal(row.value,'132/84');
  assert.equal(row.value_systolic,132);
  assert.equal(row.value_diastolic,84);
  assert.equal(row.family_id,'F_mine');       // family from members, never from the body
  assert.equal(row.note,'飯後');

  await assert.rejects(() => writeDaily({db,lineUid:UID,nowMs:NOW,body:{requestId:REQ,recordDate:'2026-11-26',period:'morning',values:{blood_glucose:100}}}),/未啟用/);
  await assert.rejects(() => writeDaily({db,lineUid:UID,nowMs:NOW,body:{requestId:REQ,recordDate:'2026-11-26',period:'morning',values:{blood_pressure:'222/258'}}}),/血壓數值不合理/);
  await assert.rejects(() => writeDaily({db,lineUid:UID,nowMs:NOW,body:{requestId:'x',recordDate:'2026-11-26',period:'morning',values:{blood_pressure:'120/80'}}}),/請重新送出/);
  await assert.rejects(() => writeDaily({db,lineUid:'U' + 'b'.repeat(32),nowMs:NOW,body:{requestId:REQ,recordDate:'2026-11-26',period:'morning',values:{blood_pressure:'120/80'}}}),/尚未加入/);
});

test('dashboard reads only the caller’s family and filters by record date', async () => {
  const db = fakeDb({
    ...baseTables,
    families: [{family_id:'F_mine', patient_name:'阿嬤'}, {family_id:'F_other', patient_name:'別人'}],
    family_patients: [{family_id:'F_mine', patient_id:'P_mine'}],
    daily_records: [
      {record_id:'a', family_id:'F_mine', patient_id:'P_mine', metric_key:'blood_pressure', metric_name:'血壓', value:'124/78', value_systolic:124, value_diastolic:78, record_date:'2026-11-25', recorded_at:'2026-11-25T01:00:00Z', is_recorded:true, source:'LIFF'},
      {record_id:'b', family_id:'F_other', metric_key:'blood_pressure', value:'180/110', value_systolic:180, value_diastolic:110, record_date:'2026-11-25', recorded_at:'2026-11-25T02:00:00Z', is_recorded:true, source:'LIFF'}
    ],
    appointments: []
  });
  const data = await loadDashboard({db, lineUid:UID, days:7, nowMs:NOW});
  assert.equal(data.latestBP.systolic,124);       // the other family's 180/110 never appears
  assert.equal(data.patient.name,'阿嬤');
  const recordQuery = db.queries.find(q => q.table === 'daily_records').query;
  assert.equal(recordQuery.family_id,'eq.F_mine');
  assert.match(recordQuery.and,/record_date\.gte\.2026-11-20/);
  await assert.rejects(() => loadDashboard({db, lineUid:'U' + 'c'.repeat(32), days:7, nowMs:NOW}),/尚未加入/);
});

test('v2 router rejects a bad token and never leaks database detail', async () => {
  const fetcher = async url => {
    if (String(url).includes('/verify')) return new Response(JSON.stringify({client_id:'CH',expires_in:0}));
    throw new Error('should not reach the database');
  };
  const handle = createV2({url:'https://x.supabase.co', serviceKey:'k', channelId:'CH', fetcher});
  const out = await handle('/api/v2/dashboard', {accessToken:'bad', days:7});
  assert.equal(out.status,401);
  assert.equal(JSON.stringify(out.body).includes('supabase'),false);
});
