// Isolated F1 writer for integration when the complete F1-A export is unavailable.
const F1_THRESHOLDS = ['alertLow','alertHigh','systolicLow','systolicHigh','diastolicLow','diastolicHigh',
  'changeThreshold','systolicChangeThreshold','diastolicChangeThreshold'];
const f1Text_ = value => String(value == null ? '' : value).trim();
const f1Bool_ = value => value === true || /^true$/i.test(f1Text_(value));
let f1LastName_ = '';
function f1Fail_(message) { throw new Error('F1:' + message); }

function f1Identity_(token, channelId) {
  if (typeof token !== 'string' || !token || !channelId) f1Fail_('請重新登入 LINE');
  const verify = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(token), {muteHttpExceptions:true});
  if (verify.getResponseCode() !== 200) f1Fail_('LINE 登入憑證已失效');
  const verified = JSON.parse(verify.getContentText());
  if (String(verified.client_id) !== channelId || !(verified.expires_in > 0)) f1Fail_('LINE 登入憑證無效');
  const profile = UrlFetchApp.fetch('https://api.line.me/v2/profile', {headers:{Authorization:'Bearer ' + token},muteHttpExceptions:true});
  if (profile.getResponseCode() !== 200) f1Fail_('無法取得 LINE 身分');
  const parsed = JSON.parse(profile.getContentText());
  const uid = parsed.userId;
  if (!uid) f1Fail_('無法取得 LINE 身分');
  f1LastName_ = f1Text_(parsed.displayName).slice(0,40);
  return uid;
}

const F1_NEED_FRIEND = '請先加入官方帳號為好友，才能完成綁定';

/** 回傳是否為官方帳號好友；無法確認時丟錯（不是 404 就不能當作非好友）。 */
function f1IsFriend_(uid, props) {
  const token = props.getProperty('LINE_OA_ACCESS_TOKEN');
  if (!token) f1Fail_('尚未設定官方帳號憑證，無法確認好友狀態');
  const code = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(uid),
    {headers:{Authorization:'Bearer ' + token},muteHttpExceptions:true}).getResponseCode();
  if (code === 200) return true;
  if (code === 404) return false;
  f1Fail_('暫時無法確認官方帳號好友狀態，請稍後再試');
}

/** n8n 收到 follow 事件時呼叫：以 lineUid 啟用待確認的綁定。需要 ACTIVATE_GATEWAY_KEY 才會執行。 */
function f1Activate_(body) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('ACTIVATE_GATEWAY_KEY');
    if (!key || f1Text_(body.gatewayKey) !== key) return {ok:false,error:'未授權'};
    const uid = f1Text_(body.lineUid);
    if (!/^U[0-9a-f]{32}$/.test(uid)) return {ok:false,error:'userId 無效'};
    const ss = SpreadsheetApp.openById(props.getProperty('F1_SPREADSHEET_ID'));
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    let out;
    try {
      out = memberActivatePending_(ss,uid);
    } finally {
      lock.releaseLock();
    }
    if (out.activated) out.menu = syncMemberMenu_(uid,props);
    return {ok:true,...out};
  } catch (err) {
    return {ok:false,error:'服務暫時無法完成'};
  }
}

/** Optional gate (Script Property REQUIRE_OA_FRIEND=true): binding needs the user to have added the OA, otherwise we could never message them. */
function f1RequireFriend_(uid, props) {
  if (props.getProperty('REQUIRE_OA_FRIEND') !== 'true') return;
  const token = props.getProperty('LINE_OA_ACCESS_TOKEN');
  if (!token) f1Fail_('尚未設定官方帳號憑證，無法確認好友狀態');
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(uid),
    {headers:{Authorization:'Bearer ' + token},muteHttpExceptions:true});
  const code = response.getResponseCode();
  if (code === 200) return;
  if (code === 404) f1Fail_(F1_NEED_FRIEND);
  f1Fail_('暫時無法確認官方帳號好友狀態，請稍後再試');
}

function f1Table_(ss, name, required) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) f1Fail_('找不到工作表 ' + name);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  if (required.some(key => !headers.includes(key)) || new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) {
    f1Fail_('工作表欄位不完整或重複 ' + name);
  }
  return {sheet,headers,rows:values.map(row => Object.fromEntries(headers.map((key,i) => [key,row[i]])))};
}

