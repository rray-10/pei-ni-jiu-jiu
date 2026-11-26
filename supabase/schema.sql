-- 陪你久久｜Supabase 資料表（第 1 步：設計，尚未執行）
--
-- 原則
-- * Google Sheets 與 GAS 維持現狀，本檔不會改動它們，作為退路。
-- * 欄位名稱改為 snake_case（Sheets 是 camelCase）；Node 端負責對應。
-- * 資料庫只允許 service role（Node 伺服器）存取，RLS 全部開啟且不設 policy，
--   所以前端拿到 anon key 也讀不到任何資料。service role 只放在 Render 環境變數。
-- * 授權一律以 LINE userId（line_uid）查 members，前端傳入的 family_id 不可信。

-- ---------- 家庭與成員 ----------

create table families (
  family_id      text primary key,                  -- F_<hash>，沿用現有格式
  patient_name   text not null,
  note           text,
  birth_year     int,
  conditions     text,
  allergies      text,
  created_for    text not null default 'self' check (created_for in ('self','proxy')),
  deleted_at     timestamptz,                       -- 非空 = 已刪除，可於 3 個月內復原
  deleted_by     text,                              -- 刪除者 line_uid，只有他能復原
  created_at     timestamptz not null default now()
);

-- 一個家庭一位被照護者（沿用 FamilyPatients）
create table family_patients (
  family_id   text primary key references families(family_id) on delete cascade,
  patient_id  text not null unique                  -- P_<hash>
);

-- 授權依據：有這一列才算已綁定
create table members (
  line_uid      text primary key,                   -- LINE userId，一人一家庭
  family_id     text not null references families(family_id) on delete cascade,
  role          text not null check (role in ('admin','member')),
  display_name  text,
  joined_at     timestamptz not null default now()
);
create index members_family_idx on members(family_id);

-- 邀請碼只存雜湊值，24 小時、限用一次
create table family_invites (
  code_hash   text primary key,
  family_id   text not null references families(family_id) on delete cascade,
  expires_at  timestamptz not null,
  claimed_by  text
);

-- 非好友點邀請：先待確認，follow 事件到了才正式綁定（24 小時）
create table pending_links (
  line_uid    text primary key,
  family_id   text not null references families(family_id) on delete cascade,
  role        text not null default 'member' check (role in ('admin','member')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index pending_links_expires_idx on pending_links(expires_at);

-- ---------- 追蹤項目與設定 ----------

create table metric_definitions (
  metric_key   text primary key,                    -- blood_pressure、blood_glucose …
  metric_name  text not null,
  input_type   text not null,                       -- bloodPressure / number / boolean
  unit         text,
  is_active    boolean not null default true
);

create table tracking_settings (
  family_id                  text not null references families(family_id) on delete cascade,
  metric_key                 text not null references metric_definitions(metric_key),
  enabled                    boolean not null,
  metric_name                text,                  -- 自訂項目名稱
  unit                       text,
  alert_low                  numeric,
  alert_high                 numeric,
  systolic_low               numeric,
  systolic_high              numeric,
  diastolic_low              numeric,
  diastolic_high             numeric,
  change_threshold           numeric,
  systolic_change_threshold  numeric,
  diastolic_change_threshold numeric,
  updated_by                 text,
  updated_at                 timestamptz not null default now(),
  primary key (family_id, metric_key)
);

-- ---------- 每日紀錄 ----------

create table daily_records (
  record_id      text primary key,                  -- 沿用 familyId:uid:requestId:metricKey
  family_id      text not null references families(family_id) on delete cascade,
  patient_id     text,
  line_uid       text not null,
  recorded_at    timestamptz not null,
  record_date    date not null,                     -- 台北日曆日
  period         text check (period in ('morning','noon','evening','bedtime')),
  metric_key     text not null,
  metric_name    text,
  value          text,                              -- 原字串，例如 "132/84"
  value_numeric  numeric,
  value_systolic int,
  value_diastolic int,
  unit           text,
  note           text,
  source         text not null default 'LIFF',
  is_recorded    boolean not null default true,
  created_by     text,
  created_at     timestamptz not null default now()
);
-- 儀表板只讀「自己家庭、近 N 天」，這個索引是主要查詢路徑
create index daily_records_family_date_idx on daily_records(family_id, record_date desc);

-- ---------- 回診（n8n 寫入）----------

create table appointments (
  appt_id     text primary key,                     -- APT… 或 webhookEventId 衍生
  patient_id  text not null,                        -- 目前 n8n 寫的是 family_id，之後統一為 patient_id
  family_id   text,
  date        date not null,
  session     text,
  hospital    text,
  department  text,
  status      text not null check (status in ('draft','scheduled','edit_hospital','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index appointments_patient_idx on appointments(patient_id, status, date);

-- 提醒推播紀錄（避免重複發送）
create table notification_log (
  id            bigint generated always as identity primary key,
  appt_id       text not null references appointments(appt_id) on delete cascade,
  user_id       text not null,                      -- LINE userId
  channel       text not null default 'line',
  offset_days   int not null,
  status        text not null check (status in ('sent','failed')),
  sent_at       timestamptz not null default now()
);
create index notification_log_lookup_idx on notification_log(appt_id, user_id, channel, offset_days);

-- ---------- 用藥打卡（n8n 寫入）----------

create table med_logs (
  log_id       text primary key,                    -- <date>|<slot>|<familyId>
  family_id    text not null references families(family_id) on delete cascade,
  log_date     date not null,
  slot         text not null,
  status       text not null check (status in ('taken','cancelled')),
  by_line_uid  text,
  at           timestamptz not null default now()
);
create index med_logs_family_date_idx on med_logs(family_id, log_date desc);

-- ---------- RLS：全部鎖起來，只有 service role 能存取 ----------

alter table families           enable row level security;
alter table family_patients    enable row level security;
alter table members            enable row level security;
alter table family_invites     enable row level security;
alter table pending_links      enable row level security;
alter table metric_definitions enable row level security;
alter table tracking_settings  enable row level security;
alter table daily_records      enable row level security;
alter table appointments       enable row level security;
alter table notification_log   enable row level security;
alter table med_logs           enable row level security;
