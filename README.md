# 陪你久久 Integration Hub

LINE LIFF 前端（Node）＋兩個 Google Apps Script（GAS）後端＋ Google Sheets 資料。整合 LINE 登入與家庭身分、每日健康紀錄、健康儀表板，以及 n8n 的回診與用藥打卡。

> 目前是**測試部署**狀態：只使用測試 OA、測試 GAS、測試試算表與虛構資料。

## 架構

```
LINE App ── LIFF ──► frontend/server.js (Node 22, 頂層 HTTPS)
                      ├─ 頁面：?page=bind | member | daily | settings | appointments | summary，根網址 = 儀表板
                      ├─ POST /api/member, /api/daily ─► gas/daily     （家庭綁定、每日紀錄、追蹤設定、Rich Menu）
                      ├─ POST /api/dashboard ──────────► gas/dashboard （唯讀：儀表板、就診摘要 PDF）
                      └─ POST /line/events ────────────► n8n 主流程（驗 LINE 簽章後轉送）
                                         GAS ──► Google Sheets（唯一資料來源）
```

- LIFF 必須放在頂層 HTTPS 頁面。GAS 頁面在 `googleusercontent.com` iframe 內，LINE 登入會被擋（400 `redirect_uri`），所以 Node 負責頁面，GAS 只當資料 API。
- 登入憑證：頁面取得 LIFF **access token**，GAS 向 LINE 驗證後取得 LINE userId，再查 `Members`。Dashboard 也接受 ID token。授權唯一依據是 `Members` 的 `lineUid`，前端傳入的 familyId／patientId 一律不信任。
- 一個 LIFF ID 服務所有頁面，Size 用 Tall。按鈕連結一律是 `https://liff.line.me/<LIFF_ID>/?page=<頁面>`。

| 路徑 | 用途 |
| --- | --- |
| `frontend/` | Node 主機（`server.js`）與綁定／會員頁（`member.html`、`member.js`） |
| `gas/daily/` | 家庭綁定與邀請（`Membership.gs`）、每日紀錄 API（`Api.gs`）、Rich Menu（`RichMenu.gs`）、建測試試算表（`Setup.gs`）、每日紀錄與設定頁 HTML |
| `gas/dashboard/` | 儀表板 UI 與授權 API（`Code.gs`）；`dashboard-service.gs`、`health-adapter.gs` 由 `adapters/` 產出，**不要直接改** |
| `adapters/` | 資料轉換與家庭授權邏輯（單一事實來源），Node 測試與 GAS 共用 |
| `n8n/` | 唯一的 workflow [`main-flow.json`](n8n/main-flow.json)（LINE 分流、回診、用藥打卡、回診提醒），匯入方式與已知問題見 [n8n/README.md](n8n/README.md) |
| `scripts/` | `sync-gas.sh`（adapters → gas/dashboard）、`prepare-n8n-import.js` |
| `tests/` | `npm test`（Node 內建 test runner） |

## 測試

`npm test` 涵蓋：家庭綁定／邀請／解除／個人資料、Dashboard 與 Daily 的 token 驗證與跨家庭隔離、Node 路由與 LINE 簽章轉送、adapter 資料轉換、GAS 檔案同步，以及 repo 是否含疑似 token 或真實 LINE UID。LINE、Sheets、n8n 以替身模擬，**真機端到端仍須在測試環境手動驗收**。

後續評估（未做）：把 Sheets 換成 PostgreSQL（Supabase）。adapter 的 `normalizeDailyRecord` 可作匯入轉換器。

## 快速開始（本機）

需要 Node 22+。

```bash
npm test                     # 全部測試
npm run sync:gas             # 改了 adapters/*.js 之後必跑，否則 gas-sync 測試會失敗
```

啟動前端：複製 `.env.example` 為 `.env.staging`（已被 `.gitignore` 排除，**不要提交**），填入 `LIFF_ID`、`LIFF_ENDPOINT`（HTTPS 根網址）、`MEMBER_GAS_URL`、`F1_API_URL`（都填 Daily `/exec`）、`DASHBOARD_GAS_URL`，然後：

```bash
npm run start:local   # = node --env-file=.env.staging frontend/server.js
```

直接執行 `node frontend/server.js` 而沒有環境變數會出現 `LIFF_ENDPOINT and LIFF_ID are required`。

固定主機請用 Render（見 `render.yaml`：Node 22、`npm start`，環境變數在 Render 後台填）。臨時測試可用 `cloudflared tunnel --url http://localhost:8080` 取得臨時 HTTPS 網址（每次重開網址會變，要回 LINE Developers 更新 LIFF Endpoint）。

## GAS 與 clasp

兩個專案各自有 `.clasp.json`（scriptId）。每個專案在**自己的目錄**操作：

