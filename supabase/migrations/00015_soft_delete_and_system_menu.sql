-- 1. 业务数据表新增软删除字段：0 正常，1 已删除
ALTER TABLE public.biz_data ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
CREATE INDEX idx_biz_data_deleted ON public.biz_data(form_id, is_deleted);

-- 2. 菜单表新增系统默认标记：true 表示系统内置菜单，不可删除
ALTER TABLE public.meta_menu ADD COLUMN is_system boolean NOT NULL DEFAULT false;

-- 3. 标记「工作台」「系统设置」一级菜单及其全部下级为系统默认
WITH RECURSIVE
sys_roots AS (
  SELECT id FROM public.meta_menu WHERE parent_id IS NULL AND name IN ('工作台','系统设置')
),
sys_tree AS (
  SELECT id FROM sys_roots
  UNION ALL
  SELECT m.id FROM public.meta_menu m JOIN sys_tree t ON m.parent_id = t.id
)
UPDATE public.meta_menu SET is_system = true WHERE id IN (SELECT id FROM sys_tree);