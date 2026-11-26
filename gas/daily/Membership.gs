const MEMBER_ACTIONS = ['memberStatus','previewInvite','createFamily','joinFamily','switchFamily','createInvite','syncMenu','unbind','deleteFamily','restoreFamily','listMembers','removeMember','promoteMember'];
const MEMBER_RESTORE_MONTHS = 3;
const MEMBER_DEFAULT_METRICS = ['blood_pressure','blood_glucose'];
const memberHash_ = value => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8)
  .map(byte => ((byte + 256) % 256).toString(16).padStart(2,'0')).join('');

function memberEnsureColumns_(table, columns) {
  columns.forEach(column => {
    if (table.headers.includes(column)) return;
    table.sheet.getRange(1,table.headers.length+1).setValue(column);
    table.headers.push(column);
  });
}

function memberProfile_(body) {
  const profile = {};
  const year = f1Text_(body.birthYear);
  if (year) {
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > new Date().getFullYear()) f1Fail_('出生年請輸入 4 位數西元年');
    profile.birthYear = Number(year);
  }
  const list = Array.isArray(body.conditions) ? body.conditions : (body.conditions ? [body.conditions] : []);
  const conditions = list.map(f1Text_).filter(Boolean);
  if (conditions.length > 10 || conditions.some(item => item.length > 30)) f1Fail_('慢性病內容過長');
  if (conditions.length) profile.conditions = conditions.join('、');
  const allergies = f1Text_(body.allergies);
  if (allergies.length > 200) f1Fail_('過敏史請在 200 字內');
  if (allergies) profile.allergies = allergies;
  return profile;
}

function memberTracking_(body, catalog) {
  const available = new Set(catalog.map(m => m.metricKey));
  const keys = body.metrics === undefined ? MEMBER_DEFAULT_METRICS.filter(key => available.has(key)) : body.metrics;
  if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some(key => !available.has(key))) {
    f1Fail_('請至少選擇一個有效的追蹤項目');
  }
  const input = body.thresholds && typeof body.thresholds === 'object' && !Array.isArray(body.thresholds) ? body.thresholds : {};
  if (Object.keys(input).some(key => !keys.includes(key))) f1Fail_('警示值包含未選擇的項目');
  return keys.map(key => {
    const fields = input[key] && typeof input[key] === 'object' ? input[key] : {};
    const thresholds = {};
    Object.keys(fields).forEach(field => {
      const value = fields[field];
      if (!F1_THRESHOLDS.includes(field)) f1Fail_('警示值欄位無效');
      if (value === '' || value == null) return;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) f1Fail_('警示值請輸入數字');
      thresholds[field] = value;
    });
    return {key,thresholds};
  });
}

function memberInvite_(ss, code) {
  code = f1Text_(code).toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(code)) f1Fail_('邀請碼無效或已過期');
  const invites = f1Table_(ss,'FamilyInvites',['codeHash','familyId','expiresAt','claimedBy']);
  const index = invites.rows.findIndex(row => row.codeHash === memberHash_(code));
  return {invites,index,invite:invites.rows[index]};
}

/** 3 個月內可復原（刪除後由建立頁復原，只恢復刪除的人，其他人用新邀請重新加入）。 */
function memberRestoreUntil_(deletedAt) {
  const until = new Date(deletedAt);
  if (!deletedAt || isNaN(until)) return null;
  const day = until.getUTCDate();
  until.setUTCMonth(until.getUTCMonth() + MEMBER_RESTORE_MONTHS);
  if (until.getUTCDate() !== day) until.setUTCDate(0); // 11/30 + 3 個月 → 2 月最後一天
  return until;
}

/** 此帳號刪除過、仍在復原期限內的照護家庭。 */
function memberRestorable_(families, uid) {
  return families.rows.map((row,index) => ({row,index,until:memberRestoreUntil_(row.deletedAt)}))
    .filter(item => item.row.deletedBy === uid && item.until && item.until.getTime() > Date.now());
}