function f1Append_(table, rows) {
  if (!rows.length) return;
  const values = rows.map(row => table.headers.map(key => {
    const value = row[key] ?? '';
    return typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  }));
  table.sheet.getRange(table.sheet.getLastRow()+1,1,values.length,table.headers.length).setValues(values);
  SpreadsheetApp.flush();
}

function f1Context_(ss, uid) {
  const rows = f1Table_(ss,'Members',['lineUid','familyId','role']).rows.filter(row => row.lineUid === uid);
  if (!rows.length) f1Fail_('尚未加入照護家庭');
  if (rows.length !== 1 || !rows[0].familyId) f1Fail_('家庭成員資料有衝突');
  const member = rows[0];
  const patient = memberFamily_(ss,member.familyId);
  return {familyId:member.familyId,patientId:patient.patientId,role:member.role === 'admin' ? 'admin' : 'member'};
}

function f1Metrics_(ss, familyId, settingsTable) {
  const latest = new Map();
  for (const row of settingsTable.rows) {
    if (row.familyId !== familyId) continue;
    const prior = latest.get(row.metricKey);
    const time = Date.parse(row.updatedAt);
    const priorTime = prior ? Date.parse(prior.updatedAt) : NaN;
    if (!prior || !Number.isFinite(priorTime) || time >= priorTime) latest.set(row.metricKey,row);
  }
  const defs = f1Table_(ss,'MetricDefinitions',['metricKey','metricName','inputType','unit','isActive']).rows;
  const metrics = defs.filter(d => /^[a-zA-Z0-9_-]+$/.test(d.metricKey) && f1Bool_(d.isActive)).map(d => {
    const saved = latest.get(d.metricKey) || {};
    return {metricKey:d.metricKey,metricName:saved.metricName || d.metricName,inputType:d.inputType || 'number',
      unit:saved.unit || d.unit || '',isActive:true,
      ...Object.fromEntries(F1_THRESHOLDS.map(key => [key, saved[key] === '' || !Number.isFinite(Number(saved[key])) ? null : Number(saved[key])]))};
  });
  const settings = Object.fromEntries(metrics.map(m => [m.metricKey,f1Bool_(latest.get(m.metricKey)?.enabled)]));
  return {metrics,settings};
}

// 前日差異提醒的一般參考值（非醫療標準）。家庭在追蹤設定填了「相差提醒」就用家庭的值，填 0 關閉。
const F1_CHANGE_DEFAULTS = {systolic:20,diastolic:15,blood_glucose:50,blood_glucose_mmol:2.8,temperature:1,weight:2,spo2:4};

