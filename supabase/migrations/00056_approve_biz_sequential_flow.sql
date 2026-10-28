CREATE OR REPLACE FUNCTION public.approve_biz(p_biz_id uuid, p_action text, p_comment text DEFAULT ''::text, p_data jsonb DEFAULT '{}'::jsonb, p_changes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_node record;
  v_acts jsonb;
  v_next record;
  v_all_approved boolean;
  v_already boolean;
  v_wf record;
  v_tasks jsonb;
  v_next_node jsonb;
  v_next_id uuid;
  v_has_next boolean := false;
  v_payload jsonb;
  v_creator uuid;
  v_data jsonb := '{}'::jsonb;
  v_key text;
  v_old_status text;
  v_sm_status text;
  v_current_turn text;
  v_next_turn text;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN RAISE EXCEPTION '无效的审批动作'; END IF;
  IF p_action = 'reject' AND btrim(COALESCE(p_comment, '')) = '' THEN RAISE EXCEPTION '驳回必须填写理由'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.biz_data WHERE id = p_biz_id;
  IF v_tenant IS NULL OR v_tenant <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;

  SELECT * INTO v_node FROM public.biz_approval
   WHERE biz_id = p_biz_id AND state = 'pending' AND current = true
   ORDER BY created_at LIMIT 1;
  IF v_node.id IS NULL THEN RAISE EXCEPTION '该单据没有待审批节点'; END IF;
  IF COALESCE(v_node.node_type, 'approval') = 'fill' THEN RAISE EXCEPTION '当前节点为填写节点，请完成填写确认'; END IF;

  IF NOT (v_node.approvers ? v_user::text) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user AND v_node.approvers ? ur.role_id::text
  ) THEN RAISE EXCEPTION '你不是该节点的审批人'; END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_node.acts, '[]'::jsonb)) act WHERE act->>'user_id' = v_user::text) INTO v_already;
  IF v_already THEN RAISE EXCEPTION '你已在该节点操作过'; END IF;

  -- 依次审批：仅当前轮到的人（审批人顺序中首位未通过者）可操作，保证逐人排队
  IF v_node.mode = 'sequential' THEN
    SELECT t.a INTO v_current_turn
      FROM jsonb_array_elements_text(v_node.approvers) WITH ORDINALITY AS t(a, ord)
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(v_node.acts, '[]'::jsonb)) act
        WHERE act->>'action' = 'approve' AND act->>'user_id' = t.a
     )
     ORDER BY t.ord LIMIT 1;
    IF v_current_turn IS NULL OR v_current_turn <> v_user::text THEN
      RAISE EXCEPTION '当前未轮到你审批';
    END IF;
  END IF;

  -- 审批通过：合并可编辑字段值（剔除系统字段，防客户端伪造）
  IF p_action = 'approve' AND jsonb_typeof(COALESCE(p_data, '{}'::jsonb)) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) LOOP
      IF v_key NOT IN ('created_by','created_at','updated_by','updated_at','user_name','dept_name','position','status') THEN
        v_data := v_data || jsonb_build_object(v_key, COALESCE(p_data, '{}'::jsonb) -> v_key);
      END IF;
    END LOOP;
    IF v_data <> '{}'::jsonb THEN
      UPDATE public.biz_data
         SET payload = COALESCE(payload, '{}'::jsonb) || v_data, updated_at = now(), updated_by = v_user
       WHERE id = p_biz_id;
    END IF;
  END IF;

  v_acts := COALESCE(v_node.acts, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'user_id', v_user,
    'user_name', (SELECT name FROM public.profiles WHERE id = v_user),
    'action', p_action, 'comment', p_comment, 'at', now(),
    'changes', COALESCE(p_changes, '[]'::jsonb)
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

  IF v_node.mode = 'sequential' AND p_action = 'approve' THEN
    -- 通过后仍有下一位未处理：节点不推进，待办轮转给下一人并发送通知
    SELECT t.a INTO v_next_turn
      FROM jsonb_array_elements_text(v_node.approvers) WITH ORDINALITY AS t(a, ord)
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_acts) act
        WHERE act->>'action' = 'approve' AND act->>'user_id' = t.a
     )
     ORDER BY t.ord LIMIT 1;
    IF v_next_turn IS NOT NULL THEN
      UPDATE public.biz_approval SET acts = v_acts WHERE id = v_node.id;
      INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
      VALUES (v_tenant, v_next_turn::uuid, '你有新的审批任务',
              COALESCE((SELECT title FROM public.biz_data WHERE id = p_biz_id), '单据') || ' 待你审批（依次审批）', 'todo', p_biz_id);
      RETURN jsonb_build_object('done', false, 'message', '已同意，已流转给下一位审批人');
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
    -- 驳回：驱动状态机「驳回」事件，未定义时兜底 rejected
    v_old_status := (SELECT status FROM public.biz_data WHERE id = p_biz_id);
    v_sm_status := public.wf_apply_state_machine(p_biz_id, '驳回');
    IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
      UPDATE public.biz_data SET status = 'rejected', updated_at = now() WHERE id = p_biz_id;
    END IF;

    UPDATE public.biz_approval SET state = 'skipped', current = false WHERE biz_id = p_biz_id AND state = 'pending';
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    SELECT v_tenant, b.created_by, '你的申请已被驳回', '节点「' || v_node.node_name || '」驳回了申请：' || p_comment, 'info', p_biz_id
    FROM public.biz_data b WHERE b.id = p_biz_id;
    RETURN jsonb_build_object('done', true, 'message', '已驳回');
  END IF;

  -- 审批通过：推进流程计算下一任务
  SELECT payload, created_by, status INTO v_payload, v_creator, v_old_status FROM public.biz_data WHERE id = p_biz_id;
  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = (SELECT form_id FROM public.biz_data WHERE id = p_biz_id) ORDER BY updated_at DESC LIMIT 1;

  IF v_node.node_id IS NOT NULL AND v_wf.id IS NOT NULL THEN
    v_tasks := public.wf_after_position(v_wf.nodes, v_node.node_id, v_payload);
    DELETE FROM public.biz_approval WHERE biz_id = p_biz_id AND state = 'pending' AND current = false;
    IF v_tasks IS NOT NULL AND jsonb_array_length(v_tasks) > 0 THEN
      v_next_node := v_tasks->0;
      v_next_id := public.wf_create_task_row(v_tenant, p_biz_id, v_node.form_id, v_next_node, v_creator, true);
      SELECT * INTO v_next FROM public.biz_approval WHERE id = v_next_id;
      v_has_next := v_next.id IS NOT NULL;
    END IF;
  ELSE
    SELECT * INTO v_next FROM public.biz_approval
     WHERE biz_id = p_biz_id AND state = 'pending' ORDER BY created_at LIMIT 1;
    v_has_next := v_next.id IS NOT NULL;
    IF v_has_next THEN
      UPDATE public.biz_approval SET current = true WHERE id = v_next.id;
    END IF;
  END IF;

  -- 审批通过：驱动状态机「审批通过」事件
  v_sm_status := public.wf_apply_state_machine(p_biz_id, '审批通过');

  -- 如果没有下一节点（流程结束）且状态机未改变状态，兜底为 approved
  IF NOT v_has_next THEN
    IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    END IF;
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    SELECT v_tenant, b.created_by, '你的申请已全部通过', '所有审批节点均已通过', 'info', p_biz_id
    FROM public.biz_data b WHERE b.id = p_biz_id;
    RETURN jsonb_build_object('done', true, 'message', '已通过，流程结束');
  END IF;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_tenant, (a #>> '{}')::uuid,
         CASE WHEN COALESCE(v_next.node_type, 'approval') = 'fill' THEN '你有新的填写任务' ELSE '你有新的审批任务' END,
         COALESCE((SELECT title FROM public.biz_data WHERE id = p_biz_id), '单据')
           || CASE WHEN COALESCE(v_next.node_type, 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', p_biz_id
  FROM jsonb_array_elements(v_next.approvers) a;

  RETURN jsonb_build_object('done', true, 'message', '已通过，流转至「' || v_next.node_name || '」');
END $function$;