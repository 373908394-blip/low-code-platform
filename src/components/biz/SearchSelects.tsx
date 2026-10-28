/**
 * 带搜索的下拉选择控件：基于 Popover + Command（选项过滤搜索）。
 * 用于表单字段类型 search-select（单选）/ search-multi-select（多选），
 * 选项来源与数据流同普通下拉，仅交互增加搜索过滤与标签多选。
 */
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Opt {
  id: string;
  label: string;
}

export function SingleSearchSelect({ value, onChange, options, disabled, placeholder, className }: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const filtered = kw ? options.filter((o) => o.label.toLowerCase().includes(kw.toLowerCase())) : options;
  const selLabel = options.find((o) => o.id === value)?.label;
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setKw(''); }}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm data-[placeholder]:text-muted-foreground focus:outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1', className)}
        >
          <span className={cn(!selLabel && 'text-muted-foreground')}>{selLabel ?? placeholder ?? '请选择'}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start" style={{ minWidth: 'var(--radix-popover-trigger-width)' }}>
        <Command shouldFilter={false}>
          <div className="flex h-9 items-center border-b px-3 gap-2" cmdk-input-wrapper="">
            <Search className="h-4 w-4 shrink-0 opacity-50" />
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索选项…"
              className="h-full w-full rounded-md border-0 bg-transparent py-0 text-sm outline-none placeholder:text-muted-foreground focus:border-0 focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0"
            />
          </div>
          <CommandList>
            <CommandEmpty>无匹配选项</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem value="清除选择" onSelect={() => { onChange(''); setOpen(false); }}>
                  <span className="text-muted-foreground">清除选择</span>
                </CommandItem>
              )}
              {filtered.map((o) => (
                <CommandItem key={o.id} value={o.id} onSelect={(cur) => { onChange(cur === value ? '' : cur); setOpen(false); }}>
                  <Check className={cn('mr-2 h-4 w-4', value === o.id ? 'opacity-100' : 'opacity-0')} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function MultiSearchSelect({ value, onChange, options, disabled, placeholder, className }: {
  value: string[];
  onChange: (v: string[]) => void;
  options: Opt[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const filtered = kw ? options.filter((o) => o.label.toLowerCase().includes(kw.toLowerCase())) : options;
  const labels = new Map(options.map((o) => [o.id, o.label]));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setKw(''); }}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm focus:outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50', className)}
        >
          {value.length === 0 ? (
            <span className="px-1 text-muted-foreground">{placeholder ?? '请选择'}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1">
              {value.map((id) => (
                <Badge key={id} variant="secondary" className="font-normal">
                  {labels.get(id) ?? id}
                  <button
                    type="button"
                    aria-label={`移除 ${labels.get(id) ?? id}`}
                    className="ml-0.5 rounded-full outline-none focus:ring-1 focus:ring-ring"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(id); }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </span>
          )}
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start" style={{ minWidth: 'var(--radix-popover-trigger-width)' }}>
        <Command shouldFilter={false}>
          <div className="flex h-9 items-center border-b px-3 gap-2" cmdk-input-wrapper="">
            <Search className="h-4 w-4 shrink-0 opacity-50" />
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索选项…"
              className="h-full w-full rounded-md border-0 bg-transparent py-0 text-sm outline-none placeholder:text-muted-foreground focus:border-0 focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0"
            />
          </div>
          <CommandList>
            <CommandEmpty>无匹配选项</CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem key={o.id} value={o.id} onSelect={() => toggle(o.id)}>
                  <Check className={cn('mr-2 h-4 w-4', value.includes(o.id) ? 'opacity-100' : 'opacity-0')} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
