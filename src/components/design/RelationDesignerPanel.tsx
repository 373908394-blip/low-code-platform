import { useMemo, useState } from 'react';
import type { FormField, MetaForm, MetaRelation } from '@/types';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Link2, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/** 布局类字段不可作为关联显示字段 */
const LAYOUT_TYPES = ['grid', 'row', 'section', 'sub-table', 'form-ref', 'query', 'wizard-step', 'action-button', 'divider'];

interface Props {
  formId: string;
  form: MetaForm | null;
  allForms: MetaForm[];
  relations: MetaRelation[];
  /** 新增/删除关联后回调：父组件重新加载表单与关联数据 */
  onChanged: () => void;
}

/**
 * 关联设计面板：维护 meta_relations（源表单 → 目标表单 的关联定义）。
 * 创建关联时可自动在源表单 schema 中生成 form-ref 回填字段，详情页自动渲染关联子列表。
 */
export function RelationDesignerPanel({ formId, form, allForms, relations, onChanged }: Props) {
  const [dlgOpen, setDlgOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [targetId, setTargetId] = useState('');
  const [multiple, setMultiple] = useState(true);
  const [backfillMode, setBackfillMode] = useState<'auto' | string>('auto');
  const [displayKeys, setDisplayKeys] = useState<string[]>(['title']);
  // 主表字段赋值映射：mainKey（本表单字段）← targetKey（关联表字段，'title' 表示记录标题）
  const [mappings, setMappings] = useState<Array<{ mainKey: string; targetKey: string }>>([]);
  const [editingRel, setEditingRel] = useState<MetaRelation | null>(null);

  const sourceFields = useMemo(() => (form?.schema_json?.fields ?? []), [form]);
  const targetForm = allForms.find((f) => f.id === targetId);
  const targetFields = useMemo(
    () => (targetForm?.schema_json?.fields ?? []).filter((f: FormField) => !LAYOUT_TYPES.includes(f.type)),
    [targetForm],
  );
  // 源表单中已存在、指向当前所选目标表单的 form-ref 字段：可直接作为回填字段复用
  const reusableRefFields = useMemo(
    () => sourceFields.filter((f: FormField) => f.type === 'form-ref' && f.relation?.formId === targetId),
    [sourceFields, targetId],
  );

  const myRels = relations.filter((r) => r.source_form_id === formId);
  const inboundRels = relations.filter((r) => r.target_form_id === formId && r.source_form_id !== formId);
  const formName = (id: string) => allForms.find((f) => f.id === id)?.name ?? id.slice(0, 8);
  const fieldLabel = (key: string) => sourceFields.find((f: FormField) => f.key === key)?.label ?? key;
  const targetLabel = (targetFormId: string, key: string) =>
    key === 'title' ? '标题' : ((allForms.find((f) => f.id === targetFormId)?.schema_json?.fields ?? []).find((f: FormField) => f.key === key)?.label ?? key);

  const reset = () => {
    setName('');
    setTargetId('');
    setMultiple(true);
    setBackfillMode('auto');
    setDisplayKeys(['title']);
    setMappings([]);
    setEditingRel(null);
  };

  const openAdd = () => {
    reset();
    setDlgOpen(true);
  };

  // 编辑已有关联：预填名称/目标表单/单多选/显示字段/赋值映射（回填字段与目标表单不可改）
  const openEdit = (rel: MetaRelation) => {
    setEditingRel(rel);
    setName(rel.name);
    setTargetId(rel.target_form_id);
    setMultiple(rel.multiple);
    setDisplayKeys(rel.display_fields?.length ? rel.display_fields : ['title']);
    setMappings(rel.field_mappings ?? []);
    setDlgOpen(true);
  };

  const toggleDisplayKey = (key: string) => {
    setDisplayKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleAdd = async () => {
    if (!name.trim()) return toast.error('请填写关联名称');
    if (!editingRel && !targetId) return toast.error('请选择目标表单');
    if (displayKeys.length === 0) return toast.error('请至少勾选一个显示字段');
    setSaving(true);
    // 编辑模式：仅更新名称/单多选/显示字段/赋值映射
    if (editingRel) {
      const { error } = await supabase.from('meta_relations').update({
        name: name.trim(),
        multiple,
        relation_type: multiple ? 'many_to_many' : 'one_to_many',
        display_fields: displayKeys,
        field_mappings: mappings.filter((m) => m.mainKey && m.targetKey),
      }).eq('id', editingRel.id);
      setSaving(false);
      if (error) return toast.error('更新关联失败：' + error.message);
      toast.success('关联已更新');
      setDlgOpen(false);
      onChanged();
      return;
    }
    let backfillField = '';
    if (backfillMode !== 'auto') {
      backfillField = backfillMode;
    } else {
      // 自动新建 form-ref 回填字段（详情页按关联子列表渲染，不占用普通表单栅格）
      const slug = (targetForm?.name ?? 'target').replace(/[^a-zA-Z0-9一-龥]+/g, '_').slice(0, 20);
      backfillField = `rel_${slug}_${Math.random().toString(36).slice(2, 7)}`;
      const newField: FormField = {
        id: `fld_${Math.random().toString(36).slice(2, 10)}`,
        type: 'form-ref',
        label: name.trim(),
        key: backfillField,
        span: 24,
        relation: {
          formId: targetId,
          displayFields: displayKeys,
          saveMode: 'standalone',
          dataRange: 'permission',
        },
      };
      const nextFields = [...(form?.schema_json?.fields ?? []), newField];
      const { error: fe } = await supabase.from('meta_forms').update({
        schema_json: { ...(form?.schema_json ?? { fields: [] }), fields: nextFields },
        updated_at: new Date().toISOString(),
      }).eq('id', formId);
      if (fe) {
        setSaving(false);
        return toast.error('创建回填字段失败：' + fe.message);
      }
    }
    const { error } = await supabase.from('meta_relations').insert({
      tenant_id: form?.tenant_id ?? '',
      source_form_id: formId,
      target_form_id: targetId,
      name: name.trim(),
      relation_type: multiple ? 'many_to_many' : 'one_to_many',
      backfill_field: backfillField,
      display_fields: displayKeys,
      multiple,
      field_mappings: mappings.filter((m) => m.mainKey && m.targetKey),
    });
    setSaving(false);
    if (error) return toast.error('创建关联失败：' + error.message);
    toast.success('关联已创建，可在下方「操作项配置」中绑定关联表动作');
    setDlgOpen(false);
    onChanged();
  };

  const handleRemove = async (rel: MetaRelation) => {
    if (!window.confirm(`确认删除关联「${rel.name}」？已回填到单据中的关联 ID 不受影响。`)) return;
    setRemovingId(rel.id);
    const { error } = await supabase.from('meta_relations').delete().eq('id', rel.id);
    setRemovingId(null);
    if (error) return toast.error('删除关联失败：' + error.message);
    toast.success('已删除关联');
    onChanged();
  };

  return (
    <div className="mt-6 bg-card border border-border rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">关联设计</h2>
          <span className="text-xs text-muted-foreground">定义本表单与其他表单的关联关系，供「关联表」动作（选择/查看/新增/解除/跳转关联）使用</span>
        </div>
        <Button size="sm" variant="outline" onClick={openAdd}><Plus className="h-3.5 w-3.5 mr-1" />新增关联</Button>
      </div>
      <div className="p-4 space-y-2">
        {myRels.length === 0 && inboundRels.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">暂无关联定义，点击右上角「新增关联」创建</p>
        )}
        {myRels.map((rel) => (
          <div key={rel.id} className="flex items-center gap-3 rounded-md border border-border px-3.5 py-2.5">
            <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {rel.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{form?.name} → {formName(rel.target_form_id)}</span>
              </p>
              <p className="text-xs text-muted-foreground truncate">
                回填字段：{fieldLabel(rel.backfill_field)}（{rel.backfill_field}） · 显示字段：{(rel.display_fields ?? []).join('、') || '—'}
                {(rel.field_mappings ?? []).length > 0 && (
                  <span className="block truncate">
                    字段赋值：{rel.field_mappings!.map((m) => `${fieldLabel(m.mainKey)} ← ${m.targetKey === 'title' ? '标题' : (targetLabel(rel.target_form_id, m.targetKey))}`).join('；')}（赋值后只读）
                  </span>
                )}
              </p>
            </div>
            <Badge className="bg-muted text-muted-foreground hover:bg-muted shrink-0">{rel.multiple ? '多选' : '单选'}</Badge>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => openEdit(rel)}>编辑</Button>
            <Button size="sm" variant="ghost" className="shrink-0 border border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => void handleRemove(rel)} disabled={removingId === rel.id}>
              {removingId === rel.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        ))}
        {inboundRels.map((rel) => (
          <div key={rel.id} className="flex items-center gap-3 rounded-md border border-dashed border-border px-3.5 py-2.5">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate text-muted-foreground">
                {rel.name}
                <span className="ml-2 text-xs">{formName(rel.source_form_id)} → {form?.name}（被关联，定义在源表单）</span>
              </p>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4 text-primary" />新增关联</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1">
              <Label className="text-xs">关联名称</Label>
              <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：费用报销明细" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">目标表单（关联到哪张表）</Label>
              <Select
                value={targetId || 'none'}
                onValueChange={(v) => {
                  setTargetId(v === 'none' ? '' : v);
                  setBackfillMode('auto');
                  setDisplayKeys(['title']);
                }}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="请选择目标表单" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未选择</SelectItem>
                  {allForms.filter((f) => f.id !== formId).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {targetId && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">回填字段（关联记录 ID 存储到本表单的哪个字段）</Label>
                  <Select value={backfillMode} onValueChange={setBackfillMode}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">自动新建关联字段（推荐）</SelectItem>
                      {reusableRefFields.map((f: FormField) => (
                        <SelectItem key={f.id} value={f.key}>复用已有字段：{f.label}（{f.key}）</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">自动新建：在表单中生成隐藏的 form-ref 关联字段，详情页自动渲染关联子列表；也可在表单设计中手动添加「关联表」字段后复用</p>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div>
                    <p className="text-xs font-medium">允许多条关联</p>
                    <p className="text-[11px] text-muted-foreground">关闭则一单仅可关联一条目标记录</p>
                  </div>
                  <Switch checked={multiple} onCheckedChange={setMultiple} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">显示字段（查看/解除关联弹窗与详情子列表的列）</Label>
                  <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-2.5">
                    {['title', 'created_at', ...targetFields.map((f: FormField) => f.key)].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleDisplayKey(k)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          displayKeys.includes(k)
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {k === 'title' ? '标题' : k === 'created_at' ? '创建时间' : (targetFields.find((f: FormField) => f.key === k)?.label ?? k)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">主表字段赋值（关联后自动把关联表字段值写入主表对应字段，被赋值字段只读不可编辑）</Label>
                  <div className="space-y-2 rounded-md border border-border p-2.5">
                    {mappings.length === 0 && <p className="text-[11px] text-muted-foreground">未配置赋值映射，可点击底部按钮添加</p>}
                    {mappings.map((m, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Select
                          value={m.mainKey || 'none'}
                          onValueChange={(v) => setMappings((prev) => prev.map((x, xi) => (xi === i ? { ...x, mainKey: v === 'none' ? '' : v } : x)))}
                        >
                          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="主表字段" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">选择主表字段</SelectItem>
                            {sourceFields.filter((f: FormField) => !LAYOUT_TYPES.includes(f.type)).map((f: FormField) => (
                              <SelectItem key={f.id} value={f.key}>{f.label}（{f.key}）</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground shrink-0">←</span>
                        <Select
                          value={m.targetKey || 'none'}
                          onValueChange={(v) => setMappings((prev) => prev.map((x, xi) => (xi === i ? { ...x, targetKey: v === 'none' ? '' : v } : x)))}
                        >
                          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="关联表字段" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">选择关联表字段</SelectItem>
                            <SelectItem value="title">标题</SelectItem>
                            {targetFields.map((f: FormField) => (
                              <SelectItem key={f.id} value={f.key}>{f.label}（{f.key}）</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="ghost" className="shrink-0 h-8 w-8 p-0 border border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => setMappings((prev) => prev.filter((_, xi) => xi !== i))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" className="w-full" onClick={() => setMappings((prev) => [...prev, { mainKey: '', targetKey: '' }])}>
                      <Plus className="h-3.5 w-3.5 mr-1" />添加赋值映射
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>取消</Button>
            <Button onClick={() => void handleAdd()} disabled={saving || !targetId}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              创建关联
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
