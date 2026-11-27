-- 檢查資料表是否齊全（應有 schema.sql 的 11 張表，加上 002 的 medications、visits、visit_questions）。
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;

-- 檢查 004 的唯一索引是否已建立（應回傳一筆）。
select indexname from pg_indexes
where tablename = 'medications' and indexname = 'medications_family_name_active_uniq';

-- 列出目前的家庭與藥物（確認測試資料還在；只看名稱，不含 LINE UID）。
select f.family_id, f.patient_name,
       (select count(*) from medications m where m.family_id = f.family_id and m.active) as active_meds,
       (select count(*) from med_logs l where l.family_id = f.family_id) as med_log_rows
from families f where f.deleted_at is null order by f.created_at;
