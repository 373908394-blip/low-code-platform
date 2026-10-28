import { createElement } from 'react';
import type { DataRange, Department, FormField, LeaveTimeValue, PageField, Profile, WorkHours } from '@/types';

/** 数据范围过滤上下文 */
export interface ScopeContext {
  dataRange?: DataRange;
  /** 当 dataRange='permission' 时，当前账号由角色解析出的有效数据范围 */
  permissionScope?: DataRange;
  profile: Pick<Profile, 'id' | 'department_id'>;
  departments: Department[];
  profiles: Pick<Profile, 'id' | 'department_id'>[];
}

/**
 * 根据数据范围计算「创建人 id 集合」。
 * 返回 null 表示不限制（全部数据）；返回数组则业务数据需满足 created_by ∈ 集合。
 * - permission → 取 permissionScope（角色数据权限）解析，默认 all
 * - all        → null（全部）
 * - mine       → [当前用户]
 * - dept       → 当前用户所在部门的全部成员
 * - dept_sub   → 当前用户所在部门及其所有下级部门的全部成员
 */
export function buildCreatorScope(ctx: ScopeContext): string[] | null {
  const { dataRange, permissionScope, profile, departments, profiles } = ctx;
  // 跟随权限：以角色解析出的有效数据范围为准
  const effective = dataRange === 'permission' ? (permissionScope ?? 'all') : dataRange;
  if (!effective || effective === 'all') return null;
  if (effective === 'mine') return profile.id ? [profile.id] : [];
  const deptId = profile.department_id;
  if (!deptId) return profile.id ? [profile.id] : [];
  // 收集目标部门 id 集合
  const targetDeptIds = new Set<string>();
  targetDeptIds.add(deptId);
  if (effective === 'dept_sub') {
    // 递归收集所有下级部门
    const stack = [deptId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const d of departments) {
        if (d.parent_id === cur && !targetDeptIds.has(d.id)) {
          targetDeptIds.add(d.id);
          stack.push(d.id);
        }
      }
    }
  }
  const ids = profiles.filter((p) => p.department_id && targetDeptIds.has(p.department_id)).map((p) => p.id);
  return ids.length > 0 ? ids : [];
}

/** 9 大类字段组件目录（表单设计器左侧组件库） */
export interface FieldCategory {
  key: string;
  label: string;
  /** 该类目下组件定义 */
  fields: FieldDef[];
}

export interface FieldDef {
  type: string;
  label: string;
  icon: string;
  /** 默认栅格宽度 */
  span: number;
}

/** 单页设计组件目录 */
export interface PageFieldDef {
  type: PageField['type'];
  label: string;
  icon: string;
  span: number;
}

/** 单页设计组件分类 */
export interface PageFieldCategory {
  key: string;
  label: string;
  fields: PageFieldDef[];
}

/** 单页设计组件目录（分类） */
export const PAGE_FIELD_CATALOG: PageFieldCategory[] = [
  {
    key: 'filter',
    label: '筛选组件',
    fields: [
      { type: 'page-year', label: '年份筛选', icon: 'calendar', span: 6 },
      { type: 'page-date', label: '日期筛选', icon: 'calendar-clock', span: 6 },
      { type: 'page-date-range', label: '日期范围', icon: 'calendar-range', span: 12 },
      { type: 'page-time', label: '时间筛选', icon: 'clock', span: 6 },
    ],
  },
  {
    key: 'data',
    label: '数据展示',
    fields: [
      { type: 'page-query', label: '查询表单', icon: 'search', span: 24 },
      { type: 'page-text-display', label: '文本显示', icon: 'file-text', span: 6 },
      { type: 'page-leave-info', label: '我的年假信息', icon: 'calendar-days', span: 24 },
    ],
  },
  {
    key: 'chart',
    label: '图表组件',
    fields: [
      { type: 'page-chart-bar', label: '柱状图', icon: 'bar-chart-3', span: 12 },
      { type: 'page-chart-line', label: '曲线图', icon: 'line-chart', span: 12 },
      { type: 'page-chart-area', label: '面积图', icon: 'area-chart', span: 12 },
      { type: 'page-chart-hbar', label: '条形图', icon: 'bar-chart-horizontal', span: 12 },
      { type: 'page-chart-pie', label: '饼图', icon: 'pie-chart', span: 12 },
      { type: 'page-chart-radar', label: '雷达图', icon: 'radar', span: 12 },
      { type: 'page-chart-funnel', label: '漏斗图', icon: 'filter', span: 12 },
    ],
  },
  {
    key: 'calc',
    label: '计算字段',
    fields: [
      { type: 'page-summary', label: '汇总统计', icon: 'calculator', span: 6 },
      { type: 'page-formula', label: '公式计算', icon: 'sigma', span: 6 },
    ],
  },
  {
    key: 'layout',
    label: '布局组件',
    fields: [
      { type: 'page-group-title', label: '分组标题', icon: 'heading', span: 24 },
      { type: 'page-grid', label: '分栏布局', icon: 'columns-3', span: 24 },
      { type: 'page-layout', label: '页面布局', icon: 'layout', span: 24 },
      { type: 'page-divider', label: '分割线', icon: 'minus', span: 24 },
      { type: 'page-description', label: '说明文字', icon: 'info', span: 24 },
    ],
  },
  {
    key: 'actions',
    label: '按钮与动作',
    fields: [
      { type: 'page-action-button', label: '自定义按钮', icon: 'zap', span: 12 },
    ],
  },
];

