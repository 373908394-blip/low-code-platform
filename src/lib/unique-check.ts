import type { BizData, FormField } from '@/types';
import { supabase } from '@/db/supabase';

/**
 * 唯一字段保存校验：检查本表单内配置了 unique 的单行文本/手机号字段，
 * 新值是否与已有数据（未软删）重复。重复返回带字段名的错误文案，否则返回 null。
 * @param formId 所属表单 ID
 * @param fields 表单字段定义
 * @param payload 本次提交的数据
 * @param excludeId 编辑时排除自身记录 ID
 */
export async function checkUniqueFields(
  formId: string,
  fields: FormField[],
  payload: Record<string, unknown>,
  excludeId?: string,
): Promise<string | null> {
  const uniqFields = fields.filter((f) => f.unique === true);
  for (const f of uniqFields) {
    const v = payload[f.key];
    if (v === undefined || v === null || v === '') continue;
    let q = supabase.from('biz_data').select('id', { count: 'exact', head: true })
      .eq('form_id', formId)
      .eq('is_deleted', false)
      .filter(`payload->>${f.key}`, 'eq', String(v));
    if (excludeId) q = q.neq('id', excludeId);
    const { count } = await q;
    if ((count ?? 0) > 0) {
      return `「${f.label}」为唯一字段，已存在相同值「${String(v)}」，无法保存`;
    }
  }
  return null;
}
