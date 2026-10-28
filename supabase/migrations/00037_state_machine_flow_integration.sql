-- 1. 创建通用的工作流状态机驱动函数
CREATE OR REPLACE FUNCTION public.wf_apply_state_machine(p_biz_id uuid, p_event text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.biz_data;
  v_sm record;
  v_trans jsonb;
  v_to text;
  v_ok boolean;
  v_k text;
  v_v text;
  v_cur_val text;
  v_cur_status_label text;
  v_state_item jsonb;
  v_guard jsonb;
BEGIN
  SELECT * INTO v_row FROM public.biz_data WHERE id = p_biz_id;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_sm FROM public.meta_state_machine WHERE form_id = v_row.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_sm.id IS NULL OR v_sm.transitions IS NULL OR jsonb_array_length(v_sm.transitions) = 0 THEN
    RETURN v_row.status;
  END IF;

  -- 获取当前状态的中文 label（用于状态守卫条件的匹配）
  v_cur_status_label := v_row.status;
  IF v_sm.states IS NOT NULL THEN
    FOR v_state_item IN SELECT * FROM jsonb_array_elements(v_sm.states) LOOP
      IF v_state_item->>'key' = v_row.status THEN
        v_cur_status_label := v_state_item->>'label';
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- 查找匹配转换：from = v_row.status 且 event 匹配，且满足所有 guards
  FOR v_trans IN SELECT * FROM jsonb_array_elements(v_sm.transitions) LOOP
    IF (v_trans->>'from' = v_row.status OR (v_trans->>'from' IS NULL AND v_row.status IS NULL))
       AND (
         v_trans->>'event' = p_event
         OR (p_event = '审批通过' AND v_trans->>'event' IN ('通过', '同意', '审批通过'))
         OR (p_event = '驳回' AND v_trans->>'event' IN ('驳回', '拒绝'))
         OR (p_event = '提交' AND v_trans->>'event' IN ('提交', '发起', '申请'))
       ) THEN

      v_ok := true;
      -- 守卫条件检查
      IF v_trans ? 'guards' AND jsonb_typeof(v_trans->'guards') = 'array' AND jsonb_array_length(v_trans->'guards') > 0 THEN
        FOR v_guard IN SELECT * FROM jsonb_array_elements(v_trans->'guards') LOOP
          v_k := v_guard->>'field';
          v_v := v_guard->>'value';

          IF v_k = 'status' THEN
            -- status 字段：既可能是 key 也可能是 label
            CASE v_guard->>'op'
              WHEN 'eq' THEN
                v_ok := (v_v = v_row.status OR v_v = v_cur_status_label);
              WHEN 'ne' THEN
                v_ok := (v_v <> v_row.status AND v_v <> v_cur_status_label);
              ELSE
                v_ok := true;
            END CASE;
          ELSE
            v_cur_val := v_row.payload->>v_k;
            CASE v_guard->>'op'
              WHEN 'eq' THEN v_ok := (v_cur_val = v_v);
              WHEN 'ne' THEN v_ok := (v_cur_val <> v_v);
              WHEN 'gt' THEN v_ok := (v_cur_val::numeric > v_v::numeric);
              WHEN 'lt' THEN v_ok := (v_cur_val::numeric < v_v::numeric);
              WHEN 'contains' THEN v_ok := (v_cur_val LIKE '%' || v_v || '%');
              WHEN 'in' THEN v_ok := (string_to_array(v_v, ',') @> ARRAY[v_cur_val]);
              WHEN 'between' THEN v_ok := (v_cur_val::numeric BETWEEN split_part(v_v, ',', 1)::numeric AND split_part(v_v, ',', 2)::numeric);
              ELSE v_ok := true;
            END CASE;
          END IF;

          IF NOT v_ok THEN EXIT; END IF;
        END LOOP;
      END IF;

      -- 匹配成功且守卫满足
      IF v_ok THEN
        v_to := v_trans->>'to';
        UPDATE public.biz_data SET status = v_to, updated_at = now() WHERE id = p_biz_id;
        RETURN v_to;
      END IF;

    END IF;
  END LOOP;

  RETURN v_row.status;
END $function$;

-- 2. 升级 change_biz_status 使用统一的 wf_apply_state_machine
CREATE OR REPLACE FUNCTION public.change_biz_status(p_biz_id uuid, p_event text, p_mappings jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_row public.biz_data;
  v_old_status text;
  v_new_status text;
  v_k text;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_row FROM public.biz_data WHERE id = p_biz_id;
  IF v_row.id IS NULL OR v_row.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;

  v_old_status := v_row.status;
  v_new_status := public.wf_apply_state_machine(p_biz_id, p_event);

  IF v_new_status IS NULL OR v_new_status = v_old_status THEN
    RAISE EXCEPTION '当前状态「%」不支持事件「%」的转换或守卫条件不满足', v_old_status, p_event;
  END IF;

  v_payload := COALESCE(v_row.payload, '{}'::jsonb);
  IF jsonb_typeof(COALESCE(p_mappings, '{}'::jsonb)) = 'object' THEN
    FOR v_k IN SELECT jsonb_object_keys(COALESCE(p_mappings, '{}'::jsonb)) LOOP
      v_payload := v_payload || jsonb_build_object(v_k, p_mappings->v_k);
    END LOOP;
    UPDATE public.biz_data SET payload = v_payload, updated_at = now(), updated_by = v_user WHERE id = p_biz_id;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_row.tenant_id, v_user, (SELECT name FROM public.profiles WHERE id = v_user), '状态变更',
          COALESCE(v_row.title, p_biz_id::text),
          jsonb_build_object('event', p_event, 'from', v_old_status, 'to', v_new_status));

  RETURN jsonb_build_object('ok', true, 'status', v_new_status, 'message', '状态已变更为「' || v_new_status || '」');
END $function$;

-- 3. 升级 approve_biz，审批通过/驳回时驱动状态机
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

-- 4. 升级 fill_node_biz，填写确认时驱动状态机（支持以节点名称作为事件）
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
  v_old_status text;
  v_sm_status text;
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

  -- 填写节点完成：先以该节点名称作为事件驱动状态机（例如节点名“销假”）
  v_old_status := v_biz.status;
  v_sm_status := public.wf_apply_state_machine(p_biz_id, v_node.node_name);
  -- 如果未匹配，再以通用事件「填写完成」或「提交」尝试
  IF v_sm_status IS NULL OR v_sm_status = v_old_status THEN
    v_sm_status := public.wf_apply_state_machine(p_biz_id, '填写完成');
  END IF;

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

-- 5. 升级 submit_biz，提交时驱动状态机「提交」事件
CREATE OR REPLACE FUNCTION public.submit_biz(p_form_id uuid, p_payload jsonb, p_title text, p_amount numeric, p_submit boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
BEGIN
  v_tenant := public.get_my_tenant_id();
  INSERT INTO public.biz_data (tenant_id, form_id, status, title, amount, payload, created_by)
  VALUES (v_tenant, p_form_id, 'draft', p_title, p_amount, COALESCE(p_payload, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  IF NOT p_submit THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已保存草稿');
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
