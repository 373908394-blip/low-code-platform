import type { TextSourceConfig } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getIcon, ICON_NAMES } from '@/lib/icon-registry';
import DataRangeSelector from '@/pages/components/DataRangeSelector';
import ConditionsEditor from './ConditionsEditor';

interface FieldOption { key: string; label: string }

/** 表单选项：仅需 id 与 name */
interface FormOption { id: string; name: string }

interface Props {
  /** 数据源配置（受控） */
  source: TextSourceConfig;
  /** 可选表单列表 */
  forms: FormOption[];
  /** 根据表单 id 返回可选字段 */
  fieldOptions: (formId: string) => FieldOption[];
  /** 配置变更回调 */
  onChange: (next: TextSourceConfig) => void;
}

type AggValue = 'first' | 'sum' | 'count';

const AGG_OPTIONS: { value: AggValue; label: string }[] = [
  { value: 'first', label: '取首条' },
  { value: 'sum', label: '求和' },
  { value: 'count', label: '计数' },
];

/** 文本数据源编辑器：关联表单 / 默认值 / 数据范围 / 显示字段 / 聚合 / 过滤条件。供文本显示组件与分栏每栏复用 */
export default function TextSourceEditor({ source, forms, fieldOptions, onChange }: Props) {
  const patch = (p: Partial<TextSourceConfig>) => onChange({ ...source, ...p });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">关联表单</Label>
        <Select value={source.formId || 'none'} onValueChange={(v) => patch({ formId: v === 'none' ? '' : v, fieldKey: '' })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择目标表单" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未选择</SelectItem>
            {forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* 未关联表单：显示默认值输入框 */}
      {!source.formId && (
        <div className="space-y-1">
          <Label className="text-xs">默认值</Label>
          <Input className="h-8 text-xs px-2" placeholder="未关联表单时显示的内容" value={source.defaultValue ?? ''} onChange={(e) => patch({ defaultValue: e.target.value })} />
        </div>
      )}

      {source.formId && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">显示字段</Label>
            <Select value={source.fieldKey || 'none'} onValueChange={(v) => patch({ fieldKey: v === 'none' ? '' : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择字段" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未选择</SelectItem>
                {fieldOptions(source.formId).map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">聚合方式</Label>
            <Select value={source.aggregate ?? 'first'} onValueChange={(v) => patch({ aggregate: v as AggValue })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AGG_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">数据范围</Label>
            <DataRangeSelector value={source.dataRange ?? 'permission'} onChange={(v) => patch({ dataRange: v })} />
          </div>

          <ConditionsEditor
            fieldOptions={fieldOptions(source.formId)}
            conditions={source.conditions ?? []}
            conditionsLogic={source.conditionsLogic ?? 'and'}
            onUpdate={(p) => patch(p)}
          />

          <div className="space-y-1">
            <Label className="text-xs">图标</Label>
            <Select value={source.icon || 'none'} onValueChange={(v) => patch({ icon: v === 'none' ? '' : v })}>
              <SelectTrigger className="h-8 text-xs">
                {(() => { const I = source.icon ? getIcon(source.icon) : null; return (
                  <div className="flex items-center gap-1.5">
                    {I && <I className="h-3.5 w-3.5" />}
                    <span>{source.icon ?? '无图标'}</span>
                  </div>
                ); })()}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">无图标</SelectItem>
                {ICON_NAMES.map((name) => {
                  const I = getIcon(name);
                  return (
                    <SelectItem key={name} value={name}>
                      <div className="flex items-center gap-1.5">
                        <I className="h-3.5 w-3.5" />
                        <span>{name}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">单位</Label>
            <Input className="h-8 text-xs px-2" placeholder="如：条、个、元" value={source.unit ?? ''} onChange={(e) => patch({ unit: e.target.value })} />
            <p className="text-[10px] text-muted-foreground/70">计数时显示的自定义单位（留空默认「条」）</p>
          </div>
        </>
      )}
    </div>
  );
}