import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GuideButton } from '@/components/common/GuideButton';
import { STATE_GUIDE } from '@/lib/page-guides';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { FormField, MetaForm, MetaStateMachine, RuleItem, SmInteraction, SmInteractionType, SmState, SmTransition, WfNode } from '@/types';
import { ensureSystemFields, CompositeDetailFields } from '@/lib/field-catalog';
import { nextAutoSlug } from '@/lib/slug';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ChevronLeft, Save, Loader2, Plus, Trash2, GitBranch, CircleDot, ArrowRight, ShieldQuestion, Zap, UserPlus, Users, ClipboardList, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATE_COLORS = ['#4A58D4', '#293F73', '#0F766E', '#B45309', '#9333EA', '#64748B'];

/** 触发事件预设 */
const EVENT_PRESETS = ['提交', '审批通过', '驳回', '重新提交', '按钮点击', '表单提交', '手动触发'];

/** 递归收集流程节点（含条件分支内的节点） */
function collectNodes(nodes: WfNode[]): WfNode[] {
  return nodes.flatMap((n) => [n, ...collectNodes((n.branches ?? []).flatMap((b) => b.nodes ?? []))]);
}
/** 守卫条件运算符 */
const GUARD_OPS: { value: RuleItem['op']; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lte', label: '小于等于' },
  { value: 'contains', label: '包含' },
  { value: 'ncontains', label: '不包含' },
  { value: 'in', label: '属于' },
];
const OP_LABEL: Record<string, string> = Object.fromEntries(GUARD_OPS.map((o) => [o.value, o.label]));
const CUSTOM_EVENT = '__custom__';
/** 流转交互方式标签与说明（列表按钮触发转换时的运行时交互） */
const INTERACT_LABEL: Record<Exclude<SmInteractionType, 'none'>, string> = { assign: '人员分配', submit: '内容提交', confirm: '内容确定', new_related_form: '新增关联表单' };
/** 新增关联表单交互默认配置（多表单） */
const DEFAULT_NEW_RELATED = { targetFormIds: [] as string[], backfillMode: 'auto', displayFields: ['title'] as string[], mappings: [] as Array<{ mainKey: string; targetKey: string }> };