function f1Day_(value, timeZone) {
  return value instanceof Date ? Utilities.formatDate(value,timeZone,'yyyy-MM-dd') : f1Text_(value).slice(0,10).replace(/\//g,'-');
}

/** 本次紀錄和「前一天、同一時段、同單位」的最新一筆比較；沒有可比的紀錄就不提醒。 */
function f1Warnings_(history, rows, catalog, timeZone) {
  const warnings = [];
  for (const row of rows) {
    const def = catalog.metrics.find(metric => metric.metricKey === row.metricKey);
    if (def.inputType === 'boolean') continue;
    const yesterday = new Date(Date.parse(row.recordDate + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
    const previous = history.filter(old => old.familyId === row.familyId && old.metricKey === row.metricKey &&
        old.period === row.period && f1Text_(old.unit) === f1Text_(row.unit) && f1Day_(old.recordDate,timeZone) === yesterday &&
        old.source !== 'TEST' && !/^false$/i.test(f1Text_(old.isRecorded)))
      .sort((a,b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)).pop();
    if (!previous) continue;
    const fallbackKey = row.metricKey === 'blood_glucose' && /mmol/i.test(row.unit) ? 'blood_glucose_mmol' : row.metricKey;
    const parts = def.inputType === 'bloodPressure'
      ? [['（收縮壓）','valueSystolic',0,def.systolicChangeThreshold,F1_CHANGE_DEFAULTS.systolic],
         ['（舒張壓）','valueDiastolic',1,def.diastolicChangeThreshold,F1_CHANGE_DEFAULTS.diastolic]]
      : [['','valueNumeric',0,def.changeThreshold,F1_CHANGE_DEFAULTS[fallbackKey]]];
    for (const [label,column,index,own,fallback] of parts) {
      const threshold = own == null ? fallback : own;
      // 舊資料可能只有 value 欄（血壓為 "132/84"）
      const stored = f1Text_(previous[column]) || f1Text_(previous.value).split('/')[index] || '';
      const before = stored === '' ? NaN : Number(stored);
      const current = Number(row[column]);
      if (!(threshold > 0) || !Number.isFinite(before)) continue;
      const delta = Math.round((current - before) * 10) / 10;
      if (Math.abs(delta) >= threshold) {
        warnings.push({metricKey:row.metricKey,metricName:def.metricName + label,unit:row.unit,previous:before,current,delta,threshold});
      }
    }
  }
  return warnings;
}

function f1Record_(ss, body, ctx, catalog, uid, now) {
  const date = f1Text_(body.recordDate);
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsed) || parsed.toISOString().slice(0,10) !== date ||
      !['morning','noon','evening','bedtime'].includes(body.period)) f1Fail_('日期或時段無效');
  if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) f1Fail_('請重新送出紀錄');
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) f1Fail_('請輸入紀錄');
  const definitions = new Map(catalog.metrics.map(metric => [metric.metricKey,metric]));
  const rows = Object.entries(body.values).map(([key,value]) => {
    const def = definitions.get(key);
    if (!def || !catalog.settings[key]) f1Fail_('輸入包含未啟用的項目');
    const bp = def.inputType === 'bloodPressure' && typeof value === 'string' && /^(\d{1,3})\/(\d{1,3})$/.exec(value);
    const numeric = typeof value === 'number' && Number.isFinite(value);
    if (!(bp || (def.inputType === 'boolean' ? typeof value === 'boolean' : def.inputType !== 'bloodPressure' && numeric))) {
      f1Fail_('紀錄格式不正確');
    }
    if (bp) {
      const sys = Number(bp[1]), dia = Number(bp[2]);
      if (sys < 50 || sys > 260 || dia < 30 || dia > 180 || sys <= dia) f1Fail_('血壓數值不合理，請確認「收縮壓／舒張壓」是否填對（收縮壓 50–260、舒張壓 30–180，且收縮壓要大於舒張壓）');
    }
    if (key === 'blood_glucose' && numeric) {
      const [low, high] = /mmol/i.test(def.unit) ? [1.1, 33.3] : [20, 600];
      if (value < low || value > high) f1Fail_('血糖數值不合理，請確認數字與單位（' + (def.unit || 'mg/dL') + ' 範圍 ' + low + '–' + high + '）');
    }
    return {recordId:[ctx.familyId,uid,body.requestId,key].join(':'),familyId:ctx.familyId,patientId:ctx.patientId,lineUid:uid,recordedAt:now,
      metricKey:key,metricName:def.metricName,value,unit:def.unit,note:f1Text_(body.note).slice(0,500),
      source:'LIFF',recordDate:date,period:body.period,valueNumeric:numeric ? value : '',
      valueSystolic:bp ? Number(bp[1]) : '',valueDiastolic:bp ? Number(bp[2]) : '',
      createdAt:now,createdBy:uid,route:'record_write',schemaVersion:2,isRecorded:true};
  });
  if (!rows.length) f1Fail_('請至少輸入一個項目');
  const table = f1Table_(ss,'DailyRecords',['recordId','familyId','lineUid','recordedAt','metricKey','metricName','value','unit','note','source','recordDate','period']);
  const existing = new Set(table.rows.map(row => row.recordId));
  const warnings = f1Warnings_(table.rows,rows,catalog,ss.getSpreadsheetTimeZone());
  f1Append_(table,rows.filter(row => !existing.has(row.recordId)));
  return {savedCount:rows.length,recordedAt:now,recordDate:date,period:body.period,warnings};
}

