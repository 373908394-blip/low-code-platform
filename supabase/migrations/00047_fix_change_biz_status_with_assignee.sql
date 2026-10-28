-- 修正 change_biz_status：恢复租户校验/守卫条件/事件别名/审计日志（委托 wf_apply_state_machine），并支持人员分配写入
CREATE OR REPLACE FUNCTION public.change_biz_status(
  p_biz_id uuid,
  p_event text,
  p_mappings jsonb DEFAULT '{}'::jsonb,
  p_assignee uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row public.biz_data;
  v_old_status text;
  v_new_status text;
  v_payload jsonb;
  v_sm record;
  v_trans jsonb;
  v_from text;
  v_to text;
  v_event text;
  v_assignee uuid;
  v_assignee_name text;
BEGIN
  SELECT * INTO v_row FROM public.biz_data WHERE id = p_biz_id;
  IF v_row.id IS NULL OR v_row.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;

  v_old_status := v_row.status;
  v_new_status := public.wf_apply_state_machine(p_biz_id, p_event);

  IF v_new_status IS NULL OR v_new_status = v_old_status THEN
    RAISE EXCEPTION '当前状态「%」不支持事件「%」的转换或守卫条件不满足', v_old_status, p_event;
  END IF;

  -- payload 映射合并
  v_payload := COALESCE(v_row.payload, '{}'::jsonb);
  IF jsonb_typeof(COALESCE(p_mappings, '{}'::jsonb)) = 'object' AND COALESCE(p_mappings, '{}'::jsonb) <> '{}'::jsonb THEN
    v_payload := v_payload || p_mappings;
  END IF;

  -- 人员分配：显式 p_assignee（角色池认领）优先；否则按转换配置 assign_action 解析
  SELECT * INTO v_sm FROM public.meta_state_machine WHERE form_id = v_row.form_id ORDER BY updated_at DESC LIMIT 1;
  FOR v_trans IN SELECT * FROM jsonb_array_elements(COALESCE(v_sm.transitions, '[]'::jsonb)) LOOP
    v_from := v_trans->>'from'; v_to := v_trans->>'to'; v_event := v_trans->>'event';
    IF v_from = v_old_status AND v_to = v_new_status
       AND (v_event = p_event
            OR (p_event = '审批通过' AND v_event IN ('通过','同意','审批通过'))
            OR (p_event = '驳回' AND v_event IN ('驳回','拒绝'))
            OR (p_event = '提交' AND v_event IN ('提交','发起','申请'))) THEN
      IF p_assignee IS NOT NULL THEN
        v_assignee := p_assignee;
      ELSIF v_trans->'assignAction' IS NOT NULL THEN
        IF v_trans->'assignAction'->>'type' = 'manual' AND COALESCE(v_trans->'assignAction'->>'userId', '') <> '' THEN
          v_assignee := (v_trans->'assignAction'->>'userId')::uuid;
        ELSIF v_trans->'assignAction'->>'type' = 'rule' THEN
          IF COALESCE(v_trans->'assignAction'->>'value', 'initiator') = 'initiator' THEN
            v_assignee := v_row.created_by;
          ELSIF v_trans->'assignAction'->>'value' = 'dept_leader' THEN
            SELECT d.leader_id INTO v_assignee FROM public.departments d
              WHERE d.id = (SELECT department_id FROM public.profiles WHERE id = v_row.created_by);
          END IF;
        END IF;
      END IF;
      EXIT;
    END IF;
  END LOOP;

  SELECT name INTO v_assignee_name FROM public.profiles WHERE id = v_assignee;

  UPDATE public.biz_data
     SET status = v_new_status, payload = v_payload, updated_at = now(), updated_by = v_user,
         assignee_id = v_assignee, assignee_name = v_assignee_name
   WHERE id = p_biz_id;

  IF v_assignee IS NOT NULL THEN
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
    VALUES (v_row.tenant_id, v_assignee, '待办分配：' || COALESCE(v_row.title, '新单据'),
            '有一条单据已分配给您处理，请及时查看。', 'todo', p_biz_id);
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_row.tenant_id, v_user, (SELECT name FROM public.profiles WHERE id = v_user), '状态变更',
          COALESCE(v_row.title, p_biz_id::text),
          jsonb_build_object('event', p_event, 'from', v_old_status, 'to', v_new_status, 'assignee', v_assignee));

  RETURN jsonb_build_object('ok', true, 'status', v_new_status, 'assignee_id', v_assignee, 'message', '状态已变更为「' || v_new_status || '」');
END $function$;