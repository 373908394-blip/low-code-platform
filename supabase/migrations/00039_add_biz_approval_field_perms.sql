-- biz_approval 增加节点字段权限列，供销假等填写弹框按只读/可编辑渲染需确定内容
ALTER TABLE public.biz_approval
  ADD COLUMN field_perms jsonb NOT NULL DEFAULT '{}'::jsonb;

-- wf_create_task_row 写入节点的字段权限配置（fieldPermissions）
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
    (tenant_id, biz_id, form_id, node_name, approver_type, approvers, mode, state, current, node_id, node_type, confirm_fields, field_perms)
  VALUES
    (p_tenant, p_biz_id, p_form_id, COALESCE(p_node->>'name', '审批'), COALESCE(p_node->>'approver_type', 'user'),
     v_approvers, COALESCE(p_node->>'mode', 'or'), 'pending', p_current,
     p_node->>'id', COALESCE(p_node->>'type', 'approval'), COALESCE(p_node->'confirmFields', '[]'::jsonb),
     COALESCE(p_node->'fieldPermissions', '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;