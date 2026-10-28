import {
  Bell, Briefcase, Building2, ChevronLeft, Copy, Flag, GitFork, Layers, Loader2, LogIn, MousePointerClick,
  Pencil, Play, Plus, Save, ShieldQuestion, Trash2, User, UserCheck, X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { GuideButton } from '@/components/common/GuideButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { CompositeDetailFields, ensureSystemFields } from '@/lib/field-catalog';
import { FLOW_GUIDE } from '@/lib/page-guides';
import { cn } from '@/lib/utils';
import type { Department, FlowSettings, MetaForm, MetaWorkflow, Profile, Role, RuleItem, WfBranch, WfCondGroup, WfCondRule, WfNode } from '@/types';
import FlowPropsCard from './props/FlowPropsCard';

const NODE_META: Record<WfNode['type'], { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  start: { label: '发起人', icon: LogIn, color: 'bg-muted text-foreground' },
  approval: { label: '审批节点', icon: UserCheck, color: 'bg-primary/10 text-primary' },
  fill: { label: '填写节点', icon: Pencil, color: 'bg-accent/10 text-accent' },
  condition: { label: '条件分支', icon: GitFork, color: 'bg-chart-2/10 text-chart-2' },
  parallel: { label: '并行网关', icon: Layers, color: 'bg-chart-3/10 text-chart-3' },
  cc: { label: '抄送节点', icon: Bell, color: 'bg-muted text-muted-foreground' },
  end: { label: '结束', icon: Flag, color: 'bg-muted text-muted-foreground' },
};

const MODE_LABEL = { or: '或签（任一人通过）', countersign: '会签（全部通过）', sequential: '依次审批' };
const APPROVER_TYPES = [
  { value: 'user', label: '指定成员' },
  { value: 'role', label: '指定角色' },
  { value: 'dept_leader', label: '部门主管' },
  { value: 'initiator_choice', label: '发起人自选' },
  { value: 'multi_level_leader', label: '连续多级主管' },
];

/** 填写节点：填写人类型（无需审批） */
const FILLER_TYPES = [
  { value: 'user', label: '指定成员' },
  { value: 'role', label: '指定角色' },
  { value: 'dept_leader', label: '部门主管' },
  { value: 'initiator', label: '发起人' },
];

/** 填写节点守卫操作符（与状态机守卫一致） */
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

/** 条件分支比较运算符 */
const COND_OPS: { value: WfCondRule['op']; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'empty', label: '为空' },
  { value: 'not_empty', label: '不为空' },
];

