import { supabase } from '@/db/supabase';
import type {
  Announcement, ApiKey, AuditLog, BizApproval, BizData, Department, MetaForm,
  MetaMenu, MetaStateMachine, MetaVersion, MetaWorkflow, Notification, Profile,
  Role, SysSettings,
} from '@/types';

// ============ 部门 ============
export const listDepartments = () => supabase.from('departments').select('*').order('sort_order');
export const createDepartment = (d: Partial<Department>) => supabase.from('departments').insert(d);
export const updateDepartment = (id: string, d: Partial<Department>) => supabase.from('departments').update(d).eq('id', id);
export const deleteDepartment = (id: string) => supabase.from('departments').delete().eq('id', id);

// ============ 员工 ============
export const listProfiles = () => supabase.from('profiles').select('*, departments!profiles_department_id_fkey(name), user_roles(role_id, roles(id, name, status))');
export const createProfile = (p: Partial<Profile>) => supabase.from('profiles').insert(p);
export const updateProfile = (id: string, p: Partial<Profile>) => supabase.from('profiles').update(p).eq('id', id);
export const setUserRoles = (userId: string, tenantId: string, roleIds: string[]) =>
  supabase.rpc('set_user_roles' as never, { p_user_id: userId, p_tenant_id: tenantId, p_role_ids: roleIds } as never);
export const resetUserPassword = (userId: string, newPassword: string) =>
  supabase.rpc('admin_reset_password' as never, { p_user_id: userId, p_new_password: newPassword } as never);

// ============ 角色 ============
export const listRoles = () => supabase.from('roles').select('*').order('created_at');
export const createRole = (r: Partial<Role>) => supabase.from('roles').insert(r);
export const updateRole = (id: string, r: Partial<Role>) => supabase.from('roles').update(r).eq('id', id);
export const deleteRole = (id: string) => supabase.from('roles').delete().eq('id', id);

// ============ 元数据：表单 ============
export const listForms = () => supabase.from('meta_forms').select('*').order('updated_at', { ascending: false });
export const getForm = (id: string) => supabase.from('meta_forms').select('*').eq('id', id).maybeSingle();
export const createForm = (f: Partial<MetaForm>) => supabase.from('meta_forms').insert(f);
export const updateForm = (id: string, f: Partial<MetaForm>) => supabase.from('meta_forms').update(f).eq('id', id);
export const deleteForm = (id: string) => supabase.from('meta_forms').delete().eq('id', id);

// ============ 元数据：菜单 ============
export const listMenus = () => supabase.from('meta_menu').select('*').order('sort_order');
export const createMenu = (m: Partial<MetaMenu>) => supabase.from('meta_menu').insert(m);
export const updateMenu = (id: string, m: Partial<MetaMenu>) => supabase.from('meta_menu').update(m).eq('id', id);
export const deleteMenu = (id: string) => supabase.from('meta_menu').delete().eq('id', id);

// ============ 元数据：流程 / 状态机 / 版本 ============
export const getWorkflowByForm = (formId: string) => supabase.from('meta_workflow').select('*').eq('form_id', formId).maybeSingle();
export const saveWorkflow = (w: Partial<MetaWorkflow>) => supabase.from('meta_workflow').upsert(w, { onConflict: 'form_id' } as never);
export const getStateMachineByForm = (formId: string) => supabase.from('meta_state_machine').select('*').eq('form_id', formId).maybeSingle();
export const saveStateMachine = (sm: Partial<MetaStateMachine>) => supabase.from('meta_state_machine').upsert(sm, { onConflict: 'form_id' } as never);
export const listVersions = (formId: string) => supabase.from('meta_version').select('*').eq('form_id', formId).order('version', { ascending: false });
export const createVersion = (v: Partial<MetaVersion>) => supabase.    from('meta_version').insert(v);

// ============ 业务数据 ============
export const listBizData = (formId: string) => supabase.from('biz_data').select('*, profiles!inner(name)').eq('form_id', formId).eq('is_deleted', false).order('created_at', { ascending: false });
export const createBizData = (d: Partial<BizData>) => supabase.from('biz_data').insert(d);
export const updateBizData = (id: string, d: Partial<BizData>) => supabase.from('biz_data').update(d).eq('id', id);
export const deleteBizData = (id: string) => supabase.from('biz_data').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', id);

// ============ 审批 ============
export const listApprovals = (bizId: string) => supabase.from('biz_approval').select('*').eq('biz_id', bizId).order('created_at');
export const getMyTodos = () =>
  supabase.from('biz_approval').select('*, biz_data!inner(id, title, status, created_at, profiles!inner(name)), meta_forms!inner(name, icon)').eq('state', 'pending').eq('current', true);
export const submitBiz = (bizId: string) => supabase.rpc('submit_biz', { p_biz_id: bizId });
export const approveBiz = (bizId: string, action: 'approve' | 'reject', comment?: string) =>
  supabase.rpc('approve_biz', { p_biz_id: bizId, p_action: action, p_comment: comment ?? '' });
/** 填写节点确认：提交确认字段内容并推进流程（服务端校验填写人） */
export const fillNodeBiz = (bizId: string, data: Record<string, unknown>) =>
  supabase.rpc('fill_node_biz', { p_biz_id: bizId, p_data: data });

// ============ 公告 / 通知 / 设置 / 日志 ============
export const listAnnouncements = () => supabase.from('announcements').select('*').order('created_at', { ascending: false });
export const createAnnouncement = (a: Partial<Announcement>) => supabase.from('announcements').insert(a);
export const deleteAnnouncement = (id: string) => supabase.from('announcements').delete().eq('id', id);
export const listNotifications = () => supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(20);
export const markNotificationRead = (id: string) => supabase.from('notifications').update({ read: true }).eq('id', id);
export const getSettings = () => supabase.from('sys_settings').select('*').maybeSingle();
export const updateSettings = (tenantId: string, s: Partial<SysSettings>) => supabase.from('sys_settings').update(s).eq('tenant_id', tenantId);
export const listAuditLogs = () => supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
export const listApiKeys = () => supabase.from('api_keys').select('*').order('created_at', { ascending: false });
export const createApiKey = (k: Partial<ApiKey>) => supabase.from('api_keys').insert(k);
export const deleteApiKey = (id: string) => supabase.from('api_keys').delete().eq('id', id);
