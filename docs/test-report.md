# 測試報告

執行：2026-11-23，Node 22，`NODE_PATH=$(npm root -g) npm test` → **27 項通過／0 失敗**（含 3 項 Playwright 畫面測試）。
全部使用虛構資料（`tests/fixtures/fixture.js`）。**自動化測試跑的是 adapter／服務層與以假 `google.script.run` 驅動的 UI，不是真實 GAS、LINE、n8n 或 Sheet。**

| # | 要求 | 結果 | 證據／範圍 |
|---|---|---|---|
| 1 | 已加入家庭者可讀自己資料 | ✅ 通過（服務層） | `dashboard-service.test.js` #1/#1b |
| 2 | 未加入家庭無法讀取 | ✅ 通過（服務層＋UI 訊息） | #2；e2e「未綁定」 |
| 3 | 家庭間隔離（含偽造 patientId） | ✅ 通過（服務層） | #3/#3b |
| 4 | 新增每日紀錄後儀表板顯示 | ⚠️ 部分：資料新增後**服務層**正確顯示；真實 LIFF→n8n→Sheet→GAS 鏈**未測** | #4 |
| 5 | 血壓解析 | ✅ 通過 | adapter 測試、#5 |
| 6 | 血糖單位／異常值／去重 | ✅ 通過 | #6 |
| 7 | 新增回診後日期正確 | ⚠️ 服務層通過；n8n 新增流程**未測** | #7 |
| 8 | 取消後不再顯示為即將回診 | ✅ 通過（服務層） | #7/#8 |
| 9 | 重複事件不重複寫入／回覆 | ❌ **未測**：寫入端在 n8n（無 JSON）。僅「讀取端」重複紀錄去重有測 | adapter 去重 |
| 10 | LINE LIFF 手機可用 | ❌ **未測**。僅 375px 版面與抽屜（無橫向捲動）通過 | e2e 手機 |
| 11 | PDF 在 LINE 內開啟 | ❌ **未測** | — |
| 12 | 原功能未失效 | ⚠️ 原檔原樣保留於 `original-demo/`；UI 元件與圖表沿用；**未在真實 GAS 回歸**。原 DEMO 的「患者切換」改為單一被照護者（V2 規則） | — |

另測：打卡時段與跨日規則（11/24 02:00→11/23 睡前）、時區轉換、空資料、期間參數驗證、同人多家庭資料異常、輸出不含 lineUid、repo 無真實 LINE UID／JWT、gas/shared 與 adapters 同步。

## 需人工驗收清單
1. 新 GAS 專案部署；Sheet 授權（`spreadsheets.readonly`）。
2. 真實 LIFF 開啟 → `getIDToken()` → `verify` 成功；用「非成員」帳號確認被拒。
3. 在 F1 實際新增一筆（血壓 132/84）→ 儀表板出現。
4. 手機 LINE 內建瀏覽器：版面、抽屜、PDF 下載。
5. 建 `FamilyPatients` 後回診出現在「下次回診」。
6. 量測：LIFF init、驗證、`meta.timings`（已回傳 authMs/sheetsMs/buildMs）、圖表渲染。
