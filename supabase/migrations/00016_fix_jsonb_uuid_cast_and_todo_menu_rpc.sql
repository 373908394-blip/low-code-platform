-- 修复 submit_biz 中 jsonb 元素直接 cast 为 uuid 的错误（cannot cast type jsonb to uuid）
CREATE OR REPLACE FUNCTION public.submit_biz(p_form_id uuid, p_payload jsonb, p_title text, p_amount numeric, p_submit boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_tenant uuid;
  v_biz record;
  v_wf record;
  v_node jsonb;
  v_approvers jsonb;
  v_first_id uuid;
BEGIN
  v_tenant := public.get_my_tenant_id();
  INSERT INTO public.biz_data (tenant_id, form_id, status, title, amount, payload, created_by)
  VALUES (v_tenant, p_form_id, 'draft', p_title, p_amount, COALESCE(p_payload, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  IF NOT p_submit THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已保存草稿');
  END IF;

  SELECT * INTO v_biz FROM public.biz_data WHERE id = v_id;

  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = v_biz.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_wf.id IS NULL OR v_wf.nodes = '[]'::jsonb THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '该表单未配置审批流程，已直接完成');
  END IF;

  FOR v_node IN SELECT jsonb_array_elements(v_wf.nodes) LOOP
    IF v_node->>'type' IN ('approval', 'fill') THEN
      v_approvers := public.resolve_approvers(v_node, v_biz.created_by);
      IF v_approvers = '[]'::jsonb THEN
        v_approvers := jsonb_build_array((SELECT pr.id FROM public.profiles pr WHERE pr.tenant_id = v_biz.tenant_id AND pr.is_superadmin LIMIT 1));
      END IF;
      INSERT INTO public.biz_approval (tenant_id, biz_id, form_id, node_name, approver_type, approvers, mode, state, current)
      VALUES (v_biz.tenant_id, v_id, v_biz.form_id, COALESCE(v_node->>'name','审批'), COALESCE(v_node->>'approver_type','user'), v_approvers, COALESCE(v_node->>'mode','or'), 'pending', false);
    END IF;
  END LOOP;

  SELECT id INTO v_first_id FROM public.biz_approval WHERE biz_id = v_id ORDER BY created_at LIMIT 1;
  IF v_first_id IS NULL THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '流程未配置审批节点，已直接完成');
  END IF;

  UPDATE public.biz_approval SET current = true WHERE id = v_first_id;
  UPDATE public.biz_data SET status = 'pending', updated_at = now() WHERE id = v_id;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_biz.tenant_id, (a #>> '{}')::uuid, '你有新的审批任务', COALESCE(v_biz.title, '新单据') || ' 待你审批', 'todo', v_id
  FROM jsonb_array_elements((SELECT approvers FROM public.biz_approval WHERE id = v_first_id)) a;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '提交申请', COALESCE(v_biz.title, v_id::text), jsonb_build_object('biz_id', v_id));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已提交审批');
END $function$;

-- 修复 approve_biz 中同样的 jsonb->uuid cast 错误
CREATE OR REPLACE FUNCTION public.approve_biz(p_biz_id uuid, p_action text, p_comment text DEFAULT ''::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_node record;
  v_acts jsonb;
  v_next record;
  v_all_approved boolean;
  v_already boolean;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN RAISE EXCEPTION '无效的审批动作'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.biz_data WHERE id = p_biz_id;
  IF v_tenant IS NULL OR v_tenant <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;

  SELECT * INTO v_node FROM public.biz_approval
   WHERE biz_id = p_biz_id AND state = 'pending' AND current = true
   ORDER BY created_at LIMIT 1;
  IF v_node.id IS NULL THEN RAISE EXCEPTION '该单据没有待审批节点'; END IF;

  IF NOT (v_node.approvers ? v_user::text) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user AND v_node.approvers ? ur.role_id::text
  ) THEN RAISE EXCEPTION '你不是该节点的审批人'; END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_node.acts) act WHERE act->>'user_id' = v_user::text) INTO v_already;
  IF v_already THEN RAISE EXCEPTION '你已在该节点操作过'; END IF;

  v_acts := v_node.acts || jsonb_build_array(jsonb_build_object(
    'user_id', v_user,
    'user_name', (SELECT name FROM public.profiles WHERE id = v_user),
    'action', p_action, 'comment', p_comment, 'at', now()
  ));

  IF v_node.mode = 'countersign' AND p_action = 'approve' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_node.approvers) a
      WHERE a::text NOT IN (SELECT act->>'user_id' FROM jsonb_array_elements(v_acts) act WHERE act->>'action' = 'approve')
    ) INTO v_all_approved;
    IF NOT v_all_approved THEN
      UPDATE public.biz_approval SET acts = v_acts WHERE id = v_node.id;
      RETURN jsonb_build_object('done', false, 'message', '已同意，等待其他会签人');
    END IF;
  END IF;

  UPDATE public.biz_approval
     SET state = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
         acts = v_acts, current = false
   WHERE id = v_node.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_tenant, v_user, (SELECT name FROM public.profiles WHERE id = v_user),
          CASE WHEN p_action = 'approve' THEN '审批通过' ELSE '审批驳回' END,
          COALESCE((SELECT title FROM public.biz_data WHERE id = p_biz_id), p_biz_id::text),
          jsonb_build_object('node', v_node.node_name, 'comment', p_comment));

  IF p_action = 'reject' THEN
    UPDATE public.biz_data SET status = 'rejected', updated_at = now() WHERE id = p_biz_id;
    UPDATE public.biz_approval SET state = 'skipped', current = false WHERE biz_id = p_biz_id AND state = 'pending';
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    SELECT v_tenant, b.created_by, '你的申请已被驳回', '节点「' || v_node.node_name || '」驳回了申请' || CASE WHEN p_comment <> '' THEN '：' || p_comment ELSE '' END, 'info', p_biz_id
    FROM public.biz_data b WHERE b.id = p_biz_id;
    RETURN jsonb_build_object('done', true, 'message', '已驳回');
  END IF;

  SELECT * INTO v_next FROM public.biz_approval
   WHERE biz_id = p_biz_id AND state = 'pending'
   ORDER BY created_at LIMIT 1;

  IF v_next.id IS NULL THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    SELECT v_tenant, b.created_by, '你的申请已全部通过', '所有审批节点均已通过', 'info', p_biz_id
    FROM public.biz_data b WHERE b.id = p_biz_id;
    RETURN jsonb_build_object('done', true, 'message', '已通过，流程结束');
  END IF;

  UPDATE public.biz_approval SET current = true WHERE id = v_next.id;
  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_tenant, (a #>> '{}')::uuid, '你有新的审批任务', COALESCE((SELECT title FROM public.biz_data WHERE id = p_biz_id), '单据') || ' 待你审批', 'todo', p_biz_id
  FROM jsonb_array_elements(v_next.approvers) a;

  RETURN jsonb_build_object('done', true, 'message', '已通过，流转至「' || v_next.node_name || '」');
END $function$;

-- 新增 SECURITY DEFINER 函数：发布含审批流程的表单后，在工作台-待办事项下自动生成双菜单（绕过 RLS）
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
    FOR v_node IN SELECT jsonb_array_elements(v_nodes) LOOP
      IF v_node->>'type' = 'approval' THEN v_has_approval := true; END IF;
    END LOOP;
  END IF;
  IF NOT v_has_approval THEN RETURN jsonb_build_object('ok', true, 'message', '无审批节点，跳过'); END IF;

  SELECT id INTO v_root FROM public.meta_menu WHERE parent_id IS NULL AND name = '工作台' AND tenant_id = v_form.tenant_id LIMIT 1;
  IF v_root IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '工作台菜单不存在'); END IF;

  SELECT id INTO v_group FROM public.meta_menu WHERE parent_id = v_root AND name = '待办事项' AND tenant_id = v_form.tenant_id LIMIT 1;
  IF v_group IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', '待办事项菜单不存在'); END IF;

  DELETE FROM public.meta_menu WHERE parent_id = v_group AND path LIKE '/todo/' || p_form_id::text || '%';

  SELECT count(*) + 1 INTO v_sort FROM public.meta_menu WHERE parent_id = v_group;

  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status)
  VALUES (v_form.tenant_id, v_group, v_form.name || '·待我审批', 'clipboard', v_sort, 'custom', p_form_id, '/todo/' || p_form_id::text || '/pending', '["all"]'::jsonb, 'published');
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status)
  VALUES (v_form.tenant_id, v_group, v_form.name || '·我申请的', 'clipboard', v_sort + 1, 'custom', p_form_id, '/todo/' || p_form_id::text || '/submitted', '["all"]'::jsonb, 'published');

  RETURN jsonb_build_object('ok', true, 'message', '已生成待办菜单');
END $function$;