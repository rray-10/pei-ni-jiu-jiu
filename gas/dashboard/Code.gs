/**
 * 陪你久久｜健康儀表板（整合版）— 讀取 F1 DailyRecords + 回診資料。
 * 部署注意：Web App「執行身分=我、存取=任何人」是 LIFF 使用者進入所必需；
 * 因此【存取控制完全由本檔的 LINE ID Token 驗證 + Members 查詢負責】，不可繞過。
 * 本版只讀（spreadsheets.readonly），不會修改任何正式 Sheet。
 *
 * 依賴（同專案 gas/dashboard/*.gs）：HealthAdapter、DashboardService。
 * Script Properties 見 .env.example。
 */
var SHEET = { families: 'Families', members: 'Members', daily: 'DailyRecords', familyPatients: 'FamilyPatients', appts: 'appointments' };

function prop_(k, d) { var v = PropertiesService.getScriptProperties().getProperty(k); return (v === null || v === '') ? (d === undefined ? '' : d) : v; }
function devMode_() { return prop_('DEV_AUTH_ENABLED') === 'true'; }

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'dashboard'; // dashboard | summary | member | daily | appointments | medication
  var t = HtmlService.createTemplateFromFile('Index');
  t.config = {
    page: page,
    liffId: prop_('LIFF_ID'),
    devMode: devMode_(),
    nav: { settings: prop_('NAV_SETTINGS_URL'), appointments: prop_('NAV_APPOINTMENTS_URL'), daily: prop_('NAV_DAILY_URL'), member: prop_('NAV_MEMBER_URL'), medication: prop_('NAV_MEDICATION_URL') }
  };
  return t.evaluate().setTitle('陪你久久｜健康摘要')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

// ---------- 身分 ----------
/** 回傳已驗證的 LINE User ID（sub）。dev 模式僅在 DEV_AUTH_ENABLED=true 且無 token 時使用 DEV_LINE_UID。 */
function authenticate_(token) {
  if (!token) {
    if (devMode_() && prop_('DEV_LINE_UID')) return prop_('DEV_LINE_UID');
    throw new Error('[UNAUTHENTICATED] 缺少 LINE 登入憑證');
  }
  var channelId = String(prop_('LINE_LOGIN_CHANNEL_ID')).trim();
  if (!channelId) throw new Error('[CONFIG] 尚未設定 LINE_LOGIN_CHANNEL_ID');
  // LINE access token 與 ID token 都是 JWS 格式，無法靠外觀分辨：先當 LIFF access token（與每日紀錄／會員中心相同），失敗再當 ID token。
  var access = verifyAccessToken_(token, channelId);
  if (access.uid) return access.uid;
  var id = verifyIdToken_(token, channelId);
  if (id.uid) return id.uid;
  throw new Error('[UNAUTHENTICATED] LINE 憑證無效或已過期 (' + access.error + '; ' + id.error + ')');
}
function verifyAccessToken_(token, channelId) {
  var verify = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (verify.getResponseCode() !== 200) return { error: 'access_token ' + verify.getResponseCode() + ': ' + verify.getContentText().slice(0, 100) };
  var verified = JSON.parse(verify.getContentText());
  if (String(verified.client_id) !== String(channelId) || !(verified.expires_in > 0)) return { error: 'access_token client_id=' + verified.client_id + ' configured=[' + channelId + '] expires_in=' + verified.expires_in };
  var profile = UrlFetchApp.fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (profile.getResponseCode() !== 200) return { error: 'profile ' + profile.getResponseCode() };
  var uid = JSON.parse(profile.getContentText()).userId;
  return uid ? { uid: uid } : { error: 'profile without userId' };
}
function verifyIdToken_(token, channelId) {
  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', muteHttpExceptions: true,
    payload: { id_token: token, client_id: channelId }
  });
  if (res.getResponseCode() !== 200) return { error: 'id_token ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 100) };
  var body = JSON.parse(res.getContentText());
  if (!body.sub || String(body.aud) !== String(channelId)) return { error: 'id_token aud mismatch' };
  return { uid: body.sub };
}

