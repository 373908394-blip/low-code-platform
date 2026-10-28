-- ============ v59：填写节点确认 + 条件分支路由 + 发起人范围 + 驳回理由必填 ============

-- 1) biz_approval 增加节点定位与填写配置列
ALTER TABLE public.biz_approval
  ADD COLUMN IF NOT EXISTS node_id text,
  ADD COLUMN IF NOT EXISTS node_type text DEFAULT 'approval',
  ADD COLUMN IF NOT EXISTS confirm_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2) resolve_approvers 支持「发起人」类型（填写节点用）
CREATE OR REPLACE FUNCTION public.resolve_approvers(p_node jsonb, p_initiator uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_type text := p_node->>'approver_type';
  v_dept uuid;
  v_leader uuid;
  v_parent uuid;
  v_parent_leader uuid;
  v_cur uuid;
BEGIN
  IF v_type = 'user' THEN
    RETURN COALESCE(p_node->'approver_value', '[]'::jsonb);
  ELSIF v_type = 'role' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(ur.user_id), '[]'::jsonb)
      FROM public.user_roles ur
      WHERE ur.role_id::text IN (SELECT jsonb_array_elements_text(COALESCE(p_node->'approver_value', '[]'::jsonb)))
    );
  ELSIF v_type = 'initiator' THEN
    RETURN jsonb_build_array(p_initiator);
  ELSIF v_type IN ('dept_leader','multi_level_leader') THEN
    SELECT department_id INTO v_dept FROM public.profiles WHERE id = p_initiator;
    v_cur := v_dept;
    WHILE v_cur IS NOT NULL LOOP
      SELECT leader_id, parent_id INTO v_leader, v_parent FROM public.departments WHERE id = v_cur;
      IF v_leader IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_leader AND status = 'active') THEN
        IF v_type = 'multi_level_leader' AND v_parent IS NOT NULL THEN
          SELECT leader_id INTO v_parent_leader FROM public.departments WHERE id = v_parent;
          IF v_parent_leader IS NOT NULL AND v_parent_leader <> v_leader
             AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_parent_leader AND status = 'active') THEN
            RETURN jsonb_build_array(v_leader, v_parent_leader);
          END IF;
        END IF;
        RETURN jsonb_build_array(v_leader);
      END IF;
      v_cur := v_parent;
    END LOOP;
    RETURN (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM public.profiles WHERE is_superadmin AND status = 'active');
  ELSE
    RETURN COALESCE(p_node->'approver_value', '[]'::jsonb);
  END IF;
END $$;

-- 3) 单条件求值：支持 eq/ne/gt/gte/lt/lte/contains/not_contains/empty/not_empty
CREATE OR REPLACE FUNCTION public.wf_eval_rule(p_rule jsonb, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_field text := p_rule->>'field';
  v_op text := COALESCE(p_rule->>'op', 'eq');
  v_val text := COALESCE(p_rule->>'value', '');
  v_raw jsonb;
  v_txt text;
  v_is_num boolean;
BEGIN
  IF v_field IS NULL THEN RETURN false; END IF;
  v_raw := p_payload -> v_field;
  IF v_raw IS NULL THEN
    v_txt := NULL;
  ELSIF jsonb_typeof(v_raw) IN ('string','number','boolean') THEN
    v_txt := v_raw #>> '{}';
  ELSE
    v_txt := v_raw::text;
  END IF;

  IF v_op = 'empty' THEN RETURN v_txt IS NULL OR btrim(v_txt) = ''; END IF;
  IF v_op = 'not_empty' THEN RETURN v_txt IS NOT NULL AND btrim(v_txt) <> ''; END IF;
  IF v_txt IS NULL THEN RETURN false; END IF;

  v_is_num := v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' AND v_val ~ '^-?[0-9]+(\.[0-9]+)?$';
  IF v_op IN ('gt','gte','lt','lte') THEN
    IF NOT v_is_num THEN RETURN false; END IF;
    IF v_op = 'gt' THEN RETURN v_txt::numeric > v_val::numeric;
    ELSIF v_op = 'gte' THEN RETURN v_txt::numeric >= v_val::numeric;
    ELSIF v_op = 'lt' THEN RETURN v_txt::numeric < v_val::numeric;
    ELSE RETURN v_txt::numeric <= v_val::numeric;
    END IF;
  END IF;
  IF v_op = 'eq' THEN
    RETURN (v_is_num AND v_txt::numeric = v_val::numeric) OR (NOT v_is_num AND v_txt = v_val);
  END IF;
  IF v_op = 'ne' THEN
    RETURN NOT ((v_is_num AND v_txt::numeric = v_val::numeric) OR (NOT v_is_num AND v_txt = v_val));
  END IF;
  IF v_op = 'contains' THEN RETURN v_txt ILIKE '%' || v_val || '%'; END IF;
  IF v_op = 'not_contains' THEN RETURN v_txt NOT ILIKE '%' || v_val || '%'; END IF;
  RETURN false;
END $$;

-- 4) 条件组求值（组内 AND/OR）
CREATE OR REPLACE FUNCTION public.wf_eval_group(p_group jsonb, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_logic text := COALESCE(p_group->>'logic', 'and');
  v_rule jsonb;
  v_result boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_group->'rules', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_group->'rules', '[]'::jsonb)) = 0 THEN
    RETURN true;
  END IF;
  v_result := (v_logic = 'and');
  FOR v_rule IN SELECT jsonb_array_elements(COALESCE(p_group->'rules', '[]'::jsonb)) LOOP
    IF v_logic = 'and' THEN
      v_result := v_result AND public.wf_eval_rule(v_rule, p_payload);
    ELSE
      v_result := v_result OR public.wf_eval_rule(v_rule, p_payload);
    END IF;
  END LOOP;
  RETURN v_result;
