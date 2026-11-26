const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createServer, render } = require('../frontend/server');
const workflow = require('../n8n/main-flow.json');
const flowNode = name => workflow.nodes.find(node => node.name === name);

const env = {LIFF_ENDPOINT:'https://hub.example.test/', LIFF_ID:'fixture-app'};

test('top-level LIFF renders original daily, settings, dashboard and summary shells', () => {
  for (const [page,id] of [['daily','recordForm'],['settings','settings'],['dashboard','latestBP'],['summary','pdfBtn']]) {
    const markup = render(page,env);
    assert.match(markup,new RegExp('id="' + id + '"'));
    assert.match(markup,/<title>陪你久久｜/);
    assert.doesNotMatch(markup,/class="daily-nav"/);
    assert.doesNotMatch(markup,/<\?|<iframe/);
  }
});

test('gateway validates exact signed bytes and forwards unchanged LINE event', async () => {
  const postback = {type:'postback',postback:{data:'action=appt_time&id=fixture',params:{time:'09:00'}},
    source:{type:'user',userId:'fixture-line'},replyToken:'fixture-reply',webhookEventId:'fixture-event'};
  const raw = JSON.stringify({events:[postback]},null,2);
  const secret = 'fixture-secret';
  const signature = createHmac('sha256',secret).update(raw).digest('base64');
  const server = createServer({...env,LINE_MAIN_WEBHOOK_URL:'https://automation.example.test/webhook/integration',
    LINE_MESSAGING_CHANNEL_SECRET:secret,LINE_WEBHOOK_GATEWAY_KEY:'fixture-key'}, async (url, options) => {
    assert.equal(options.body.toString(),raw);
    assert.equal(options.headers['X-Hub-Gateway-Key'],'fixture-key');
    return new Response('{}');
  });
  const handle = server.listeners('request')[0];
  function request(body) {
    const req = Object.assign(Readable.from([Buffer.from(body)]),{
      method:'POST',url:'/line/events',headers:{'x-line-signature':signature}
    });
    return new Promise(resolve => {
      let status;
      void handle(req,{writeHead:code => { status=code; },end:() => resolve(status)});
    });
  }
  assert.equal(await request(raw+' '),401);
  assert.equal(await request(raw),200);
  const parse = flowNode('Code in JavaScript').parameters.jsCode;
  const items = new Function('$input',parse)({first:() => ({json:{body:{events:[postback]}}})});
  assert.deepEqual(items[0].json.event, postback);
  assert.equal(items[0].json.postbackData, postback.postback.data);
});

// Minimal Luxon stand-in: "today" is 2026-12-03 and every parsed date is 2026-12-04.
const day = iso => ({isValid:true,weekday:5,hour:10,toISODate:() => iso,toFormat:format => format === 'HH:mm' ? '10:00' : '12/4',
  setZone() { return this; },startOf() { return this; },diff:() => ({days:1})});
const clock = {fromISO:value => day(value || '2026-12-04'),now:() => day('2026-12-03')};
function runNode(name,tables) {
  return new Function('$','DateTime',flowNode(name).parameters.jsCode)(table => ({
    first:() => ({json:(tables[table] || [])[0]}),
    all:() => (tables[table] || []).map(json => ({json}))
  }),clock).map(item => item.json);
}

test('appointment flow writes a draft only for a bound family and keeps postback datetime params', () => {
  const event = {type:'postback',postback:{data:'action=appt_datetime&id=new',params:{datetime:'2026-12-04T13:00'}},
    source:{userId:'fixture-line'},replyToken:'fixture-reply'};
  const tables = {'Get row(s) in sheet':[{lineUid:'fixture-line',familyId:'fixture-family'}],'查詢回診進行中':[],'解析事件':[{event}]};
  const [write, reply] = runNode('決定動作',tables);
  assert.equal(write.row.patient_id,'fixture-family');
  assert.deepEqual([write.row.date,write.row.session,write.row.status],['2026-12-04','13:00','draft']);
  assert.equal(reply.replyToken,'fixture-reply');
  tables['Get row(s) in sheet'] = [];
  assert.equal(runNode('決定動作',tables).some(item => item.kind === 'write'),false);
});

