import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface SearchFilterBarProps {
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

/**
 * 通用列表搜索筛选区容器。
 * 子元素默认按响应式网格排布；每行建议配合 FilterField 使用，以保证标签与控件对齐。
 */
export function SearchFilterBar({ children, className, actions }: SearchFilterBarProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-4">
          {children}
        </div>
        {actions && <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">{actions}</div>}
      </div>
    </div>
  );
}

interface FilterFieldProps {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}

/** 单个筛选字段：标签在上、控件在下，保持统一间距与高度基线 */
export function FilterField({ label, className, children }: FilterFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5 min-w-0', className)}>
      <Label className="text-xs text-muted-foreground truncate">{label}</Label>
      <div className="h-9">{children}</div>
    </div>
  );
}
