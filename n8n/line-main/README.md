# LINE 主流程測試版

匯入 `integration-test.json` 並搭配 F3 子流程。Node 驗證 LINE 原始請求簽章，驗證成功才以測試 Header Auth 轉給 n8n。n8n 使用 Members 查家庭，回診與回診 postback 傳完整事件給 F3。未命中既有按鈕的文字也交給 F3，供輸入醫院與科別，沒有回診草稿時可能不回覆。設定及驗收見 [部署步驟](../../docs/integration-audit.md)。
