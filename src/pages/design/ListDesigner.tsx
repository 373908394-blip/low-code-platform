import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GuideButton } from '@/components/common/GuideButton';
import { LIST_GUIDE } from '@/lib/page-guides';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { ActionDef, ActionPosition, ColumnConfig, FormField, ListConfig, MetaForm, MetaRelation, SearchConfig, SmState, SmTransition } from '@/types';
import { ensureSystemFields, CompositeDetailFields } from '@/lib/field-catalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ChevronLeft, Save, Loader2, Columns3, Search, MousePointerClick, Trash2, ArrowUp, ArrowDown, Zap, LayoutList } from 'lucide-react';
import { cn } from '@/lib/utils';
import ActionPanel, { ACTION_TYPES, POSITION_LABEL } from './ActionPanel';
import { PrintExportTemplateDesigner } from '@/components/design/PrintExportTemplateDesigner';
import { RelationDesignerPanel } from '@/components/design/RelationDesignerPanel';
import type { PrintExportTemplate } from '@/types';

const LAYOUT_TYPES = ['group-title', 'grid', 'divider', 'description', 'wizard-step'];
const FORMATS: { value: NonNullable<ColumnConfig['format']>; label: string }[] = [
  { value: 'none', label: '原样显示' },
  { value: 'date', label: '日期 2026-01-01' },
  { value: 'datetime', label: '日期时间' },
  { value: 'money', label: '金额千分位' },
  { value: 'percent', label: '百分比' },
];
const CONTROLS: { value: NonNullable<SearchConfig['control']>; label: string }[] = [
  { value: 'input', label: '输入框' },
  { value: 'select', label: '下拉选择' },
  { value: 'date-range', label: '日期范围' },
  { value: 'cascader', label: '级联选择' },
];

