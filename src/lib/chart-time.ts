import { BIZ_STATUS_LABELS } from '@/lib/field-catalog';

export type TimeGranularity = 'day' | 'week' | 'month' | 'year' | 'range';

export const TIME_GRANULARITY_LABELS: Record<TimeGranularity, string> = {
  day: '按天',
  week: '按周',
  month: '按月',
  year: '按年',
  range: '自定义',
};

/** 解析时间字符串为 Date（兼容 "YYYY-MM-DD HH:mm:ss" 与 ISO） */
function parseDate(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * 依据时间粒度计算统计的时间范围（以当前时间为基准）：
 * - day：近 24 小时，按小时聚合
 * - week：近 7 天，按天聚合
 * - month：近 30 天，按天聚合
 * - year：近 12 个月，按月聚合
 * - range：自定义范围（customStart~customEnd），默认近 1 个月
 */
export function buildTimeRange(
  granularity: TimeGranularity,
  customStart?: string,
  customEnd?: string,
): TimeRange | null {
  const now = new Date();
  if (granularity === 'range') {
    const end = parseDate(customEnd ?? '') ?? now;
    const start = parseDate(customStart ?? '') ?? new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    if (start.getTime() > end.getTime()) return null;
    return { start, end };
  }
  if (granularity === 'day') {
    return { start: new Date(now.getTime() - 24 * 3600 * 1000), end: now };
  }
  if (granularity === 'week') {
    return { start: new Date(now.getTime() - 7 * 24 * 3600 * 1000), end: now };
  }
  if (granularity === 'month') {
    return { start: new Date(now.getTime() - 30 * 24 * 3600 * 1000), end: now };
  }
  // year：近 12 个月
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0, 0);
  return { start, end: now };
}

/** 将时间归入对应的统计桶，返回桶标签 */
export function bucketTime(dateStr: string, granularity: TimeGranularity): string | null {
  const d = parseDate(dateStr);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  switch (granularity) {
    case 'day':
      return `${m}-${day} ${hour}:00`;
    case 'week':
    case 'month':
      return `${m}-${day}`;
    case 'year':
      return `${y}-${m}`;
    case 'range':
      return `${y}-${m}-${day}`;
    default:
      return `${y}-${m}-${day}`;
  }
}

/** 系统时间字段 key：这些值存储在 biz_data 顶层列，而非 payload 内 */
const SYSTEM_TIME_KEYS = new Set(['created_at', 'updated_at']);

/**
 * 读取单条记录中指定字段的值。
 * 系统时间字段（创建时间/更新时间）存储在 biz_data 顶层列，需回退读取；
 * 其余业务字段从 payload 中读取。
 */
export function resolveFieldValue(
  row: { payload?: Record<string, unknown>; created_at?: string; updated_at?: string; status?: string; created_by?: string; updated_by?: string | null },
  fieldKey: string,
  smStateMap?: Map<string, { label: string }>,
): string {
  if (!fieldKey) return '';
  if (SYSTEM_TIME_KEYS.has(fieldKey)) {
    return String(row[fieldKey as 'created_at' | 'updated_at'] ?? '');
  }
  // 系统字段：状态优先取状态机状态名，其次回退系统预置中文标签；创建人/更新人取 id（运行时由档案映射展示姓名）
  if (fieldKey === 'status') {
    const s = row.status;
    return s ? (smStateMap?.get(s)?.label ?? BIZ_STATUS_LABELS[s] ?? s) : '';
  }
  if (fieldKey === 'created_by' || fieldKey === 'updated_by') {
    const v = row[fieldKey];
    return v ? String(v) : '';
  }
  const p = row.payload ?? {};
  const raw = p[fieldKey];
  return raw === undefined || raw === null ? '' : String(raw);
}

/** 判断时间是否落在统计范围内 */
export function inRange(dateStr: string, range: TimeRange): boolean {
  const d = parseDate(dateStr);
  if (!d) return false;
  return d.getTime() >= range.start.getTime() && d.getTime() <= range.end.getTime();
}

/**
 * 图表数值字段的展示值换算：金额类字段（money 等）在数据库按原始数值存储（表单提交时不做单位换算），
 * 图表直接对原值求和/平均即可。此函数保留字段类型扩展点，当前不做任何换算。
 */
export function toChartDisplayNum(raw: number, fieldKey: string, fields?: { key: string; type?: string }[]): number {
  return raw;
}