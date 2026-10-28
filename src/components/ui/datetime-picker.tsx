import * as React from 'react';
import { DatePicker, TimePicker } from '@arco-design/web-react';
import { cn } from '@/lib/utils';

export type DateTimeMode = 'date' | 'time' | 'datetime';

interface DateTimePickerProps {
  mode?: DateTimeMode;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** 标准日期时间选择器：基于 Arco Design，替代浏览器原生 date/time/datetime-local input */
export function DateTimePicker({ mode = 'date', value, onChange, disabled, placeholder, className }: DateTimePickerProps) {
  const fmt = mode === 'date' ? 'YYYY-MM-DD' : mode === 'time' ? 'HH:mm' : 'YYYY-MM-DD HH:mm';
  const ph = placeholder || (mode === 'date' ? '选择日期' : mode === 'time' ? '选择时间' : '选择日期时间');

  const common = {
    disabled,
    placeholder: ph,
    // large=36px，与表单内 h-9 的文本框/下拉框高度对齐
    size: 'large' as const,
    // 仅通过弹出面板选择，输入框不可键入；同时避免 input 聚焦/选中的交互效果
    editable: false,
    className: cn('w-full', className),
    style: { width: '100%' } as React.CSSProperties,
    value: value || undefined,
    onChange: (dateString: string) => onChange(dateString),
  };

  if (mode === 'time') {
    return <TimePicker {...common} editable={false} format="HH:mm" />;
  }
  return <DatePicker {...common} format={fmt} showTime={mode === 'datetime'} />;
}