test('appointment reminder reaches only that family and skips a push already sent', () => {
  const tables = {
    '提醒設定':[{MODE:'morning'}],
    '提醒｜讀取 appointments':[{appt_id:'fake-appointment',patient_id:'F_TEST',date:'2026-12-04',status:'scheduled'}],
    '提醒｜讀取 users':[{familyId:'F_TEST',lineUid:'line-family'},{familyId:'F_OTHER',lineUid:'line-other'}],
    '提醒｜讀取 patients':[{familyId:'F_TEST',patientName:'虛構家人'}],
    '提醒｜讀取 notification_log':[]
  };
  const pushes = runNode('組合推播',tables);
  assert.deepEqual(pushes.map(item => item.to),['line-family']);
  tables['提醒｜讀取 notification_log'].push({...pushes[0].log,status:'sent'});
  assert.deepEqual(runNode('組合推播',tables),[]);
});

test('committed workflow is inactive, de-identified, matches the rich menu texts and cannot replace the menu', () => {
  const text = JSON.stringify(workflow);
  assert.equal(workflow.active,false);
  assert.doesNotMatch(text,/"credentials"|docs\.google\.com|\bU[0-9a-f]{32}\b/);
  for (const node of workflow.nodes.filter(item => item.type.endsWith('.googleSheets'))) {
    assert.match(node.parameters.documentId.value,/^(REPLACE_STAGING_SPREADSHEET_ID|=\{\{.*SHEET_ID \}\})$/);
  }
  for (const node of workflow.nodes.filter(item => /^(手動：更新圖文選單|選單｜)/.test(item.name))) assert.equal(node.disabled,true,node.name);
  const keywords = flowNode('Switch').parameters.rules.values.flatMap(rule => rule.conditions.conditions.map(item => item.rightValue));
  const context = vm.createContext({});
  vm.runInContext(readFileSync('gas/daily/RichMenu.gs','utf8'),context);
  const messages = context.richMenuDefinitions_('fixture').bound.areas.map(area => area.action).filter(action => action.type === 'message');
  for (const action of messages) assert.ok(keywords.includes(action.text),action.text);
});

