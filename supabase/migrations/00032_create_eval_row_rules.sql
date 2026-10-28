CREATE OR REPLACE FUNCTION public.eval_row_rules(p_rules jsonb, p_row public.biz_data)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_k text;
  v_v text;
  v_ok boolean;
  v_group jsonb;
BEGIN
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' OR jsonb_array_length(p_rules) = 0 THEN
    RETURN true;
  END IF;
  -- 高级模式：单个带 logic 的组
  IF jsonb_array_length(p_rules) = 1 AND (p_rules->0) ? 'logic' THEN
    RETURN public.eval_rule_group(p_rules->0, p_row);
  END IF;
  -- 普通模式：RuleItem 数组 AND 组合
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
    IF (v_item ? 'logic') THEN
      IF NOT public.eval_rule_group(v_item, p_row) THEN RETURN false; END IF;
      CONTINUE;
    END IF;
    v_k := v_item->>'field';
    v_v := v_item->>'value';
    v_ok := false;
    CASE v_item->>'op'
      WHEN 'eq' THEN v_ok := ((p_row.payload->>v_k) = v_v);
      WHEN 'ne' THEN v_ok := ((p_row.payload->>v_k) <> v_v);
      WHEN 'gt' THEN v_ok := ((p_row.payload->>v_k)::numeric > v_v::numeric);
      WHEN 'lt' THEN v_ok := ((p_row.payload->>v_k)::numeric < v_v::numeric);
      WHEN 'contains' THEN v_ok := (p_row.payload->>v_k LIKE '%' || v_v || '%');
      WHEN 'in' THEN v_ok := (string_to_array(v_v, ',') @> ARRAY[p_row.payload->>v_k]);
      WHEN 'between' THEN v_ok := ((p_row.payload->>v_k)::numeric BETWEEN split_part(v_v, ',', 1)::numeric AND split_part(v_v, ',', 2)::numeric);
      ELSE v_ok := true;
    END CASE;
    IF NOT v_ok THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.eval_rule_group(p_group jsonb, p_row public.biz_data)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_logic text := p_group->>'logic';
  v_child jsonb;
  v_res boolean;
BEGIN
  IF v_logic = 'or' THEN
    FOR v_child IN SELECT * FROM jsonb_array_elements(p_group->'children') LOOP
      IF public.eval_rule_group_item(v_child, p_row) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  END IF;
  -- 默认 and
  FOR v_child IN SELECT * FROM jsonb_array_elements(p_group->'children') LOOP
    IF NOT public.eval_rule_group_item(v_child, p_row) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.eval_rule_group_item(p_item jsonb, p_row public.biz_data)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF (p_item ? 'logic') THEN
    RETURN public.eval_rule_group(p_item, p_row);
  END IF;
  RETURN public.eval_row_rules(jsonb_build_array(p_item), p_row);
END $function$;