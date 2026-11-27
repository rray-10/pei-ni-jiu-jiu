-- 清除舊版假用藥資料（只限示範家庭 F_DEMO0001）。
-- 只有之前執行過舊版 demo_seed_medication.sql 才需要。不會動真實家庭的資料，也不動全域的項目定義。
delete from daily_records     where family_id = 'F_DEMO0001' and metric_key = 'medication';
delete from tracking_settings where family_id = 'F_DEMO0001' and metric_key = 'medication';
