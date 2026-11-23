# 安全紀錄

## 已發現問題（需處理）
1. **F1 Sheet 與回診 Sheet 含真實格式的 LINE User ID**（`U` + 32 碼 hex，Members／DailyRecords／TrackingSettings／users）。屬個資。**本 repo 未複製這些值**；測試一律用虛構 `U_TEST_*`。建議：縮小 Sheet 分享範圍；測試與正式資料分檔。
2. 儀表板 DEMO 無任何驗證（寫死 `u_demo_01`）：**不得**以公開 `/exec` 連結部署並接真實資料。整合版已改為 token 驗證，但仍需在私人測試部署驗收後才可接真實資料。
3. F1 DailyRecords 同時存放 `lineUid` 與健康數值，Sheet 分享者可直接對應人與數據。
4. 本次可讀範圍內**未發現**已暴露的 Channel Secret／Access Token。**n8n JSON 尚未檢視**；匯入 repo 前必須掃描並移除 Credentials、Webhook 內嵌 Token。

## Repo 防護
- `.gitignore` 排除 `.env*`、金鑰、credentials、csv/xlsx。
- `tests/gas-sync.test.js` 會掃描全 repo：出現真實格式 LINE UID 或 JWT 樣式字串即失敗。
- 輸出層不含 lineUid/createdBy（有測試）。

## 若曾貼出 Token
任何曾出現在文件／截圖／聊天的 Channel Access Token 或 Secret，請到 LINE Developers Console 重新發行（Reissue）。
