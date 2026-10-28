-- ============ 对已有草稿单据发起审批（动作引擎 START_WORKFLOW 使用）============
CREATE OR REPLACE FUNCTION public.start_biz_workflow(p_biz_id uuid)
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
  IF v_biz.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;
  IF v_biz.status <> 'draft' THEN RAISE EXCEPTION '仅草稿状态可发起审批'; END IF;

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
  VALUES (v_biz.tenant_id, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '发起审批', COALESCE(v_biz.title, p_biz_id::text), jsonb_build_object('biz_id', p_biz_id));

  RETURN jsonb_build_object('ok', true, 'message', '已发起审批');
END $$;

GRANT EXECUTE ON FUNCTION public.start_biz_workflow(uuid) TO authenticated;