```bash
npm i -g @google/clasp        # 已安裝可略過
clasp login                   # 用擁有測試專案的 Google 帳號

cd gas/daily                  # 或 gas/dashboard
clasp status                  # 看會推送哪些檔案
clasp push                 # 推到專案 HEAD（編輯器可立即手動執行）
clasp version "說明"          # 建立不可變版本，回傳版本號 N
clasp deployments             # 找到既有 Web App 的 deploymentId
clasp redeploy -V N -d "說明" <deploymentId>   # 既有 /exec 網址改用版本 N（網址不變）
clasp pull                    # 把遠端內容拉回本機（先確認不會蓋掉未提交修改）
```

注意：

- **改 Web App 的 `/exec` 要先 `version` 再 `redeploy`**。只 `push` 只會更新 HEAD（`/dev`），`/exec` 不變。
- `appsscript.json` 必須保留 `webapp: {executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS}` 與 `oauthScopes`，否則 `/exec` 會要求 Google 登入。`clasp pull`／`clasp create` 可能把它覆寫，推送前先檢查。
- 新增 OAuth scope（例如 `drive.readonly`）後，要在編輯器手動執行一次任一函式並授權，再建立新版本。
- 程式有錯時看 Apps Script 編輯器左側「執行作業」，Dashboard 的失敗原因會寫在 `console.error`。

### Script Properties（專案設定 → 指令碼屬性）

| 屬性 | Daily | Dashboard | 說明 |
| --- | --- | --- | --- |
| `LINE_LOGIN_CHANNEL_ID` | ✔ | ✔ | LINE Login channel 的 **Channel ID**（10 位數字，不是 Secret），兩邊必須一致 |
| `F1_SPREADSHEET_ID` | ✔ | ✔ | 照護測試試算表 ID，兩邊必須一致。可先在 Daily 執行 `setupStagingSpreadsheet()` 自動建立 |
| `APPT_SPREADSHEET_ID` | | ✔ | 回診所在試算表。n8n 寫在照護試算表，所以填與 `F1_SPREADSHEET_ID` 相同的值 |
| `DEV_AUTH_ENABLED` | | `false` | 必須是 false |
| `LIFF_ID` | ✔ | | 建 Rich Menu 按鈕連結用 |
| `LINE_OA_ACCESS_TOKEN` | 選 | | 測試 OA 的 Messaging API token，Rich Menu 切換與好友檢查需要 |
| `REQUIRE_OA_FRIEND` | 選 | | 設為 `true` 時，建立／加入／切換家庭前會檢查使用者是否已加官方帳號好友（需要 `LINE_OA_ACCESS_TOKEN`） |
| `RICH_MENU_UNBOUND_IMAGE_FILE_ID` / `RICH_MENU_BOUND_IMAGE_FILE_ID` | 選 | | Drive 圖片 ID，供 `createRichMenus()` 上傳 |
| `UNBOUND_RICH_MENU_ID` / `BOUND_RICH_MENU_ID` | 選 | | 由 `createRichMenus()` 寫入 |

## 資料表（照護測試試算表）

`Families`、`Members`、`FamilyPatients`、`FamilyInvites`、`MetricDefinitions`、`TrackingSettings`、`DailyRecords`；n8n 另用同一份的 `appointments`、`notification_log`、`med_logs`。重點：

- `Members(familyId, lineUid, role)`：有這列才算已綁定。`role` 為 `admin`（為自己建立）或 `member`（用邀請碼加入）。
- `FamilyPatients(familyId, patientId)`：一戶一位被照護者。`DailyRecords.patientId` 與儀表板比對回診都用這個 `P_…`，不是 LINE ID 也不是 familyId（n8n 目前寫的是 familyId，尚未一致）。
- `Families` 另有選填 `birthYear`、`conditions`、`allergies`（建立家庭時自動補欄位）。
- `Members` 另有 `displayName`、`joinedAt`；`Families` 另有 `createdFor`（`self`／`proxy`）。欄位缺少時由程式自動補上。
- 角色只有 `admin`（管理者）與 `member`（成員）。管理者可產生邀請、把成員設為管理者、移除成員。「替家人建立」的建立者是管理者，患者本人之後用邀請連結加入，再由管理者設為管理者。
- 已綁定的帳號開別人的邀請連結時，可選「解除目前綁定並加入」（一個帳號目前只能綁一個家庭；管理者若還有其他非管理者成員需先處理）。
- 解除綁定只刪 `Members` 那一列，家庭與紀錄保留；同一個 LINE 帳號再次「為自己建立」會回到同一個家庭。管理者在還有其他成員時不能解除綁定。

## API 與資料規則

Node 只轉送到 GAS；兩個 GAS 都自己驗 LINE token、查 `Members`。回應為 `{ok:true,…}` 或 `{ok:false,error}`。