export const FIELD_CATALOG: FieldCategory[] = [
  {
    key: 'basic',
    label: '基础字段',
    fields: [
      { type: 'input', label: '单行文本', icon: 'type', span: 12 },
      { type: 'phone', label: '手机号', icon: 'smartphone', span: 12 },
      { type: 'textarea', label: '多行文本', icon: 'align-left', span: 24 },
      { type: 'number', label: '数字', icon: 'hash', span: 12 },
      { type: 'date', label: '日期', icon: 'calendar', span: 12 },
      { type: 'time', label: '时间', icon: 'clock', span: 12 },
      { type: 'datetime', label: '日期时间', icon: 'calendar-clock', span: 12 },
      { type: 'money', label: '金额', icon: 'banknote', span: 12 },
      { type: 'percent', label: '百分比', icon: 'percent', span: 12 },
    ],
  },
  {
    key: 'select',
    label: '选择字段',
    fields: [
      { type: 'select', label: '下拉单选', icon: 'chevron-down-square', span: 12 },
      { type: 'system-status', label: '系统状态（读状态机）', icon: 'circle-dot', span: 12 },
      { type: 'search-select', label: '带搜索的下拉单选', icon: 'search-square', span: 12 },
      { type: 'address', label: '地址（省/市/区县）', icon: 'map-pin', span: 12 },
      { type: 'multi-select', label: '下拉多选', icon: 'list-checks', span: 12 },
      { type: 'search-multi-select', label: '带搜索的下拉多选', icon: 'square-check-check', span: 12 },
      { type: 'radio', label: '单选按钮', icon: 'circle-dot', span: 12 },
      { type: 'checkbox', label: '多选按钮', icon: 'square-check', span: 12 },
      { type: 'switch', label: '开关', icon: 'toggle-right', span: 12 },
    ],
  },
  {
    key: 'advanced',
    label: '高级字段',
    fields: [
      { type: 'user-select', label: '人员选择', icon: 'user', span: 12 },
      { type: 'dept-select', label: '部门选择', icon: 'building-2', span: 12 },
      { type: 'serial-number', label: '流水号', icon: 'file-digit', span: 12 },
      { type: 'leave-time', label: '请假时间设置', icon: 'calendar-range', span: 24 },
      { type: 'file', label: '附件上传', icon: 'paperclip', span: 12 },
      { type: 'image', label: '图片上传', icon: 'image', span: 12 },
      { type: 'richtext', label: '富文本', icon: 'file-text', span: 12 },
      { type: 'location', label: '定位', icon: 'map-pin', span: 12 },
    ],
  },
  {
    key: 'relation',
    label: '关联字段',
    fields: [
      { type: 'form-ref', label: '关联表单', icon: 'link', span: 12 },
      { type: 'query', label: '查询表单', icon: 'search', span: 24 },
      { type: 'sub-table', label: '关联子表', icon: 'table', span: 24 },
      { type: 'fetch-value', label: '关联取值', icon: 'arrow-down-up', span: 12 },
      { type: 'form-assignment', label: '表单赋值', icon: 'file-input', span: 12 },
    ],
  },
  {
    key: 'calc',
    label: '计算字段',
    fields: [
      { type: 'formula', label: '公式计算', icon: 'sigma', span: 12 },
      { type: 'summary', label: '汇总统计', icon: 'calculator', span: 12 },
      { type: 'amount-uppercase', label: '大写金额', icon: 'case-upper', span: 12 },
    ],
  },
  {
    key: 'layout',
    label: '布局组件',
    fields: [
      { type: 'group-title', label: '分组标题', icon: 'heading', span: 24 },
      { type: 'wizard-step', label: '向导步骤', icon: 'list-ordered', span: 24 },
      { type: 'grid', label: '分栏布局', icon: 'columns-3', span: 24 },
      { type: 'divider', label: '分割线', icon: 'minus', span: 24 },
      { type: 'description', label: '说明文字', icon: 'info', span: 24 },
    ],
  },
  {
    key: 'actions',
    label: '按钮与动作',
    fields: [
      { type: 'action-button', label: '自定义按钮', icon: 'zap', span: 24 },
    ],
  },
];

export const ALL_FIELDS: FieldDef[] = FIELD_CATALOG.flatMap((c) => c.fields);

export function findFieldDef(type: string): FieldDef | undefined {
  return ALL_FIELDS.find((f) => f.type === type);
}

/** 系统内置字段：员工姓名/所属部门/职位/创建人/创建时间/更新人/更新时间/状态（审批状态），保存时由数据库自动记录或派生展示 */
export const SYSTEM_FIELD_KEYS = ['user_name', 'dept_name', 'position', 'created_by', 'created_at', 'updated_by', 'updated_at', 'status'] as const;

export const SYSTEM_FIELDS: FormField[] = [
  { id: 'sys_user_name', type: 'input', label: '员工姓名', key: 'user_name', span: 12, system: true, readOnly: true },
  { id: 'sys_dept_name', type: 'input', label: '所属部门', key: 'dept_name', span: 12, system: true, readOnly: true },
  { id: 'sys_position', type: 'input', label: '职位', key: 'position', span: 12, system: true, readOnly: true },
  { id: 'sys_created_by', type: 'input', label: '创建人', key: 'created_by', span: 12, system: true, readOnly: true },
  { id: 'sys_created_at', type: 'input', label: '创建时间', key: 'created_at', span: 12, system: true, readOnly: true },
  { id: 'sys_updated_by', type: 'input', label: '更新人', key: 'updated_by', span: 12, system: true, readOnly: true },
  { id: 'sys_updated_at', type: 'input', label: '更新时间', key: 'updated_at', span: 12, system: true, readOnly: true },
  { id: 'sys_status', type: 'input', label: '状态', key: 'status', span: 12, system: true, readOnly: true },
];

/** 下拉类组件关联表单数据源的统一显示字段解析：fieldKeys 多字段勾选优先，历史单字段 fieldKey 自动按 [fieldKey] 兼容 */
export const optionDisplayKeys = (f: FormField): string[] => {
  const cfg = f.optionSource;
  if (!cfg?.formId) return [];
  if (cfg.fieldKeys?.length) return cfg.fieldKeys;
  return cfg.fieldKey ? [cfg.fieldKey] : [];
};

