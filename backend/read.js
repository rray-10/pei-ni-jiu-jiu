'use strict';
// 讀取層：所有查詢都只限定「登入者自己的家庭」。家庭一律由 members 查出，不接受前端傳入的 family_id。

async function membershipOf(db, lineUid) {
  const rows = await db.select('members', {select: 'family_id,role', line_uid: 'eq.' + lineUid, limit: '1'});
  return rows[0] || null;
}

async function familyPatientId(db, familyId) {
  const rows = await db.select('family_patients', {select: 'patient_id', family_id: 'eq.' + familyId, limit: '1'});
  return rows[0] ? rows[0].patient_id : null;
}

// 近 N 天的每日紀錄，依台北日曆日（record_date）篩選，只讀這一個家庭。
async function dailyRecordsForFamily(db, familyId, sinceDate, untilDate) {
  return db.select('daily_records', {
    select: 'metric_key,metric_name,value,value_numeric,value_systolic,value_diastolic,unit,period,record_date,recorded_at,is_recorded,source',
    family_id: 'eq.' + familyId,
    and: `(record_date.gte.${sinceDate},record_date.lte.${untilDate})`,
    order: 'record_date.desc,recorded_at.desc'
  });
}

// 即將回診：狀態為 scheduled / edit_hospital 且日期不早於今天（台北）。
async function upcomingAppointments(db, patientId, today) {
  return db.select('appointments', {
    select: 'appt_id,date,session,hospital,department,status',
    patient_id: 'eq.' + patientId,
    status: 'in.(scheduled,edit_hospital)',
    date: 'gte.' + today,
    order: 'date.asc,session.asc'
  });
}

module.exports = {membershipOf, familyPatientId, dailyRecordsForFamily, upcomingAppointments};
