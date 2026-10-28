-- v57: 待办事项三级菜单改为「发布审批应用名」单条菜单，页面内含「待我审批」+「我申请的」两部分

CREATE OR REPLACE FUNCTION public.ensure_todo_menu(p_form_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_form record;
  v_nodes jsonb;
  v_has_approval boolean := false;
  v_root uuid;
  v_group uuid;
  v_sort integer;
  v_node jsonb;
BEGIN
  SELECT id, name, tenant_id INTO v_form FROM public.meta_forms WHERE id = p_form_id;
  IF v_form.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '表单不存在'); END IF;
  IF v_form.tenant_id <> public.get_my_tenant_id() THEN RETURN jsonb_build_object('ok', false, 'message', '无权限'); END IF;

  SELECT nodes INTO v_nodes FROM public.meta_workflow WHERE form_id = p_form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_nodes IS NOT NULL THEN
    FOR v_node IN SELECT el FROM jsonb_array_elements(v_nodes) AS el LOOP
      IF v_node->>'type' = 'approval' THEN v_has_approval := true; END IF;
    END LOOP;
  END IF;
  IF NOT v_has_approval THEN RETURN jsonb_build_object('ok', true, 'message', '无审批节点，跳过'); END IF;

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

-- 一次性清理并重建存量已发布审批应用的待办菜单为单条
DO $$
DECLARE
  g record;
  f record;
  v_sort integer;
BEGIN
  FOR g IN
    SELECT m.id, m.tenant_id
    FROM public.meta_menu m
    JOIN public.meta_menu root ON root.id = m.parent_id AND root.name = '工作台' AND root.tenant_id = m.tenant_id
    WHERE m.name = '待办事项'
  LOOP
    DELETE FROM public.meta_menu WHERE parent_id = g.id;
    FOR f IN
      SELECT mf.id, mf.name
      FROM public.meta_forms mf
      WHERE mf.tenant_id = g.tenant_id AND mf.status = 'published'
        AND EXISTS (
          SELECT 1 FROM public.meta_workflow w WHERE w.form_id = mf.id
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.nodes) n WHERE n->>'type' = 'approval')
        )
    LOOP
      SELECT count(*) + 1 INTO v_sort FROM public.meta_menu WHERE parent_id = g.id;
      INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status)
      VALUES (g.tenant_id, g.id, f.name, 'clipboard', v_sort, 'custom', f.id, '/todo/' || f.id::text, '["all"]'::jsonb, 'published');
    END LOOP;
  END LOOP;
END $$;