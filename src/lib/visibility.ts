import type { VisibilityCondition, VisibilityRule } from '@/types';

/** 判断单个条件是否满足 */
function matchCondition(c: VisibilityCondition, values: Record<string, unknown>): boolean {
  const v = values[c.fieldKey];
  const isEmpty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  switch (c.op) {
    case 'empty':
      return isEmpty;
    case 'notempty':
      return !isEmpty;
    case 'eq':
      return !isEmpty && String(v) === c.value;
    case 'neq':
      return isEmpty || String(v) !== c.value;
    case 'contains':
      return !isEmpty && String(v).includes(c.value);
    default:
      return false;
  }
}

/** 判断一条显隐规则是否命中 */
function ruleMatched(rule: VisibilityRule, values: Record<string, unknown>): boolean {
  const conds = rule.conditions ?? [];
  if (conds.length === 0) return false;
  return rule.logic === 'or'
    ? conds.some((c) => matchCondition(c, values))
    : conds.every((c) => matchCondition(c, values));
}

/**
 * 根据当前表单值评估所有显隐规则，返回应被隐藏的字段 key 集合。
 * - action='hide'：命中时隐藏目标
 * - action='show'：未命中时隐藏目标
 */
export function evaluateVisibility(
  rules: VisibilityRule[] | undefined,
  values: Record<string, unknown>,
): Set<string> {
  const hidden = new Set<string>();
  if (!rules || rules.length === 0) return hidden;
  rules.forEach((rule) => {
    if (!rule.targetKey) return;
    const matched = ruleMatched(rule, values);
    const hide = rule.action === 'hide' ? matched : !matched;
    if (hide) hidden.add(rule.targetKey);
  });
  return hidden;
}