const {test} = require('node:test');
const assert = require('node:assert/strict');
const med = require('../backend/medications.js');

function db(members) {
  const tables = {members, medications: []};
  const match = (row, query) => Object.entries(query || {}).every(([c, e]) => {
    if (['select','limit','order'].includes(c)) return true;
    if (e.startsWith('eq.')) return String(row[c]) === e.slice(3);
    return true;
  });
  return {tables,
    async select(t, q) { const r = tables[t].filter(x => match(x, q)); return q.limit ? r.slice(0, +q.limit) : r; },
    async insert(t, rows) { tables[t].push(...rows.map(r => ({...r}))); return rows; },
    async update(t, q, patch) { const hit = tables[t].filter(r => match(r, q)); hit.forEach(r => Object.assign(r, patch)); return hit; },
    async remove(t, q) { const hit = tables[t].filter(r => match(r, q)); tables[t] = tables[t].filter(r => !match(r, q)); return hit; }};
}
const ME = 'U' + 'a'.repeat(32), PARTNER = 'U' + 'b'.repeat(32), OUT = 'U' + 'c'.repeat(32);
const members = [{family_id:'F_1', line_uid:ME, role:'admin'}, {family_id:'F_1', line_uid:PARTNER, role:'member'}];

test('only admins can add, edit and disable medications; members can read; slots are validated', async () => {
  const d = db(members);
  await assert.rejects(() => med.saveMedication({db:d, uid:PARTNER, body:{name:'x', slots:['睡前']}}), /只有家庭管理者/);
  const added = await med.saveMedication({db:d, uid:ME, body:{name:'降血壓藥', dose:'10mg', slots:['早餐後','睡前']}});
  assert.equal(added.medications.length, 1);
  assert.deepEqual(added.medications[0].slots, ['早餐後','睡前']);
  const id = added.medications[0].medicationId;
  assert.equal((await med.listMedications({db:d, uid:PARTNER})).medications.length, 1);
  await assert.rejects(() => med.disableMedication({db:d, uid:PARTNER, body:{medicationId:id}}), /只有家庭管理者/);
  const edited = await med.saveMedication({db:d, uid:ME, body:{medicationId:id, name:'降血壓藥', dose:'20mg', slots:['晚餐後']}});
  assert.equal(edited.medications[0].dose, '20mg');
  assert.equal(d.tables.medications[0].schedule_per_day, 1);
  await assert.rejects(() => med.saveMedication({db:d, uid:ME, body:{name:'x', slots:['隨便']}}), /時段/);
  await assert.rejects(() => med.saveMedication({db:d, uid:ME, body:{name:'', slots:['睡前']}}), /藥名/);
  await assert.rejects(() => med.listMedications({db:d, uid:OUT}), /尚未加入/);
});

test('disabling keeps the row and hides it from the list', async () => {
  const d = db(members);
  const out = await med.saveMedication({db:d, uid:ME, body:{name:'A', slots:['睡前']}});
  const after = await med.disableMedication({db:d, uid:ME, body:{medicationId: out.medications[0].medicationId}});
  assert.equal(after.medications.length, 0);
  assert.equal(d.tables.medications.length, 1);          // 仍保留紀錄
  assert.equal(d.tables.medications[0].active, false);
});

test('medications entered during family creation are written with the family, or nothing is written', async () => {
  const d = db([]);
  const {insertMedications, parseBatch} = require('../backend/medications.js');
  assert.throws(() => parseBatch([{name:'A', slots:['隨便']}]), /時段/);   // 不合格：整批不寫
  assert.equal(d.tables.medications.length, 0);
  assert.equal(await insertMedications({db:d, familyId:'F_1', uid:ME, list:[{name:'降血壓藥', slots:['早餐後','睡前']}]}), 1);
  assert.equal(d.tables.medications[0].family_id, 'F_1');
  assert.equal(d.tables.medications[0].times, '早餐後、睡前');
  assert.equal(await insertMedications({db:d, familyId:'F_1', uid:ME, list:undefined}), 0);  // 沒填藥就不寫
});

test('same medication name cannot be added twice while active; delete removes it; admins only', async () => {
  const d = db(members);
  const first = await med.saveMedication({db:d, uid:ME, body:{name:'降血壓藥', slots:['早餐後']}});
  await assert.rejects(() => med.saveMedication({db:d, uid:ME, body:{name:'  降血壓藥 ', slots:['睡前']}}), /已有同名/);
  await assert.rejects(() => med.insertMedications({db:d, familyId:'F_1', uid:ME, list:[{name:'A', slots:['睡前']},{name:'a', slots:['睡前']}]}), /同一次/);
  // a disabled one does not block re-adding
  await med.disableMedication({db:d, uid:ME, body:{medicationId: first.medications[0].medicationId}});
  await med.saveMedication({db:d, uid:ME, body:{name:'降血壓藥', slots:['睡前']}});
  // delete is admin-only and removes the row
  const id = d.tables.medications.find(r => r.active).medication_id;
  await assert.rejects(() => med.deleteMedication({db:d, uid:PARTNER, body:{medicationId:id}}), /只有家庭管理者/);
  await med.deleteMedication({db:d, uid:ME, body:{medicationId:id}});
  assert.equal(d.tables.medications.some(r => r.medication_id === id), false);
});