function memberWriteFamily_(families, index, values) {
  memberEnsureColumns_(families,Object.keys(values));
  Object.keys(values).forEach(key => {
    families.sheet.getRange(index+2,families.headers.indexOf(key)+1).setValue(values[key]);
    families.rows[index][key] = values[key];
  });
}

/**
 * 結束照護家庭：所有成員列刪除、邀請碼失效、家庭標記為可復原。健康資料不刪除。
 * 回傳其他成員的 userId（需要通知他們），以及復原期限。
 */
function memberEndFamily_(ss, members, familyId, uid) {
  const families = f1Table_(ss,'Families',['familyId','patientName']);
  const index = families.rows.findIndex(row => row.familyId === familyId);
  if (index < 0) f1Fail_('找不到照護家庭');
  const others = members.rows.filter(row => row.familyId === familyId && row.lineUid !== uid).map(row => row.lineUid);
  const deletedAt = new Date().toISOString();
  memberWriteFamily_(families,index,{deletedAt,deletedBy:uid});
  for (let i = members.rows.length - 1; i >= 0; i--) {
    if (members.rows[i].familyId !== familyId) continue;
    members.sheet.deleteRow(i+2);
    members.rows.splice(i,1);
  }
  const invites = f1Table_(ss,'FamilyInvites',['codeHash','familyId','expiresAt','claimedBy']);
  invites.rows.forEach((row,i) => {
    if (row.familyId === familyId) invites.sheet.getRange(i+2,invites.headers.indexOf('expiresAt')+1).setValue(deletedAt);
  });
  SpreadsheetApp.flush();
  return {others,patientName:families.rows[index].patientName,until:memberRestoreUntil_(deletedAt).toISOString()};
}

function memberValidInvite_(invite, uid, members) {
  // 家庭已結束（沒有成員），邀請碼一併失效
  return !!invite && Date.parse(invite.expiresAt) > Date.now() && (!invite.claimedBy || invite.claimedBy === uid) &&
    members.rows.some(row => row.familyId === invite.familyId);
}

function memberAppendMember_(members, familyId, uid, role, body) {
  memberEnsureColumns_(members,['displayName','joinedAt']);
  const row = {familyId,lineUid:uid,role,displayName:f1Text_(body.lineName).slice(0,40),joinedAt:new Date().toISOString()};
  f1Append_(members,[row]);
  members.rows.push(row);
}

function memberTarget_(members, familyId, body) {
  const key = f1Text_(body.memberKey);
  const index = members.rows.findIndex(row => row.familyId === familyId && memberHash_(row.lineUid).slice(0,16) === key);
  if (!key || index < 0) f1Fail_('找不到這位成員');
  return {index,row:members.rows[index]};
}

function memberFamily_(ss, familyId) {
  const families = f1Table_(ss,'Families',['familyId','patientName']).rows.filter(r => r.familyId === familyId);
  const patients = f1Table_(ss,'FamilyPatients',['familyId','patientId']).rows;
  const linked = patients.filter(r => r.familyId === familyId);
  if (families.length !== 1 || linked.length !== 1 || !linked[0].patientId ||
      patients.filter(r => r.patientId === linked[0].patientId).length !== 1) f1Fail_('家庭或照護對象資料缺漏或重複');
  return {patientId:linked[0].patientId,patientName:families[0].patientName};
}

const memberMenuId_ = value => /^richmenu-[0-9a-f]{32}$/.test(String(value || '')) ? value : '';

function unlinkMemberMenu_(uid, props) {
  const token = props.getProperty('LINE_OA_ACCESS_TOKEN');
  if (!token || !memberMenuId_(props.getProperty('UNBOUND_RICH_MENU_ID'))) return 'unconfigured';
  try {
    // Removing the per-user link makes LINE fall back to the OA default (unbound) menu.
    const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/user/' + encodeURIComponent(uid) + '/richmenu',
      {method:'delete',headers:{Authorization:'Bearer ' + token},muteHttpExceptions:true});
    return response.getResponseCode() === 200 ? 'unlinked' : 'retry';
  } catch (_) {
    return 'retry';
  }
}

