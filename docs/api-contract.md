# API Contract

目前部署與資料歸屬見 [整合決策與團隊更新](integration-audit.md)。

實作：`gas/dashboard/Code.gs`；純邏輯：`adapters/dashboard-service.js`（有測試）。

## 共通
- **驗證**：每個呼叫第一個參數為 `idToken`（LIFF `liff.getIDToken()`）。後端以 `https://api.line.me/oauth2/v2.1/verify`（`client_id`=`LINE_LOGIN_CHANNEL_ID`）驗證，取得 `sub` 作為 lineUid；`aud` 不符即拒絕。
- **授權**：以 lineUid 查 `Members` 得 familyId；**請求中的 familyId/patientId 一律不信任**，patientId 僅用於比對（不一致 → `FORBIDDEN`）。
- **開發模式**：僅當 Script Property `DEV_AUTH_ENABLED=true` 且未帶 token，使用 `DEV_LINE_UID`；回應 `meta.devMode=true`，UI 顯示橫幅。正式部署必須為 `false`。
- **錯誤格式**：丟出 `Error('[CODE] 訊息')`。`UNAUTHENTICATED` `NOT_MEMBER` `FORBIDDEN` `BAD_REQUEST` `DATA_INTEGRITY` `CONFIG`。前端轉成使用者可讀訊息。
- **時間**：時間戳 ISO-8601，含 `Z` 或時區偏移；業務日 `yyyy-MM-dd`（台北）。
- **快取**：健康資料**不快取**（敏感）。非敏感設定（nav URL）可由 Script Properties 讀取。

## 服務
| 名稱 | Request | Response | 空資料 |
|---|---|---|---|
| `getHubData(idToken, days)` | days∈{7,30,90} | `{context, dashboard, meta{devMode,timings}}`（一次呼叫，減少 round trip） | 同下 |
| `getSessionContext(idToken)` | — | `{familyId, role, patients:[{id,name,role}]}` | 未綁定 → `NOT_MEMBER` |
| `getDashboardData(idToken, patientId, days)` | patientId 來自 context | `{patient, familyId, days, latestBP, bpAverage{sys,dia}, glucoseAverage, medication{taken,total,rate}, nextAppointment, bp[], glucose[], medications[], questions[], quality{excludedTest,excludedInvalid}, generatedAt}` | 陣列 `[]`、數值 `null` |
| `getVisitSummary(idToken, patientId, days)` | 同上 | dashboard + `bpSysStats/bpDiaStats/glucoseStats{min,max}` | `null` |
| `generateVisitPdf(idToken, patientId, days)` | 同上 | `{filename, base64}` | 空表格仍可產出 |
| `getFamily` / `getPatient` / `getDailyRecords` / `getAppointments` / `getMedicationSummary` | **MISSING**（P1/P2）；目前已含於 `getDashboardData` |

`medications[]`、`questions[]`、病史／過敏／出生年：F1 無此資料，回傳空值（UI 顯示「未填寫」）。

## 頂層 LIFF HTTP

Node `POST /api/dashboard` 轉交 GAS `doPost`，接收 `{action,idToken,days,patientId?}`。允許 `getHubData`、`getDashboardData`、`generateVisitPdf`。回傳 `{ok:true,data}` 或 `{ok:false,error}`，拒絕開發替代身分。圖表項目含 `record_date`（業務日）與 `measured_at`（寫入時間）。回應設 `Cache-Control: no-store`。

Node `POST /api/daily` 轉到測試 F1 relay 或 GAS writer。共同欄位為 `{action,accessToken}`，後端驗 client ID、有效期限與 LINE profile ID，再取唯一 Members 連結。

| 操作 | Request 其餘欄位 | Response |
| --- | --- | --- |
| `read` | 無 | `{ok,familyId,role,metrics,settings}`，設定空白時各項目預設停用 |
| `record` | `requestId,recordDate,period,values,note?` | `{ok,savedCount,recordedAt,recordDate,period,warnings}` |
| `update` | `settings` 陣列 | 與讀取相同。僅管理者。 |

錯誤為 `{ok:false,error}`，每日紀錄測試 writer 的 `warnings` 為空陣列。與原 F1-A 相容時可額外傳送 `requestId`，由原實作決定是否採用。瀏覽器、兩個 GAS 與測試 n8n 均不以 client 傳入的家庭識別授權。

Node `POST /api/member` 送到 `MEMBER_GAS_URL`（F1 GAS）。所有操作以 `accessToken` 驗證。支援 `memberStatus`、`createFamily(patientName)`、`joinFamily(inviteCode)`、`createInvite`、`syncMenu`。未綁定的 status 回 `{ok:true,bound:false}`，綁定後回 `{ok:true,bound:true,familyId,patientId,patientName,role}`。邀請只有 admin 可建立，明碼只在建立回應提供。選單失敗可以重試，綁定結果保留。
