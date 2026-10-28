import type { DisplayCondition, ManualFilter } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Filter, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FieldOption { key: string; label: string }

interface Props {
  /** 目标表单可选字段 */
  fieldOptions: FieldOption[];
  /** 显示条件列表 */
  conditions: DisplayCondition[];
  /** 显示条件之间的逻辑关系 */
  conditionsLogic?: 'and' | 'or';
  /** 手动筛选列表 */
  manualFilters: ManualFilter[];
  /** 手动筛选项之间的逻辑关系 */
  manualFiltersLogic?: 'and' | 'or';
  /** 隐藏手动筛选区（仅显示条件场景使用） */
  hideManualFilters?: boolean;
  onUpdate: (patch: { conditions?: DisplayCondition[]; conditionsLogic?: 'and' | 'or'; manualFilters?: ManualFilter[]; manualFiltersLogic?: 'and' | 'or' }) => void;
}

const COND_OPS: { value: DisplayCondition['op']; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
];

const FILTER_CONTROLS: { value: ManualFilter['control']; label: string }[] = [
  { value: 'input', label: '输入框' },
  { value: 'select', label: '下拉选择' },
  { value: 'date', label: '日期' },
  { value: 'date-range', label: '日期范围' },
];

/** 显示条件 + 手动筛选编辑器：供查询表单/关联表单组件属性面板复用 */
export default function RelationFilterEditor({ fieldOptions, conditions, conditionsLogic, manualFilters, manualFiltersLogic, hideManualFilters, onUpdate }: Props) {
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

  const updFilter = (id: string, patch: Partial<ManualFilter>) =>
    onUpdate({ manualFilters: manualFilters.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const addFilter = () =>
    onUpdate({
      manualFilters: [
        ...manualFilters,
        { id: `mf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, fieldKey: '', control: 'input', label: '', options: [] },
      ],
    });
  const delFilter = (id: string) => onUpdate({ manualFilters: manualFilters.filter((m) => m.id !== id) });

  return (
    <div className="space-y-4">
      {/* 显示条件 */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs">
          <Filter className="h-3.5 w-3.5" />显示条件
          <span className="text-[10px] text-muted-foreground font-normal">（对数据源自动过滤）</span>
        </Label>
        <p className="text-[11px] text-muted-foreground">设置后仅查询/展示满足条件的记录，如：只查询 状态 = 已通过</p>
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
          <Plus className="mr-1 h-3.5 w-3.5" />添加显示条件
        </Button>
      </div>

      {/* 手动筛选 */}
      {!hideManualFilters && (
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs">
          <SlidersHorizontal className="h-3.5 w-3.5" />手动筛选
          <span className="text-[10px] text-muted-foreground font-normal">（运行时用户交互筛选）</span>
        </Label>
        <p className="text-[11px] text-muted-foreground">设置后查询表单在表头上方、关联表单在选择弹窗上方渲染筛选区</p>
        {manualFilters.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground shrink-0">条件关系</span>
            <div className="flex gap-1">
              {(['and', 'or'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => onUpdate({ manualFiltersLogic: l })}
                  className={cn('h-6 rounded border px-2 text-[11px] transition-colors', (manualFiltersLogic ?? 'and') === l ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                >
                  {l === 'and' ? '且 (AND)' : '或 (OR)'}
                </button>
              ))}
            </div>
          </div>
        )}
        {manualFilters.length > 0 && (
          <div className="space-y-2">
            {manualFilters.map((m) => (
              <div key={m.id} className="rounded-md border border-border p-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Select value={m.fieldKey || 'none'} onValueChange={(v) => updFilter(m.id, { fieldKey: v === 'none' ? '' : v })}>
                    <SelectTrigger className="h-7 flex-1 min-w-0 text-xs"><SelectValue placeholder="筛选字段" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未选择</SelectItem>
                      {fieldOptions.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={m.control} onValueChange={(v) => updFilter(m.id, { control: v as ManualFilter['control'] })}>
                    <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FILTER_CONTROLS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <button type="button" onClick={() => delFilter(m.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Input
                  className="h-7 w-full text-xs px-2"
                  placeholder="筛选标签（可选）"
                  value={m.label ?? ''}
                  onChange={(e) => updFilter(m.id, { label: e.target.value })}
                />
                <Input
                  className="h-7 w-full text-xs px-2"
                  placeholder="输入框默认提示文字（运行时显示）"
                  value={m.placeholder ?? ''}
                  onChange={(e) => updFilter(m.id, { placeholder: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={addFilter}>
          <Plus className="mr-1 h-3.5 w-3.5" />添加手动筛选
        </Button>
      </div>
      )}
    </div>
  );
}