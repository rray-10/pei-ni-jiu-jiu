// AUTO-GENERATED from adapters/health-adapter.js by scripts/sync-gas.sh — DO NOT EDIT HERE
/**
 * health-adapter — F1 DailyRecords / 回診 Appointments → 儀表板統一格式。
 * 同一份原始碼同時給 Node (tests) 與 GAS 使用（GAS 版由 scripts/sync-gas.sh 複製為 gas/dashboard/health-adapter.gs）。
 * 不得在此檔放任何密鑰或真實資料。
 */
var HealthAdapter = (function () {
  'use strict';

  var TZ_OFFSET_MIN = 480; // Asia/Taipei，無 DST

  // 合理範圍（超出者標記 out_of_range 並排除於統計，不刪除原始資料）
  var RANGES = {
    systolic: [50, 260],
    diastolic: [30, 180],
    blood_glucose: [20, 600],
    temperature: [30, 43],
    weight: [1, 300],
    spo2: [50, 100]
  };
  var DEFAULT_UNITS = { blood_pressure: 'mmHg', blood_glucose: 'mg/dL', temperature: '°C', weight: 'kg', spo2: '%' };

  function isBlank(v) { return v === null || v === undefined || String(v).trim() === ''; }

  /** ISO 字串（任意時區）→ 台北日期 yyyy-MM-dd；無法解析回傳 null */
  function taipeiDate(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    return new Date(t + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
  }

  /** 台北日期加減天數（純日期運算，避免本機時區影響） */
  function addDays(ymd, n) {
    var p = ymd.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.toISOString().slice(0, 10);
  }

  /** 規格 F2：台北時間 → {date, period} （00:00–04:59 歸屬前一天睡前） */
  function periodForTaipei(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    var local = new Date(t + TZ_OFFSET_MIN * 60000);
    var h = local.getUTCHours();
    var ymd = local.toISOString().slice(0, 10);
    if (h < 5) return { date: addDays(ymd, -1), period: 'bedtime' };
    if (h < 11) return { date: ymd, period: 'breakfast' };
    if (h < 17) return { date: ymd, period: 'lunch' };
    if (h < 21) return { date: ymd, period: 'dinner' };
    return { date: ymd, period: 'bedtime' };
  }

  function inRange(key, n) { var r = RANGES[key]; return !r || (n >= r[0] && n <= r[1]); }

  /** "132/84" → {ok, systolic, diastolic, reason} */
  function parseBloodPressure(v) {
    var m = /^\s*(\d{2,3})\s*[\/／]\s*(\d{2,3})\s*$/.exec(String(isBlank(v) ? '' : v));
    if (!m) return { ok: false, reason: 'format' };
    var s = Number(m[1]), d = Number(m[2]);
    if (!inRange('systolic', s) || !inRange('diastolic', d) || s <= d) {
      return { ok: false, reason: 'out_of_range', systolic: s, diastolic: d };
    }
    return { ok: true, systolic: s, diastolic: d };
  }

  function parseNumber(v, key) {
    if (isBlank(v)) return { ok: false, reason: 'empty' };
    var n = Number(String(v).replace(/,/g, '').trim());
    if (!isFinite(n)) return { ok: false, reason: 'format' };
    if (!inRange(key, n)) return { ok: false, reason: 'out_of_range', value: n };
    return { ok: true, value: n };
  }

  /**
   * 用藥欄位兩種格式：
   *  - TRUE/FALSE（單一時段，period 欄位指出時段）
   *  - JSON {"morning":true,"noon":false,...}（舊版四時段）
   * 回傳 {ok, taken, total}（以「項目數」計）
   */
  function parseMedication(v) {
    if (typeof v === 'boolean') return { ok: true, taken: v ? 1 : 0, total: 1 };
    var s = String(isBlank(v) ? '' : v).trim();
    if (/^true$/i.test(s)) return { ok: true, taken: 1, total: 1 };
    if (/^false$/i.test(s)) return { ok: true, taken: 0, total: 1 };
    if (s.charAt(0) === '{') {
      try {
        var o = JSON.parse(s);
        var keys = Object.keys(o).filter(function (k) { return typeof o[k] === 'boolean'; });
        if (!keys.length) return { ok: false, reason: 'format' };
        return { ok: true, taken: keys.filter(function (k) { return o[k]; }).length, total: keys.length };
      } catch (e) { return { ok: false, reason: 'format' }; }
    }
    return { ok: false, reason: 'format' };
  }

  /**
   * F1 DailyRecords 一列 → 統一紀錄。不輸出 lineUid / createdBy（避免身分外洩）。
   * row 欄位名稱採 F1 現況：recordId, familyId, recordedAt, metricKey, metricName, value, unit,
   *   note, source, createdAt, recordDate, period, isRecorded
   */
  function normalizeDailyRecord(row) {
    var quality = [];
    var stamp = isBlank(row.recordedAt) ? '' : String(row.recordedAt).trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(stamp)) {
      stamp = stamp.replace(' ', 'T') + '+08:00';
    }
    var timestamp = Date.parse(stamp);
    var recordedAt = isNaN(timestamp) ? null : new Date(timestamp).toISOString();
    var recordDate = !isBlank(row.recordDate) ? String(row.recordDate).slice(0, 10) : (recordedAt ? taipeiDate(recordedAt) : null);
    if (isBlank(row.recordDate)) quality.push('recordDate_derived');
    var key = String(row.metricKey || '').trim();
    var rec = {
      recordId: String(row.recordId || ''),
      familyId: String(row.familyId || ''),
      metricKey: key,
      metricName: String(row.metricName || ''),
      recordedAt: recordedAt,
      recordDate: recordDate,
      period: isBlank(row.period) ? null : String(row.period),
      unit: isBlank(row.unit) ? (DEFAULT_UNITS[key] || '') : String(row.unit),
      source: isBlank(row.source) ? '' : String(row.source),
      createdAt: isBlank(row.createdAt) ? recordedAt : String(row.createdAt),
      isTest: String(row.source).toUpperCase() === 'TEST' || String(row.isRecorded).toUpperCase() === 'FALSE',
      valid: true,
      quality: quality
    };
    if (!recordedAt || !recordDate) { rec.valid = false; quality.push('bad_date'); }
    if (isBlank(row.unit) && DEFAULT_UNITS[key]) quality.push('unit_defaulted');

    if (key === 'blood_pressure') {
      var hasParts = !isBlank(row.valueSystolic) && !isBlank(row.valueDiastolic);
      var bp = parseBloodPressure(hasParts ? row.valueSystolic + '/' + row.valueDiastolic : row.value);
      if (rec.unit.toLowerCase() !== 'mmhg') bp = { ok: false, reason: 'unit' };
      if (bp.ok) { rec.systolic = bp.systolic; rec.diastolic = bp.diastolic; }
      else { rec.valid = false; quality.push('bp_' + bp.reason); }
    } else if (key === 'medication') {
      var m = parseMedication(row.value);
      if (m.ok) { rec.taken = m.taken; rec.total = m.total; }
      else { rec.valid = false; quality.push('med_' + m.reason); }
    } else {
      var value = isBlank(row.valueNumeric) ? row.value : row.valueNumeric;
      var unit = rec.unit.trim().toLowerCase();
      if (key === 'blood_glucose' && unit === 'mmol/l' && !isBlank(value)) value = Number(value) * 18.0182;
      var num = parseNumber(value, key);
      if (key === 'blood_glucose') {
        if (unit !== 'mg/dl' && unit !== 'mmol/l') num = { ok: false, reason: 'unit' };
        rec.unit = 'mg/dL';
      }
      if (num.ok) rec.value = num.value;
      else { rec.valid = false; quality.push('num_' + num.reason); }
    }
    return rec;
  }

  /**
   * 去重：同 recordId 取一筆；同 家庭+日期+時段+metric 取 createdAt 最新者（後寫入覆蓋，視為修正）。
   * 無 period 的歷史資料以 recordedAt 為鍵，不會被誤合併。
   */
  function dedupe(records) {
    var map = {};
    records.forEach(function (r) {
      var k = r.period ? [r.familyId, r.recordDate, r.period, r.metricKey].join('|') : 'id|' + r.recordId + '|' + r.recordedAt;
      var prev = map[k];
      if (!prev || String(r.createdAt) >= String(prev.createdAt)) map[k] = r;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  /** 回診 appointments 一列 → 統一格式。日期以台北日曆日為準。 */
  function normalizeAppointment(row) {
    var date = isBlank(row.date) ? null : typeof row.date === 'number'
      ? addDays('1899-12-30', Math.floor(row.date)) : String(row.date).trim().slice(0, 10).replace(/\//g, '-');
    var status = String(row.status || '').toLowerCase();
    return {
      appointmentId: String(row.appt_id || row.appointment_id || ''),
      patientId: String(row.patient_id || ''),
      date: date,
      session: isBlank(row.session) ? '' : String(row.session),
      hospital: isBlank(row.hospital) ? '' : String(row.hospital),
      department: isBlank(row.department) ? '' : String(row.department),
      status: status === 'cancelled' || status === 'canceled' ? 'cancelled' : ((status === 'scheduled' || status === 'edit_hospital') ? 'scheduled' : (status || 'unknown')),
      valid: !!(date && /^\d{4}-\d{2}-\d{2}$/.test(date))
    };
  }

  /** 即將回診：status=scheduled 且日期 >= 今日（台北），依日期排序 */
  function upcomingAppointments(appts, nowIso) {
    var today = taipeiDate(nowIso);
    return appts.filter(function (a) { return a.valid && a.status === 'scheduled' && a.date >= today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  return {
    RANGES: RANGES,
    taipeiDate: taipeiDate,
    addDays: addDays,
    periodForTaipei: periodForTaipei,
    parseBloodPressure: parseBloodPressure,
    parseNumber: parseNumber,
    parseMedication: parseMedication,
    normalizeDailyRecord: normalizeDailyRecord,
    dedupe: dedupe,
    normalizeAppointment: normalizeAppointment,
    upcomingAppointments: upcomingAppointments
  };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = HealthAdapter; }