test('F1 GAS POST writes live headers, dedupes retries, and dashboard POST scopes reads to verified family', () => {
  const rows = {
    Members:[['familyId','lineUid','role'],['fixture-a','fixture-line-a','admin'],['fixture-b','fixture-line-b','member']],
    FamilyPatients:[['familyId','patientId'],['fixture-a','P_TEST_A'],['fixture-b','P_TEST_B']],
    Families:[['familyId','patientName'],['fixture-a','虛構甲'],['fixture-b','虛構乙']],
    TrackingSettings:[['familyId','metricKey','enabled','updatedAt'],['fixture-a','blood_pressure',true,'2026-11-01T00:00:00Z'],
      ['fixture-a','blood_glucose',true,'2026-11-01T00:00:00Z']],
    MetricDefinitions:[['metricKey','metricName','inputType','unit','isActive'],
      ['blood_pressure','血壓','bloodPressure','mmHg',true],['blood_glucose','血糖','number','mmol/L',true]],
    DailyRecords:[['recordId','familyId','lineUid','recordedAt','metricKey','metricName','value','unit','note','source',
      'createdAt','createdBy','route','recordDate','period','memberId','valueNumeric','valueSystolic','valueDiastolic','schemaVersion','isRecorded']]
  };
  const sheet = {getSpreadsheetTimeZone:() => 'Asia/Taipei',getSheetByName:name => rows[name] && ({
    getDataRange:() => ({getValues:() => structuredClone(rows[name])}),
    getLastRow:() => rows[name].length,
    getRange:() => ({setValues:values => rows[name].push(...values)})
  })};
  const props = {F1_SPREADSHEET_ID:'fixture-sheet',LINE_LOGIN_CHANNEL_ID:'fixture-channel'};
  let friendStatus = 200;
  const ok = body => ({getResponseCode:() => 200,getContentText:() => JSON.stringify(body)});
  const sandbox = {
    Date,PropertiesService:{getScriptProperties:() => ({getProperty:key => props[key] ?? null})},
    SpreadsheetApp:{openById:() => sheet,flush(){}},
    Utilities:{formatDate:() => new Date().toISOString(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
      computeDigest:(_,value) => [...require('node:crypto').createHash('sha256').update(value).digest()]},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:body => ({setMimeType:() => JSON.parse(body)})},
    LockService:{getScriptLock:() => ({waitLock(){},hasLock:() => true,releaseLock(){}})},
    UrlFetchApp:{fetch(url,options) {
      if (url.includes('/v2/bot/profile/')) return {getResponseCode:() => friendStatus,getContentText:() => '{}'};
      if (url.includes('/v2/profile')) return ok({userId:'fixture-line-a'});
      if (url.includes('access_token=')) {
        const token = decodeURIComponent(url.split('access_token=')[1]);
        return ['fixture-access','plain-access-token'].includes(token) ? ok({client_id:'fixture-channel',expires_in:60})
          : {getResponseCode:() => 400,getContentText:() => '{"error":"invalid_request"}'};
      }
      return ok({aud:'fixture-channel',sub:'fixture-line-' + options.payload.id_token.split('.').pop()});
    }}
  };
  const post = (files,body) => {
    const context = vm.createContext({...sandbox});
    for (const file of files) vm.runInContext(readFileSync(file,'utf8'),context);
    return context.doPost({postData:{contents:JSON.stringify(body)}});
  };
  const f1Files = ['gas/daily/Api.gs','gas/daily/Membership.gs'];
  const dashFiles = ['gas/dashboard/dashboard-service.gs','gas/dashboard/health-adapter.gs','gas/dashboard/Code.gs'];
  const date = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const body = {action:'record',accessToken:'fixture-access',familyId:'fixture-b',requestId:'00000000-0000-4000-8000-000000000001',
    recordDate:date,period:'morning',values:{blood_pressure:'132/84',blood_glucose:6.1}};
  assert.equal(post(f1Files,body).savedCount,2);
  assert.equal(post(f1Files,body).savedCount,2); // retry with the same requestId
  // optional friend gate
  props.REQUIRE_OA_FRIEND = 'true';
  props.LINE_OA_ACCESS_TOKEN = 'fixture-oa-token';
  friendStatus = 404;
  assert.match(post(f1Files,{action:'createFamily',accessToken:'fixture-access',patientName:'x'}).error,/加入官方帳號/);
  friendStatus = 503;
  assert.match(post(f1Files,{action:'createFamily',accessToken:'fixture-access',patientName:'x'}).error,/暫時無法確認/);
  friendStatus = 200;
  assert.equal(post(f1Files,{action:'memberStatus',accessToken:'fixture-access'}).bound,true);
  assert.equal(post(f1Files,{action:'createFamily',accessToken:'fixture-access',patientName:'x'}).ok,true);
  delete props.REQUIRE_OA_FRIEND;
  delete props.LINE_OA_ACCESS_TOKEN;
  const badBp = post(f1Files,{...body,requestId:'00000000-0000-4000-8000-000000000009',values:{blood_pressure:'222/258'}});
  assert.equal(badBp.ok,false);
  assert.match(badBp.error,/血壓數值不合理/);
  assert.equal(post(f1Files,{...body,requestId:'00000000-0000-4000-8000-00000000000a',values:{blood_glucose:900}}).ok,false);
  assert.equal(rows.DailyRecords.length,3);
  assert.equal(rows.DailyRecords[1][1],'fixture-a');
  const dashboard = post(dashFiles,{action:'getHubData',idToken:'x.x.a'}).data.dashboard;
  assert.equal(dashboard.latestBP.systolic,132);
  assert.equal(dashboard.glucoseAverage,110);
  assert.equal(post(dashFiles,{action:'getHubData',idToken:'plain-access-token'}).data.dashboard.latestBP.systolic,132);
  assert.equal(post(dashFiles,{action:'getHubData',idToken:'x.x.b'}).data.dashboard.latestBP,null);
  assert.match(post(dashFiles,{action:'getHubData',idToken:'x.x.unknown'}).error,/NOT_MEMBER/);
  assert.match(post(dashFiles,{action:'getDashboardData',idToken:'x.x.b',patientId:'P_TEST_A',days:7}).error,/FORBIDDEN/);
});

