import { supabase } from '@/db/supabase';
import { BIZ_STATUS_LABELS } from '@/lib/field-catalog';
import type { BizData, RuleItem, SmInteraction } from '@/types';

export interface SmStateInfo {
  label: string;
  color?: string;
}

export interface SmTransitionInfo {
  id: string;
  from: string;
  to: string;
  event: string;
  guards?: RuleItem[];
  /** 流转交互配置（人员分配/内容提交/内容确定），列表按钮触发时使用 */
  interaction?: SmInteraction | null;
}

/** 单个表单的状态机数据：状态表 + 迁移列表 */
export interface FormSmData {
  states: Map<string, SmStateInfo>;
  transitions: SmTransitionInfo[];
}

/** formId → 状态机数据（状态表 + 迁移） */
export type FormSmMap = Map<string, FormSmData>;

/** 批量加载多个表单的状态机（状态定义 + 迁移），供列表按状态机名称展示、按迁移守卫判断按钮 */
export async function loadFormSm(formIds: (string | undefined | null)[]): Promise<FormSmMap> {
  const ids = [...new Set((formIds.filter(Boolean) as string[]))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('meta_state_machine').select('form_id, states, transitions').in('form_id', ids);
  const res: FormSmMap = new Map();
  ((data ?? []) as {
    form_id: string;
    states?: { key: string; label: string; color?: string }[];
    transitions?: { id: string; from: string; to: string; event: string; guards?: RuleItem[] }[];
  }[]).forEach((row) => {
    const states = new Map<string, SmStateInfo>();
    (row.states ?? []).forEach((s) => states.set(s.key, { label: s.label, color: s.color }));
    res.set(row.form_id, { states, transitions: row.transitions ?? [] });
  });
  return res;
}

/** 解析状态显示文本：优先表单状态机自定义名称，其次内置标签，最后原样返回 */
export function resolveStatusLabel(formId: string | undefined | null, status: string | undefined | null, map: FormSmMap): string {
  const data = formId ? map.get(formId) : undefined;
  if (data && status) {
    const info = data.states.get(status);
    if (info) return info.label;
  }
  return BIZ_STATUS_LABELS[status ?? ''] ?? status ?? '—';
}

/** 解析状态颜色（来自表单状态机自定义颜色） */
export function resolveStatusColor(formId: string | undefined | null, status: string | undefined | null, map: FormSmMap): string | undefined {
  const data = formId ? map.get(formId) : undefined;
  if (data && status) return data.states.get(status)?.color;
  return undefined;
}

/** 单条守卫规则比较（操作符：eq/ne/gt/lt/gte/lte/contains/ncontains/in/between）；空值/类型不匹配安全降级为 false */
function cmpRule(op: RuleItem['op'], actual: string, expected: string): boolean {
  const a = actual.trim();
  const e = expected.trim();
  switch (op) {
    case 'eq': return a === e;
    case 'ne': return a !== e;
    case 'contains': return a.includes(e);
    case 'ncontains': return !a.includes(e);
    case 'gt': return Number(actual) > Number(expected);
    case 'lt': return Number(actual) < Number(expected);
    case 'gte': return Number(actual) >= Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    case 'in': return expected.split(',').map((s) => s.trim()).includes(actual);
    case 'between': {
      const parts = expected.split(',').map((s) => Number(s.trim()));
      const n = Number(actual);
      return parts.length === 2 && n >= parts[0] && n <= parts[1];
    }
    default: return true;
  }
}

/** 守卫操作符中文标签（设计器徽章与运行时阻断提示共用） */
export const GUARD_OP_LABELS: Record<RuleItem['op'], string> = {
  eq: '等于', ne: '不等于', gt: '大于', lt: '小于', gte: '大于等于', lte: '小于等于',
  contains: '包含', ncontains: '不包含', in: '属于', between: '介于',
};

/** 评估状态机守卫条件（RuleItem[]，AND 关系）。status 字段按状态机 label 解析后比较。
 * 右值支持设定值（value_type='value'，默认）与当前表字段（value_type='field'，value 存右字段 key）。 */
export function evalSmGuards(guards: RuleItem[] | undefined, biz: BizData, formId: string | undefined | null, map: FormSmMap): boolean {
  if (!guards || guards.length === 0) return true;
  const data = formId ? map.get(formId) : undefined;
  const resolveField = (field: string): string => {
    if (field === 'status') {
      const info = data?.states.get(biz.status);
      return info?.label ?? biz.status;
    }
    return String((biz.payload as Record<string, unknown>)?.[field] ?? '');
  };
  return guards.every((g) => {
    const actual = resolveField(g.field);
    // 右值为当前表字段：取右字段当前值比较（字段-字段比较，如 打款金额 大于 借款金额）
    const expected = (g.value_type ?? 'value') === 'field' ? resolveField(g.value) : g.value;
    return cmpRule(g.op, actual, expected);
  });
}

/** 流程填写节点守卫校验：合并单据现有数据与本次填写数据后逐条评估（AND 关系，规则与状态机守卫一致）。
 * 全部满足返回 pass=true；存在未满足规则时返回具体原因描述（含字段名），供提交阻断提示。 */
export function checkWfNodeGuards(
  guards: RuleItem[] | undefined,
  merged: Record<string, unknown>,
  fieldLabel: (key: string) => string,
): { pass: boolean; failed?: string } {
  if (!guards || guards.length === 0) return { pass: true };
  for (const g of guards) {
    if (!g.field || !g.value) continue;
    const actual = String(merged?.[g.field] ?? '');
    // 右值为当前表字段：取合并数据中右字段当前值比较（字段-字段比较）
    const expected = (g.value_type ?? 'value') === 'field' ? String(merged?.[g.value] ?? '') : g.value;
    if (!cmpRule(g.op, actual, expected)) {
      const right = (g.value_type ?? 'value') === 'field' ? `「${fieldLabel(g.value)}」` : `「${g.value}」`;
      return { pass: false, failed: `「${fieldLabel(g.field)}」${GUARD_OP_LABELS[g.op] ?? g.op}${right}，条件未满足` };
    }
  }
  return { pass: true };
}
