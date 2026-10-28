-- ============================================================================
-- Low-code platform · 补齐 PostgREST 嵌套查询所需的关联约束
--
-- 背景：原始 db 备份不含外键，但前端大量使用形如
--   profiles?select=*,departments!profiles_department_id_fkey(name)
--   biz_data?select=*,profiles!inner(name),meta_forms!inner(name)
--   user_roles?select=roles!inner(name)
-- 的嵌套写法。PostgREST 靠真实外键识别表间关系，缺失会直接返回
-- PGRST200 "Could not find a relationship"，页面因此空白。
--
-- 做法：全部使用 NOT VALID 添加 ——
--   * PostgREST 依然能从 pg_constraint 识别关联（立即生效）
--   * 不校验历史数据，避免因脏数据导致添加失败
--   * 需要时可后续单独执行 ALTER TABLE ... VALIDATE CONSTRAINT 严格化
-- 幂等：已存在则跳过；单条失败不影响其他
-- ============================================================================

do $$
declare
  items text[][] := array[
    -- 约束名,                       子表,            列,            父表,            父列
    ['profiles_department_id_fkey', 'profiles',       'department_id', 'departments',  'id'],
    ['user_roles_role_id_fkey',     'user_roles',     'role_id',       'roles',        'id'],
    ['user_roles_user_id_fkey',     'user_roles',     'user_id',       'profiles',     'id'],
    ['biz_data_created_by_fkey',    'biz_data',       'created_by',    'profiles',     'id'],
    ['biz_data_form_id_fkey',       'biz_data',       'form_id',       'meta_forms',   'id'],
    ['biz_approval_biz_id_fkey',    'biz_approval',   'biz_id',        'biz_data',     'id'],
    ['biz_approval_form_id_fkey',   'biz_approval',   'form_id',       'meta_forms',   'id'],
    ['biz_approval_approver_fkey',  'biz_approval',   'approver_id',   'profiles',     'id'],
    ['meta_menu_form_id_fkey',      'meta_menu',      'form_id',       'meta_forms',   'id'],
    ['meta_actions_form_id_fkey',   'meta_actions',   'form_id',       'meta_forms',   'id'],
    ['meta_version_form_id_fkey',   'meta_version',   'form_id',       'meta_forms',   'id'],
    ['meta_workflow_form_id_fkey',  'meta_workflow',  'form_id',       'meta_forms',   'id'],
    ['meta_relations_source_fkey',  'meta_relations', 'source_form_id','meta_forms',   'id'],
    ['meta_relations_target_fkey',  'meta_relations', 'target_form_id','meta_forms',   'id'],
    ['departments_parent_id_fkey',  'departments',    'parent_id',     'departments',  'id'],
    ['departments_leader_id_fkey',  'departments',    'leader_id',     'profiles',     'id'],
    ['notifications_user_id_fkey',  'notifications',  'user_id',       'profiles',     'id'],
    ['audit_logs_user_id_fkey',     'audit_logs',     'user_id',       'profiles',     'id']
  ];
  i           int;
  v_name      text;
  v_child     text;
  v_col       text;
  v_parent    text;
  v_pcol      text;
  ok_cnt      int := 0;
  skip_cnt    int := 0;
  fail_cnt    int := 0;
  has_child   boolean;
  has_col     boolean;
begin
  for i in 1 .. array_length(items, 1) loop
    v_name   := items[i][1];
    v_child  := items[i][2];
    v_col    := items[i][3];
    v_parent := items[i][4];
    v_pcol   := items[i][5];

    -- 约束已存在则跳过
    if exists (select 1 from pg_constraint where conname = v_name) then
      skip_cnt := skip_cnt + 1;
      continue;
    end if;

    select exists (select 1 from information_schema.tables
                    where table_schema = 'public' and table_name = v_child)
      into has_child;
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_child and column_name = v_col)
      into has_col;

    if not has_child or not has_col then
      fail_cnt := fail_cnt + 1;
      raise notice '跳过(表或列不存在): %.% -> %', v_child, v_col, v_parent;
      continue;
    end if;

    begin
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.%I(%I) not valid',
        v_child, v_name, v_col, v_parent, v_pcol
      );
      ok_cnt := ok_cnt + 1;
    exception when others then
      fail_cnt := fail_cnt + 1;
      raise notice '失败 % : %', v_name, sqlerrm;
    end;
  end loop;

  raise notice '外键补齐：新增 %，已存在 %，失败 %', ok_cnt, skip_cnt, fail_cnt;
end $$;

-- 校验：当前 public 下的外键清单
select conrelid::regclass::text as child_table,
       conname                  as constraint_name,
       pg_get_constraintdef(oid) as definition,
       convalidated             as validated
  from pg_constraint
 where connamespace = 'public'::regnamespace
   and contype = 'f'
 order by 1, 2;
