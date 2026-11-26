-- 第 2 次變更：藥物清單、問醫師的問題、醫囑（就診紀錄）
-- 在 Supabase SQL Editor 只執行這一檔，不要重跑 schema.sql。

-- ---------- 藥物清單（綁定時或之後由管理者設定）----------
create table medications (
  medication_id       text primary key,                                   -- M_<隨機>
  family_id           text not null references families(family_id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 60),
  dose                text check (char_length(dose) <= 60),              -- 例：10mg、1 顆
  schedule_per_day    int  not null default 1 check (schedule_per_day between 1 and 6),
  times               text check (char_length(times) <= 60),             -- 例：早上、晚上
  note                text check (char_length(note) <= 200),
  active              boolean not null default true,                     -- 停用不刪除，保留歷史
  created_by          text,                                              -- line_uid
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index medications_family_active_idx on medications(family_id, active);

-- ---------- 醫囑與就診紀錄（回診結束後寫入）----------
create table visits (
  visit_id      text primary key,                                        -- V_<隨機>
  family_id     text not null references families(family_id) on delete cascade,
  visit_date    date not null,                                           -- 台北日曆日
  hospital      text check (char_length(hospital) <= 60),
  department    text check (char_length(department) <= 60),
  doctor_notes  text check (char_length(doctor_notes) <= 2000),          -- 醫囑
  source        text not null default 'manual' check (source in ('manual','n8n')),
  appt_id       text,                                                    -- 若由回診紀錄產生
  created_by    text,
  created_at    timestamptz not null default now()
);
create index visits_family_date_idx on visits(family_id, visit_date desc);

-- ---------- 問醫師的問題（家人隨時新增，可掛在某次就診）----------
create table visit_questions (
  question_id   text primary key,                                        -- Q_<隨機>
  family_id     text not null references families(family_id) on delete cascade,
  question      text not null check (char_length(question) between 1 and 300),
  visit_id      text references visits(visit_id) on delete set null,     -- 未掛在任何一次就診時為空
  resolved_at   timestamptz,                                             -- 已在診間問過就填入
  created_by    text,
  created_at    timestamptz not null default now()
);
create index visit_questions_family_idx on visit_questions(family_id, resolved_at);

-- ---------- RLS：和其他表相同，只有 service role 能存取 ----------
alter table medications     enable row level security;
alter table visits          enable row level security;
alter table visit_questions enable row level security;
