-- 低代码管理系统开发平台 · 核心 Schema（多租户 tenant_id 逻辑隔离 + RLS）
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  subdomain text UNIQUE,
  plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  employee_no text,
  email text,
  department_id uuid,
  position text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  is_superadmin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  data_scope text NOT NULL DEFAULT 'self' CHECK (data_scope IN ('all','dept_and_below','dept','self','custom')),
  menu_perms jsonb NOT NULL DEFAULT '[]'::jsonb,
  button_perms jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  col_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);

CREATE TABLE public.meta_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  icon text,
  version int NOT NULL DEFAULT 1,
  published_version int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  list_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE public.meta_menu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.meta_menu(id) ON DELETE CASCADE,
  name text NOT NULL,
  path text,
  icon text NOT NULL DEFAULT 'layout',
  sort_order int NOT NULL DEFAULT 0,
  menu_type text NOT NULL DEFAULT 'form' CHECK (menu_type IN ('form','list','dashboard','custom')),
  form_id uuid REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  visible_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.meta_workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  name text NOT NULL,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.meta_state_machine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  states jsonb NOT NULL DEFAULT '[]'::jsonb,
  transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.meta_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  version int NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  changelog text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.biz_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  title text,
  amount numeric(14,2),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta_version int NOT NULL DEFAULT 1
);

CREATE TABLE public.biz_approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  biz_id uuid NOT NULL REFERENCES public.biz_data(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.meta_forms(id) ON DELETE CASCADE,
  node_name text NOT NULL,
  approver_type text NOT NULL DEFAULT 'user' CHECK (approver_type IN ('user','role','dept_leader','initiator_choice','multi_level_leader')),
  approvers jsonb NOT NULL DEFAULT '[]'::jsonb,
  mode text NOT NULL DEFAULT 'or' CHECK (mode IN ('countersign','or','sequential')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','skipped')),
  acts jsonb NOT NULL DEFAULT '[]'::jsonb,
  current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  category text NOT NULL DEFAULT 'notice' CHECK (category IN ('notice','update','guide')),
  publisher text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  type text NOT NULL DEFAULT 'todo' CHECK (type IN ('todo','info','system')),
  read boolean NOT NULL DEFAULT false,
  biz_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sys_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  system_name text NOT NULL DEFAULT '云枢低代码',
  logo_url text,
  login_bg_url text,
  login_welcome text DEFAULT '欢迎使用低代码管理系统',
  theme_color text NOT NULL DEFAULT '#D54200',
  notify_config jsonb NOT NULL DEFAULT '{"sms":false,"email":false,"inapp":true}'::jsonb,
  backup_config jsonb NOT NULL DEFAULT '{"auto":false,"frequency":"weekly"}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  user_name text,
  action text NOT NULL,
  target text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_preview text NOT NULL,
  key_hash text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ SECURITY DEFINER 辅助函数 ============
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT tenant_id FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE((SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()), false) $$;

-- ============ 索引 ============
CREATE INDEX idx_profiles_tenant ON public.profiles(tenant_id);
CREATE INDEX idx_departments_tenant ON public.departments(tenant_id);
CREATE INDEX idx_roles_tenant ON public.roles(tenant_id);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_meta_forms_tenant ON public.meta_forms(tenant_id);
CREATE INDEX idx_meta_menu_tenant ON public.meta_menu(tenant_id);
CREATE INDEX idx_meta_workflow_form ON public.meta_workflow(form_id);
CREATE INDEX idx_biz_data_tenant_form ON public.biz_data(tenant_id, form_id);
CREATE INDEX idx_biz_data_tenant_form_created ON public.biz_data(tenant_id, form_id, created_at DESC);
CREATE INDEX idx_biz_data_payload_gin ON public.biz_data USING gin (payload);
CREATE INDEX idx_biz_approval_biz ON public.biz_approval(biz_id);
CREATE INDEX idx_biz_approval_current ON public.biz_approval(form_id, current);
CREATE INDEX idx_notifications_user ON public.notifications(user_id, read);
CREATE INDEX idx_announcements_tenant ON public.announcements(tenant_id);
CREATE INDEX idx_audit_logs_tenant ON public.audit_logs(tenant_id, created_at DESC);

-- ============ RLS ============
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_state_machine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biz_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biz_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sys_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_profiles_sel ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR tenant_id = public.get_my_tenant_id());
CREATE POLICY p_profiles_ins_admin ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_profiles_ins_signup ON public.profiles FOR INSERT TO authenticated WITH CHECK (NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY p_profiles_upd_admin ON public.profiles FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_profiles_upd_self ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY p_profiles_del_admin ON public.profiles FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_depts_sel ON public.departments FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_depts_ins ON public.departments FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_depts_upd ON public.departments FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_depts_del ON public.departments FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_roles_sel ON public.roles FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_roles_ins ON public.roles FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_roles_upd ON public.roles FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_roles_del ON public.roles FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_user_roles_sel ON public.user_roles FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_user_roles_ins ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_user_roles_del ON public.user_roles FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_meta_forms_sel ON public.meta_forms FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_meta_forms_ins ON public.meta_forms FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_meta_forms_upd ON public.meta_forms FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_meta_forms_del ON public.meta_forms FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_meta_menu_sel ON public.meta_menu FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_meta_menu_ins ON public.meta_menu FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_meta_menu_upd ON public.meta_menu FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_meta_menu_del ON public.meta_menu FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_meta_wf_sel ON public.meta_workflow FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_meta_wf_ins ON public.meta_workflow FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_meta_wf_upd ON public.meta_workflow FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_meta_wf_del ON public.meta_workflow FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_meta_sm_sel ON public.meta_state_machine FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_meta_sm_ins ON public.meta_state_machine FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_meta_sm_upd ON public.meta_state_machine FOR UPDATE TO authenticated USING (public.is_superadmin());
CREATE POLICY p_meta_sm_del ON public.meta_state_machine FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_meta_ver_sel ON public.meta_version FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_meta_ver_ins ON public.meta_version FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_meta_ver_del ON public.meta_version FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_biz_sel ON public.biz_data FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_biz_ins ON public.biz_data FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_my_tenant_id() AND created_by = auth.uid());
CREATE POLICY p_biz_upd ON public.biz_data FOR UPDATE TO authenticated USING (tenant_id = public.get_my_tenant_id() AND (public.is_superadmin() OR created_by = auth.uid()));
CREATE POLICY p_biz_del ON public.biz_data FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_appr_sel ON public.biz_approval FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_appr_upd ON public.biz_approval FOR UPDATE TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_appr_ins ON public.biz_approval FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY p_ann_sel ON public.announcements FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_ann_ins ON public.announcements FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_ann_del ON public.announcements FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_noti_sel ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_superadmin());
CREATE POLICY p_noti_ins ON public.notifications FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_noti_upd ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY p_noti_del ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.is_superadmin());

