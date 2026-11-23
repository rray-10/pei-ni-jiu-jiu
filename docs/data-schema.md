# 統一資料模型（Schema）

原則：以 **family_id** 為授權單位；`patient_id` 保留。V2 MVP：一人一家庭、一家庭一位被照護者、一家庭多位成員。
**本文件為提案，標「現況」者為已讀到的實際欄位，標「新增」者需組員確認後才建立；不會自動修改正式 Sheet。**

## 關係
```
LINE User ID ─▶ Members ─▶ Families ─▶ FamilyPatients ─▶ Patients(未來)
                                   └▶ DailyRecords / Appointments(經 patient_id) / MedicationCheckins(待建)
```

## 正式欄位命名
Sheet 現況沿用 camelCase（`familyId`、`lineUid`）；內部服務層統一用 camelCase。未來遷移 Supabase 時再轉 snake_case（見 migration-plan）。

## 表（現況／新增）

### Families（現況，F1 Sheet）
`familyId`(PK) · `patientName` · `note`
> 缺：created_at、邀請碼資料表。

### Members（現況，F1 Sheet）— **授權依據**
`familyId` · `lineUid` · `role`(`admin`|`member`)
> 約束（需由寫入端保證）：`lineUid` 全表唯一（一人一家庭）。目前沒有 `status`/`joinedAt`。
> 現況資料含**真實格式的 LINE UID**（見 security.md）。

### FamilyPatients（**新增，待確認**）
`familyId`(PK) · `patientId`(unique) — 建立家庭↔患者對照。
未建立時服務層預設 `patientId = 'pt_' + familyId`，因此回診資料中的 `p001` 無法自動對到 `F001`。

### DailyRecords（現況，F1 Sheet）
`recordId` · `familyId` · `lineUid` · `recordedAt`(ISO UTC) · `metricKey` · `metricName` · `value`(字串) · `unit` · `note` · `source`(`LIFF`|`TEST`) · `createdAt` · `createdBy` · `route` · `recordDate`(`yyyy-MM-dd` 台北) · `period` · `memberId` · `valueNumeric` · `valueSystolic` · `valueDiastolic` · `schemaVersion` · `isRecorded`
- 後六欄（`memberId`…`schemaVersion`）目前**全空**，adapter 不依賴。
- `recordId = <recordedAt>-<metricKey>-<uid後6碼>`（現況規則）。
- 建議 F1-A 之後在寫入端填 `valueNumeric/valueSystolic/valueDiastolic/schemaVersion=2`，adapter 即可優先讀取（目前一律由 `value` 解析）。

### MetricDefinitions（現況）
`metricKey` · `metricName` · `inputType` · `unit` · `isActive`
- `blood_pressure`(mmHg) `blood_glucose`(mg/dL) `temperature`(°C) `weight`(kg) `spo2`(%) `medication`(boolean) `custom_1/2`。

### Appointments（現況，回診 Sheet 的 `appointments`）
`appt_id` · `patient_id` · `date`(`yyyy-MM-dd`) · `session` · `hospital` · `department` · `status`(`scheduled`|`cancelled`)
- 建議新增 `family_id`、`created_at`、`updated_at`（由 F3 寫入端補，目前以 FamilyPatients 對應）。

### MedicationCheckins（**MISSING，依 V2 F2 定義**）
`family_id` · `attribution_date`(台北) · `period`(`breakfast`|`lunch`|`dinner`|`bedtime`) · `checked_by` · `checked_at`
唯一鍵：`(family_id, attribution_date, period)`。Sheets 無唯一約束，寫入需 `LockService`／n8n 序列化，或於 Supabase 以 UNIQUE 實作。

### DashboardSnapshot（P2，未建立）
`family_id` · `patient_id` · `window_days` · `payload`(JSON) · `source_max_created_at` · `updated_at` · `schema_version`。僅為衍生資料，可由 DailyRecords 全量重建；更新失敗時沿用舊 snapshot 並標示 stale。

## 時間與時區
- 儲存：`recordedAt/createdAt` 為 ISO（含 `Z` 或 `+08:00`）；業務日期 `recordDate/date` 為台北日曆日字串，不帶時區。
- 讀 Sheet 時 GAS `Date` 物件必須用 `Asia/Taipei` 格式化（`Code.gs: cell_()`），**不可直接 `toISOString()`**（原 DEMO 的做法會把 00:00 的日期推到前一天）。

## 缺漏、重複、取消
- 缺漏：欄位空白 → adapter 標 `quality`，空 `recordDate` 由 `recordedAt` 推導（`recordDate_derived`）。
- 重複：同家庭+日期+時段+metric 取 `createdAt` 最新；無 period 的舊資料不合併。
- 取消：回診以 `status=cancelled` 軟刪除；每日紀錄目前**沒有**取消／修改狀態欄。
- 異常值：超出合理範圍者標 `out_of_range`，**不刪原始列、不納入統計**，儀表板摘要頁顯示「未納入統計」筆數。範圍見 `adapters/health-adapter.js: RANGES`（PM／醫療顧問需確認）。
