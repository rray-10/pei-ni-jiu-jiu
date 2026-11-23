# 現況盤點報告（Integration Audit）

盤點日期：2026-11-23｜依據：V2 規格書、Drive 資料夾「02｜技術開發」實際可讀檔案。
狀態：VERIFIED（有程式＋測試證據）／IMPLEMENTED（有程式未驗收）／PARTIAL／MISSING／BLOCKED。
**本報告只記錄實際讀到的內容；未讀到的檔案一律標 BLOCKED，不推測。**

## 0. 檔案取得結果

| 項目 | 結果 |
|---|---|
| V2 規格書 | 已讀取（主要依據） |
| V1 舊規格 | **未讀取**（本次未取得；差異比對待補） |
| LINE Login PoC / F1 Sheet（`1O2LX5…`） | 已讀取結構與樣本（內含 Families、Members、MetricDefinitions、TrackingSettings、DailyRecords、RecordAlerts） |
| 回診 Sheet「回診用」（`1XycbxI…`） | 已讀取 |
| 儀表板虛構測試資料（`1JtG6OG…`） | 已讀取，為原 DEMO 的 `setupDemoSpreadsheet()` 產物 |
| 「陪你久久-健康儀表板」`1RoHVNt…` | 已讀取：**空白**（僅「工作表1」） |
| 另一份同名 `1AysK_POL…` | **僅讀 metadata（1 KB，與空白表同大小），內容未驗證**；位於 Drive 根目錄而非專案資料夾 |
| 儀表板 Code.gs / Scripts.html / Styles.html / PdfTemplate.html | 已讀取（原樣存於 `gas/dashboard/original-demo/`） |
| **Index.html** | **BLOCKED：Drive 上為 0 bytes。** 本 repo 內 `gas/dashboard/Index.html` 為依 id/class 重建版，已標註，待原版 |
| **n8n 工作流 JSON（F1-A、F3、LINE 主流程 v2）** | **BLOCKED：資料夾內沒有 JSON。** 只找到主流程截圖 `N8N-主流程.jpg` |
| Rich Menu、API 文件、交接文件、測試紀錄 | **BLOCKED：未在可讀範圍內找到** |
| 資料夾「Aiden」 | 可見但內容查詢為空（可能無權限或確實為空），未驗證 |
| 資料夾「芮／health_gas_mvp」 | 同為儀表板 DEMO 檔案副本 |

## 1. 模組盤點

### M1 LINE Login 與家庭建立／加入
- 程式：**BLOCKED**（只有 Sheet，沒有 GAS／n8n 程式）。
- Sheet：F1 Sheet 的 `Families(familyId, patientName, note)`、`Members(familyId, lineUid, role)`；Families 1 列、Members 3 列。
- Token 驗證／家庭權限：無法驗證（程式未取得）。邀請碼（24h）在 F1 Sheet 內**沒有對應資料表**（回診 Sheet 有 `family_links.invite_code`，但屬另一套模型）。
- 狀態：**BLOCKED**；資料模型為**家庭主檔候選基礎**。

### M2 每日紀錄 LIFF（F1）／F1-A n8n
- 程式與工作流：**BLOCKED**。實際輸出可由 `DailyRecords`（21 列）推得：欄位見 `docs/data-schema.md`；`route=record_write`，`source=LIFF|TEST`。
- 觀察到的資料品質問題：血壓 `162/300`、`124/300`；血糖 `8455`；體溫 `43`；用藥值有 `TRUE/FALSE` 與 JSON 字串兩種；`unit` 部分空白；`recordDate/period/isRecorded` 為後期新增欄位（早期列為空）；`valueNumeric/valueSystolic/valueDiastolic/schemaVersion/memberId` 欄位存在但**全空**。
- 狀態：資料寫入 **PARTIAL（有實際資料為證，無程式可驗收）**。

### M3 TrackingSettings / RecordAlerts
- TrackingSettings 為 append-only（每次儲存新增 8 列，無「現行版本」欄位）；RecordAlerts 僅表頭、無資料。
- 狀態：**PARTIAL**；本次未整合（儀表板尚未使用）。