/**
 * 关联表单数据源行数据字段取值格式化：
 * 支持普通字段、address 地址对象、嵌套对象、系统字段（创建人/员工姓名/状态/创建时间等）的友好文本格式化，
 * 避免地址等对象字段显示为 [object Object]，以及系统字段（user_name/created_at/status）缺失回显
 */
export const formatOptionFieldValue = (
  key: string,
  row: { payload?: Record<string, unknown> | null; status?: string | null; created_at?: string | null; updated_at?: string | null; created_by?: string | null; assignee_name?: string | null } | undefined,
  nameMap?: Map<string, string>,
  smStateMap?: Map<string, { label: string }>,
): string => {
  if (!row) return '';
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  let v = payload[key];

  // 系统字段从 row 实体取值回退（表单数据 payload 未持久化系统字段时）
  if (v === undefined || v === null || v === '') {
    if (key === 'status') {
      const s = row.status ?? '';
      return (smStateMap?.get(s)?.label ?? BIZ_STATUS_LABELS[s] ?? s) || '';
    }
    if (key === 'created_at') {
      return row.created_at ? fmtDate(row.created_at, false) : '';
    }
    if (key === 'updated_at') {
      return row.updated_at ? fmtDate(row.updated_at, false) : '';
    }
    if (key === 'created_by') {
      return (row.created_by && nameMap?.get(row.created_by)) ?? row.created_by ?? '';
    }
    if (key === 'user_name') {
      // 员工姓名/申请人回退：优先从 payload['user_name']，次之创建人名称
      return (row.created_by && nameMap?.get(row.created_by)) ?? '';
    }
    if (key === 'assignee_name') {
      return row.assignee_name ?? '';
    }
  }

  if (v === undefined || v === null || v === '') return '';

  // 状态系统字段特殊展示中文
  if (key === 'status') {
    const s = String(v);
    return smStateMap?.get(s)?.label ?? BIZ_STATUS_LABELS[s] ?? s;
  }

  // 日期/时间字段
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/.test(v)) {
    return fmtDate(v, true);
  }

  // address 地址对象格式化: { province, city, district, detail }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    if ('province' in obj || 'city' in obj || 'district' in obj) {
      const parts = [obj.province, obj.city, obj.district].filter(Boolean).map(String);
      return parts.join(' ');
    }
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  }

  // 数组
  if (Array.isArray(v)) {
    return v.map((item) => {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if ('province' in obj || 'city' in obj || 'district' in obj) {
          return [obj.province, obj.city, obj.district].filter(Boolean).map(String).join(' ');
        }
        return JSON.stringify(item);
      }
      return String(item);
    }).join('、');
  }

  return String(v);
};

/** 单据审批状态中文标签 */
export const BIZ_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  completed: '已完成',
  xiaojia: '待销假',
  xiaojiazhong: '销假中',
  cancelled: '已取消',
  skipped: '已跳过',
};

/** 销假相关状态（待销假/销假中）：申请人需进行销假（填写）操作 */
export const LEAVE_CANCEL_STATUSES = ['xiaojia', 'xiaojiazhong'];
export const isLeaveCancelStatus = (s?: string | null) => !!s && LEAVE_CANCEL_STATUSES.includes(s);

/** 系统字段取值上下文：用户档案与部门映射 */
export type SysProfile = { name: string; position?: string | null; department_id?: string | null };

export interface SysFieldCtx {
  profileMap: Map<string, SysProfile>;
  deptMap: Map<string, string>;
  /** 当前表单状态机自定义状态（key → 名称）：status 系统字段展示优先取自定义名称，避免显示原始状态标识 */
  smStates?: Map<string, { label: string; color?: string }>;
}

/** 计算系统字段展示值（员工姓名/所属部门/职位/创建人/创建时间/更新人/更新时间/状态） */
export function systemFieldValue(
  key: string,
  biz: { created_by?: string | null; updated_by?: string | null; created_at?: string | null; updated_at?: string | null; status?: string | null },
  ctx: SysFieldCtx,
): unknown {
  const creator = biz.created_by ? ctx.profileMap.get(biz.created_by) : undefined;
  switch (key) {
    case 'user_name':
      return creator?.name ?? biz.created_by ?? null;
    case 'dept_name': {
      const deptId = creator?.department_id;
      return deptId ? (ctx.deptMap.get(deptId) ?? null) : null;
    }
    case 'position':
      return creator?.position ?? null;
    case 'created_by':
      return creator?.name ?? biz.created_by ?? null;
    case 'updated_by':
      return biz.updated_by ? (ctx.profileMap.get(biz.updated_by)?.name ?? biz.updated_by) : null;
    case 'created_at':
      return biz.created_at ?? null;
    case 'updated_at':
      return biz.updated_at ?? null;
    case 'status':
      // 优先状态机自定义状态名称，其次内置标签，最后原样返回（避免显示原始状态标识）
      return ctx.smStates?.get(biz.status ?? '')?.label ?? BIZ_STATUS_LABELS[biz.status ?? ''] ?? biz.status ?? null;
    default:
      return null;
  }
}

/** 审计类系统字段（创建人/时间等，值由数据库列或行数据派生）；
 *  仅固定审计字段键走审计派生取值；普通组件标记的系统默认字段（含流水号/公式/汇总/关联取值/表单赋值）
 *  值存于 payload（保存时自动生成或由赋值映射回填），不属于审计派生 */
export const isAuditSystemField = (f: FormField) =>
  f.system === true &&
  (SYSTEM_FIELD_KEYS as readonly string[]).includes(f.key) &&
  !['serial-number', 'formula', 'summary', 'fetch-value', 'form-assignment'].includes(f.type);

/** 补齐缺失的系统字段（新建表单、打开存量表单、运行时渲染统一调用） */
export function ensureSystemFields(fields: FormField[]): FormField[] {
  const missing = SYSTEM_FIELDS.filter((s) => !fields.some((f) => f.key === s.key));
  if (missing.length === 0) return fields;
  return [...fields, ...missing.map((m) => ({ ...m }))];
}

