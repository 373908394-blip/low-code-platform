-- ============================================================================
-- Low-code platform · 迁移后登录修复
-- 目标：
--   1) 关闭"邮箱必须确认"造成的登录拦截 —— 确认所有已注册但未确认的邮箱
--   2) 让备份里的老账号可以登录 —— 为 public.profiles 中缺失认证记录的账号补建 auth.users，
--      且 auth 用户 ID 与 profiles.id 完全一致（应用按 profiles.id = auth.uid() 加载资料）
--   3) 若登录账号没有 profile，克隆一份超级管理员资料（否则登录后进不去任何数据）
-- 默认密码：Demo@2026（可在下方全局变量处修改）
-- 幂等：重复执行不会重复建号
-- 执行位置：Supabase Dashboard → SQL Editor
-- ============================================================================

-- 0) 准备（Supabase 的 pgcrypto 在 extensions schema 下）
create extension if not exists pgcrypto with schema extensions;

-- 1) 确认所有未确认的邮箱（解决 email_not_confirmed）
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at         = now()
 where email_confirmed_at is null;

-- 2) 为老账号补建认证记录（ID 与 profiles.id 一致）
do $$
declare
  p           record;
  created_cnt int := 0;
  skipped_cnt int := 0;
  v_pwd       text := 'Demo@2026';
begin
  for p in
    select pr.id, pr.email, pr.name
      from public.profiles pr
     where coalesce(pr.email, '') <> ''
       and not exists (
             select 1 from auth.users u
              where u.id = pr.id or lower(u.email) = lower(pr.email)
           )
  loop
    begin
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000'::uuid,
        p.id,
        'authenticated',
        'authenticated',
        lower(p.email),
        extensions.crypt(v_pwd, extensions.gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', p.name),
        '', '', '', ''
      );

      -- 新版 GoTrue 需要 identities 记录，缺失会导致部分登录/注册流程报
      -- "Database error querying schema"，这里补齐并容错
      begin
        insert into auth.identities (
          id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
        ) values (
          p.id, p.id, p.id::text,
          jsonb_build_object('sub', p.id::text, 'email', lower(p.email), 'email_verified', true),
          'email', now(), now(), now()
        );
      exception when others then
        raise notice 'identities 跳过 % : %', p.email, sqlerrm;
      end;

      created_cnt := created_cnt + 1;
    exception when others then
      skipped_cnt := skipped_cnt + 1;
      raise notice '建号失败 % : %', p.email, sqlerrm;
    end;
  end loop;

  raise notice '老账号补建完成：新建 % 个，失败 % 个', created_cnt, skipped_cnt;
end $$;

-- 3) 登录账号若没有 profile，克隆现有超管资料（仅当该账号无 profile 时执行）
do $$
begin
  insert into public.profiles
  select (jsonb_populate_record(
            null::public.profiles,
            to_jsonb(src.j) || jsonb_build_object(
              'id',         u.id,
              'email',      u.email,
              'name',       coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1)),
              'created_at', now()
            )
          )).*
    from (select to_jsonb(p) as j
            from public.profiles p
           where p.is_superadmin
           order by p.created_at
           limit 1) src
   cross join auth.users u
   where not exists (select 1 from public.profiles p2 where p2.id = u.id)
     and exists (select 1 from public.profiles p3 where p3.is_superadmin);

  raise notice 'profile 补齐完成';
exception when others then
  raise notice 'profile 补齐跳过（不影响老账号登录）：%', sqlerrm;
end $$;

-- 4) 校验结果
select
  (select count(*) from public.profiles)                                   as profiles_total,
  (select count(*) from auth.users)                                        as auth_users_total,
  (select count(*) from auth.users where email_confirmed_at is null)       as unconfirmed_users,
  (select count(*) from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id))       as profile_without_login,
  (select count(*) from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id))  as login_without_profile;
