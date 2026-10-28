-- 系统审计字段：补充 updated_by 列（创建人/创建时间已有默认值）
ALTER TABLE public.biz_data ADD COLUMN IF NOT EXISTS updated_by uuid DEFAULT auth.uid();

-- 存量数据回填：更新人默认等于创建人
UPDATE public.biz_data SET updated_by = created_by WHERE updated_by IS NULL;

-- 自动维护触发器：任何更新自动记录更新人与更新时间（防客户端伪造/遗漏）
CREATE OR REPLACE FUNCTION public.biz_data_touch_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_biz_data_touch ON public.biz_data;
CREATE TRIGGER trg_biz_data_touch
BEFORE UPDATE ON public.biz_data
FOR EACH ROW EXECUTE FUNCTION public.biz_data_touch_updated();

-- RLS 下 authenticated 可读 updated_by（SELECT 策略已按 tenant 覆盖，无需额外策略）