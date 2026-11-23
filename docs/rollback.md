# Rollback 回復流程

| 變更 | 回復方式 |
|---|---|
| 整合版 GAS（新測試專案） | 本整合**不覆蓋**既有 `/exec`。停用新部署（Deploy → Manage deployments → Archive）即可，既有 DEMO 不受影響 |
| 回到原 DEMO 程式 | 以 `gas/dashboard/original-demo/` 的 Code.gs / Scripts.html / Styles.html / PdfTemplate.html 原樣貼回（Index.html 原版需組員提供） |
| GAS 新版本問題 | Apps Script → Deploy → Manage deployments → 編輯 → 選舊版本 |
| `FamilyPatients` 分頁 | 刪除該分頁即可；服務層自動退回 `pt_<familyId>` 預設 |
| Sheet 資料 | 整合只讀；若有人工修改，使用 Sheet「版本記錄」或 migration-plan 的備份副本 |
| n8n | 匯入前先匯出現行工作流 JSON（**移除 credentials 後**）存私人處；回復＝匯入舊 JSON |
| Git | `git revert <commit>`；不改寫共用分支歷史 |
| 緊急關閉讀取 | Script Properties 清空 `F1_SPREADSHEET_ID`，所有呼叫會回 `[CONFIG]` 而非資料 |
