import {
  AlignLeft, ArrowDown, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUp, Banknote, Building2, Calculator,
  Calendar, CalendarClock, CalendarRange, CaseUpper, ChevronDownSquare, ChevronLeft, CircleDot, Clock,
  Columns3, Copy, FileDigit, FileInput, FileText, GripVertical, Hash, Heading, ImageIcon, Info, Link2,
  ListChecks, ListOrdered, Loader2, MapPin, Minus, MousePointerClick, Paperclip, Percent, Plus, Printer,
  Rocket, Save, Search, SearchCheck, Send, Sigma, Smartphone, SquareCheck, Table, ToggleRight, Trash2,
  Type, Undo2, User, X, Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { GuideButton } from '@/components/common/GuideButton';
import { AiRuleMatcher } from '@/components/design/AiRuleMatcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { DEFAULT_WORK_HOURS, ensureSystemFields, FIELD_CATALOG, findFieldDef, normalizeWorkHours, workHoursPerDay } from '@/lib/field-catalog';
import { FORM_GUIDE } from '@/lib/page-guides';
import { nextAutoSlug } from '@/lib/slug';
import { cn } from '@/lib/utils';
import DataRangeSelector from '@/pages/components/DataRangeSelector';
import { ensureTodoMenu } from '@/services/publish';
import type { ActionType, BizData, FormButton, FormField, FormSettings, MetaForm, SerialRule, TextColumnConfig, TextSourceConfig, ValueAssignRule } from '@/types';
import FormPropsCard from './props/FormPropsCard';
import RelationFilterEditor from './props/RelationFilterEditor';
import TextSourceEditor from './props/TextSourceEditor';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  type: Type, hash: Hash, calendar: Calendar, clock: Clock, 'calendar-clock': CalendarClock, 'calendar-range': CalendarRange,
  banknote: Banknote, percent: Percent, 'align-left': AlignLeft, 'chevron-down-square': ChevronDownSquare,
  'list-checks': ListChecks, 'circle-dot': CircleDot, 'square-check': SquareCheck, 'toggle-right': ToggleRight, 'search-square': SearchCheck, 'square-check-check': ListChecks,
  user: User, 'building-2': Building2, 'file-digit': FileDigit, paperclip: Paperclip, image: ImageIcon, 'file-text': FileText,
  'map-pin': MapPin, link: Link2, search: Search, sigma: Sigma, calculator: Calculator, 'arrow-down-up': ArrowDownUp, 'case-upper': CaseUpper,
  heading: Heading, 'columns-3': Columns3, minus: Minus, info: Info, send: Send, 'undo-2': Undo2,
  printer: Printer, zap: Zap, smartphone: Smartphone, table: Table, 'list-ordered': ListOrdered,
};

const LAYOUT_TYPES = ['group-title', 'grid', 'divider', 'description', 'wizard-step'];
/** 按钮组件（动作引擎载体） */
const BUTTON_TYPES = ['action-button'];

/** 表单按钮可选动作类型（提交类 + 自定义操作） */
const BUTTON_ACTIONS: { value: ActionType; label: string }[] = [
  { value: 'CREATE', label: '新增' },
  { value: 'EDIT', label: '编辑' },
  { value: 'VIEW', label: '查看' },
  { value: 'DELETE', label: '删除' },
  { value: 'CHANGE_STATUS', label: '状态变更' },
  { value: 'START_WORKFLOW', label: '发起审批' },
  { value: 'APPROVE', label: '审批通过' },
  { value: 'REJECT', label: '审批驳回' },
  { value: 'WITHDRAW', label: '撤回申请' },
  { value: 'UPDATE_DATA', label: '更新字段' },
  { value: 'NAVIGATE', label: '跳转页面' },
  { value: 'PRINT', label: '打印' },
  { value: 'CALL_API', label: '调用接口' },
  { value: 'REF_ASSIGN', label: '关联表单赋值' },
];

