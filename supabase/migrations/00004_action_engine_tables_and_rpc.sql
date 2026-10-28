-- ============ 动作引擎：操作项/按钮定义 ============
CREATE TABLE public.meta_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  position text NOT NULL CHECK (position IN ('toolbar','row','batch','form-top','form-bottom','field')),
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'mouse-pointer-click',
  variant text NOT NULL DEFAULT 'secondary' CHECK (variant IN ('primary','secondary','danger','link')),
  action_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  show_condition jsonb,
  enable_condition jsonb,
  permission_code text,
  confirm_text text,
  success_text text,
  after_behavior text NOT NULL DEFAULT 'refresh' CHECK (after_behavior IN ('refresh','close','navigate','back','none')),
  sort int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_meta_actions_form ON public.meta_actions(form_id, position, sort);

-- ============ 动作引擎：关联表定义 ============
CREATE TABLE public.meta_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_form_id uuid NOT NULL REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  target_form_id uuid NOT NULL REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  name text NOT NULL,
  relation_type text NOT NULL DEFAULT 'many_to_many' CHECK (relation_type IN ('one_to_many','many_to_many','belong')),
  backfill_field text NOT NULL,
  display_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  multiple boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ 动作引擎：执行日志（审计，只追加）============
CREATE TABLE public.meta_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  user_name text,
  form_id uuid,
  biz_id uuid,
  action_name text NOT NULL,
  action_type text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_action_logs_tenant ON public.meta_action_logs(tenant_id, created_at DESC);

-- ============ RLS ============
ALTER TABLE public.meta_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_meta_actions_sel ON public.meta_actions FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_meta_actions_ins ON public.meta_actions FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_meta_actions_upd ON public.meta_actions FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_meta_actions_del ON public.meta_actions FOR DELETE TO authenticated USING (public.is_superadmin());

ALTER TABLE public.meta_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_meta_relations_sel ON public.meta_relations FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_meta_relations_ins ON public.meta_relations FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_meta_relations_upd ON public.meta_relations FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_meta_relations_del ON public.meta_relations FOR DELETE TO authenticated USING (public.is_superadmin());

ALTER TABLE public.meta_action_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_action_logs_sel ON public.meta_action_logs FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_action_logs_ins ON public.meta_action_logs FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_my_tenant_id());
-- 审计日志不允许修改；超管可删除历史日志
CREATE POLICY p_action_logs_del ON public.meta_action_logs FOR DELETE TO authenticated USING (public.is_superadmin());

-- ============ 重写 submit_biz：创建单据 + 可选提交（修复前端调用签名不匹配）============
DROP FUNCTION public.submit_biz(uuid);

CREATE OR REPLACE FUNCTION public.submit_biz(p_form_id uuid, p_payload jsonb, p_title text, p_amount numeric, p_submit boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_tenant uuid;
  v_biz record;
  v_wf record;
  v_node jsonb;
  v_approvers jsonb;
  v_first_id uuid;
BEGIN
  v_tenant := public.get_my_tenant_id();
  INSERT INTO public.biz_data (tenant_id, form_id, status, title, amount, payload, created_by)
  VALUES (v_tenant, p_form_id, 'draft', p_title, p_amount, COALESCE(p_payload, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  IF NOT p_submit THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已保存草稿');
  END IF;

  SELECT * INTO v_biz FROM public.biz_data WHERE id = v_id;

  SELECT * INTO v_wf FROM public.meta_workflow WHERE form_id = v_biz.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_wf.id IS NULL OR v_wf.nodes = '[]'::jsonb THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '该表单未配置审批流程，已直接完成');
  END IF;

  FOR v_node IN SELECT jsonb_array_elements(v_wf.nodes) LOOP
    IF v_node->>'type' IN ('approval', 'fill') THEN
      v_approvers := public.resolve_approvers(v_node, v_biz.created_by);
      IF v_approvers = '[]'::jsonb THEN
        v_approvers := jsonb_build_array((SELECT pr.id FROM public.profiles pr WHERE pr.tenant_id = v_biz.tenant_id AND pr.is_superadmin LIMIT 1));
      END IF;
      INSERT INTO public.biz_approval (tenant_id, biz_id, form_id, node_name, approver_type, approvers, mode, state, current)
      VALUES (v_biz.tenant_id, v_id, v_biz.form_id, COALESCE(v_node->>'name','审批'), COALESCE(v_node->>'approver_type','user'), v_approvers, COALESCE(v_node->>'mode','or'), 'pending', false);
    END IF;
  END LOOP;

  SELECT id INTO v_first_id FROM public.biz_approval WHERE biz_id = v_id ORDER BY created_at LIMIT 1;
  IF v_first_id IS NULL THEN
    UPDATE public.biz_data SET status = 'approved', updated_at = now() WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '流程未配置审批节点，已直接完成');
  END IF;

  UPDATE public.biz_approval SET current = true WHERE id = v_first_id;
  UPDATE public.biz_data SET status = 'pending', updated_at = now() WHERE id = v_id;

  INSERT INTO public.notifications (tenant_id, user_id, title, body, type, biz_id)
  SELECT v_biz.tenant_id, a::uuid, '你有新的审批任务', COALESCE(v_biz.title, '新单据') || ' 待你审批', 'todo', v_id
  FROM jsonb_array_elements((SELECT approvers FROM public.biz_approval WHERE id = v_first_id)) a;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_biz.tenant_id, auth.uid(), (SELECT name FROM public.profiles WHERE id = auth.uid()), '提交申请', COALESCE(v_biz.title, v_id::text), jsonb_build_object('biz_id', v_id));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'message', '已提交审批');