export default function FlowDesigner({ embedded }: { embedded?: boolean }) {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [form, setForm] = useState<MetaForm | null>(null);
  const [wf, setWf] = useState<MetaWorkflow | null>(null);
  const [nodes, setNodes] = useState<WfNode[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<WfNode | null>(null);
  /** 当前编辑节点所在分支 id（分支内子节点时非空） */
  const [editingBranch, setEditingBranch] = useState<string | null>(null);
  const [flowSettings, setFlowSettings] = useState<FlowSettings>({});
  const [propTab, setPropTab] = useState<'node' | 'flow'>('node');
  // 全部表单元数据：复合字段（关联子表/关联表单）明细展开时解析目标表单字段名
  const [allForms, setAllForms] = useState<Pick<MetaForm, 'id' | 'name' | 'schema_json'>[]>([]);

  const updFlowSettings = (patch: Partial<FlowSettings>) => setFlowSettings((prev) => ({ ...prev, ...patch }));

  // 流程可选字段：含系统字段（员工姓名/所属部门/职位/创建人/创建时间/更新人/更新时间/状态）
  const formFields = ensureSystemFields((form?.schema_json?.fields ?? []).filter((f) => !['section', 'row', 'action-button', 'wizard-step'].includes(f.type)));

  /** 统计任务节点（含分支内） */
  const countTasks = (ns: WfNode[]): number =>
    ns.reduce((acc, n) => {
      if (n.type === 'approval' || n.type === 'fill') return acc + 1;
      if (n.type === 'condition') return acc + (n.branches ?? []).reduce((a, b) => a + countTasks(b.nodes), 0);
      return acc;
    }, 0);

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    const [formRes, wfRes, pRes, rRes, dRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle(),
      supabase.from('meta_workflow').select('*').eq('form_id', formId).maybeSingle(),
      supabase.from('profiles').select('*').order('name'),
      supabase.from('roles').select('*').order('created_at'),
      supabase.from('departments').select('*').order('name'),
    ]);
    setForm(formRes.data as MetaForm | null);
    setAllForms((formRes.data as MetaForm | null) ? ((await supabase.from('meta_forms').select('id, name, schema_json').order('updated_at', { ascending: false })).data as Pick<MetaForm, 'id' | 'name' | 'schema_json'>[] ?? []) : []);
    const w = wfRes.data as MetaWorkflow | null;
    setWf(w);
    // 旧版发起人（并列名单）迁移为「类型 + 名单」结构
    const settings: FlowSettings = { ...(w?.settings ?? {}) };
    if (!settings.initiatorConfig && settings.initiators) {
      const ig = settings.initiators;
      if (ig.users?.length) settings.initiatorConfig = { type: 'user', value: ig.users };
      else if (ig.depts?.length) settings.initiatorConfig = { type: 'dept', value: ig.depts };
      else if (ig.roles?.length) settings.initiatorConfig = { type: 'role', value: ig.roles };
    }
    setFlowSettings(settings);
    if (w?.nodes) {
      // 旧版条件（单组硬编码示例）迁移为分支结构；填写节点由确认内容迁移为字段权限结构
      setNodes(w.nodes.map((n) => {
        if (n.type === 'condition' && !(n.branches ?? []).length) {
          const legacyGroups: WfCondGroup[] = (n.conditions ?? []).map((g) => ({
            logic: g.logic,
            rules: g.rules.map((r) => ({
              field: r.field,
              op: (r.op === 'in' || r.op === 'between' ? (r.op === 'in' ? 'eq' : 'gte') : r.op) as WfCondRule['op'],
              value: r.value,
            })),
          }));
          return { ...n, branches: [{ id: `br_${n.id}_1`, name: '分支 1', conditions: legacyGroups, nodes: [] }] };
        }
        if (n.type === 'fill' && !n.fieldPermissions && n.confirmFields) {
          return { ...n, fieldPermissions: Object.fromEntries(n.confirmFields.map((k) => [k, 'editable' as const])) };
        }
        return n;
      }));
    } else {
      setNodes([
        { id: 'n1', type: 'start', name: '发起人' },
        { id: 'n2', type: 'approval', name: '主管审批', approver_type: 'dept_leader', approver_value: [], mode: 'or' },
        { id: 'n3', type: 'end', name: '结束' },
      ]);
    }
    setProfiles((pRes.data as Profile[]) ?? []);
    setRoles((rRes.data as Role[]) ?? []);
    setDepartments((dRes.data as Department[]) ?? []);
    setLoading(false);
  }, [formId]);

  useEffect(() => {
    load();
  }, [load]);

  const insertAfter = (index: number, type: WfNode['type']) => {
    const id = `n_${Date.now().toString(36)}`;
    const meta = NODE_META[type];
    const node: WfNode = {
      id, type, name: meta.label,
      ...(type === 'approval' || type === 'fill' ? { approver_type: 'user' as const, approver_value: [], mode: 'or' as const } : {}),
      ...(type === 'cc' ? { cc_users: [] } : {}),
      ...(type === 'fill' ? { confirmFields: [] } : {}),
      ...(type === 'condition' ? { branches: [{ id: `br_${id}_1`, name: '分支 1', conditions: [], nodes: [] }] } : {}),
    };
    setNodes((s) => {
      // 插到 end 节点之前
      const n = [...s];
      const endIdx = n.findIndex((x) => x.type === 'end');
      n.splice(endIdx < 0 ? index + 1 : endIdx, 0, node);
      return n;
    });
    setEditing(node);
    setEditingBranch(null);
  };

  /** 向条件分支内添加子节点 */
  const insertIntoBranch = (condId: string, branchId: string, type: WfNode['type']) => {
    const id = `n_${Date.now().toString(36)}`;
    const meta = NODE_META[type];
    const node: WfNode = {
      id, type, name: meta.label,
      ...(type === 'approval' || type === 'fill' ? { approver_type: 'user' as const, approver_value: [], mode: 'or' as const } : {}),
      ...(type === 'cc' ? { cc_users: [] } : {}),
      ...(type === 'fill' ? { confirmFields: [] } : {}),
    };
    setNodes((s) => s.map((n) => (n.id === condId
      ? { ...n, branches: (n.branches ?? []).map((b) => (b.id === branchId ? { ...b, nodes: [...b.nodes, node] } : b)) }
      : n)));
    setEditing(node);
    setEditingBranch(branchId);
    setPropTab('node');
  };

  // 更新节点（顶层或分支内均可）
  const updNode = (id: string, patch: Partial<WfNode>) => {
    setNodes((s) => s.map((n) => {
      if (n.id === id) return { ...n, ...patch };
      if (n.type === 'condition') {
        return { ...n, branches: (n.branches ?? []).map((b) => ({ ...b, nodes: b.nodes.map((sn) => (sn.id === id ? { ...sn, ...patch } : sn)) })) };
      }
      return n;
    }));
    setEditing((e) => (e && e.id === id ? { ...e, ...patch } : e));
  };

  /** 填写节点守卫条件编辑（editing 为当前面板节点；与状态机守卫结构一致） */
  const updGuard = (gi: number, p: Partial<RuleItem>) => {
    if (!editing) return;
    updNode(editing.id, { guards: (editing.guards ?? []).map((g, i) => (i === gi ? { ...g, ...p } : g)) });
  };
  const delGuard = (gi: number) => {
    if (!editing) return;
    updNode(editing.id, { guards: (editing.guards ?? []).filter((_, i) => i !== gi) });
  };
  /** 递归剔除未选字段/未填值的守卫行（含分支内子节点），避免保存脏配置 */
  const cleanGuards = (list: WfNode[]): WfNode[] => list.map((n) => ({
    ...n,
    guards: (n.guards ?? []).filter((g) => g.field && g.value),
    branches: n.branches ? n.branches.map((b) => ({ ...b, nodes: cleanGuards(b.nodes ?? []) })) : n.branches,
  }));

  /** 更新条件节点的某个分支 */
  const updBranch = (condId: string, bi: number, patch: Partial<WfBranch>) => {
    const cond = nodes.find((n) => n.id === condId);
    if (!cond) return;
    updNode(condId, { branches: (cond.branches ?? []).map((b, i) => (i === bi ? { ...b, ...patch } : b)) });
  };

  /** 更新分支内某个条件组 */
  const updGroup = (condId: string, bi: number, gi: number, patch: Partial<WfCondGroup>) => {
    const branch = nodes.find((n) => n.id === condId)?.branches?.[bi];
    if (!branch) return;
    updBranch(condId, bi, { conditions: branch.conditions.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  };

  /** 更新条件组内某条规则 */
  const updRule = (condId: string, bi: number, gi: number, ri: number, patch: Partial<WfCondRule>) => {
    const group = nodes.find((n) => n.id === condId)?.branches?.[bi]?.conditions[gi];
    if (!group) return;
    updGroup(condId, bi, gi, { rules: group.rules.map((r, i) => (i === ri ? { ...r, ...patch } : r)) });
  };

  const removeNode = (id: string) => {
    const node = nodes.find((n) => n.id === id) ?? nodes.flatMap((n) => (n.type === 'condition' ? (n.branches ?? []).flatMap((b) => b.nodes) : [])).find((sn) => sn.id === id);
    if (!node) return;
    if (node.type === 'start' || node.type === 'end') return toast.error('开始与结束节点不可删除');
    setNodes((s) => s
      .filter((n) => n.id !== id)
      .map((n) => (n.type === 'condition' ? { ...n, branches: (n.branches ?? []).map((b) => ({ ...b, nodes: b.nodes.filter((sn) => sn.id !== id) })) } : n)));
    if (editing?.id === id) {
      setEditing(null);
      setEditingBranch(null);
    }
  };

  const save = async () => {
    if (!formId) return;
    if (countTasks(nodes) === 0) {
      return toast.error('至少需要一个审批或填写节点');
    }
    setSaving(true);
    const nextVersion = (wf?.version ?? 0) + 1;
    // 填写节点守卫条件：剔除未选字段/未填值的脏行后再持久化
    const payload = { tenant_id: tenantId, form_id: formId, name: `${form?.name ?? ''}审批流`, nodes: cleanGuards(nodes), version: nextVersion, settings: { ...flowSettings, initiators: undefined } };
    const { error, count } = await supabase.from('meta_workflow').upsert(payload, { onConflict: 'form_id', count: 'exact' });
    setSaving(false);
    if (error) return toast.error('保存失败：' + error.message);
    if ((count ?? 0) === 0) return toast.error('保存失败：无权限或表单不存在');
    // 乐观更新本地状态，避免 load() 竞态导致内容被重置
    setWf((prev) => ({
      id: prev?.id ?? '',
      tenant_id: tenantId,
      form_id: formId,
      name: payload.name,
      nodes,
      transitions: prev?.transitions ?? [],
      version: nextVersion,
      settings: flowSettings,
      updated_at: new Date().toISOString(),
    }));
    toast.success('流程已保存，提交单据时生效');
  };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!form) return <div className="p-8 text-center text-muted-foreground">表单不存在</div>;

  return (
    <div className={cn('flex flex-col', embedded ? 'h-full' : 'h-[calc(100vh-3.5rem)]')}>
      {/* 顶部栏 */}
      <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {!embedded && (
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/design/apps')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <span className="text-sm font-semibold truncate">{form.name} · 流程设计</span>
        </div>
        <div className="flex gap-2.5">
          <GuideButton label="流程设计" guide={FLOW_GUIDE} />
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}保存流程</Button>
        </div>
      </div>

      {/* 主体：画布 + 右侧面板 */}
      <div className="flex min-h-0 flex-1">
        {/* 画布：纵向节点流 */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-muted/30 p-6">
          <div className="mx-auto max-w-md">
            {nodes.map((n, i) => {
              const meta = NODE_META[n.type];
              const Icon = meta.icon;
              return (
                <div key={n.id}>
                  <div
                    onClick={() => n.type !== 'start' && n.type !== 'end' && (setEditing(n), setPropTab('node'))}
                    className={cn(
                      'group relative rounded-lg border px-4 py-3.5 transition-all',
                      editing?.id === n.id ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/40',
                      (n.type === 'start' || n.type === 'end') && 'mx-auto w-40 text-center cursor-default',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', meta.color)}>
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-medium truncate">{n.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {n.type === 'approval' && `${APPROVER_TYPES.find((t) => t.value === n.approver_type)?.label ?? ''} · ${MODE_LABEL[n.mode ?? 'or']}`}
                          {n.type === 'condition' && `${(n.branches ?? []).length} 个分支`}
                          {n.type === 'parallel' && '多分支同时执行'}
                          {n.type === 'cc' && `${n.cc_users?.length ?? 0} 位抄送人`}
                          {n.type === 'fill' && `${FILLER_TYPES.find((t) => t.value === n.approver_type)?.label ?? ''} · ${n.confirmFields?.length ?? 0} 个确认字段${n.guards?.length ? ` · ${n.guards.length} 条守卫` : ''}`}
                        </p>
                      </div>
                      {n.type !== 'start' && n.type !== 'end' && (
                        <span className="sig-row-actions inline-flex gap-1 shrink-0">
                          <button type="button" className="h-6 w-6 flex items-center justify-center rounded border border-border hover:bg-muted" onClick={(e) => { e.stopPropagation(); setEditing(n); setEditingBranch(null); setPropTab('node'); }}><Pencil className="h-3 w-3" /></button>
                          <button type="button" className="h-6 w-6 flex items-center justify-center rounded border border-border text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); removeNode(n.id); }}><Trash2 className="h-3 w-3" /></button>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 条件分支：多分支并排展示（分支内节点 + 添加入口） */}
                  {n.type === 'condition' && (n.branches ?? []).length > 0 && (
                    <div className="my-1.5 pt-1">
                      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${(n.branches ?? []).length}, minmax(0, 1fr))` }}>
                        {(n.branches ?? []).map((b) => (
                          <div key={b.id} className="rounded-lg border border-dashed border-border bg-card/70 p-2">
                            <div className="flex items-center gap-1.5 px-1 pb-2">
                              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded', NODE_META.condition.color)}><GitFork className="h-3 w-3" /></span>
                              <span className="text-xs font-medium truncate flex-1 min-w-0">{b.name}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">{b.conditions.length} 组</span>
                            </div>
                            <div className="space-y-1.5">
                              {b.nodes.map((sn) => {
                                const sm = NODE_META[sn.type];
                                const SI = sm.icon;
                                return (
                                  <div
                                    key={sn.id}
                                    onClick={() => { setEditing(sn); setEditingBranch(b.id); setPropTab('node'); }}
                                    className={cn('group cursor-pointer rounded-md border px-2 py-1.5 transition-colors', editing?.id === sn.id ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/40')}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded', sm.color)}><SI className="h-3 w-3" /></span>
                                      <span className="text-xs font-medium truncate flex-1 min-w-0">{sn.name}</span>
                                      <button type="button" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); removeNode(sn.id); }}><Trash2 className="h-2.5 w-2.5" /></button>
                                    </div>
                                  </div>
                                );
                              })}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button type="button" className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                                    <Plus className="h-3 w-3" />添加节点
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" align="start" className="w-32 p-1.5">
                                  <div className="flex flex-col gap-0.5">
                                    {(['approval', 'fill', 'cc'] as const).map((t) => {
                                      const m = NODE_META[t];
                                      const I = m.icon;
                                      return (
                                        <button key={t} type="button" className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted text-left" onClick={() => insertIntoBranch(n.id, b.id, t)}>
                                          <I className="h-3.5 w-3.5" />{m.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 连接线 + 添加按钮 */}
                  {i < nodes.length - 1 && (
                    <div className="flex flex-col items-center py-1">
                      <div className="h-5 w-px bg-border" />
                      <div className="relative flex h-7 items-center justify-center">
                        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" className="relative h-6 w-6 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors z-10">
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" align="center" className="w-36 p-1.5">
                            <div className="flex flex-col gap-0.5">
                              {(['approval', 'fill', 'condition', 'parallel', 'cc'] as const).map((t) => {
                                const m = NODE_META[t];
                                const I = m.icon;
                                return (
                                  <button key={t} type="button" className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted text-left" onClick={() => { insertAfter(i, t); setPropTab('node'); }}>
                                    <I className="h-3.5 w-3.5" />{m.label}
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="h-5 w-px bg-border" />
                    </div>
                  )}
                </div>
              );
            })}
            {nodes.length === 0 && (
              <div className="py-16 text-center text-sm text-muted-foreground">流程为空，点击下方添加节点</div>
            )}
          </div>
        </div>

        {/* 右侧面板（节点/流程属性配置区，加宽以容纳守卫条件等多列规则配置） */}
        <aside className="w-[26rem] shrink-0 overflow-y-auto border-l border-border bg-card">
          <div className="sticky top-0 z-10 bg-card">
            <Tabs value={propTab} onValueChange={(v) => setPropTab(v as 'node' | 'flow')}>
              <TabsList className="w-full rounded-none bg-transparent p-0">
                <TabsTrigger value="node" className="flex-1 rounded-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none">节点属性</TabsTrigger>
                <TabsTrigger value="flow" className="flex-1 rounded-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none">流程属性</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {propTab === 'node' ? (
            editing ? (
              <div className="space-y-4 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold flex items-center gap-2 min-w-0">
                    <span className="truncate">配置节点</span>
                    <Badge variant="outline" className="shrink-0">{NODE_META[editing.type].label}</Badge>
                    {editingBranch && <Badge variant="outline" className="shrink-0 text-[10px]">分支内</Badge>}
                  </p>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setEditing(null); setEditingBranch(null); }}><X className="h-4 w-4" /></Button>
                </div>

                <div className="space-y-2">
                  <Label>节点名称</Label>
                  <Input value={editing.name} onChange={(e) => updNode(editing.id, { name: e.target.value })} />
                </div>

                {editing.type === 'approval' && (
                  <>
                    <div className="space-y-2">
                      <Label>审批人设置</Label>
                      <Select value={editing.approver_type ?? 'user'} onValueChange={(v) => updNode(editing.id, { approver_type: v as WfNode['approver_type'], approver_value: [] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {APPROVER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {(editing.approver_type === 'user' || editing.approver_type === 'role') && (
                      <div className="space-y-2">
                        <Label>{editing.approver_type === 'user' ? '选择成员' : '选择角色'}</Label>
                        <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                          {editing.approver_type === 'user'
                            ? profiles.map((p) => (
                                <label key={p.id} className="flex min-h-9 items-center gap-2 text-sm rounded px-1.5 hover:bg-muted/50">
                                  <input type="checkbox" className="accent-primary" checked={(editing.approver_value ?? []).includes(p.id)} onChange={(e) => updNode(editing.id, { approver_value: e.target.checked ? [...(editing.approver_value ?? []), p.id] : (editing.approver_value ?? []).filter((x) => x !== p.id) })} />
                                  <User className="h-3.5 w-3.5 text-muted-foreground" />{p.name}
                                  <span className="text-xs text-muted-foreground">{p.position}</span>
                                </label>
                              ))
                            : roles.map((r) => (
                                <label key={r.id} className="flex min-h-9 items-center gap-2 text-sm rounded px-1.5 hover:bg-muted/50">
                                  <input type="checkbox" className="accent-primary" checked={(editing.approver_value ?? []).includes(r.id)} onChange={(e) => updNode(editing.id, { approver_value: e.target.checked ? [...(editing.approver_value ?? []), r.id] : (editing.approver_value ?? []).filter((x) => x !== r.id) })} />
                                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />{r.name}
                                </label>
                              ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>审批模式</Label>
                      <Select value={editing.mode ?? 'or'} onValueChange={(v) => updNode(editing.id, { mode: v as WfNode['mode'] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="or">或签 · 任一人通过</SelectItem>
                          <SelectItem value="countersign">会签 · 全部通过</SelectItem>
                          <SelectItem value="sequential">依次审批</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>字段权限</Label>
                      <p className="text-[11px] text-muted-foreground">设置本节点对表单字段的查看与编辑权限</p>
                      <div className="space-y-1.5">
                        {formFields.map((f) => {
                          const perm = editing.fieldPermissions?.[f.key] ?? 'visible';
                          return (
                            <div key={f.key}>
                              <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                                <span className="flex-1 min-w-0 truncate text-xs text-foreground">{f.label}</span>
                                {f.system && <Badge variant="outline" className="shrink-0 text-[9px]">系统</Badge>}
                                <div className="flex shrink-0 gap-1">
                                  {(['visible', 'editable', 'hidden'] as const).map((p) => (
                                    <button
                                      key={p}
                                      type="button"
                                      onClick={() => updNode(editing.id, { fieldPermissions: { ...(editing.fieldPermissions ?? {}), [f.key]: p } })}
                                      className={cn('h-6 rounded border px-2 text-[10px] transition-colors', perm === p ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                                    >
                                      {p === 'visible' ? '可见' : p === 'editable' ? '可编辑' : '隐藏'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <CompositeDetailFields field={f} forms={allForms} />
                            </div>
                          );
                        })}
                        {formFields.length === 0 && <p className="text-[11px] text-muted-foreground">暂无表单字段</p>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>节点操作</Label>
                      <div className="flex gap-1.5">
                        {([['approve', '同意'], ['reject', '驳回']] as const).map(([key, label]) => {
                          const on = editing.operations?.[key] ?? true;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => updNode(editing.id, { operations: { approve: key === 'approve' ? !on : (editing.operations?.approve ?? true), reject: key === 'reject' ? !on : (editing.operations?.reject ?? true), rejectTo: editing.operations?.rejectTo ?? 'initiator' } })}
                              className={cn('flex-1 h-8 rounded-md border text-xs transition-colors', on ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                            >
                              {label}{on ? '' : '（已禁用）'}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-muted-foreground">驳回时系统将强制要求填写驳回理由</p>
                      <div className="space-y-1.5">
                        <Label className="text-xs">驳回至</Label>
                        <Select value={editing.operations?.rejectTo ?? 'initiator'} onValueChange={(v) => updNode(editing.id, { operations: { approve: editing.operations?.approve ?? true, reject: editing.operations?.reject ?? true, rejectTo: v as 'initiator' | 'prev' } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="initiator">发起人</SelectItem>
                            <SelectItem value="prev">上一节点</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}

                {editing.type === 'fill' && (
                  <>
                    <div className="space-y-2">
                      <Label>填写人</Label>
                      <p className="text-[11px] text-muted-foreground">填写节点无需审批，由填写人补充确认内容后流转下一节点</p>
                      <Select value={editing.approver_type ?? 'user'} onValueChange={(v) => updNode(editing.id, { approver_type: v as WfNode['approver_type'], approver_value: [] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FILLER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {(editing.approver_type === 'user' || editing.approver_type === 'role') && (
                      <div className="space-y-2">
                        <Label>{editing.approver_type === 'user' ? '选择成员' : '选择角色'}</Label>
                        <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                          {editing.approver_type === 'user'
                            ? profiles.map((p) => (
                                <label key={p.id} className="flex min-h-9 items-center gap-2 text-sm rounded px-1.5 hover:bg-muted/50">
                                  <input type="checkbox" className="accent-primary" checked={(editing.approver_value ?? []).includes(p.id)} onChange={(e) => updNode(editing.id, { approver_value: e.target.checked ? [...(editing.approver_value ?? []), p.id] : (editing.approver_value ?? []).filter((x) => x !== p.id) })} />
                                  <User className="h-3.5 w-3.5 text-muted-foreground" />{p.name}
                                  <span className="text-xs text-muted-foreground">{p.position}</span>
                                </label>
                              ))
                            : roles.map((r) => (
                                <label key={r.id} className="flex min-h-9 items-center gap-2 text-sm rounded px-1.5 hover:bg-muted/50">
                                  <input type="checkbox" className="accent-primary" checked={(editing.approver_value ?? []).includes(r.id)} onChange={(e) => updNode(editing.id, { approver_value: e.target.checked ? [...(editing.approver_value ?? []), r.id] : (editing.approver_value ?? []).filter((x) => x !== r.id) })} />
                                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />{r.name}
                                </label>
                              ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>字段权限</Label>
                      <p className="text-[11px] text-muted-foreground">与其他节点一致的字段权限；标记「可编辑」的字段即填写人可补充确认的内容，业务列表操作列会出现以本节点名称命名的按钮</p>
                      <div className="space-y-1.5">
                        {formFields.map((f) => {
                          const perm = editing.fieldPermissions?.[f.key] ?? 'visible';
                          return (
                            <div key={f.key}>
                              <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                                <span className="flex-1 min-w-0 truncate text-xs text-foreground">{f.label}</span>
                                {f.system && <Badge variant="outline" className="shrink-0 text-[9px]">系统</Badge>}
                                <div className="flex shrink-0 gap-1">
                                  {(['visible', 'editable', 'hidden'] as const).map((p) => (
                                    <button
                                      key={p}
                                      type="button"
                                      onClick={() => {
                                        const perms = { ...(editing.fieldPermissions ?? {}), [f.key]: p };
                                        // 同步确认内容：可编辑字段即确认字段（保持后端 confirm_fields 契约不变）
                                        updNode(editing.id, {
                                          fieldPermissions: perms,
                                          confirmFields: Object.entries(perms).filter(([, v]) => v === 'editable').map(([k]) => k),
                                        });
                                      }}
                                      className={cn('h-6 rounded border px-2 text-[10px] transition-colors', perm === p ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                                    >
                                      {p === 'visible' ? '可见' : p === 'editable' ? '可编辑' : '隐藏'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <CompositeDetailFields field={f} forms={allForms} />
                            </div>
                          );
                        })}
                        {formFields.length === 0 && <p className="text-[11px] text-muted-foreground">暂无表单字段</p>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>确认内容</Label>
                      <p className="text-[11px] text-muted-foreground">
                        由字段权限自动同步：{(() => {
                          const editable = formFields.filter((f) => editing.fieldPermissions?.[f.key] === 'editable').map((f) => f.label);
                          return editable.length > 0 ? editable.join('、') : '尚未设置可编辑字段';
                        })()}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>需确定内容</Label>
                      <p className="text-[11px] text-muted-foreground">选择填写人需要确认/补充的字段，这些字段将在销假等填写弹框的「需确定内容」区按字段权限（只读/可编辑）展示</p>
                      <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                        {formFields.map((f) => {
                          const checked = (editing.confirmFields ?? []).includes(f.key);
                          return (
                            <div key={f.key}>
                              <label className="flex min-h-9 items-center gap-2 text-sm rounded px-1.5 hover:bg-muted/50">
                                <input
                                  type="checkbox"
                                  className="accent-primary"
                                  checked={checked}
                                  onChange={(e) => updNode(editing.id, { confirmFields: e.target.checked ? [...(editing.confirmFields ?? []), f.key] : (editing.confirmFields ?? []).filter((x) => x !== f.key) })}
                                />
                                <span className="flex-1 min-w-0 truncate">{f.label}</span>
                                {f.system && <Badge variant="outline" className="shrink-0 text-[9px]">系统</Badge>}
                              </label>
                              <CompositeDetailFields field={f} forms={allForms} />
                            </div>
                          );
                        })}
                        {formFields.length === 0 && <p className="text-[11px] text-muted-foreground">暂无表单字段</p>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>守卫条件</Label>
                      <p className="text-[11px] text-muted-foreground">填写人提交时逐条校验（与状态机守卫一致），全部满足才能流转到下一节点；右值可选「设定值」或「当前表字段」做字段间比较</p>
                      <div className="space-y-1.5">
                        {(editing.guards ?? []).map((g, gi) => (
                          <div key={gi} className="flex items-center gap-2">
                            <Select value={g.field || 'none'} onValueChange={(v) => updGuard(gi, { field: v === 'none' ? '' : v })}>
                              <SelectTrigger className="h-8 flex-1 min-w-0 text-xs"><SelectValue placeholder="选择字段" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">未选择</SelectItem>
                                {formFields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Select value={g.op} onValueChange={(v) => updGuard(gi, { op: v as RuleItem['op'] })}>
                              <SelectTrigger className="h-8 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>{GUARD_OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <Select value={g.value_type ?? 'value'} onValueChange={(v) => updGuard(gi, { value_type: v as 'value' | 'field', value: v === 'field' ? '' : g.value })}>
                              <SelectTrigger className="h-8 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="value">设定值</SelectItem>
                                <SelectItem value="field">当前表字段</SelectItem>
                              </SelectContent>
                            </Select>
                            {(g.value_type ?? 'value') === 'field' ? (
                              <Select value={g.value || 'none'} onValueChange={(v) => updGuard(gi, { value: v === 'none' ? '' : v })}>
                                <SelectTrigger className="h-8 flex-1 min-w-0 text-xs"><SelectValue placeholder="选择比较字段" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">未选择</SelectItem>
                                  {formFields.filter((f) => f.key !== g.field).map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input className="h-8 flex-1 min-w-0 text-xs" placeholder="比较值" value={g.value} onChange={(e) => updGuard(gi, { value: e.target.value })} />
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10" onClick={() => delGuard(gi)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        ))}
                        {(editing.guards ?? []).length === 0 && <p className="text-[11px] text-muted-foreground py-2 text-center">暂无守卫条件，提交时不校验直接流转</p>}
                      </div>
                      <Button variant="outline" size="sm" className="w-full" onClick={() => updNode(editing.id, { guards: [...(editing.guards ?? []), { field: '', op: 'eq', value: '', value_type: 'value' }] })}>
                        <Plus className="h-3.5 w-3.5" />添加条件
                      </Button>
                    </div>
                  </>
                )}

                {editing.type === 'cc' && (
                  <div className="space-y-2">
                    <Label>抄送人</Label>
                    <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                      {profiles.map((p) => (
                        <label key={p.id} className="flex min-h-9 items-center gap-2 text-sm rounded px-1.5 hover:bg-muted/50">
                          <input type="checkbox" className="accent-primary" checked={(editing.cc_users ?? []).includes(p.id)} onChange={(e) => updNode(editing.id, { cc_users: e.target.checked ? [...(editing.cc_users ?? []), p.id] : (editing.cc_users ?? []).filter((x) => x !== p.id) })} />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {editing.type === 'condition' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>分支设置</Label>
                      <p className="text-[11px] text-muted-foreground">流转到本节点时依序判断分支条件（分支内条件组须全部满足），命中即走该分支；都不满足时走第一个分支</p>
                    </div>
                    {(editing.branches ?? []).map((b, bi) => (
                      <div key={b.id} className="space-y-2 rounded-md border border-border p-2.5">
                        <div className="flex items-center gap-1.5">
                          <Input value={b.name} className="h-7 flex-1 min-w-0 text-xs" placeholder="分支名称" onChange={(e) => updBranch(editing.id, bi, { name: e.target.value })} />
                          <span className="shrink-0 text-[10px] text-muted-foreground">{b.nodes.length} 节点</span>
                          <button type="button" className="shrink-0 text-[11px] text-destructive hover:underline" onClick={() => updNode(editing.id, { branches: (editing.branches ?? []).filter((_, i) => i !== bi) })}>删除分支</button>
                        </div>
                        {b.conditions.map((g, gi) => (
                          <div key={gi} className="space-y-1.5 rounded border border-border/70 bg-muted/30 p-2">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="shrink-0">条件组 {gi + 1}</span>
                              <div className="flex shrink-0 overflow-hidden rounded border border-border">
                                {(['and', 'or'] as const).map((l) => (
                                  <button key={l} type="button" className={cn('px-1.5 py-0.5', g.logic === l ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')} onClick={() => updGroup(editing.id, bi, gi, { logic: l })}>
                                    {l === 'and' ? '且' : '或'}
                                  </button>
                                ))}
                              </div>
                              <button type="button" className="ml-auto shrink-0 text-destructive hover:underline" onClick={() => updBranch(editing.id, bi, { conditions: b.conditions.filter((_, i) => i !== gi) })}>删除组</button>
                            </div>
                            {g.rules.map((r, ri) => (
                              <div key={ri} className="flex items-center gap-1">
                                <Select value={r.field} onValueChange={(v) => updRule(editing.id, bi, gi, ri, { field: v })}>
                                  <SelectTrigger className="h-7 min-w-0 flex-1 text-xs"><SelectValue placeholder="选择字段" /></SelectTrigger>
                                  <SelectContent>
                                    {formFields.map((f) => <SelectItem key={f.key} value={f.key} className="text-xs">{f.label}{f.system ? '（系统）' : ''}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <Select value={r.op} onValueChange={(v) => updRule(editing.id, bi, gi, ri, { op: v as WfCondRule['op'] })}>
                                  <SelectTrigger className="h-7 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {COND_OPS.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                {r.op === 'empty' || r.op === 'not_empty' ? (
                                  <span className="h-7 w-24 shrink-0" />
                                ) : (
                                  <Input value={r.value} className="h-7 w-24 shrink-0 text-xs" placeholder="比较值" onChange={(e) => updRule(editing.id, bi, gi, ri, { value: e.target.value })} />
                                )}
                                <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border text-destructive hover:bg-destructive/10" onClick={() => updGroup(editing.id, bi, gi, { rules: g.rules.filter((_, i) => i !== ri) })}>
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                            <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={() => updGroup(editing.id, bi, gi, { rules: [...g.rules, { field: formFields[0]?.key ?? '', op: 'eq', value: '' }] })}>
                              <Plus className="mr-1 h-3 w-3" />添加条件
                            </Button>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={() => updBranch(editing.id, bi, { conditions: [...b.conditions, { logic: 'and', rules: [{ field: formFields[0]?.key ?? '', op: 'eq', value: '' }] }] })}>
                          <Plus className="mr-1 h-3 w-3" />添加条件组
                        </Button>
                        <p className="text-[11px] text-muted-foreground">分支内节点：在左侧画布该分支下点击「添加节点」</p>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" className="w-full" onClick={() => updNode(editing.id, { branches: [...(editing.branches ?? []), { id: `br_${Date.now().toString(36)}`, name: `分支 ${(editing.branches ?? []).length + 1}`, conditions: [], nodes: [] }] })}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />添加分支
                    </Button>
                  </div>
                )}

                {editing.type === 'parallel' && (
                  <p className="text-xs text-muted-foreground rounded-md bg-muted/50 p-3">并行网关：同时执行前后所有审批节点，全部完成后进入下一节点。</p>
                )}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <MousePointerClick className="h-5 w-5" />
                  <span>点击画布中的节点查看属性</span>
                </div>
              </div>
            )
          ) : (
            <FlowPropsCard settings={flowSettings} onChange={updFlowSettings} members={profiles} departments={departments} roles={roles} />
          )}
        </aside>
      </div>

      {/* 节点配置已迁移至右侧「节点属性」面板 */}
    </div>
  );
}
