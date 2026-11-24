# 陪你久久 F1｜GAS LIFF 遷移交接

更新：2026-11-23

## 已建立

- Apps Script 專案：陪你久久 F1 GAS LIFF
- 管理設定頁（測試部署）：`https://script.google.com/macros/s/AKfycbzB3lkQ1zRo0xME8Z9zWKjGZcQgnd78YG_3kpsNA71Mk8crruoFe-pJN6rW16i6MC9Q/exec?page=settings`
- 每日紀錄頁（測試部署）：`https://script.google.com/macros/s/AKfycbzB3lkQ1zRo0xME8Z9zWKjGZcQgnd78YG_3kpsNA71Mk8crruoFe-pJN6rW16i6MC9Q/exec`
- Apps Script 專案編輯：`https://script.google.com/d/1uTXyM58HkwI18CycbjoE5RUDYlYKiKuWHfssZ8OyJianCq8Bj2oWkwHA/edit`
- LIFF ID：`2012665607-zDqqoaya`
- 後端：雲端 n8n F1-A webhook（詳見原始碼設定）

## 頁面設計

每日紀錄頁只有日期、時段、健康輸入、用藥打卡、備註、異常結果與返回 LINE 按鈕。沒有設定入口。

管理設定頁讀取 F1-A API 的最新設定，僅管理者顯示儲存鈕。儲存仍送往 n8n，由 n8n 重新驗證 LINE access token、familyId 與 admin role；前端隱藏按鈕不作為權限控制。

## 實測與限制

1. GAS `/exec` 公開網址能回應 HTTP 200；`?page=settings` 也能載入外層頁面。
2. 以 Chrome 開啟 LIFF URL 後，Apps Script 的 HtmlService 將頁面放在 `script.googleusercontent.com` 沙盒 iframe。LIFF 登入導向在 iframe 內被 `access.line.me` 拒絕，尚未成功取得 token，也未完成管理者/成員或健康紀錄端到端測試。
3. 因登入受阻，正式 LINE Developers 的 LIFF Endpoint 已還原到原 ChatGPT Sites 網址，避免正式使用者被導向無法登入的 GAS 版本。GAS URL 是測試部署，不可視為已完成遷移。
4. 需先解決登入導向限制（例如改用支援頂層導向的 GAS hosting 架構，或保留 LIFF 前端在支援 LIFF 的主機、把 GAS 作為設定入口/資料服務），再更新 LIFF Endpoint 並做 admin/member 真機測試。

## 已知待修問題

- 使用者提供的 GAS 照護小幫手登入後顯示「尚未加入照護家庭」。同一 LINE 身分在雲端 F1-A Members 對應已有家庭/管理者角色，故舊 GAS 專案的家庭查詢來源或欄位 mapping 很可能不同。該部署的 Apps Script 原始專案不在目前 Google 帳號可編輯清單，無法安全直接改其程式。
- 要修舊 GAS 查詢需取得該部署背後的 Apps Script 專案編輯權，或由擁有人將專案分享給 `wangaiden0621@gmail.com`；不是只需要部署 `/exec` 網址。
- 「返回 LINE 官方帳號」在外部瀏覽器無法保證回聊天頁。程式優先呼叫 LIFF `closeWindow()`；若不在 LINE 內，需設定 OA 的 `lineChatUrl`（LINE OA 官方帳號 URL/basic ID 目前未取得）。
- n8n 設定讀取平均約 6–9 秒，原因是三張 Google Sheet 依序讀取。已有平行讀取提案與正式流程備份，但尚未發布該變更，避免未充分驗證即影響工作流。
- LINE 通知/異常推播沒有完成端到端驗收；測試期間未送真實通知。

## 還原方式

LIFF Endpoint 目前仍指向原 ChatGPT Sites，因此回復原狀不需切換。新的 GAS 專案可在 Apps Script 專案中修改/部署，測試成功前不要更改正式 Endpoint。