END $$;

-- 5) 分支选择：首个全部条件组匹配的分支；无匹配走第一分支（默认）
CREATE OR REPLACE FUNCTION public.wf_pick_branch(p_node jsonb, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_branches jsonb := COALESCE(p_node->'branches', '[]'::jsonb);
  v_branch jsonb;
  v_group jsonb;
  v_ok boolean;
BEGIN
  IF jsonb_typeof(v_branches) <> 'array' OR jsonb_array_length(v_branches) = 0 THEN
    RETURN NULL;
  END IF;
  FOR v_branch IN SELECT jsonb_array_elements(v_branches) LOOP
    v_ok := true;
    IF jsonb_typeof(COALESCE(v_branch->'conditions', '[]'::jsonb)) = 'array' THEN
      FOR v_group IN SELECT jsonb_array_elements(v_branch->'conditions') LOOP
        v_ok := v_ok AND public.wf_eval_group(v_group, p_payload);
        IF NOT v_ok THEN EXIT; END IF;
      END LOOP;
    END IF;
    IF v_ok THEN RETURN v_branch; END IF;
  END LOOP;
  RETURN (SELECT b FROM jsonb_array_elements(v_branches) AS b LIMIT 1);
END $$;

-- 6) 从下标开始收集任务节点（条件节点按当前数据选择分支并深入，分支结束后回到主线）
CREATE OR REPLACE FUNCTION public.wf_collect_tasks(p_nodes jsonb, p_from int, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_node jsonb;
  v_branch jsonb;
  v_i int;
BEGIN
  IF jsonb_typeof(COALESCE(p_nodes, '[]'::jsonb)) <> 'array' THEN RETURN '[]'::jsonb; END IF;
  IF p_from < 0 OR p_from >= jsonb_array_length(p_nodes) THEN RETURN '[]'::jsonb; END IF;
  FOR v_i IN p_from .. jsonb_array_length(p_nodes) - 1 LOOP
    v_node := p_nodes -> v_i;
    IF v_node->>'type' IN ('approval', 'fill') THEN
      v_out := v_out || jsonb_build_array(v_node);
    ELSIF v_node->>'type' = 'condition' THEN
      v_branch := public.wf_pick_branch(v_node, p_payload);
      IF v_branch IS NOT NULL AND jsonb_typeof(COALESCE(v_branch->'nodes', '[]'::jsonb)) = 'array' THEN
        v_out := v_out || public.wf_collect_tasks(v_branch->'nodes', 0, p_payload);
      END IF;
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- 7) 计算某节点之后的剩余任务（支持分支内节点；找不到返回 NULL）
CREATE OR REPLACE FUNCTION public.wf_after_position(p_nodes jsonb, p_current_id text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_i int;
  v_j int;
  v_k int;
  v_node jsonb;
  v_branch jsonb;
  v_bnodes jsonb;
  v_tasks jsonb;
  v_found_top int := -1;
  v_found_branch jsonb := NULL;
  v_found_cond int := -1;
  v_found_sub int := -1;
BEGIN
  IF jsonb_typeof(COALESCE(p_nodes, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_nodes) = 0 THEN
    RETURN NULL;
  END IF;
  -- 空 id：从头收集（首次提交）
  IF p_current_id IS NULL OR btrim(p_current_id) = '' THEN
    RETURN public.wf_collect_tasks(p_nodes, 0, p_payload);
  END IF;
  FOR v_i IN 0 .. jsonb_array_length(p_nodes) - 1 LOOP
    v_node := p_nodes -> v_i;
    IF (v_node->>'id') = p_current_id THEN
      v_found_top := v_i;
      EXIT;
    ELSIF v_node->>'type' = 'condition' AND jsonb_typeof(COALESCE(v_node->'branches', '[]'::jsonb)) = 'array' THEN
      FOR v_branch IN SELECT jsonb_array_elements(v_node->'branches') LOOP
        v_bnodes := COALESCE(v_branch->'nodes', '[]'::jsonb);
        IF jsonb_typeof(v_bnodes) = 'array' AND jsonb_array_length(v_bnodes) > 0 THEN
          FOR v_j IN 0 .. jsonb_array_length(v_bnodes) - 1 LOOP
            IF (v_bnodes->v_j)->>'id' = p_current_id THEN
              v_found_sub := v_j;
              EXIT;
            END IF;
          END LOOP;
          IF v_found_sub >= 0 THEN
            v_found_branch := v_branch;
            v_found_cond := v_i;
            EXIT;
          END IF;
        END IF;
      END LOOP;
      IF v_found_branch IS NOT NULL THEN EXIT; END IF;
    END IF;
  END LOOP;

  IF v_found_top >= 0 THEN
    RETURN public.wf_collect_tasks(p_nodes, v_found_top + 1, p_payload);
  END IF;
  IF v_found_branch IS NOT NULL THEN
    v_tasks := public.wf_collect_tasks(v_found_branch->'nodes', v_found_sub + 1, p_payload);
    v_tasks := v_tasks || public.wf_collect_tasks(p_nodes, v_found_cond + 1, p_payload);
    RETURN v_tasks;
  END IF;
  RETURN NULL;
END $$;

-- 8) 创建任务行（审批/填写统一入口，记录节点定位与确认字段）
CREATE OR REPLACE FUNCTION public.wf_create_task_row(
  p_tenant uuid, p_biz_id uuid, p_form_id uuid, p_node jsonb, p_initiator uuid, p_current boolean
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_approvers jsonb;
  v_id uuid;
BEGIN
  v_approvers := public.resolve_approvers(p_node, p_initiator);
  IF v_approvers IS NULL OR v_approvers = '[]'::jsonb THEN
    v_approvers := (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM public.profiles
                     WHERE tenant_id = p_tenant AND is_superadmin AND status = 'active');
  END IF;
  INSERT INTO public.biz_approval
    (tenant_id, biz_id, form_id, node_name, approver_type, approvers, mode, state, current, node_id, node_type, confirm_fields)
  VALUES
    (p_tenant, p_biz_id, p_form_id, COALESCE(p_node->>'name', '审批'), COALESCE(p_node->>'approver_type', 'user'),
     v_approvers, COALESCE(p_node->>'mode', 'or'), 'pending', p_current,
     p_node->>'id', COALESCE(p_node->>'type', 'approval'), COALESCE(p_node->'confirmFields', '[]'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 9) 重写 submit_biz：发起人范围校验 + 渐进激活 + 条件路由
CREATE OR REPLACE FUNCTION public.submit_biz(p_form_id uuid, p_payload jsonb, p_title text, p_amount numeric, p_submit boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
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

  -- 按条件分支确定首个任务节点（渐进激活，后续节点推进时再计算）
  v_tasks := public.wf_after_position(v_wf.nodes, NULL, COALESCE(p_payload, '{}'::jsonb));
  IF v_tasks IS NULL OR jsonb_array_length(v_tasks) = 0 THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '流程未配置审批节点，已直接完成');
  END IF;

  v_first := v_tasks->0;
  v_row_id := public.wf_create_task_row(v_tenant, v_id, p_form_id, v_first, auth.uid(), true);
  UPDATE public.biz_data SET status = 'pending', updated_at = now() WHERE id = v_id;

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
END $$;

-- 10) 重写 start_biz_workflow（草稿发起审批）
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
  IF v_biz.status <> 'draft' THEN RAISE EXCEPTION '仅草稿状态可发起审批'; END IF;

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
         COALESCE(v_biz.title, '新单据') || CASE WHEN COALESCE(v_first->>'type', 'approval') = 'fill' THEN ' 待你填写确认' ELSE ' 待你审批' END,
         'todo', p_biz_id
  FROM jsonb_array_elements((SELECT approvers FROM public.biz_approval WHERE id = v_row_id)) a;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '发起审批',
          COALESCE(v_biz.title, p_biz_id::text), jsonb_build_object('biz_id', p_biz_id));

  RETURN jsonb_build_object('ok', true, 'message', '已发起审批');
END $$;

-- 11) 重写 approve_biz：驳回必填理由 + 填写节点拦截 + 条件分支推进
CREATE OR REPLACE FUNCTION public.approve_biz(p_biz_id uuid, p_action text, p_comment text DEFAULT ''::text)
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
  v_wf record;
  v_tasks jsonb;
  v_next_node jsonb;
  v_next_id uuid;
  v_has_next boolean := false;
  v_payload jsonb;
  v_creator uuid;
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

  v_acts := COALESCE(v_node.acts, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
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
    SELECT v_tenant, b.created_by, '你的申请已被驳回', '节点「' || v_node.node_name || '」驳回了申请：' || p_comment, 'info', p_biz_id
    FROM public.biz_data b WHERE b.id = p_biz_id;
    RETURN jsonb_build_object('done', true, 'message', '已驳回');
  END IF;

  -- 推进：按流程结构与当前数据计算下一任务（支持条件分支）；旧数据无 node_id 时回退线性推进
  SELECT payload, created_by INTO v_payload, v_creator FROM public.biz_data WHERE id = p_biz_id;
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

  IF NOT v_has_next THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = p_biz_id;
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
END $$;

-- 12) 新增 fill_node_biz：填写节点确认提交（更新数据 + 推进流程）
CREATE OR REPLACE FUNCTION public.fill_node_biz(p_biz_id uuid, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
           'action', 'fill', 'comment', '填写完成', 'at', now())
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
END $$;

GRANT EXECUTE ON FUNCTION public.fill_node_biz(uuid, jsonb) TO authenticated;