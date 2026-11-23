# n8n（待提供 JSON）

**狀態：BLOCKED** — Drive 資料夾沒有任何 n8n JSON，只有主流程截圖，因此**沒有產生也不會偽造**可匯入的工作流。

依截圖與 V2 規格，建議的最小修改（待 JSON 後實作）：
1. 主流程 Webhook 後先驗 `X-Line-Signature`（以 n8n Credential 保管 Channel Secret）。
2. 去重：以 `webhookEventId` 在 Sheet/DB 查重，已處理則直接結束（避免重複寫入／重複回覆）。
3. `appointment` 分支：把「固定文字回覆」節點換成 **Execute Workflow**，傳入**完整 LINE event**（含 `replyToken`、`postback`、`source.userId`），不要傳精簡過的 keyword。
4. F3 子流程需有 **Execute Workflow Trigger**，並處理 `postback`（編輯／刪除確認）與 `datetimepicker` 的 `postback.params`。
5. 身分：以 `source.userId` 查 Members → familyId → patient_id（同 `DashboardService.resolveMembership`），不要信任 payload 內的 familyId。
