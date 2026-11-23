# 資料對照（Data Mapping）

實作位置：`adapters/health-adapter.js`（單一來源；`gas/shared/*.gs` 由 `npm run sync:gas` 產生）。

## 1. 命名對照
| 統一（服務層） | F1 | 儀表板 DEMO | 回診 |
|---|---|---|---|
| familyId | familyId | — | —（待 FamilyPatients） |
| lineUid | lineUid | users.line_user_id | users.line_user_id |
| patientId | （無）→ 預設 `pt_<familyId>` 或 FamilyPatients | patient_id | patient_id |
| 紀錄時間 | recordedAt | measured_at | — |
| 回診日期 | — | scheduled_at | date |

## 2. DailyRecords → 儀表板
| F1 | 儀表板欄位 | 規則 |
|---|---|---|
| metricKey=`blood_pressure`, value=`"132/84"` | `bp[].systolic/diastolic`（BPRecords 取代） | 正規式 `^\d{2,3}\s*[/／]\s*\d{2,3}$`；收縮 50–260、舒張 30–180、收縮>舒張；否則 `bp_out_of_range`／`bp_format` 並排除 |
| `blood_glucose` | `glucose[].value`（mg/dL） | 20–600；`unit` 空白時補 `mg/dL`（`unit_defaulted`） |
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
**差異待確認**：F1 DailyRecords.period 實際值為 `morning`/`evening`；JSON 用 `morning/noon/evening/bedtime`；V2 用 `breakfast/lunch/dinner/bedtime`。建議對照 `morning→breakfast, noon→lunch, evening→dinner`，**尚未套用**（adapter 目前原樣透傳 period）。

## 5. 回診
| 回診 Sheet | 統一 | 規則 |
|---|---|---|
| appt_id / patient_id / date / session / hospital / department | 同名 camelCase | `date` 取前 10 碼 |
| status `scheduled`/`cancelled` | 同 | `cancelled` 不顯示；其他未知值保留原字串、**不視為即將回診** |
| session（`早診` 或 `HH:mm`） | `session` 原樣 | 排序僅用日期；時段不納入排序（待 F3 定義） |
即將回診＝`status=scheduled` 且 `date ≥ 今日(台北)`。儀表板 `scheduled_at` 輸出 `date T00:00:00+08:00` 以相容原前端。

## 6. 家庭 ↔ 患者
優先 `FamilyPatients`；缺省 `pt_<familyId>`。**目前 F001 與回診的 `p001` 無對應資料，必須由組員確認後建立**（例：`F001 → p001`）。