function syncMemberMenu_(uid, props) {
  const menu = memberMenuId_(props.getProperty('BOUND_RICH_MENU_ID'));
  const token = props.getProperty('LINE_OA_ACCESS_TOKEN');
  if (!menu || !token) return 'unconfigured';
  try {
    const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/user/' + encodeURIComponent(uid) + '/richmenu/' + encodeURIComponent(menu),
      {method:'post',headers:{Authorization:'Bearer ' + token},muteHttpExceptions:true});
    return response.getResponseCode() === 200 ? 'linked' : 'retry';
  } catch (_) {
    return 'retry';
  }
}

/** LINE 推播（會占官方帳號每月額度）。只給已加官方帳號好友的人才收得到；失敗不影響家庭刪除。 */
function memberPush_(uids, text, props) {
  const token = props.getProperty('LINE_OA_ACCESS_TOKEN');
  if (!token || !uids.length) return 'unconfigured';
  let failed = 0;
  uids.forEach(to => {
    try {
      const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push',
        {method:'post',contentType:'application/json',headers:{Authorization:'Bearer ' + token},
          payload:JSON.stringify({to,messages:[{type:'text',text}]}),muteHttpExceptions:true});
      if (response.getResponseCode() !== 200) failed++;
    } catch (_) {
      failed++;
    }
  });
  return failed ? 'partial' : 'sent';
}