### M4 健康儀表板（GAS）
- 程式：`Code.gs`（原 DEMO）。讀取模型：`Users→PatientMembers→Patients→BPRecords/GlucoseRecords/MedicationRecords/Appointments`，**與 F1 完全不同**。
- LINE 驗證：**無**（寫死 `u_demo_01`，README 已自述為 DEMO）。
- 權限：只檢查寫死使用者，無法對應 F1 的家庭。
- 效能：每次呼叫對同一張表多次全表 `getDataRange()`（`read_()` 在 `getDemoBootstrap` 與 `allowed_` 重複呼叫），未量測。
- 狀態：UI／圖表／PDF **IMPLEMENTED（DEMO）**；與 F1 整合 → **本次已改為 IMPLEMENTED（整合版，見 §3）**，尚未在真實 GAS 驗收。

### M5 就診摘要與 PDF
- `getVisitSummary` + `generateVisitPdf`（HTML→PDF，base64 回前端以 Blob 下載）。
- LINE 內建瀏覽器對 Blob 下載的支援**未驗證**（風險，見 open-issues）。狀態：IMPLEMENTED。

### M6 回診管理（F3）
- 程式／n8n JSON：**BLOCKED**。Sheet `appointments(appt_id, patient_id, date, session, hospital, department, status)`、`notification_log`。
- 觀察：以 `patient_id` 為鍵（`p001`），**沒有 family_id**；`session` 欄混用「早診／午診／晚診」與 `HH:mm`；取消為軟刪除（`status=cancelled`）；提醒紀錄中 offset_days 1 與 7 有多筆 failed/重複。
- `users.line_user_id` 的測試帳號與 F1 Members 的帳號**不是同一人**。
- 狀態：資料 **PARTIAL**；是否支援 Execute Workflow Trigger／Postback／datetimepicker：**無法驗證（BLOCKED）**。

### M7 用藥打卡與提醒（F2、F6）
- V2 規格要求 `家庭+歸屬日期+時段` 唯一的打卡表與提醒設定／發送紀錄。**任何 Sheet 中都沒有此資料表（MISSING）**。
- F1 的 `medication` metric（TRUE/FALSE 或 JSON）是每日紀錄表單內的另一種用藥回報，**不等同** F2 的 LINE 打卡。

### M8 LINE 主流程（n8n）
- 僅有截圖：Webhook → Switch（`daily_record` / `view record` / `appointment re…` / Fallback）→ 「Get row(s) in sheet」→ If →（未綁定）回覆「沒有身分驗證，請加入或建立家庭」→ 其他回覆。回診與每日紀錄分支為**固定文字回覆**（截圖顯示為 POST api.line.me 的訊息節點）。
- 無 JSON 故無法確認：是否驗證 LINE 簽章、是否傳遞完整 Event、Postback 處理。狀態：**BLOCKED / PARTIAL**。

### M9 Rich Menu、會員中心、用藥提醒設定頁、介紹頁
- **MISSING／BLOCKED**（未取得任何檔案）。

## 2. 跨模組身分／鍵值差異（摘要，詳見 data-mapping.md）

| 概念 | F1 | 儀表板 DEMO | 回診 | V2 規格 |
|---|---|---|---|---|
| 家庭 | familyId=`F001` | 無 | 無 | 家庭為核心 |
| 使用者 | lineUid | user_id + line_user_id | user_id(`u001`) + line_user_id | LINE User ID |
| 患者 | `Families.patientName`（無 id） | patient_id（`p_demo_01`） | patient_id（`p001`） | 保留 patient_id |
| 日期格式 | ISO UTC／`yyyy-MM-dd` | `yyyy/M/d` | `yyyy-MM-dd` | Asia/Taipei |

## 3. 本次整合後的實際串接狀態

| 流程 | 狀態 |
|---|---|
| DailyRecords → Adapter → 儀表板（血壓、血糖、用藥） | **IMPLEMENTED**：adapter 與服務層有 27 項自動化測試通過；尚未在真實 GAS＋真實 Sheet 驗收 |
| 儀表板「下次回診」讀回診 Sheet | **IMPLEMENTED**（adapter 層）；需先建立 `FamilyPatients` 對照（待確認） |
| LINE ID Token 驗證 → Members → 家庭 | **IMPLEMENTED**（`Code.gs`）；尚未以真實 LIFF 實測；LIFF×GAS iframe 相容性未驗證 |
| n8n 主流程 → 回診子流程 | **BLOCKED**（缺 JSON） |
| 用藥打卡／提醒 | **MISSING** |
| DashboardSnapshot、效能量測 | 未做（P2）；無部署環境，無實測數字 |
