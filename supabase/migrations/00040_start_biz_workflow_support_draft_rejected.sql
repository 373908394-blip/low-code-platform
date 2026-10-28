-- start_biz_workflow：草稿与驳回状态均可发起审批（驳回重提时清空旧审批节点重新走流程）
CREATE OR REPLACE FUNCTION public.start_biz_workflow(p_biz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_biz record;
  v_wf record;
  v_tasks jsonb;
  v_first jsonb;
  v_row_id uuid;
  v_init_type text;
  v_init_vals jsonb;
  v_init_ok boolean;
BEGIN
  SELECT * INTO v_biz FROM public.biz_data WHERE id = p_biz_id;
  IF v_biz.id IS NULL THEN RAISE EXCEPTION '单据不存在'; END IF;
  IF v_biz.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;
  IF v_biz.status NOT IN ('draft', 'rejected') THEN RAISE EXCEPTION '仅草稿或已驳回状态可发起审批'; END IF;

  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = v_biz.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_wf.id IS NULL OR v_wf.nodes = '[]'::jsonb THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    RETURN jsonb_build_object('ok', true, 'message', '该表单未配置审批流程，已直接完成');
  END IF;

  v_init_type := v_wf.settings->'initiatorConfig'->>'type';
  v_init_vals := COALESCE(v_wf.settings->'initiatorConfig'->'value', '[]'::jsonb);
  IF v_init_type IN ('user','dept','role') AND jsonb_typeof(v_init_vals) = 'array' AND jsonb_array_length(v_init_vals) > 0 THEN
    v_init_ok := false;
    IF v_init_type = 'user' THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_init_vals) x WHERE x = v_biz.created_by::text) INTO v_init_ok;
    ELSIF v_init_type = 'dept' THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_init_vals) x
                      WHERE x = (SELECT department_id::text FROM public.profiles WHERE id = v_biz.created_by)) INTO v_init_ok;
    ELSIF v_init_type = 'role' THEN
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = v_biz.created_by
                        AND ur.role_id::text IN (SELECT jsonb_array_elements_text(v_init_vals))) INTO v_init_ok;
    END IF;
    IF NOT v_init_ok THEN RAISE EXCEPTION '你不在该流程的允许发起人范围内'; END IF;
  END IF;

  -- 清空旧审批节点（驳回重提场景），重新创建首个任务
  DELETE FROM public.biz_approval WHERE biz_id = p_biz_id;

  v_tasks := public.wf_after_position(v_wf.nodes, NULL, COALESCE(v_biz.payload, '{}'::jsonb));
  IF v_tasks IS NULL OR jsonb_array_length(v_tasks) = 0 THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    RETURN jsonb_build_object('ok', true, 'message', '流程未配置审批节点，已直接完成');
  END IF;

  v_first := v_tasks->0;
  v_row_id := public.wf_create_task_row(v_biz.tenant_id, p_biz_id, v_biz.form_id, v_first, v_biz.created_by, true);
  UPDATE public.biz_data SET status = 'pending', updated_at = now() WHERE id = p_biz_id;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_biz.tenant_id, (a #>> '{}')::uuid,
         CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN '你有新的填写任务' ELSE '你有新的审批任务' END,
         COALESCE(v_biz.title, '单据') || CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', p_biz_id
  FROM jsonb_array_elements((SELECT approvers FROM public.biz_approval WHERE id = v_row_id)) a;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '发起审批',
          COALESCE(v_biz.title, p_biz_id::text), jsonb_build_object('biz_id', p_biz_id));

  RETURN jsonb_build_object('ok', true, 'message', '已发起审批');
END $$;