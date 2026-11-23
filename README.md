# 陪你久久｜Integration Hub

整合 LINE 登入／家庭、每日紀錄(F1)、健康儀表板、回診(F3) 的整合專案。短期：GAS/LIFF + Google Sheets + n8n；長期評估 Supabase。

**先讀：** [`docs/integration-audit.md`](docs/integration-audit.md)（現況與 BLOCKED 項）· [`docs/open-issues.md`](docs/open-issues.md)（需組員提供／決策）· [`docs/test-report.md`](docs/test-report.md)

## 結構
```
adapters/   單一來源的轉換與授權邏輯（Node 測試、GAS 共用）
gas/dashboard/  整合版儀表板（Code.gs、Index/Scripts/Styles/Nav*、PdfTemplate）；original-demo/ 為原樣備份
gas/shared/     由 adapters 產生的 .gs（npm run sync:gas）
gas/member/ n8n/*/ frontend/   預留（尚無原始碼／JSON）
docs/ tests/ scripts/
```

## 開發與測試
```bash
npm run sync:gas   # 修改 adapters 後必做
npm test           # 單元＋整合＋(有 playwright 時)畫面測試
```
畫面測試需要全域 playwright：`NODE_PATH=$(npm root -g) npm test`；沒有則自動略過。

## 部署到「新的」GAS 測試專案（不要覆蓋既有 /exec）
1. 新建 Apps Script 專案，時區 Asia/Taipei，貼入 `appsscript.json`（顯示於專案設定）。
2. 檔案：`gas/dashboard/*.gs|*.html` 與 `gas/shared/*.gs` 全部（不含 `original-demo/`）。HTML 檔在 GAS 中不含副檔名：`Index`、`Styles`、`Scripts`、`NavStyles`、`NavScripts`、`PdfTemplate`。
3. Script Properties 依 `.env.example` 設定。第一次測試可用 `DEV_AUTH_ENABLED=true` + 虛構 `DEV_LINE_UID`（只放在私人部署）。
4. 在 F1 Sheet 新增 `FamilyPatients(familyId, patientId)`（**需先經組員確認並備份**，見 `docs/migration-plan.md`）。
5. 部署 Web App（執行身分：我）。正式前：`DEV_AUTH_ENABLED=false`，設好 `LINE_LOGIN_CHANNEL_ID`、`LIFF_ID`，從 LINE 開啟實測。
回復流程：[`docs/rollback.md`](docs/rollback.md)。

## 安全
不得提交密鑰、真實患者資料、n8n credentials；見 [`docs/security.md`](docs/security.md)。