END $$;

GRANT EXECUTE ON FUNCTION public.submit_biz(uuid, jsonb, text, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_biz(uuid, text, text) TO authenticated;

-- ============ 演示种子：采购申请的动作配置 ============
INSERT INTO public.meta_relations (id, tenant_id, source_form_id, target_form_id, name, relation_type, backfill_field, display_fields, multiple)
VALUES ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002',
        '采购关联报销', 'many_to_many', 'relatedExpenseIds', '["title","amount"]'::jsonb, true);

INSERT INTO public.meta_actions (tenant_id, form_id, position, name, icon, variant, action_type, config, show_condition, permission_code, confirm_text, success_text, after_behavior, sort) VALUES
-- 工具栏
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','toolbar','新增采购申请','plus','primary','CREATE','{}',NULL,'purchase:create',NULL,NULL,'none',1),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','toolbar','导出','download','secondary','EXPORT','{}',NULL,'purchase:export',NULL,'已导出当前列表','none',2),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','toolbar','打印','printer','secondary','PRINT','{}',NULL,NULL,NULL,NULL,'none',3),
-- 批量
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','batch','批量删除','trash-2','danger','DELETE','{}',NULL,'purchase:delete','确认删除所选单据？删除后不可恢复','已批量删除','refresh',1),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','batch','批量归档','archive','secondary','UPDATE_DATA','{"updates":{"archivedAt":"{{now}}"}}',NULL,NULL,'确认归档所选单据？','已批量归档','refresh',2),
-- 行操作
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','row','查看','eye','link','VIEW','{}',NULL,NULL,NULL,NULL,'none',1),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','row','编辑','pencil','link','EDIT','{}','{"==":[{"var":"status"},"draft"]}','purchase:edit',NULL,NULL,'none',2),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','row','删除','trash-2','danger','DELETE','{}','{"==":[{"var":"status"},"draft"]}','purchase:delete','确认删除该单据？','已删除','refresh',3),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','row','发起审批','send','secondary','START_WORKFLOW','{}','{"==":[{"var":"status"},"draft"]}','purchase:submit',NULL,'已提交审批','refresh',4),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','row','标记完成','check-circle-2','secondary','CHANGE_STATUS','{"stateMachineEvent":"complete","targetStatus":"completed","fieldMappings":{"completedBy":"{{currentUser.id}}","completedAt":"{{now}}"}}','{"==":[{"var":"status"},"approved"]}','purchase:complete','确认标记为已完成？','单据已完成','refresh',5),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','row','关联报销单','link-2','secondary','SELECT_RELATED','{"relationId":"a1000000-0000-0000-0000-000000000001"}','{"!=":[{"var":"status"},"draft"]}','purchase:relate',NULL,NULL,'refresh',6),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','row','查看关联','list-tree','link','VIEW_RELATED','{"relationId":"a1000000-0000-0000-0000-000000000001"}','{"!=":[{"var":"status"},"draft"]}',NULL,NULL,NULL,'none',7),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','row','报销列表','external-link','link','NAVIGATE','{"targetType":"form-list","targetFormId":"f0000000-0000-0000-0000-000000000002","openMode":"current"}',NULL,NULL,NULL,NULL,'none',8),
-- 表单底部/顶部
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','form-bottom','撤回申请','undo-2','secondary','WITHDRAW','{}','{"==":[{"var":"status"},"pending"]}',NULL,'确认撤回该申请？','已撤回为草稿','close',1),
('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','form-top','打印单据','printer','link','PRINT','{}',NULL,NULL,NULL,NULL,'none',1);