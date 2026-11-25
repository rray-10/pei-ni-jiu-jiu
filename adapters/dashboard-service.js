/**
 * dashboard-service — 身分 → 家庭授權 → 儀表板資料。純函式，資料由呼叫端注入（GAS 讀 Sheets / 測試用 fixture）。
 * 授權唯一依據：已驗證的 lineUid 在 Members 的列。任何前端傳入的 familyId / patientId 都不被信任。
 */
var DashboardService = (function () {
  'use strict';
  function adapter() { return typeof require === 'function' ? require('./health-adapter.js') : HealthAdapter; }

  var ALLOWED_DAYS = [7, 30, 90];

  function fail(code, msg) { var e = new Error('[' + code + '] ' + msg); e.code = code; return e; }

  /** lineUid → {familyId, role}。未綁定 → NOT_MEMBER；MVP 一人一家庭，多家庭資料異常 → DATA_INTEGRITY */
  function resolveMembership(members, lineUid) {
    if (!lineUid) throw fail('UNAUTHENTICATED', '缺少已驗證的身分');
    var rows = members.filter(function (m) { return String(m.lineUid) === String(lineUid); });
    if (!rows.length) throw fail('NOT_MEMBER', '尚未加入任何照護家庭');
    if (!String(rows[0].familyId || '').trim() || rows.length !== 1) throw fail('DATA_INTEGRITY', '同一使用者綁定多個家庭，請聯絡管理員');
    return { familyId: rows[0].familyId, role: rows[0].role || 'member' };
  }

  /** family → patientId。使用 FamilyPatients 的唯一對照 */
  function patientIdFor(src, familyId) {
    var links = (src.familyPatients || []).filter(function (r) { return r.familyId === familyId; });
    if (links.length !== 1 || !links[0].patientId || src.familyPatients.some(function (r) {
      return r.familyId !== familyId && r.patientId === links[0].patientId;
    })) throw fail('DATA_INTEGRITY', '照護對象對照缺漏或有衝突');
    return links[0].patientId;
  }

  function getSessionContext(src, lineUid) {
    var m = resolveMembership(src.members, lineUid);
    var families = (src.families || []).filter(function (f) { return f.familyId === m.familyId; });
    if (families.length !== 1) throw fail('DATA_INTEGRITY', '家庭主檔缺漏或重複');
    var fam = families[0];
    var pid = patientIdFor(src, m.familyId);
    return {
      familyId: m.familyId,
      role: m.role,
      patients: [{ id: pid, name: fam.patientName || '被照護者', role: m.role }]
    };
  }

  function avg(a) { return a.length ? Math.round(a.reduce(function (s, x) { return s + x; }, 0) / a.length) : null; }

  function getDashboardData(src, lineUid, patientId, days, nowIso) {
    var A = adapter();
    days = Number(days);
    if (ALLOWED_DAYS.indexOf(days) < 0) throw fail('BAD_REQUEST', '期間無效');
    var ctx = getSessionContext(src, lineUid);
    // 前端的 patientId 僅用來比對，不能擴大權限
    if (patientId && patientId !== ctx.patients[0].id) throw fail('FORBIDDEN', '無權存取');
    var pid = ctx.patients[0].id;
    var today = A.taipeiDate(nowIso);
    var from = A.addDays(today, -(days - 1));

    var all = (src.dailyRecords || [])
      .filter(function (r) { return String(r.familyId) === ctx.familyId && (!r.patientId || r.patientId === pid); })
      .map(A.normalizeDailyRecord);
    var excluded = { test: 0, invalid: 0 };
    var usable = [];
    all.forEach(function (r) {
      if (r.isTest) { excluded.test++; return; }
      if (!r.valid) { excluded.invalid++; return; }
      usable.push(r);
    });
    usable = A.dedupe(usable).filter(function (r) { return r.recordDate >= from && r.recordDate <= today; });
    usable.sort(function (a, b) { return a.recordDate.localeCompare(b.recordDate) || a.recordedAt.localeCompare(b.recordedAt); });

    var bp = usable.filter(function (r) { return r.metricKey === 'blood_pressure'; })
      .map(function (r) { return { measured_at: r.recordedAt, record_date: r.recordDate, systolic: r.systolic, diastolic: r.diastolic, unit: r.unit }; });
    var glucose = usable.filter(function (r) { return r.metricKey === 'blood_glucose'; })
      .map(function (r) { return { measured_at: r.recordedAt, record_date: r.recordDate, value: r.value, unit: r.unit, context: r.period || '' }; });
    var meds = usable.filter(function (r) { return r.metricKey === 'medication'; });
    var taken = meds.reduce(function (s, r) { return s + r.taken; }, 0);
    var total = meds.reduce(function (s, r) { return s + r.total; }, 0);

    var appts = (src.appointments || []).map(A.normalizeAppointment)
      // n8n 主流程把 familyId 寫進 patient_id，其他來源用 patientId；兩者都只取登入者自己的家庭
      .filter(function (a) { return a.patientId === pid || a.patientId === ctx.familyId; });
    var up = A.upcomingAppointments(appts, nowIso);
    var next = up[0] ? { scheduled_at: up[0].date + 'T00:00:00+08:00', date: up[0].date, session: up[0].session, department: up[0].department, hospital: up[0].hospital } : null;

    var fam = (src.families || []).filter(function (f) { return f.familyId === ctx.familyId; })[0];
    return {
      patient: { id: pid, name: fam.patientName || '被照護者', birthYear: fam.birthYear || '未填寫', conditions: fam.conditions || '', allergies: fam.allergies || '' },
      familyId: ctx.familyId,
      days: days,
      latestBP: bp.length ? bp[bp.length - 1] : null,
      bpAverage: { sys: avg(bp.map(function (x) { return x.systolic; })), dia: avg(bp.map(function (x) { return x.diastolic; })) },
      glucoseAverage: avg(glucose.map(function (x) { return x.value; })),
      medication: { taken: taken, total: total, rate: total ? Math.round(100 * taken / total) : null },
      nextAppointment: next,
      bp: bp,
      glucose: glucose,
      medications: [],
      questions: [],
      quality: { excludedTest: excluded.test, excludedInvalid: excluded.invalid },
      generatedAt: nowIso
    };
  }

  function getVisitSummary(src, lineUid, patientId, days, nowIso) {
    var d = getDashboardData(src, lineUid, patientId, days, nowIso);
    var stats = function (a) { return a.length ? { min: Math.min.apply(null, a), max: Math.max.apply(null, a) } : { min: null, max: null }; };
    d.bpSysStats = stats(d.bp.map(function (x) { return x.systolic; }));
    d.bpDiaStats = stats(d.bp.map(function (x) { return x.diastolic; }));
    d.glucoseStats = stats(d.glucose.map(function (x) { return x.value; }));
    return d;
  }

  return { ALLOWED_DAYS: ALLOWED_DAYS, resolveMembership: resolveMembership, patientIdFor: patientIdFor,
    getSessionContext: getSessionContext, getDashboardData: getDashboardData, getVisitSummary: getVisitSummary };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = DashboardService; }
