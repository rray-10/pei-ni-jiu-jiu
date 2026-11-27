-- 第 4 次變更：同一家庭的啟用中藥物名稱不可重複（忽略大小寫與前後空白）。
-- 在 Supabase SQL Editor 執行這一檔（整檔一次執行）。停用的藥物不受限制，可以重新新增。
--
-- 第 1 段：先把重複的啟用藥物停用，保留最早建立的那一筆（不刪除，資料仍可查）。
with ranked as (
  select medication_id,
         row_number() over (partition by family_id, lower(btrim(name)) order by created_at, medication_id) as rn
  from medications
  where active
)
update medications m
set active = false, updated_at = now()
from ranked r
where m.medication_id = r.medication_id and r.rn > 1;

-- 第 2 段：建立唯一索引（前面已處理重複，這裡應該不會失敗）。
create unique index if not exists medications_family_name_active_uniq
  on medications (family_id, lower(btrim(name))) where active;