// ---------- 讀取（批次，一張表一次 getValues）----------
function cell_(v, header, sheetTimeZone) {
  if (v instanceof Date) {
    var tz = 'Asia/Taipei';
    // 純日期欄位（recordDate / date）輸出 yyyy-MM-dd，其餘輸出帶 +08:00 的 ISO，避免時區位移
    if (header === 'recordDate' || header === 'date') return Utilities.formatDate(v, sheetTimeZone, 'yyyy-MM-dd');
    return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return v;
}
function readSheet_(ssId, name, optional) {
  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(name);
  if (!sh) { if (optional) return []; throw new Error('[CONFIG] 找不到工作表 ' + name); }
  var vals = sh.getDataRange().getValues();
  var heads = vals.shift();
  var sheetTimeZone = ss.getSpreadsheetTimeZone();
  return vals.filter(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (r) { var o = {}; heads.forEach(function (h, i) { o[h] = cell_(r[i], h, sheetTimeZone); }); return o; });
}
function loadSource_(timings) {
  var f1 = prop_('F1_SPREADSHEET_ID');
  if (!f1) throw new Error('[CONFIG] 尚未設定 F1_SPREADSHEET_ID');
  var t0 = Date.now();
  var src = {
    families: readSheet_(f1, SHEET.families),
    members: readSheet_(f1, SHEET.members),
    familyPatients: readSheet_(f1, SHEET.familyPatients, true).map(function (r) { return { familyId: r.familyId || r.family_id, patientId: r.patientId || r.patient_id }; }),
    dailyRecords: readSheet_(f1, SHEET.daily),
    appointments: prop_('APPT_SPREADSHEET_ID') ? readSheet_(prop_('APPT_SPREADSHEET_ID'), SHEET.appts, true) : []
  };
  if (timings) timings.sheetsMs = Date.now() - t0;
  return src;
}
function nowIso_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX"); }

// ---------- 對外 API（google.script.run）----------
/** 單次呼叫取得 session + 儀表板（減少 round trip）。回傳 {context, dashboard, meta}。 */
function getHubData(idToken, days) {
  var tm = {}; var t0 = Date.now();
  var uid = authenticate_(idToken); tm.authMs = Date.now() - t0;
  var src = loadSource_(tm);
  var t1 = Date.now();
  var ctx = DashboardService.getSessionContext(src, uid);
  var dash = DashboardService.getDashboardData(src, uid, ctx.patients[0].id, days || 7, nowIso_());
  tm.buildMs = Date.now() - t1; tm.totalMs = Date.now() - t0;
  return { context: ctx, dashboard: dash, meta: { devMode: devMode_() && !idToken, timings: tm } };
}
function getSessionContext(idToken) {
  var uid = authenticate_(idToken);
  return DashboardService.getSessionContext(loadSource_(), uid);
}
function getDashboardData(idToken, patientId, days) {
  var uid = authenticate_(idToken);
  return DashboardService.getDashboardData(loadSource_(), uid, patientId, days, nowIso_());
}
function getVisitSummary(idToken, patientId, days) {
  var uid = authenticate_(idToken);
  return DashboardService.getVisitSummary(loadSource_(), uid, patientId, days, nowIso_());
}
function generateVisitPdf(idToken, patientId, days) {
  var d = getVisitSummary(idToken, patientId, days);
  var template = HtmlService.createTemplateFromFile('PdfTemplate');
  template.data = d;
  var pdf = Utilities.newBlob(template.evaluate().getContent(), 'text/html', 'summary.html').getAs(MimeType.PDF)
    .setName('健康摘要_' + d.patient.id + '_' + d.days + '天.pdf');
  return { filename: pdf.getName(), base64: Utilities.base64Encode(pdf.getBytes()) };
}

// Top-level LIFF host calls this endpoint through its same-origin server.
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (devMode_() || typeof body.idToken !== 'string' || !body.idToken) {
      throw new Error('[UNAUTHENTICATED] 請使用 LINE 登入');
    }
    var data;
    switch (body.action) {
      case 'getHubData': data = getHubData(body.idToken, body.days); break;
      case 'getDashboardData': data = getDashboardData(body.idToken, body.patientId, body.days); break;
      case 'generateVisitPdf': data = generateVisitPdf(body.idToken, body.patientId, body.days); break;
      default: throw new Error('[BAD_REQUEST] 不支援的操作');
    }
    return json_({ ok: true, data: data });
  } catch (err) {
    console.error('dashboard doPost failed: ' + err.message);
    var match = /^\[([A-Z_]+)\]/.exec(err.message);
    return json_({ ok: false, error: '[' + (match ? match[1] : 'SERVER_ERROR') + '] 無法完成操作', detail: String(err.message).slice(0, 300) });
  }
}
function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
