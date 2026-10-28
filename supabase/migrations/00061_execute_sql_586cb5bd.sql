DO $$
DECLARE
  r RECORD;
  dk_sum numeric;
  hk_sum numeric;
  remain numeric;
  dk_arr text[];
  hk_arr text[];
BEGIN
  FOR r IN SELECT id, payload FROM biz_data WHERE form_id = '5c23e706-f7ab-431b-bbc6-74f692201dd9' AND is_deleted = false
  LOOP
    SELECT array_agg(value::text) INTO dk_arr
    FROM jsonb_array_elements_text(COALESCE(r.payload->'da_kuan_ji_lu', '[]'::jsonb));
    IF dk_arr IS NOT NULL AND array_length(dk_arr, 1) > 0 THEN
      SELECT COALESCE(SUM((payload->>'da_kuan_jin_e')::numeric), 0) INTO dk_sum
      FROM biz_data WHERE id::text = ANY(dk_arr) AND is_deleted = false;
    ELSE
      dk_sum := 0;
    END IF;

    SELECT array_agg(value::text) INTO hk_arr
    FROM jsonb_array_elements_text(COALESCE(r.payload->'hai_kuan_ji_lu', '[]'::jsonb));
    IF hk_arr IS NOT NULL AND array_length(hk_arr, 1) > 0 THEN
      SELECT COALESCE(SUM((payload->>'hai_kuan_jin_e')::numeric), 0) INTO hk_sum
      FROM biz_data WHERE id::text = ANY(hk_arr) AND is_deleted = false;
    ELSE
      hk_sum := 0;
    END IF;

    remain := dk_sum - hk_sum;
    UPDATE biz_data
    SET payload = payload || jsonb_build_object('da_kuan_zong_e', dk_sum, 'hai_kuan_zong_e', hk_sum, 'sheng_yu_hai_kuan_jin_e', remain),
        updated_at = now()
    WHERE id = r.id;
  END LOOP;
END $$;