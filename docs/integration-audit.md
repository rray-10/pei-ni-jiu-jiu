# 陪你久久整合決策與團隊更新

2026-11-24 · `integration/f1-live`

## 定案

兩份 Google Sheets 工作簿是本期資料庫，Apps Script 是驗證與讀寫 API，Node 提供頂層 LIFF 入口，n8n 處理 LINE 聊天及回診。健康、會員、回診共用一套家庭與照護對象識別。暫時保留回診工作簿及其既有欄名，減少搬表與舊工作流的改動。新程式自動建立家庭對照，已有的回診歷史保留原 `patient_id`。

| 資料 | 唯一來源與規則 |
| --- | --- |
| LINE 會員與權限 | 照護工作簿 `Members(lineUid,familyId,role)`。LINE token 驗證取得 `lineUid`，一人一家庭。本人為 `admin`，受邀家人為 `member`。 |
| 家庭與照護對象 | 照護工作簿 `Families(familyId,patientName,note)` 保存顯示稱呼，`FamilyPatients(familyId,patientId)` 保存一對一的病人鍵。MVP 一戶一位照護對象，兩欄均唯一。 |
| 邀請 | 照護工作簿 `FamilyInvites(codeHash,familyId,expiresAt,claimedBy)`。管理者產生邀請，24 小時有效，一碼限一位家人。只儲存 SHA-256 雜湊。 |
| 每日紀錄 | 照護工作簿 `DailyRecords`。授權鍵是 `familyId`，新環境增設 `patientId` 欄，新列由後端寫入共同病人鍵。既有列仍可經家庭對照讀取。若新列明示另一個病人鍵，儀表板排除。 |
| 回診 | 回診工作簿只需 `appointments` 供新版互動工作流使用。表中 `patient_id` 等於照護工作簿的 `patientId`。F3 的 `users`、`family_links`、`patients` 是歷史遷移來源。 |
| 健康儀表板／摘要 | 從照護工作簿讀每日紀錄，從回診工作簿讀 appointments，由 Members 授權。兩套名稱在程式轉換，同一身份以相同病人鍵讀取。 |

示意資料 `lineUid=LINE_TEST_A → Members.familyId=F_TEST_A → FamilyPatients.patientId=P_TEST_A → DailyRecords.patientId=P_TEST_A／appointments.patient_id=P_TEST_A`。這些識別值只用於本機 fixture。真機測試從空白成員表開始，由測試 LINE 帳號登入並建立，ID 由後端發給。

## 使用者流程

```
LINE OA → 點會員中心／每日紀錄／儀表板／回診
        → LIFF 登入 → 後端查 Members
          ├─ 已綁定 → 開啟原功能
          └─ 未綁定 → 綁定頁
              ├─ 為自己建立 → 建 Families、FamilyPatients、Members(admin)
              │               → 會員中心產生一次性家人邀請碼
              └─ 加入家人   → 驗邀請碼 → 建 Members(member)
                    → 嘗試套用已綁定 Rich Menu → 回原入口
回診 → 綁定後返回 OA → 傳送「回診管理」→ n8n 依共同會員與病人鍵寫回診
```

每個 LIFF 入口都先驗登入和會員身分，日誌／儀表板 API 再獨立驗證。F1 與會員 API 驗 LINE access token、Channel ID 和 profile，儀表板驗 ID token，兩者由 Sheets 查會員，前端無法指定授權家庭。`DEV_AUTH_ENABLED=false` 關閉替代測試身分。回診是 OA 聊天功能，主流程驗 LINE 簽章並透過 n8n 查 Members，未綁定回覆綁定連結。加入後使用者可回聊天再次送「回診管理」。

Rich Menu 更新是綁定後的額外操作。已配置 `BOUND_RICH_MENU_ID` 和 `LINE_OA_ACCESS_TOKEN` 後，GAS 會嘗試綁定個人 Rich Menu。LINE API 失敗時家庭仍建立成功，頁面在該次綁定可重試。測試帳號需先加入該 OA 為好友。測試可先用固定 Rich Menu 驗路由與角色，再啟用自動更新。

## FamilyPatients 目前做到哪裡

