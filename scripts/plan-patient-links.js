'use strict';
const fs = require('node:fs');

// Read-only migration plan. Legacy identity edges are used only to recover existing patient IDs.
function planPatientLinks({families, members, users, family_links, patients, familyPatients = []}) {
  function group(rows, key) {
    const index = new Map();
    for (const row of rows) {
      if (!row[key]) continue;
      if (!index.has(row[key])) index.set(row[key], []);
      index.get(row[key]).push(row);
    }
    return index;
  }
  const familyIndex = group(families,'familyId');
  const memberIndex = group(members,'lineUid');
  const membersByFamily = group(members,'familyId');
  const usersByLine = group(users,'line_user_id');
  const usersById = group(users,'user_id');
  const activeLinks = group(family_links.filter(row => row.status === 'active'),'family_user_id');
  const patientsByUser = group(patients,'user_id');
  const patientsById = group(patients,'patient_id');
  const existingByFamily = group(familyPatients,'familyId');
  const existingByPatient = group(familyPatients,'patientId');
  const proposed = [];
  const unresolved = [];
  for (const [familyId, rows] of familyIndex) {
    const existing = existingByFamily.get(familyId) || [];
    if (rows.length !== 1 || existing.length > 1 ||
        (existing.length && (!existing[0].patientId || existingByPatient.get(existing[0].patientId).length !== 1))) {
      unresolved.push({familyId,reason:'duplicate_or_invalid_mapping'});
      continue;
    }
    if (existing.length) continue;
    const candidates = new Set();
    let conflict = false;
    for (const member of membersByFamily.get(familyId) || []) {
      const legacy = usersByLine.get(member.lineUid) || [];
      if (memberIndex.get(member.lineUid)?.length !== 1 || legacy.length > 1) {
        conflict = true;
        continue;
      }
      const user = legacy[0];
      if (!user) continue;
      if (usersById.get(user.user_id)?.length !== 1) {
        conflict = true;
        continue;
      }
      const targets = (user.role === 'patient' ? patientsByUser.get(user.user_id) : activeLinks.get(user.user_id)) || [];
      if (targets.length !== 1 || patientsById.get(targets[0].patient_id)?.length !== 1) {
        conflict = true;
        continue;
      }
      candidates.add(targets[0].patient_id);
    }
    if (conflict || candidates.size !== 1) {
      unresolved.push({familyId,reason:conflict || candidates.size > 1 ? 'conflicting_legacy_identity' : 'no_legacy_identity'});
      continue;
    }
    proposed.push({familyId,patientId:[...candidates][0]});
  }
  const proposalsByPatient = group(proposed,'patientId');
  const ready = [];
  for (const row of proposed) {
    if (proposalsByPatient.get(row.patientId).length !== 1 || existingByPatient.has(row.patientId)) {
      unresolved.push({familyId:row.familyId,reason:'patient_shared_by_families'});
    } else {
      ready.push(row);
    }
  }
  return {ready,unresolved};
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node scripts/plan-patient-links.js /private/path/identity-snapshot.json\n');
    process.exitCode = 1;
  } else {
    const rows = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    for (const key of ['families','members','users','family_links','patients']) {
      if (!Array.isArray(rows[key])) throw new Error('Missing table: ' + key);
    }
    process.stdout.write(JSON.stringify(planPatientLinks(rows),null,2) + '\n');
  }
}
module.exports = {planPatientLinks};
