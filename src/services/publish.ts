import { supabase } from '@/db/supabase';

/**
 * 含审批节点的表单发布后，调用后端 SECURITY DEFINER 函数，
 * 在工作台「待办事项」二级菜单下按应用名称生成「待我审批」「我申请的」两个三级菜单。
 * 由后端函数执行（绕过 meta_menu 的超管级 RLS），保证任意发布者都能生效。
 */
export async function ensureTodoMenu(fid: string) {
  try {
    await supabase.rpc('ensure_todo_menu', { p_form_id: fid });
    window.dispatchEvent(new CustomEvent('menu-updated'));
  } catch {
    // 菜单自动生成失败不影响发布主流程
  }
}