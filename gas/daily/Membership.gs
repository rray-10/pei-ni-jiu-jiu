const MEMBER_ACTIONS = ['memberStatus','previewInvite','createFamily','joinFamily','switchFamily','createInvite','syncMenu','unbind','listMembers','removeMember','promoteMember'];
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

function memberLeaveBlock_(members, familyId, uid, role) {
  const others = members.rows.filter(row => row.familyId === familyId && row.lineUid !== uid);
  return role === 'admin' && others.length && !others.some(row => row.role === 'admin')
    ? '家庭還有其他成員，請先把其中一位設為管理者，或移除其他成員，才能解除綁定' : '';
}

function memberValidInvite_(invite, uid) {
  return !!invite && Date.parse(invite.expiresAt) > Date.now() && (!invite.claimedBy || invite.claimedBy === uid);
}

function memberAppendMember_(members, familyId, uid, role, body) {
  memberEnsureColumns_(members,['displayName','joinedAt']);
  f1Append_(members,[{familyId,lineUid:uid,role,displayName:f1Text_(body.lineName).slice(0,40),joinedAt:new Date().toISOString()}]);
}

function memberTarget_(members, familyId, body) {
  const key = f1Text_(body.memberKey);
  const index = members.rows.findIndex(row => row.familyId === familyId && memberHash_(row.lineUid).slice(0,16) === key);
  if (!key || index < 0) f1Fail_('找不到這位成員');
  return {index,row:members.rows[index]};
}

function membership_(ss, uid, body) {
  const members = f1Table_(ss,'Members',['familyId','lineUid','role']);
  let matches = members.rows.filter(row => row.lineUid === uid);
  if (matches.length > 1 || (matches.length && !matches[0].familyId)) f1Fail_('家庭成員資料有衝突');
  let familyId = matches[0]?.familyId;
  let inviteCode;
  let action = body.action;

  if (action === 'createFamily' && !familyId) {
    const name = f1Text_(body.patientName);
    if (!name || name.length > 60) f1Fail_('請輸入 1 到 60 字的稱呼');
    if (body.proxy && body.consent !== true) f1Fail_('替家人建立前，請先確認已取得患者同意');
    const profile = memberProfile_(body);
    // Stable across retries if an earlier request wrote only some of the rows.
    const key = memberHash_(uid);
    familyId = 'F_' + key.slice(0,32);
    const patientId = 'P_' + key.slice(32);
    const families = f1Table_(ss,'Families',['familyId','patientName']);
    const patients = f1Table_(ss,'FamilyPatients',['familyId','patientId']);
    const existing = families.rows.filter(r => r.familyId === familyId);
    const linked = patients.rows.filter(r => r.familyId === familyId || r.patientId === patientId);
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
  }

  if (action === 'switchFamily') {
    if (!familyId) f1Fail_('尚未加入照護家庭');
    const {invite} = memberInvite_(ss,body.inviteCode);
    if (!memberValidInvite_(invite,uid)) f1Fail_('邀請碼無效或已過期');
    if (invite.familyId === familyId) f1Fail_('你已經是這個家庭的成員');
    const blocked = memberLeaveBlock_(members,familyId,uid,matches[0].role);
    if (blocked) f1Fail_(blocked);
    members.sheet.deleteRow(members.rows.findIndex(row => row.lineUid === uid) + 2);
    SpreadsheetApp.flush();
    familyId = undefined;
    matches = [];
    action = 'joinFamily';
  }

  if (action === 'joinFamily' && !familyId) {
    const {invites,index,invite} = memberInvite_(ss,body.inviteCode);
    if (!memberValidInvite_(invite,uid)) {
      f1Fail_('邀請碼無效或已過期');
    }
    familyId = invite.familyId;
    memberFamily_(ss,familyId);
    invites.sheet.getRange(index+2,invites.headers.indexOf('claimedBy')+1).setValue(uid);
    SpreadsheetApp.flush();
    memberAppendMember_(members,familyId,uid,'member',body);
  }

  if (action === 'previewInvite') {
    const {invite} = memberInvite_(ss,body.inviteCode);
    if (!memberValidInvite_(invite,uid)) f1Fail_('邀請碼無效或已過期');
    const preview = {patientName:memberFamily_(ss,invite.familyId).patientName};
    if (!familyId) return {bound:false,preview};
    if (invite.familyId === familyId) f1Fail_('你已經是這個家庭的成員');
    return {bound:true,preview,current:{patientName:memberFamily_(ss,familyId).patientName,role:matches[0].role},
      switchBlocked:memberLeaveBlock_(members,familyId,uid,matches[0].role)};
  }

  if (action === 'unbind') {
    if (!familyId) f1Fail_('尚未加入照護家庭');
    const blocked = memberLeaveBlock_(members,familyId,uid,matches[0].role);
    if (blocked) f1Fail_(blocked);
    members.sheet.deleteRow(members.rows.findIndex(row => row.lineUid === uid) + 2);
    SpreadsheetApp.flush();
    return {bound:false,unbound:true};
  }

  if (!familyId) {
    if (action !== 'memberStatus') f1Fail_('尚未加入照護家庭');
    return {bound:false};
  }
  const family = memberFamily_(ss,familyId);
  const role = matches[0]?.role || (action === 'createFamily' ? 'admin' : 'member');
  if (action === 'listMembers') {
    return {bound:true,familyId,role,members:members.rows.filter(row => row.familyId === familyId).map(row => ({
      key:memberHash_(row.lineUid).slice(0,16),displayName:f1Text_(row.displayName),role:row.role === 'admin' ? 'admin' : 'member',
      isSelf:row.lineUid === uid,joinedAt:f1Text_(row.joinedAt)}))};
  }
  if (action === 'removeMember' || action === 'promoteMember') {
    if (role !== 'admin') f1Fail_('只有家庭管理者可管理成員');
    const target = memberTarget_(members,familyId,body);
    if (target.row.lineUid === uid) f1Fail_('請用「解除綁定」離開家庭');
    if (target.row.role === 'admin') f1Fail_('這位成員已經是管理者');
    if (action === 'promoteMember') {
      members.sheet.getRange(target.index + 2,members.headers.indexOf('role') + 1).setValue('admin');
      SpreadsheetApp.flush();
      return {bound:true,familyId,role,promoted:true};
    }
    members.sheet.deleteRow(target.index + 2);
    SpreadsheetApp.flush();
    return {bound:true,familyId,role,removed:true,_unlinkUid:target.row.lineUid};
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
    ...(inviteCode ? {inviteCode} : {})};
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
