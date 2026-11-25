# n8n 主流程

本專案唯一的 workflow：[`main-flow.json`](main-flow.json)。來源是團隊雲端硬碟的 `主流程.json`（2026-11-25 版）。

repo 版本與原檔的差異（流程邏輯與訊息內容未改）：

- 試算表 ID、管理員 LINE userId 換成 `REPLACE_*` 佔位符；移除 credentials、webhook ID 與執行個體資訊。
- `active` 設為 `false`，時區明訂 `Asia/Taipei`。
- 「手動：更新圖文選單」分支的 5 個節點設為停用。它會把 OA 預設選單換成回診選單，蓋掉 `createRichMenus()` 建立的未綁定選單。

## 功能

| 入口 | 內容 |
| --- | --- |
| Webhook `line-webhook` | 查 `Members` 確認身分，依文字或 postback 分流 |
| 回診（`回診管理`、`回診`、`新增回診`、`我的回診`、`action=appt_*`） | 新增、改期、修改、取消 |
| 用藥打卡（`用藥打卡`、`action=med_*`） | 四個時段打卡、10 分鐘內取消、近 7 天紀錄 |
| 每天 09:00／20:00 | 回診前 7／3／1 天提醒；回診當晚提醒記醫囑 |

## 匯入

```bash
node scripts/prepare-n8n-import.js STAGING_SPREADSHEET_ID=<試算表 ID> ADMIN_LINE_USER_ID=<管理員 userId>
```

匯入 `n8n/import/main-flow.json`，再到 n8n 設定 Google Sheets OAuth2 與 LINE Bearer 憑證。

同一份試算表需要這些分頁（缺少時在 Daily GAS 執行 `setupN8nTabs()`）：

| 分頁 | 表頭 |
| --- | --- |
| `Members`、`Families` | 由 Daily GAS 建立 |
| `appointments` | `appt_id,patient_id,date,session,hospital,department,status` |
| `notification_log` | `appt_id,user_id,channel,offset_days,status,sent_at` |
| `med_logs` | `log_id,familyId,date,slot,status,by_lineUid,at` |

LINE webhook 建議走 Render：OA webhook 填 `https://<主機>/line/events`（驗 LINE 簽章），Render 的 `LINE_MAIN_WEBHOOK_URL` 填本流程的 webhook 網址。

## 回診資料

本流程的 `appointments.patient_id` 存 `familyId`（`F_…`），儀表板已配合讀取。Dashboard 的 `APPT_SPREADSHEET_ID` 要填同一份試算表。

## 已知問題（尚未處理）

1. **用藥打卡不會出現在儀表板。** 本流程寫 `med_logs`，儀表板讀 `DailyRecords`。
2. **Webhook 沒有驗證。** 知道網址的人可以偽造事件。可在 Webhook 節點加 Header Auth（`X-Hub-Gateway-Key`，值同 Render 的 `LINE_WEBHOOK_GATEWAY_KEY`），LINE 一律經 Render 轉送。
3. 沒有過濾 `source.type`，群組內的指令也會回覆（可能在群組顯示回診資料）。
4. 多處用 `.first()`，LINE 一次送來多個事件時，只有部分流程能正確處理。
5. `每日記錄`、`健康摘要`、`會員中心` 只回覆「收到…」佔位文字（Rich Menu 的這三顆按鈕直接開 LIFF，手動打字才會遇到）。
6. 未綁定選單的「介紹陪你久久」會得到「尚未找到你的照護家庭資料」。
7. 回診當晚提醒提到「更多 → 記醫囑」，目前沒有這個選單。
