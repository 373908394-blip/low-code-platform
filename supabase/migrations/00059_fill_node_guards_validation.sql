-- 流程填写节点守卫条件兜底校验：提交时合并单据现有数据与本次填写数据逐条评估（AND 关系），
-- 未满足则拒绝写入并阻断流转（与状态机守卫一致：字段与设定值/当前表字段比较，含 gte/lte/ncontains）
CREATE OR REPLACE FUNCTION public.fill_node_biz(p_biz_id uuid, p_data jsonb DEFAULT '{}'::jsonb, p_changes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
  v_old_status text;
  v_sm_status text;
  -- 填写节点守卫条件评估
  v_node_cfg jsonb;
  v_guard jsonb;
  v_gk text;
  v_gv text;
  v_vt text;
  v_actual text;
  v_expected text;
  v_op_label text;
  v_f_label text;
  v_r_label text;
  v_gok boolean;
  v_merged jsonb;
  v_num_re text := '^-?([0-9]+(\.[0-9]+)?|\.[0-9]+)$';
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

  -- 填写节点守卫条件兜底校验：定位流程节点配置中的 guards，合并现有数据与本次填写数据逐条评估
  -- 未配置守卫的存量节点 guards 为空，默认放行（完全向后兼容）
  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = v_biz.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_node.node_id IS NOT NULL AND v_wf.id IS NOT NULL THEN
    SELECT n INTO v_node_cfg FROM jsonb_array_elements(v_wf.nodes) n WHERE n->>'id' = v_node.node_id LIMIT 1;
    IF v_node_cfg IS NOT NULL AND v_node_cfg ? 'guards' AND jsonb_typeof(v_node_cfg->'guards') = 'array' AND jsonb_array_length(v_node_cfg->'guards') > 0 THEN
      v_merged := COALESCE(v_biz.payload, '{}'::jsonb) || v_data;
      FOR v_guard IN SELECT * FROM jsonb_array_elements(v_node_cfg->'guards') LOOP
        v_gk := v_guard->>'field';
        v_gv := v_guard->>'value';
        -- 未选字段/未填值的脏配置行跳过（设计器保存时亦会剔除）
        IF COALESCE(v_gk, '') = '' OR COALESCE(v_gv, '') = '' THEN CONTINUE; END IF;
        v_vt := COALESCE(v_guard->>'value_type', 'value');
        IF v_vt = 'field' THEN
          v_expected := v_merged->>v_gv;
        ELSE
          v_expected := v_gv;
        END IF;
        v_actual := v_merged->>v_gk;
        v_gok := CASE v_guard->>'op'
          WHEN 'eq' THEN v_actual = v_expected
          WHEN 'ne' THEN v_actual <> v_expected
          WHEN 'gt' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric > v_expected::numeric)
          WHEN 'lt' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric < v_expected::numeric)
          WHEN 'gte' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric >= v_expected::numeric)
          WHEN 'lte' THEN (v_actual ~ v_num_re AND v_expected ~ v_num_re AND v_actual::numeric <= v_expected::numeric)
          WHEN 'contains' THEN v_actual LIKE '%' || v_expected || '%'
          WHEN 'ncontains' THEN v_actual NOT LIKE '%' || v_expected || '%'
          WHEN 'in' THEN string_to_array(v_expected, ',') @> ARRAY[v_actual]
          WHEN 'between' THEN (v_actual ~ v_num_re
                               AND split_part(v_expected, ',', 1) ~ v_num_re
                               AND split_part(v_expected, ',', 2) ~ v_num_re
                               AND v_actual::numeric BETWEEN split_part(v_expected, ',', 1)::numeric AND split_part(v_expected, ',', 2)::numeric)
          ELSE true
        END;
        IF NOT v_gok THEN
          -- 错误提示带字段中文名（从表单 schema 解析），便于填写人定位问题
          SELECT x->>'label' INTO v_f_label FROM public.meta_forms m, jsonb_array_elements(COALESCE(m.schema_json, '{}'::jsonb)->'fields') x
           WHERE m.id = v_biz.form_id AND x->>'key' = v_gk LIMIT 1;
          SELECT l INTO v_op_label FROM (VALUES ('eq','等于'),('ne','不等于'),('gt','大于'),('lt','小于'),('gte','大于等于'),('lte','小于等于'),('contains','包含'),('ncontains','不包含'),('in','属于'),('between','介于')) AS t(o, l) WHERE t.o = v_guard->>'op';
          IF v_vt = 'field' THEN
            SELECT x->>'label' INTO v_r_label FROM public.meta_forms m, jsonb_array_elements(COALESCE(m.schema_json, '{}'::jsonb)->'fields') x
             WHERE m.id = v_biz.form_id AND x->>'key' = v_gv LIMIT 1;
            v_expected := COALESCE(v_r_label, v_gv);
          END IF;
          RAISE EXCEPTION '守卫条件未满足：「%」%「%」，请修改后再次提交', COALESCE(v_f_label, v_gk), COALESCE(v_op_label, v_guard->>'op'), v_expected;
        END IF;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.biz_data
     SET payload = COALESCE(payload, '{}'::jsonb) || v_data, updated_at = now(), updated_by = v_user
   WHERE id = p_biz_id;

  UPDATE public.biz_approval
     SET state = 'approved', current = false,
         acts = COALESCE(acts, '[]'::jsonb) || jsonb_build_object(
           'user_id', v_user, 'user_name', (SELECT name FROM public.profiles WHERE id = v_user),
           'action', 'fill', 'comment', '填写完成', 'at', now(),
           'changes', COALESCE(p_changes, '[]'::jsonb))
   WHERE id = v_node.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, v_user, (SELECT name FROM public.profiles WHERE id = v_user), '填写确认',
          COALESCE(v_biz.title, p_biz_id::text), jsonb_build_object('node', v_node.node_name, 'biz_id', p_biz_id));

  -- 填写节点完成：先以该节点名称作为事件驱动状态机（例如节点名"销假"）
  v_old_status := v_biz.status;
  v_sm_status := public.wf_apply_state_machine(p_biz_id, v_node.node_name);
  -- 如果未匹配，再以通用事件「填写完成」或「提交」尝试
  IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
    v_sm_status := public.wf_apply_state_machine(p_biz_id, '填写完成');
  END IF;

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
    IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
      UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
    END IF;
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