-- 请假时间组件保存后业务层面拆分为独立的开始/结束时间字段（YYYY-MM-DD HH:mm）：
-- 1) 假勤表单 schema 新增 start_at/end_at 字段并绑定到 leave-time 组件
-- 2) 列表列改为展示拆分后的开始/结束时间与请假天数/小时
-- 3) 销假节点确认字段改为拆分后的时间字段（可编辑、即时自动保存重算）
-- 4) 存量单据按 set_time 复合值补写 start_at/end_at

UPDATE meta_forms
SET schema_json = jsonb_set(schema_json, '{fields}', '[
  {"id":"f_1789878274286_l4t9","key":"form_number","label":"请假编号","required":true,"serialRules":[{"id":"sr_1789878274286_1","type":"fixed","value":"QJ"},{"format":"yyyyMMdd","id":"sr_1789878274286_2","type":"date"},{"digits":5,"id":"sr_1789878274286_3","pad":true,"resetCycle":"never","start":1,"type":"counter"}],"span":12,"type":"serial-number"},
  {"id":"f_1789878339227_gk03","key":"set_time","label":"请假时间设置","leaveTime":{"daysKey":"day","hoursKey":"time","startKey":"start_at","endKey":"end_at"},"required":true,"span":24,"type":"leave-time"},
  {"id":"f_1789882098222_sz8x","key":"day","label":"请假天数","placeholder":"","span":12,"type":"input"},
  {"id":"f_1789882098686_gr54","key":"time","label":"请假小时","span":12,"type":"input"},
  {"id":"f_lt_start_at","key":"start_at","label":"开始时间","span":12,"type":"datetime"},
  {"id":"f_lt_end_at","key":"end_at","label":"结束时间","span":12,"type":"datetime"},
  {"id":"f_1789878380509_jxgb","key":"reason","label":"请假原因","required":true,"span":24,"type":"textarea"},
  {"id":"sys_user_name","key":"user_name","label":"员工姓名","readOnly":true,"span":12,"system":true,"type":"input"},
  {"id":"sys_dept_name","key":"dept_name","label":"所属部门","readOnly":true,"span":12,"system":true,"type":"input"},
  {"id":"sys_position","key":"position","label":"职位","readOnly":true,"span":12,"system":true,"type":"input"},
  {"id":"sys_status","key":"status","label":"状态","readOnly":true,"span":12,"system":true,"type":"input"},
  {"id":"sys_created_by","key":"created_by","label":"创建人","readOnly":true,"span":12,"system":true,"type":"input"},
  {"id":"sys_created_at","key":"created_at","label":"创建时间","readOnly":true,"span":12,"system":true,"type":"input"},
  {"id":"sys_updated_by","key":"updated_by","label":"更新人","readOnly":true,"span":12,"system":true,"type":"input"},
  {"id":"sys_updated_at","key":"updated_at","label":"更新时间","readOnly":true,"span":12,"system":true,"type":"input"},
  {"id":"f_1789894022169_mnlp","key":"field_14","label":"个别销假","options":["请假已通过，请假当前由于特殊原因又出勤了"],"span":24,"type":"checkbox","valueAssign":[{"id":"va_1789894077535_h93v","targetKey":"day","value":"0","whenValue":"请假已通过，请假当前由于特殊原因又出勤了"},{"id":"va_1789894092462_vao8","targetKey":"time","value":"0","whenValue":"请假已通过，请假当前由于特殊原因又出勤了"}]}
]'::jsonb),
list_config = '{
  "actions": ["view","edit","delete"],
  "columns": [
    {"align":"left","format":"none","key":"form_number","label":"请假编号"},
    {"align":"left","format":"datetime","key":"start_at","label":"开始时间"},
    {"align":"left","format":"datetime","key":"end_at","label":"结束时间"},
    {"align":"left","format":"none","key":"day","label":"请假天数"},
    {"align":"left","format":"none","key":"time","label":"请假小时"},
    {"align":"left","format":"none","key":"reason","label":"请假原因"},
    {"align":"left","format":"none","key":"created_by","label":"创建人"},
    {"align":"left","format":"none","key":"created_at","label":"创建时间"}
  ],
  "search": [
    {"control":"input","key":"created_by","label":"创建人"},
    {"control":"input","key":"created_at","label":"创建时间"}
  ]
}'::jsonb,
updated_at = now()
WHERE id = '71229a1d-1ffa-4c25-b7fd-f1ea953f579d';

-- 销假节点：确认字段改为拆分后的开始/结束时间字段，权限设为可编辑
UPDATE meta_workflow w
SET nodes = (
  SELECT jsonb_agg(
    CASE WHEN node->>'id' = 'n_mu9m6gwa'
      THEN node
        || jsonb_build_object('confirmFields', '["field_14","start_at","end_at"]'::jsonb)
        || jsonb_build_object('fieldPermissions', '{"day":"visible","field_14":"editable","reason":"visible","time":"visible","start_at":"editable","end_at":"editable"}'::jsonb)
      ELSE node END
    ORDER BY ord
  )
  FROM jsonb_array_elements(w.nodes) WITH ORDINALITY AS t(node, ord)
),
updated_at = now()
WHERE w.form_id = '71229a1d-1ffa-4c25-b7fd-f1ea953f579d';

-- 存量单据补写拆分后的开始/结束时间（格式 YYYY-MM-DD HH:00）
UPDATE biz_data
SET payload = payload || jsonb_build_object(
  'start_at', concat_ws(' ', payload->'set_time'->>'start_date', lpad(payload->'set_time'->>'start_time', 2, '0') || ':00'),
  'end_at', concat_ws(' ', payload->'set_time'->>'end_date', lpad(payload->'set_time'->>'end_time', 2, '0') || ':00')
),
updated_at = now()
WHERE form_id = '71229a1d-1ffa-4c25-b7fd-f1ea953f579d'
  AND payload ? 'set_time'
  AND payload->'set_time' ?& array['start_date','start_time','end_date','end_time']
  AND payload->'set_time'->>'start_date' IS NOT NULL
  AND payload->'set_time'->>'start_date' <> ''
  AND payload->'set_time'->>'start_time' IS NOT NULL
  AND payload->'set_time'->>'end_time' IS NOT NULL
  AND NOT (payload ? 'start_at');