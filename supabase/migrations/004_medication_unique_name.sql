-- 第 4 次變更：同一家庭的啟用中藥物名稱不可重複（忽略大小寫與前後空白）。
-- 在 Supabase SQL Editor 執行這一檔。停用的藥物不受限制，可以重新新增。
create unique index medications_family_name_active_uniq
  on medications (family_id, lower(btrim(name))) where active;