test('generated PDF is handed off through a short-lived download URL instead of base64', async () => {
  const pdf = Buffer.from('%PDF-1.4 fixture');
  const server = createServer({...env,DASHBOARD_GAS_URL:'https://script.google.com/macros/s/fixture/exec'}, async () => new Response(JSON.stringify({ok:true,data:{filename:'摘要.pdf',base64:pdf.toString('base64')}})));
  await new Promise(resolve => server.listen(0,resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(env.LIFF_ENDPOINT).origin},
      body:JSON.stringify({action:'generateVisitPdf',idToken:'x'})});
    const result = await response.json();
    assert.equal(result.ok,true);
    assert.equal(result.data.base64,undefined);
    const path = new URL(result.data.url).pathname;
    assert.match(path,/^\/pdf\/[0-9a-f]{32}$/);
    const download = await fetch(base + path);
    assert.equal(download.headers.get('content-type'),'application/pdf');
    assert.match(download.headers.get('content-disposition'),/attachment; filename\*=UTF-8''/);
    assert.equal(Buffer.from(await download.arrayBuffer()).equals(pdf),true);
    assert.equal((await fetch(base + '/pdf/' + '0'.repeat(32))).status,404);
  } finally { server.close(); }
});

test('setupN8nTabs adds only the missing tabs with the headers the workflow reads', () => {
  const created = {};
  const spreadsheet = {
    getSheetByName:name => name === 'appointments' || created[name] ? {} : null,
    insertSheet:name => ({getRange:() => ({setValues:([headers]) => { created[name] = headers; }}),setFrozenRows(){}})
  };
  const context = vm.createContext({console:{log(){}},SpreadsheetApp:{openById:() => spreadsheet},
    PropertiesService:{getScriptProperties:() => ({getProperty:() => 'fixture-sheet'})}});
  vm.runInContext(readFileSync('gas/daily/Setup.gs','utf8'),context);
  context.setupN8nTabs();
  context.setupN8nTabs();
  assert.deepEqual(Object.keys(created),['notification_log','med_logs','PendingLinks']);
  const documented = readFileSync('n8n/README.md','utf8');
  for (const headers of Object.values(created)) assert.ok(documented.includes(headers.join(',')));
});

test('day-over-day warnings compare the same period yesterday and honour family thresholds', () => {
  const context = vm.createContext({Utilities:{formatDate:date => new Date(date.getTime()+8*3600000).toISOString().slice(0,10)}});
  vm.runInContext(readFileSync('gas/daily/Api.gs','utf8') + ';this.warn = f1Warnings_;',context);
  const old = (metricKey,extra) => ({familyId:'F',metricKey,period:'morning',unit:metricKey === 'blood_glucose' ? 'mg/dL' : 'mmHg',
    recordDate:'2026-11-25',createdAt:'2026-11-25T00:00:00Z',...extra});
  const now = [
    {familyId:'F',metricKey:'blood_pressure',period:'morning',unit:'mmHg',recordDate:'2026-11-26',valueSystolic:142,valueDiastolic:84},
    {familyId:'F',metricKey:'blood_glucose',period:'morning',unit:'mg/dL',recordDate:'2026-11-26',valueNumeric:90}
  ];
  const catalog = thresholds => ({metrics:[{metricKey:'blood_pressure',metricName:'血壓',inputType:'bloodPressure',...thresholds},
    {metricKey:'blood_glucose',metricName:'血糖',inputType:'number',...thresholds}]});
  const history = [
    old('blood_pressure',{value:'118/80',valueSystolic:'',valueDiastolic:''}),           // legacy row: value column only
    old('blood_glucose',{valueNumeric:200,createdAt:'2026-11-25T00:00:00Z'}),
    old('blood_glucose',{valueNumeric:150,createdAt:'2026-11-25T01:00:00Z'}),            // latest of the day wins
    old('blood_glucose',{valueNumeric:400,familyId:'OTHER',createdAt:'2026-11-25T02:00:00Z'}),
    old('blood_glucose',{valueNumeric:400,period:'evening'}),
    old('blood_glucose',{valueNumeric:400,recordDate:'2026-11-24'})
  ];
  const result = JSON.parse(JSON.stringify(context.warn(history,now,catalog({}),'Asia/Taipei'))); // out of the vm realm
  assert.deepEqual(result.map(w => [w.metricName,w.previous,w.current,w.delta,w.threshold]),
    [['血壓（收縮壓）',118,142,24,20],['血糖',150,90,-60,50]]);
  assert.equal(context.warn(history,now,catalog({systolicChangeThreshold:0,diastolicChangeThreshold:3,changeThreshold:100}),'Asia/Taipei')
    .map(w => w.metricName).join(),'血壓（舒張壓）');
  assert.equal(context.warn([],now,catalog({}),'Asia/Taipei').length,0);
});
