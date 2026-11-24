const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createServer, render } = require('../frontend/server');
const main = require('../n8n/line-main/integration-test.json');
const f3 = require('../n8n/appointment/integration-test.json');

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
  const parse = main.nodes.find(n => n.name === 'Code in JavaScript').parameters.jsCode;
  const items = new Function('$input',parse)({first:() => ({json:{body:{events:[postback]}}})});
  assert.deepEqual(items[0].json.event, postback);
  assert.equal(items[0].json.keyword,'回診管理');
  assert.equal(main.connections.Switch.main[2][0].node,'傳遞完整 LINE Event');
});

test('F3 child uses trusted family crosswalk and preserves postback datetimepicker params', () => {
  const event = {type:'postback',postback:{data:'action=appt_date&id=new',params:{date:'2026-11-26'}},
    source:{userId:'fixture-line'},replyToken:'fixture-reply',webhookEventId:'fixture-event'};
  const fixtures = {
    '讀取 Members':[{lineUid:'fixture-line',familyId:'fixture-family'}],
    '讀取 appointments':[],
    '讀取 FamilyPatients':[{familyId:'fixture-family',patientId:'fixture-patient'}],
    '解析事件':[{event}]
  };
  const code = f3.nodes.find(n => n.name === '決定動作').parameters.jsCode;
  const DateTime = {now:() => ({setZone:() => ({toISODate:() => '2026-11-23'})}),
    fromISO:date => ({isValid:true,toISODate:() => date,toFormat:() => "11/26",weekday:4})};
  function run(familyId) {
    return new Function('$','DateTime', code)(name => ({
      first:() => ({json:{familyId}}),
      all:() => fixtures[name].map(json => ({json}))
    }),DateTime).map(item => item.json);
  }
  const created = run('fixture-family');
  assert.equal(created[0].row.date,'2026-11-26');
  assert.equal(created[0].row.patient_id,'fixture-patient');
  assert.equal(created[0].row.appt_id,'APT-fixture-event');
  assert.equal(created[1].messages[0].contents.footer.contents[0].action.type,'datetimepicker');
  assert.equal(run('other-family').some(i => i.kind === 'write'),false);
  fixtures['讀取 appointments'].push(created[0].row);
  assert.deepEqual(run('fixture-family'),[]);
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
  const ok = body => ({getResponseCode:() => 200,getContentText:() => JSON.stringify(body)});
  const sandbox = {
    Date,PropertiesService:{getScriptProperties:() => ({getProperty:key => props[key] ?? null})},
    SpreadsheetApp:{openById:() => sheet,flush(){}},
    Utilities:{formatDate:() => new Date().toISOString()},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:body => ({setMimeType:() => JSON.parse(body)})},
    LockService:{getScriptLock:() => ({waitLock(){},hasLock:() => true,releaseLock(){}})},
    UrlFetchApp:{fetch(url,options) {
      if (url.includes('/v2/profile')) return ok({userId:'fixture-line-a'});
      if (url.includes('access_token=')) {
        const token = decodeURIComponent(url.split('access_token=')[1]);
        return ['fixture-access','plain-access-token'].includes(token) ? ok({client_id:'fixture-channel',expires_in:60})
          : {getResponseCode:() => 400,getContentText:() => '{"error":"invalid_request"}'};
      }
      return ok({aud:'fixture-channel',sub:'fixture-line-' + options.payload.id_token.split('.').pop()});
    }}
  };
  const post = (files,body,transport = 'http') => {
    const context = vm.createContext({...sandbox});
    for (const file of files) vm.runInContext(readFileSync(file,'utf8'),context);
    if (transport === 'rpc') return context.f1UiRequest(body);
    return context.doPost({postData:{contents:JSON.stringify(body)}});
  };
  const f1Files = ['gas/daily/Api.gs','gas/daily/Membership.gs'];
  const dashFiles = ['gas/dashboard/dashboard-service.gs','gas/dashboard/health-adapter.gs','gas/dashboard/Code.gs'];
  const date = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const body = {action:'record',accessToken:'fixture-access',familyId:'fixture-b',requestId:'00000000-0000-4000-8000-000000000001',
    recordDate:date,period:'morning',values:{blood_pressure:'132/84',blood_glucose:6.1}};
  assert.equal(post(f1Files,body).savedCount,2);
  assert.equal(post(f1Files,body,'rpc').savedCount,2);
  assert.equal(post(f1Files,{action:'createFamily'},'rpc').ok,false);
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

test('F3 reminder selects only the authorized family and skips a previously sent push', () => {
  const workflow = require('../n8n/appointment/reminders-test.json');
  const code = workflow.nodes.find(node => node.name === '組合推播').parameters.jsCode;
  const tables = {
    '提醒設定':[{MODE:'morning'}],
    '提醒｜讀取 appointments':[{appt_id:'fake-appointment',patient_id:'P_TEST',date:'2026-12-04',status:'scheduled'}],
    '提醒｜讀取 Members':[{familyId:'F_TEST',lineUid:'line-family'},{familyId:'F_OTHER',lineUid:'line-other'}],
    '提醒｜讀取 Families':[{familyId:'F_TEST',patientName:'虛構家人'}],
    '提醒｜讀取 FamilyPatients':[{familyId:'F_TEST',patientId:'P_TEST'}],
    '提醒｜讀取 notification_log':[]
  };
  const date = {isValid:true,weekday:5,toISODate:() => '2026-12-04',toFormat:() => '12/4',
    startOf:() => ({diff:() => ({days:1})})};
  const clock = {fromISO:() => date,now:() => ({setZone:() => date})};
  const run = () => new Function('$','DateTime',code)(name => ({
    first:() => ({json:tables[name][0]}),
    all:() => tables[name].map(json => ({json}))
  }),clock);
  assert.deepEqual(run().map(item => item.json.to),['line-family']);
  tables['提醒｜讀取 notification_log'].push({...run()[0].json.log,status:'sent'});
  assert.deepEqual(run(),[]);
  tables['提醒｜讀取 notification_log'].pop();
  tables['提醒｜讀取 FamilyPatients'].push({familyId:'F_OTHER',patientId:'P_TEST'});
  assert.deepEqual(run(),[]);
  assert.equal(workflow.active,false);
});
