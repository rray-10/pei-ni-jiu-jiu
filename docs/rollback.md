# 測試環境回復

先在測試 OA 還原 webhook URL 與 Rich Menu 綁定，再將測試 LIFF Endpoint 指向測試前保留的版本。停用測試 n8n 的 LINE 主流程與 F1 relay，檢查沒有啟用排程。若須回到上一測試部署，還原兩個 GAS Web App 版本、Node 版本及同版環境設定。

工作簿在部署前保留表頭與虛構種子資料副本。保留要排查的匿名測試結果後，可將測試表恢復到副本。回診的 `FamilyPatients` 對照與 F1 測試表須與相應 GAS／n8n 設定一起回復。原儀表板檔案可從 `file/health_gas_mvp 2/` 取用。

本次交付只包含本機分支修改。若日後要切換正式環境，先記錄正式 GAS 版本、LIFF Endpoint、OA webhook／Rich Menu、n8n 版本、表格備份，再由負責人授權切換。
