-- 状态机守卫条件增强：支持「当前表字段与字段」比较（value_type='field' 时 value 存右字段 key）
-- 同步补充操作符：大于等于（gte）、小于等于（lte）、不包含（ncontains）
CREATE OR REPLACE FUNCTION public.wf_apply_state_machine(p_biz_id uuid, p_event text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_row public.biz_data;
  v_sm record;
  v_trans jsonb;
  v_to text;
  v_ok boolean;
  v_k text;
  v_v text;
  v_value_type text;
  v_cur_val text;
  v_cur_status_label text;
  v_state_item jsonb;
  v_guard jsonb;
BEGIN
  SELECT * INTO v_row FROM public.biz_data WHERE id = p_biz_id;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_sm FROM public.meta_state_machine WHERE form_id = v_row.form_id ORDER BY updated_at DESC LIMIT 1;
  IF v_sm.id IS NULL OR v_sm.transitions IS NULL OR jsonb_array_length(v_sm.transitions) = 0 THEN
    RETURN v_row.status;
  END IF;

  -- 获取当前状态的中文 label（用于状态守卫条件的匹配）
  v_cur_status_label := v_row.status;
  IF v_sm.states IS NOT NULL THEN
    FOR v_state_item IN SELECT * FROM jsonb_array_elements(v_sm.states) LOOP
      IF v_state_item->>'key' = v_row.status THEN
        v_cur_status_label := v_state_item->>'label';
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- 查找匹配转换：from = v_row.status 且 event 匹配，且满足所有 guards
  FOR v_trans IN SELECT * FROM jsonb_array_elements(v_sm.transitions) LOOP
    IF (v_trans->>'from' = v_row.status OR (v_trans->>'from' IS NULL AND v_row.status IS NULL))
       AND (
         v_trans->>'event' = p_event
         OR (p_event = '审批通过' AND v_trans->>'event' IN ('通过', '同意', '审批通过'))
         OR (p_event = '驳回' AND v_trans->>'event' IN ('驳回', '拒绝'))
         OR (p_event = '提交' AND v_trans->>'event' IN ('提交', '发起', '申请'))
       ) THEN

      v_ok := true;
      -- 守卫条件检查
      IF v_trans ? 'guards' AND jsonb_typeof(v_trans->'guards') = 'array' AND jsonb_array_length(v_trans->'guards') > 0 THEN
        FOR v_guard IN SELECT * FROM jsonb_array_elements(v_trans->'guards') LOOP
          v_k := v_guard->>'field';
          v_v := v_guard->>'value';
          v_value_type := COALESCE(v_guard->>'value_type', 'value');

          -- 字段与字段比较：右值解析为当前单据中右字段的值（status 字段按状态 label 解析）
          IF v_value_type = 'field' THEN
            IF v_v = 'status' THEN
              v_v := v_cur_status_label;
            ELSE
              v_v := v_row.payload->>v_v;
            END IF;
          END IF;

          IF v_k = 'status' THEN
            -- status 字段：既可能是 key 也可能是 label
            CASE v_guard->>'op'
              WHEN 'eq' THEN
                v_ok := (v_v = v_row.status OR v_v = v_cur_status_label);
              WHEN 'ne' THEN
                v_ok := (v_v <> v_row.status AND v_v <> v_cur_status_label);
              ELSE
                v_ok := true;
            END CASE;
          ELSE
            v_cur_val := v_row.payload->>v_k;
            CASE v_guard->>'op'
              WHEN 'eq' THEN v_ok := (v_cur_val = v_v);
              WHEN 'ne' THEN v_ok := (v_cur_val <> v_v);
              WHEN 'gt' THEN v_ok := (v_cur_val::numeric > v_v::numeric);
              WHEN 'lt' THEN v_ok := (v_cur_val::numeric < v_v::numeric);
              WHEN 'gte' THEN v_ok := (v_cur_val::numeric >= v_v::numeric);
              WHEN 'lte' THEN v_ok := (v_cur_val::numeric <= v_v::numeric);
              WHEN 'contains' THEN v_ok := (v_cur_val LIKE '%' || v_v || '%');
              WHEN 'ncontains' THEN v_ok := (v_cur_val NOT LIKE '%' || v_v || '%');
              WHEN 'in' THEN v_ok := (string_to_array(v_v, ',') @> ARRAY[v_cur_val]);
              WHEN 'between' THEN v_ok := (v_cur_val::numeric BETWEEN split_part(v_v, ',', 1)::numeric AND split_part(v_v, ',', 2)::numeric);
              ELSE v_ok := true;
            END CASE;
          END IF;

          IF NOT v_ok THEN EXIT; END IF;
        END LOOP;
      END IF;

      -- 匹配成功且守卫满足
      IF v_ok THEN
        v_to := v_trans->>'to';
        UPDATE public.biz_data SET status = v_to, updated_at = now() WHERE id = p_biz_id;
        RETURN v_to;
      END IF;

    END IF;
  END LOOP;

  RETURN v_row.status;
END $function$;