/** 从数据载荷中剔除系统字段（真实值由数据库列维护，防客户端伪造） */
export function stripSystemFields(payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!SYSTEM_FIELD_KEYS.includes(k as (typeof SYSTEM_FIELD_KEYS)[number])) next[k] = v;
  }
  return next;
}

/** 公式表达式求值：{key} 引用当前表单字段值，{refKey.targetKey} 引用关联表单选中记录（取第一条）的字段值；仅支持四则运算与括号，引用值缺失或非数字时整体返回 null */
/** 数字金额转中文大写金额（人民币）：1234.56 → 壹仟贰佰叁拾肆元伍角陆分；0 → 零元整；空/非法值返回空串 */
export function toChineseAmount(n: number | string | null | undefined): string {
  const num = n === null || n === undefined || n === '' ? NaN : Number(n);
  if (Number.isNaN(num)) return '';
  const cents = Math.round(Math.abs(num) * 100);
  if (cents === 0) return '零元整';
  const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const UNITS = ['', '拾', '佰', '仟'];
  const BIG = ['', '万', '亿', '兆'];
  let yuan = Math.floor(cents / 100);
  const jiao = Math.floor((cents % 100) / 10);
  const fen = cents % 10;
  // 整数部分：低位到高位按 4 位分组转换后拼接（组间与组内按规范补「零」）
  let intPart = '';
  let group = 0;
  let lowerZero = false; // 低位存在整组为零，需要在下一段后补零
  while (yuan > 0) {
    const g = yuan % 10000;
    if (g === 0) {
      lowerZero = intPart !== '';
    } else {
      let s = '';
      let zero = false;
      let rest = g;
      for (let i = 0; i < 4; i++) {
        const d = rest % 10;
        rest = Math.floor(rest / 10);
        if (d === 0) {
          if (s !== '') zero = true;
        } else {
          if (zero) {
            s = `零${s}`;
            zero = false;
          }
          s = DIGITS[d] + UNITS[i] + s;
        }
      }
      // 低位段非空且本段以零开头（万位为 0）或低位存在零段时，段间补「零」
      const needZero = intPart !== '' && (g < 1000 || g % 10 === 0 || lowerZero);
      intPart = s + BIG[group] + (needZero ? '零' : '') + intPart;
      lowerZero = false;
    }
    yuan = Math.floor(yuan / 10000);
    group += 1;
  }
  // 角分部分：有角带分、无角有分补零、无角无分加「整」
  let tail = '';
  if (jiao > 0) {
    tail = DIGITS[jiao] + '角' + (fen > 0 ? DIGITS[fen] + '分' : '');
  } else if (fen > 0) {
    tail = (intPart !== '' ? '零' : '') + DIGITS[fen] + '分';
  }
  const body = intPart === '' ? tail : intPart + '元' + tail;
  return (num < 0 ? '负' : '') + (tail === '' ? `${body}整` : body);
}

export function evalFormulaExpression(
  expression: string,
  values: Record<string, unknown>,
  refRecords: Record<string, Record<string, unknown> | undefined>,
): number | null {
  if (!expression.trim()) return null;
  let complete = true;
  const js = expression.replace(/\{([^{}]+)\}/g, (_m, ref: string) => {
    const token = String(ref).trim();
    let raw: unknown;
    if (token.includes('.')) {
      const [rk, ...rest] = token.split('.');
      raw = refRecords[rk]?.[rest.join('.')];
    } else {
      raw = values[token];
    }
    const n = parseNumericLike(raw) ?? NaN;
    if (!Number.isFinite(n)) { complete = false; return 'NaN'; }
    return `(${n})`;
  });
  if (!complete) return null;
  // 白名单校验：仅允许数字、四则运算符、括号与空白
  if (!/^[\d+\-*/().\s]+$/.test(js)) return null;
  try {
    const r = Function(`"use strict";return (${js});`)() as unknown;
    const n = typeof r === 'number' ? r : Number(r);
    return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
  } catch {
    return null;
  }
}

/** 汇总聚合：rows 支持 BizData（含 payload）或纯 payload 记录；sum/avg 仅累计数值型值 */
export function aggregateRows(aggregate: 'count' | 'sum' | 'avg', fieldKey: string, rows: Array<{ payload?: Record<string, unknown> } | Record<string, unknown>>): number | null {
  if (aggregate === 'count') return rows.length;
  if (!fieldKey) return null;
  const nums: number[] = [];
  rows.forEach((r) => {
    const p = (r && typeof r === 'object' && 'payload' in (r as Record<string, unknown>)) ? ((r as { payload?: Record<string, unknown> }).payload ?? {}) : (r as Record<string, unknown>);
    const raw = p?.[fieldKey];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (Number.isFinite(n)) nums.push(n);
  });
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  const v = aggregate === 'sum' ? sum : sum / nums.length;
  return Math.round(v * 1e6) / 1e6;
}

/** 关联取值候选记录统一结构：payload 字段值 + 时间键（已存行用 created_at，编辑中新行用行序） */
export interface FetchCandidate {
  payload?: Record<string, unknown>;
  created_at?: string | null;
  /** 新行（无 created_at）的行序，时间排序时排在已存行之后（视为最新） */
  rowOrder?: number;
}

/** 关联取值「按大小」比较键：数值按数值比；日期字符串（YYYY-MM-DD[ HH:mm[:ss]]，支持 / 分隔）按时间戳比；纯时间（HH:mm[:ss]）按当天秒数比；不可比较返回 NaN */
export function comparableValueKey(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return NaN;
  const s = raw.trim();
  if (s === '') return NaN;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const d = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (d) {
    const t = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(d[4] ?? '0'), Number(d[5] ?? '0'), Number(d[6] ?? '0'));
    return Number.isNaN(t) ? NaN : t;
  }
  const t = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (t) return Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3] ?? '0');
  return NaN;
}