CREATE POLICY p_sys_sel ON public.sys_settings FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_sys_upd ON public.sys_settings FOR UPDATE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_audit_sel ON public.audit_logs FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_audit_ins ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_audit_del ON public.audit_logs FOR DELETE TO authenticated USING (public.is_superadmin());

CREATE POLICY p_api_sel ON public.api_keys FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY p_api_ins ON public.api_keys FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());
CREATE POLICY p_api_del ON public.api_keys FOR DELETE TO authenticated USING (public.is_superadmin());

-- ============ 演示种子数据 ============
INSERT INTO public.tenants (id, name, subdomain, plan) VALUES
  ('00000000-0000-0000-0000-000000000001', '云枢演示科技有限公司', 'demo', 'pro');

INSERT INTO public.sys_settings (tenant_id) VALUES
  ('00000000-0000-0000-0000-000000000001');

INSERT INTO public.departments (id, tenant_id, name, parent_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', '总公司', NULL, 0),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', '技术部', '00000000-0000-0000-0000-000000000101', 1),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', '市场部', '00000000-0000-0000-0000-000000000101', 2),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', '财务部', '00000000-0000-0000-0000-000000000101', 3);

INSERT INTO public.roles (id, tenant_id, name, description, data_scope, menu_perms, button_perms) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', '超级管理员', '拥有全部权限', 'all', '["all"]', '["all"]'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', '部门审批员', '负责本部门审批流转', 'dept', '["workbench","purchase","project"]', '["view","approve","edit"]'),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001', '普通员工', '仅本人数据', 'self', '["workbench"]', '["view","create"]');

INSERT INTO public.announcements (tenant_id, title, content, category, publisher) VALUES
  ('00000000-0000-0000-0000-000000000001', '9月20日 22:00 系统升级维护', '系统将于 9 月 20 日 22:00–24:00 进行版本升级，期间暂停服务，请提前保存工作。', 'notice', '运营团队'),
  ('00000000-0000-0000-0000-000000000001', '流程设计器上线并行网关', '本次更新支持并行网关节点，多条分支可同时执行，全部完成后自动汇聚。', 'update', '产品团队'),
  ('00000000-0000-0000-0000-000000000001', 'Excel 批量导入员工指引', '用户管理支持 Excel 批量导入，下载模板后按列填写即可，重复手机号将被跳过。', 'guide', '帮助中心');