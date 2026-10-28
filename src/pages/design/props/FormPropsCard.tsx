import type { FormField, FormSettings, VisibilityOp, VisibilityRule } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { FileText, AlignLeft, Columns3, Maximize2, ShieldCheck, Eye, Plus, Trash2 } from 'lucide-react';

const ALIGN_OPTS: { value: NonNullable<FormSettings['labelAlign']>; label: string }[] = [
  { value: 'left', label: '左对齐' },
  { value: 'right', label: '右对齐' },
  { value: 'top', label: '顶部对齐' },
];

const SIZE_OPTS: { value: NonNullable<FormSettings['size']>; label: string }[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
];

const DIALOG_OPTS: { value: NonNullable<FormSettings['dialogType']>; label: string }[] = [
  { value: 'center', label: '居中弹窗' },
  { value: 'right', label: '右侧抽屉' },
  { value: 'fullscreen', label: '全屏' },
];

const GUTTER_OPTS = [0, 8, 16, 24];

const VIS_OPS: { value: VisibilityOp; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'empty', label: '为空' },
  { value: 'notempty', label: '不为空' },
];

interface Props {
  settings: FormSettings;
  fields: FormField[];
  onChange: (patch: Partial<FormSettings>) => void;
}

/** 表单属性卡片：配置表单整体的基础信息、布局样式、数据校验、字段显隐规则等全局规则 */
export default function FormPropsCard({ settings, fields, onChange }: Props) {
  const uniqueFields = settings.uniqueFields ?? [];
  const selectableFields = fields.filter((f) => !f.system && !['section', 'row', 'action-button'].includes(f.type));
  // 显隐规则可选字段：包含系统字段与状态字段，仅排除布局/按钮类
  const visibilityFields = fields.filter((f) => !['section', 'row', 'action-button'].includes(f.type));
  const rules = settings.visibilityRules ?? [];

  const toggleUnique = (key: string) => {
    onChange({ uniqueFields: uniqueFields.includes(key) ? uniqueFields.filter((k) => k !== key) : [...uniqueFields, key] });
  };

  const updRules = (next: VisibilityRule[]) => onChange({ visibilityRules: next });

  const addRule = () => {
    const target = visibilityFields[0]?.key ?? '';
    updRules([
      ...rules,
      { id: `vr_${Date.now().toString(36)}`, targetKey: target, action: 'show', logic: 'and', conditions: [{ fieldKey: target, op: 'eq', value: '' }] },
    ]);
  };

  const patchRule = (id: string, patch: Partial<VisibilityRule>) =>
    updRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRule = (id: string) => updRules(rules.filter((r) => r.id !== id));

  return (
    <div className="space-y-5 p-4">
      {/* 基础信息 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />基础信息
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs">表单描述</Label>
          <Textarea
            className="min-h-16 text-xs"
            placeholder="说明该表单的用途与适用场景"
            value={settings.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
      </section>

      {/* 布局与样式 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <AlignLeft className="h-3.5 w-3.5" />布局与样式
        </p>

        <div className="space-y-1.5">
          <Label className="text-xs">标签对齐</Label>
          <div className="flex gap-1.5">
            {ALIGN_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange({ labelAlign: o.value })}
                className={cn('flex-1 h-8 rounded-md border text-xs transition-colors', (settings.labelAlign ?? 'right') === o.value ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">标题宽度（px）</Label>
          <Input
            type="number"
            className="h-8 text-xs"
            value={settings.labelWidth ?? 100}
            onChange={(e) => onChange({ labelWidth: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1 text-xs">
            <Columns3 className="h-3 w-3" />栅格间隔（px）
          </Label>
          <div className="flex gap-1.5">
            {GUTTER_OPTS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onChange({ gutter: g })}
                className={cn('flex-1 h-8 rounded-md border text-xs transition-colors', (settings.gutter ?? 16) === g ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
              >
                {g === 0 ? '无' : g}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">表单尺寸</Label>
          <div className="flex gap-1.5">
            {SIZE_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange({ size: o.value })}
                className={cn('flex-1 h-8 rounded-md border text-xs transition-colors', (settings.size ?? 'medium') === o.value ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1 text-xs">
            <Maximize2 className="h-3 w-3" />弹窗类型
          </Label>
          <div className="flex flex-col gap-1.5">
            {DIALOG_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange({ dialogType: o.value })}
                className={cn('h-8 rounded-md border px-3 text-xs transition-colors text-left', (settings.dialogType ?? 'center') === o.value ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 数据校验 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />数据校验
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs">唯一性校验字段</Label>
          <p className="text-[11px] text-muted-foreground">勾选的字段组合在提交时需保持唯一，防止重复录入</p>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {selectableFields.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">暂无可选字段，请先在画布中添加</p>
            ) : (
              selectableFields.map((f) => {
                const on = uniqueFields.includes(f.key);
                return (
                  <label key={f.id} className="flex min-h-9 items-center gap-2 rounded px-1.5 text-xs hover:bg-muted/50">
                    <input type="checkbox" className="accent-primary" checked={on} onChange={() => toggleUnique(f.key)} />
                    <span className="flex-1 min-w-0 truncate text-foreground">{f.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{f.key}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* 字段显隐规则 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />字段显隐规则
        </p>
        <p className="text-[11px] text-muted-foreground">根据其他字段值动态显示或隐藏目标字段；被隐藏的字段提交时不参与必填校验</p>

        {rules.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center">
            <p className="text-xs text-muted-foreground mb-2">暂无显隐规则</p>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addRule}>
              <Plus className="mr-1 h-3.5 w-3.5" />添加规则
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-md border border-border p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground shrink-0">目标字段</span>
                  <Select value={rule.targetKey || 'none'} onValueChange={(v) => patchRule(rule.id, { targetKey: v === 'none' ? '' : v })}>
                    <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue placeholder="选择字段" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未选择</SelectItem>
                      {visibilityFields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}{f.system ? '（系统）' : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <button type="button" onClick={() => removeRule(rule.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex gap-1.5">
                  {([['show', '满足时显示'], ['hide', '满足时隐藏']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => patchRule(rule.id, { action: val })}
                      className={cn('flex-1 h-7 rounded-md border text-[11px] transition-colors', rule.action === val ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  {rule.conditions.map((c, ci) => (
                    <div key={ci} className="flex items-center gap-1.5">
                      <Select value={c.fieldKey || 'none'} onValueChange={(v) => {
                        const conds = rule.conditions.map((x, i) => i === ci ? { ...x, fieldKey: v === 'none' ? '' : v } : x);
                        patchRule(rule.id, { conditions: conds });
                      }}>
                        <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue placeholder="触发字段" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未选择</SelectItem>
                          {visibilityFields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}{f.system ? '（系统）' : ''}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={c.op} onValueChange={(v) => {
                        const conds = rule.conditions.map((x, i) => i === ci ? { ...x, op: v as VisibilityOp } : x);
                        patchRule(rule.id, { conditions: conds });
                      }}>
                        <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VIS_OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {(c.op === 'eq' || c.op === 'neq' || c.op === 'contains') && (
                        <Input
                          className="h-7 w-20 text-xs"
                          value={c.value}
                          onChange={(e) => {
                            const conds = rule.conditions.map((x, i) => i === ci ? { ...x, value: e.target.value } : x);
                            patchRule(rule.id, { conditions: conds });
                          }}
                          placeholder="值"
                        />
                      )}
                      <button type="button" onClick={() => patchRule(rule.id, { conditions: rule.conditions.filter((_, i) => i !== ci) })} className="shrink-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <Select value={rule.logic} onValueChange={(v) => patchRule(rule.id, { logic: v as 'and' | 'or' })}>
                      <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="and">且 (AND)</SelectItem>
                        <SelectItem value="or">或 (OR)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => patchRule(rule.id, { conditions: [...rule.conditions, { fieldKey: '', op: 'eq', value: '' }] })}>
                      <Plus className="mr-1 h-3.5 w-3.5" />添加条件
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={addRule}>
              <Plus className="mr-1 h-3.5 w-3.5" />添加规则
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}