function f1Settings_(table, input, ctx, catalog, uid, now) {
  if (ctx.role !== 'admin') f1Fail_('只有家庭管理者可修改設定');
  if (!Array.isArray(input) || !input.length || input.length > catalog.metrics.length) f1Fail_('設定格式無效');
  const seen = new Set();
  const definitions = new Map(catalog.metrics.map(metric => [metric.metricKey,metric]));
  const rows = input.map(item => {
    const key = item && item.metricKey;
    const def = definitions.get(key);
    if (!def || seen.has(key) || typeof item.enabled !== 'boolean') f1Fail_('設定包含無效項目');
    seen.add(key);
    const custom = key.startsWith('custom_');
    const thresholds = Object.fromEntries(F1_THRESHOLDS.map(field => {
      const value = item[field];
      if (value === '' || value == null) return [field,''];
      if (typeof value !== 'number' || !Number.isFinite(value)) f1Fail_('門檻格式無效');
      return [field,value];
    }));
    return {...thresholds,familyId:ctx.familyId,metricKey:key,enabled:item.enabled,updatedBy:uid,updatedAt:now,
      route:'update_write',metricName:(custom && f1Text_(item.metricName).slice(0,100)) || def.metricName,
      unit:(custom && f1Text_(item.unit).slice(0,40)) || def.unit};
  });
  f1Append_(table,rows);
}

/** 瀏覽器直接開 /exec 時的回應。頁面在 Render，這裡只回報服務狀態。 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ok:true,service:'daily',note:'API 僅接受 POST'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (_) {
    body = {};
  }
  if (body.action === 'activatePending') {
    return ContentService.createTextOutput(JSON.stringify(f1Activate_(body))).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify(f1Request_(body))).setMimeType(ContentService.MimeType.JSON);
}

function f1Request_(body) {
  let lock;
  let out;
  let menuTask;
  let unlinkUids = [];
  let notify = null;
  try {

    const memberAction = MEMBER_ACTIONS.includes(body.action);
    if (!memberAction && !['read','record','update'].includes(body.action)) f1Fail_('操作無效');
    const props = PropertiesService.getScriptProperties();
    const uid = f1Identity_(body.accessToken,props.getProperty('LINE_LOGIN_CHANNEL_ID'));
    body = {...body,lineName:f1LastName_};
    if (['createFamily','switchFamily'].includes(body.action)) f1RequireFriend_(uid,props);
    // 邀請加入時非好友不擋：先記成待確認，加好友的 follow 事件到了才正式綁定
    if (body.action === 'joinFamily' && props.getProperty('REQUIRE_OA_FRIEND') === 'true') body = {...body,notFriend:!f1IsFriend_(uid,props)};
    if (!['read','memberStatus','previewInvite','listMembers','syncMenu'].includes(body.action)) {
      lock = LockService.getScriptLock();
      lock.waitLock(10000);
    }
    const ss = SpreadsheetApp.openById(props.getProperty('F1_SPREADSHEET_ID'));
    if (memberAction) {
      out = membership_(ss,uid,body);
      if (out.bound && ['createFamily','joinFamily','switchFamily','restoreFamily','syncMenu'].includes(body.action)) menuTask = {uid,props};
      // userId 只在後端用來切換選單、發通知，不回傳給瀏覽器
      unlinkUids = out._unlinkUids || [];
      notify = out._notify || null;
      delete out._unlinkUids;
      delete out._notify;
      if (out.unbound) menuTask = {uid,props,unlink:true};
    } else {
      const ctx = f1Context_(ss,uid);
      const table = f1Table_(ss,'TrackingSettings',['familyId','metricKey','enabled','updatedAt']);
      const catalog = f1Metrics_(ss,ctx.familyId,table);
      const now = new Date().toISOString();
      if (body.action === 'record') out = f1Record_(ss,body,ctx,catalog,uid,now);
      if (body.action === 'update') {
        f1Settings_(table,body.settings,ctx,catalog,uid,now);
        out = {...ctx,...f1Metrics_(ss,ctx.familyId,f1Table_(ss,'TrackingSettings',['familyId','metricKey','enabled','updatedAt']))};
      }
      if (body.action === 'read') out = {...ctx,...catalog};
    }
    out = {ok:true,...out};
  } catch (err) {
    out = {ok:false,error:String(err.message).startsWith('F1:') ? err.message.slice(3) : '每日紀錄服務暫時無法完成操作'};
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
  if (out.ok) {
    const props2 = PropertiesService.getScriptProperties();
    unlinkUids.forEach(other => unlinkMemberMenu_(other,props2));
    if (notify) memberPush_(notify.uids,notify.text,props2);
  }
  if (menuTask && out.ok) out.menu = menuTask.unlink ? unlinkMemberMenu_(menuTask.uid,menuTask.props) : syncMemberMenu_(menuTask.uid,menuTask.props);
  return out;
}
