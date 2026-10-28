CREATE OR REPLACE FUNCTION public.my_visible_biz_ids(p_form_id uuid)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
  v_dept text;
  v_dept_tree text[];
  v_scope text;
  v_rules jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;

  -- 当前用户部门及子部门树（用于 dept_and_below）
  SELECT profiles.department_id::text INTO v_dept FROM public.profiles WHERE profiles.id = v_user;
  IF v_dept IS NOT NULL THEN
    WITH RECURSIVE tree AS (
      SELECT departments.id::text AS did FROM public.departments WHERE departments.id::text = v_dept
      UNION ALL
      SELECT d.id::text FROM public.departments d JOIN tree t ON d.parent_id::text = t.did
    )
    SELECT array_agg(did) INTO v_dept_tree FROM tree;
  END IF;

  -- 遍历当前用户的每个角色，取其 data_scope 与 row_rules，行可见性 = 任一角色允许
  FOR v_scope, v_rules IN
    SELECT r.data_scope, r.row_rules
    FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user AND r.status = 'enabled'
  LOOP
    IF v_scope = 'all' THEN
      RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant;
      RETURN;
    ELSIF v_scope = 'self' THEN
      -- 「仅本人」范围：本人创建的单据（已被移交给他人的不再显示） OR 本人是当前单据负责人（转移/分配的接收人立即可见并操作）
      RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant
        AND ((b.created_by = v_user AND (b.assignee_id IS NULL OR b.assignee_id = v_user OR b.assignee_id = b.created_by))
          OR b.assignee_id = v_user);
    ELSIF v_scope = 'dept' THEN
      RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant
        AND b.created_by IN (SELECT profiles.id FROM public.profiles WHERE profiles.department_id::text = v_dept);
    ELSIF v_scope = 'dept_and_below' THEN
      RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant
        AND b.created_by IN (SELECT profiles.id FROM public.profiles WHERE profiles.department_id::text = ANY(COALESCE(v_dept_tree, ARRAY[]::text[])));
    ELSIF v_scope = 'custom' THEN
      IF jsonb_typeof(v_rules) = 'array' AND jsonb_array_length(v_rules) > 0 THEN
        RETURN QUERY SELECT b.id FROM public.biz_data b WHERE b.form_id = p_form_id AND b.is_deleted = false AND b.tenant_id = v_tenant
          AND public.eval_row_rules(v_rules, b);
      END IF;
    END IF;
  END LOOP;
END $function$;