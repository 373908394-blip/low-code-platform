import type { DisplayCondition } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FieldOption { key: string; label: string }

interface Props {
  /** 目标表单可选字段 */
  fieldOptions: FieldOption[];
  /** 显示条件列表 */
  conditions: DisplayCondition[];
  /** 显示条件之间的逻辑关系 */
  conditionsLogic?: 'and' | 'or';
  onUpdate: (patch: { conditions?: DisplayCondition[]; conditionsLogic?: 'and' | 'or' }) => void;
}

const COND_OPS: { value: DisplayCondition['op']; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
];

/** 显示条件编辑器：供文本显示/分栏每栏等属性面板复用，支持多条件 AND/OR 叠加 */
export default function ConditionsEditor({ fieldOptions, conditions, conditionsLogic, onUpdate }: Props) {
  const updCond = (id: string, patch: Partial<DisplayCondition>) =>
    onUpdate({ conditions: conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addCond = () =>
    onUpdate({
      conditions: [
        ...conditions,
        { id: `dc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, fieldKey: '', op: 'eq', value: '' },
      ],
    });
  const delCond = (id: string) => onUpdate({ conditions: conditions.filter((c) => c.id !== id) });

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs">
        <Filter className="h-3.5 w-3.5" />过滤条件
        <span className="text-[10px] text-muted-foreground font-normal">（仅展示满足条件的记录）</span>
      </Label>
      {conditions.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground shrink-0">条件关系</span>
          <div className="flex gap-1">
            {(['and', 'or'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onUpdate({ conditionsLogic: l })}
                className={cn('h-6 rounded border px-2 text-[11px] transition-colors', (conditionsLogic ?? 'and') === l ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
              >
                {l === 'and' ? '且 (AND)' : '或 (OR)'}
              </button>
            ))}
          </div>
        </div>
      )}
      {conditions.length > 0 && (
        <div className="space-y-2">
          {conditions.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5">
              <Select value={c.fieldKey || 'none'} onValueChange={(v) => updCond(c.id, { fieldKey: v === 'none' ? '' : v })}>
                <SelectTrigger className="h-7 flex-1 min-w-0 text-xs"><SelectValue placeholder="字段" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未选择</SelectItem>
                  {fieldOptions.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={c.op} onValueChange={(v) => updCond(c.id, { op: v as DisplayCondition['op'] })}>
                <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COND_OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                className="h-7 w-24 text-xs px-2"
                placeholder="值"
                value={c.value}
                onChange={(e) => updCond(c.id, { value: e.target.value })}
              />
              <button type="button" onClick={() => delCond(c.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={addCond}>
        <Plus className="mr-1 h-3.5 w-3.5" />添加过滤条件
      </Button>
    </div>
  );
}