export default function StateDesigner({ embedded }: { embedded?: boolean }) {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [form, setForm] = useState<MetaForm | null>(null);
  const [sm, setSm] = useState<MetaStateMachine | null>(null);
  const [states, setStates] = useState<SmState[]>([]);
  const [transitions, setTransitions] = useState<SmTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editState, setEditState] = useState<SmState | 'new' | null>(null);
  const [stateForm, setStateForm] = useState({ key: '', label: '', color: STATE_COLORS[0] });
  // 状态名称变更时自动生成拼音标识：标识为空或等于旧名称生成值时跟随，人工修改后锁定
  const updStateLabel = (label: string) => {
    const nextKey = nextAutoSlug(label, stateForm.label, stateForm.key);
    setStateForm(nextKey !== null ? { ...stateForm, label, key: nextKey } : { ...stateForm, label });
  };
  const [editTrans, setEditTrans] = useState<SmTransition | 'new' | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  // 全部表单元数据：复合字段（关联子表/关联表单）明细展开时解析目标表单字段名
  const [allForms, setAllForms] = useState<Pick<MetaForm, 'id' | 'name' | 'schema_json'>[]>([]);
  /** 填写节点名称事件：当前表单流程含填写节点时，触发事件可直接选填写节点名称 */
  const [fillEvents, setFillEvents] = useState<string[]>([]);
  const [transForm, setTransForm] = useState<{ from: string; to: string; eventPreset: string; eventCustom: string; guards: RuleItem[]; action: boolean; interactType: SmInteractionType; assignBy: 'dept' | 'role'; interactFields: string[]; confirm: boolean; confirmMessage: string; newRelated: typeof DEFAULT_NEW_RELATED }>({
    from: '', to: '', eventPreset: '提交', eventCustom: '', guards: [], action: true, interactType: 'none', assignBy: 'dept', interactFields: [], confirm: false, confirmMessage: '', newRelated: { ...DEFAULT_NEW_RELATED },
  });
  /** 人员分配：可选人员与角色列表 */
  const [assignUsers, setAssignUsers] = useState<{ id: string; name: string }[]>([]);
  const [assignRoles, setAssignRoles] = useState<{ id: string; name: string }[]>([]);
  const eventValue = (s: typeof transForm) => (s.eventPreset === CUSTOM_EVENT ? s.eventCustom.trim() : s.eventPreset);
  const fieldMap = new Map(fields.map((f) => [f.key, f.label]));
  const addGuard = () => setTransForm((s) => ({ ...s, guards: [...s.guards, { field: '', op: 'eq', value: '', value_type: 'value' }] }));
  const updGuard = (i: number, patch: Partial<RuleItem>) => setTransForm((s) => ({ ...s, guards: s.guards.map((g, idx) => (idx === i ? { ...g, ...patch } : g)) }));
  const delGuard = (i: number) => setTransForm((s) => ({ ...s, guards: s.guards.filter((_, idx) => idx !== i) }));

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    // profiles/roles：有缓存直接用，无缓存才查询（减少每次 load 的 2 个请求）
    if (profRoleCache.current) {
      setAssignUsers(profRoleCache.current.users);
      setAssignRoles(profRoleCache.current.roles);
    }
    const [formRes, smRes, wfRes, profRes, roleRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle(),
      supabase.from('meta_state_machine').select('*').eq('form_id', formId).maybeSingle(),
      supabase.from('meta_workflow').select('nodes').eq('form_id', formId).maybeSingle(),
      profRoleCache.current ? Promise.resolve({ data: profRoleCache.current.users, error: null }) : supabase.from('profiles').select('id, name').order('name'),
      profRoleCache.current ? Promise.resolve({ data: profRoleCache.current.roles, error: null }) : supabase.from('roles').select('id, name').order('name'),
    ]);
    const users = (profRes.data as { id: string; name: string }[]) ?? [];
    const roles = (roleRes.data as { id: string; name: string }[]) ?? [];
    if (!profRoleCache.current) profRoleCache.current = { users, roles };
    setAssignUsers(users);
    setAssignRoles(roles);
    const f = formRes.data as MetaForm | null;
    setForm(f);
    setFields(ensureSystemFields((f?.schema_json?.fields ?? []) as FormField[]));
    // 全部表单元数据供复合字段明细展开解析（缓存：一次会话只查一次）
    if (!allFormsCache.current) {
      void supabase.from('meta_forms').select('id, name, schema_json').order('updated_at', { ascending: false }).then(({ data }) => {
        allFormsCache.current = (data as Pick<MetaForm, 'id' | 'name' | 'schema_json'>[]) ?? [];
        setAllForms(allFormsCache.current);
      });
    } else {
      setAllForms(allFormsCache.current);
    }
    // 填写节点名称作为触发事件选项（含条件分支内的填写节点）
    const wfNodes = ((wfRes.data as { nodes?: WfNode[] } | null)?.nodes ?? []) as WfNode[];
    setFillEvents(collectNodes(wfNodes).filter((n) => n.type === 'fill').map((n) => n.name).filter(Boolean));
    const m = smRes.data as MetaStateMachine | null;
    setSm(m);
    setDirty(false); // 加载数据后重置脏标记
    if (m?.states) {
      setStates(m.states);
      setTransitions(m.transitions ?? []);
    } else {
      setStates([
        { id: 's1', key: 'draft', label: '草稿', initial: true, color: STATE_COLORS[5] },
        { id: 's2', key: 'pending', label: '审批中', color: STATE_COLORS[2] },
        { id: 's3', key: 'approved', label: '已通过', color: STATE_COLORS[1] },
        { id: 's4', key: 'rejected', label: '已驳回', color: STATE_COLORS[0] },
      ]);
      setTransitions([
        { id: 't1', from: 'draft', to: 'pending', event: '提交' },
        { id: 't2', from: 'pending', to: 'approved', event: '审批通过' },
        { id: 't3', from: 'pending', to: 'rejected', event: '驳回' },
      ]);
    }
    setLoading(false);
  }, [formId]);

  // load 防抖包装：短时间内多次调用只执行最后一次
  const debouncedLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => { void load(); }, 300);
  }, [load]);

  useEffect(() => {
    debouncedLoad();
  }, [debouncedLoad]);

  // 脏数据跟踪：仅在实际修改操作后置脏（加载数据不算）
  const [dirty, setDirty] = useState(false);
  // 保存防抖：合并 saveTrans 的立即持久化与 save()，避免短时间内多次 upsert 触发后端 429 限流
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // load 防抖：防止保存后自动 load + 手动刷新等短时间内多次触发 6 个并发查询
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // allForms 缓存：避免每次 load() 都全量查询 meta_forms
  const allFormsCache = useRef<Pick<MetaForm, 'id' | 'name' | 'schema_json'>[] | null>(null);
  // profiles/roles 缓存：人员与角色列表不常变，一次会话只查一次
  const profRoleCache = useRef<{ users: { id: string; name: string }[]; roles: { id: string; name: string }[] } | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // 防抖持久化：多次触发合并为一次 upsert（800ms 内只执行最后一次）
  const persistSm = useCallback((sts: SmState[], trs: SmTransition[]) => {
    if (!formId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const payload = { tenant_id: tenantId, form_id: formId, states: sts, transitions: trs };
      const { error } = await supabase.from('meta_state_machine').upsert(payload, { onConflict: 'form_id' });
      setSaving(false);
      if (error) return toast.error('保存失败：' + error.message);
      setDirty(false);
      toast.success('状态机已保存');
      // 500ms 后再 load，给后端限流窗口喘息
      if (loadTimer.current) clearTimeout(loadTimer.current);
      loadTimer.current = setTimeout(() => { void load(); }, 500);
    }, 800);
  }, [formId, tenantId]);

  const save = async () => {
    if (!formId) return;
    if (states.filter((s) => s.initial).length !== 1) return toast.error('必须有且只有一个初始状态');
    setSaving(true);
    // 调试：确认待保存 transitions 中各转换的 interaction 是否完整（特别是 new_related_form）
    // 使用函数式获取最新 states/transitions（防止 await 后读取过期闭包）
    const latestStates = await new Promise<SmState[]>((resolve) => { setStates((s) => { resolve(s); return s; }); });
    const latestTrans = await new Promise<SmTransition[]>((resolve) => { setTransitions((t) => { resolve(t); return t; }); });
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[SM save] transitions:', JSON.stringify(latestTrans, null, 2));
    }
    const payload = { tenant_id: tenantId, form_id: formId, states: latestStates, transitions: latestTrans };
    const { error } = await supabase.from('meta_state_machine').upsert(payload, { onConflict: 'form_id' });
    setSaving(false);
    if (error) return toast.error('保存失败：' + error.message);
    setDirty(false);
    toast.success('状态机已保存');
    // 500ms 后再 load，避免与 persistSm 的自动 load 叠加触发 429
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => { void load(); }, 500);
  };

  const openStateNew = () => {
    setEditState('new');
    setStateForm({ key: '', label: '', color: STATE_COLORS[states.length % STATE_COLORS.length] });
  };
  const openStateEdit = (s: SmState) => {
    setEditState(s);
    setStateForm({ key: s.key, label: s.label, color: s.color ?? STATE_COLORS[0] });
  };
  const saveState = () => {
    if (!stateForm.key.trim() || !stateForm.label.trim()) return toast.error('请填写状态标识与名称');
    if (editState === 'new' && states.some((s) => s.key === stateForm.key)) return toast.error('状态标识已存在');
    setDirty(true);
    if (editState === 'new') {
      setStates((s) => [...s, { id: `s_${Date.now().toString(36)}`, key: stateForm.key, label: stateForm.label, color: stateForm.color, initial: s.length === 0 }]);
    } else if (editState) {
      setStates((s) => s.map((x) => (x.id === editState.id ? { ...x, key: stateForm.key, label: stateForm.label, color: stateForm.color } : x)));
    }
    setEditState(null);
  };
  const removeState = (s: SmState) => {
    if (transitions.some((t) => t.from === s.key || t.to === s.key)) return toast.error('该状态已被转换引用，先删除相关转换');
    setDirty(true);
    setStates((x) => x.filter((y) => y.id !== s.id));
  };
  const setInitial = (s: SmState) => { setDirty(true); setStates((x) => x.map((y) => ({ ...y, initial: y.id === s.id }))); };

  const openTransNew = () => {
    if (states.length < 2) return toast.error('至少需要两个状态');
    setEditTrans('new');
    setTransForm({ from: states[0].key, to: states[1].key, eventPreset: '提交', eventCustom: '', guards: [], action: true, interactType: 'none', assignBy: 'dept', interactFields: [], confirm: false, confirmMessage: '', newRelated: { ...DEFAULT_NEW_RELATED } });
  };
  const saveTrans = async () => {
    // 使用函数式获取最新 transForm，防止 await 后读取过期闭包
    const latest = await new Promise<typeof transForm>((resolve) => {
      setTransForm((s) => { resolve(s); return s; });
    });
    const ev = eventValue(latest);
    if (!ev) return toast.error('请选择触发事件');
    const validGuards = latest.guards.filter((g) => g.field && g.value);
    // 内容提交/内容确定必须至少关联一个字段
    if ((latest.interactType === 'submit' || latest.interactType === 'confirm') && latest.interactFields.length === 0) {
      return toast.error(`「${INTERACT_LABEL[latest.interactType]}」交互请至少选择一个关联字段`);
    }
    // 新增关联表单：校验并解析回填字段（auto 时自动在源表单创建 form-ref 回填字段，支持多表单）
    let newRelated: SmInteraction['newRelated'] | undefined;
    if (latest.interactType === 'new_related_form') {
      const nr = latest.newRelated;
      // 兼容历史单表单数据：targetFormIds 为空但有 targetFormId（旧 schema）→ 归一为单元素数组
      const targetIds: string[] = nr.targetFormIds.length > 0
        ? nr.targetFormIds
        : (nr as unknown as { targetFormId?: string }).targetFormId ? [(nr as unknown as { targetFormId?: string }).targetFormId as string] : [];
      if (targetIds.length === 0) return toast.error('「新增关联表单」交互请选择目标表单');
      if (nr.displayFields.length === 0) return toast.error('「新增关联表单」交互请至少勾选一个显示字段');
      // 调试：确认 new_related_form 交互进入保存流程
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[saveTrans] new_related_form 配置:', JSON.stringify({ targetIds, displayFields: nr.displayFields, mappings: nr.mappings }, null, 2));
      }
      const backfillFields: Record<string, string> = {};
      const displayFieldsMap: Record<string, string[]> = {};
      const newAutoFields: FormField[] = [];
      const curFields = form?.schema_json?.fields ?? [];
      for (const tid of targetIds) {
        let bf = nr.backfillMode !== 'auto' ? nr.backfillMode : '';
        if (!bf) {
          // 该目标表单已存在回填字段则复用，避免每次保存都新建导致字段累积重复
          const existing = curFields.find((x: FormField) => x.type === 'form-ref' && x.relation?.formId === tid && x.key?.startsWith('rel_'));
          if (existing) {
            bf = existing.key;
          } else {
            const targetName = allForms.find((f) => f.id === tid)?.name ?? 'target';
            const slug = targetName.replace(/[^a-zA-Z0-9一-龥]+/g, '_').slice(0, 20);
            bf = `rel_${slug}_${Math.random().toString(36).slice(2, 7)}`;
            newAutoFields.push({
              id: `fld_${Math.random().toString(36).slice(2, 10)}`,
              type: 'form-ref',
              label: `关联记录（${targetName}）`,
              key: bf,
              span: 24,
              relation: { formId: tid, displayFields: nr.displayFields, saveMode: 'standalone', dataRange: 'permission', hideInDetail: true },
            });
          }
        }
        backfillFields[tid] = bf;
        displayFieldsMap[tid] = nr.displayFields;
      }
      if (newAutoFields.length > 0) {
        const { error: fe } = await supabase.from('meta_forms').update({
          schema_json: { ...(form?.schema_json ?? { fields: [] }), fields: [...curFields, ...newAutoFields] },
          updated_at: new Date().toISOString(),
        }).eq('id', formId);
        if (fe) return toast.error('创建回填字段失败：' + fe.message);
        if (loadTimer.current) clearTimeout(loadTimer.current);
        loadTimer.current = setTimeout(() => { void load(); }, 500);
      }
      newRelated = {
        targetFormIds: targetIds,
        backfillFields,
        displayFieldsMap,
        displayFields: nr.displayFields,
        fieldMappings: nr.mappings.filter((m) => m.mainKey && m.targetKey),
      };
    }
    // 流转交互方式：无交互直接流转时仍保存 confirm/message（支持二次确认 + 提示内容）；其他按类型组装
    const interaction: SmInteraction | undefined = latest.interactType === 'none'
      ? (latest.confirm ? { type: 'none', confirm: true, ...(latest.confirmMessage.trim() ? { message: latest.confirmMessage.trim() } : {}) } : undefined)
      : {
        type: latest.interactType,
        ...(latest.interactType === 'assign' ? { assignBy: latest.assignBy } : {}),
        ...(latest.interactType === 'new_related_form' ? { newRelated } : { fields: latest.interactFields }),
        ...(latest.confirm ? { confirm: true, ...(latest.confirmMessage.trim() ? { message: latest.confirmMessage.trim() } : {}) } : {}),
      };
    const base = {
      from: latest.from, to: latest.to, event: ev,
      ...(validGuards.length ? { guards: validGuards } : {}),
      ...(latest.action ? { actions: ['通知', '记录日志'] } : {}),
      // 存量自动分配（assignAction）继续生效于流转 RPC，设计器不再编辑、保存时原样继承
      ...(editTrans && editTrans !== 'new' && editTrans.assignAction ? { assignAction: editTrans.assignAction } : {}),
      ...(interaction ? { interaction } : {}),
    };
    // 同步计算最新 transitions（不依赖 React 状态异步更新），确保后续 save() 能读取到本次修改
    const latestTransitions = editTrans === 'new'
      ? [...transitions, { id: `t_${Date.now().toString(36)}`, ...base }]
      : editTrans
        ? transitions.map((x) => (x.id === editTrans.id ? { ...x, ...base } : x))
        : transitions;
    setTransitions(latestTransitions);
    // 调试：确认 transitions 已包含 new_related_form 交互
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[saveTrans] latestTransitions:', JSON.stringify(latestTransitions, null, 2));
    }
    setEditTrans(null);
    // 走防抖持久化通道（与「保存状态机」合并，避免 429）
    persistSm(states, latestTransitions);
  };
  const removeTrans = (t: SmTransition) => { setDirty(true); setTransitions((x) => x.filter((y) => y.id !== t.id)); };

  const stateByKey = new Map(states.map((s) => [s.key, s]));

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!form) return <div className="p-8 text-center text-muted-foreground">表单不存在</div>;

  return (
    <div className={cn('p-4 md:p-8', embedded && 'h-full overflow-y-auto')}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-white border border-white rounded-[5px] px-5 py-4">
        <div className="flex items-center gap-2 min-w-0">
          {!embedded && <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/design/apps')}><ChevronLeft className="h-4 w-4" /></Button>}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{form.name} · 状态机设计</h1>
            <p className="text-sm text-muted-foreground mt-1">定义状态集合与流转规则，支持守卫条件与动作</p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <GuideButton label="状态机设计" guide={STATE_GUIDE} />
          {dirty && <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/10 text-[10px] gap-1"><AlertCircle className="h-3 w-3" />有未保存更改</Badge>}
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}保存状态机</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 状态集合 */}
        <div className="bg-card border border-border rounded-lg">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold flex items-center gap-2"><CircleDot className="h-4 w-4 text-primary" />状态（States）</h2>
            <Button variant="outline" size="sm" onClick={openStateNew}><Plus className="mr-1.5 h-3.5 w-3.5" />添加状态</Button>
          </div>
          <div className="p-4 space-y-2">
            {states.map((s) => (
              <div key={s.id} className="group flex items-center gap-3 rounded-md border border-border px-3.5 py-2.5">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground font-mono">{s.key}</span>
                {s.initial && <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-[10px]">初始</Badge>}
                <span className="flex-1" />
                {!s.initial && (
                  <button type="button" className="text-xs text-muted-foreground hover:text-primary inline" onClick={() => setInitial(s)}>设为初始</button>
                )}
                <span className="sig-row-actions inline-flex gap-1">
                  <button type="button" className="h-6 w-6 flex items-center justify-center rounded border border-border hover:bg-muted" onClick={() => openStateEdit(s)}><GitBranch className="h-3 w-3" /></button>
                  <button type="button" className="h-6 w-6 flex items-center justify-center rounded border border-border text-destructive hover:bg-destructive/10" onClick={() => removeState(s)}><Trash2 className="h-3 w-3" /></button>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 转换规则 */}
        <div className="bg-card border border-border rounded-lg">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold flex items-center gap-2"><ArrowRight className="h-4 w-4 text-primary" />转换（Transitions）</h2>
            <Button variant="outline" size="sm" onClick={openTransNew}><Plus className="mr-1.5 h-3.5 w-3.5" />添加转换</Button>
          </div>
          <div className="p-4 space-y-2 max-h-[26rem] overflow-y-auto">
            {transitions.map((t) => {
              const from = stateByKey.get(t.from);
              const to = stateByKey.get(t.to);
              return (
                <div key={t.id} className="group rounded-md border border-border px-3.5 py-3">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="font-medium">{from?.label ?? t.from}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-primary" />
                    <span className="font-medium">{to?.label ?? t.to}</span>
                    <Badge variant="outline" className="text-[10px]">{t.event}</Badge>
                    {t.guards && t.guards.length > 0 && (
                      t.guards.map((g, gi) => (
                        <Badge key={gi} className="bg-chart-2/10 text-chart-2 hover:bg-chart-2/10 text-[10px] gap-1">
                          <ShieldQuestion className="h-3 w-3" />
                          {fieldMap.get(g.field) ?? g.field} {OP_LABEL[g.op] ?? g.op} {(g.value_type ?? 'value') === 'field' ? `[${fieldMap.get(g.value) ?? g.value}]` : g.value}
                        </Badge>
                      ))
                    )}
                    {t.actions && t.actions.length > 0 && (
                      <Badge className="bg-muted text-muted-foreground hover:bg-muted text-[10px] gap-1"><Zap className="h-3 w-3" />动作</Badge>
                    )}
                    {t.assignAction && (
                      <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[10px] gap-1"><UserPlus className="h-3 w-3" />{t.assignAction.type === 'manual' ? '指定处理人' : t.assignAction.type === 'rule' ? '规则分配' : '角色池认领'}</Badge>
                    )}
                    {t.interaction && t.interaction.type !== 'none' && (
                      <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-[10px] gap-1">
                        {t.interaction.type === 'assign' ? <Users className="h-3 w-3" /> : t.interaction.type === 'submit' ? <ClipboardList className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                        {INTERACT_LABEL[t.interaction.type]}
                      </Badge>
                    )}
                    <span className="flex-1" />
                    <span className="sig-row-actions inline-flex gap-1">
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded border border-border hover:bg-muted" onClick={() => { const isPreset = EVENT_PRESETS.includes(t.event) || fillEvents.includes(t.event); setEditTrans(t); setTransForm({ from: t.from, to: t.to, eventPreset: isPreset ? t.event : CUSTOM_EVENT, eventCustom: isPreset ? '' : t.event, guards: (t.guards ?? []).map((g) => ({ ...g })), action: !!t.actions?.length, interactType: t.interaction?.type ?? 'none', assignBy: t.interaction?.assignBy ?? 'dept', interactFields: t.interaction?.fields ?? [], confirm: t.interaction?.confirm ?? false, confirmMessage: t.interaction?.message ?? '', newRelated: t.interaction?.newRelated ? { targetFormIds: t.interaction.newRelated.targetFormIds ?? (t.interaction.newRelated.targetFormId ? [t.interaction.newRelated.targetFormId] : []), backfillMode: 'auto', displayFields: t.interaction.newRelated.displayFields ?? ['title'], mappings: (t.interaction.newRelated.fieldMappings ?? []).map((m) => ({ ...m })) } : { ...DEFAULT_NEW_RELATED } }); }}>
                        <GitBranch className="h-3 w-3" />
                      </button>
                      <button type="button" className="h-6 w-6 flex items-center justify-center rounded border border-border text-destructive hover:bg-destructive/10" onClick={() => removeTrans(t)}><Trash2 className="h-3 w-3" /></button>
                    </span>
                  </div>
                </div>
              );
            })}
            {transitions.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无转换规则</p>}
          </div>
        </div>
      </div>

      {/* 流转图示意 */}
      <div className="mt-6 bg-card border border-border rounded-lg p-5">
        <h2 className="text-base font-semibold mb-4">流转示意</h2>
        <div className="flex flex-wrap items-center gap-3">
          {states.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={cn('flex h-16 w-16 items-center justify-center rounded-full border text-xs font-medium', s.initial && 'ring-1 ring-primary/30 ring-offset-1')}
                  style={{ borderColor: s.color, color: s.color }}
                >
                  {s.label}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">{s.key}</span>
              </div>
              {i < states.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground/50" />}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          守卫条件示例：金额大于 10000 时必须经过财务审批（guard: amount &gt; 10000）；状态变更自动触发通知与操作日志。
        </p>
      </div>

      {/* 状态编辑弹窗 */}
      <Dialog open={!!editState} onOpenChange={(v) => !v && setEditState(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>{editState === 'new' ? '添加状态' : '编辑状态'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>状态名称 *</Label>
              <Input
                value={stateForm.label}
                onCompositionEnd={(e) => { updStateLabel((e.target as HTMLInputElement).value); }}
                onChange={(e) => { if ((e.nativeEvent as InputEvent).isComposing) return; updStateLabel(e.target.value); }}
                placeholder="如：已完成"
              />
            </div>
            <div className="space-y-2">
              <Label>状态标识（key）*</Label>
              <Input
                className="font-mono text-xs"
                value={stateForm.key}
                onChange={(e) => {
                  // 中文输入法组合期间直接写入原始值，组合结束后再过滤，避免拼音字母被重复写入
                  if ((e.nativeEvent as InputEvent).isComposing) { setStateForm({ ...stateForm, key: e.target.value }); return; }
                  setStateForm({ ...stateForm, key: e.target.value.replace(/[^a-z0-9_]/g, '') });
                }}
                onCompositionEnd={(e) => {
                  const v = (e.target as HTMLInputElement).value.replace(/[^a-z0-9_]/g, '');
                  setStateForm({ ...stateForm, key: v });
                }}
                placeholder="如：completed"
              />
            </div>
            <div className="space-y-2">
              <Label>状态色</Label>
              <div className="flex gap-2">
                {STATE_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setStateForm({ ...stateForm, color: c })} className={cn('h-8 w-8 rounded-full border transition-transform', stateForm.color === c ? 'border-foreground scale-110' : 'border-transparent')} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditState(null)}>取消</Button>
            <Button onClick={saveState}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 转换编辑弹窗 */}
      <Dialog open={!!editTrans} onOpenChange={(v) => !v && setEditTrans(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader><DialogTitle>{editTrans === 'new' ? '添加转换' : '编辑转换'}</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>来源状态</Label>
                <Select value={transForm.from} onValueChange={(v) => setTransForm({ ...transForm, from: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{states.map((s) => <SelectItem key={s.id} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>目标状态</Label>
                <Select value={transForm.to} onValueChange={(v) => setTransForm({ ...transForm, to: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{states.map((s) => <SelectItem key={s.id} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>触发事件 *</Label>
              <Select value={transForm.eventPreset} onValueChange={(v) => setTransForm({ ...transForm, eventPreset: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>通用事件</SelectLabel>
                    {EVENT_PRESETS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectGroup>
                  {fillEvents.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>填写节点（填写完成时触发）</SelectLabel>
                      {fillEvents.map((e) => <SelectItem key={`fill_${e}`} value={e}>{e}</SelectItem>)}
                    </SelectGroup>
                  )}
                  <SelectItem value={CUSTOM_EVENT}>自定义事件…</SelectItem>
                </SelectContent>
              </Select>
              {transForm.eventPreset === CUSTOM_EVENT && (
                <Input value={transForm.eventCustom} onChange={(e) => setTransForm({ ...transForm, eventCustom: e.target.value })} placeholder="输入自定义事件名称" />
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium flex items-center gap-1"><ShieldQuestion className="h-3.5 w-3.5" />守卫条件（可选）</p>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary" onClick={addGuard}><Plus className="mr-1 h-3 w-3" />添加条件</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">满足以下全部条件时才允许状态转换（条件之间为「且」关系）</p>
              {transForm.guards.length === 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">暂无守卫条件，点击「添加条件」配置</p>
              )}
              {transForm.guards.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={g.field || 'none'} onValueChange={(v) => updGuard(i, { field: v === 'none' ? '' : v })}>
                    <SelectTrigger className="h-8 flex-1 min-w-0 text-xs"><SelectValue placeholder="选择字段" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未选择</SelectItem>
                      {fields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={g.op} onValueChange={(v) => updGuard(i, { op: v as RuleItem['op'] })}>
                    <SelectTrigger className="h-8 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{GUARD_OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={g.value_type ?? 'value'} onValueChange={(v) => updGuard(i, { value_type: v as 'value' | 'field', value: v === 'field' ? '' : g.value })}>
                    <SelectTrigger className="h-8 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="value">设定值</SelectItem>
                      <SelectItem value="field">当前表字段</SelectItem>
                    </SelectContent>
                  </Select>
                  {(g.value_type ?? 'value') === 'field' ? (
                    <Select value={g.value || 'none'} onValueChange={(v) => updGuard(i, { value: v === 'none' ? '' : v })}>
                      <SelectTrigger className="h-8 flex-1 min-w-0 text-xs"><SelectValue placeholder="选择比较字段" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">未选择</SelectItem>
                        {fields.filter((f) => f.key !== g.field).map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input className="h-8 flex-1 min-w-0 text-xs" placeholder="比较值" value={g.value} onChange={(e) => updGuard(i, { value: e.target.value })} />
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10" onClick={() => delGuard(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
            <label className="flex items-center justify-between text-sm min-h-9">
              <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-muted-foreground" />转换时触发动作（通知 + 日志）</span>
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={transForm.action} onChange={(e) => setTransForm({ ...transForm, action: e.target.checked })} />
            </label>
            <div className="space-y-2.5 rounded-md border border-border p-3">
              <p className="text-xs font-medium flex items-center gap-1"><Zap className="h-3.5 w-3.5" />流转交互方式（列表按钮触发时）</p>
              <p className="text-[11px] text-muted-foreground">该转换绑定列表按钮后，点击按钮时按以下方式交互后流转</p>
              <div className="grid grid-cols-2 gap-2">
                {([['none', '无交互直接流转'], ['assign', '人员分配'], ['submit', '内容提交'], ['confirm', '内容确定'], ['new_related_form', '新增关联表单']] as const).map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs cursor-pointer hover:bg-muted/40">
                    <input type="radio" name="sm-interact-type" className="h-4 w-4 accent-primary" checked={transForm.interactType === v} onChange={() => setTransForm((s) => ({ ...s, interactType: v, interactFields: v === 'none' || v === 'assign' ? [] : s.interactFields, newRelated: v === 'new_related_form' ? s.newRelated : s.newRelated }))} />
                    {label}
                  </label>
                ))}
              </div>
              {transForm.interactType === 'none' && (
                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <Checkbox id="sm-none-confirm" checked={transForm.confirm} onCheckedChange={(v) => setTransForm({ ...transForm, confirm: v === true })} />
                    <label htmlFor="sm-none-confirm" className="text-xs cursor-pointer select-none">开启二次确认弹窗（点击按钮后先确认再流转）</label>
                  </div>
                  {transForm.confirm && (
                    <div className="space-y-1">
                      <Label className="text-xs">确认提示内容（可选，留空使用默认文案）</Label>
                      <Textarea className="min-h-[56px] text-xs" placeholder="例如：确定将「未联系」转为「已联系」吗？" value={transForm.confirmMessage} onChange={(e) => setTransForm({ ...transForm, confirmMessage: e.target.value })} />
                    </div>
                  )}
                </div>
              )}
              {transForm.interactType === 'assign' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">分配维度</Label>
                  <Select value={transForm.assignBy} onValueChange={(v) => setTransForm({ ...transForm, assignBy: v as 'dept' | 'role' })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dept">按部门分配</SelectItem>
                      <SelectItem value="role">按角色分配</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">点击按钮后选择{transForm.assignBy === 'dept' ? '部门' : '角色'}，再从成员中模糊搜索多选人员，确定后写入负责人并通知对应人员、状态流转</p>
                </div>
              )}
              {(transForm.interactType === 'submit' || transForm.interactType === 'confirm') && (
                <div className="space-y-1.5">
                  <Label className="text-xs">{transForm.interactType === 'submit' ? '需提交内容的字段 *' : '需确定内容的字段 *'}</Label>
                  <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto rounded-md border border-border p-2">
                    {fields.filter((f) => !f.system).map((f) => (
                      <div key={f.key} className="min-w-0">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Checkbox checked={transForm.interactFields.includes(f.key)} onCheckedChange={(v) => setTransForm({ ...transForm, interactFields: v === true ? [...transForm.interactFields, f.key] : transForm.interactFields.filter((k) => k !== f.key) })} />
                          <span className="truncate">{f.label}</span>
                        </label>
                        <CompositeDetailFields field={f} forms={allForms} />
                      </div>
                    ))}
                    {fields.filter((f) => !f.system).length === 0 && <p className="col-span-2 py-2 text-center text-xs text-muted-foreground">表单暂无业务字段</p>}
                  </div>
                  {transForm.interactType === 'submit' && <p className="text-[11px] text-muted-foreground">点击按钮后填写所选字段内容，提交后更新单据数据并流转</p>}
                  {transForm.interactType === 'confirm' && <p className="text-[11px] text-muted-foreground">点击按钮后只读查看所选字段内容，确认后流转</p>}
                </div>
              )}
              {transForm.interactType === 'new_related_form' && (
                <NewRelatedConfig
                  formId={formId ?? ''}
                  fields={fields}
                  allForms={allForms}
                  value={transForm.newRelated}
                  onChange={(v) => setTransForm((s) => ({ ...s, newRelated: v }))}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTrans(null)}>取消</Button>
            <Button onClick={() => { saveTrans(); if (transForm.interactType === 'new_related_form') toast.info('转换规则已更新，请点击右上角「保存状态机」持久化到数据库', { duration: 5000 }); }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 新增关联表单交互的配置区：目标表单（多选）/ 回填字段 / 显示字段 / 主表字段赋值
 *  多表单模式：一次弹窗内依次填写多张目标表单，全部创建后统一回填/赋值并流转 */
function NewRelatedConfig({ formId, fields, allForms, value, onChange }: {
  formId: string;
  fields: FormField[];
  allForms: Pick<MetaForm, 'id' | 'name' | 'schema_json'>[];
  value: typeof DEFAULT_NEW_RELATED;
  onChange: (v: typeof DEFAULT_NEW_RELATED) => void;
}) {
  const LAYOUT = ['group-title', 'grid', 'divider', 'description', 'wizard-step'];
  // 兼容历史单表单数据：targetFormId（旧 schema）自动归入 targetFormIds
  const legacyId = (value as unknown as { targetFormId?: string }).targetFormId ?? '';
  const targetIds: string[] = value.targetFormIds.length > 0 ? value.targetFormIds : legacyId ? [legacyId] : [];
  const targetForms = allForms.filter((f) => targetIds.includes(f.id));
  const targetFieldsOf = (tid: string): FormField[] =>
    ((allForms.find((f) => f.id === tid)?.schema_json?.fields ?? []) as FormField[]).filter((f) => !LAYOUT.includes(f.type) && !f.system);
  // 每张已选表单的可复用回填字段（form-ref 且 relation.formId 匹配）
  const reusableRefFieldsOf = (tid: string): FormField[] =>
    fields.filter((f) => f.type === 'form-ref' && f.relation?.formId === tid);
  const mainFields = fields.filter((f) => !f.system && !LAYOUT.includes(f.type) && f.type !== 'form-ref');
  const toggleTarget = (tid: string) => {
    const next = targetIds.includes(tid) ? targetIds.filter((x) => x !== tid) : [...targetIds, tid];
    onChange({ ...value, targetFormIds: next, backfillMode: 'auto', displayFields: ['title'] });
  };
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <Label className="text-xs">目标表单（新增弹窗中创建哪张表的数据，可多选）*</Label>
        <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-2">
          {allForms.filter((f) => f.id !== formId).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => toggleTarget(f.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${targetIds.includes(f.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'}`}
            >
              {f.name}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">关联多个表单时：弹窗内依次展示各表单的必填填写字段，信息填写完成后自动保存到多个对应关联表单</p>
      </div>
      {targetForms.length > 0 && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">回填字段（关联记录 ID 写入本表单的字段）</Label>
            <div className="space-y-1.5">
              {targetForms.map((tf) => {
                const reusable = reusableRefFieldsOf(tf.id);
                return (
                  <div key={tf.id} className="flex items-center gap-2">
                    <Badge className="bg-muted text-muted-foreground hover:bg-muted shrink-0 text-[10px]">{tf.name}</Badge>
                    <Select value={value.backfillMode} onValueChange={(v) => onChange({ ...value, backfillMode: v })}>
                      <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自动新建关联字段（推荐）</SelectItem>
                        {reusable.map((f) => <SelectItem key={f.id} value={f.key}>复用已有字段：{f.label}（{f.key}）</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">创建的目标记录 ID 回填到本单据对应字段，详情页自动展示关联子列表（多张表单各自独立回填字段）</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">显示字段（详情页关联子列表的列）</Label>
            <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-2">
              {['title', 'created_at', ...Array.from(new Set(targetForms.flatMap((tf) => targetFieldsOf(tf.id).map((f) => f.key))))].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onChange({ ...value, displayFields: value.displayFields.includes(k) ? value.displayFields.filter((x) => x !== k) : [...value.displayFields, k] })}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${value.displayFields.includes(k) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'}`}
                >
                  {k === 'title' ? '标题' : k === 'created_at' ? '创建时间' : (targetForms.flatMap((tf) => targetFieldsOf(tf.id)).find((f) => f.key === k)?.label ?? k)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">主表字段赋值（创建后把目标记录字段值写入本单据对应字段，赋值字段只读）</Label>
            <div className="space-y-2 rounded-md border border-border p-2">
              {value.mappings.length === 0 && <p className="text-[11px] text-muted-foreground">未配置赋值映射，可点击底部按钮添加</p>}
              {value.mappings.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={m.mainKey || 'none'} onValueChange={(v) => onChange({ ...value, mappings: value.mappings.map((x, xi) => (xi === i ? { ...x, mainKey: v === 'none' ? '' : v } : x)) })}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      {(() => {
                        const f = mainFields.find((x) => x.key === m.mainKey);
                        return (
                          <>
                            <span className="pointer-events-none absolute left-0 flex-1 truncate pr-6 text-muted-foreground">{!m.mainKey ? '主表字段' : ''}</span>
                            <span className="truncate">{f ? f.label : (m.mainKey || '')}</span>
                          </>
                        );
                      })()}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">选择主表字段</SelectItem>
                      {mainFields.map((f) => <SelectItem key={f.id} value={f.key}>{f.label}（{f.key}）</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground shrink-0">←</span>
                  <Select value={m.targetKey || 'none'} onValueChange={(v) => onChange({ ...value, mappings: value.mappings.map((x, xi) => (xi === i ? { ...x, targetKey: v === 'none' ? '' : v } : x)) })}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      {(() => {
                        const f = m.targetKey && m.targetKey !== 'title' ? targetForms.flatMap((tf) => targetFieldsOf(tf.id)).find((x) => x.key === m.targetKey) : undefined;
                        const label = !m.targetKey ? '目标表字段' : m.targetKey === 'title' ? '标题' : (f ? f.label : m.targetKey);
                        return <span className="truncate">{label}</span>;
                      })()}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">选择目标表字段</SelectItem>
                      <SelectItem value="title">标题</SelectItem>
                      {targetForms.flatMap((tf) => targetFieldsOf(tf.id)).map((f) => <SelectItem key={f.id} value={f.key}>{f.label}（{f.key}）</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="ghost" className="shrink-0 h-8 w-8 p-0 border border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => onChange({ ...value, mappings: value.mappings.filter((_, xi) => xi !== i) })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="w-full" onClick={() => onChange({ ...value, mappings: [...value.mappings, { mainKey: '', targetKey: '' }] })}>
                <Plus className="h-3.5 w-3.5 mr-1" />添加赋值映射
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">点击按钮后弹出关联表单新建框（多表单依次展示），信息填写完成后自动保存到多个对应关联表单，并回填关联、赋值主表字段、完成状态流转</p>
        </>
      )}
    </div>
  );
}
