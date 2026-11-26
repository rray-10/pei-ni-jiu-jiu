/**
 * Staging only: run once from the Apps Script editor to create an empty test
 * workbook with the required tabs/headers and store its ID in F1_SPREADSHEET_ID.
 * Refuses to run if F1_SPREADSHEET_ID is already set.
 */
function setupStagingSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('F1_SPREADSHEET_ID');
  if (existing) throw new Error('F1_SPREADSHEET_ID already set: ' + existing);
  const tabs = {
    Families: 'familyId,patientName,note,birthYear,conditions,allergies,createdFor',
    Members: 'familyId,lineUid,role,displayName,joinedAt',
    FamilyPatients: 'familyId,patientId',
    FamilyInvites: 'codeHash,familyId,expiresAt,claimedBy',
    MetricDefinitions: 'metricKey,metricName,inputType,unit,isActive',
    TrackingSettings: 'familyId,metricKey,enabled,updatedBy,updatedAt,route,metricName,unit,alertLow,alertHigh,systolicLow,systolicHigh,diastolicLow,diastolicHigh,changeThreshold,systolicChangeThreshold,diastolicChangeThreshold',
    // not written yet: abnormal-value alerts are not wired (kept so the workbook matches the original F1-A schema)
    RecordAlerts: 'alertId,familyId,memberId,recordId,previousRecordId,metricKey,metricName,alertType,period,recordDate,previousValue,currentValue,difference,threshold,unit,notificationStatus,notificationAt,createdAt',
    DailyRecords: 'recordId,familyId,lineUid,recordedAt,metricKey,metricName,value,unit,note,source,createdAt,createdBy,route,recordDate,period,memberId,valueNumeric,valueSystolic,valueDiastolic,schemaVersion,isRecorded,patientId'
  };
  const ss = SpreadsheetApp.create('陪你久久 STAGING 照護測試表');
  ss.setSpreadsheetTimeZone('Asia/Taipei');
  Object.keys(tabs).forEach((name, i) => {
    const sheet = i === 0 ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
    const headers = tabs[name].split(',');
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });
  const metrics = ss.getSheetByName('MetricDefinitions');
  metrics.getRange(2, 1, 2, 5).setValues([
    ['blood_pressure', '血壓', 'bloodPressure', 'mmHg', true],
    ['blood_glucose', '血糖', 'number', 'mg/dL', true]
  ]);
  props.setProperty('F1_SPREADSHEET_ID', ss.getId());
  console.log('F1_SPREADSHEET_ID=' + ss.getId());
  console.log(ss.getUrl());
  setupN8nTabs();
}

/**
 * Staging only: adds the tabs the n8n workflow needs to the care workbook (F1_SPREADSHEET_ID).
 * Safe to re-run: existing tabs and their data are left untouched.
 * Set the Dashboard property APPT_SPREADSHEET_ID to the same spreadsheet ID.
 */
function setupN8nTabs() {
  const id = PropertiesService.getScriptProperties().getProperty('F1_SPREADSHEET_ID');
  if (!id) throw new Error('Missing script property F1_SPREADSHEET_ID');
  const ss = SpreadsheetApp.openById(id);
  const tabs = {
    appointments: 'appt_id,patient_id,date,session,hospital,department,status',
    notification_log: 'appt_id,user_id,channel,offset_days,status,sent_at',
    med_logs: 'log_id,familyId,date,slot,status,by_lineUid,at',
    PendingLinks: 'lineUid,familyId,role,createdAt,expiresAt'
  };
  Object.keys(tabs).forEach(name => {
    if (ss.getSheetByName(name)) return console.log('exists: ' + name);
    const sheet = ss.insertSheet(name);
    const headers = tabs[name].split(',');
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    console.log('created: ' + name);
  });
  console.log('Dashboard APPT_SPREADSHEET_ID=' + id);
}
