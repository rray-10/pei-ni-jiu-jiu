# API Contract（GAS `google.script.run`）

實作：`gas/dashboard/Code.gs`；純邏輯：`adapters/dashboard-service.js`（有測試）。

## 共通
- **驗證**：每個呼叫第一個參數為 `idToken`（LIFF `liff.getIDToken()`）。後端以 `https://api.line.me/oauth2/v2.1/verify`（`client_id`=`LINE_LOGIN_CHANNEL_ID`）驗證，取得 `sub` 作為 lineUid；`aud` 不符即拒絕。
- **授權**：以 lineUid 查 `Members` 得 familyId；**請求中的 familyId/patientId 一律不信任**，patientId 僅用於比對（不一致 → `FORBIDDEN`）。
- **開發模式**：僅當 Script Property `DEV_AUTH_ENABLED=true` 且未帶 token，使用 `DEV_LINE_UID`；回應 `meta.devMode=true`，UI 顯示橫幅。正式部署必須為 `false`。
- **錯誤格式**：丟出 `Error('[CODE] 訊息')`。`UNAUTHENTICATED` `NOT_MEMBER` `FORBIDDEN` `BAD_REQUEST` `DATA_INTEGRITY` `CONFIG`。前端轉成使用者可讀訊息。
- **時間**：時間戳 ISO-8601 含 `+08:00`；業務日 `yyyy-MM-dd`（台北）。
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
