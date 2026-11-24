'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const nodeId = name => {
  const hex = createHash('sha256').update(name).digest('hex');
  return [hex.slice(0,8),hex.slice(8,12),'4'+hex.slice(13,16),'8'+hex.slice(17,20),hex.slice(20,32)].join('-');
};
const load = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../n8n/source', name + '.json'), 'utf8'));
const edge = node => ({node,type:'main',index:0});
function clean(workflow, name, allowed) {
  const nodes = workflow.nodes.filter(n => allowed.includes(n.name));
  const names = new Set(nodes.map(n => n.name));
  const connections = Object.fromEntries(Object.entries(workflow.connections).filter(([key]) => names.has(key))
    .map(([key,value]) => [key,{main:value.main.map(out => out.filter(e => names.has(e.node)))}]));
  for (const node of nodes) {
    delete node.credentials;
    delete node.webhookId;
    if (node.type.endsWith('.googleSheets')) {
      node.parameters.documentId = {__rl:true,mode:'id',value:'REPLACE_STAGING_SPREADSHEET_ID'};
      node.parameters.sheetName = {__rl:true,mode:'name',value:node.parameters.sheetName.cachedResultName || node.parameters.sheetName.value};
    }
  }
  return {name,nodes,connections,active:false,settings:{executionOrder:'v1',timezone:'Asia/Taipei',saveDataErrorExecution:'none',
    saveDataSuccessExecution:'none',saveManualExecutions:false,saveExecutionProgress:false},pinData:{}};
}
function save(directory, workflow, filename = 'integration-test.json') {
  const output = JSON.stringify(workflow, null, 2);
  if (/\bU[0-9a-f]{32}\b|https:\/\/(?:liff\.line\.me|script\.google\.com|[^" /]+\.app\.n8n\.cloud)\//i.test(output)) {
    throw new Error('Live identifiers in test export');
  }
  fs.writeFileSync('n8n/' + directory + '/' + filename, output + '\n');
}

const f3 = clean(load('f3-appointments'), 'Integration test | F3 interactive', [
  '由主路由呼叫','解析事件','讀取 appointments',
  '決定動作','寫入或回覆','整理欄位','寫入 appointments','Line 回覆','存檔失敗｜整理回覆',
  'Line 回覆（存檔失敗）','排除存檔失敗的事件'
]);
for (const n of f3.nodes.filter(n => n.type.endsWith('.googleSheets'))) {
  n.parameters.documentId.value = 'REPLACE_STAGING_APPT_SPREADSHEET_ID';
}
f3.connections['由主路由呼叫'] = {main:[[edge('解析事件')]]};
const action = f3.nodes.find(n => n.name === '決定動作').parameters;
action.jsCode = action.jsCode.replace("if (text === '回診')", "if (text === '回診' || text === '回診管理')");
action.jsCode = action.jsCode.replace('const m = {};', 'const m = Object.create(null);');
action.jsCode = action.jsCode.replace('function parseQS(str) {', 'function parseQS(str) {\n try {')
  .replace('return { get: (k) => (k in m ? m[k] : null) };', 'return { get: (k) => (k in m ? m[k] : null) };\n } catch { return { get: () => null }; }');
const f3Get = name => f3.nodes.find(node => node.name === name);
const mapRead = structuredClone(f3Get('讀取 appointments'));
Object.assign(mapRead, {id:nodeId('read-family-patients'),name:'讀取 FamilyPatients',position:[1120,300]});
mapRead.parameters.documentId.value = 'REPLACE_STAGING_F1_SPREADSHEET_ID';
mapRead.parameters.sheetName.value = 'FamilyPatients';
f3.nodes.push(mapRead);
f3.connections['解析事件'] = {main:[[edge('讀取 appointments')]]};
f3.connections['讀取 appointments'] = {main:[[edge(mapRead.name)]]};
const memberRead = structuredClone(mapRead);
Object.assign(memberRead, {id:nodeId('verify-f3-member'),name:'讀取 Members',position:[1320,300]});
memberRead.parameters.sheetName.value = 'Members';
f3.nodes.push(memberRead);
f3.connections[mapRead.name] = {main:[[edge(memberRead.name)]]};
f3.connections[memberRead.name] = {main:[[edge('決定動作')]]};
action.jsCode = action.jsCode
  .replace(/const users = clean[^;]+;\nconst links = clean[^;]+;\nconst patients = clean[^;]+;\n/, '')
  .replace(/function resolve\(lineUserId\) \{[\s\S]+?\n\}/, '')
  .replace("const pid = resolve(ev.source.userId);", `const matches = clean('讀取 Members').filter(r => s(r.lineUid) === ev.source.userId);
  const familyId = matches.length === 1 ? s(matches[0].familyId) : '';
  const trustedFamily = $('由主路由呼叫').first().json.familyId;
  const mapped = clean('讀取 FamilyPatients');
  const rows = mapped.filter(r => s(r.familyId) === familyId);
  const candidate = rows.length === 1 ? s(rows[0].patientId) : '';
  const pid = familyId && familyId === trustedFamily && candidate &&
    mapped.filter(r => s(r.patientId) === candidate).length === 1 ? candidate : null;`);
action.jsCode = action.jsCode.replace("const newId = () => 'APT' + now.toFormat('yyMMddHHmmss') + Math.floor(Math.random() * 900 + 100);", "")
  .replace("  curReplyToken = ev.replyToken;", `  if (!/^[A-Za-z0-9_-]{1,100}$/.test(ev.webhookEventId || '')) continue;
  const newId = () => 'APT-' + ev.webhookEventId;
  curReplyToken = ev.replyToken;`)
  .replace("  const id = q.get('id') || '';", "  const id = q.get('id') || '';\n  if (action === 'appt_date' && findMine(newId())) continue;");
const filter = f3Get('排除存檔失敗的事件');
filter.parameters.jsCode = `const writes = new Set($('決定動作').all().filter(i => i.json.kind === 'write').map(i => i.json.replyToken));
return $input.all().filter(i => !writes.has(i.json.replyToken));`;
const afterWrite = {id:nodeId('f3-confirm-write'),name:'確認寫入後回覆',type:'n8n-nodes-base.code',typeVersion:2,position:[1900,230],
  parameters:{jsCode:`const items = $('決定動作').all();
const writes = new Set(items.filter(i => i.json.kind === 'write').map(i => i.json.replyToken));
return items.filter(i => i.json.kind === 'reply' && writes.has(i.json.replyToken));`}};
f3.nodes.push(afterWrite);
f3.connections['寫入 appointments'].main[0] = [edge(afterWrite.name)];
f3.connections[afterWrite.name] = {main:[[edge('Line 回覆')]]};
save('appointment', f3);

// Separate scheduled workflow so enabling interactive F3 does not enable pushes.
const reminder = clean(load('f3-appointments'), 'Integration test | F3 reminders', [
  '每天 09:00','每天 20:00','提醒設定','提醒｜讀取 appointments',
  '提醒｜讀取 notification_log','組合推播','Line 推播','記錄成功','記錄失敗','寫入 notification_log'
]);
for (const n of reminder.nodes.filter(n => n.type.endsWith('.googleSheets'))) {
  n.parameters.documentId.value = 'REPLACE_STAGING_APPT_SPREADSHEET_ID';
}
const reminderNode = name => reminder.nodes.find(n => n.name === name);
const options = reminderNode('提醒設定').parameters.assignments;
options.assignments = options.assignments.filter(p => ['LIFF_SUMMARY_URL','MODE'].includes(p.name));
for (const name of ['Members','Families','FamilyPatients']) {
  const source = structuredClone(reminderNode('提醒｜讀取 appointments'));
  source.id = nodeId('reminder-' + name);
  source.name = '提醒｜讀取 ' + name;
  source.parameters.documentId.value = 'REPLACE_STAGING_F1_SPREADSHEET_ID';
  source.parameters.sheetName.value = name;
  reminder.nodes.push(source);
}
const reminderPath = ['提醒｜讀取 appointments','提醒｜讀取 Members','提醒｜讀取 Families',
  '提醒｜讀取 FamilyPatients','提醒｜讀取 notification_log','組合推播'];
for (let i = 0; i < reminderPath.length - 1; i++) {
  reminder.connections[reminderPath[i]] = {main:[[edge(reminderPath[i+1])]]};
}
const reminderCode = reminderNode('組合推播').parameters;
reminderCode.jsCode = reminderCode.jsCode
  .replace("const users = clean('提醒｜讀取 users');", "const members = clean('提醒｜讀取 Members');")
  .replace("const patients = clean('提醒｜讀取 patients');", "const families = clean('提醒｜讀取 Families');")
  .replace("const links = clean('提醒｜讀取 family_links');", "const links = clean('提醒｜讀取 FamilyPatients');")
  .replace(/const userById = .*;\n/, '')
  .replace(/  const p = patients\.find[\s\S]+?  const seen = new Set\(\);/, `  if (!a.appt_id || !a.patient_id) continue;
  const matches = links.filter(r => s(r.patientId) === a.patient_id);
  if (matches.length !== 1 || !s(matches[0].familyId)) continue;
  const familyId = s(matches[0].familyId);
  if (links.filter(r => s(r.familyId) === familyId).length !== 1) continue;
  const family = families.filter(r => s(r.familyId) === familyId);
  if (family.length !== 1) continue;
  const patientName = s(family[0].patientName);
  const recipients = members.filter(r => s(r.familyId) === familyId && s(r.lineUid) &&
    members.filter(m => s(m.lineUid) === s(r.lineUid)).length === 1);
  const seen = new Set();`)
  .replace('const uid = s(r.user.user_id), to = s(r.user.line_user_id);','const uid = s(r.lineUid), to = uid;')
  .replace('reminder(a, offset, patientName, r.isFamily)', 'reminder(a, offset, patientName, true)')
  .replace('點「更多 → 記醫囑」記下來，下次回診摘要會幫忙整理。','請留存這次看診的醫囑。');
save('appointment', reminder, 'reminders-test.json');

const main = clean(load('line-main-v2'), 'Integration test | LINE main', [
  'Webhook','Code in JavaScript','Get row(s) in sheet','If','Switch','收到每日記錄','收到觀看紀錄',
  '收到會員中心','收到用藥打卡','沒有身分驗證，請加入或建立家庭'
]);
const get = name => main.nodes.find(n => n.name === name);
get('Webhook').parameters = {httpMethod:'POST',path:'integration-line-main',authentication:'headerAuth',responseMode:'onReceived',options:{}};
get('Code in JavaScript').parameters.jsCode = `
const events = $input.first().json.body?.events || [];
return events.filter(event => event.source?.type === 'user' && event.source.userId && event.replyToken &&
  (event.type === 'postback' && /(?:^|&)action=appt_/.test(event.postback?.data || '') ||
   event.type === 'message' && event.message?.type === 'text'))
  .map(event => ({json:{event,lineUid:event.source.userId,replyToken:event.replyToken,
    keyword:event.type === 'message' ? event.message.text.trim() : '回診管理'}}));
`.trim();
const membershipNode = {
  id:nodeId('group-member-matches'),name:'確認單一成員',type:'n8n-nodes-base.code',typeVersion:2,position:[500,300],
  parameters:{jsCode:`const input = $input.all();
const groups = new Map();
for (let i = 0; i < input.length; i++) {
  const original = $('Code in JavaScript').itemMatching(i).json;
  const key = original.event.webhookEventId || original.replyToken;
  if (!groups.has(key)) groups.set(key,{original, rows:[], i});
  if (input[i].json.lineUid === original.lineUid && input[i].json.familyId) groups.get(key).rows.push(input[i].json);
}
return [...groups.values()].map(({original,rows,i}) => ({
  json:{...original, familyId:rows.length === 1 ? rows[0].familyId : ''},
  pairedItem:{item:i}
}));`}
};
main.nodes.push(membershipNode);
main.connections['Get row(s) in sheet'] = {main:[[edge(membershipNode.name)]]};
main.connections[membershipNode.name] = {main:[[edge('If')]]};
const membership = get('If').parameters.conditions.conditions[0];
membership.leftValue = '={{ !!$json.familyId }}';
membership.rightValue = '';
membership.operator = {type:'boolean',operation:'true',singleValue:true};
delete get('If').alwaysOutputData;
const name = '交給 F3 回診';
main.nodes.push({
  id:nodeId('event-envelope'),name:'傳遞完整 LINE Event',type:'n8n-nodes-base.code',typeVersion:2,position:[1020,460],
  parameters:{jsCode:`return $input.all().map((item, index) => ({
  json:{familyId:item.json.familyId,body:{events:[item.json.event]}},
  pairedItem:{item:index}
}));`}
},{
  id:nodeId('execute-f3'),name,type:'n8n-nodes-base.executeWorkflow',typeVersion:1.2,position:[1240,460],
  parameters:{workflowId:{__rl:true,mode:'id',value:'REPLACE_F3_WORKFLOW_ID'},mode:'each',options:{waitForSubWorkflow:true}}
});
for (const output of [2,5]) main.connections.Switch.main[output] = [edge('傳遞完整 LINE Event')];
main.connections['傳遞完整 LINE Event'] = {main:[[edge(name)]]};
const replies = {
  '收到每日記錄':'REPLACE_STAGING_DAILY_LIFF_URL',
  '收到觀看紀錄':'REPLACE_STAGING_DASHBOARD_LIFF_URL',
  '收到會員中心':'REPLACE_STAGING_MEMBER_URL',
  '收到用藥打卡':'REPLACE_STAGING_MEDICATION_URL',
  '沒有身分驗證，請加入或建立家庭':'請先建立或加入家庭 REPLACE_STAGING_BIND_LIFF_URL'
};
for (const [node,text] of Object.entries(replies)) {
  if (node === '沒有身分驗證，請加入或建立家庭') {
    get(node).parameters.jsonBody = `={{ JSON.stringify({replyToken:$json.replyToken,messages:[{type:"text",text:"請先建立或加入家庭 " + "REPLACE_STAGING_BIND_LIFF_BASE" + ({"每日記錄":"?page=daily","健康摘要":"?page=dashboard","會員中心":"?page=member","回診管理":"?page=appointments","回診":"?page=appointments"}[$json.keyword] || "?page=bind")}]}) }}`;
    continue;
  }
  get(node).parameters.jsonBody = '={{ JSON.stringify({replyToken: $("Code in JavaScript").item.json.replyToken, messages: [{type:"text",text:' + JSON.stringify(text) + '}]}) }}';
}
save('line-main', main);

const dailyHook = {
  id:nodeId('daily-webhook'),name:'F1 測試入口',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,0],
  parameters:{httpMethod:'POST',path:'integration-f1-daily',authentication:'headerAuth',
    responseMode:'lastNode',responseData:'firstEntryJson',options:{}}
};
const dailyApi = {
  id:nodeId('daily-gas'),name:'F1 GAS 驗證及寫入',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[240,0],
  parameters:{method:'POST',url:'REPLACE_STAGING_F1_GAS_EXEC_URL',sendBody:true,specifyBody:'json',
    jsonBody:'={{ JSON.stringify($json.body) }}',options:{timeout:50000}}
};
save('daily-record',{name:'Integration test | F1 daily',active:false,nodes:[dailyHook,dailyApi],
  connections:{[dailyHook.name]:{main:[[edge(dailyApi.name)]]}},
  settings:{executionOrder:'v1',timezone:'Asia/Taipei',saveDataErrorExecution:'none',
    saveDataSuccessExecution:'none',saveManualExecutions:false,saveExecutionProgress:false},pinData:{}});