export default function ListDesigner({ embedded }: { embedded?: boolean }) {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [form, setForm] = useState<MetaForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<ListConfig>({ columns: [], search: [], actions: ['view', 'edit', 'delete'] });
  const [allForms, setAllForms] = useState<MetaForm[]>([]);
  const [relations, setRelations] = useState<MetaRelation[]>([]);
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [relationsToDelete, setRelationsToDelete] = useState<string[]>([]);
  // 当前表单状态机：转换规则注入动作类型（SM_TRANSITION 动态选项）
  const [smTransitions, setSmTransitions] = useState<SmTransition[]>([]);
  const [smStates, setSmStates] = useState<{ key: string; label: string }[]>([]);

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    const [formRes, formsRes, relRes, actRes, smRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle(),
      supabase.from('meta_forms').select('*').order('updated_at', { ascending: false }),
      supabase.from('meta_relations').select('*').or(`source_form_id.eq.${formId},target_form_id.eq.${formId}`),
      supabase.from('meta_actions').select('*').eq('form_id', formId).order('sort'),
      supabase.from('meta_state_machine').select('states, transitions').eq('form_id', formId).maybeSingle(),
    ]);
    if (formRes.data) {
      setForm(formRes.data as MetaForm);
      setCfg((formRes.data as MetaForm).list_config ?? { columns: [], search: [], actions: ['view', 'edit', 'delete'] });
    }
    setAllForms((formsRes.data as MetaForm[]) ?? []);
    setRelations((relRes.data as MetaRelation[]) ?? []);
    setActions((actRes.data as ActionDef[]) ?? []);
    const sm = smRes.data as { states?: SmState[]; transitions?: SmTransition[] } | null;
    setSmTransitions(sm?.transitions ?? []);
    setSmStates((sm?.states ?? []).map((s) => ({ key: s.key, label: s.label })));
    setRelationsToDelete([]);
    setLoading(false);
  }, [formId]);

  useEffect(() => {
    load();
  }, [load]);

  // 列/筛选项可选字段：含 8 个系统字段（员工姓名/所属部门/职位/创建人/创建时间/更新人/更新时间/状态）；普通表单无系统状态，不提供「状态」系统列
  const allFields = ensureSystemFields((form?.schema_json?.fields ?? []).filter((f: FormField) => !LAYOUT_TYPES.includes(f.type)));
  const fields = form?.form_mode === 'normal' ? allFields.filter((f: FormField) => f.key !== 'status') : allFields;
  const fieldByKey = new Map(fields.map((f: FormField) => [f.key, f]));

  const save = async () => {
    if (!form || !formId) return;
    setSaving(true);
    // 保存列表配置
    const { error } = await supabase.from('meta_forms').update({
      list_config: cfg,
      updated_at: new Date().toISOString(),
    }).eq('id', formId);
    if (error) {
      setSaving(false);
      return toast.error(error.message.includes('row-level security') ? '保存失败：仅超级管理员可修改表单设计' : '保存失败：' + error.message);
    }
    // 保存操作项：同步删除库里已移除的，再逐条 upsert 当前列表
    if (relationsToDelete.length > 0) await supabase.from('meta_relations').delete().in('id', relationsToDelete);
    const { data: dbActions } = await supabase.from('meta_actions').select('id').eq('form_id', formId);
    const keptIds = new Set(actions.filter((a) => !a.id.startsWith('tmp_')).map((a) => a.id));
    const removeIds = ((dbActions as { id: string }[] | null) ?? []).map((x) => x.id).filter((id) => !keptIds.has(id));
    if (removeIds.length > 0) await supabase.from('meta_actions').delete().in('id', removeIds);
    let lastErr: string | null = null;
    for (const a of actions) {
      // 剔除 created_at（由 DB 默认值 now() 生成），避免空字符串导致 timestamptz 报错 22007
      const { created_at: _omit, ...rest } = { ...a, tenant_id: profile?.tenant_id ?? '', form_id: formId, sort: actions.indexOf(a) + 1, updated_at: new Date().toISOString() };
      if (a.id.startsWith('tmp_')) {
        const { id: _omitId, ...insertPayload } = rest;
        const { error: e } = await supabase.from('meta_actions').insert(insertPayload);
        if (e) lastErr = e.message;
      } else {
        const { error: e } = await supabase.from('meta_actions').update(rest).eq('id', a.id);
        if (e) lastErr = e.message;
      }
    }
    setSaving(false);
    if (lastErr) return toast.error(lastErr.includes('row-level security') ? '操作项保存出错：仅超级管理员可修改表单设计' : '操作项保存出错：' + lastErr);
    toast.success('列表页与操作项配置已保存');
    load();
  };

  const toggleColumn = (f: FormField, on: boolean) => {
    setCfg((c) => {
      const cols = c.columns ?? [];
      if (on) return { ...c, columns: [...cols, { key: f.key, label: f.label, align: 'left', format: 'none' }] };
      return { ...c, columns: cols.filter((x) => x.key !== f.key) };
    });
  };
  const updColumn = (i: number, patch: Partial<ColumnConfig>) =>
    setCfg((c) => ({ ...c, columns: (c.columns ?? []).map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }));
  const moveColumn = (i: number, dir: -1 | 1) =>
    setCfg((c) => {
      const cols = [...(c.columns ?? [])];
      const j = i + dir;
      if (j < 0 || j >= cols.length) return c;
      [cols[i], cols[j]] = [cols[j], cols[i]];
      return { ...c, columns: cols };
    });

  const toggleSearch = (f: FormField, on: boolean) => {
    setCfg((c) => {
      const s = c.search ?? [];
      const control: SearchConfig['control'] = f.options ? 'select' : f.type === 'date' || f.type === 'datetime' ? 'date-range' : 'input';
      if (on) return { ...c, search: [...s, { key: f.key, label: f.label, control, options: f.options }] };
      return { ...c, search: s.filter((x) => x.key !== f.key) };
    });
  };
  const updSearch = (i: number, patch: Partial<SearchConfig>) =>
    setCfg((c) => ({ ...c, search: (c.search ?? []).map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }));

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!form) return <div className="p-8 text-center text-muted-foreground">表单不存在</div>;
  if (fields.length === 0) {
    return (
      <div className="p-8">
        <Button variant="ghost" size="sm" onClick={() => navigate('/design/apps')}><ChevronLeft className="mr-1.5 h-4 w-4" />返回</Button>
        <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
          <Columns3 className="h-8 w-8" />
          <p className="text-sm">该表单还没有字段，请先完成表单设计</p>
          <Button size="sm" onClick={() => navigate(`/design/${formId}?tab=form`)}>去设计表单</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('p-4 md:p-8 max-w-6xl', embedded && 'h-full overflow-y-auto')}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-white border border-white rounded-[5px] px-5 py-4">
        <div className="flex items-center gap-2 min-w-0">
          {!embedded && <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/design/apps')}><ChevronLeft className="h-4 w-4" /></Button>}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{form.name} · 列表页设计</h1>
            <p className="text-sm text-muted-foreground mt-1">配置列表显示列、搜索筛选与行操作</p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <GuideButton label="列表页设计" guide={LIST_GUIDE} />
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}保存配置</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 列显示配置 */}
        <div className="bg-card border border-border rounded-lg">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <Columns3 className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">列表显示列</h2>
            <span className="text-xs text-muted-foreground">已选 {(cfg.columns ?? []).length} / {fields.length}</span>
          </div>
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            {fields.map((f) => (
              <div key={f.id} className="min-w-0">
                <label className="flex min-h-10 items-center gap-2 text-sm rounded-md px-2 hover:bg-muted/50">
                  <Checkbox
                    checked={(cfg.columns ?? []).some((c) => c.key === f.key)}
                    onCheckedChange={(v) => toggleColumn(f, v === true)}
                  />
                  <span className="flex-1 min-w-0 truncate">{f.label}</span>
                  <span className="text-xs text-muted-foreground font-mono">{f.key}</span>
                </label>
                <CompositeDetailFields field={f} forms={allForms} />
              </div>
            ))}
          </div>
          {(cfg.columns ?? []).length > 0 && (
            <div className="border-t border-border p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">列顺序与格式</p>
              {(cfg.columns ?? []).map((c, i) => (
                <div key={c.key} className="flex flex-wrap items-center gap-1.5 rounded-md border border-border px-2.5 py-2">
                  <div className="flex flex-col">
                    <button type="button" className="h-4 w-4 flex items-center justify-center hover:text-primary" onClick={() => moveColumn(i, -1)}><ArrowUp className="h-3 w-3" /></button>
                    <button type="button" className="h-4 w-4 flex items-center justify-center hover:text-primary" onClick={() => moveColumn(i, 1)}><ArrowDown className="h-3 w-3" /></button>
                  </div>
                  <span className="text-xs font-medium w-20 truncate">{c.label}</span>
                  <Select value={c.format ?? 'none'} onValueChange={(v) => updColumn(i, { format: v as ColumnConfig['format'] })}>
                    <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={c.align ?? 'left'} onValueChange={(v) => updColumn(i, { align: v as ColumnConfig['align'] })}>
                    <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="left">左对齐</SelectItem><SelectItem value="center">居中</SelectItem><SelectItem value="right">右对齐</SelectItem></SelectContent>
                  </Select>
                  <Input type="number" className="w-20 h-7 text-xs" placeholder="宽度" value={c.width ?? ''} onChange={(e) => updColumn(i, { width: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 搜索筛选配置 */}
        <div className="bg-card border border-border rounded-lg">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <Search className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">搜索筛选</h2>
            <span className="text-xs text-muted-foreground">已选 {(cfg.search ?? []).length} 项</span>
          </div>
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            {fields.map((f) => (
              <div key={f.id} className="min-w-0">
                <label className="flex min-h-10 items-center gap-2 text-sm rounded-md px-2 hover:bg-muted/50">
                  <Checkbox
                    checked={(cfg.search ?? []).some((x) => x.key === f.key)}
                    onCheckedChange={(v) => toggleSearch(f, v === true)}
                  />
                  <span className="flex-1 min-w-0 truncate">{f.label}</span>
                  <span className="text-xs text-muted-foreground font-mono">{f.key}</span>
                </label>
                <CompositeDetailFields field={f} forms={allForms} />
              </div>
            ))}
          </div>
          {(cfg.search ?? []).length > 0 && (
            <div className="border-t border-border p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">筛选控件类型</p>
              {(cfg.search ?? []).map((s, i) => (
                <div key={s.key} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2">
                  <span className="text-xs font-medium w-20 truncate">{s.label}</span>
                  <Select value={s.control} onValueChange={(v) => updSearch(i, { control: v as SearchConfig['control'] })}>
                    <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{CONTROLS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {fieldByKey.get(s.key)?.type === 'form-ref' ? (
                    <label className="flex items-center gap-1.5 text-xs min-h-7">
                      <Switch checked={!!s.dynamic} onCheckedChange={(v) => updSearch(i, { dynamic: v })} />
                      动态数据源
                    </label>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">{s.options ? `选项：${s.options.slice(0, 2).join('/')}…` : '文本匹配'}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 打印与导出设计 */}
      <PrintExportTemplateDesigner
        templates={cfg.templates || []}
        onChange={(templates: PrintExportTemplate[]) => setCfg((prev) => ({ ...prev, templates }))}
        fields={fields}
        forms={allForms}
        onAddAction={(actionPatch) => {
          const newId = 'tmp_' + Math.random().toString(36).slice(2, 9);
          const fullAction: ActionDef = {
            id: newId,
            tenant_id: profile?.tenant_id ?? '',
            form_id: formId!,
            position: actionPatch.position || 'toolbar',
            name: actionPatch.name || '打印/导出',
            icon: actionPatch.icon || 'printer',
            variant: actionPatch.variant || 'secondary',
            action_type: actionPatch.action_type || 'PRINT',
            config: actionPatch.config || {},
            show_condition: null,
            enable_condition: null,
            permission_code: null,
            confirm_text: null,
            success_text: null,
            after_behavior: 'none',
            sort: actions.length + 1,
            version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          setActions((prev) => [...prev, fullAction]);
        }}
      />

      {/* 关联设计：维护 meta_relations，供关联表动作（选择/查看/新增/解除/跳转关联）绑定使用 */}
      <RelationDesignerPanel
        formId={formId ?? ''}
        form={form}
        allForms={allForms}
        relations={relations}
        onChanged={load}
      />

      {/* 操作项配置（动作引擎） */}
      <div className="mt-6 bg-card border border-border rounded-lg">
        <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-border">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">操作项配置（动作引擎）</h2>
          <span className="text-xs text-muted-foreground">
            按钮绑定动作：CRUD / 关联表{form?.form_mode === 'state' ? ' / 状态变更' : ''}{form?.form_mode === 'approval' ? ' / 流程' : ''} / 跳转 / 数据更新 / 文件 / 接口 / 组合
          </span>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['toolbar', 'row', 'batch'] as ActionPosition[]).map((pos) => (
            <div key={pos} className="rounded-md border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
                <LayoutList className="h-3.5 w-3.5" />{POSITION_LABEL[pos]}
              </p>
              <ActionPanel
                position={pos}
                actions={actions.filter((a) => a.position === pos)}
                onChange={(list) => setActions((prev) => {
                  const others = prev.filter((a) => a.position !== pos);
                  return [...others, ...list.map((a, i) => ({ ...a, position: pos, sort: i + 1 }))];
                })}
                forms={allForms}
                relations={relations.map((r) => ({ id: r.id, name: r.name, target_form_id: r.target_form_id }))}
                fields={fields}
                formMode={form?.form_mode}
                smTransitions={smTransitions}
                smStates={smStates}
                templates={cfg.templates || []}
              />
              {pos === 'row' && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">超出折叠</Label>
                  <Select value={String(cfg.row_visible_limit ?? 3)} onValueChange={(v) => setCfg((c) => ({ ...c, row_visible_limit: Number(v) }))}>
                    <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n} 个以内</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 实时预览 */}
      <div className="mt-6 bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">实时预览</h2>
          <p className="text-xs text-muted-foreground mt-0.5">保存后业务列表页将按此渲染</p>
        </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  {(cfg.columns ?? []).map((c) => (
                    <th key={c.key} className={cn('px-4 py-2.5 font-medium whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>{c.label}</th>
                  ))}
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  {(cfg.columns ?? []).map((c) => (
                    <td key={c.key} className={cn('px-4 py-2.5 text-muted-foreground/70 whitespace-nowrap', c.align === 'right' && 'text-right')}>
                      {c.format === 'money' ? '¥1,234.00' : c.format === 'date' ? '2026-01-01' : c.format === 'percent' ? '85%' : c.format === 'datetime' ? '2026-01-01 12:00' : '示例数据'}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right whitespace-nowrap text-xs text-primary">
                    {(() => {
                      const rowActs = actions.filter((a) => a.position === 'row');
                      const limit = cfg.row_visible_limit ?? 3;
                      const visible = rowActs.slice(0, limit).map((a) => a.name);
                      const more = rowActs.length - limit;
                      return visible.length > 0 ? visible.join(' · ') + (more > 0 ? ` · 更多(${more})` : '') : '—';
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
            {(cfg.columns ?? []).length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">尚未选择显示列</p>
            )}
          </div>
          {(cfg.search ?? []).length > 0 && (
            <div className="border-t border-border px-4 py-3 flex flex-wrap gap-2">
              {(cfg.search ?? []).map((s) => (
                <span key={s.key} className="h-7 inline-flex items-center rounded border border-border px-2.5 text-xs text-muted-foreground">
                  {s.label}：{s.control === 'select' ? '▾ 下拉' : s.control === 'date-range' ? '📅 日期' : s.control === 'cascader' ? '⌗ 级联' : '⌨ 输入'}
                </span>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
