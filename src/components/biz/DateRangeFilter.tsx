/**
 * 日期范围筛选控件：基于 Arco Design RangePicker。
 * 值协议：`起始~结束`（与 applyManualFilters 的 date-range 格式一致），清空时输出空串。
 */
import { DatePicker } from '@arco-design/web-react';
import { cn } from '@/lib/utils';

export function DateRangeFilter({ value, onChange, size = 'large', className }: {
  value: string;
  onChange: (v: string) => void;
  /** large=36px 与 h-9 输入框对齐；default=32px 与 h-8 输入框对齐 */
  size?: 'default' | 'large';
  className?: string;
}) {
  const parts = (value ?? '').split('~');
  const from = parts[0]?.trim() || undefined;
  const to = parts[1]?.trim() || undefined;
  return (
    <DatePicker.RangePicker
      allowClear
      size={size}
      editable={false}
      className={cn('biz-date-filter w-60 shrink-0', className)}
      value={from || to ? ([from, to] as [string, string]) : undefined}
      onChange={(dateString: string[]) => {
        const f = dateString[0] ?? '';
        const t = dateString[1] ?? '';
        onChange(f || t ? `${f}~${t}` : '');
      }}
    />
  );
}
