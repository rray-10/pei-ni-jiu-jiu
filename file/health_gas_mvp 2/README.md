# 陪你久久｜健康儀表板 GAS MVP

## 安裝
1. 在 https://script.google.com 建立新的 Apps Script 專案。
2. 保留預設 Code.gs 並貼上本資料夾 Code.gs；建立四個 HTML 檔案：Index、Styles、Scripts、PdfTemplate（副檔名由 GAS 自動管理），貼上各自內容。
3. 專案設定時區設為 Asia/Taipei。
4. 在 Apps Script 編輯器選擇 `setupDemoSpreadsheet`，點「執行」並完成 Google 授權。此函式會建立一份新的測試 Google Sheets，並將試算表 ID 寫入 Script Properties。查看執行紀錄取得測試 Sheet 網址。
5. 選擇「部署」→「新增部署」→「網頁應用程式」；執行身分選「我」，存取權限請選僅限自己或受控測試對象，不要公開真實健康資料。
6. 開啟部署後的 `/exec` 網址，測試患者切換、期間、圖表、就診摘要、PDF。
7. 修改程式後，請建立新部署版本或編輯現有部署版本，否則 `/exec` 仍可能是舊版。

## 資料關係
Users(user_id, line_user_id) → PatientMembers(user_id, patient_id, role, status) → Patients(patient_id) → BPRecords / GlucoseRecords / MedicationRecords / Appointments。

## 重要安全限制
**此版是 DEMO，沒有 LINE 登入或真正的存取控制。** `getDemoBootstrap()` 和 `allowed_()` 都使用寫死的測試使用者 `u_demo_01`。因此任何能執行此 GAS Web App 的人都可能讀到該測試使用者可讀取的資料。請勿填入真實健康資料或公開部署給一般使用者。正式版必須由後端驗證 LINE ID Token、建立可信工作階段，並在每次查詢時重新檢查患者權限；不能只靠前端送來的 user_id 或 patient_id。

## LIFF 下一階段
先確認獨立 LIFF App 與 GAS HtmlService 的 iframe / redirect 相容性。LIFF 進入網頁並不會自動讓 GAS 擁有 LINE User ID；需要 LIFF SDK 取得 ID Token，後端驗證並解析使用者身分。若 GAS iframe 限制導致 LIFF 初始化不穩定，改用獨立 HTTPS 前端與受保護的後端 API。

## 已知限制
- 資料全是虛構測試資料。
- 用藥回報率以測試預定回報次數為分母，不代表實際服藥遵從率。
- 血糖圖僅展示原始趨勢；不同量測情境不應混為臨床判斷。
- PDF 使用 GAS HTML-to-PDF 轉換；不同環境中文字型與排版需實測。
- 此版不提供新增／編輯健康紀錄，該功能由其他組員負責。