/** 关联取值：按排序方式从候选记录中取第一条的 fieldKey 字段值；「按大小」排序支持数值与日期、时间字段 */
export function evalFetchValue(
  cfg: { fieldKey: string; sortBy: string },
  candidates: FetchCandidate[],
): unknown {
  if (candidates.length === 0) return null;
  const timeKey = (c: FetchCandidate, i: number): string => c.created_at ?? `row-${String(c.rowOrder ?? i).padStart(4, '0')}`;
  const num = (c: FetchCandidate): number => comparableValueKey(c.payload?.[cfg.fieldKey]);
  const sorted = [...candidates];
  if (cfg.sortBy === 'value-asc' || cfg.sortBy === 'value-desc') {
    sorted.sort((a, b) => {
      const na = num(a);
      const nb = num(b);
      // 非数值排最后
      if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
      if (Number.isNaN(na)) return 1;
      if (Number.isNaN(nb)) return -1;
      return cfg.sortBy === 'value-asc' ? na - nb : nb - na;
    });
  } else {
    sorted.sort((a, b) => {
      const ta = timeKey(a, 0);
      const tb = timeKey(b, 0);
      return cfg.sortBy === 'time-asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
    });
  }
  const v = sorted[0]?.payload?.[cfg.fieldKey];
  return v === undefined ? null : v;
}

/** 从字段定义生成默认值 */
/** 数字类字段值归一：字符串 "100%"/"1,234" 等转数字（用于默认值回显与公式取值），无法解析返回 null */
export function parseNumericLike(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.replace(/%/g, '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function fieldInitialValue(f: FormField): unknown {
  if (f.system) return null; // 系统字段保存时自动生成
  // 公式计算/汇总统计/大写金额为自动计算字段，不取 defaultValue
  if (f.type === 'formula' || f.type === 'summary' || f.type === 'amount-uppercase') return null;
  if (f.defaultValue !== undefined && f.defaultValue !== '') {
    // 数字类字段（数字/金额/百分比）：默认值归一为数字（如 "100%" → 100），保证回显与公式计算可用
    if (f.type === 'number' || f.type === 'money' || f.type === 'percent') {
      return parseNumericLike(f.defaultValue);
    }
    return f.defaultValue;
  }
  switch (f.type) {
    case 'multi-select':
    case 'search-multi-select':
    case 'checkbox':
      return [];
    case 'switch':
      return false;
    case 'leave-time': {
      // 请假时间默认：开始/结束日期为当天，开始时间 9:00、结束时间 18:00（可修改）
      const p = (x: number) => String(x).padStart(2, '0');
      const today = `${new Date().getFullYear()}-${p(new Date().getMonth() + 1)}-${p(new Date().getDate())}`;
      return { start_date: today, end_date: today, start_time: 9, end_time: 18 };
    }
    case 'serial-number':
    case 'query':
      return null;
    case 'sub-table':
      // 关联子表草稿值：{ rows, removedIds }；持久化后为行 id 数组
      return { rows: [], removedIds: [] } as unknown;
    default:
      return '';
  }
}

/** 中国大陆手机号格式：1 开头 11 位数字（第 2 位 3-9） */
export const PHONE_RE = /^1[3-9]\d{9}$/;

/** 默认每日工作时间（整点）：上午 9-12，下午 13-18，共 8 小时 */
export const DEFAULT_WORK_HOURS: Required<WorkHours> = { amStart: 9, amEnd: 12, pmStart: 13, pmEnd: 18 };

/** 归一化工作时间配置（缺失项回退默认值，非法值按默认处理） */
export function normalizeWorkHours(wh?: WorkHours): Required<WorkHours> {
  const num = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 23 ? Math.floor(v) : d);
  const w = {
    amStart: num(wh?.amStart, DEFAULT_WORK_HOURS.amStart),
    amEnd: num(wh?.amEnd, DEFAULT_WORK_HOURS.amEnd),
    pmStart: num(wh?.pmStart, DEFAULT_WORK_HOURS.pmStart),
    pmEnd: num(wh?.pmEnd, DEFAULT_WORK_HOURS.pmEnd),
  };
  if (w.amStart >= w.amEnd) { w.amStart = DEFAULT_WORK_HOURS.amStart; w.amEnd = DEFAULT_WORK_HOURS.amEnd; }
  if (w.pmStart >= w.pmEnd) { w.pmStart = DEFAULT_WORK_HOURS.pmStart; w.pmEnd = DEFAULT_WORK_HOURS.pmEnd; }
  return w;
}

/** 每日可请假总小时数（上午 + 下午） */
export function workHoursPerDay(wh?: WorkHours): number {
  const w = normalizeWorkHours(wh);
  return (w.amEnd - w.amStart) + (w.pmEnd - w.pmStart);
}

/** 指定小时是否属于工作时间（整点 h 计入 [start, end) 区间） */
function isWorkHour(h: number, w: Required<WorkHours>): boolean {
  return (h >= w.amStart && h < w.amEnd) || (h >= w.pmStart && h < w.pmEnd);
}

/**
 * 计算请假时长：逐日逐小时遍历 [开始时间点, 结束时间点]，仅累计工作时间内的整点小时。
 * 返回 { hours: 总小时数, days: 折算天数 }，无法计算（未填全/日期倒置）时返回 null。
 */
