-- v58: 消除 approve_biz 重载歧义，删除带 p_data 的 4 参数重载，仅保留 3 参数版本
DROP FUNCTION IF EXISTS public.approve_biz(uuid, text, text, jsonb);