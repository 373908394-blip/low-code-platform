-- ============ 注册初始化 RPC：创建租户 + 超管 + 默认数据 ============
CREATE OR REPLACE FUNCTION public.signup_tenant(p_company text, p_name text, p_phone text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_role uuid;
  v_dept uuid;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION '未登录，无法初始化租户'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user) THEN RAISE EXCEPTION '该账号已完成初始化'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE name = p_company) THEN RAISE EXCEPTION '企业名称已存在，请更换'; END IF;

  INSERT INTO public.tenants (name) VALUES (p_company) RETURNING id INTO v_tenant;
  INSERT INTO public.departments (tenant_id, name, parent_id, sort_order) VALUES (v_tenant, '总部', NULL, 0) RETURNING id INTO v_dept;
  INSERT INTO public.profiles (id, tenant_id, name, phone, email, department_id, position, status, is_superadmin)
    VALUES (v_user, v_tenant, p_name, p_phone, (SELECT email FROM auth.users WHERE id = v_user), v_dept, '超级管理员', 'active', true);
  INSERT INTO public.roles (tenant_id, name, description, data_scope, menu_perms, button_perms)
    VALUES (v_tenant, '超级管理员', '拥有全部权限', 'all', '["all"]', '["all"]') RETURNING id INTO v_role;
  INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES (v_tenant, v_user, v_role);
  INSERT INTO public.sys_settings (tenant_id) VALUES (v_tenant);
  RETURN v_tenant;
END $$;

-- ============ 解析审批人 ============
CREATE OR REPLACE FUNCTION public.resolve_approvers(p_node jsonb, p_initiator uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE p_node->>'approver_type'
    WHEN 'user' THEN COALESCE(p_node->'approver_value', '[]'::jsonb)
    WHEN 'role' THEN (
      SELECT COALESCE(jsonb_agg(ur.user_id), '[]'::jsonb)
      FROM public.user_roles ur
      WHERE ur.role_id::text IN (SELECT jsonb_array_elements_text(COALESCE(p_node->'approver_value', '[]'::jsonb)))
    )
    WHEN 'dept_leader' THEN (
      SELECT COALESCE(jsonb_agg(p.id), '[]'::jsonb) FROM (
        SELECT pr.id FROM public.profiles pr
        WHERE pr.department_id = (SELECT department_id FROM public.profiles WHERE id = p_initiator)
          AND pr.id <> p_initiator AND pr.status = 'active'
        ORDER BY pr.created_at LIMIT 1
      ) p
    )
    WHEN 'multi_level_leader' THEN (
      SELECT COALESCE(jsonb_agg(p.id), '[]'::jsonb) FROM (
        SELECT pr.id FROM public.profiles pr
        WHERE pr.department_id = (SELECT department_id FROM public.profiles WHERE id = p_initiator)
          AND pr.id <> p_initiator AND pr.status = 'active'
        ORDER BY pr.created_at LIMIT 2
      ) p
    )
    ELSE COALESCE(p_node->'approver_value', '[]'::jsonb)
  END
$$;

-- ============ 提交单据：生成审批链 ============
CREATE OR REPLACE FUNCTION public.submit_biz(p_biz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_biz record;
  v_wf record;
  v_node jsonb;
  v_approvers jsonb;
  v_first_id uuid;
BEGIN
  SELECT * INTO v_biz FROM public.biz_data WHERE id = p_biz_id;
  IF v_biz.id IS NULL THEN RAISE EXCEPTION '单据不存在'; END IF;
  IF v_biz.created_by <> auth.uid() AND NOT public.is_superadmin() THEN RAISE EXCEPTION '无权提交该单据'; END IF;
  IF v_biz.status <> 'draft' THEN RAISE EXCEPTION '仅草稿状态可提交'; END IF;

  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = v_biz.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_wf.id IS NULL OR v_wf.nodes = '[]'::jsonb THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    RETURN jsonb_build_object('ok', true, 'message', '该表单未配置审批流程，已直接完成');
  END IF;

  DELETE FROM public.biz_approval WHERE biz_id = p_biz_id;

  FOR v_node IN SELECT jsonb_array_elements(v_wf.nodes) LOOP
    IF v_node->>'type' IN ('approval', 'fill') THEN
      v_approvers := public.resolve_approvers(v_node, v_biz.created_by);
      IF v_approvers = '[]'::jsonb THEN
        v_approvers := jsonb_build_array((SELECT pr.id FROM public.profiles pr WHERE pr.tenant_id = v_biz.tenant_id AND pr.is_superadmin LIMIT 1));
      END IF;
      INSERT INTO public.biz_approval (tenant_id, biz_id, form_id, node_name, approver_type, approvers, mode, state, current)
      VALUES (v_biz.tenant_id, p_biz_id, v_biz.form_id, COALESCE(v_node->>'name','审批'), COALESCE(v_node->>'approver_type','user'), v_approvers, COALESCE(v_node->>'mode','or'), 'pending', false);
    END IF;
  END LOOP;

  SELECT id INTO v_first_id FROM public.biz_approval WHERE biz_id = p_biz_id ORDER BY created_at LIMIT 1;
  IF v_first_id IS NULL THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    RETURN jsonb_build_object('ok', true, 'message', '流程未配置审批节点，已直接完成');
  END IF;

  UPDATE public.biz_approval SET current = true WHERE id = v_first_id;
  UPDATE public.biz_data SET status = 'pending', updated_at = now() WHERE id = p_biz_id;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_biz.tenant_id, a::uuid, '你有新的审批任务', COALESCE(v_biz.title, '新单据') || ' 待你审批', 'todo', p_biz_id
  FROM jsonb_array_elements((SELECT approvers FROM public.biz_approval WHERE id = v_first_id)) a;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '提交申请', COALESCE(v_biz.title, p_biz_id::text), jsonb_build_object('biz_id', p_biz_id));

  RETURN jsonb_build_object('ok', true, 'message', '已提交审批');
END $$;

-- ============ 审批动作：通过/驳回 + 流转 ============
CREATE OR REPLACE FUNCTION public.approve_biz(p_biz_id uuid, p_action text, p_comment text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  -- 校验审批人身份
  IF NOT (v_node.approvers ? v_user::text) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user AND v_node.approvers ? ur.role_id::text
  ) THEN RAISE EXCEPTION '你不是该节点的审批人'; END IF;

  -- 幂等：同一用户同一节点不可重复动作
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
  SELECT v_tenant, a::uuid, '你有新的审批任务', COALESCE((SELECT title FROM public.biz_data WHERE id = p_biz_id), '单据') || ' 待你审批', 'todo', p_biz_id
  FROM jsonb_array_elements(v_next.approvers) a;

  RETURN jsonb_build_object('done', true, 'message', '已通过，流转至「' || v_next.node_name || '」');
END $$;

GRANT EXECUTE ON FUNCTION public.signup_tenant(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_biz(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_biz(uuid, text, text) TO authenticated;