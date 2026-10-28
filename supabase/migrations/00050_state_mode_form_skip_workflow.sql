-- 状态机表单（form_mode='state'）提交/发起不走审批流：不查 workflow、不生成审批待办，仅驱动状态机「提交」事件
CREATE OR REPLACE FUNCTION public.submit_biz(p_form_id uuid, p_payload jsonb, p_title text, p_amount numeric, p_submit boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_id uuid;
  v_tenant uuid;
  v_wf record;
  v_tasks jsonb;
  v_first jsonb;
  v_row_id uuid;
  v_init_type text;
  v_init_vals jsonb;
  v_init_ok boolean;
  v_sm_status text;
  v_mode text;
BEGIN
  v_tenant := public.get_my_tenant_id();
  INSERT INTO public.biz_data (tenant_id, form_id, status, title, amount, payload, created_by)
  VALUES (v_tenant, p_form_id, 'draft', p_title, p_amount, COALESCE(p_payload, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  IF NOT p_submit THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已保存草稿');
  END IF;

  -- 状态机表单：不走审批流程（不产生审批待办），仅驱动状态机「提交」事件流转
  SELECT form_mode INTO v_mode FROM public.meta_forms WHERE id = p_form_id;
  IF v_mode = 'state' THEN
    v_sm_status := public.wf_apply_state_machine(v_id, '提交');
    IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    END IF;
    INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
    VALUES (v_tenant, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '提交申请',
            COALESCE(p_title, v_id::text), jsonb_build_object('biz_id', v_id));
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已提交');
  END IF;

  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = p_form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_wf.id IS NULL OR v_wf.nodes = '[]'::jsonb THEN
    v_sm_status := public.wf_apply_state_machine(v_id, '提交');
    IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '该表单未配置审批流程，已直接完成');
  END IF;

  -- 发起人范围校验（按人员/按部门/按角色）
  v_init_type := v_wf.settings->'initiatorConfig'->>'type';
  v_init_vals := COALESCE(v_wf.settings->'initiatorConfig'->'value', '[]'::jsonb);
  IF v_init_type IN ('user','dept','role') AND jsonb_typeof(v_init_vals) = 'array' AND jsonb_array_length(v_init_vals) > 0 THEN
    v_init_ok := false;
    IF v_init_type = 'user' THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_init_vals) x WHERE x = auth.uid()::text) INTO v_init_ok;
    ELSIF v_init_type = 'dept' THEN
      SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_init_vals) x
                      WHERE x = (SELECT department_id::text FROM public.profiles WHERE id = auth.uid())) INTO v_init_ok;
    ELSIF v_init_type = 'role' THEN
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                        AND ur.role_id::text IN (SELECT jsonb_array_elements_text(v_init_vals))) INTO v_init_ok;
    END IF;
    IF NOT v_init_ok THEN RAISE EXCEPTION '你不在该流程的允许发起人范围内'; END IF;
  END IF;

  -- 按条件分支确定首个任务节点
  v_tasks := public.wf_after_position(v_wf.nodes, NULL, COALESCE(p_payload, '{}'::jsonb));
  IF v_tasks IS NULL OR jsonb_array_length(v_tasks) = 0 THEN
    v_sm_status := public.wf_apply_state_machine(v_id, '提交');
    IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '流程未配置审批节点，已直接完成');
  END IF;

  v_first := v_tasks->0;
  v_row_id := public.wf_create_task_row(v_tenant, v_id, p_form_id, v_first, auth.uid(), true);

  -- 驱动状态机「提交」事件，未配置时回退 pending
  v_sm_status := public.wf_apply_state_machine(v_id, '提交');
  IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
    UPDATE public.biz_data SET status = 'pending', updated_at = now() WHERE id = v_id;
  END IF;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_tenant, (a #>> '{}')::uuid,
         CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN '你有新的填写任务' ELSE '你有新的审批任务' END,
         COALESCE(p_title, '新单据') || CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', v_id
  FROM jsonb_array_elements((SELECT approvers FROM public.biz_approval WHERE id = v_row_id)) a;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_tenant, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '提交申请',
          COALESCE(p_title, v_id::text), jsonb_build_object('biz_id', v_id));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已提交审批');
END $function$;

CREATE OR REPLACE FUNCTION public.start_biz_workflow(p_biz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_biz record;
  v_wf record;
  v_tasks jsonb;
  v_first jsonb;
  v_row_id uuid;
  v_init_type text;
  v_init_vals jsonb;
  v_init_ok boolean;
  v_sm_status text;
  v_mode text;
BEGIN
  SELECT * INTO v_biz FROM public.biz_data WHERE id = p_biz_id;
  IF v_biz.id IS NULL THEN RAISE EXCEPTION '单据不存在'; END IF;
  IF v_biz.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;
  IF v_biz.status NOT IN ('draft', 'rejected') THEN RAISE EXCEPTION '仅草稿或已驳回状态可发起审批'; END IF;

  -- 状态机表单：不走审批流程（不产生审批待办），仅驱动状态机「提交」事件流转
  SELECT form_mode INTO v_mode FROM public.meta_forms WHERE id = v_biz.form_id;
  IF v_mode = 'state' THEN
    v_sm_status := public.wf_apply_state_machine(p_biz_id, '提交');
    IF v_sm_status IS NULL OR v_sm_status = 'draft' THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'message', '已提交');
  END IF;

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
END $function$;