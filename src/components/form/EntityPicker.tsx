import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import './entity-picker.css';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface PickerOption {
  id: string;
  label: string;
  sub?: string;
}

interface Props {
  options: PickerOption[];
  value: unknown;
  multi?: boolean;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** 人员/部门通用选择器：支持搜索、单选与多选 */
export default function EntityPicker({ options, value, multi, onChange, disabled, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = multi
    ? (Array.isArray(value) ? (value as string[]) : [])
    : value ? [String(value)] : [];

  const filtered = options.filter((o) => {
    if (!q.trim()) return true;
    const k = q.trim();
    return o.label.includes(k) || (o.sub ?? '').includes(k);
  });

  const selectedLabels = selected
    .map((id) => options.find((o) => o.id === id)?.label ?? id)
    .filter(Boolean);

  const toggle = (id: string) => {
    if (multi) {
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    } else {
      onChange(id);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="sig-entity-picker-trigger w-full justify-between font-normal"
        >
          <span className={cn('truncate', selectedLabels.length === 0 && 'text-muted-foreground')}>
            {selectedLabels.length > 0 ? selectedLabels.join('、') : (placeholder ?? '请选择')}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0" align="start">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索..." className="h-8 pl-7 text-sm" />
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">无匹配结果</p>
          ) : (
            filtered.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  <Check className={cn('h-4 w-4 shrink-0', on ? 'text-primary' : 'opacity-0')} />
                  <span className="flex-1 min-w-0 truncate text-foreground">{o.label}</span>
                  {o.sub && <span className="shrink-0 text-[11px] text-muted-foreground">{o.sub}</span>}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}