/** 选项联动赋值编辑器：当本字段取某值时，为当前表单其他文本框字段赋值 */
function ValueAssignEditor({ sel, fields, updSel }: {
  sel: FormField;
  fields: FormField[];
  updSel: (patch: Partial<FormField>) => void;
}) {
  const isOptionField = ['radio', 'checkbox', 'select', 'multi-select', 'search-select', 'search-multi-select'].includes(sel.type);
  if (!isOptionField) return null;
  const rules = sel.valueAssign ?? [];
  // 可作为赋值目标的字段：当前表单中除自身外的可写文本类字段
  const targetOptions = fields.filter(
    (f) => f.id !== sel.id && ['input', 'textarea', 'number', 'money', 'percent', 'date', 'time', 'datetime', 'location', 'richtext'].includes(f.type),
  );
  // 触发值候选：自定义选项优先；动态数据源时留空让用户手填
  const valueOptions = sel.options ?? [];
  const updRule = (id: string, patch: Partial<ValueAssignRule>) =>
    updSel({ valueAssign: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const delRule = (id: string) => updSel({ valueAssign: rules.filter((r) => r.id !== id) });
  const addRule = () =>
    updSel({
      valueAssign: [...rules, { id: `va_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, whenValue: '', targetKey: '', value: '' }],
    });

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        联动赋值
        <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[9px]">可选</Badge>
      </Label>
      <p className="text-xs text-muted-foreground">当本字段选择某值时，自动为当前表单的其他文本框字段写入指定值</p>
      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="rounded-md border border-border p-2.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="shrink-0">当值为</span>
                {valueOptions.length > 0 ? (
                  <Select value={r.whenValue || 'none'} onValueChange={(v) => updRule(r.id, { whenValue: v === 'none' ? '' : v })}>
                    <SelectTrigger className="h-7 flex-1 min-w-0 text-xs"><SelectValue placeholder="选择触发值" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未选择</SelectItem>
                      {valueOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input className="h-7 flex-1 min-w-0 text-xs" placeholder="输入触发值" value={r.whenValue} onChange={(e) => updRule(r.id, { whenValue: e.target.value })} />
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="shrink-0">赋值给</span>
                <Select value={r.targetKey || 'none'} onValueChange={(v) => updRule(r.id, { targetKey: v === 'none' ? '' : v })}>
                  <SelectTrigger className="h-7 flex-1 min-w-0 text-xs"><SelectValue placeholder="选择目标字段" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未选择</SelectItem>
                    {targetOptions.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="shrink-0">写入值</span>
                <Input className="h-7 flex-1 min-w-0 text-xs" placeholder="写入目标字段的值" value={r.value} onChange={(e) => updRule(r.id, { value: e.target.value })} />
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10" onClick={() => delRule(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={addRule}><Plus className="mr-1 h-3.5 w-3.5" />添加联动赋值规则</Button>
    </div>
  );
}

/** 选项多行编辑器：本地保存原始文本（含换行/空行），仅在提交时解析为选项数组，确保回车可换行 */
function OptionsTextarea({ value, onChange }: { value: string[]; onChange: (opts: string[]) => void }) {
  const [text, setText] = useState(() => value.join('\n'));
  const commit = (raw: string) => onChange(raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0));
  return (
    <Textarea
      className="min-h-20 text-xs"
      value={text}
      onCompositionEnd={(e) => { const v = (e.target as HTMLTextAreaElement).value; setText(v); commit(v); }}
      onChange={(e) => { setText(e.target.value); if ((e.nativeEvent as InputEvent).isComposing) return; commit(e.target.value); }}
      placeholder={'选项一\n选项二'}
    />
  );
}

export default function FormDesigner({ embedded }: { embedded?: boolean }) {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [form, setForm] = useState<MetaForm | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [allForms, setAllForms] = useState<Pick<MetaForm, 'id' | 'name' | 'schema_json'>[]>([]);
  const [formSettings, setFormSettings] = useState<FormSettings>({});
  const [propTab, setPropTab] = useState<'field' | 'form'>('field');
  // 系统默认组件（员工姓名/创建人/状态等）默认隐藏，点击可显示
  const [showSystem, setShowSystem] = useState(false);

  // 发布状态桥接：统一设计器将发布按钮置于选项卡行右侧，通过事件触发本组件的发布逻辑
  const setPubState = (v: boolean) => {
    setPublishing(v);
    if (embedded) window.dispatchEvent(new CustomEvent('designer-publishing', { detail: v }));
  };
  const publishRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!embedded) return;
    const h = () => void publishRef.current();
    window.addEventListener('designer-publish', h);
    return () => window.removeEventListener('designer-publish', h);
  }, [embedded]);

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    const [fRes, listRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle(),
      supabase.from('meta_forms').select('id, name, schema_json').order('name'),
    ]);
    if (fRes.data) {
      const f = fRes.data as MetaForm;
      setForm(f);
      setFormSettings(f.settings ?? {});
      // 自动补齐系统审计字段（创建人/创建时间/更新人/更新时间）
      setFields(ensureSystemFields((f.schema_json?.fields ?? []) as FormField[]));
    }
    setAllForms((listRes.data as Pick<MetaForm, 'id' | 'name' | 'schema_json'>[]) ?? []);
    setLoading(false);
  }, [formId]);

  const updFormSettings = (patch: Partial<FormSettings>) => setFormSettings((prev) => ({ ...prev, ...patch }));

  // 获取目标表单的可选字段（key + 中文 label，含系统字段），用于下拉数据源/关联显示字段配置
  const targetFieldOptions = (formId2: string): { key: string; label: string; system?: boolean }[] => {
    const target = allForms.find((f) => f.id === formId2);
    const fs = ensureSystemFields((target?.schema_json?.fields ?? []) as FormField[]);
    // 已拆分的请假时间复合字段不再作为关联/查询/选项来源的候选字段
    return fs.filter((f) => !LAYOUT_TYPES.includes(f.type) && f.type !== 'action-button' && !(f.type === 'leave-time' && f.leaveTime?.startKey && f.leaveTime?.endKey))
      .map((f) => ({ key: f.key, label: f.system ? `${f.label}（系统）` : f.label, system: f.system }));
  };

  // 获取目标表单名称
  const targetFormName = (formId2: string): string => allForms.find((f) => f.id === formId2)?.name ?? '';

  useEffect(() => {
    load();
  }, [load]);

  const sel = useMemo(() => fields.find((f) => f.id === selected) ?? null, [fields, selected]);

  // 分栏布局选中的当前栏目索引（0 ~ columns - 1）
  const [activeGridCol, setActiveGridCol] = useState(0);

  // 分栏数调整辅助：支持 1-6 栏，平滑扩容或裁剪，并更新每栏配置
  const setGridColumns = (cols: number) => {
    const cur = sel?.gridColumns ?? [];
    const next: TextColumnConfig[] = Array.from({ length: cols }).map((_, i) =>
      cur[i] ?? {
        title: `第 ${i + 1} 栏`,
        source: { formId: '', fieldKey: '', aggregate: 'first' as const, dataRange: 'permission' as const, defaultValue: '' },
      },
    );
    updSel({ layout: { ...sel?.layout, columns: cols }, gridColumns: next });
    if (activeGridCol >= cols) setActiveGridCol(cols - 1);
  };

  // 设置指定栏目的文本数据源配置
  const setGridColumn = (index: number, source: TextColumnConfig) => {
    const cur = sel?.gridColumns ?? [];
    const next = cur.map((c, i) => (i === index ? { ...c, ...source } : c));
    updSel({ gridColumns: next });
  };

  // 向导步骤已内置为组件（wizard-step 容器）：字段通过 parentId 归属步骤，此处不再维护独立步骤配置
  const stepFields = fields.filter((f) => f.type === 'wizard-step');


  const addField = (type: string, parentId?: string) => {
    const def = findFieldDef(type);
    if (!def) return;
    const idx = fields.filter((f) => !LAYOUT_TYPES.includes(f.type)).length + 1;
    const isLayout = LAYOUT_TYPES.includes(type);
    const isButton = BUTTON_TYPES.includes(type);
    const f: FormField = {
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      label: isLayout || isButton ? def.label : `${def.label}${idx}`,
      key: isLayout ? `layout_${idx}` : isButton ? `button_${idx}` : `field_${idx}`,
      span: def.span,
      // 向导步骤等容器：指定 parentId 放入容器内
      ...(parentId && !isLayout && !isButton ? { parentId } : {}),
      ...(isLayout ? {
        layout: { text: def.label, columns: 2, description: '' },
        ...(type === 'grid' ? {
          gridColumns: [
            { title: '第 1 栏', formId: '', fieldKey: '', aggregate: 'first' as const, dataRange: 'permission' as const, defaultValue: '' },
            { title: '第 2 栏', formId: '', fieldKey: '', aggregate: 'first' as const, dataRange: 'permission' as const, defaultValue: '' },
          ],
        } : {}),
      } : {}),
      ...(isButton ? { button: { actionType: 'CHANGE_STATUS', stateMachineEvent: '', targetStatus: '' } } : {}),
      ...(type === 'select' || type === 'multi-select' || type === 'search-select' || type === 'search-multi-select' ? { optionType: 'custom' as const, options: ['选项一', '选项二'] } : type === 'radio' || type === 'checkbox' ? { options: ['选项一', '选项二'] } : {}),
      ...(type === 'formula' ? { formula: { expression: '' } } : {}),
      ...(type === 'fetch-value' ? { fetchValue: { source: 'subtable' as const, fieldKey: '', sortBy: 'value-desc' as const } } : {}),
      ...(type === 'form-assignment' ? {
        assignment: {
          formId: form?.id ?? '',
          displayFieldKeys: [],
          displaySeparator: ' ',
          mappings: [],
          searchFieldKeys: [],
        },
      } : {}),
      ...(type === 'summary' ? { summary: { source: 'current' as const, aggregate: 'count' as const, fieldKey: '' } } : {}),
      ...(type === 'serial-number' ? {
        serialRules: [
          { id: `sr_${Date.now()}_1`, type: 'fixed', value: 'SN' },
          { id: `sr_${Date.now()}_2`, type: 'date', format: 'yyyyMMdd' },
          { id: `sr_${Date.now()}_3`, type: 'counter', digits: 5, pad: true, resetCycle: 'never', start: 1 },
        ],
      } : {}),
      ...(type === 'sub-table' ? { subTable: { targetFormId: '', displayColumns: [], minRows: 0, maxRows: 0, saveMode: 'with-main' } } : {}),
    };
    setFields((s) => [...s, f]);
    setSelected(f.id);
  };

  const updSel = (patch: Partial<FormField>) => {
    if (!sel) return;
    setFields((s) => s.map((f) => (f.id === sel.id ? { ...f, ...patch } : f)));
  };

  // 名称变更时自动生成拼音标识：标识为空、等于旧名称生成值或为系统默认标识（field_N 等）时跟随更新，人工修改后锁定
  const updSelLabel = (label: string) => {
    if (!sel) return;
    const nextKey = nextAutoSlug(label, sel.label, sel.key, /^(field|layout|button)_\d+$/);
    updSel(nextKey !== null ? { label, key: nextKey } : { label });
  };

  const move = (id: string, dir: -1 | 1) => {
    setFields((s) => {
      const i = s.findIndex((f) => f.id === id);
      const f = s[i];
      if (i < 0 || !f) return s;
      // 容器内组件仅在容器内移动；顶层组件跳过容器内部块
      if (f.parentId) {
        const scope = s.map((x, ix) => ({ x, ix })).filter(({ x }) => x.parentId === f.parentId);
        const pos = scope.findIndex(({ x }) => x.id === id);
        const j = scope[pos + dir]?.ix ?? -1;
        if (j < 0) return s;
        const n = [...s];
        [n[i], n[j]] = [n[j], n[i]];
        return n;
      }
      let j = i + dir;
      while (j >= 0 && j < s.length && s[j].parentId) j += dir;
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };

  /** 拖拽排序：将 fromId 组件移动到 toId 组件的位置（容器内组件不越出容器，顶层组件不落入容器） */
  const reorderFields = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setFields((s) => {
      const from = s.findIndex((f) => f.id === fromId);
      const to = s.findIndex((f) => f.id === toId);
      if (from < 0 || to < 0) return s;
      const fromF = s[from];
      const toF = s[to];
      // 嵌套约束：容器内组件仅可与同容器组件互换；顶层组件不可拖入容器内部
      if (!!fromF.parentId !== !!toF.parentId || (fromF.parentId && fromF.parentId !== toF.parentId)) return s;
      const n = [...s];
      const [moved] = n.splice(from, 1);
      n.splice(to, 0, moved);
      return n;
    });
  };

  const removeField = (id: string) => {
    const field = fields.find((f) => f.id === id);
    if (field?.system) return toast.error('系统字段不可删除，保存时自动记录');
    // 容器组件（如向导步骤）删除时，其内部字段一并删除
    setFields((s) => s.filter((f) => f.id !== id && f.parentId !== id));
    if (selected === id) setSelected(null);
  };

  const dupField = (id: string) => {
    setFields((s) => {
      const i = s.findIndex((f) => f.id === id);
      if (i < 0) return s;
      const copy: FormField = { ...s[i], id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, key: s[i].key + '_copy' };
      const n = [...s];
      n.splice(i + 1, 0, copy);
      return n;
    });
  };

  const save = async (silent = false) => {
    if (!form || !formId) return;
    // key 唯一性校验（容器组件无 key 不参与）
    const keys = fields.filter((f) => !LAYOUT_TYPES.includes(f.type)).map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      toast.error('存在重复的字段标识，请检查右侧属性面板');
      return;
    }
    setSaving(true);
    // 补全子表字段缺失的 saveMode（旧版本创建的字段无此配置，默认 with-main 并持久化）
    const fieldsToSave: FormField[] = fields.map((f) => {
      if (f.type === 'sub-table' && f.subTable && !f.subTable.saveMode) {
        return { ...f, subTable: { ...f.subTable, saveMode: 'with-main' as const } };
      }
      return f;
    });
    const nextVersion = (form.version ?? 0) + 1;
    const { error, count } = await supabase.from('meta_forms').update({
      schema_json: { fields: fieldsToSave },
      settings: formSettings,
      steps: [],
      version: nextVersion,
      updated_at: new Date().toISOString(),
    }, { count: 'exact' }).eq('id', formId);
    setSaving(false);
    if (error) return toast.error('保存失败：' + error.message);
    if ((count ?? 0) === 0) return toast.error('保存失败：无权限或表单不存在');
    // 乐观更新本地状态，避免 load() 竞态导致内容被重置
    setForm((prev) => (prev ? { ...prev, version: nextVersion, schema_json: { fields }, settings: formSettings } : prev));
    if (!silent) toast.success('表单已保存（v' + nextVersion + '）');
  };

  const publish = async () => {
    if (!form || !formId) return;
    await save(true);
    setPubState(true);
    const newVer = (form.version ?? 0) + 1;
    const { error: pubErr, count: pubCount } = await supabase.from('meta_forms').update({
      published_version: newVer,
      status: 'published',
    }, { count: 'exact' }).eq('id', formId);
    if (pubErr) {
      setPubState(false);
      return toast.error('发布失败：' + pubErr.message);
    }
    if ((pubCount ?? 0) === 0) {
      setPubState(false);
      return toast.error('发布失败：无权限或表单不存在');
    }
    // 补全子表字段缺失的 saveMode（与 save() 保持一致，避免发布快照丢失配置）
    const fieldsToPublish: FormField[] = fields.map((f) => {
      if (f.type === 'sub-table' && f.subTable && !f.subTable.saveMode) {
        return { ...f, subTable: { ...f.subTable, saveMode: 'with-main' as const } };
      }
      return f;
    });
    await supabase.from('meta_version').insert({
      tenant_id: tenantId,
      form_id: formId,
      version: newVer,
      snapshot: { fields: fieldsToPublish } as unknown as Record<string, unknown>,
      changelog: `发布 v${newVer} · ${fields.length} 个组件`,
      created_by: profile?.id ?? null,
    });
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId, user_id: profile?.id, user_name: profile?.name,
      action: '发布表单', target: `${form.name} v${newVer}`, detail: { form: form.code, version: newVer },
    });
    setPubState(false);
    // 乐观更新本地状态，避免 load() 竞态导致内容被重置
    setForm((prev) => (prev ? { ...prev, version: newVer, published_version: newVer, status: 'published' as const, schema_json: { fields: fieldsToPublish } } : prev));
    // 若表单含审批流程，自动在工作台-待办事项下生成该应用的待办菜单
    await ensureTodoMenu(formId!);
    toast.success(`已发布 v${newVer}，运行时立即生效`);
  };
  // 供统一设计器选项卡行的发布按钮触发（渲染期同步 ref，事件回调始终拿到最新闭包）
  publishRef.current = async () => { await publish(); };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!form) return <div className="p-8 text-center text-muted-foreground">表单不存在</div>;

  // 渲染单个字段卡片（自定义字段与系统默认组件共用）
  /** 向导步骤容器卡片：整块渲染，内嵌步骤内字段（parentId 指向该步骤），可继续点击组件库添加字段到本步骤 */
  const renderStepCard = (f: FormField, stepNo: number) => {
    const inner = fields.filter((x) => x.parentId === f.id && !x.system);
    const active = selected === f.id;
    return (
      <div key={f.id} style={{ gridColumn: 'span 24 / span 24' }} className="min-w-0">
        <div
          className={cn(
            'group relative rounded-lg border bg-card/60 transition-all',
            active ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/40',
          )}
        >
          {active && (
            <span className="absolute -top-2.5 right-2 z-10 flex gap-0.5">
              <button type="button" title="上移" className="h-5 w-5 flex items-center justify-center rounded bg-primary text-primary-foreground" onClick={(e) => { e.stopPropagation(); move(f.id, -1); }}><ArrowUp className="h-3 w-3" /></button>
              <button type="button" title="下移" className="h-5 w-5 flex items-center justify-center rounded bg-primary text-primary-foreground" onClick={(e) => { e.stopPropagation(); move(f.id, 1); }}><ArrowDown className="h-3 w-3" /></button>
              <button type="button" title="删除" className="h-5 w-5 flex items-center justify-center rounded bg-destructive text-destructive-foreground" onClick={(e) => { e.stopPropagation(); removeField(f.id); }}><Trash2 className="h-3 w-3" /></button>
            </span>
          )}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{stepNo}</span>
            <span className="text-sm font-medium truncate">{f.layout?.text || `步骤 ${stepNo}`}</span>
            <span className="text-[11px] text-muted-foreground shrink-0">{inner.length} 个字段</span>
          </div>
          <div
            className="p-3"
            onDragOver={(e) => { e.preventDefault(); }}
          >
            {inner.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 text-muted-foreground">
                <ListOrdered className="h-5 w-5" />
                <p className="text-xs">选中本步骤后，从左侧组件库添加字段到这一步</p>
              </div>
            ) : (
              <div className="grid grid-cols-24 gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                {inner.map((x) => renderCard(x))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCard = (f: FormField) => {
    const def = findFieldDef(f.type);
    const isLayout = LAYOUT_TYPES.includes(f.type);
    const active = selected === f.id;
    return (
      <div key={f.id} style={{ gridColumn: `span ${f.span ?? 12} / span ${f.span ?? 12}` }} className={cn('min-w-0', isLayout && 'col-span-full')}>
        <div
          draggable
          onDragStart={(e) => { e.stopPropagation(); setDragId(f.id); }}
          onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== f.id) setOverId(f.id); }}
          onDragLeave={() => setOverId((o) => (o === f.id ? null : o))}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId) reorderFields(dragId, f.id); setDragId(null); setOverId(null); }}
          onDragEnd={() => { setDragId(null); setOverId(null); }}
          onClick={() => setSelected(f.id)}
          className={cn(
            'group relative rounded-md border px-3.5 py-3 transition-all cursor-pointer',
            active ? 'border-primary ring-1 ring-primary/30 bg-primary/[0.03]' : 'border-border hover:border-primary/40 bg-card',
            dragId === f.id && 'opacity-40',
            overId === f.id && dragId && dragId !== f.id && 'ring-2 ring-primary/60 border-primary',
          )}
        >
          {active && (
            <span className="absolute -top-2.5 right-2 z-10 flex gap-0.5">
              <button type="button" title="上移" className="h-5 w-5 flex items-center justify-center rounded bg-primary text-primary-foreground" onClick={(e) => { e.stopPropagation(); move(f.id, -1); }}><ArrowUp className="h-3 w-3" /></button>
              <button type="button" title="下移" className="h-5 w-5 flex items-center justify-center rounded bg-primary text-primary-foreground" onClick={(e) => { e.stopPropagation(); move(f.id, 1); }}><ArrowDown className="h-3 w-3" /></button>
              <button type="button" title="复制" className="h-5 w-5 flex items-center justify-center rounded bg-primary text-primary-foreground" onClick={(e) => { e.stopPropagation(); dupField(f.id); }}><Copy className="h-3 w-3" /></button>
              <button type="button" title="删除" className="h-5 w-5 flex items-center justify-center rounded bg-destructive text-destructive-foreground" onClick={(e) => { e.stopPropagation(); removeField(f.id); }}><Trash2 className="h-3 w-3" /></button>
            </span>
          )}
          <GripVertical className="absolute left-1 top-3.5 h-3.5 w-3.5 text-muted-foreground/40 cursor-grab active:cursor-grabbing" />
          {isLayout ? (
            <LayoutPreview
              field={f}
              activeGridCol={activeGridCol}
              onSelectGridCol={(idx) => {
                setSelected(f.id);
                setActiveGridCol(idx);
              }}
            />
          ) : BUTTON_TYPES.includes(f.type) ? (
            <ButtonPreview field={f} />
          ) : (
            <FieldPreview field={f} defLabel={def?.label ?? ''} forms={allForms} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={cn('flex', embedded ? 'h-full' : 'h-[calc(100vh-3.5rem)]')}>
      {/* 左：组件库（纯白背景） */}
      <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-border bg-white overflow-y-auto">
        <div className="px-4 py-3.5 border-b border-border sticky top-0 bg-white z-10">
          <p className="text-sm font-semibold">组件库</p>
          <p className="text-xs text-muted-foreground mt-0.5">点击添加到画布</p>
        </div>
        <div className="p-3 space-y-4">
          {FIELD_CATALOG.map((cat) => (
            <div key={cat.key}>
              <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">{cat.label}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {cat.fields.map((def) => {
                  const Icon = ICON_MAP[def.icon] ?? Type;
                  return (
                    <button
                      key={def.type}
                      type="button"
                  onClick={() => addField(def.type, selected && fields.find((f) => f.id === selected)?.type === 'wizard-step' ? selected : undefined)}
                      className="flex flex-col items-center gap-1.5 rounded-md border border-border bg-card py-2.5 px-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                    >
                      <Icon className="h-4 w-4" />
                      <span className="truncate w-full text-center">{def.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 中：画布 */}
      <div className="flex-1 min-w-0 flex flex-col bg-muted/30 overflow-y-auto">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-white border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            {!embedded && (
              <>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/design/apps')}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-semibold truncate">{form.name} · 表单设计</span>
                <Badge className="bg-muted text-muted-foreground hover:bg-muted shrink-0">v{form.version}{form.status === 'published' ? ` · 已发布 v${form.published_version}` : ' · 草稿'}</Badge>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <GuideButton label="表单设计" guide={FORM_GUIDE} />
            <Button variant="outline" size="sm" className="h-8" onClick={() => save()} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}保存</Button>
            {/* embedded 模式下发布按钮位于统一设计器选项卡行最右侧，此处不再显示 */}
            {!embedded && <Button size="sm" className="h-8" onClick={publish} disabled={publishing}>{publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}发布</Button>}
          </div>
        </div>

        <div className="p-4 md:p-6">
          <div className="mx-auto max-w-3xl bg-card border border-border rounded-lg shadow-sm">
            <div className="px-6 py-5 border-b border-border">
              <div className="flex items-center justify-between gap-2">
                <p className="text-base font-semibold">{form.name}</p>
                <Button
                  variant={showSystem ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={() => setShowSystem((v) => !v)}
                >
                  {showSystem ? '隐藏系统组件' : '显示系统组件'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">共 {fields.length} 个组件 · {fields.filter((f) => f.required).length} 个必填</p>
            </div>
            <div className="p-6">
              {fields.length === 0 && (
                <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                  <MousePointerClick className="h-8 w-8" />
                  <p className="text-sm">从左侧组件库点击添加字段</p>
                </div>
              )}
              {(() => {
                /* 顶层渲染：wizard-step 容器整块渲染（含内部字段），其余顶层字段直接渲染 */
                const top = fields.filter((f) => !f.system && !f.parentId);
                const stepsOnly = fields.filter((f) => f.type === 'wizard-step');
                return (
                  <div className="space-y-3">
                    {top.length === 0 && stepsOnly.length === 0 && <p className="text-sm text-muted-foreground">从左侧组件库点击添加字段</p>}
                    {(() => {
                      const stepIdx = new Map(stepsOnly.map((s, i) => [s.id, i + 1]));
                      return (
                        <div className="grid grid-cols-24 gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                          {top.map((f) => (f.type === 'wizard-step' ? renderStepCard(f, stepIdx.get(f.id) ?? 0) : renderCard(f)))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
              {showSystem && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground">系统默认组件</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid grid-cols-24 gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                    {fields.filter((f) => f.system).map((f) => renderCard(f))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 右：属性面板（纯白背景） */}
      <aside className="w-[22rem] shrink-0 border-l border-border bg-white overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white">
          <Tabs value={propTab} onValueChange={(v) => setPropTab(v as 'field' | 'form')}>
            <TabsList className="w-full rounded-none bg-transparent p-0">
              <TabsTrigger value="field" className="flex-1 rounded-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none">字段属性</TabsTrigger>
              <TabsTrigger value="form" className="flex-1 rounded-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none">表单属性</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {propTab === 'field' ? (
          sel ? (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  字段属性
                  {sel.system && <Badge className="bg-accent/10 text-accent hover:bg-accent/10 px-1.5 py-0 text-[9px]">系统</Badge>}
                </p>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(null)}><ChevronLeft className="h-4 w-4" /></Button>
              </div>

            <div className="space-y-2">
              <Label>字段名称</Label>
              <Input
                value={sel.label}
                onCompositionEnd={(e) => { updSelLabel((e.target as HTMLInputElement).value); }}
                onChange={(e) => { if ((e.nativeEvent as InputEvent).isComposing) return; updSelLabel(e.target.value); }}
              />
            </div>
            {!LAYOUT_TYPES.includes(sel.type) && !BUTTON_TYPES.includes(sel.type) && (
              <>
                <div className="space-y-2">
                  <Label>字段标识（key）</Label>
                  <Input
                    className="font-mono text-xs"
                    disabled={sel.system}
                    value={sel.key}
                    onCompositionEnd={(e) => { updSel({ key: (e.target as HTMLInputElement).value.replace(/[^a-zA-Z0-9_]/g, '_') }); }}
                    onChange={(e) => { if ((e.nativeEvent as InputEvent).isComposing) return; updSel({ key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') }); }}
                  />
                  <p className="text-[11px] text-muted-foreground">{sel.system ? '系统字段，保存时自动填充' : '根据名称自动生成（拼音），可编辑；存储键名，唯一'}</p>
                </div>
                <div className="space-y-2">
                  <Label>字段类型</Label>
                  <Input disabled value={findFieldDef(sel.type)?.label ?? sel.type} />
                </div>
                <div className="space-y-2">
                  <Label>占位提示</Label>
                  <Input value={sel.placeholder ?? ''} onChange={(e) => updSel({ placeholder: e.target.value })} placeholder="输入框内灰色提示" />
                </div>
                <div className="space-y-2">
                  <Label>默认值</Label>
                  <Input value={sel.defaultValue ?? ''} onChange={(e) => updSel({ defaultValue: e.target.value })} />
                </div>
                {(sel.type === 'image' || sel.type === 'attachment') && (
                  <div className="space-y-2">
                    <Label>最大上传数量</Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={sel.maxCount ?? 1}
                      onChange={(e) => updSel({ maxCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                    />
                    <p className="text-[11px] text-muted-foreground">图片上传/附件上传允许的最大文件数（默认 1）</p>
                  </div>
                )}
                {(sel.type === 'input' || sel.type === 'phone') && form?.form_mode !== 'approval' && (
                  <div className="space-y-1.5">
                    <Label>是否唯一</Label>
                    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <span className="text-xs text-muted-foreground">保存时校验同表单内该字段值不可重复</span>
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={sel.unique === true} onChange={(e) => updSel({ unique: e.target.checked })} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">开启后新增/编辑保存时将校验该字段值是否已存在，重复则拒绝保存并提示</p>
                  </div>
                )}

                {(sel.type === 'radio' || sel.type === 'checkbox') && (
                  <div className="space-y-2">
                    <Label>选项（每行一个）</Label>
                    <OptionsTextarea key={sel.id} value={sel.options ?? []} onChange={(opts) => updSel({ options: opts })} />
                  </div>
                )}

                <ValueAssignEditor sel={sel} fields={fields} updSel={updSel} />

                {!LAYOUT_TYPES.includes(sel.type) && !BUTTON_TYPES.includes(sel.type) && !sel.system && sel.parentId && stepFields.length > 0 && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs font-medium">所属向导步骤</p>
                    <Select
                      value={sel.parentId ?? '__none'}
                      onValueChange={(v) => { if (v !== '__none') updSel({ parentId: v }); }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择所属步骤" /></SelectTrigger>
                      <SelectContent>
                        {stepFields.map((s, i) => (
                          <SelectItem key={s.id} value={s.id}>步骤 {i + 1}：{s.layout?.text || '未命名'}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">向导表单运行时按步骤分页填写</p>
                  </div>
                )}

                {sel.type === 'sub-table' && (
                  <div className="space-y-2.5 rounded-md border border-border p-3">
                    <p className="text-xs font-medium">关联子表设置</p>
                    <div className="space-y-1">
                      <Label className="text-xs">目标子表单</Label>
                      <Select
                        value={sel.subTable?.targetFormId || 'none'}
                        onValueChange={(v) => {
                          updSel({ subTable: { targetFormId: v === 'none' ? '' : v, displayColumns: [], minRows: sel.subTable?.minRows ?? 0, maxRows: sel.subTable?.maxRows ?? 0 } });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择目标子表单" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未选择</SelectItem>
                          {allForms.filter((f) => f.id !== formId).map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {sel.subTable?.targetFormId && (
                        <p className="text-[11px] text-muted-foreground">当前来源：<span className="text-foreground">{targetFormName(sel.subTable.targetFormId)}</span></p>
                      )}
                    </div>
                    {sel.subTable?.targetFormId && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-xs">数据保存方式</Label>
                          <Select
                            value={sel.subTable?.saveMode ?? 'with-main'}
                            onValueChange={(v) => updSel({ subTable: { ...sel.subTable!, targetFormId: sel.subTable!.targetFormId, saveMode: v as 'with-main' | 'standalone' } })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="with-main">随主表统一保存（默认）</SelectItem>
                              <SelectItem value="standalone">单独保存且关联主表</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-muted-foreground">随主表保存：明细以 JSON 内嵌存入主表单据，随主表一起保存；单独保存：明细行弹窗点「确定」即入库并关联主表，列表即时显示</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">数据范围</Label>
                          <DataRangeSelector value={sel.subTable?.dataRange ?? 'all'} onChange={(v) => updSel({ subTable: { ...sel.subTable!, targetFormId: sel.subTable!.targetFormId, dataRange: v } })} />
                          <p className="text-[11px] text-muted-foreground">限定运行态可选择的目标子表数据范围</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">列表显示字段（多选）</Label>
                          <div className="max-h-36 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                            {targetFieldOptions(sel.subTable.targetFormId).map((o) => {
                              const checked = sel.subTable!.displayColumns.includes(o.key);
                              return (
                                <label key={o.key} className="flex items-center gap-2 text-xs cursor-pointer">
                                  <Checkbox checked={checked} onCheckedChange={(v) => {
                                    const cols = sel.subTable!.displayColumns;
                                    updSel({ subTable: { ...sel.subTable!, displayColumns: v ? [...cols, o.key] : cols.filter((k) => k !== o.key) } });
                                  }} />
                                  <span className="truncate">{o.label}（{o.key}）</span>
                                </label>
                              );
                            })}
                          </div>
                          <p className="text-[11px] text-muted-foreground">未选择时默认展示子表单前 3 个字段</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">最少行数</Label>
                            <Input type="number" min={0} className="h-8 text-xs" value={sel.subTable?.minRows ?? 0} onChange={(e) => updSel({ subTable: { ...sel.subTable!, minRows: Math.max(0, Number(e.target.value) || 0) } })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">最多行数（0 不限）</Label>
                            <Input type="number" min={0} className="h-8 text-xs" value={sel.subTable?.maxRows ?? 0} onChange={(e) => updSel({ subTable: { ...sel.subTable!, maxRows: Math.max(0, Number(e.target.value) || 0) } })} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {(sel.type === 'select' || sel.type === 'multi-select' || sel.type === 'search-select' || sel.type === 'search-multi-select') && (
                  <>
                    <div className="space-y-2">
                      <Label>选项类型</Label>
                      <div className="flex gap-1.5">
                        {([['custom', '自定义'], ['data', '选择数据']] as const).map(([val, label]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => updSel({ optionType: val })}
                            className={cn('flex-1 h-8 rounded-md border text-xs transition-colors', (sel.optionType ?? 'custom') === val ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {(sel.optionType ?? 'custom') === 'custom' ? (
                      <div className="space-y-2">
                        <Label>选项（每行一个）</Label>
                        <OptionsTextarea key={sel.id} value={sel.options ?? []} onChange={(opts) => updSel({ options: opts })} />
                      </div>
                    ) : (
                      <div className="space-y-2 rounded-md border border-border p-3">
                        <p className="text-xs font-medium">选择数据</p>
                        <div className="space-y-1">
                          <Label className="text-xs">数据来源表单</Label>
                          <Select
                            value={sel.optionSource?.formId || 'none'}
                            onValueChange={(v) => updSel({ optionSource: { formId: v === 'none' ? '' : v, fieldKey: '', fieldKeys: undefined, separator: undefined, dataRange: sel.optionSource?.dataRange ?? 'permission' } })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择来源表单" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未选择</SelectItem>
                              {allForms.filter((f) => f.id !== formId).map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {sel.optionSource?.formId && (
                            <p className="text-[11px] text-muted-foreground">当前来源：<span className="text-foreground">{targetFormName(sel.optionSource.formId)}</span></p>
                          )}
                        </div>
                        {sel.optionSource?.formId && (
                          <div className="space-y-1.5 rounded-md bg-muted/50 p-2">
                            <Label className="text-xs">显示字段</Label>
                            <p className="text-[10px] text-muted-foreground/70">勾选 1 个字段时选项直接显示该字段值；勾选多个字段时按分隔符拼接。选项值为记录 id，各字段值以引用前缀分字段存储</p>
                            <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
                              {targetFieldOptions(sel.optionSource.formId).map((o) => {
                                const keys = sel.optionSource?.fieldKeys ?? (sel.optionSource?.fieldKey ? [sel.optionSource.fieldKey] : []);
                                const idx = keys.indexOf(o.key);
                                const nextKeys = (checked: boolean) => (checked ? [...keys, o.key] : keys.filter((k) => k !== o.key));
                                return (
                                  <label key={o.key} className="flex min-h-8 items-center gap-2 rounded px-1 text-xs cursor-pointer hover:bg-background/60">
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                                      checked={idx >= 0}
                                      onChange={(e) => updSel({ optionSource: { formId: sel.optionSource!.formId, fieldKey: '', fieldKeys: nextKeys(e.target.checked).length > 0 ? nextKeys(e.target.checked) : undefined, separator: sel.optionSource?.separator, dataRange: sel.optionSource?.dataRange ?? 'all' } })}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{o.label}（{o.key}）</span>
                                  </label>
                                );
                              })}
                            </div>
                            {((sel.optionSource.fieldKeys?.length ?? 0) > 0 || !!sel.optionSource.fieldKey) && (
                              <div className="space-y-1">
                                <Label className="text-xs">组合分隔符（仅多字段拼接时生效）</Label>
                                <Input
                                  className="h-8 text-xs"
                                  placeholder="默认 -"
                                  value={sel.optionSource.separator ?? ''}
                                  onChange={(e) => updSel({ optionSource: { formId: sel.optionSource!.formId, fieldKey: '', fieldKeys: sel.optionSource?.fieldKeys ?? (sel.optionSource?.fieldKey ? [sel.optionSource.fieldKey] : undefined), separator: e.target.value || undefined, dataRange: sel.optionSource?.dataRange ?? 'all' } })}
                                />
                              </div>
                            )}
                          </div>
                        )}
                        {sel.optionSource?.formId && (
                          <div className="space-y-1">
                            <Label className="text-xs">数据范围</Label>
                            <DataRangeSelector value={sel.optionSource?.dataRange ?? 'all'} onChange={(v) => updSel({ optionSource: { formId: sel.optionSource!.formId, fieldKey: sel.optionSource?.fieldKey ?? '', fieldKeys: sel.optionSource?.fieldKeys, separator: sel.optionSource?.separator, dataRange: v } })} />
                            <p className="text-[10px] text-muted-foreground/70">限制可拉取选项的数据来源范围</p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {sel.type === 'amount-uppercase' && (() => {
                  const cur = sel.uppercaseAmount?.fieldKey ?? '';
                  // 关联字段候选：计算类字段（公式/汇总统计/关联取值）+ 数字/金额/百分比输入字段
                  const amountFields = fields.filter((x) => ['number', 'money', 'percent', 'formula', 'summary', 'fetch-value'].includes(x.type) && x.key !== sel.key);
                  return (
                    <div className="space-y-2 rounded-md border border-border p-3">
                      <p className="text-xs font-medium">大写金额换算</p>
                      <div className="space-y-1">
                        <Label className="text-xs">关联金额字段</Label>
                        <Select value={cur || 'none'} onValueChange={(v) => updSel({ uppercaseAmount: { fieldKey: v === 'none' ? '' : v } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择计算/数字/金额字段" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">未选择</SelectItem>
                            {amountFields.map((x) => (
                              <SelectItem key={x.key} value={x.key}>{x.label}（{x.key}）</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">填写时自动将该字段的金额换算为中文大写（如 1234.56 → 壹仟贰佰叁拾肆元伍角陆分），实时展示并随单据保存</p>
                      </div>
                    </div>
                  );
                })()}

                {(sel.type === 'user-select' || sel.type === 'dept-select') && (
                  <div className="space-y-2">
                    <Label>选择模式</Label>
                    <div className="flex gap-1.5">
                      {([['single', '单选'], ['multi', '多选']] as const).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => updSel({ multi: val === 'multi' })}
                          className={cn('flex-1 h-8 rounded-md border text-xs transition-colors', (sel.multi ? 'multi' : 'single') === val ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{sel.type === 'user-select' ? '从组织成员中选择人员' : '从组织架构中选择部门'}，多选时存储为多个 ID</p>
                  </div>
                )}

                {sel.type === 'form-ref' && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs font-medium">关联表设置</p>
                    <div className="space-y-1">
                      <Label className="text-xs">关联表单</Label>
                      <Select value={sel.relation?.formId || 'none'} onValueChange={(v) => updSel({ relation: { ...sel.relation, formId: v === 'none' ? '' : v, displayFields: [], dataRange: sel.relation?.dataRange ?? 'permission' } })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择目标表单" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未选择</SelectItem>
                          {allForms.filter((f) => f.id !== formId).map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {sel.relation?.formId && (
                        <p className="text-[11px] text-muted-foreground">当前关联：<span className="text-foreground">{targetFormName(sel.relation.formId)}</span></p>
                      )}
                    </div>
                    {sel.relation?.formId && (
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <Label className="text-xs">数据保存方式</Label>
                          <Select
                            value={sel.relation?.saveMode ?? 'with-main'}
                            onValueChange={(v) => updSel({ relation: { ...sel.relation, formId: sel.relation!.formId, saveMode: v as 'with-main' | 'standalone' } })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="with-main">随主表统一保存（默认）</SelectItem>
                              <SelectItem value="standalone">单独保存且关联主表</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-muted-foreground">随主表保存：选中记录快照内嵌存入主表单据，不引用外部记录；单独保存：主表仅存选中记录 ID 并关联目标表单</p>
                        </div>
                        <Label className="text-xs">显示字段（子列表列）</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {targetFieldOptions(sel.relation.formId).map((o) => {
                            const selected = (sel.relation?.displayFields ?? []).includes(o.key);
                            return (
                              <button
                                key={o.key}
                                type="button"
                                onClick={() => {
                                  const cur = sel.relation?.displayFields ?? [];
                                  updSel({ relation: { ...sel.relation, formId: sel.relation!.formId, displayFields: selected ? cur.filter((x) => x !== o.key) : [...cur, o.key] } });
                                }}
                                className={cn('h-6 rounded border px-2 text-[11px] transition-colors', selected ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                              >
                                {o.label}
                              </button>
                            );
                          })}
                        </div>

                        {(sel.relation?.displayFields ?? []).length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[11px] text-muted-foreground">已选字段顺序（可上移/下移）</p>
                            <div className="space-y-1">
                              {(sel.relation.displayFields ?? []).map((k, idx) => {
                                const meta = targetFieldOptions(sel.relation!.formId).find((o) => o.key === k);
                                const move = (dir: -1 | 1) => {
                                  const cur = [...(sel.relation!.displayFields ?? [])];
                                  const to = idx + dir;
                                  if (to < 0 || to >= cur.length) return;
                                  [cur[idx], cur[to]] = [cur[to], cur[idx]];
                                  updSel({ relation: { ...sel.relation, formId: sel.relation!.formId, displayFields: cur } });
                                };
                                return (
                                  <div key={k} className="flex items-center gap-2 rounded border border-border bg-background px-2 h-8">
                                    <span className="text-[11px] text-muted-foreground w-4">{idx + 1}</span>
                                    <span className="flex-1 min-w-0 truncate text-xs text-foreground">{meta?.label ?? k}</span>
                                    <span className="text-[10px] text-muted-foreground/70 shrink-0">{k}</span>
                                    <div className="flex shrink-0">
                                      <button type="button" onClick={() => move(-1)} disabled={idx === 0} className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                                      <button type="button" onClick={() => move(1)} disabled={idx === (sel.relation!.displayFields ?? []).length - 1} className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <p className="text-[11px] text-muted-foreground">勾选的字段将作为子列表的列展示，顺序即列顺序</p>
                      </div>
                    )}
                    {sel.relation?.formId && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">数据范围</Label>
                        <DataRangeSelector value={sel.relation?.dataRange ?? 'all'} onChange={(v) => updSel({ relation: { ...sel.relation, formId: sel.relation!.formId, dataRange: v } })} />
                        <p className="text-[10px] text-muted-foreground/60">限制关联数据的来源范围</p>
                      </div>
                    )}
                    {sel.relation?.formId && (
                      <RelationFilterEditor
                        fieldOptions={targetFieldOptions(sel.relation.formId)}
                        conditions={sel.relation?.conditions ?? []}
                        conditionsLogic={sel.relation?.conditionsLogic}
                        manualFilters={sel.relation?.manualFilters ?? []}
                        onUpdate={(patch) => updSel({ relation: { ...sel.relation, formId: sel.relation!.formId, conditions: patch.conditions ?? sel.relation?.conditions ?? [], conditionsLogic: patch.conditionsLogic ?? sel.relation?.conditionsLogic ?? 'and', manualFilters: patch.manualFilters ?? sel.relation?.manualFilters ?? [], manualFiltersLogic: patch.manualFiltersLogic ?? sel.relation?.manualFiltersLogic ?? 'and' } })}
                      />
                    )}
                  </div>
                )}

                {sel.type === 'query' && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs font-medium">查询表单设置</p>
                    <div className="space-y-1">
                      <Label className="text-xs">关联表单</Label>
                      <Select value={sel.query?.formId || 'none'} onValueChange={(v) => updSel({ query: { ...sel.query, formId: v === 'none' ? '' : v, displayFields: [] } })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择目标表单" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未选择</SelectItem>
                          {allForms.filter((f) => f.id !== formId).map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {sel.query?.formId && (
                        <p className="text-[11px] text-muted-foreground">当前查询：<span className="text-foreground">{targetFormName(sel.query.formId)}</span></p>
                      )}
                    </div>
                    {sel.query?.formId && (
                      <div className="space-y-2">
                        <Label className="text-xs">展示字段</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {targetFieldOptions(sel.query.formId).map((o) => {
                            const selected = (sel.query?.displayFields ?? []).includes(o.key);
                            return (
                              <button
                                key={o.key}
                                type="button"
                                onClick={() => {
                                  const cur = sel.query?.displayFields ?? [];
                                  updSel({ query: { ...sel.query, formId: sel.query!.formId, displayFields: selected ? cur.filter((x) => x !== o.key) : [...cur, o.key] } });
                                }}
                                className={cn('h-6 rounded border px-2 text-[11px] transition-colors', selected ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                              >
                                {o.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-muted-foreground">勾选的字段将作为查询结果列展示</p>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">数据范围</Label>
                      <DataRangeSelector
                        value={sel.query?.dataRange ?? (sel.query?.filterByApplicant === false ? 'all' : 'mine')}
                        onChange={(v) => updSel({ query: { ...sel.query, formId: sel.query!.formId, dataRange: v, filterByApplicant: v === 'mine' } })}
                      />
                      <p className="text-[11px] text-muted-foreground">限定运行态可查询到的目标表单数据范围；旧「我创建的」配置已兼容为「仅本人」</p>
                    </div>
                    {sel.query?.formId && (
                      <RelationFilterEditor
                        fieldOptions={targetFieldOptions(sel.query.formId)}
                        conditions={sel.query?.conditions ?? []}
                        conditionsLogic={sel.query?.conditionsLogic}
                        manualFilters={sel.query?.manualFilters ?? []}
                        onUpdate={(patch) => updSel({ query: { ...sel.query, formId: sel.query!.formId, conditions: patch.conditions ?? sel.query?.conditions ?? [], conditionsLogic: patch.conditionsLogic ?? sel.query?.conditionsLogic ?? 'and', manualFilters: patch.manualFilters ?? sel.query?.manualFilters ?? [], manualFiltersLogic: patch.manualFiltersLogic ?? sel.query?.manualFiltersLogic ?? 'and' } })}
                      />
                    )}
                  </div>
                )}

                {sel.type === 'formula' && (() => {
                  const expr = sel.formula?.expression ?? sel.defaultValue ?? '';
                  const numFields = fields.filter((x) => ['number', 'money', 'percent', 'formula'].includes(x.type) && x.key !== sel.key);
                  const refFields = fields.filter((x) => x.type === 'form-ref' && x.relation?.formId);
                  const refChips = refFields.flatMap((rf) => {
                    const target = allForms.find((fm) => fm.id === rf.relation?.formId);
                    const tfields = ((target?.schema_json as { fields?: FormField[] } | null)?.fields ?? []).filter((x) => ['number', 'money', 'percent', 'formula'].includes(x.type));
                    return tfields.map((tf) => ({ rf, tf }));
                  });
                  const insert = (token: string) => updSel({ formula: { expression: `${expr}${token}` } });
                  return (
                    <div className="space-y-2">
                      <label className="flex items-center justify-between text-sm min-h-9">
                        <span>设为系统默认字段</span>
                        <Checkbox checked={!!sel.system} onCheckedChange={(v) => updSel({ system: v === true })} />
                      </label>
                      <p className="text-[11px] text-muted-foreground">开启后自动计算并写入单据，审批/流转界面不再重复展示该字段</p>
                      <Label>计算公式</Label>
                      <Input className="font-mono text-xs" placeholder="如 {qty} * {price}" value={expr} onChange={(e) => updSel({ formula: { expression: e.target.value } })} />
                      <p className="text-[11px] text-muted-foreground">{'{key}'} 引用当前表单字段，{'{关联字段key.目标字段key}'} 引用关联表单选中记录字段；支持 + - * / ( )</p>
                      {(numFields.length > 0 || refChips.length > 0) && (
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">点击插入引用：</p>
                          <div className="flex flex-wrap gap-1">
                            {numFields.map((x) => (
                              <button key={x.id} type="button" className="h-6 rounded border border-border px-1.5 text-[11px] text-muted-foreground hover:bg-muted/60" onClick={() => insert(`{${x.key}}`)}>{x.label}</button>
                            ))}
                            {refChips.map(({ rf, tf }) => (
                              <button key={rf.id + tf.id} type="button" className="h-6 rounded border border-border px-1.5 text-[11px] text-muted-foreground hover:bg-muted/60" onClick={() => insert(`{${rf.key}.${tf.key}}`)}>{rf.label}.{tf.label}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {sel.type === 'summary' && (() => {
                  const cfg = sel.summary ?? { source: 'current' as const, aggregate: 'count' as const, fieldKey: '' };
                  const subFields = fields.filter((x) => x.type === 'sub-table' && !!x.subTable?.targetFormId);
                  const refFields = fields.filter((x) => x.type === 'form-ref' && x.relation?.formId);
                  // 统计字段候选：当前表单 → 本表单全部字段（含系统字段）；子表单/关联表单 → 目标表单字段（含系统字段）
                  let srcFields: { key: string; label: string }[] = [];
                  if (cfg.source === 'current') {
                    srcFields = ensureSystemFields(fields.filter((x) => !LAYOUT_TYPES.includes(x.type) && x.type !== 'action-button' && x.type !== 'wizard-step'))
                      .map((x) => ({ key: x.key, label: x.system ? `${x.label}（系统）` : x.label }));
                  } else {
                    const targetId = cfg.source === 'subtable'
                      ? subFields.find((x) => x.key === cfg.subFieldKey)?.subTable?.targetFormId
                      : refFields.find((x) => x.key === cfg.refFieldKey)?.relation?.formId;
                    srcFields = targetId ? targetFieldOptions(targetId) : [];
                  }
                  return (
                    <div className="space-y-2">
                      <label className="flex items-center justify-between text-sm min-h-9">
                        <span>设为系统默认字段</span>
                        <Checkbox checked={!!sel.system} onCheckedChange={(v) => updSel({ system: v === true })} />
                      </label>
                      <p className="text-[11px] text-muted-foreground">开启后自动统计并写入单据，审批/流转界面不再重复展示该字段</p>
                      <div className="space-y-1">
                        <Label className="text-xs">统计来源</Label>
                        <Select value={cfg.source} onValueChange={(v) => updSel({ summary: { ...cfg, source: v as 'current' | 'subtable' | 'ref', subFieldKey: v === 'subtable' ? (cfg.subFieldKey ?? '') : undefined, refFieldKey: v === 'ref' ? (cfg.refFieldKey ?? '') : undefined, fieldKey: '' } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="current">当前表单</SelectItem>
                            <SelectItem value="subtable">子表单</SelectItem>
                            <SelectItem value="ref">关联表单</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {cfg.source === 'subtable' && (
                        <div className="space-y-1">
                          <Label className="text-xs">子表单字段</Label>
                          <Select value={cfg.subFieldKey || 'none'} onValueChange={(v) => updSel({ summary: { ...cfg, subFieldKey: v === 'none' ? '' : v, fieldKey: '' } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择子表单" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未选择</SelectItem>
                              {subFields.map((sf) => <SelectItem key={sf.id} value={sf.key}>{sf.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {cfg.source === 'ref' && (
                        <div className="space-y-1">
                          <Label className="text-xs">关联表单字段</Label>
                          <Select value={cfg.refFieldKey || 'none'} onValueChange={(v) => updSel({ summary: { ...cfg, refFieldKey: v === 'none' ? '' : v, fieldKey: '' } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择关联字段" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未选择</SelectItem>
                              {refFields.map((rf) => <SelectItem key={rf.id} value={rf.key}>{rf.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-xs">聚合方式</Label>
                        <Select value={cfg.aggregate} onValueChange={(v) => updSel({ summary: { ...cfg, aggregate: v as 'count' | 'sum' | 'avg' } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="count">记录数</SelectItem>
                            <SelectItem value="sum">求和</SelectItem>
                            <SelectItem value="avg">平均</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {cfg.aggregate !== 'count' && (
                        <div className="space-y-1">
                          <Label className="text-xs">统计字段</Label>
                          <Select value={cfg.fieldKey || 'none'} onValueChange={(v) => updSel({ summary: { ...cfg, fieldKey: v === 'none' ? '' : v } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择统计字段" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未选择</SelectItem>
                              {cfg.source !== 'current' && srcFields.length === 0 && <SelectItem value="none" disabled>{cfg.source === 'subtable' ? '请先选择子表单' : '请先选择关联字段'}</SelectItem>}
                              {srcFields.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {cfg.source !== 'current' && srcFields.length === 0 && <p className="text-[11px] text-muted-foreground">{cfg.source === 'subtable' ? '请先选择子表单字段' : '请先选择关联表单字段'}</p>}
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        {cfg.source === 'current' ? '统计当前表单全部记录' : cfg.source === 'subtable' ? '统计本单据关联的子表明细行（不含子表单其他数据）' : '按关联字段配置的数据范围与显示条件统计目标表单记录'}
                      </p>
                    </div>
                  );
                })()}

                {sel.type === 'fetch-value' && (() => {
                  const cfg = sel.fetchValue ?? { source: 'subtable' as const, fieldKey: '', sortBy: 'value-desc' as const };
                  const subFields = fields.filter((x) => x.type === 'sub-table' && !!x.subTable?.targetFormId);
                  const targetId = cfg.source === 'subtable'
                    ? subFields.find((x) => x.key === cfg.subFieldKey)?.subTable?.targetFormId
                    : cfg.formId;
                  const srcFields = targetId ? targetFieldOptions(targetId) : [];
                  return (
                    <div className="space-y-2">
                      <label className="flex items-center justify-between text-sm min-h-9">
                        <span>设为系统默认字段</span>
                        <Checkbox checked={!!sel.system} onCheckedChange={(v) => updSel({ system: v === true })} />
                      </label>
                      <p className="text-[11px] text-muted-foreground">开启后新增保存时自动取值并写入单据，表单中只读展示、无需人工填写；关闭时可作为普通字段人工填写</p>
                      <p className="text-[11px] text-muted-foreground">从子表单/关联表单数据或指定表单全部数据中按排序取一条记录的字段值，只读展示并随单据保存；按大小排序支持数值与日期、时间字段</p>
                      <div className="space-y-1">
                        <Label className="text-xs">取值来源</Label>
                        <Select value={cfg.source} onValueChange={(v) => updSel({ fetchValue: { ...cfg, source: v as 'subtable' | 'form', subFieldKey: v === 'subtable' ? (cfg.subFieldKey ?? '') : undefined, formId: v === 'form' ? (cfg.formId ?? '') : undefined, fieldKey: '' } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="subtable">子表单</SelectItem>
                            <SelectItem value="form">指定表单</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {cfg.source === 'subtable' && (
                        <div className="space-y-1">
                          <Label className="text-xs">子表单字段</Label>
                          <Select value={cfg.subFieldKey || 'none'} onValueChange={(v) => updSel({ fetchValue: { ...cfg, subFieldKey: v === 'none' ? '' : v, fieldKey: '' } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择子表单" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未选择</SelectItem>
                              {subFields.map((sf) => <SelectItem key={sf.id} value={sf.key}>{sf.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {cfg.source === 'form' && (
                        <div className="space-y-1">
                          <Label className="text-xs">目标表单</Label>
                          <Select value={cfg.formId || 'none'} onValueChange={(v) => updSel({ fetchValue: { ...cfg, formId: v === 'none' ? '' : v, fieldKey: '' } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择目标表单" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未选择</SelectItem>
                              {allForms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {cfg.source === 'form' && cfg.formId && (
                        <div className="space-y-1">
                          <Label className="text-xs">数据范围</Label>
                          <DataRangeSelector value={cfg.dataRange ?? 'all'} onChange={(v) => updSel({ fetchValue: { ...cfg, dataRange: v } })} />
                          <p className="text-[11px] text-muted-foreground">限定运行态可取值的目标表单数据范围</p>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-xs">取值字段</Label>
                        <Select value={cfg.fieldKey || 'none'} onValueChange={(v) => updSel({ fetchValue: { ...cfg, fieldKey: v === 'none' ? '' : v } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择取值字段" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">未选择</SelectItem>
                            {srcFields.length === 0 && <SelectItem value="none" disabled>{cfg.source === 'subtable' ? '请先选择子表单' : '请先选择目标表单'}</SelectItem>}
                            {srcFields.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">取值排序</Label>
                        <Select value={cfg.sortBy} onValueChange={(v) => updSel({ fetchValue: { ...cfg, sortBy: v as 'value-asc' | 'value-desc' | 'time-asc' | 'time-desc' } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="value-asc">按大小正序（最小 / 最早）</SelectItem>
                            <SelectItem value="value-desc">按大小倒序（最大 / 最新）</SelectItem>
                            <SelectItem value="time-asc">按时间正序（最早一条）</SelectItem>
                            <SelectItem value="time-desc">按时间倒序（最新一条）</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {cfg.source === 'subtable' ? '仅在本单据关联的子表明细行中取值（不含子表单其他数据）' : '在目标表单全部数据中按排序取一条'}
                      </p>
                    </div>
                  );
                })()}

                {sel.type === 'form-assignment' && (() => {
                  const cfg = sel.assignment ?? {
                    sourceMode: 'current',
                    formId: form?.id ?? '',
                    displayFieldKeys: [],
                    displaySeparator: ' ',
                    mappings: [],
                    searchFieldKeys: [],
                  };
                  // 取值来源模式：'current' 当前表单 / 'ref' 关联表单（独立保存，避免 formId 清空后回退到当前表单导致下拉隐藏）
                  const sourceMode: 'current' | 'ref' = cfg.sourceMode ?? (!cfg.formId || cfg.formId === formId ? 'current' : 'ref');
                  const effectiveFormId = sourceMode === 'current' ? formId : cfg.formId;
                  const targetFields = effectiveFormId ? targetFieldOptions(effectiveFormId) : [];
                  const currentFields = fields.filter((f) => !['group-title', 'wizard-step', 'grid', 'divider', 'description', 'action-button'].includes(f.type) && f.key !== sel.key);

                  const toggleDisplayField = (fk: string) => {
                    const keys = cfg.displayFieldKeys ?? [];
                    const next = keys.includes(fk) ? keys.filter((k) => k !== fk) : [...keys, fk];
                    updSel({ assignment: { ...cfg, displayFieldKeys: next } });
                  };

                  const toggleListField = (fk: string) => {
                    const keys = cfg.listFieldKeys ?? [];
                    const next = keys.includes(fk) ? keys.filter((k) => k !== fk) : [...keys, fk];
                    updSel({ assignment: { ...cfg, listFieldKeys: next } });
                  };

                  const toggleSearchField = (fk: string) => {
                    const keys = cfg.searchFieldKeys ?? [];
                    const next = keys.includes(fk) ? keys.filter((k) => k !== fk) : [...keys, fk];
                    updSel({ assignment: { ...cfg, searchFieldKeys: next } });
                  };

                  const addMapping = () => {
                    const next = [...(cfg.mappings ?? []), { sourceFieldKey: '', targetFieldKey: '' }];
                    updSel({ assignment: { ...cfg, mappings: next } });
                  };

                  const updMapping = (idx: number, patch: Partial<{ sourceFieldKey: string; targetFieldKey: string }>) => {
                    const next = [...(cfg.mappings ?? [])];
                    next[idx] = { ...next[idx], ...patch };
                    updSel({ assignment: { ...cfg, mappings: next } });
                  };

                  const delMapping = (idx: number) => {
                    const next = (cfg.mappings ?? []).filter((_, i) => i !== idx);
                    updSel({ assignment: { ...cfg, mappings: next } });
                  };

                  return (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">取值来源</Label>
                        <Select
                          value={sourceMode}
                          onValueChange={(v) => {
                            const mode = v === 'current' ? 'current' : 'ref';
                            updSel({
                              assignment: {
                                ...cfg,
                                sourceMode: mode,
                                formId: mode === 'current' ? (formId ?? '') : '',
                                displayFieldKeys: [],
                                mappings: [],
                                searchFieldKeys: [],
                                searchControls: {},
                                listFieldKeys: [],
                              },
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择取值来源" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="current">当前表单</SelectItem>
                            <SelectItem value="ref">关联表单</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">选择「关联表单」后可进一步选择具体表单；「当前表单」从本表单已有数据中取值</p>
                      </div>

                      {sourceMode === 'ref' && (
                        <div className="space-y-1">
                          <Label className="text-xs">关联表单</Label>
                          <Select
                            value={cfg.formId || 'none'}
                            onValueChange={(v) => {
                              updSel({
                                assignment: {
                                  ...cfg,
                                  formId: v === 'none' ? '' : v,
                                  displayFieldKeys: [],
                                  mappings: [],
                                  searchFieldKeys: [],
                                  searchControls: {},
                                  listFieldKeys: [],
                                },
                              });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择关联表单" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未选择</SelectItem>
                              {allForms.filter((f) => f.id !== formId).map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {sourceMode === 'ref' && cfg.formId && (
                        <div className="space-y-1">
                          <Label className="text-xs">数据范围</Label>
                          <DataRangeSelector value={cfg.dataRange ?? 'all'} onChange={(v) => updSel({ assignment: { ...cfg, dataRange: v } })} />
                          <p className="text-[11px] text-muted-foreground">限定运行态可选择的目标表单数据范围</p>
                        </div>
                      )}

                      <div className="space-y-1">
                        <Label className="text-xs">文本框显示字段（可多选组合）</Label>
                        <p className="text-[11px] text-muted-foreground">勾选后按先后顺序组合展示在文本框中</p>
                        <div className="max-h-32 overflow-y-auto rounded border border-border p-1.5 space-y-1 bg-muted/20">
                          {targetFields.length === 0 && <p className="text-[11px] text-muted-foreground p-1">请先选择关联表单</p>}
                          {targetFields.map((tf) => {
                            const checked = (cfg.displayFieldKeys ?? []).includes(tf.key);
                            return (
                              <label key={tf.key} className="flex items-center gap-2 text-xs py-0.5 px-1 hover:bg-muted/40 rounded cursor-pointer">
                                <Checkbox checked={checked} onCheckedChange={() => toggleDisplayField(tf.key)} />
                                <span>{tf.label}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">({tf.key})</span>
                              </label>
                            );
                          })}
                        </div>
                        {(cfg.displayFieldKeys ?? []).length > 1 && (
                          <div className="flex items-center gap-2 pt-1 text-xs">
                            <span className="text-muted-foreground text-[11px]">组合分隔符</span>
                            <Input
                              className="h-7 w-20 text-xs"
                              value={cfg.displaySeparator ?? ' '}
                              onChange={(e) => updSel({ assignment: { ...cfg, displaySeparator: e.target.value } })}
                              placeholder="空格"
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">选择赋值字段映射</Label>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-primary" onClick={addMapping}>
                            <Plus className="mr-1 h-3 w-3" />添加映射
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">选择一条关联记录后，将其指定字段值对应赋值给当前表单字段</p>
                        <div className="space-y-1.5">
                          {(cfg.mappings ?? []).map((m, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 rounded border border-border p-1.5 bg-muted/20">
                              <div className="flex-1 min-w-0">
                                <Select
                                  value={m.sourceFieldKey || 'none'}
                                  onValueChange={(v) => updMapping(idx, { sourceFieldKey: v === 'none' ? '' : v })}
                                >
                                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="关联字段" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">请选择</SelectItem>
                                    {targetFields.map((tf) => <SelectItem key={tf.key} value={tf.key}>{tf.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <span className="text-xs text-muted-foreground">→</span>
                              <div className="flex-1 min-w-0">
                                <Select
                                  value={m.targetFieldKey || 'none'}
                                  onValueChange={(v) => updMapping(idx, { targetFieldKey: v === 'none' ? '' : v })}
                                >
                                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="当前表单字段" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">请选择</SelectItem>
                                    {currentFields.map((cf) => <SelectItem key={cf.key} value={cf.key}>{cf.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0" onClick={() => delMapping(idx)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">选择框搜索条件配置</Label>
                        <p className="text-[11px] text-muted-foreground">勾选弹出关联表单列表时可用于搜索过滤的字段，并为勾选字段指定搜索控件类型</p>
                        <div className="max-h-44 overflow-y-auto rounded border border-border p-1.5 space-y-1 bg-muted/20">
                          {targetFields.length === 0 && <p className="text-[11px] text-muted-foreground p-1">请先选择关联表单</p>}
                          {targetFields.map((tf) => {
                            const checked = (cfg.searchFieldKeys ?? []).includes(tf.key);
                            const ctrl = (cfg.searchControls ?? {})[tf.key] ?? 'input';
                            return (
                              <div key={tf.key} className="flex items-center gap-2 py-0.5 px-1 hover:bg-muted/40 rounded">
                                <label className="flex items-center gap-2 text-xs flex-1 min-w-0 cursor-pointer">
                                  <Checkbox checked={checked} onCheckedChange={() => toggleSearchField(tf.key)} />
                                  <span className="truncate">{tf.label}</span>
                                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">({tf.key})</span>
                                </label>
                                {checked && (
                                  <Select
                                    value={ctrl}
                                    onValueChange={(v) => updSel({ assignment: { ...cfg, searchControls: { ...(cfg.searchControls ?? {}), [tf.key]: v as 'input' | 'date-range' | 'select' | 'cascader' } } })}
                                  >
                                    <SelectTrigger className="h-7 w-[104px] text-xs shrink-0"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="input">输入框</SelectItem>
                                      <SelectItem value="date-range">日期范围</SelectItem>
                                      <SelectItem value="select">下拉选择</SelectItem>
                                      <SelectItem value="cascader">级联选择</SelectItem>
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {(cfg.searchFieldKeys ?? []).length > 0 && (
                          <p className="text-[11px] text-muted-foreground">输入框为模糊匹配；日期范围按区间过滤；下拉选择选项来自该字段已有数据去重；级联选择按省/市/区县筛选（适用于地址字段）</p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">选择框列表显示字段</Label>
                        <p className="text-[11px] text-muted-foreground">勾选弹出关联表单列表时数据表格展示的列（按勾选顺序排列），未配置时按显示字段与搜索字段并集兜底</p>
                        <div className="max-h-36 overflow-y-auto rounded border border-border p-1.5 space-y-1 bg-muted/20">
                          {targetFields.length === 0 && <p className="text-[11px] text-muted-foreground p-1">请先选择关联表单</p>}
                          {targetFields.map((tf) => {
                            const checked = (cfg.listFieldKeys ?? []).includes(tf.key);
                            return (
                              <label key={tf.key} className="flex items-center gap-2 text-xs py-0.5 px-1 hover:bg-muted/40 rounded cursor-pointer">
                                <Checkbox checked={checked} onCheckedChange={() => toggleListField(tf.key)} />
                                <span className="truncate">{tf.label}</span>
                                <span className="text-[10px] text-muted-foreground font-mono shrink-0">({tf.key})</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {sel.type === 'serial-number' && (
                  <div className="space-y-2">
                    <label className="flex items-center justify-between text-sm min-h-9">
                      <span>设为系统默认字段</span>
                      <Checkbox checked={!!sel.system} onCheckedChange={(v) => updSel({ system: v === true })} />
                    </label>
                    <p className="text-[11px] text-muted-foreground">开启后新增保存时自动生成流水号并写入单据，表单中只读展示、无需人工填写；关闭时可人工填写</p>
                    <SerialRuleEditor
                      rules={sel.serialRules ?? []}
                      fields={fields}
                      onChange={(rules) => updSel({ serialRules: rules })}
                    />
                  </div>
                )}

                {sel.type === 'leave-time' && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs font-medium">每日工作时间（整点）</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([['amStart', '上午上班'], ['amEnd', '上午下班'], ['pmStart', '下午上班'], ['pmEnd', '下午下班']] as const).map(([k, label]) => (
                        <div key={k} className="space-y-1">
                          <Label className="text-xs">{label}</Label>
                          <Select
                            value={String(sel.workHours?.[k] ?? DEFAULT_WORK_HOURS[k])}
                            onValueChange={(v) => updSel({ workHours: { ...sel.workHours, [k]: Number(v) } })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, h) => (
                                <SelectItem key={h} value={String(h)}>{`${String(h).padStart(2, '0')}:00`}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      每日可请假 {workHoursPerDay(sel.workHours)} 小时；填写请假时间段后，系统按工作时间自动计算请假时长与天数
                    </p>
                    <div className="space-y-1 border-t border-border pt-2">
                      <p className="text-xs font-medium">结果字段（独立存储）</p>
                      <p className="text-[11px] text-muted-foreground">选择日期时间字段保存拆分后的开始/结束时间；选择文本框字段保存自动计算的请假小时与天数</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([['startKey', '开始时间字段'], ['endKey', '结束时间字段'], ['hoursKey', '请假小时字段'], ['daysKey', '请假天数字段']] as const).map(([k, label]) => (
                          <div key={k} className="space-y-1">
                            <Label className="text-xs">{label}</Label>
                            <Select
                              value={sel.leaveTime?.[k] || 'none'}
                              onValueChange={(v) => updSel({ leaveTime: { ...sel.leaveTime, [k]: v === 'none' ? '' : v } })}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="未绑定" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">未绑定</SelectItem>
                                {fields.filter((f) => ((k === 'startKey' || k === 'endKey') ? f.type === 'datetime' : (f.type === 'input' || f.type === 'number')) && f.id !== sel.id && !f.system).map((f) => (
                                  <SelectItem key={f.id} value={f.key}>{f.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>字段宽度（栅格 /24）</Label>
                  <div className="flex gap-1.5">
                    {[6, 8, 12, 24].map((w) => (
                      <button key={w} type="button" onClick={() => updSel({ span: w })} className={cn('flex-1 h-8 rounded-md border text-xs transition-colors', (sel.span ?? 12) === w ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border hover:bg-muted/60')}>
                        {w === 24 ? '整行' : `${w}/24`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1 rounded-md border border-border divide-y divide-border">
                  <label className="flex items-center justify-between px-3 min-h-10 text-sm">
                    必填
                    <Switch checked={!!sel.required} onCheckedChange={(v) => updSel({ required: v })} />
                  </label>
                  <label className="flex items-center justify-between px-3 min-h-10 text-sm">
                    只读
                    <Switch checked={!!sel.readOnly} onCheckedChange={(v) => updSel({ readOnly: v })} />
                  </label>
                  <label className="flex items-center justify-between px-3 min-h-10 text-sm">
                    禁用
                    <Switch checked={!!sel.disabled} onCheckedChange={(v) => updSel({ disabled: v })} />
                  </label>
                  {!SYSTEM_SWITCH_EXCLUDED.includes(sel.type) && (
                    <label className="flex items-center justify-between px-3 min-h-10 text-sm">
                      设为系统默认字段
                      <Switch checked={!!sel.system} onCheckedChange={(v) => updSel({ system: v })} />
                    </label>
                  )}
                  {!SYSTEM_SWITCH_EXCLUDED.includes(sel.type) && (
                    <p className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      开启后该字段不在填写表单中显示、无需人工填写且跳过必填校验，值由系统自动写入（如关联表单赋值回填）
                    </p>
                  )}
                </div>

                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-xs font-medium">校验规则</p>
                  <Input className="h-8 text-xs font-mono" placeholder="正则表达式（可选）" value={sel.validation?.pattern ?? ''} onChange={(e) => updSel({ validation: { ...sel.validation, pattern: e.target.value } })} />
                  <AiRuleMatcher
                    mode="raw"
                    context={`当前字段：${sel.label}（${sel.key}，类型 ${sel.type}）。`}
                    placeholder="如：仅允许11位手机号"
                    label="生成正则"
                    onResult={(t) => updSel({ validation: { ...sel.validation, pattern: t } })}
                  />
                  <Input className="h-8 text-xs" placeholder="校验失败提示语" value={sel.validation?.message ?? ''} onChange={(e) => updSel({ validation: { ...sel.validation, message: e.target.value } })} />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">最小值/长度</Label>
                      <Input type="number" className="h-8" value={sel.validation?.min ?? ''} onChange={(e) => updSel({ validation: { ...sel.validation, min: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                    </div>
                    <div>
                      <Label className="text-xs">最大值/长度</Label>
                      <Input type="number" className="h-8" value={sel.validation?.max ?? ''} onChange={(e) => updSel({ validation: { ...sel.validation, max: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                    </div>
                  </div>
                </div>
              </>
            )}
            {BUTTON_TYPES.includes(sel.type) && sel.button && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>按钮文字</Label>
                  <Input value={sel.label} onChange={(e) => updSel({ label: e.target.value })} placeholder="如：派单" />
                </div>
                <div className="space-y-2">
                  <Label>绑定动作</Label>
                  <Select value={sel.button.actionType} onValueChange={(v) => updSel({ button: { ...sel.button, actionType: v as FormButton['actionType'] } as FormButton })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUTTON_ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {sel.button.actionType === 'CHANGE_STATUS' && (
                  <>
                    <div className="space-y-2">
                      <Label>目标状态</Label>
                      <Input className="font-mono text-xs" placeholder="如 dispatched" value={sel.button.targetStatus ?? ''} onChange={(e) => updSel({ button: { ...sel.button, targetStatus: e.target.value } as FormButton })} />
                    </div>
                    <div className="space-y-2">
                      <Label>状态机事件</Label>
                      <Input className="font-mono text-xs" placeholder="如 dispatch" value={sel.button.stateMachineEvent ?? ''} onChange={(e) => updSel({ button: { ...sel.button, stateMachineEvent: e.target.value } as FormButton })} />
                    </div>
                  </>
                )}
                {sel.button.actionType === 'NAVIGATE' && (
                  <div className="space-y-2">
                    <Label>目标表单 ID</Label>
                    <Input className="font-mono text-xs" placeholder="留空则当前表单" value={sel.button.targetFormId ?? ''} onChange={(e) => updSel({ button: { ...sel.button, targetFormId: e.target.value } as FormButton })} />
                  </div>
                )}
                {sel.button.actionType === 'UPDATE_DATA' && (
                  <div className="space-y-2">
                    <Label>更新字段（JSON）</Label>
                    <Textarea className="min-h-16 text-xs font-mono" placeholder={'{ "archivedAt": "{{now}}" }'}
                      value={sel.button.updates ? JSON.stringify(sel.button.updates) : ''}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        if (!v) return updSel({ button: { ...sel.button, updates: undefined } as FormButton });
                        try { updSel({ button: { ...sel.button, updates: JSON.parse(v) as Record<string, string> } as FormButton }); } catch { /* 输入中 */ }
                      }}
                    />
                  </div>
                )}
                {sel.button.actionType === 'CALL_API' && (
                  <div className="space-y-2">
                    <Label>接口地址</Label>
                    <Input className="font-mono text-xs" placeholder="https://…" value={sel.button.targetUrl ?? ''} onChange={(e) => updSel({ button: { ...sel.button, targetUrl: e.target.value } as FormButton })} />
                  </div>
                )}
                {sel.button.actionType === 'REF_ASSIGN' && (() => {
                  const btn = sel.button as FormButton;
                  const ra = btn.refAssign ?? { formId: '', mappings: [] };
                  const setRa = (next: { formId: string; mappings: Array<{ fromKey: string; toKey: string }> }) => updSel({ button: { ...btn, refAssign: next } as FormButton });
                  return (
                  <div className="space-y-3 rounded-md border border-border p-3">
                    <p className="text-xs font-medium">关联表单赋值</p>
                    <div className="space-y-1">
                      <Label className="text-xs">关联表单</Label>
                      <Select
                        value={ra.formId || 'none'}
                        onValueChange={(v) => setRa({ formId: v === 'none' ? '' : v, mappings: v === 'none' ? [] : ra.mappings })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择关联表单" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未选择</SelectItem>
                          {allForms.filter((f) => f.id !== formId).map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">点击按钮时弹出该表单的数据列表，选择一条数据后按下方映射赋值</p>
                    </div>
                    {ra.formId && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">字段赋值映射</Label>
                          <Button
                            type="button" variant="outline" size="sm" className="h-7 px-2 text-xs"
                            onClick={() => setRa({ ...ra, mappings: [...ra.mappings, { fromKey: '', toKey: '' }] })}
                          >+ 添加映射</Button>
                        </div>
                        {ra.mappings.map((m, mi) => {
                          const srcFields = ((allForms.find((f) => f.id === ra.formId)?.schema_json?.fields ?? []) as FormField[]).filter((x) => !x.system);
                          const curFields = fields.filter((x) => !BUTTON_TYPES.includes(x.type) && !LAYOUT_TYPES.includes(x.type) && x.key !== sel.key);
                          const updMapping = (patch: Partial<{ fromKey: string; toKey: string }>) =>
                            setRa({ ...ra, mappings: ra.mappings.map((x, i) => i === mi ? { ...x, ...patch } : x) });
                          return (
                            <div key={mi} className="space-y-1.5 rounded-md border border-border/70 bg-muted/20 p-2">
                              <div className="flex items-center gap-1.5">
                                <Select value={m.fromKey || 'none'} onValueChange={(v) => updMapping({ fromKey: v === 'none' ? '' : v })}>
                                  <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue placeholder="关联表单字段" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">未选择</SelectItem>
                                    {srcFields.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                                <Select value={m.toKey || 'none'} onValueChange={(v) => updMapping({ toKey: v === 'none' ? '' : v })}>
                                  <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue placeholder="当前表单字段" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">未选择</SelectItem>
                                    {curFields.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => setRa({ ...ra, mappings: ra.mappings.filter((_, i) => i !== mi) })}
                                >×</Button>
                              </div>
                            </div>
                          );
                        })}
                        {ra.mappings.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">暂无映射：选择关联表单数据后，其字段值将写入当前表单对应字段</p>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })()}
                <p className="text-[11px] text-muted-foreground">保存草稿前按钮即生效；提交类按钮（提交/暂存）由表单底部默认提供，此处配置自定义业务动作</p>
              </div>
            )}
            {LAYOUT_TYPES.includes(sel.type) && !BUTTON_TYPES.includes(sel.type) && (
              <div className="space-y-2">
                {sel.type === 'wizard-step' && (
                  <div className="space-y-2 rounded-md border border-primary/30 bg-primary/[0.03] p-3">
                    <p className="text-xs font-medium text-primary">向导步骤容器</p>
                    <div className="space-y-1">
                      <Label className="text-xs">步骤名称</Label>
                      <Input value={sel.layout?.text ?? ''} placeholder="如：基本信息" onChange={(e) => updSel({ layout: { ...sel.layout, text: e.target.value } })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">步骤说明（可选）</Label>
                      <Input value={sel.layout?.description ?? ''} placeholder="展示在步骤标题下方" onChange={(e) => updSel({ layout: { ...sel.layout, description: e.target.value } })} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">运行时按步骤顺序分页填写；保持本步骤选中，从左侧组件库添加的字段会放入本步骤</p>
                    {(() => {
                      const innerCount = fields.filter((x) => x.parentId === sel.id && !x.system).length;
                      const stepNo = stepFields.findIndex((s) => s.id === sel.id) + 1;
                      return (
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">第 {stepNo} 步</span>
                          <span>包含 {innerCount} 个字段</span>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {sel.type === 'group-title' && (
                  <>
                    <Label>标题文字</Label>
                    <Input value={sel.layout?.text ?? ''} onChange={(e) => updSel({ layout: { ...sel.layout, text: e.target.value } })} />
                  </>
                )}
                {sel.type === 'description' && (
                  <>
                    <Label>说明内容</Label>
                    <Textarea className="min-h-16" value={sel.layout?.description ?? ''} onChange={(e) => updSel({ layout: { ...sel.layout, description: e.target.value } })} />
                  </>
                )}
                {sel.type === 'grid' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">栏目条数</Label>
                      <Select
                        value={String(sel.layout?.columns ?? (sel.gridColumns?.length || 2))}
                        onValueChange={(v) => setGridColumns(Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5, 6].map((c) => (
                            <SelectItem key={c} value={String(c)}>{c} 栏</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">栏目属性</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: sel.layout?.columns ?? (sel.gridColumns?.length || 2) }).map((_, i) => {
                          const col = sel.gridColumns?.[i];
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setActiveGridCol(i)}
                              className={cn(
                                'h-7 rounded border px-2 text-xs transition-colors',
                                activeGridCol === i
                                  ? 'border-primary bg-primary/5 text-primary font-medium'
                                  : 'border-border text-muted-foreground hover:bg-muted/60',
                              )}
                            >
                              {col?.title || `第 ${i + 1} 栏`}
                            </button>
                          );
                        })}
                      </div>

                      <div className="rounded-md border border-border p-3 space-y-2">
                        <div className="space-y-1">
                          <Label className="text-xs">栏目标题</Label>
                          <Input
                            className="h-8 text-xs px-2"
                            value={sel.gridColumns?.[activeGridCol]?.title ?? `第 ${activeGridCol + 1} 栏`}
                            onChange={(e) => {
                              const cur = Array.from({ length: sel.layout?.columns ?? 2 }).map((_, i) =>
                                sel.gridColumns?.[i] ?? {
                                  title: `第 ${i + 1} 栏`,
                                  formId: '',
                                  fieldKey: '',
                                  aggregate: 'first' as const,
                                  dataRange: 'permission' as const,
                                  defaultValue: '',
                                },
                              );
                              cur[activeGridCol] = { ...cur[activeGridCol], title: e.target.value };
                              updSel({ gridColumns: cur });
                            }}
                          />
                        </div>

                        <TextSourceEditor
                          source={
                            sel.gridColumns?.[activeGridCol] ?? {
                              formId: '',
                              fieldKey: '',
                              aggregate: 'first',
                              dataRange: 'permission',
                              defaultValue: '',
                            }
                          }
                          forms={allForms}
                          fieldOptions={targetFieldOptions}
                          onChange={(next) => setGridColumn(activeGridCol, next)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          ) : (
            <div className="flex h-40 items-center justify-center px-4 text-center text-xs text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <MousePointerClick className="h-5 w-5" />
                <span>请选择画布中的字段查看属性</span>
              </div>
            </div>
          )
        ) : (
          <>
            <FormPropsCard settings={formSettings} onChange={updFormSettings} fields={fields} />
            {stepFields.length > 0 && (
              <div className="border-t border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground">向导步骤（组件化）</p>
                  <span className="text-[11px] text-muted-foreground">{stepFields.length} 个步骤</span>
                </div>
                <p className="text-[11px] text-muted-foreground">向导步骤已内置为组件：在组件库「布局组件」中添加「向导步骤」，保持步骤选中后添加的字段自动放入该步骤，属性面板可改步骤名称</p>
                <div className="space-y-2">
                  {stepFields.map((st, i) => (
                    <div key={st.id} className="rounded-md border border-border p-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>
                        <span className="text-xs font-medium truncate flex-1 min-w-0">{st.layout?.text || `步骤 ${i + 1}`}</span>
                        <button type="button" className="h-6 px-1.5 shrink-0 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { setSelected(st.id); setPropTab('field'); }}>编辑</button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{fields.filter((x) => x.parentId === st.id && !x.system).length} 个字段</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/** 画布中字段预览 */
/** 不提供「设为系统默认字段」通用开关的类型：
 *  关联字段模块（form-ref/query/sub-table/fetch-value/form-assignment）、已有专属开关的计算类（serial-number/formula/summary）、布局类组件（无数据语义） */
const SYSTEM_SWITCH_EXCLUDED = ['form-ref', 'query', 'sub-table', 'fetch-value', 'form-assignment', 'serial-number', 'formula', 'summary', 'amount-uppercase', 'group-title', 'grid', 'divider', 'description', 'wizard-step', 'action-button'];

function FieldPreview({ field, defLabel, forms }: { field: FormField; defLabel: string; forms?: Pick<MetaForm, 'id' | 'name' | 'schema_json'>[] }) {
  const Icon = ICON_MAP[findFieldDef(field.type)?.icon ?? 'type'] ?? Type;
  const control = () => {
    switch (field.type) {
      case 'textarea':
      case 'richtext':
        return <div className="h-14 rounded border border-border bg-background px-2.5 py-2 text-xs text-muted-foreground/60">{field.placeholder || `请输入${field.label}`}</div>;
      case 'select':
      case 'search-select':
      case 'user-select':
      case 'dept-select':
      case 'address':
        return (
          <div className="flex h-9 items-center justify-between rounded border border-border bg-background px-2.5 text-xs text-muted-foreground/60">
            <span>{field.type === 'search-select' ? (field.placeholder || '搜索选择…') : field.type === 'address' ? (field.placeholder || '请选择省 / 市 / 区县') : (field.placeholder || '请选择')}</span>
            {field.type === 'search-select' ? <SearchCheck className="h-3.5 w-3.5" /> : field.type === 'address' ? <MapPin className="h-3.5 w-3.5" /> : <ChevronDownSquare className="h-3.5 w-3.5" />}
          </div>
        );
      case 'system-status':
        return (
          <div className="flex h-9 items-center justify-between rounded border border-border bg-background px-2.5 text-xs text-muted-foreground/60">
            <span>状态机状态（当前单据状态）</span>
            <CircleDot className="h-3.5 w-3.5 text-primary" />
          </div>
        );
      case 'multi-select':
      case 'search-multi-select':
        return (
          <div className="flex h-9 items-center justify-between rounded border border-border bg-background px-2.5 text-xs text-muted-foreground/60">
            <span>{field.type === 'search-multi-select' ? (field.placeholder || '搜索选择…（多选）') : (field.placeholder || '请选择（多选）')}</span>
            <ListChecks className="h-3.5 w-3.5" />
          </div>
        );
      case 'form-ref': {
        const displayFields = (field.relation?.displayFields ?? []).length > 0 ? field.relation!.displayFields! : [];
        return <RelationQueryPreview formId={field.relation?.formId ?? ''} displayFields={displayFields} kind="relation" />;
      }
      case 'query': {
        const cols = (field.query?.displayFields ?? []).slice(0, 3);
        return <RelationQueryPreview formId={field.query?.formId ?? ''} displayFields={cols} kind="query" />;
      }
      case 'sub-table': {
        const cfg = field.subTable;
        const formName = forms?.find((f) => f.id === cfg?.targetFormId)?.name;
        if (!cfg?.targetFormId || !formName) {
          return <div className="rounded border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground/60">请选择目标子表单</div>;
        }
        // 表头显示已设置的列表显示字段名（未设置时回退占位）
        const targetFields = ensureSystemFields(((forms?.find((f) => f.id === cfg.targetFormId)?.schema_json as { fields?: FormField[] } | null)?.fields ?? []) as FormField[]);
        const labelOf = (key: string): string => targetFields.find((x) => x.key === key)?.label ?? key;
        const headers = (cfg.displayColumns ?? []).length > 0 ? (cfg.displayColumns ?? []).map(labelOf) : ['列 1', '列 2'];
        return (
          <div className="rounded border border-border overflow-hidden">
            <div className="flex items-center justify-between bg-muted/40 border-b border-border px-2 py-1">
              <span className="text-[11px] text-muted-foreground truncate">{formName}（明细列表）</span>
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">＋新增</span>
            </div>
            <div className="grid divide-x divide-border border-b border-border bg-muted/20" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}>
              {headers.map((h) => (
                <div key={h} className="truncate px-2 py-1.5 text-[11px] font-medium text-muted-foreground">{h}</div>
              ))}
            </div>
            <div className="grid divide-x divide-border" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}>
              {headers.map((h, i) => (
                <div key={h + i} className="px-2 py-1.5 text-[11px] text-muted-foreground/60">{i === headers.length - 1 ? '编辑 / 删除' : '—'}</div>
              ))}
            </div>
          </div>
        );
      }
      case 'form-assignment': {
        const aName = forms?.find((f) => f.id === field.assignment?.formId)?.name;
        return (
          <div className="flex h-9 items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm">
            <span className="text-xs text-muted-foreground truncate">
              {aName ? `来源：${aName} · 点击选择关联数据` : '请先在右侧配置取值来源'}
            </span>
            <FileInput className="h-4 w-4 shrink-0 text-primary opacity-80" />
          </div>
        );
      }
      case 'fetch-value':
        return (
          <div className="flex h-9 items-center justify-between rounded border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground/60">
            <span>{field.system ? '系统默认：' : ''}{field.fetchValue?.sortBy === 'time-asc' || field.fetchValue?.sortBy === 'time-desc' ? '按时间取值' : '按大小取值'}</span>
            <ArrowDownUp className="h-3.5 w-3.5" />
          </div>
        );
      case 'serial-number':
        return (
          <div className="flex h-9 items-center rounded border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground">
            <span className="truncate">提交时自动生成</span>
          </div>
        );
      case 'leave-time': {
        const wh = normalizeWorkHours(field.workHours);
        const pt = (h: number) => `${String(h).padStart(2, '0')}:00`;
        const bound = [field.leaveTime?.startKey, field.leaveTime?.endKey, field.leaveTime?.hoursKey, field.leaveTime?.daysKey].filter(Boolean);
        return (
          <div className="rounded border border-border bg-background space-y-1.5 px-2.5 py-2">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground/60">开始日期</div>
              <div className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground/60">开始 {pt(wh.amStart)} / {pt(wh.pmStart)}</div>
              <div className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground/60">结束日期</div>
              <div className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground/60">结束 {pt(wh.amEnd)} / {pt(wh.pmEnd)}</div>
            </div>
            <div className="rounded bg-primary/5 px-2 py-1 text-[11px] text-primary">自动计算：请假 X 小时 ≈ Y 天</div>
            {bound.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {bound.map((k) => (
                  <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{k}</span>
                ))}
              </div>
            )}
          </div>
        );
      }
      case 'radio':
      case 'checkbox':
        return (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {(field.options ?? []).slice(0, 3).map((o) => (
              <span key={o} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`h-3.5 w-3.5 rounded-${field.type === 'radio' ? 'full' : 'sm'} border border-border`} />{o}
              </span>
            ))}
          </div>
        );
      case 'switch':
        return <ToggleRight className="h-5 w-5 text-muted-foreground/50" />;
      case 'formula':
        return (
          <div className="flex h-9 items-center justify-between rounded border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground/60">
            <span>{field.formula?.expression || field.defaultValue || '自动计算'}</span>
            <Sigma className="h-3.5 w-3.5" />
          </div>
        );
      case 'summary':
        return (
          <div className="flex h-9 items-center justify-between rounded border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground/60">
            <span>{field.summary?.aggregate === 'sum' ? '求和统计' : field.summary?.aggregate === 'avg' ? '平均统计' : '记录数统计'}</span>
            <Calculator className="h-3.5 w-3.5" />
          </div>
        );
      case 'amount-uppercase':
        return (
          <div className="flex h-9 items-center justify-between rounded border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground/60">
            <span>{field.uppercaseAmount?.fieldKey ? `换算 ${field.uppercaseAmount.fieldKey} 的大写金额` : '大写金额自动换算'}</span>
            <CaseUpper className="h-3.5 w-3.5" />
          </div>
        );
      case 'divider':
        return <Minus className="h-4 w-4" />;
      default:
        if (field.system) {
          return (
            <div className="flex h-9 items-center rounded border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground">
              <span className="truncate">系统自动写入，不在填写表单中显示</span>
            </div>
          );
        }
        return <div className="h-9 rounded border border-border bg-background px-2.5 text-xs leading-9 text-muted-foreground/60">{field.placeholder || `请输入${field.label}`}</div>;
    }
  };
  return (
    <div className="pl-4">
      <p className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
        <span className="text-[10px] font-normal text-muted-foreground/60 font-mono">{field.key}</span>
        {field.system && <Badge className="bg-accent/10 text-accent hover:bg-accent/10 px-1.5 py-0 text-[9px] shrink-0">系统</Badge>}
      </p>
      {control()}
      <p className="text-[10px] text-muted-foreground/50 mt-1">{defLabel} · {field.span ?? 12}/24{field.readOnly ? ' · 只读' : ''}{field.disabled ? ' · 禁用' : ''}{field.system ? ' · 系统默认字段' : ''}</p>
    </div>
  );
}

/** 关联表单 / 查询表单 的实时数据预览 */
function RelationQueryPreview({ formId, displayFields, kind }: { formId: string; displayFields: string[]; kind: 'relation' | 'query' }) {
  const [rows, setRows] = useState<BizData[]>([]);
  const [meta, setMeta] = useState<MetaForm | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!formId) { setRows([]); setMeta(null); return; }
    setLoading(true);
    (async () => {
      const [dataRes, metaRes] = await Promise.all([
        supabase.from('biz_data').select('*').eq('form_id', formId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50),
        supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle(),
      ]);
      if (!alive) return;
      setRows((dataRes.data as BizData[]) ?? []);
      setMeta((metaRes.data as MetaForm) ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [formId]);

  const labelOf = (key: string) => {
    const fd = meta?.schema_json?.fields?.find((f) => f.key === key);
    return fd?.label ?? key;
  };

  if (!formId) {
    return <div className="px-2.5 py-2 text-[11px] text-muted-foreground/50">未关联表单，请在右侧配置</div>;
  }
  if (loading) {
    return <div className="px-2.5 py-2 text-[11px] text-muted-foreground/60">加载中…</div>;
  }

  const cols = displayFields.length > 0
    ? displayFields
    : (meta?.schema_json?.fields ?? []).filter((x) => !x.system && x.type !== 'action-button').slice(0, 3).map((x) => x.key);

  return (
    <div className="rounded border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
        <span className="text-[11px] text-muted-foreground">{kind === 'relation' ? '已选' : '查询到'} {rows.length} 条</span>
        {kind === 'relation' && <span className="text-[11px] text-primary">选择</span>}
      </div>
      {rows.length === 0 ? (
        <div className="px-2.5 py-2 text-[11px] text-muted-foreground/50">暂无数据</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-muted/50">
                {cols.map((k) => <th key={k} className="whitespace-nowrap px-2 py-1 text-left font-medium text-muted-foreground">{labelOf(k)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 3).map((r) => (
                <tr key={r.id} className="border-t border-border">
                  {cols.map((k) => {
                    const raw = (r.payload as Record<string, unknown> | undefined)?.[k];
                    const v = raw === undefined || raw === null ? '' : String(raw);
                    return <td key={k} className="whitespace-nowrap px-2 py-1 text-foreground">{v || '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 画布中按钮组件预览 */
function ButtonPreview({ field }: { field: FormField }) {
  const b = field.button;
  return (
    <div className="pl-4">
      <div className="flex items-center gap-2 mb-1.5">
        <Zap className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium">{field.label}</span>
        <span className="text-[10px] font-normal text-muted-foreground/60">{BUTTON_ACTIONS.find((a) => a.value === b?.actionType)?.label ?? b?.actionType}</span>
      </div>
      <div className="inline-flex h-8 items-center rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground">
        {field.label}
      </div>
    </div>
  );
}

function LayoutPreview({
  field,
  activeGridCol,
  onSelectGridCol,
}: {
  field: FormField;
  activeGridCol?: number;
  onSelectGridCol?: (idx: number) => void;
}) {
  if (field.type === 'group-title') {
    return (
      <div className="pl-4">
        <p className="text-sm font-semibold text-primary">{field.layout?.text || '分组标题'}</p>
        <div className="mt-1 h-px bg-border" />
      </div>
    );
  }
  if (field.type === 'divider') return <div className="pl-4 h-px bg-border" />;
  if (field.type === 'description') {
    return <p className="pl-4 text-xs text-muted-foreground">{field.layout?.description || '说明文字：用于给填写者提供提示信息'}</p>;
  }
  const cols = field.layout?.columns ?? (field.gridColumns?.length || 2);
  return (
    <div className="pl-4">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }).map((_, i) => {
          const colConfig = field.gridColumns?.[i];
          const isCurrent = activeGridCol === i;
          return (
            <div
              key={i}
              onClick={(e) => {
                if (onSelectGridCol) {
                  e.stopPropagation();
                  onSelectGridCol(i);
                }
              }}
              className={cn(
                'min-h-14 rounded border p-2 flex flex-col justify-between transition-all cursor-pointer',
                isCurrent
                  ? 'border-primary ring-1 ring-primary/40 bg-primary/5'
                  : 'border-dashed border-border/80 hover:border-primary/50 bg-background/50',
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={cn('text-xs font-medium truncate', isCurrent ? 'text-primary' : 'text-foreground')}>
                  {colConfig?.title || `第 ${i + 1} 栏`}
                </span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">栏 {i + 1}</span>
              </div>
              <p className="text-[10px] text-muted-foreground truncate mt-1">
                {colConfig?.formId
                  ? `${colConfig.fieldKey || '已选表单'} · ${colConfig.aggregate === 'sum' ? '求和' : colConfig.aggregate === 'count' ? '计数' : '取首条'}`
                  : colConfig?.defaultValue
                    ? `默认值: ${colConfig.defaultValue}`
                    : '未配置文本属性'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 流水号规则编辑器 */
function SerialRuleEditor({ rules, fields, onChange }: { rules: SerialRule[]; fields: FormField[]; onChange: (rules: SerialRule[]) => void }) {
  const [editing, setEditing] = useState<SerialRule | null>(null);
  const [addType, setAddType] = useState<string>('counter');
  const [dragging, setDragging] = useState<string | null>(null);

  const fieldOptions = useMemo(() => fields.filter((f) => !['serial-number', 'action-button', ...LAYOUT_TYPES].includes(f.type) && f.key), [fields]);

  const ruleLabel = (r: SerialRule) => {
    switch (r.type) {
      case 'counter': {
        const cycleNames: Record<string, string> = { year: '年', month: '月', day: '日' };
        return `自动计数 ${r.digits ?? 5}位数字,${r.resetCycle === 'never' || !r.resetCycle ? '不自动重置' : `按${cycleNames[r.resetCycle] ?? r.resetCycle}重置`}`;
      }
      case 'date': return `提交日期 格式：${r.format || 'yyyyMMdd'}`;
      case 'fixed': return `固定字符 ${r.value || '请输入内容'}`;
      case 'field': return `表单字段 ${fields.find((f) => f.key === r.value)?.label || r.value || '未选择'}`;
      default: return '规则';
    }
  };

  const addRule = () => {
    const base: SerialRule = { id: `sr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, type: addType as SerialRule['type'] };
    let r: SerialRule;
    switch (addType) {
      case 'counter': r = { ...base, digits: 5, pad: true, resetCycle: 'never', start: 1 }; break;
      case 'date': r = { ...base, format: 'yyyyMMdd' }; break;
      case 'fixed': r = { ...base, value: '' }; break;
      case 'field': r = { ...base, value: fieldOptions[0]?.key ?? '' }; break;
      default: r = base;
    }
    onChange([...rules, r]);
  };

  const updateRule = (id: string, patch: Partial<SerialRule>) => {
    const next = rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
    onChange(next);
    // 同步刷新弹窗内的编辑对象，使输入框值实时更新
    if (editing?.id === id) setEditing(next.find((r) => r.id === id) ?? null);
  };

  const removeRule = (id: string) => onChange(rules.filter((r) => r.id !== id));

  const moveRule = (from: number, to: number) => {
    if (to < 0 || to >= rules.length) return;
    const n = [...rules];
    const [item] = n.splice(from, 1);
    n.splice(to, 0, item);
    onChange(n);
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs font-medium">流水号规则</p>
      <div className="space-y-2">
        {rules.map((r, idx) => (
          <div
            key={r.id}
            draggable
            onDragStart={() => setDragging(r.id)}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (!dragging || dragging === r.id) return; const from = rules.findIndex((x) => x.id === dragging); const to = idx; moveRule(from, to); setDragging(null); }}
            className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-xs group"
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 cursor-grab" />
            <span className="flex-1 truncate cursor-pointer" onClick={() => setEditing(r)}>{ruleLabel(r)}</span>
            <button type="button" title="删除" className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground" onClick={() => removeRule(r.id)}><Trash2 className="h-3 w-3" /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Select value={addType} onValueChange={setAddType}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="counter">自动计数</SelectItem>
            <SelectItem value="date">提交日期</SelectItem>
            <SelectItem value="fixed">固定字符</SelectItem>
            <SelectItem value="field">表单字段</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={addRule}><Plus className="h-3.5 w-3.5 mr-1" />添加</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">拖动左侧手柄可调整规则拼接顺序</p>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>{editing ? '规则设置' : ''}</DialogTitle></DialogHeader>
          {editing && editing.type === 'counter' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>计数位数</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => updateRule(editing.id, { digits: Math.max(1, (editing.digits ?? 5) - 1) })}>-</Button>
                  <Input type="number" className="h-8 text-center" value={editing.digits ?? 5} onChange={(e) => updateRule(editing.id, { digits: Math.max(1, Number(e.target.value)) })} />
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => updateRule(editing.id, { digits: (editing.digits ?? 5) + 1 })}>+</Button>
                </div>
              </div>
              <label className="flex items-center justify-between text-sm min-h-10">
                位数固定（不足补零）
                <Switch checked={editing.pad ?? true} onCheckedChange={(v) => updateRule(editing.id, { pad: v })} />
              </label>
              <div className="space-y-2">
                <Label>重置周期</Label>
                <Select value={editing.resetCycle || 'never'} onValueChange={(v) => updateRule(editing.id, { resetCycle: v as SerialRule['resetCycle'] })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">不自动重置</SelectItem>
                    <SelectItem value="year">每年</SelectItem>
                    <SelectItem value="month">每月</SelectItem>
                    <SelectItem value="day">每日</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>初始值</Label>
                <Input type="number" className="h-8" value={editing.start ?? 1} onChange={(e) => updateRule(editing.id, { start: Math.max(0, Number(e.target.value)) })} />
              </div>
            </div>
          )}
          {editing && editing.type === 'date' && (
            <div className="space-y-2">
              <Label>日期格式</Label>
              <Select value={editing.format || 'yyyyMMdd'} onValueChange={(v) => updateRule(editing.id, { format: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yyyyMMdd">yyyyMMdd</SelectItem>
                  <SelectItem value="yyyy-MM-dd">yyyy-MM-dd</SelectItem>
                  <SelectItem value="yyyyMM">yyyyMM</SelectItem>
                  <SelectItem value="yyMMdd">yyMMdd</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {editing && editing.type === 'fixed' && (
            <div className="space-y-2">
              <Label>固定字符</Label>
              <Input className="h-8" value={editing.value ?? ''} onChange={(e) => updateRule(editing.id, { value: e.target.value })} placeholder="请输入内容" />
            </div>
          )}
          {editing && editing.type === 'field' && (
            <div className="space-y-2">
              <Label>选择表单字段</Label>
              <Select value={editing.value || 'none'} onValueChange={(v) => updateRule(editing.id, { value: v === 'none' ? '' : v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">请选择</SelectItem>
                  {fieldOptions.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
