-- 一次性数据导入 RPC（SECURITY DEFINER）：供管理脚本批量写入行政区划，导入完成后删除
CREATE OR REPLACE FUNCTION import_china_regions(payload json) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO china_regions (code, name, level, parent_code, province_code)
  SELECT
    (r->>'code')::text,
    (r->>'name')::text,
    (r->>'level')::int,
    NULLIF(r->>'parent_code', '')::text,
    NULLIF(r->>'province_code', '')::text
  FROM json_array_elements(payload) AS r;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION import_china_regions(json) TO anon, authenticated;