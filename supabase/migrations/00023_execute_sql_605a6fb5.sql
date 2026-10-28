CREATE TEMPORARY TABLE IF NOT EXISTS t_e2e (
  step text,
  ok boolean,
  detail text
) ON COMMIT PRESERVE ROWS; DO $$
DECLARE
  v_liuyun constant uuid := '10000000-0000-0000-0000-000000000002';
  v_chen constant uuid := '10000000-0000-0000-0000-000000000001';
  v_zhou constant uuid := '10000000-0000-0000-0000-000000000003';
  v_tenant uuid;
  v_form uuid;
  v_wf uuid;
  v_biz1 uuid; v_biz2 uuid; v_biz3 uuid; v_biz4 uuid;
  v_task record;
  v_res jsonb;
  v_msg text;
  v_days text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = v_liuyun;
  INSERT INTO meta_forms (tenant_id, name, code, schema_json)
  VALUES (v_tenant, '测试-v59-e2e', 'TEST_V59_E2E', '{"fields":[]}'::jsonb) RETURNING id INTO v_form;
  INSERT INTO meta_workflow (tenant_id, form_id, name, nodes, settings)
  VALUES (v_tenant, v_form, '测试流程-v59', '[
    {"id":"f1","type":"fill","name":"补充信息","approver_type":"user","approver_value":["10000000-0000-0000-0000-000000000002"],"mode":"or","confirmFields":["days","reason"]},
    {"id":"c1","type":"condition","name":"时长分支","branches":[
      {"id":"br1","name":"三天及以上","conditions":[{"id":"g1","logic":"and","rules":[{"id":"r1","field":"days","op":"gte","value":"3"}]}],"nodes":[
        {"id":"a1","type":"approval","name":"经理审批","approver_type":"user","approver_value":["10000000-0000-0000-0000-000000000001"],"mode":"or"}]},
      {"id":"br2","name":"默认","conditions":[],"nodes":[
        {"id":"a2","type":"approval","name":"主管审批","approver_type":"user","approver_value":["10000000-0000-0000-0000-000000000003"],"mode":"or"}]}
    ]}
  ]'::jsonb, jsonb_build_object('initiatorConfig', jsonb_build_object('type','user','value', jsonb_build_array(v_liuyun::text)))) RETURNING id INTO v_wf;

  -- 1) 刘芸提交（days=1，未达条件）
  SELECT * INTO v_res FROM submit_biz(v_form, '{"days":1,"reason":"初始"}'::jsonb, 'v59-e2e-单1', 0, true);
  v_biz1 := (v_res->>'id')::uuid;
  INSERT INTO t_e2e VALUES ('1_submit_ok', (v_res->>'ok')::boolean, coalesce(v_res->>'message',''));

  -- 2) 首个任务应为填写节点
  SELECT * INTO v_task FROM biz_approval WHERE biz_id=v_biz1 AND current AND state='pending' ORDER BY created_at LIMIT 1;
  INSERT INTO t_e2e VALUES ('2_first_is_fill', v_task.node_type='fill' AND v_task.node_id='f1' AND v_task.approvers ? v_liuyun::text,
    v_task.node_name || '|type=' || coalesce(v_task.node_type,'') || '|fields=' || v_task.confirm_fields::text);

  -- 3) 非填写人（周杰）填写应被拦截
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_zhou::text,'role','authenticated')::text, true);
  BEGIN
    SELECT * INTO v_res FROM fill_node_biz(v_biz1, '{"days":9}'::jsonb);
    INSERT INTO t_e2e VALUES ('3_fill_other_blocked', false, '未拦截');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_e2e VALUES ('3_fill_other_blocked', true, SQLERRM);
  END;

  -- 4) 刘芸填写 days=5 → 数据合并 + 条件路由走 br1（经理审批=陈明轩）
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_liuyun::text,'role','authenticated')::text, true);
  SELECT * INTO v_res FROM fill_node_biz(v_biz1, '{"days":5,"reason":"紧急"}'::jsonb);
  INSERT INTO t_e2e VALUES ('4_fill_ok', true, coalesce(v_res->>'message',''));
  SELECT payload->>'days' INTO v_days FROM biz_data WHERE id=v_biz1;
  INSERT INTO t_e2e VALUES ('4_payload_merged', v_days='5', 'days='||coalesce(v_days,''));
  SELECT * INTO v_task FROM biz_approval WHERE biz_id=v_biz1 AND current AND state='pending' ORDER BY created_at LIMIT 1;
  INSERT INTO t_e2e VALUES ('4_branch_routed', v_task.node_id='a1' AND v_task.approvers ? v_chen::text,
    v_task.node_name || '|approvers=' || v_task.approvers::text);
  SELECT (SELECT count(*) FROM jsonb_array_elements(acts) a WHERE a->>'action'='fill')::text INTO v_msg FROM biz_approval WHERE biz_id=v_biz1 AND node_id='f1';
  INSERT INTO t_e2e VALUES ('4_fill_act_logged', v_msg='1', 'fill_acts='||coalesce(v_msg,'0'));

  -- 5) 陈明轩通过 → 流程结束
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_chen::text,'role','authenticated')::text, true);
  SELECT * INTO v_res FROM approve_biz(v_biz1, 'approve', '同意');
  INSERT INTO t_e2e VALUES ('5_approve_msg', true, coalesce(v_res->>'message',''));
  SELECT status INTO v_msg FROM biz_data WHERE id=v_biz1;
  INSERT INTO t_e2e VALUES ('5_biz_approved', v_msg='approved', 'status='||coalesce(v_msg,''));

  -- 6) 驳回不填理由应被拦截
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_liuyun::text,'role','authenticated')::text, true);
  SELECT * INTO v_res FROM submit_biz(v_form, '{"days":2}'::jsonb, 'v59-e2e-单2', 0, true);
  v_biz2 := (v_res->>'id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_liuyun::text,'role','authenticated')::text, true);
  SELECT * INTO v_res FROM fill_node_biz(v_biz2, '{"days":2}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_chen::text,'role','authenticated')::text, true);
  BEGIN
    SELECT * INTO v_res FROM approve_biz(v_biz2, 'reject', '');
    INSERT INTO t_e2e VALUES ('6_reject_no_reason_blocked', false, '未拦截');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_e2e VALUES ('6_reject_no_reason_blocked', true, SQLERRM);
  END;

  -- 7) 对填写节点调 approve 应被拦截
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_liuyun::text,'role','authenticated')::text, true);
  SELECT * INTO v_res FROM submit_biz(v_form, '{"days":1}'::jsonb, 'v59-e2e-单3', 0, true);
  v_biz3 := (v_res->>'id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_chen::text,'role','authenticated')::text, true);
  BEGIN
    SELECT * INTO v_res FROM approve_biz(v_biz3, 'approve', 'x');
    INSERT INTO t_e2e VALUES ('7_approve_on_fill_blocked', false, '未拦截');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_e2e VALUES ('7_approve_on_fill_blocked', true, SQLERRM);
  END;

  -- 8) 非允许发起人（周杰）提交应被拦截
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_zhou::text,'role','authenticated')::text, true);
  BEGIN
    SELECT * INTO v_res FROM submit_biz(v_form, '{"days":1}'::jsonb, 'v59-e2e-单4', 0, true);
    v_biz4 := (v_res->>'id')::uuid;
    INSERT INTO t_e2e VALUES ('8_initiator_scope_blocked', false, '未拦截');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_e2e VALUES ('8_initiator_scope_blocked', true, SQLERRM);
  END;

  -- 清理测试数据
  DELETE FROM biz_approval WHERE biz_id IN (v_biz1, coalesce(v_biz4, v_biz1));
  DELETE FROM notifications WHERE biz_id IN (v_biz1, v_biz2, v_biz3, coalesce(v_biz4, v_biz1));
  DELETE FROM audit_logs WHERE detail->>'biz_id' IN (v_biz1::text, v_biz2::text, v_biz3::text, coalesce(v_biz4, v_biz1)::text);
  DELETE FROM biz_data WHERE id IN (v_biz1, v_biz2, v_biz3, coalesce(v_biz4, v_biz1));
  DELETE FROM meta_workflow WHERE id = v_wf;
  DELETE FROM meta_forms WHERE id = v_form;
END $$;