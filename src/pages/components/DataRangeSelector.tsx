import { DATA_RANGE_LABELS, type DataRange } from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  value: DataRange;
  onChange: (v: DataRange) => void;
}

const ORDER: DataRange[] = ['permission', 'all', 'dept_sub', 'dept', 'mine'];

/** 数据范围多选切换：跟随权限 / 全部数据 / 本部门及下级 / 本部门 / 仅本人 */
export default function DataRangeSelector({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {ORDER.map((val) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={cn(
            'rounded-md border px-2 py-1.5 text-[11px] transition-colors text-left',
            value === val
              ? 'border-primary bg-primary/5 font-medium text-primary'
              : 'border-border text-muted-foreground hover:bg-muted/60',
          )}
        >
          {DATA_RANGE_LABELS[val]}
        </button>
      ))}
    </div>
  );
}