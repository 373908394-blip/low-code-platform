-- 全系统默认品牌文字由「云枢」改为「沐沐」
-- 1) sys_settings.system_name 列默认值
ALTER TABLE public.sys_settings ALTER COLUMN system_name SET DEFAULT '沐沐';

-- 2) 演示租户名称
UPDATE public.tenants SET name = '沐沐演示科技有限公司' WHERE id = '00000000-0000-0000-0000-000000000001';

-- 3) 已将默认系统名显式存为旧值的行，同步刷新为「沐沐」（通常为演示租户）
UPDATE public.sys_settings SET system_name = '沐沐' WHERE system_name = '云枢低代码';