-- 部门增加主管字段
ALTER TABLE public.departments ADD COLUMN leader_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 重写审批人解析：部门主管逐级向上查找，无匹配则回退超管
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
    -- 全路径均无主管：回退超级管理员
    RETURN (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM public.profiles WHERE is_superadmin AND status = 'active');
  ELSE
    RETURN COALESCE(p_node->'approver_value', '[]'::jsonb);
  END IF;
END $$;