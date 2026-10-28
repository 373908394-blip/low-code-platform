-- 1) 向导表单组件化迁移：form_mode='wizard' 的存量表单 → 普通表单 + wizard-step 容器字段（parentId 归属）
--    容器字段携带步骤名称/说明（layout.text/description），字段通过 parentId 指向容器；未分配字段归入最后一步
DO $$
DECLARE
  rec record;
  new_fields jsonb := '[]'::jsonb;
  st jsonb;
  fld jsonb;
  step_id text;
  i int;
  k text;
  last_step_id text;
  assigned_keys text[];
  unassigned_count int;
BEGIN
  FOR rec IN SELECT id, schema_json, steps FROM public.meta_forms WHERE form_mode = 'wizard' LOOP
    new_fields := '[]'::jsonb;
    assigned_keys := ARRAY[]::text[];
    last_step_id := NULL;

    IF rec.steps IS NULL OR jsonb_array_length(rec.steps) = 0 THEN
      -- 无步骤配置：生成一个默认步骤容器，全部业务字段归入该步骤
      i := 0;
      FOR st IN SELECT jsonb_build_object('title', '第 1 步', 'description', '', 'fieldKeys', '[]'::jsonb) LOOP
        i := i + 1;
      END LOOP;
      i := 1;
      step_id := 'ws_' || rec.id::text || '_1';
      last_step_id := step_id;
      new_fields := new_fields || jsonb_build_object(
        'id', step_id,
        'type', 'wizard-step',
        'label', '向导步骤',
        'key', 'layout_wiz_1',
        'span', 24,
        'layout', jsonb_build_object('text', '第 1 步', 'description', '', 'columns', 2)
      );
      FOR fld IN SELECT value FROM jsonb_array_elements(rec.schema_json->'fields') LOOP
        IF COALESCE((fld->>'system')::boolean, false) THEN CONTINUE; END IF;
        new_fields := new_fields || jsonb_set(fld, '{parentId}', to_jsonb(step_id));
      END LOOP;
    ELSE
      i := 0;
      FOR st IN SELECT value FROM jsonb_array_elements(rec.steps) LOOP
        i := i + 1;
        step_id := 'ws_' || rec.id::text || '_' || i;
        last_step_id := step_id;
        new_fields := new_fields || jsonb_build_object(
          'id', step_id,
          'type', 'wizard-step',
          'label', '向导步骤',
          'key', 'layout_wiz_' || i,
          'span', 24,
          'layout', jsonb_build_object('text', COALESCE(st->>'title', '步骤 ' || i), 'description', COALESCE(st->>'description', ''), 'columns', 2)
        );
        FOR k IN SELECT jsonb_array_elements_text(COALESCE(st->'fieldKeys', '[]'::jsonb)) LOOP
          FOR fld IN SELECT value FROM jsonb_array_elements(rec.schema_json->'fields') WHERE value->>'key' = k LOOP
            new_fields := new_fields || jsonb_set(fld, '{parentId}', to_jsonb(step_id));
            assigned_keys := assigned_keys || k;
          END LOOP;
        END LOOP;
      END LOOP;
      -- 未分配字段归入最后一步
      FOR fld IN SELECT value FROM jsonb_array_elements(rec.schema_json->'fields') LOOP
        IF COALESCE((fld->>'system')::boolean, false) THEN CONTINUE; END IF;
        IF fld->>'key' = ANY (assigned_keys) OR fld->>'key' IS NULL THEN CONTINUE; END IF;
        new_fields := new_fields || jsonb_set(fld, '{parentId}', to_jsonb(COALESCE(last_step_id, 'ws_' || rec.id::text || '_1')));
      END LOOP;
    END IF;

    UPDATE public.meta_forms
    SET form_mode = 'normal',
        schema_json = jsonb_set(COALESCE(schema_json, '{}'::jsonb), '{fields}', new_fields),
        steps = '[]'::jsonb,
        updated_at = now()
    WHERE id = rec.id;

    RAISE NOTICE 'wizard 表单已迁移: % (容器步骤 % 个)', rec.id, i;
  END LOOP;
END $$;

-- 2) 假勤管理：插入默认「销假」行操作（FILL_NODE，显示条件=待销假状态，启用条件=当前填写人）
INSERT INTO public.meta_actions (tenant_id, form_id, position, name, icon, variant, action_type, config, show_condition, enable_condition, sort)
SELECT f.tenant_id, f.id, 'row', '销假', 'pencil-line', 'link', 'FILL_NODE', '{}'::jsonb,
       '{"==":[{"var":"status"},"待销假"]}'::jsonb,
       '{"==":[{"var":"canFill"},true]}'::jsonb,
       (SELECT COALESCE(MAX(a.sort), 0) + 1 FROM public.meta_actions a WHERE a.form_id = f.id)
FROM public.meta_forms f
WHERE f.name = '假勤管理'
  AND NOT EXISTS (SELECT 1 FROM public.meta_actions a WHERE a.form_id = f.id AND a.action_type = 'FILL_NODE');