export function calcLeave(v: LeaveTimeValue | null | undefined, wh?: WorkHours): { hours: number; days: number } | null {
  if (!v || !v.start_date || !v.end_date || v.start_time === undefined || v.start_time === null
    || v.end_time === undefined || v.end_time === null) return null;
  const s = new Date(`${v.start_date}T00:00:00`);
  const e = new Date(`${v.end_date}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  if (e.getTime() < s.getTime()) return null;
  const w = normalizeWorkHours(wh);
  const st = Math.max(0, Math.min(23, Math.floor(v.start_time)));
  const et = Math.max(0, Math.min(23, Math.floor(v.end_time)));
  let hours = 0;
  for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
    const isStartDay = d.getTime() === s.getTime();
    const isEndDay = d.getTime() === e.getTime();
    const from = isStartDay ? st : Math.min(w.amStart, w.pmStart);
    const to = isEndDay ? et : Math.max(w.amEnd, w.pmEnd);
    for (let h = from; h < to; h++) if (isWorkHour(h, w)) hours++;
  }
  const perDay = workHoursPerDay(w);
  if (hours <= 0 || perDay <= 0) return null;
  return { hours, days: Math.round((hours / perDay) * 10) / 10 };
}

/** leave-time 复合值 → 「YYYY-MM-DD HH:00」时间字符串（开始/结束），未填全返回空串 */
export function leaveTimeStr(v: LeaveTimeValue | null | undefined, which: 'start' | 'end'): string {
  if (!v) return '';
  const date = which === 'start' ? v.start_date : v.end_date;
  const hour = which === 'start' ? v.start_time : v.end_time;
  if (!date || hour === undefined || hour === null) return '';
  return `${date} ${String(Math.max(0, Math.min(23, Math.floor(Number(hour))))).padStart(2, '0')}:00`;
}

/** 解析日期时间字符串（YYYY-MM-DD HH:mm / YYYY-MM-DDTHH:mm）→ 日期 + 整点小时，非法返回 null */
export function parseDateTimeStr(s: string): { date: string; hour: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2})(?::(\d{2}))?/);
  if (!m) return null;
  if (Number.isNaN(new Date(`${m[1]}T00:00:00`).getTime())) return null;
  return { date: m[1], hour: Math.max(0, Math.min(23, Number(m[2]))) };
}

/** leave-time 反向联动结果：draft 为更新后的完整数据，patch 为需持久化的联动字段 */
export interface LeaveSyncResult {
  draft: Record<string, unknown>;
  patch: Record<string, unknown>;
}

/**
 * 修改请假拆分出的「开始时间/结束时间」字段时反向联动：
 * 更新 leave-time 复合值并重算请假时长，同步写回全部绑定结果字段（开始/结束时间、小时、天数）。
 * 返回 null 表示该字段未绑定 leave-time 或时间无效（时长为 0 / 日期倒置）。
 */
export function syncLeaveByTimeField(
  fields: FormField[],
  draft: Record<string, unknown>,
  key: string,
  value: unknown,
): LeaveSyncResult | null {
  const lf = fields.find((f) => f.type === 'leave-time' && (f.leaveTime?.startKey === key || f.leaveTime?.endKey === key));
  if (!lf?.leaveTime) return null;
  const p = typeof value === 'string' ? parseDateTimeStr(value) : null;
  if (!p) return null;
  const isStart = lf.leaveTime.startKey === key;
  const cur = (draft[lf.key] && typeof draft[lf.key] === 'object' ? draft[lf.key] : {}) as LeaveTimeValue;
  const next: LeaveTimeValue = isStart
    ? { ...cur, start_date: p.date, start_time: p.hour }
    : { ...cur, end_date: p.date, end_time: p.hour };
  const c = calcLeave(next, lf.workHours);
  if (!c) return null;
  const withCalc: LeaveTimeValue = { ...next, hours: c.hours, days: c.days };
  const patch: Record<string, unknown> = { [lf.key]: withCalc };
  const s = leaveTimeStr(withCalc, 'start');
  const e = leaveTimeStr(withCalc, 'end');
  if (lf.leaveTime.startKey && s) patch[lf.leaveTime.startKey] = s;
  if (lf.leaveTime.endKey && e) patch[lf.leaveTime.endKey] = e;
  if (lf.leaveTime.hoursKey) patch[lf.leaveTime.hoursKey] = c.hours;
  if (lf.leaveTime.daysKey) patch[lf.leaveTime.daysKey] = c.days;
  return { draft: { ...draft, ...patch }, patch };
}

/**
 * 提交字段集合扩展：确认/可编辑字段包含 leave-time 拆分字段或复合字段时，
 * 一并提交复合值与全部绑定结果字段，保证拆分时间与时长数据完整入库。
 */
export function expandLeaveKeysForSubmit(fields: FormField[], keys: string[]): string[] {
  const out = new Set(keys);
  keys.forEach((k) => {
    fields.forEach((f) => {
      if (f.type !== 'leave-time' || !f.leaveTime) return;
      const bound = [f.leaveTime.startKey, f.leaveTime.endKey, f.leaveTime.hoursKey, f.leaveTime.daysKey];
      if (k === f.key || bound.includes(k)) {
        out.add(f.key);
        bound.forEach((b) => { if (b) out.add(b); });
      }
    });
  });
  return [...out];
}

/** 运行时校验单个字段 */
export function validateField(f: FormField, value: unknown): string | null {
  if (f.system) return null; // 系统字段自动生成，跳过校验
  // 流水号在提交时由后端自动生成，跳过必填校验
  if (f.type === 'serial-number') return null;
  // 查询表单组件为只读展示，不参与校验
  if (f.type === 'query') return null;
  // 关联子表：校验明细行数量（value 为行数组，草稿态取 rows 长度由调用方换算）
  if (f.type === 'sub-table') {
    const rows = Array.isArray(value) ? (value as unknown[]) : [];
    const min = Math.max(f.subTable?.minRows ?? 0, f.required ? 1 : 0);
    if (min > 0 && rows.length < min) return min > 1 ? `至少需要 ${min} 行明细` : '请至少添加一行明细';
    const max = f.subTable?.maxRows ?? 0;
    if (max > 0 && rows.length > max) return `明细不能超过 ${max} 行`;
    return null;
  }
  const empty = value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0)
    // 地址组件：对象值需校验是否已选省份（三级至少选到省）
    || (f.type === 'address' && (typeof value !== 'object' || !((value as { province?: string }).province)));
  if (f.required && empty) return `${f.label}不能为空`;
  if (empty) return null;
  if (f.type === 'phone' && !PHONE_RE.test(String(value).trim())) return `${f.label}格式不正确（应为 1 开头的 11 位手机号）`;
  if (f.type === 'leave-time') {
    const v = value as LeaveTimeValue;
    const missing = !v?.start_date || !v?.end_date || v?.start_time === undefined || v?.end_time === undefined;
    if (missing) return `${f.label}需填写完整的开始/结束日期与时间点`;
    if (v.end_date! < v.start_date!) return `${f.label}结束日期不能早于开始日期`;
    if (v.end_date === v.start_date && (v.end_time as number) < (v.start_time as number)) return `${f.label}结束时间点不能早于开始时间点`;
    if (!calcLeave(v, f.workHours)) return `${f.label}请假时长必须大于 0（请检查填写的时间段）`;
    return null;
  }
  if (f.validation?.pattern) {
    try {
      if (!new RegExp(f.validation.pattern).test(String(value))) return f.validation?.message || `${f.label}格式不正确`;
    } catch {
      /* 非法正则忽略 */
    }
  }
  if (f.validation?.maxLength && String(value).length > f.validation.maxLength) return `${f.label}长度不能超过 ${f.validation.maxLength}`;
  if (f.validation?.min !== undefined && Number(value) < f.validation.min) return `${f.label}不能小于 ${f.validation.min}`;
  if (f.validation?.max !== undefined && Number(value) > f.validation.max) return `${f.label}不能大于 ${f.validation.max}`;
  return null;
}

/** 金额千分位 */
export function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 日期格式化 */
export function fmtDate(v: string, withTime = false): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (x: number) => String(x).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

/**
 * 通用单据自动计算函数：
 * 给定表单字段定义、当前字段值、子表行数据缓存、关联表单行缓存等，
 * 按照拓扑顺序依次计算 summary(汇总统计)、fetch-value(关联取值)、formula(公式计算) 及 amount-uppercase(大写金额)。
 * 公式计算支持依赖汇总字段与其它公式字段。
 */
export function computeFormCalculations({
  fields,
  vals,
  subRowsMap = {},
  refRowsMap = {},
  summaryRows = [],
  formRowsCache = {},
  scopeCtx,
}: {
  fields: FormField[];
  vals: Record<string, unknown>;
  subRowsMap?: Record<string, Array<{ id?: string; payload?: Record<string, unknown>; created_at?: string | null; rowOrder?: number; created_by?: string }>>;
  refRowsMap?: Record<string, Array<{ id?: string; payload?: Record<string, unknown>; created_at?: string | null; created_by?: string }>>;
  summaryRows?: Array<{ payload?: Record<string, unknown> }>;
  formRowsCache?: Record<string, Array<{ payload?: Record<string, unknown>; created_at?: string | null; created_by?: string }>>;
  scopeCtx?: ScopeContext;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const filterByDataRange = (rows: Array<{ created_by?: string; payload?: Record<string, unknown>; created_at?: string | null; rowOrder?: number }>, dataRange?: DataRange): FetchCandidate[] => {
    if (!dataRange || dataRange === 'all' || !scopeCtx) return rows as FetchCandidate[];
    const allowed = buildCreatorScope({ ...scopeCtx, dataRange });
    if (!allowed) return rows as FetchCandidate[];
    const set = new Set(allowed);
    return rows.filter((r) => set.has(r.created_by ?? '')) as FetchCandidate[];
  };

  const subRowsFor = (subKey: string) => {
    const v = vals[subKey];
    // 编辑草稿对象（包含 rows）
    if (v && typeof v === 'object' && 'rows' in (v as Record<string, unknown>) && Array.isArray((v as { rows: unknown[] }).rows)) {
      return (v as { rows: Array<{ payload?: Record<string, unknown>; rowOrder?: number }> }).rows.map((r, i) => ({ payload: r.payload, rowOrder: i }));
    }
    const ids = Array.isArray(v) ? (v as string[]) : [];
    const cached = subRowsMap[subKey] ?? [];
    if (ids.length === 0) return cached;
    return cached.filter((r) => {
      const rid = r.id;
      return !rid || ids.includes(rid);
    });
  };

  const refRowsFor = (refKey: string) => {
    const v = vals[refKey];
    const ids = Array.isArray(v) ? (v as string[]) : [];
    const cached = refRowsMap[refKey] ?? [];
    if (ids.length === 0) return cached;
    return cached.filter((r) => {
      const rid = r.id;
      return !rid || ids.includes(rid);
    });
  };

  const refRecords: Record<string, Record<string, unknown> | undefined> = {};
  fields.filter((f) => f.type === 'form-ref').forEach((rf) => {
    const v = vals[rf.key];
    const ids = Array.isArray(v) ? (v as string[]) : [];
    const first = ids.length > 0 ? (refRowsMap[rf.key] ?? []).find((r) => r.id === ids[0]) : undefined;
    refRecords[rf.key] = first?.payload;
  });

  // 第一轮：计算所有汇总统计 (summary) 与关联取值 (fetch-value)
  fields.forEach((f) => {
    if (f.type === 'summary' && f.summary) {
      let rows: Array<{ payload?: Record<string, unknown> }>;
      if (f.summary.source === 'subtable') {
        rows = subRowsFor(f.summary.subFieldKey ?? '');
      } else if (f.summary.source === 'ref') {
        rows = refRowsFor(f.summary.refFieldKey ?? '');
      } else {
        rows = summaryRows;
      }
      const aggVal = aggregateRows(f.summary.aggregate, f.summary.fieldKey ?? '', rows);
      // 空行集归一为 0：无明细行时总额/均值应为 0 而非 null（写库场景防止正确值被 null 覆盖，公式字段可正常引用）
      out[f.key] = aggVal === null && rows.length === 0 ? 0 : aggVal;
    } else if (f.type === 'fetch-value' && f.fetchValue) {
      const cands: FetchCandidate[] = f.fetchValue.source === 'subtable'
        ? subRowsFor(f.fetchValue.subFieldKey ?? '')
        : filterByDataRange(formRowsCache[f.fetchValue.formId ?? ''] ?? [], f.fetchValue.dataRange);
      out[f.key] = evalFetchValue(f.fetchValue, cands);
    }
  });

  // 第二轮：将汇总值合并进数据，计算公式 (formula) 与金额大写 (amount-uppercase)
  let merged = { ...vals, ...out };
  fields.forEach((f) => {
    if (f.type === 'formula') {
      const expr = f.formula?.expression ?? f.defaultValue ?? '';
      if (expr) out[f.key] = evalFormulaExpression(expr, merged, refRecords);
    } else if (f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey) {
      out[f.key] = toChineseAmount(merged[f.uppercaseAmount.fieldKey] as number | string | null | undefined);
    }
  });

  // 第三轮：再跑一次公式，处理公式依赖其他公式字段的级联场景
  merged = { ...vals, ...out };
  fields.forEach((f) => {
    if (f.type === 'formula') {
      const expr = f.formula?.expression ?? f.defaultValue ?? '';
      if (expr) {
        const nextVal = evalFormulaExpression(expr, merged, refRecords);
        if (nextVal !== null) out[f.key] = nextVal;
      }
    }
  });

  // 第四轮：大写金额兜底重算（关联公式/汇总/关联取值等计算字段时，取级联后的最终值，数字与数值字符串均兼容）
  merged = { ...vals, ...out };
  fields.forEach((f) => {
    if (f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey) {
      out[f.key] = toChineseAmount(merged[f.uppercaseAmount.fieldKey] as number | string | null | undefined);
    }
  });

  return out;
}

/** 运行时：按显示条件过滤数据源记录（AND/OR 逻辑）；兼容 payload 嵌套结构 */
export function applyDisplayConditions(
  rows: Record<string, unknown>[],
  conditions: { fieldKey: string; op: 'eq' | 'ne' | 'contains' | 'gt' | 'lt'; value: string }[],
  logic: 'and' | 'or',
): Record<string, unknown>[] {
  if (!conditions || conditions.length === 0) return rows;
  const getVal = (row: Record<string, unknown>, key: string) => {
    if (row[key] !== undefined) return row[key];
    const payload = row.payload as Record<string, unknown> | undefined;
    return payload?.[key];
  };
  return rows.filter((row) => {
    const results = conditions.map((c) => {
      const raw = getVal(row, c.fieldKey);
      const cellVal = raw === undefined || raw === null ? '' : String(raw);
      const target = c.value;
      switch (c.op) {
        case 'eq': return cellVal === target;
        case 'ne': return cellVal !== target;
        case 'contains': return cellVal.includes(target);
        case 'gt': return cellVal !== '' && Number(cellVal) > Number(target);
        case 'lt': return cellVal !== '' && Number(cellVal) < Number(target);
        default: return true;
      }
    });
    return logic === 'and' ? results.every(Boolean) : results.some(Boolean);
  });
}

/** 运行时：按手动筛选值过滤数据源记录（AND/OR 逻辑）；兼容 payload 嵌套结构 */
export function applyManualFilters(
  rows: Record<string, unknown>[],
  filterValues: Record<string, string>,
  manualFilters: { fieldKey: string; control: 'input' | 'select' | 'date' | 'date-range' }[],
  logic: 'and' | 'or' = 'and',
): Record<string, unknown>[] {
  const active = manualFilters.filter((mf) => {
    const v = filterValues[mf.fieldKey];
    return v !== undefined && v !== null && v !== '';
  });
  if (active.length === 0) return rows;
  const getVal = (row: Record<string, unknown>, key: string) => {
    if (row[key] !== undefined) return row[key];
    const payload = row.payload as Record<string, unknown> | undefined;
    return payload?.[key];
  };
  const match = (row: Record<string, unknown>) => {
    const results = active.map((mf) => {
      const raw = getVal(row, mf.fieldKey);
      const cellVal = raw === undefined || raw === null ? '' : String(raw);
      const target = filterValues[mf.fieldKey] ?? '';
      if (mf.control === 'date-range') {
        // target 格式：起始~结束；按日期前缀比较（兼容 YYYY-MM-DD 与 ISO 两种存储）
        const [from, to] = target.split('~').map((s) => s.trim());
        const day = cellVal.slice(0, 10);
        const okFrom = !from || day >= from;
        const okTo = !to || day <= to;
        return okFrom && okTo;
      }
      return cellVal.includes(target);
    });
    return logic === 'and' ? results.every(Boolean) : results.some(Boolean);
  };
  return rows.filter(match);
}

/** 设计器复合字段（关联子表 sub-table / 关联表单 form-ref）选定的明细字段展开组件：
 *  以缩进只读子行形式展示该复合字段在表单设计时选定的展示列/显示字段，帮助搭建者直观辨识字段构成；不作为独立勾选项，不改变存储与运行态行为 */
export function CompositeDetailFields({ field, forms }: { field: FormField; forms: { id: string; name?: string; schema_json?: { fields?: FormField[] } | null }[] }) {
  if (field.type !== 'sub-table' && field.type !== 'form-ref') return null;
  const formId = field.type === 'sub-table' ? field.subTable?.targetFormId : field.relation?.formId;
  const selected = field.type === 'sub-table' ? (field.subTable?.displayColumns ?? []) : (field.relation?.displayFields ?? []);
  if (!formId) return null;
  const kindLabel = field.type === 'sub-table' ? '展示列' : '显示字段';
  if (selected.length === 0) {
    return createElement('p', { className: 'ml-6 text-[10px] text-muted-foreground/80' }, `明细：暂无选定${kindLabel}（请在表单设计器中配置）`);
  }
  const target = forms.find((g) => g.id === formId);
  const targetFields = target?.schema_json?.fields ?? [];
  const labelOf = (k: string) => targetFields.find((tf) => tf.key === k)?.label ?? k;
  const text = `明细：${selected.map(labelOf).join('、')}`;
  return createElement('p', { className: 'ml-6 truncate text-[10px] text-muted-foreground/80', title: selected.map(labelOf).join('、') }, text);
}