| 路徑 | `action` |
| --- | --- |
| `/api/member` | `memberStatus`、`previewInvite`、`createFamily`、`joinFamily`、`switchFamily`、`createInvite`、`syncMenu`、`unbind`、`listMembers`、`removeMember`、`promoteMember` |
| `/api/daily` | `read`、`record`、`update`（僅管理者） |
| `/api/dashboard` | `getHubData`、`getDashboardData`、`generateVisitPdf` |

儀表板的資料規則（實作在 `adapters/`）：

- 日期是台北日曆日；`recordDate` 空白時由 `recordedAt` 推導。同家庭、日期、時段、項目重複時取最新一筆。
- 超出合理範圍的值不納入統計、不刪原始列：收縮壓 50–260、舒張壓 30–180、血糖 20–600 mg/dL（mmol/L 會換算）。`source=TEST` 或 `isRecorded=FALSE` 也排除。
- 用藥回報率的分母是「已回報次數」，不是服藥遵從率。
- 即將回診 = 狀態 `scheduled` 或 `edit_hospital` 且日期不早於今天。

## Rich Menu

規則：**未綁定 = OA 預設選單；綁定成功（建立或加入）→ 對該使用者指派已綁定選單；解除綁定 → 移除個人指派，回到預設選單。**

按鈕連結（`<LIFF_ID>` 換成測試 LIFF ID）：

| 選單 | 按鈕 | 動作 |
| --- | --- | --- |
| 未綁定 | 綁定家人 | `https://liff.line.me/<LIFF_ID>/?page=bind` |
| 已綁定 | 每日紀錄 | `https://liff.line.me/<LIFF_ID>/?page=daily` |
| 已綁定 | 健康摘要（儀表板） | `https://liff.line.me/<LIFF_ID>/` |
| 已綁定 | 回診管理 | 送出文字「回診管理」（由 n8n 處理） |
| 已綁定 | 用藥打卡 | 送出文字「用藥打卡」（由 n8n 處理） |
| 可選 | 會員中心／追蹤設定／就診摘要 | `?page=member`／`?page=settings`／`?page=summary` |

設定步驟：填好 Daily 的屬性後，在編輯器執行 `createRichMenus()`。圖片須為 2500×843（或 2500×1686）px。要調整按鈕，改 `RichMenu.gs` 的 `richMenuDefinitions_()` 後重跑（舊選單可在 LINE 後台刪除）。

## 接 n8n

匯入步驟、需要的分頁、Webhook 設定與已知問題見 [n8n/README.md](n8n/README.md)。repo 內只保留 `REPLACE_*` 佔位符，填好的副本輸出到被忽略的 `n8n/import/`。

Render 的 `LINE_MAIN_WEBHOOK_URL`、`LINE_WEBHOOK_GATEWAY_KEY`、`LINE_MESSAGING_CHANNEL_SECRET` 只填在 Render 後台。

## 測試部署順序

1. 兩個 GAS：`push` → `version` → `redeploy`，設好上表屬性。
2. Daily 執行 `setupStagingSpreadsheet()`，把 `F1_SPREADSHEET_ID` 貼到 Dashboard 的 `F1_SPREADSHEET_ID` 與 `APPT_SPREADSHEET_ID`。既有試算表缺 n8n 分頁時執行 `setupN8nTabs()`。
3. 啟動 Node（或臨時 tunnel），LINE Developers 把**測試用那一筆** LIFF 的 Endpoint 改成 Node 根網址，Scope 勾 `openid`、`profile`。**不要動 Callback URL 與其他 LIFF。**
4. 測試帳號開 `https://liff.line.me/<LIFF_ID>/?page=bind` 驗綁定；核對 `Families`、`FamilyPatients`、`Members`。
5. 之後才接 n8n 與 Rich Menu。

## 回復

先還原測試 OA 的 webhook 網址與 Rich Menu，再把測試 LIFF Endpoint 指回前一版，停用 n8n 流程（確認排程沒有啟用）。兩個 GAS 用 `clasp redeploy` 指回前一版本，Render 回到前一次部署。部署前先留一份試算表副本。切正式環境前，記錄正式的 GAS 版本、LIFF Endpoint、OA 設定、n8n 版本與表格備份，由負責人授權後再切換。

## 安全

- 不要提交 `.env*`、金鑰、LINE token／Channel Secret、n8n credentials。`.gitignore` 已排除常見檔名，`tests/gas-sync.test.js` 會掃描疑似 token 與真實 LINE UID。
- 舊交接資料夾 `file/` 已移除，但 **git 歷史仍保留當時提交過的檔案**。曾出現在文件或聊天中的 token／secret 請到 LINE Developers 重新發行。
- 試算表含 LINE userId 與健康數值，縮小分享範圍，測試與正式資料分檔。
- 每個環境各自保存憑證；測試與正式不要共用 token。