function membership_(ss, uid, body) {
  const members = f1Table_(ss,'Members',['familyId','lineUid','role']);
  let matches = members.rows.filter(row => row.lineUid === uid);
  if (matches.length > 1 || (matches.length && !matches[0].familyId)) f1Fail_('家庭成員資料有衝突');
  let familyId = matches[0]?.familyId;
  let inviteCode;
  let action = body.action;
  let unlinkUids = [];
  let notify = null;
  let until = '';

  const payload = () => ({
    ...(unlinkUids.length ? {_unlinkUids:unlinkUids} : {}),
    ...(notify ? {_notify:notify} : {})
  });

  // 結束家庭：其他成員都被解除綁定並收到通知
  const endFamily = () => {
    const ended = memberEndFamily_(ss,members,familyId,uid);
    unlinkUids = ended.others;
    if (ended.others.length) notify = {uids:ended.others,text:'「' + ended.patientName + '」的照護家庭已刪除，您已被自動解除綁定'};
    until = ended.until;
    return true;
  };

  // 離開目前家庭（解除綁定、或加入其他家庭前）。回傳 true 表示家庭因此被結束。
  const leaveCurrent = () => {
    const mine = members.rows.filter(row => row.familyId === familyId);
    const self = mine.find(row => row.lineUid === uid);
    const others = mine.filter(row => row.lineUid !== uid);
    if (!others.length) return endFamily();
    if (self.role === 'admin' && !others.some(row => row.role === 'admin')) {
      // 管理者離開且沒有其他管理者：必須刪除家庭，或先指定一位成員為管理者
      if (body.deleteFamily === true) return endFamily();
      const key = f1Text_(body.promoteMemberKey);
      const target = others.find(row => memberHash_(row.lineUid).slice(0,16) === key);
      if (!target) f1Fail_('離開前請指定另一位成員為管理者，或刪除家庭');
      members.sheet.getRange(members.rows.indexOf(target)+2,members.headers.indexOf('role')+1).setValue('admin');
      target.role = 'admin';
      SpreadsheetApp.flush();
    } else if (body.deleteFamily === true && self.role !== 'admin') {
      f1Fail_('只有管理者可以刪除家庭');
    }
    const index = members.rows.indexOf(self);
    members.sheet.deleteRow(index+2);
    members.rows.splice(index,1);
    SpreadsheetApp.flush();
    return false;
  };

  if (action === 'createFamily' && !familyId) {
    const name = f1Text_(body.patientName);
    if (!name || name.length > 60) f1Fail_('請輸入 1 到 60 字的稱呼');
    if (body.proxy && body.consent !== true) f1Fail_('替家人建立前，請先確認已取得患者同意');
    const profile = memberProfile_(body);
    // 每次建立都是新家庭；同一份表單的重送沿用同一個 requestId，不會重複建立
    const request = /^[0-9a-f-]{36}$/i.test(f1Text_(body.requestId)) ? f1Text_(body.requestId) : Utilities.getUuid();
    const key = memberHash_(uid + ':' + request);
    familyId = 'F_' + key.slice(0,32);
    const patientId = 'P_' + key.slice(32);
    const families = f1Table_(ss,'Families',['familyId','patientName']);
    const patients = f1Table_(ss,'FamilyPatients',['familyId','patientId']);
    const existing = families.rows.filter(r => r.familyId === familyId);
    const linked = patients.rows.filter(r => r.familyId === familyId || r.patientId === patientId);
    if (existing.some(r => f1Text_(r.deletedAt))) f1Fail_('這個照護家庭已刪除，請重新整理頁面');
    if (existing.length > 1 || linked.length > 1 || (linked.length && (linked[0].familyId !== familyId || linked[0].patientId !== patientId))) {
      f1Fail_('照護家庭資料有衝突');
    }
    const settings = f1Table_(ss,'TrackingSettings',['familyId','metricKey','enabled','updatedAt']);
    const metrics = f1Metrics_(ss,familyId,settings).metrics;
    const tracking = memberTracking_(body,metrics);
    if (!existing.length) {
      memberEnsureColumns_(families,[...Object.keys(profile),'createdFor']);
      f1Append_(families,[{familyId,patientName:name,...profile,createdFor:body.proxy ? 'proxy' : 'self'}]);
    }
    if (!linked.length) f1Append_(patients,[{familyId,patientId}]);
    const now = new Date().toISOString();
    const starter = tracking.filter(item => !settings.rows.some(r => r.familyId === familyId && r.metricKey === item.key))
      .map(item => {
        const m = metrics.find(metric => metric.metricKey === item.key);
        return {...item.thresholds,familyId,metricKey:item.key,metricName:m.metricName,unit:m.unit,enabled:true,updatedAt:now,updatedBy:uid};
      });
    f1Append_(settings,starter);
    memberAppendMember_(members,familyId,uid,'admin',body);
    matches = [{familyId,lineUid:uid,role:'admin'}];
  }

  if (action === 'switchFamily') {
    if (!familyId) f1Fail_('尚未加入照護家庭');
    const {invite} = memberInvite_(ss,body.inviteCode);
    if (!memberValidInvite_(invite,uid,members)) f1Fail_('邀請碼無效或已過期');
    if (invite.familyId === familyId) f1Fail_('你已經是這個家庭的成員');
    leaveCurrent();
    familyId = undefined;
    matches = [];
    action = 'joinFamily';
  }

  if (action === 'joinFamily' && !familyId) {
    const {invites,index,invite} = memberInvite_(ss,body.inviteCode);
    if (!memberValidInvite_(invite,uid,members)) f1Fail_('邀請碼無效或已過期');
    familyId = invite.familyId;
    memberFamily_(ss,familyId);
    invites.sheet.getRange(index+2,invites.headers.indexOf('claimedBy')+1).setValue(uid);
    SpreadsheetApp.flush();
    memberAppendMember_(members,familyId,uid,'member',body);
    matches = [{familyId,lineUid:uid,role:'member'}];
  }

  if (action === 'previewInvite') {
    const {invite} = memberInvite_(ss,body.inviteCode);
    if (!memberValidInvite_(invite,uid,members)) f1Fail_('邀請碼無效或已過期');
    const preview = {patientName:memberFamily_(ss,invite.familyId).patientName};
    if (!familyId) return {bound:false,preview};
    if (invite.familyId === familyId) f1Fail_('你已經是這個家庭的成員');
    const mine = members.rows.filter(row => row.familyId === familyId);
    const others = mine.filter(row => row.lineUid !== uid);
    return {bound:true,preview,current:{patientName:memberFamily_(ss,familyId).patientName,role:matches[0].role},
      needsChoice:matches[0].role === 'admin' && others.length > 0 && !others.some(row => row.role === 'admin'),
      lastMember:!others.length,otherMembers:others.length};
  }

  if (action === 'unbind') {
    if (!familyId) f1Fail_('尚未加入照護家庭');
    const ended = leaveCurrent();
    return {bound:false,unbound:true,deleted:ended,restoreUntil:until,...payload()};
  }

  if (action === 'deleteFamily') {
    if (!familyId) f1Fail_('尚未加入照護家庭');
    if (matches[0].role !== 'admin') f1Fail_('只有管理者可以刪除家庭');
    endFamily();
    return {bound:false,unbound:true,deleted:true,restoreUntil:until,...payload()};
  }

  if (action === 'restoreFamily') {
    if (familyId) f1Fail_('請先離開目前的照護家庭，再復原');
    const families = f1Table_(ss,'Families',['familyId','patientName']);
    const target = memberRestorable_(families,uid).find(item => item.row.familyId === body.familyId);
    if (!target) f1Fail_('這個照護家庭已超過復原期限或不存在');
    if (members.rows.some(row => row.familyId === target.row.familyId)) f1Fail_('這個照護家庭已有成員');
    familyId = target.row.familyId;
    memberFamily_(ss,familyId);
    memberWriteFamily_(families,target.index,{deletedAt:'',deletedBy:''});
    memberAppendMember_(members,familyId,uid,'admin',body);
    matches = [{familyId,lineUid:uid,role:'admin'}];
  }

  if (!familyId) {
    if (action !== 'memberStatus') f1Fail_('尚未加入照護家庭');
    const families = f1Table_(ss,'Families',['familyId','patientName']);
    return {bound:false,restorable:memberRestorable_(families,uid).map(item =>
      ({familyId:item.row.familyId,patientName:item.row.patientName,restoreUntil:item.until.toISOString()}))};
  }
  const family = memberFamily_(ss,familyId);
  const role = matches[0]?.role || (action === 'createFamily' ? 'admin' : 'member');
  if (action === 'listMembers') {
    return {bound:true,familyId,role,members:members.rows.filter(row => row.familyId === familyId).map(row => ({
      key:memberHash_(row.lineUid).slice(0,16),displayName:f1Text_(row.displayName),role:row.role === 'admin' ? 'admin' : 'member',
      isSelf:row.lineUid === uid,joinedAt:f1Text_(row.joinedAt)}))};
  }
  if (action === 'removeMember' || action === 'promoteMember') {
    if (role !== 'admin') f1Fail_('只有管理者可管理成員');
    const target = memberTarget_(members,familyId,body);
    if (target.row.lineUid === uid) f1Fail_('不能對自己執行這個操作');
    if (target.row.role === 'admin') f1Fail_('這位成員已經是管理者');
    if (action === 'promoteMember') {
      members.sheet.getRange(target.index + 2,members.headers.indexOf('role') + 1).setValue('admin');
      target.row.role = 'admin';
      SpreadsheetApp.flush();
      return {bound:true,familyId,role,promoted:true};
    }
    members.sheet.deleteRow(target.index + 2);
    members.rows.splice(target.index,1);
    SpreadsheetApp.flush();
    return {bound:true,familyId,role,removed:true,_unlinkUids:[target.row.lineUid]};
  }
  if (matches[0] && !f1Text_(matches[0].displayName) && f1Text_(body.lineName)) {
    memberEnsureColumns_(members,['displayName','joinedAt']);
    members.sheet.getRange(members.rows.findIndex(row => row.lineUid === uid) + 2,members.headers.indexOf('displayName') + 1).setValue(f1Text_(body.lineName).slice(0,40));
  }
  if (action === 'createInvite') {
    if (role !== 'admin') f1Fail_('只有家庭管理者可產生邀請碼');
    const invites = f1Table_(ss,'FamilyInvites',['codeHash','familyId','expiresAt','claimedBy']);
    inviteCode = Utilities.getUuid().replace(/-/g,'').toLowerCase();
    f1Append_(invites,[{codeHash:memberHash_(inviteCode),familyId,expiresAt:new Date(Date.now()+86400000).toISOString()}]);
  }
  return {bound:true,familyId,role,patientId:family.patientId,patientName:family.patientName,
    ...(inviteCode ? {inviteCode} : {}),...payload()};
}
