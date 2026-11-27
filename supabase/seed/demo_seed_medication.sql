-- 假用藥打卡紀錄（測試用）。接在 demo_seed.sql 之後執行。
-- 儀表板「用藥紀錄」讀 med_logs（依時段），不使用每日紀錄的用藥項目，所以這裡不再開啟 medication 追蹤項目。
-- 規則：時段取自啟用中的藥物（早餐後、睡前）；約 10% 的日子標為「取消」，約 10% 漏打卡（不寫入）。
insert into med_logs (log_id,family_id,log_date,slot,status,by_line_uid)
select to_char(d.d,'YYYY-MM-DD')||'|'||s.slot||'|F_DEMO0001','F_DEMO0001',d.d,s.slot,
  case when (extract(day from d.d)::int + s.ord) % 10 = 0 then 'cancelled' else 'taken' end,
  'DEMO-ADMIN-NOT-A-LINE-UID'
from generate_series('2026-10-29'::date,'2026-11-27'::date,'1 day') as d(d)
cross join (values ('早餐後',1),('睡前',2)) as s(slot,ord)
where (extract(day from d.d)::int + s.ord) % 10 <> 5
on conflict (log_id) do nothing;
