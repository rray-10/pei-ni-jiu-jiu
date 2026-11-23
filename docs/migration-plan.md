# Migration Plan

## 第一階段（本次）：Adapter，不搬資料
- 原始 Sheet **不改、不合併**；儀表板以只讀（`spreadsheets.readonly`）讀 F1 與回診 Sheet，由 adapter 轉成統一格式。
- 唯一需要組員核准後在正式環境新增的東西：F1 Sheet 的 `FamilyPatients` 分頁（兩欄）。

## 備份（執行任何變更前，需人工）
1. 對 F1 Sheet、回診 Sheet 各「建立副本」，檔名加日期（例 `…_backup_20261124`）。
2. 備份存放在非公開資料夾；**不得提交 Git**。

## 步驟
1. 備份（上）。
2. 組員確認：F001 對應的 patient_id、各 period 詞彙、合理範圍。
3. 於 F1 Sheet 新增 `FamilyPatients(familyId, patientId)`。
4. 在**獨立的測試 GAS 專案**部署整合版（不覆蓋既有 `/exec`），Script Properties 設定 `F1_SPREADSHEET_ID`、`APPT_SPREADSHEET_ID`、`LINE_LOGIN_CHANNEL_ID`，測試期可 `DEV_AUTH_ENABLED=true`＋虛構 `DEV_LINE_UID`（**僅限私人部署，且測試帳號不得對應真實資料**）。
5. 驗收通過後再切 Rich Menu 的 URI。

## 第二階段（評估中）：Supabase PostgreSQL
- 表：`families, members(UNIQUE line_user_id), patients, daily_records, appointments, medication_checkins(UNIQUE family_id,attribution_date,period), reminder_settings, notification_log`。
- 以 adapter 的 `normalizeDailyRecord` 作為匯入轉換器（同一套規則），匯入時保留原始 `recordId` 與原始字串 `raw_value`。
- 雙寫期：n8n 同時寫 Sheets 與 DB → 比對 → 切讀 → 停寫 Sheets。
- RLS：以 `family_id` 隔離；後端以驗證後的 LINE sub 查成員，不由前端傳 family_id。
