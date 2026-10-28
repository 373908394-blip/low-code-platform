-- 子表行即时入库后，原子回写主表 payload 中的行 id 引用（jsonb_set 合并，避免读-改-写竞态）
-- 权限与 biz_data UPDATE RLS 一致：同租户且（创建者或超管）；无权限时返回 false 由前端降级（主表保存/节点提交时写入）
create or replace function merge_biz_payload_field(p_biz_id uuid, p_field_key text, p_value jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row biz_data%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into v_row from biz_data where id = p_biz_id and not is_deleted;
  if not found then return false; end if;
  if v_row.tenant_id is distinct from get_my_tenant_id() then return false; end if;
  if v_row.created_by is distinct from auth.uid() and not is_superadmin() then return false; end if;
  update biz_data
    set payload = jsonb_set(coalesce(payload, '{}'::jsonb), array[p_field_key], p_value),
        updated_at = now(),
        updated_by = auth.uid()
    where id = p_biz_id;
  return true;
end;
$$;

revoke execute on function merge_biz_payload_field(uuid, text, jsonb) from public;
grant execute on function merge_biz_payload_field(uuid, text, jsonb) to authenticated;