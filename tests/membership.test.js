const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {render} = require('../frontend/server');

test('member, daily, dashboard and appointment routes share a binding gate', () => {
  const env = {LIFF_ENDPOINT:'https://hub.example.test/',LIFF_ID:'test'};
  for (const page of ['bind','member','daily','dashboard','settings','summary','appointments']) {
    const markup = render(page,env);
    assert.match(markup,/id="startFamily"/);
    assert.match(markup,/id="joinFamily"/);
    assert.match(markup,/id="chooseStart"/);
    assert.match(markup,/id="chooseJoin"/);
    assert.match(markup,/name="forWhom"/);
    assert.match(markup,/id="switchPanel"/);
    assert.equal(markup.match(/\/liff\/edge\/2\/sdk.js/g).length,1);
  }
});

test('membership lifecycle: create, invite, leave, admin choices, delete and restore', () => {
  const tables = {
    Members:[['familyId','lineUid','role']],
    Families:[['familyId','patientName']],
    FamilyPatients:[['familyId','patientId']],
    FamilyInvites:[['codeHash','familyId','expiresAt','claimedBy']],
    TrackingSettings:[['familyId','metricKey','enabled','updatedAt']],
    PendingLinks:[['lineUid','familyId','role','createdAt','expiresAt']],
    MetricDefinitions:[['metricKey','metricName','inputType','unit','isActive'],['blood_pressure','血壓','bloodPressure','mmHg',true],['blood_glucose','血糖','number','mg/dL',true]]
  };
  const ss = {getSheetByName(name) {
    const rows = tables[name];
    return rows && {
      getDataRange:() => ({getValues:() => structuredClone(rows)}),
      getLastRow:() => rows.length,
      deleteRow:row => { rows.splice(row-1,1); },
      getRange:(row,column) => ({setValues:values => rows.push(...values),setValue:value => {
        while (rows.length < row) rows.push([]);
        rows[row-1][column-1] = value;
      }})
    };
  }};
  const context = vm.createContext({
    ss,SpreadsheetApp:{flush(){}},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
      computeDigest:(_,v) => [...createHash('sha256').update(v).digest()],
      getUuid:(() => { let n = 0; return () => '00000000-0000-4000-8000-' + String(++n).padStart(12,'0'); })()}
  });
  for (const file of ['gas/daily/Api.gs','gas/daily/Membership.gs']) vm.runInContext(readFileSync(file,'utf8'),context);
  const run = (uid,action,fields={}) => context.membership_(ss,uid,{action,...fields});
  const members = uid => run(uid,'listMembers').members;
  const keyOf = uid => createHash('sha256').update(uid).digest('hex').slice(0,16); // same as the member key shown in the UI
  const invite = uid => run(uid,'createInvite').inviteCode;
  const requestId = '11111111-1111-4111-8111-111111111111';

  // create
  assert.equal(run('fixture-self','memberStatus').bound,false);
  const first = run('fixture-self','createFamily',{patientName:'本人',requestId});
  assert.equal(first.role,'admin');
  assert.match(first.patientId,/^P_/);
  assert.equal(run('fixture-self','createFamily',{patientName:'本人',requestId}).familyId,first.familyId); // same form resent

  // member joins by invite; member can leave on their own, family stays
  const code1 = invite('fixture-self');
  assert.equal(run('fixture-caregiver','joinFamily',{inviteCode:code1}).role,'member');
  assert.throws(() => run('fixture-caregiver','createInvite'),/只有家庭管理者/);
  assert.throws(() => run('fixture-outsider','joinFamily',{inviteCode:code1}),/邀請碼無效/);
  assert.equal(run('fixture-caregiver','unbind').unbound,true);
  assert.equal(run('fixture-caregiver','memberStatus').bound,false);
  assert.equal(run('fixture-self','memberStatus').familyId,first.familyId);
  assert.equal(members('fixture-self').length,1);

  // admin leaving with other members and no other admin must choose
  run('fixture-caregiver','joinFamily',{inviteCode:invite('fixture-self')});
  assert.throws(() => run('fixture-self','unbind'),/指定另一位成員為管理者，或刪除家庭/);
  run('fixture-other','createFamily',{patientName:'別家'});
  assert.equal(run('fixture-self','previewInvite',{inviteCode:run('fixture-other','createInvite').inviteCode}).needsChoice,true);
  // option A: hand over to a member, then leave
  assert.equal(run('fixture-self','unbind',{promoteMemberKey:keyOf('fixture-caregiver')}).unbound,true);
  assert.equal(run('fixture-self','memberStatus').bound,false);
  assert.equal(run('fixture-caregiver','memberStatus').role,'admin');
  assert.equal(run('fixture-caregiver','memberStatus').familyId,first.familyId);
  // the handed-over admin cannot be removed by a non-admin, and the family keeps going
  assert.throws(() => run('fixture-self','removeMember',{memberKey:'0'.repeat(16)}),/尚未加入/); // left, so no longer a member

  // option B: delete the family for everyone; only admins may do it
  const rejoin = invite('fixture-caregiver');
  run('fixture-self','joinFamily',{inviteCode:rejoin});
  assert.throws(() => run('fixture-self','deleteFamily'),/只有管理者/);
  const deletedFor = run('fixture-caregiver','unbind',{deleteFamily:true});
  assert.equal(deletedFor.deleted,true);
  assert.deepEqual([...deletedFor._unlinkUids],['fixture-self']);
  assert.equal(deletedFor._notify.text,'「本人」的照護家庭已刪除，您已被自動解除綁定');
  assert.deepEqual([...deletedFor._notify.uids],['fixture-self']);
  assert.equal(run('fixture-self','memberStatus').bound,false);
  assert.throws(() => run('fixture-late','joinFamily',{inviteCode:rejoin}),/邀請碼無效/); // old codes stay dead

  // deleted family restorable only by whoever ended it, and it returns as a single admin
  const restorable = run('fixture-caregiver','memberStatus').restorable;
  assert.equal(restorable.length,1);
  assert.equal(run('fixture-self','memberStatus').restorable.length,0);
  assert.throws(() => run('fixture-self','restoreFamily',{familyId:first.familyId}),/復原期限/);
  const restored = run('fixture-caregiver','restoreFamily',{familyId:first.familyId});
  assert.deepEqual([restored.familyId,restored.role],[first.familyId,'admin']);
  assert.deepEqual(members('fixture-caregiver').map(m => m.role),['admin']);
  assert.equal(run('fixture-self','memberStatus').bound,false); // others must rejoin with a new invite
  assert.equal(run('fixture-caregiver','memberStatus').bound,true);

  // last member leaving counts as deleting the family (restorable, no push: nobody else)
  const lastLeave = run('fixture-caregiver','unbind');
  assert.equal(lastLeave.deleted,true);
  assert.equal(lastLeave._notify,undefined);
  assert.equal(run('fixture-caregiver','memberStatus').restorable.length,1);

  // restore window: three months, then gone
  const row = tables.Families.find(item => item[0] === first.familyId);
  row[tables.Families[0].indexOf('deletedAt')] = new Date(Date.now() - 100*86400000).toISOString();
  assert.equal(run('fixture-caregiver','memberStatus').restorable.length,0);
  assert.throws(() => run('fixture-caregiver','restoreFamily',{familyId:first.familyId}),/復原期限/);

  // a new creation never reuses the deleted family
  const fresh = run('fixture-caregiver','createFamily',{patientName:'全新稱呼'});
  assert.notEqual(fresh.familyId,first.familyId);
  assert.equal(fresh.patientName,'全新稱呼');
  assert.equal(run('fixture-caregiver','createFamily',{patientName:'重送',requestId}).familyId,fresh.familyId); // already bound: no second family

  // a non-friend accepting an invite is parked as pending; the follow event completes the binding
  const pendingCode = run('fixture-caregiver','createInvite').inviteCode;
  assert.equal(context.membership_(ss,'fixture-newfriend',{action:'joinFamily',inviteCode:pendingCode,notFriend:true}).pending,true);
  assert.equal(run('fixture-newfriend','memberStatus').bound,false);
  assert.equal(tables.PendingLinks.length,2);
  const activated = context.memberActivatePending_(ss,'fixture-newfriend');
  assert.equal(activated.activated,true);
  assert.equal(run('fixture-newfriend','memberStatus').bound,true);
  assert.equal(context.memberActivatePending_(ss,'fixture-newfriend').reason,'none'); // a second follow does nothing
  // an expired pending row is never activated
  context.membership_(ss,'fixture-late2',{action:'joinFamily',inviteCode:run('fixture-caregiver','createInvite').inviteCode,notFriend:true});
  tables.PendingLinks.find(item => item[0] === 'fixture-late2')[4] = new Date(Date.now() - 1000).toISOString();
  assert.equal(context.memberActivatePending_(ss,'fixture-late2').reason,'none');
  assert.equal(run('fixture-late2','memberStatus').bound,false);

  // profile, thresholds and proxy consent still validated
  const profiled = run('fixture-profile','createFamily',{patientName:'含資料',birthYear:'1956',conditions:['高血壓','糖尿病'],
    allergies:'無',metrics:['blood_pressure'],thresholds:{blood_pressure:{systolicHigh:140}}});
  const column = name => tables.Families[0].indexOf(name);
  assert.deepEqual(['birthYear','conditions','allergies'].map(name => tables.Families.at(-1)[column(name)]),[1956,'高血壓、糖尿病','無']);
  assert.equal(profiled.role,'admin');
  assert.throws(() => run('fixture-bad','createFamily',{patientName:'x',metrics:['nope']}),/追蹤項目/);
  assert.throws(() => run('fixture-bad','createFamily',{patientName:'x',birthYear:'19'}),/出生年/);
  assert.throws(() => run('fixture-bad','createFamily',{patientName:'x',metrics:['blood_pressure'],thresholds:{blood_pressure:{bogus:1}}}),/警示值/);
  assert.throws(() => run('fixture-proxy','createFamily',{patientName:'代建',proxy:true}),/同意/);
  assert.equal(run('fixture-proxy','createFamily',{patientName:'代建',proxy:true,consent:true}).role,'admin');
  assert.equal(tables.Families[0].includes('createdFor'),true);
});

test('rich menu areas fit inside the design images and do not overlap', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync('gas/daily/RichMenu.gs','utf8'),context);
  const defs = context.richMenuDefinitions_('2012665607-test');
  for (const menu of [defs.unbound,defs.bound]) {
    assert.ok([843,1686].includes(menu.size.height) && menu.size.width === 2500);
    for (const [i,a] of menu.areas.entries()) {
      const b = a.bounds;
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= menu.size.width && b.y + b.height <= menu.size.height);
      for (const other of menu.areas.slice(i + 1).map(item => item.bounds)) {
        assert.ok(b.x + b.width <= other.x || other.x + other.width <= b.x || b.y + b.height <= other.y || other.y + other.height <= b.y);
      }
    }
  }
  assert.equal(defs.unbound.areas[1].action.uri,'https://liff.line.me/2012665607-test/?page=bind');
  assert.equal(defs.bound.areas[3].action.uri,'https://liff.line.me/2012665607-test');
  assert.equal(defs.bound.areas[4].action.uri,'https://liff.line.me/2012665607-test/?page=member');
});
