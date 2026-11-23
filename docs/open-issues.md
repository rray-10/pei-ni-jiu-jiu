# 尚未解決問題與需組員提供的資訊

## BLOCKED（缺檔）
1. **Index.html 原版**（Drive 上為 0 bytes）。
2. **n8n JSON**：F1-A、F3 回診、LINE 主流程 v2（目前只有截圖）。→ P1「主流程呼叫 F3」無法動工；請匯出並**移除 credentials** 後放入 `n8n/*/`。
3. LINE Login PoC／F1 的 GAS 程式與 LIFF 表單原始碼、Rich Menu 設定、API／交接文件、測試紀錄。
4. V1 舊規格（V1↔V2↔程式差異比對未做）。
5. 第二份「陪你久久-健康儀表板」`1AysK…` 與資料夾「Aiden」內容。

## 需決策
1. **F001 ↔ patient_id**（`p001`？）— 建立 `FamilyPatients`。
2. period 詞彙：`morning/evening` vs `breakfast/lunch/dinner/bedtime`。
3. 合理範圍（血壓、血糖、體溫上限）與是否以醫療顧問為準。
4. F1 `medication` 回報與 V2 F2「LINE 用藥打卡」是否合併為同一資料來源（目前 MedicationCheckins 不存在）。
5. `isRecorded=FALSE` 的語意（目前與 `source=TEST` 一併排除）。
6. 未綁定使用者進入儀表板的導向頁（現為文字提示）。

## 已知風險／未驗證
- LIFF 在 GAS iframe 內初始化與 `getIDToken()`（未實測）。
- PDF Blob 下載在 LINE 內建瀏覽器（未實測）；備案：回傳 Drive 暫存連結或改由 n8n 推送 PDF 檔。
- Sheets 無唯一約束：多人同時打卡／寫入的競態未處理。
- 效能：**尚未量測**（沒有部署環境）。已做：單次 `getHubData` 取代 2 次往返、每表單次 `getValues`；未做：DashboardSnapshot。
- RecordAlerts／TrackingSettings 閾值尚未接入儀表板。
- 分支策略：main／integration／feature/* 尚未建立（本 session 僅允許推送到 `claude/trusting-cannon-ueythc`）。
