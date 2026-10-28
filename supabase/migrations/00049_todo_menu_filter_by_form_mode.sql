-- 待办菜单自动创建规则改为按表单模式判定：仅 form_mode='approval' 生成工作台待办事项三级菜单
-- 原逻辑扫描 meta_workflow 审批节点判定，现统一以 meta_forms.form_mode 为准
CREATE OR REPLACE FUNCTION public.ensure_todo_menu(p_form_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_form record;
  v_root uuid;
  v_group uuid;
  v_sort integer;
BEGIN
  SELECT id, name, tenant_id, form_mode INTO v_form FROM public.meta_forms WHERE id = p_form_id;
  IF v_form.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '表单不存在'); END IF;
  IF v_form.tenant_id <> public.get_my_tenant_id() THEN RETURN jsonb_build_object('ok', false, 'message', '无权限'); END IF;

  -- 仅审批表单（form_mode='approval'）自动生成待办菜单；其他模式（normal/state-machine/wizard）移除已有菜单并跳过
  IF v_form.form_mode IS DISTINCT FROM 'approval' THEN
    DELETE FROM public.meta_menu WHERE path LIKE '/todo/' || p_form_id::text || '%';
    RETURN jsonb_build_object('ok', true, 'message', '非审批表单，跳过');
  END IF;

  SELECT id INTO v_root FROM public.meta_menu WHERE parent_id IS NULL AND name = '工作台' AND tenant_id = v_form.tenant_id LIMIT 1;
  IF v_root IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '工作台菜单不存在'); END IF;

  SELECT id INTO v_group FROM public.meta_menu WHERE parent_id = v_root AND name = '待办事项' AND tenant_id = v_form.tenant_id LIMIT 1;
  IF v_group IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '待办事项菜单不存在'); END IF;

  -- 清理该应用旧的待办菜单（含旧的「·待我审批」「·我申请的」两条）
  DELETE FROM public.meta_menu WHERE parent_id = v_group AND path LIKE '/todo/' || p_form_id::text || '%';

  SELECT count(*) + 1 INTO v_sort FROM public.meta_menu WHERE parent_id = v_group;

  -- 生成单条菜单：名称为应用名，页面内含「待我审批」+「我申请的」两部分
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status)
  VALUES (v_form.tenant_id, v_group, v_form.name, 'clipboard', v_sort, 'custom', p_form_id, '/todo/' || p_form_id::text, '["all"]'::jsonb, 'published');

  RETURN jsonb_build_object('ok', true, 'message', '已生成待办菜单');
END $function$;

-- 存量清理：移除指向非审批表单（含已删除表单）的待办叶子菜单
DELETE FROM public.meta_menu
WHERE path LIKE '/todo/%'
  AND (form_id IS NULL OR form_id NOT IN (SELECT id FROM public.meta_forms WHERE form_mode = 'approval'));