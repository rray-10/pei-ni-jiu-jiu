# 整合架構與路由決策

```
LINE OA ─ Rich Menu ─┬─ ④每日記錄 → LIFF(F1) → n8n(F1-A) → DailyRecords(Sheet)
                     ├─ ⑤健康摘要 / ⑦會員中心 → GAS Hub(?page=…) → 驗 ID Token → Members → 家庭 → Adapter → 儀表板
                     ├─ ⑥回診管理 → n8n 主流程 → (Execute Workflow) F3 → appointments(Sheet)
                     └─ ③用藥打卡 → n8n（MISSING）
```

## 路由方案：Query Parameter（`?page=dashboard|summary|…`）
- GAS `doGet(e)` 可直接讀 `e.parameter`；HtmlService 以 iframe 載入，**URL hash 不會傳到伺服器**，且 LIFF 會使用 `liff.state` 參數與 hash 做導向，Hash Router 在 GAS iframe 內易失效。
- 每個模組仍是獨立頁面：Hub 只提供 RWD 導覽（桌面固定側欄／手機抽屜），外部模組用連結（`NAV_*_URL`），不重寫既有功能。回診管理在 LINE 對話內，故側欄僅提示。
- LIFF×GAS iframe 的 ID Token 取得**尚未實測**；若失敗，退路是獨立 HTTPS 前端＋GAS/n8n 只當受保護 API（原 README 已同樣建議）。

## 安全邊界
前端不持有任何密鑰；授權只在 `Code.gs`＋`DashboardService`。因 Web App 需「任何人可存取」，**存取控制 100% 取決於 token 驗證**，已用測試覆蓋授權邏輯，但 token 驗證本身（`UrlFetchApp`）需在真實環境人工驗收。
