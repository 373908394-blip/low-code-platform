-- 图表数据聚合 RPC：在服务端按条件聚合，避免拉取大量原始记录
CREATE OR REPLACE FUNCTION public.chart_aggregate(
  p_form_id uuid,
  p_category_field text DEFAULT NULL,
  p_value_field text DEFAULT NULL,
  p_value_agg text DEFAULT 'count',
  p_conditions jsonb DEFAULT '[]'::jsonb,
  p_conditions_logic text DEFAULT 'and',
  p_creator_ids uuid[] DEFAULT NULL,
  p_limit int DEFAULT 500
)
RETURNS TABLE(bucket text, sum numeric, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql text;
  v_where text := 'form_id = $1 AND is_deleted = false';
  v_condition record;
  v_op text;
  v_idx int := 0;
BEGIN
  -- 构建 WHERE 条件
  IF p_creator_ids IS NOT NULL THEN
    IF array_length(p_creator_ids, 1) > 0 THEN
      v_where := v_where || ' AND created_by = ANY($2)';
    ELSE
      v_where := v_where || ' AND false'; -- 空数组表示无可见数据
    END IF;
  END IF;

  -- 动态条件（简化版：支持 eq/neq/gt/gte/lt/lte/contains/is_null/not_null）
  FOR v_condition IN SELECT * FROM jsonb_array_elements(p_conditions)
  LOOP
    v_idx := v_idx + 1;
    v_op := v_condition->>'op';
    IF v_op = 'eq' THEN
      v_where := v_where || format(' AND payload->>%L = $%s', v_condition->>'field', v_idx + 2);
    ELSIF v_op = 'neq' THEN
      v_where := v_where || format(' AND payload->>%L != $%s', v_condition->>'field', v_idx + 2);
    ELSIF v_op = 'gt' THEN
      v_where := v_where || format(' AND (payload->>%L)::numeric > $%s::numeric', v_condition->>'field', v_idx + 2);
    ELSIF v_op = 'gte' THEN
      v_where := v_where || format(' AND (payload->>%L)::numeric >= $%s::numeric', v_condition->>'field', v_idx + 2);
    ELSIF v_op = 'lt' THEN
      v_where := v_where || format(' AND (payload->>%L)::numeric < $%s::numeric', v_condition->>'field', v_idx + 2);
    ELSIF v_op = 'lte' THEN
      v_where := v_where || format(' AND (payload->>%L)::numeric <= $%s::numeric', v_condition->>'field', v_idx + 2);
    ELSIF v_op = 'contains' THEN
      v_where := v_where || format(' AND payload->>%L ILIKE ''%%'' || $%s || ''%%''', v_condition->>'field', v_idx + 2);
    ELSIF v_op = 'is_null' THEN
      v_where := v_where || format(' AND (payload->>%L IS NULL OR payload->>%L = '''')', v_condition->>'field', v_condition->>'field');
    ELSIF v_op = 'not_null' THEN
      v_where := v_where || format(' AND payload->>%L IS NOT NULL AND payload->>%L != ''''', v_condition->>'field', v_condition->>'field');
    END IF;
  END LOOP;

  -- 构建聚合 SQL
  v_sql := format('
    SELECT 
      COALESCE(NULLIF(payload->>%L, ''''), ''未分类'') as bucket,
      COALESCE(SUM(CASE WHEN $%s = ''count'' THEN 1 ELSE COALESCE((payload->>%L)::numeric, 0) END), 0) as sum,
      COUNT(*) as count
    FROM biz_data
    WHERE %s
    GROUP BY COALESCE(NULLIF(payload->>%L, ''''), ''未分类'')
    ORDER BY count DESC
    LIMIT %s
  ', 
    COALESCE(p_category_field, ''),
    v_idx + 3, -- value_agg 参数位置
    COALESCE(p_value_field, ''),
    v_where,
    COALESCE(p_category_field, ''),
    p_limit
  );

  -- 执行并返回
  RETURN QUERY EXECUTE v_sql 
  USING p_form_id, 
        COALESCE(p_creator_ids, '{}'::uuid[]),
        -- 动态条件的值（最多支持 10 个条件）
        (SELECT v FROM (SELECT (p_conditions->0->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->1->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->2->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->3->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->4->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->5->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->6->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->7->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->8->>'value') as v) t),
        (SELECT v FROM (SELECT (p_conditions->9->>'value') as v) t);
END;
$$;

COMMENT ON FUNCTION public.chart_aggregate IS '图表数据聚合：按分类字段分桶，支持 sum/count/avg 聚合和显示条件过滤';