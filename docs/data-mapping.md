# 資料對照（Data Mapping）

目前部署與資料歸屬見 [整合決策與團隊更新](integration-audit.md)。

實作位置：`adapters/health-adapter.js`（單一來源；`gas/dashboard/*.gs` 由 `npm run sync:gas` 產生）。

## 1. 命名對照
| 統一（服務層） | F1 | 儀表板 DEMO | 回診 |
|---|---|---|---|
| familyId | familyId | — | —（待 FamilyPatients） |
| lineUid | lineUid | users.line_user_id | users.line_user_id |
| patientId | FamilyPatients.patientId | patient_id | patient_id |
| 紀錄時間 | recordedAt | measured_at | — |
| 回診日期 | — | scheduled_at | date |

## 2. DailyRecords → 儀表板
| F1 | 儀表板欄位 | 規則 |
|---|---|---|
| metricKey=`blood_pressure`, value=`"132/84"` | `bp[].systolic/diastolic`（BPRecords 取代） | 數字分欄優先，字串備援正規式 `^\d{2,3}\s*[/／]\s*\d{2,3}$`；收縮 50–260、舒張 30–180、收縮>舒張；否則 `bp_out_of_range`／`bp_format` 並排除 |
| `blood_glucose` | `glucose[].value`（mg/dL） | 優先讀 `valueNumeric`。空單位預設 mg/dL，mmol/L 乘 18.0182，未知單位排除。轉為 mg/dL 後以現行 20–600 範圍檢查。 |
| `medication` TRUE/FALSE | `medication.taken/total` | 一列＝1 次回報 |
| `medication` JSON `{"morning":true,...}` | 同上 | 每個 boolean 鍵＝1 次回報 |
| `temperature/weight/spo2/custom_*` | 暫不顯示於儀表板 | 已由 adapter 解析（`value`） |
| `source=TEST` 或 `isRecorded=FALSE` | 排除 | 計入 `quality.excludedTest` |
| `lineUid/createdBy` | **不輸出** | 防身分外洩 |

**用藥回報率 ≠ 服藥遵從率**：分母是「已回報次數」（TRUE+FALSE），不是 Medications 的預定次數（F1 沒有藥物表）。與原 DEMO 的分母定義不同，已於 UI 註記保留。

## 3. 時間
- 業務日＝台北日曆日。`recordDate` 空白 → 由 `recordedAt`（UTC）+8h 推導。
- 窗口：`today-(days-1) ≤ recordDate ≤ today`。

## 4. 用藥打卡時段（V2 F2）
`periodForTaipei()`：00:00–04:59→前一天 bedtime；05:00–10:59 breakfast；11:00–16:59 lunch；17:00–20:59 dinner；21:00–23:59 bedtime。
**差異待確認**：F1 表單使用 `morning/noon/evening/bedtime`；V2 用 `breakfast/lunch/dinner/bedtime`。建議對照 `morning→breakfast, noon→lunch, evening→dinner`，**尚未套用**（adapter 目前原樣透傳 period）。

## 5. 回診
| 回診 Sheet | 統一 | 規則 |
|---|---|---|
| appt_id / patient_id / date / session / hospital / department | 同名 camelCase | 支援日期字串、Sheets 日期序號與 GAS 轉換後的日期 |
| status `scheduled`/`cancelled` | 同 | `edit_hospital` 保留即將回診狀態。取消與草稿排除。 |
| session（`早診` 或 `HH:mm`） | `session` 原樣 | 排序僅用日期；時段不納入排序（待 F3 定義） |
即將回診＝`status=scheduled` 且 `date ≥ 今日(台北)`。儀表板 `scheduled_at` 輸出 `date T00:00:00+08:00` 以相容原前端。

## 6. 家庭 ↔ 患者
由 `FamilyPatients` 取得，缺漏時應先處理家庭對照。只有建立明確且唯一的 `FamilyPatients` 連結才允許讀取 F3 回診。組員依核對後的名冊建立。
