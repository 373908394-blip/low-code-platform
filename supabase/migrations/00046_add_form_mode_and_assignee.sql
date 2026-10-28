-- 二期：表单模式（普通/状态机/审批）写入应用元数据
ALTER TABLE public.meta_forms
  ADD COLUMN form_mode text NOT NULL DEFAULT 'normal'
  CONSTRAINT meta_forms_form_mode_check CHECK (form_mode IN ('normal', 'state', 'approval'));
COMMENT ON COLUMN public.meta_forms.form_mode IS '表单模式：normal 普通表单 / state 状态机表单 / approval 审批表单（仅 app_type=form 时有意义）';

-- 历史应用回填：配置了审批流（meta_workflow）的表单归为审批表单，配置了状态机（meta_state_machine）的归为状态机表单，其余为普通表单
UPDATE public.meta_forms f
  SET form_mode = 'approval'
  WHERE f.app_type = 'form'
    AND EXISTS (SELECT 1 FROM public.meta_workflow w WHERE w.form_id = f.id);

UPDATE public.meta_forms f
  SET form_mode = 'state'
  WHERE f.app_type = 'form'
    AND form_mode = 'normal'
    AND EXISTS (SELECT 1 FROM public.meta_state_machine sm WHERE sm.form_id = f.id);

-- biz_data 增加处理人字段（状态机人员分配动作写入）
ALTER TABLE public.biz_data
  ADD COLUMN assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN assignee_name text;
COMMENT ON COLUMN public.biz_data.assignee_id IS '当前处理人（状态机人员分配动作写入）';
COMMENT ON COLUMN public.biz_data.assignee_name IS '当前处理人姓名（冗余展示）';

CREATE INDEX idx_biz_data_assignee ON public.biz_data(tenant_id, assignee_id, status);

-- change_biz_status 支持 assignee 写入：p_assignee 指定目标处理人，转换成功后写入并生成待办通知
CREATE OR REPLACE FUNCTION public.change_biz_status(
  p_biz_id uuid,
  p_event text,
  p_mappings jsonb DEFAULT NULL,
  p_assignee uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_biz RECORD;
  v_sm RECORD;
  v_trans RECORD;
  v_assignee uuid;
  v_assignee_name text;
  v_new_payload jsonb;
BEGIN
  SELECT * INTO v_biz FROM public.biz_data WHERE id = p_biz_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', '单据不存在');
  END IF;

  SELECT * INTO v_sm FROM public.meta_state_machine WHERE form_id = v_biz.form_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', '该表单未配置状态机');
  END IF;

  SELECT t.id, t."from", t."to", t.event, t.guards, t.assign_action INTO v_trans
    FROM jsonb_to_recordset(v_sm.transitions) AS t(id text, "from" text, "to" text, event text, guards jsonb, assign_action jsonb)
   WHERE t."from" = v_biz.status AND t.event = p_event
   ORDER BY t.id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', '当前状态不支持该操作');
  END IF;

  -- 显式传入的 p_assignee 优先；未传时读取转换配置的 assign_action（manual: 配置值 / role_pool: 置空待认领）
  v_assignee := p_assignee;
  IF v_assignee IS NULL AND v_trans.assign_action IS NOT NULL THEN
    IF v_trans.assign_action->>'type' = 'manual' AND v_trans.assign_action->>'userId' IS NOT NULL AND v_trans.assign_action->>'userId' <> '' THEN
      v_assignee := (v_trans.assign_action->>'userId')::uuid;
    END IF;
  END IF;

  v_new_payload := COALESCE(v_biz.payload, '{}'::jsonb);
  IF v_trans.assign_action IS NOT NULL AND v_trans.assign_action->>'type' = 'rule' THEN
    -- 规则分配：initiator 回退创建人；dept_leader 取创建人部门主管；otherwise 空
    IF v_trans.assign_action->>'value' = 'initiator' THEN
      v_assignee := v_biz.created_by;
    ELSIF v_trans.assign_action->>'value' = 'dept_leader' THEN
      SELECT p.leader INTO v_assignee FROM public.profiles p WHERE p.id = v_biz.created_by;
    END IF;
  END IF;

  SELECT name INTO v_assignee_name FROM public.profiles WHERE id = v_assignee;

  UPDATE public.biz_data
     SET status = v_trans."to",
         assignee_id = v_assignee,
         assignee_name = v_assignee_name,
         payload = CASE WHEN p_mappings IS NOT NULL AND p_mappings <> '{}'::jsonb
                        THEN v_new_payload || p_mappings
                        ELSE v_new_payload END,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = p_biz_id;

  -- 生成待办通知（有处理人时）
  IF v_assignee IS NOT NULL THEN
    INSERT INTO public.notifications (tenant_id, user_id, title, content, biz_id)
    VALUES (v_biz.tenant_id, v_assignee,
            '待办分配：' || COALESCE(v_biz.title, '新单据'),
            '有一条单据已分配给您处理，请及时查看。', p_biz_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'message', '状态已更新', 'status', v_trans."to", 'assignee_id', v_assignee);
END;
$$;