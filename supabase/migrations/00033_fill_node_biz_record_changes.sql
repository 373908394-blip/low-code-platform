CREATE OR REPLACE FUNCTION public.fill_node_biz(p_biz_id uuid, p_data jsonb DEFAULT '{}'::jsonb, p_changes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_biz record;
  v_node record;
  v_wf record;
  v_data jsonb := '{}'::jsonb;
  v_key text;
  v_tasks jsonb;
  v_next record;
  v_next_id uuid;
  v_next_node jsonb;
  v_has_next boolean := false;
BEGIN
  SELECT * INTO v_biz FROM public.biz_data WHERE id = p_biz_id;
  IF v_biz.id IS NULL OR v_biz.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;

  SELECT * INTO v_node FROM public.biz_approval
   WHERE biz_id = p_biz_id AND state = 'pending' AND current = true
   ORDER BY created_at LIMIT 1;
  IF v_node.id IS NULL THEN RAISE EXCEPTION '该单据没有待处理节点'; END IF;
  IF COALESCE(v_node.node_type, 'approval') <> 'fill' THEN RAISE EXCEPTION '当前节点不是填写节点'; END IF;

  IF NOT (v_node.approvers ? v_user::text) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user AND v_node.approvers ? ur.role_id::text
  ) THEN RAISE EXCEPTION '你不是该节点的填写人'; END IF;

  -- 合并填写数据（剔除系统字段，防客户端伪造）
  IF jsonb_typeof(COALESCE(p_data, '{}'::jsonb)) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) LOOP
      IF v_key NOT IN ('created_by','created_at','updated_by','updated_at','user_name','dept_name','position','status') THEN
        v_data := v_data || jsonb_build_object(v_key, COALESCE(p_data, '{}'::jsonb) -> v_key);
      END IF;
    END LOOP;
  END IF;

  UPDATE public.biz_data
     SET payload = COALESCE(payload, '{}'::jsonb) || v_data, updated_at = now(), updated_by = v_user
   WHERE id = p_biz_id;

  UPDATE public.biz_approval
     SET state = 'approved', current = false,
         acts = COALESCE(acts, '[]'::jsonb) || jsonb_build_object(
           'user_id', v_user,
           'user_name', (SELECT name FROM public.profiles WHERE id = v_user),
           'action', 'fill', 'comment', '填写完成', 'at', now(),
           'changes', COALESCE(p_changes, '[]'::jsonb))
   WHERE id = v_node.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, v_user, (SELECT name FROM public.profiles WHERE id = v_user), '填写确认',
          COALESCE(v_biz.title, p_biz_id::text), jsonb_build_object('node', v_node.node_name, 'biz_id', p_biz_id));

  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = v_biz.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_node.node_id IS NOT NULL AND v_wf.id IS NOT NULL THEN
    v_tasks := public.wf_after_position(v_wf.nodes, v_node.node_id, COALESCE(v_biz.payload, '{}'::jsonb) || v_data);
    DELETE FROM public.biz_approval WHERE biz_id = p_biz_id AND state = 'pending' AND current = false;
    IF v_tasks IS NOT NULL AND jsonb_array_length(v_tasks) > 0 THEN
      v_next_node := v_tasks->0;
      v_next_id := public.wf_create_task_row(v_biz.tenant_id, p_biz_id, v_biz.form_id, v_next_node, v_biz.created_by, true);
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

  IF NOT v_has_next THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    VALUES (v_biz.tenant_id, v_biz.created_by, '你的申请已全部通过', '所有流程节点均已完成', 'info', p_biz_id);
    RETURN jsonb_build_object('done', true, 'message', '填写完成，流程结束');
  END IF;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_biz.tenant_id, (a #>> '{}')::uuid,
         CASE WHEN COALESCE(v_next.node_type, 'approval') = 'fill' THEN '你有新的填写任务' ELSE '你有新的审批任务' END,
         COALESCE(v_biz.title, '单据')
           || CASE WHEN COALESCE(v_next.node_type, 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', p_biz_id
  FROM jsonb_array_elements(v_next.approvers) a;

  RETURN jsonb_build_object('done', true, 'message', '填写完成，流转至「' || v_next.node_name || '」');
END $function$;