- **整合程式已完成。** 建立家庭會自動配發 `familyId`、`patientId` 並寫入對照，邀請加入沿用原病人鍵。Dashboard 和 F3 已改讀同一張 `FamilyPatients`，缺漏或重複會拒絕。
- **線上工作簿仍未建表或回填。** 新測試環境只需建好表頭，由本人測試帳號操作即可產生對照。原 F3 匯出的工作簿 ID 和交接連結不同，測試版明確設定一份隔離回診表，無須先決定正式環境的來源。
- **既有資料按 ID 自動產生回填計畫。** `node scripts/plan-patient-links.js /private/path/identity-snapshot.json` 接收同名欄位的 `families,members,users,family_links,patients` 陣列，可另帶既有 `familyPatients`。程式用同一 LINE User ID 和舊病人／家屬關聯產出 `ready` 與 `unresolved`。只把 `ready` 加入測試副本。無交集、同戶兩病人或多戶共用同一病人的列先擱置。照護姓名無法證明是同一個人，程式不會猜測或另發 ID 覆蓋歷史。真實輸入及報告留在受控位置。

## 部署與驗收順序

1. **先建資料及 GAS。** 照護測試表準備 `Families`、`Members`、`FamilyPatients`、`FamilyInvites`、`MetricDefinitions`、`TrackingSettings`、`DailyRecords`。既有表沿用表頭，在 DailyRecords 尾端增設 `patientId`。成員與家庭先留空。MetricDefinitions 可填兩筆虛構種子，欄位順序為 `metricKey,metricName,inputType,unit,isActive`，內容為 `blood_pressure,血壓,bloodPressure,mmHg,TRUE` 與 `blood_glucose,血糖,number,mg/dL,TRUE`。新家庭會啟用兩個已有定義的項目。
2. **部署兩套測試 GAS Web App。** F1／會員專案使用 `gas/daily/`，儀表板使用 `gas/dashboard/`。兩個共用 .gs 由 `npm run sync:gas` 產出到該目錄。使用 clasp 時從該目錄先跑 `clasp status` 確認檔案，再推送到測試專案。部署為「以我執行」「任何人可存取」，應用程式以 LINE token 驗證。沿用兩份 GAS 都使用的屬性名稱 `F1_SPREADSHEET_ID`、`LINE_LOGIN_CHANNEL_ID`，值要逐字一致。儀表板設 `DEV_AUTH_ENABLED=false`。兩個 `/exec` 是 GAS API URL。回診工作簿 ID 填 `APPT_SPREADSHEET_ID`，可等驗回診前再填。回診測試表頭為 `appt_id,patient_id,date,session,hospital,department,status`。
3. **要驗真實登入，這一步必須做。** 用 Node 22+ 執行 `node frontend/server.js`，配置可對外存取的測試 HTTPS 網址。LINE Login channel 的 LIFF Endpoint 與 Node 的 `LIFF_ENDPOINT` 設同一網址，scope 勾 `openid,profile`。Node 設 `LIFF_ID`、`MEMBER_GAS_URL`（F1 GAS 的 `/exec`）、`F1_API_URL`（先同 F1 GAS URL）、`DASHBOARD_GAS_URL`（另一個 GAS `/exec`）。先不要把正式 LIFF 指過來。你提供的圖上兩種 channel 已在同一 Provider，LINE Login 顯示 Developing，聯測由 Admin 在 LINE Login channel 的 Roles 邀請 Tester，測試者接受後以連到其 Business ID 的 LINE 帳號開 LIFF。[LINE LIFF 設定](https://developers.line.biz/en/docs/liff/registering-liff-apps/) [LINE User ID](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/) [Developing 測試權限](https://developers.line.biz/en/docs/line-developers-console/managing-roles/)
4. **拿三個測試帳號驗綁定、邀請與讀寫。** A 從「每日紀錄」進入，應先看到綁定，為自己建立後回每日紀錄。在會員中心產生邀請碼，B 從「儀表板」加入，完成後回儀表板。B 寫入血壓及血糖，A 和 B 都看得到，同一碼讓 C 加入應被拒。C 仍未綁定時開任一其他入口會看到綁定畫面。C 自立第二家庭後應看不到 A／B 資料。核對共同表的家庭與病人 ID。
5. **先能登入與寫 Sheets，再匯入 n8n。** 匯入 F3 及 LINE 主流程測試 JSON。主流程 Members 和 F3 兩個身分讀取節點都用照護工作簿，F3 appointments 的讀寫用回診工作簿。設定測試 Google OAuth2 和 LINE 回覆憑證、F3 子工作流 ID，主流程回覆中的 `REPLACE_STAGING_BIND_LIFF_BASE` 換成 `https://liff.line.me/<LIFF_ID>`，會員中心入口指向 `?page=member`。設定 Node 的 `LINE_MAIN_WEBHOOK_URL`、`LINE_WEBHOOK_GATEWAY_KEY`、`LINE_MESSAGING_CHANNEL_SECRET`，再把測試 OA webhook 指到 `https://<測試主機>/line/events` 並按 Verify。回診新增、改期、取消各跑一次，核對 patient_id 和儀表板。Node 可填 `LINE_CHAT_URL` 提供綁定後返回 OA 的按鈕。Rich Menu 的回診按鈕送出文字「回診管理」，網頁按鈕使用 LIFF URI。
6. **選做 F1 relay 和 Rich Menu 聯測。** 若需要 n8n 接每日紀錄，匯入 F1 relay，保持 `MEMBER_GAS_URL` 指回 F1 GAS，將 `F1_API_URL` 改成 relay webhook，填相應的 `F1_WEBHOOK_GATEWAY_KEY`。先驗固定 Rich Menu（綁定 `?page=bind`、會員 `?page=member`、紀錄 `?page=daily`、摘要根網址），最後才用 GAS 的兩個 Rich Menu 屬性驗綁定後自動換選單。兩項都可以晚部署，基本 LIFF 綁定與健康紀錄仍可先驗。[LINE Rich Menu](https://developers.line.biz/en/docs/messaging-api/using-rich-menus/)

### 空白測試工作簿表頭

每列開頭是分頁名稱，冒號後是該頁第一列。複製欄位到 Google Sheets 時可依逗號分割。照護與回診工作簿時區均設為 Asia/Taipei。

```text
Families: familyId,patientName,note
Members: familyId,lineUid,role
FamilyPatients: familyId,patientId
FamilyInvites: codeHash,familyId,expiresAt,claimedBy
MetricDefinitions: metricKey,metricName,inputType,unit,isActive
TrackingSettings: familyId,metricKey,enabled,updatedBy,updatedAt,route,metricName,unit,alertLow,alertHigh,systolicLow,systolicHigh,diastolicLow,diastolicHigh,changeThreshold,systolicChangeThreshold,diastolicChangeThreshold
DailyRecords: recordId,familyId,lineUid,recordedAt,metricKey,metricName,value,unit,note,source,createdAt,createdBy,route,recordDate,period,memberId,valueNumeric,valueSystolic,valueDiastolic,schemaVersion,isRecorded,patientId
appointments: appt_id,patient_id,date,session,hospital,department,status
```

## 一次發給組員的更新

| 負責人 | 需要同步的改動 |
| --- | --- |
| LINE／原會員中心 | Hub 已提供綁定和會員中心。移交測試入口到 `?page=bind`、`?page=member`。共同 Members 只由新會員 API 建立，切換後停止舊入口向同一測試表雙寫。 |
| F1 每日紀錄 | 共同身分由 Members 與 FamilyPatients 查詢，DailyRecords 可增設 `patientId`。歷史格式保留。提供的 11 節點 F1-A 草稿缺完整驗證與讀表，現用 GAS writer，既有異常提醒待完整版本驗證。 |
| 儀表板 | 讀同一份 F1 工作簿和共用病人鍵。移除以 `pt_<familyId>` 生成 ID 的路徑，原圖表和 PDF 仍走 GAS。 |
| F3 回診 | 互動流程統一用 Members 與 FamilyPatients 授權，新帳號無需另外加進 F3 users 或家屬表。appointments 保留 `patient_id`。若仍有獨立提醒 workflow 使用舊身分表，另做遷移後測推播。 |
| LINE 管理員 | 使用頂層 LIFF Endpoint、測試 OA webhook 與固定測試 Rich Menu。待自助綁定、邀請、查表、隔離及回診皆通過，再排自動換選單與正式切換。 |

前次唯讀核對的工作簿中，F1 Live DailyRecords 有 21 欄，新 `patientId` 是加在尾端的相容欄。舊儀表板 demo 工作簿另存 BPRecords、GlucoseRecords 等資料，只保留作展示。另兩份同名儀表板工作簿首列表頭空白。F1-A 交接的 12 節點曾通過基本 LIFF 寫入，11 節點草稿缺入口與驗證，兩版不能混用。

**驗收狀態**　本機測試涵蓋本人建立、重送、家人加入、單次邀請、舊 ID 對照衝突、共用入口、日誌讀寫與回診授權。尚未部署或修改線上 GAS、試算表、OA、LIFF 及 n8n。正式資料遷移、真機登入與自動換選單都待測試環境證據。

直接開啟每日紀錄 GAS HTML 預覽時，在該 GAS 的 Script Properties 設 `LIFF_ID`。留空 `F1_API_URL` 時，表單與設定頁會透過 `google.script.run` 呼叫同一專案的 F1 API。頂層 Node LIFF 仍使用主機環境變數 `F1_API_URL` 指向測試 GAS 或 relay。若外部瀏覽器的 LIFF 登入在 GAS iframe 被阻擋，改從頂層 LIFF 開啟。

## 原始功能與移轉狀態

| 舊交付 | 現在的位置 | 保留範圍與待驗收 |
| --- | --- | --- |
| LINE Login PoC、Menu 抽換 PoC | `frontend/member.*`、`gas/daily/Membership.gs`、`RichMenu.gs` | 本人建立、邀請家人、會員中心、解除綁定及 Rich Menu 切換均有程式。舊 PoC 的 OAuth callback 是歷史入口，新版走 LIFF。 |
| F1 GAS LIFF、F1-A、GoogleSheets_schema | `gas/daily/`、`n8n/daily-record/integration-test.json` | 每日表單、家庭追蹤設定、管理員門檻及寫入已接上。n8n relay 轉送到 GAS writer。F1-A 交付缺完整驗證／讀取節點，且兩日差異、RecordAlerts、OA 推播仍為草稿。 |
| 健康儀表板 MVP、PDF 範例 | `gas/dashboard/`、`adapters/` | 血壓、血糖、用藥回報、下次回診及摘要 PDF 已接新版資料。舊 demo 的藥品清單及提問是展示資料，尚無新版資料入口。 |
| LINE 主流程 v2 | `n8n/line-main/integration-test.json` | 保留入口分流與完整回診 postback。用藥分支原本是入口回覆，本 repo 目前沒有獨立 F2 用藥打卡或 F6 推播。 |
| F3 新增、編輯、提醒 | `n8n/appointment/integration-test.json`、`n8n/appointment/reminders-test.json` | 互動版支援新增、改期、編輯、取消。提醒版保留 09:00 回診前 7／3／1 天與 20:00 回診當日提醒，改從共同家戶找收件人，預設停用。歷史管理員錯誤通知指向舊環境，因此測試版只記錄失敗，不通知舊管理員。 |

STAGING 照護測試表已唯讀核對分頁，包含 `Families`、`Members`、`FamilyPatients`、`FamilyInvites`、`MetricDefinitions`、`TrackingSettings`、`DailyRecords`。同名搜尋僅查到照護測試表。這能證明分頁存在，實際部署的 Script Properties、n8n 憑證、工作流綁表和舊資料是否匯入仍待驗收。

| 資料 | 服務入口與目的地 |
| --- | --- |
| 每日紀錄 | LIFF → Daily GAS → 照護工作簿（`F1_SPREADSHEET_ID`）的 `DailyRecords`。如果使用 n8n relay，中間多一個轉送節點。 |
| 家庭與病人 | Daily GAS → 同一照護工作簿的 `Families`、`Members`、`FamilyPatients`。 |
| 回診 | LINE → n8n LINE 主流程 → F3 → 回診工作簿的 `appointments`，以 `patient_id` 對應 `FamilyPatients.patientId`。 |
| 回診提醒 | F3 提醒 workflow 讀同一份回診表與照護表。推播結果寫入回診表的 `notification_log`，欄位 `appt_id,user_id,channel,offset_days,status,sent_at`。新版 `user_id` 存 LINE UID，舊日誌若用內部 `user_id` 需先轉換，否則舊通知不會被辨識為已發。 |
| 儀表板 | 讀照護工作簿的 `DailyRecords` 及回診工作簿的 `appointments`；部署 Dashboard GAS 不會建立工作簿。 |

要接通回診，先在測試 Daily GAS 執行 `setupStagingAppointments()` 建立回診表和通知日誌。若已有回診測試表，只需補上 `notification_log` 分頁與表頭。回診工作簿 ID 填至 Dashboard Script Property `APPT_SPREADSHEET_ID` 和 n8n 的 `REPLACE_STAGING_APPT_SPREADSHEET_ID`。n8n 中 `REPLACE_STAGING_F1_SPREADSHEET_ID` 填照護工作簿 ID。設定測試 Google Sheets 與 LINE 憑證後，先驗回診新增、在表中找到該列、儀表板讀回，再單獨驗提醒。各環境的工作流匯入、憑證綁定、歷史列回填及真機操作本輪均未執行。提醒日誌能略過已記為成功的項目，同時執行或推播成功而日誌寫入失敗時仍可能重送。

## 文件與測試交接

- 團隊先讀 [README](../README.md) 啟動專案，再用本頁查看各功能去向與部署差距。
- RD 查 [API](api-contract.md)、[資料表與鍵](data-schema.md)、[欄位轉換](data-mapping.md) 。執行架構見 [README](../README.md)。這些是查詢文件。
- 部署負責人查 [回復](rollback.md) 與 [安全](security.md)；測試範圍見 README 的「測試」一節。
- `tests/` 建議隨功能一起提交 GitHub。內容是虛構資料，用來驗 schema、家庭隔離、綁定、資料讀寫及工作流邏輯。原始 `file/` 和各環境 `.clasp.json` 留在本機。
