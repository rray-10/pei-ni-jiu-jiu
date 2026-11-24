const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {planPatientLinks} = require('../scripts/plan-patient-links');
const {render} = require('../frontend/server');

test('member, daily, dashboard and appointment routes share a binding gate', () => {
  const env = {LIFF_ENDPOINT:'https://hub.example.test/',LIFF_ID:'test'};
  for (const page of ['bind','member','daily','dashboard','settings','summary','appointments']) {
    const markup = render(page,env);
    assert.match(markup,/id="startFamily"/);
    assert.match(markup,/id="joinFamily"/);
    assert.match(markup,/id="chooseStart"/);
    assert.match(markup,/id="chooseJoin"/);
    assert.match(markup,/id="chooseProxy"/);
    assert.match(markup,/id="switchPanel"/);
    assert.equal(markup.match(/\/liff\/edge\/2\/sdk.js/g).length,1);
  }
});

test('self-binding provisions an idempotent family and patient and permits a single invited member', () => {
  const tables = {
    Members:[['familyId','lineUid','role']],
    Families:[['familyId','patientName']],
    FamilyPatients:[['familyId','patientId']],
    FamilyInvites:[['codeHash','familyId','expiresAt','claimedBy']],
    TrackingSettings:[['familyId','metricKey','enabled','updatedAt']],
    MetricDefinitions:[['metricKey','metricName','inputType','unit','isActive'],['blood_pressure','血壓','bloodPressure','mmHg',true]]
  };
  const ss = {getSheetByName(name) {
    const rows = tables[name];
    return rows && {
      getDataRange:() => ({getValues:() => structuredClone(rows)}),
      getLastRow:() => rows.length,
      deleteRow:row => { rows.splice(row-1,1); },
      getRange:(row,column) => ({setValues:values => rows.push(...values),setValue:value => {rows[row-1][column-1]=value;}})
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
  assert.equal(run('fixture-self','memberStatus').bound,false);
  const self = run('fixture-self','createFamily',{patientName:'測試本人'});
  assert.equal(self.role,'admin');
  assert.match(self.patientId,/^P_/);
  assert.equal(run('fixture-self','createFamily',{patientName:'重送'}).patientId,self.patientId);
  assert.equal(tables.Families.length,2);
  assert.equal(tables.TrackingSettings.length,2);
  const invite = run('fixture-self','createInvite').inviteCode;
  assert.notEqual(tables.FamilyInvites[1][0],invite);
  const caregiver = run('fixture-caregiver','joinFamily',{inviteCode:invite});
  assert.equal(caregiver.patientId,self.patientId);
  assert.equal(caregiver.role,'member');
  assert.throws(() => run('fixture-caregiver','createInvite'),/只有家庭管理者/);
  assert.throws(() => run('fixture-outsider','joinFamily',{inviteCode:invite}),/邀請碼無效/);
  assert.equal(run('fixture-outsider','memberStatus').bound,false);

  assert.throws(() => run('fixture-self','unbind'),/其他成員/);
  assert.equal(run('fixture-caregiver','unbind').unbound,true);
  assert.equal(run('fixture-caregiver','memberStatus').bound,false);
  assert.equal(run('fixture-self','unbind').unbound,true);
  assert.equal(run('fixture-self','memberStatus').bound,false);
  assert.equal(tables.Members.length,1);
  assert.throws(() => run('fixture-outsider','unbind'),/尚未加入/);
  assert.equal(run('fixture-self','createFamily',{patientName:'測試本人'}).patientId,self.patientId);

  const profiled = run('fixture-profile','createFamily',{patientName:'含資料',birthYear:'1956',conditions:['高血壓','糖尿病'],
    allergies:'無',metrics:['blood_pressure'],thresholds:{blood_pressure:{systolicHigh:140}}});
  assert.equal(profiled.bound,true);
  assert.deepEqual(tables.Families[0].slice(-3),['birthYear','conditions','allergies']);
  assert.deepEqual(tables.Families.at(-1).slice(-3),[1956,'高血壓、糖尿病','無']);
  assert.throws(() => run('fixture-bad','createFamily',{patientName:'x',metrics:['nope']}),/追蹤項目/);
  assert.throws(() => run('fixture-bad','createFamily',{patientName:'x',birthYear:'19'}),/出生年/);
  assert.throws(() => run('fixture-bad','createFamily',{patientName:'x',metrics:['blood_pressure'],thresholds:{blood_pressure:{bogus:1}}}),/警示值/);
  assert.equal(run('fixture-bad','memberStatus').bound,false);

  const second = run('fixture-profile','createInvite').inviteCode;
  const preview = run('fixture-viewer','previewInvite',{inviteCode:second});
  assert.equal(preview.bound,false);
  assert.equal(preview.preview.patientName,'含資料');
  assert.equal(run('fixture-viewer','memberStatus').bound,false);
  assert.throws(() => run('fixture-viewer','previewInvite',{inviteCode:invite}),/邀請碼無效/);

  // member list, promote, remove
  run('fixture-m1','joinFamily',{inviteCode:second,lineName:'小明'});
  const list = run('fixture-profile','listMembers',{lineName:'阿芮'}).members;
  assert.equal(list.length,2);
  assert.equal(list.filter(item => item.isSelf).length,1);
  assert.ok(list.every(item => /^[0-9a-f]{16}$/.test(item.key)));
  assert.equal(JSON.stringify(list).includes('fixture-'),false);
  assert.equal(list.find(item => !item.isSelf).displayName,'小明');
  const m1key = list.find(item => !item.isSelf).key;
  assert.throws(() => run('fixture-m1','removeMember',{memberKey:m1key}),/只有家庭管理者/);
  assert.throws(() => run('fixture-m1','promoteMember',{memberKey:m1key}),/只有家庭管理者/);
  assert.throws(() => run('fixture-profile','removeMember',{memberKey:'0'.repeat(16)}),/找不到/);
  assert.equal(run('fixture-profile','removeMember',{memberKey:m1key})._unlinkUid,'fixture-m1');
  assert.equal(run('fixture-m1','memberStatus').bound,false);
  const third = run('fixture-profile','createInvite').inviteCode;
  run('fixture-m1','joinFamily',{inviteCode:third});
  run('fixture-profile','promoteMember',{memberKey:m1key});
  assert.equal(run('fixture-m1','listMembers').members.every(item => item.role === 'admin'),true);
  assert.throws(() => run('fixture-profile','promoteMember',{memberKey:m1key}),/已經是管理者/);

  // another admin exists now, so the first admin may leave
  assert.equal(run('fixture-profile','unbind').unbound,true);
  const fourth = run('fixture-m1','createInvite').inviteCode;

  // already-bound account receiving an invite: preview + switch
  run('fixture-switch','createFamily',{patientName:'我自己'});
  const peek = run('fixture-switch','previewInvite',{inviteCode:fourth});
  assert.equal(peek.bound,true);
  assert.equal(peek.current.patientName,'我自己');
  assert.equal(peek.preview.patientName,'含資料');
  assert.equal(peek.switchBlocked,'');
  const switched = run('fixture-switch','switchFamily',{inviteCode:fourth});
  assert.equal(switched.patientName,'含資料');
  assert.equal(switched.role,'member');
  assert.equal(tables.Members.filter(row => row[1] === 'fixture-switch').length,1);
  assert.throws(() => run('fixture-switch','previewInvite',{inviteCode:fourth}),/已經是這個家庭/);

  // admin with other (non-admin) members cannot switch away
  run('fixture-lead','createFamily',{patientName:'帶頭'});
  run('fixture-follow','joinFamily',{inviteCode:run('fixture-lead','createInvite').inviteCode});
  const fifth = run('fixture-m1','createInvite').inviteCode;
  assert.match(run('fixture-lead','previewInvite',{inviteCode:fifth}).switchBlocked,/其他成員/);
  assert.throws(() => run('fixture-lead','switchFamily',{inviteCode:fifth}),/其他成員/);
  assert.equal(run('fixture-lead','memberStatus').patientName,'帶頭');

  // proxy creation needs explicit consent
  assert.throws(() => run('fixture-proxy','createFamily',{patientName:'代建',proxy:true}),/同意/);
  assert.equal(run('fixture-proxy','createFamily',{patientName:'代建',proxy:true,consent:true}).role,'admin');
  assert.equal(tables.Families[0].includes('createdFor'),true);
});

test('legacy migration uses exact identity and rejects a shared patient ID without writing', () => {
  const data = {
    families:[{familyId:'F_TEST_A'},{familyId:'F_TEST_B'}],
    members:[{familyId:'F_TEST_A',lineUid:'line-a'},{familyId:'F_TEST_B',lineUid:'line-b'}],
    users:[{user_id:'u-a',line_user_id:'line-a',role:'patient'},{user_id:'u-b',line_user_id:'line-b',role:'family'}],
    patients:[{user_id:'u-a',patient_id:'P_TEST_A'}],
    family_links:[]
  };
  assert.deepEqual(planPatientLinks(data).ready,[{familyId:'F_TEST_A',patientId:'P_TEST_A'}]);
  data.family_links.push({family_user_id:'u-b',patient_id:'P_TEST_A',status:'active'});
  const conflict = planPatientLinks(data);
  assert.equal(conflict.ready.length,0);
  assert.equal(conflict.unresolved.every(row => row.reason === 'patient_shared_by_families'),true);
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
