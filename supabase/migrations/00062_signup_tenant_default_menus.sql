-- 注册初始化：新租户默认仅「工作台 + 系统设置」两棵系统菜单树（不预置业务模块）
CREATE OR REPLACE FUNCTION public.signup_tenant(p_company text, p_name text, p_phone text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_role uuid;
  v_dept uuid;
  v_user uuid := auth.uid();
  v_root_wb uuid;
  v_grp_todo uuid;
  v_root_sys uuid;
  v_grp_org uuid;
  v_grp_set uuid;
  v_grp_dsg uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION '未登录，无法初始化租户'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user) THEN RAISE EXCEPTION '该账号已完成初始化'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE name = p_company) THEN RAISE EXCEPTION '企业名称已存在，请更换'; END IF;

  INSERT INTO public.tenants (name) VALUES (p_company) RETURNING id INTO v_tenant;
  INSERT INTO public.departments (tenant_id, name, parent_id, sort_order) VALUES (v_tenant, '总部', NULL, 0) RETURNING id INTO v_dept;
  INSERT INTO public.profiles (id, tenant_id, name, phone, email, department_id, position, status, is_superadmin)
    VALUES (v_user, v_tenant, p_name, p_phone, (SELECT email FROM auth.users WHERE id = v_user), v_dept, '超级管理员', 'active', true);
  INSERT INTO public.roles (tenant_id, name, description, data_scope, menu_perms, button_perms)
    VALUES (v_tenant, '超级管理员', '拥有全部权限', 'all', '["all"]', '["all"]') RETURNING id INTO v_role;
  INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES (v_tenant, v_user, v_role);
  INSERT INTO public.sys_settings (tenant_id) VALUES (v_tenant);

  -- ===== 工作台（系统菜单）=====
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, NULL, '工作台', 'layout', 0, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_root_wb;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_wb, '总览', 'chart', 1, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_grp_todo;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_todo, '工作台', 'home', 1, 'custom', NULL, '/', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_wb, '待办事项', 'boxes', 2, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true);

  -- ===== 系统设置（系统菜单）=====
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, NULL, '系统设置', 'settings', 9, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_root_sys;

  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_sys, '组织与权限', 'users', 1, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_grp_org;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_org, '用户管理', 'user-cog', 1, 'custom', NULL, '/users', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_org, '角色管理', 'shield', 2, 'custom', NULL, '/roles', '["all"]'::jsonb, 'published', true);

  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_sys, '系统设置', 'wrench', 2, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_grp_set;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_set, '系统设置', 'sliders', 1, 'custom', NULL, '/settings', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_set, '我的年假', 'boxes', 2, 'custom', NULL, '/my-leave', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_set, '我的信息', 'boxes', 3, 'custom', NULL, '/my-profile', '["all"]'::jsonb, 'published', true);

  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_root_sys, '设计中心', 'grid', 3, 'custom', NULL, NULL, '["all"]'::jsonb, 'published', true)
    RETURNING id INTO v_grp_dsg;
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_dsg, '菜单管理', 'menu', 1, 'custom', NULL, '/design/menus', '["all"]'::jsonb, 'published', true);
  INSERT INTO public.meta_menu (tenant_id, parent_id, name, icon, sort_order, menu_type, form_id, path, visible_roles, status, is_system)
    VALUES (v_tenant, v_grp_dsg, '应用列表', 'boxes', 2, 'custom', NULL, '/design/apps', '["all"]'::jsonb, 'published', true);

  RETURN v_tenant;
END $$;