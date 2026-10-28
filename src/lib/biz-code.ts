import type { MetaForm } from '@/types';

/**
 * 从业务单据的 payload 中动态匹配单据编码：
 * 按表单 fields 元数据扫描值符合「前两位为大写字母 + 后续为数字」的字段值，
 * 命中则作为事项编码；无匹配时降级显示标题或业务名称，绝不回显原始 ID。
 */
export function resolveBizCode(form: MetaForm | null | undefined, payload: Record<string, unknown>, fallback?: string): string {
  const codePattern = /^[A-Z]{2}\d+/;
  if (form?.schema_json?.fields?.length) {
    for (const f of form.schema_json.fields) {
      const v = payload[f.key];
      if (v === undefined || v === null || v === '') continue;
      const s = String(v).trim();
      if (codePattern.test(s)) return s;
    }
  }
  return fallback?.trim() || form?.name || '未命名';
}
