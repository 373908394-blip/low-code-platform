CREATE OR REPLACE FUNCTION public.change_biz_status(p_biz_id uuid, p_event text, p_mappings jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_row public.biz_data;
  v_sm record;
  v_trans jsonb;
  v_to text;
  v_ok boolean;
  v_k text;
  v_v text;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_row FROM public.biz_data WHERE id = p_biz_id;
  IF v_row.id IS NULL OR v_row.tenant_id <> public.get_my_tenant_id() THEN RAISE EXCEPTION '无权操作该单据'; END IF;

  SELECT * INTO v_sm FROM public.meta_state_machine WHERE form_id = v_row.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_sm.id IS NULL THEN RAISE EXCEPTION '该表单未配置状态机'; END IF;

  -- 查找匹配当前状态 + 事件 的转换（取第一条命中）
  SELECT * INTO v_trans FROM jsonb_array_elements(v_sm.transitions) t
   WHERE t->>'from' = v_row.status AND t->>'event' = p_event LIMIT 1;

  IF v_trans IS NULL THEN
    RAISE EXCEPTION '当前状态「%」不支持事件「%」的转换', v_row.status, p_event;
  END IF;

  v_to := v_trans->>'to';

  -- 守卫条件校验（全部满足才允许）
  IF v_trans ? 'guards' AND jsonb_typeof(v_trans->'guards') = 'array' THEN
    FOR v_trans IN SELECT * FROM jsonb_array_elements(v_trans->'guards') LOOP
      v_k := v_trans->>'field';
      v_v := v_trans->>'value';
      v_ok := false;
      CASE v_trans->>'op'
        WHEN 'eq' THEN v_ok := ((v_row.payload->>v_k) = v_v);
        WHEN 'ne' THEN v_ok := ((v_row.payload->>v_k) <> v_v);
        WHEN 'gt' THEN v_ok := ((v_row.payload->>v_k)::numeric > v_v::numeric);
        WHEN 'lt' THEN v_ok := ((v_row.payload->>v_k)::numeric < v_v::numeric);
        WHEN 'contains' THEN v_ok := (v_row.payload->>v_k LIKE '%' || v_v || '%');
        WHEN 'in' THEN v_ok := (string_to_array(v_v, ',') @> ARRAY[v_row.payload->>v_k]);
        WHEN 'between' THEN v_ok := ((v_row.payload->>v_k)::numeric BETWEEN split_part(v_v, ',', 1)::numeric AND split_part(v_v, ',', 2)::numeric);
        ELSE v_ok := true;
      END CASE;
      IF NOT v_ok THEN RAISE EXCEPTION '状态机守卫条件不满足（% % %）', v_k, v_trans->>'op', v_v; END IF;
    END LOOP;
  END IF;

  v_payload := COALESCE(v_row.payload, '{}'::jsonb);
  IF jsonb_typeof(COALESCE(p_mappings, '{}'::jsonb)) = 'object' THEN
    FOR v_k IN SELECT jsonb_object_keys(COALESCE(p_mappings, '{}'::jsonb)) LOOP
      v_payload := v_payload || jsonb_build_object(v_k, p_mappings->v_k);
    END LOOP;
  END IF;

  UPDATE public.biz_data SET status = v_to, payload = v_payload, updated_at = now(), updated_by = v_user WHERE id = p_biz_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, target, detail)
  VALUES (v_tenant, v_user, (SELECT name FROM public.profiles WHERE id = v_user), '状态变更',
          COALESCE(v_row.title, p_biz_id::text),
          jsonb_build_object('event', p_event, 'from', v_row.status, 'to', v_to));

  RETURN jsonb_build_object('ok', true, 'status', v_to, 'message', '状态已变更为「' || v_to || '」');
END $function$;