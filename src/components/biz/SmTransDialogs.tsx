/**
 * 状态机流转交互弹窗：人员分配 / 内容提交 / 内容确定
 * 由列表按钮（SM_TRANSITION 动作）触发，按转换规则的 interaction 配置渲染对应交互，
 * 完成后统一调用 change_biz_status RPC 写负责人（多人分配）并流转。
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import type { BizData, FormField, SmTransition } from '@/types';
import { validateField } from '@/lib/field-catalog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { Loader2, Users, ClipboardList, CheckCircle2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FillFieldEditor, fmtFieldVal } from './BizDetailDialog';
import { SubTableEditor, SubTableViewer, persistSubTableFields, subTableValidateValue } from '@/components/biz/SubTableEditor';
import { FormRefEditor, FormRefViewer, materializeInlineRefs } from '@/components/biz/FormRefEditor';

interface Member { id: string; name: string; position?: string | null }
const GROUP_PLACEHOLDER: Record<'dept' | 'role', string> = { dept: '选择部门', role: '选择角色' };
/** 新增关联表单弹窗中不渲染的布局类字段 */
const SM_LAYOUT = ['group-title', 'grid', 'divider', 'description', 'wizard-step'];

export function SmTransDialog({ open, transition, row, successText, onClose, onDone }: {
  open: boolean;
  transition: SmTransition | null;
  row: BizData | null;
  /** 动作配置的成功提示（优先于 RPC 返回消息） */
  successText?: string | null;
  onClose: () => void;
  /** 流转成功后的回调（外层刷新数据） */
  onDone: () => void;
}) {
  const inter = transition?.interaction;
  const [fields, setFields] = useState<FormField[]>([]);
  const [busy, setBusy] = useState(false);
  // 人员分配：分组（部门/角色）→ 成员模糊搜索多选
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [groupId, setGroupId] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selUsers, setSelUsers] = useState<string[]>([]);
  // 内容提交：字段草稿（初始值取单据现有数据）
  const [patch, setPatch] = useState<Record<string, unknown>>({});
  // 新增关联表单：各目标表单字段与名称（按表单 id 分组，渲染内嵌新建框）
  const [relForms, setRelForms] = useState<Record<string, { name: string; fields: FormField[] }>>({});
  // 目标表单的状态机状态映射（system-status 下拉选项）与部门列表（dept-select 下拉选项）
  const [relSmStates, setRelSmStates] = useState<Map<string, Map<string, { label: string; color?: string }>>>(new Map());
  const [relDepts, setRelDepts] = useState<{ id: string; name: string }[]>([]);
  // 目标表单列表（兼容历史单表单 targetFormId）
  const targetFormIds: string[] = inter?.type === 'new_related_form'
    ? (inter.newRelated?.targetFormIds?.length ? inter.newRelated.targetFormIds : inter.newRelated?.targetFormId ? [inter.newRelated.targetFormId] : [])
    : [];

  useEffect(() => {
    if (!open || !transition || !row) return;
    setSelUsers([]); setGroupId(''); setMembers([]); setRelForms({});
    // 用主表当前值初始化 patch：同时把 fieldMappings 中 mainKey 的值写入 targetKey，
    // 使目标表单的映射字段输入框自动回显主表对应值（如 公司名称 → 客户名称）
    const initPatch = { ...((row?.payload ?? {}) as Record<string, unknown>) };
    for (const m of inter?.newRelated?.fieldMappings ?? []) {
      if (!m.mainKey || !m.targetKey) continue;
      const v = initPatch[m.mainKey];
      if (v !== undefined && v !== null && v !== '' && (initPatch[m.targetKey] === undefined || initPatch[m.targetKey] === null || initPatch[m.targetKey] === '')) {
        initPatch[m.targetKey] = v;
      }
    }
    setPatch(initPatch);
    // 加载表单字段：内容提交/确定渲染所需，人员分配弹窗兜底
    void supabase.from('meta_forms').select('name, schema_json').eq('id', row.form_id).maybeSingle().then(({ data }) => {
      setFields(((data as { schema_json?: { fields?: FormField[] } } | null)?.schema_json?.fields ?? []) as FormField[]);
    });
    // 新增关联表单：加载各目标表单字段用于内嵌新建框（多表单：一张弹窗内依次展示）
    if (inter?.type === 'new_related_form' && targetFormIds.length > 0) {
      void supabase.from('meta_forms').select('id, name, schema_json').in('id', targetFormIds).then(({ data }) => {
        const map: Record<string, { name: string; fields: FormField[] }> = {};
        ((data as { id?: string; name?: string; schema_json?: { fields?: FormField[] } }[] | null) ?? []).forEach((d) => {
          if (!d.id) return;
          map[d.id] = { name: d.name ?? '', fields: (d.schema_json?.fields ?? []) as FormField[] };
        });
        setRelForms(map);
      });
      // 加载各目标表单的状态机状态（system-status 字段下拉选项）
      void supabase.from('meta_state_machine').select('form_id, states').in('form_id', targetFormIds).then(({ data }) => {
        const m = new Map<string, Map<string, { label: string; color?: string }>>();
        ((data as { form_id?: string; states?: Record<string, { label?: string; color?: string }> }[] | null) ?? []).forEach((d) => {
          if (!d.form_id) return;
          const inner = new Map<string, { label: string; color?: string }>();
          Object.entries(d.states ?? {}).forEach(([k, v]) => inner.set(k, { label: v.label ?? k, color: v.color }));
          m.set(d.form_id, inner);
        });
        setRelSmStates(m);
      });
      // 加载部门列表（dept-select 字段下拉选项）
      void supabase.from('departments').select('id, name').order('sort_order').then(({ data }) => {
        setRelDepts((data as { id: string; name: string }[]) ?? []);
      });
    }
    if (inter?.type === 'assign') {
      const q = inter.assignBy === 'dept'
        ? supabase.from('departments').select('id, name').order('name')
        : supabase.from('roles').select('id, name').order('name');
      void q.then(({ data }) => setGroups((data as { id: string; name: string }[]) ?? []));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transition, row, inter?.type, inter?.assignBy, targetFormIds.join(',')]);

  // 选择部门/角色后加载可选成员
  const loadMembers = async (gid: string) => {
    setGroupId(gid); setSelUsers([]); setMembersLoading(true);
    try {
      if (inter?.assignBy === 'role') {
        const { data } = await supabase.from('user_roles').select('user_id').eq('role_id', gid);
        const ids = ((data as { user_id: string }[] | null) ?? []).map((x) => x.user_id);
        if (ids.length === 0) { setMembers([]); return; }
        const { data: profs } = await supabase.from('profiles').select('id, name, position').in('id', ids).order('name');
        setMembers((profs as Member[]) ?? []);
      } else {
        const { data } = await supabase.from('profiles').select('id, name, position').eq('department_id', gid).order('name');
        setMembers((data as Member[]) ?? []);
      }
    } finally { setMembersLoading(false); }
  };

  // 统一流转入口：内容提交带字段映射、人员分配带多人名单
  const run = async (mappings: Record<string, unknown>, assignees?: string[]) => {
    if (!transition || !row) return;
    setBusy(true);
    let finalMappings = { ...mappings };
    // 包含关联子表字段时：先持久化明细行（主表 payload 保存行 id 数组；随主表保存模式内嵌物化）
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? '';
      const { data: me } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
      finalMappings = await persistSubTableFields(fields, finalMappings, {
        tenantId: (me as { tenant_id?: string } | null)?.tenant_id ?? '',
        userId: uid,
      });
      finalMappings = await materializeInlineRefs(fields, finalMappings);
    } catch (e) {
      setBusy(false);
      return toast.error(e instanceof Error ? e.message : '子表明细保存失败');
    }

    const { data, error } = await supabase.rpc('change_biz_status', {
      p_biz_id: row.id, p_event: transition.event, p_mappings: finalMappings,
      ...(assignees ? { p_assignees: assignees } : {}),
    });
    setBusy(false);
    if (error) return toast.error('流转失败：' + error.message);
    toast.success(successText ?? ((data as { message?: string })?.message ?? '状态已流转'));
    onDone(); onClose();
  };

  const submit = () => {
    // 内容提交：按字段校验规则校验所选提交字段
    for (const k of inter?.fields ?? []) {
      const f = fields.find((x) => x.key === k);
      if (!f) continue;
      const val = f.type === 'sub-table' ? subTableValidateValue(patch[k] !== undefined ? patch[k] : (row?.payload?.[k] ?? null)) : (patch[k] !== undefined ? patch[k] : (row?.payload?.[k] ?? null));
      const err = validateField(f, val);
      if (err) return toast.error(`${f.label}：${err}`);
    }
    // 合并初始值与编辑草稿
    const mergedPatch: Record<string, unknown> = {};
    (inter?.fields ?? []).forEach((k) => {
      mergedPatch[k] = patch[k] !== undefined ? patch[k] : (row?.payload?.[k] ?? null);
    });
    void run(mergedPatch);
  };

  // 新增关联表单：校验并创建全部目标表单记录 → 逐个回填关联 ID + 按映射赋值主表 → 统一状态流转
  const submitNewRelated = async () => {
    if (!transition || !row || !inter?.newRelated) return;
    const nr = inter.newRelated;
    // 兼容历史单表单数据
    const legacyId = nr.targetFormId ?? '';
    const ids: string[] = nr.targetFormIds?.length ? nr.targetFormIds : legacyId ? [legacyId] : [];
    if (ids.length === 0) return toast.error('未配置目标表单');
    const backfillFields = nr.backfillFields ?? {};
    // 校验全部目标表单的必填字段（每张表单的必填字段都需填写）；渲染层展示所有字段
    const allEditable: { formId: string; fields: FormField[] }[] = [];
    for (const tid of ids) {
      const rf = relForms[tid];
      if (!rf) return toast.error('目标表单字段加载中，请稍后');
      const editable = rf.fields.filter((f) => !f.system && !SM_LAYOUT.includes(f.type));
      for (const f of editable.filter((x) => x.required)) {
        const val = patch[f.key] !== undefined ? patch[f.key] : null;
        const err = validateField(f, f.type === 'sub-table' ? subTableValidateValue(val) : val);
        if (err) return toast.error(`【${rf.name}】${f.label}：${err}`);
      }
      allEditable.push({ formId: tid, fields: editable });
    }
    setBusy(true);
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? '';
      const { data: me } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
      const tenantId = (me as { tenant_id?: string } | null)?.tenant_id ?? '';
      const createdIds: Record<string, string> = {};
      // 依次创建各目标表单记录；form-ref/search-select 映射字段在来源表单创建后立即回填关联 ID
      let livePatch = { ...patch };
      for (const tid of ids) {
        const rf = relForms[tid];
        // 映射目标 key 在 livePatch 中没有值时，从主表行 payload 的 mainKey 兜底填入
        let payload = { ...livePatch };
        for (const m of nr.fieldMappings ?? []) {
          if (!m.mainKey || !m.targetKey) continue;
          if (payload[m.targetKey] === undefined || payload[m.targetKey] === null || payload[m.targetKey] === '') {
            const fallback = livePatch[m.mainKey] !== undefined && livePatch[m.mainKey] !== null && livePatch[m.mainKey] !== ''
              ? livePatch[m.mainKey]
              : (row.payload ?? {})[m.mainKey];
            if (fallback !== undefined && fallback !== null && fallback !== '') payload[m.targetKey] = fallback;
          }
        }
        payload = await persistSubTableFields(rf.fields, payload, { tenantId, userId: uid });
        payload = await materializeInlineRefs(rf.fields, payload);
        const firstKey = allEditable.find((x) => x.formId === tid)?.fields[0]?.key;
        const { data: newBiz, error } = await supabase.rpc('submit_biz', {
          p_form_id: tid,
          p_payload: payload,
          p_title: (payload[firstKey ?? ''] as string) ?? rf.name ?? '关联记录',
          p_amount: typeof payload.amount === 'number' ? payload.amount : null,
          p_submit: true,
        });
        if (error) throw new Error(`创建「${rf.name}」关联记录失败：` + error.message);
        const newId = (newBiz as { id?: string } | null)?.id;
        if (!newId) throw new Error(`创建「${rf.name}」关联记录失败：未返回记录 ID`);
        createdIds[tid] = newId;
        // 本表单创建完成后：把「mainKey 是本表单字段」的 form-ref/search-select 映射 targetKey 写入 livePatch
        // （如 销售机会.ke_hu_ming_cheng ← 客户管理.field_9：field_9 属于客户管理，创建后把客户管理记录 ID 写入）
        for (const m of nr.fieldMappings ?? []) {
          if (!m.mainKey || !m.targetKey) continue;
          const isLinkedField = ids.some((x) => relForms[x]?.fields.some((f) => {
            if (f.key !== m.targetKey) return false;
            if (f.type === 'form-ref') return true;
            return !!f.optionSource?.formId && ids.includes(f.optionSource.formId);
          }));
          if (!isLinkedField) continue;
          if (rf.fields.some((f) => f.key === m.mainKey)) {
            const cur = livePatch[m.targetKey];
            if (cur === undefined || cur === null || cur === '') {
              livePatch = { ...livePatch, [m.targetKey]: newId };
            }
          }
        }
      }
      // 2) 逐个回填关联 ID 到主表 backfillFields（每张表单独立回填字段），并收集赋值映射来源记录
      const src = (row.payload ?? {}) as Record<string, unknown>;
      const mappings = nr.fieldMappings ?? [];
      const mapSources: Record<string, { title: string; payload: Record<string, unknown> }> = {};
      for (const tid of ids) {
        const newId = createdIds[tid];
        const bf = backfillFields[tid] ?? '';
        if (bf && newId) {
          const cur = Array.isArray(src[bf]) ? (src[bf] as string[]) : [];
          if (!cur.includes(newId)) src[bf] = [...cur, newId];
        }
        if (mappings.length > 0) {
          const { data: newRow } = await supabase.from('biz_data').select('title, payload').eq('id', newId).maybeSingle();
          if (newRow) mapSources[tid] = { title: (newRow as { title: string }).title, payload: ((newRow as { payload: Record<string, unknown> | null }).payload ?? {}) };
        }
      }
      // 3) 按映射把目标记录字段值写入主表字段（后创建表单的映射覆盖先创建的）
      // 映射源值兜底：payload 里没有时尝试主表行自身（同名字段直接沿用）
      let mapPatch: Record<string, unknown> = {};
      for (const tid of ids) {
        const srcRow = mapSources[tid];
        if (!srcRow) continue;
        for (const m of mappings) {
          if (!m.mainKey || !m.targetKey) continue;
          let v = m.targetKey === 'title' ? srcRow.title : srcRow.payload[m.targetKey];
          if ((v === undefined || v === null) && m.targetKey in src) v = src[m.targetKey];
          if (v !== undefined && v !== null) mapPatch[m.mainKey] = v;
        }
      }
      const { error: linkErr } = await supabase.from('biz_data').update({
        payload: { ...src, ...mapPatch },
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      if (linkErr) throw new Error('关联回填失败：' + linkErr.message);
      // 4) 全部创建与回填成功后再驱动状态流转
      const { data, error: se } = await supabase.rpc('change_biz_status', { p_biz_id: row.id, p_event: transition.event, p_mappings: {} });
      setBusy(false);
      if (se) return toast.error('关联已创建，但流转失败：' + se.message);
      toast.success(successText ?? ((data as { message?: string })?.message ?? '已创建关联记录并完成流转'));
      onDone(); onClose();
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : '创建关联记录失败');
    }
  };

  const titleSuffix = inter?.type === 'assign' ? '人员分配' : inter?.type === 'submit' ? '内容提交' : inter?.type === 'new_related_form' ? '新增关联表单' : inter?.type === 'none' ? '流转确认' : '内容确认';
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg h-[600px] p-0 flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-3 shrink-0">
          <div className="flex items-center gap-2 text-base font-semibold">
            {inter?.type === 'assign' ? <Users className="h-4 w-4" /> : inter?.type === 'submit' ? <ClipboardList className="h-4 w-4" /> : inter?.type === 'new_related_form' ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {transition?.event ?? '流转'} · {titleSuffix}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-3 space-y-3">

        {inter?.type === 'assign' && (
          <div className="space-y-3" key="assign">
            <div className="space-y-1.5">
              <Label className="text-xs">分配范围（{inter.assignBy === 'dept' ? '部门' : '角色'}）</Label>
              <Select value={groupId || 'none'} onValueChange={(v) => v === 'none' ? undefined : void loadMembers(v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={GROUP_PLACEHOLDER[inter.assignBy ?? 'dept']} /></SelectTrigger>
                <SelectContent>
                  {groups.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无可选{GROUP_PLACEHOLDER[inter.assignBy ?? 'dept'].slice(2)}</p>}
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">选择人员（可搜索，支持多选）</Label>
                {selUsers.length > 0 && <Badge className="bg-primary/10 text-primary hover:bg-primary/10">已选 {selUsers.length} 人</Badge>}
              </div>
              {membersLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-md border border-border py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在加载成员…</div>
              ) : groupId ? (
                <Command className="rounded-md border border-border">
                  <CommandInput placeholder="搜索姓名…" />
                  <CommandList className="max-h-56">
                    <CommandEmpty>未找到匹配人员</CommandEmpty>
                    {(m => m.map((u) => (
                      <CommandItem key={u.id} value={`${u.name} ${u.position ?? ''}`} onSelect={() => setSelUsers((s) => s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id])}>
                        <Checkbox checked={selUsers.includes(u.id)} className="pointer-events-none" />
                        <span className="text-sm">{u.name}</span>
                        {u.position && <span className="text-[10px] text-muted-foreground">{u.position}</span>}
                      </CommandItem>
                    )))(members)}
                  </CommandList>
                </Command>
              ) : (
                <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">请先选择{GROUP_PLACEHOLDER[inter.assignBy ?? 'dept'].slice(2)}后挑选人员</p>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">确定后写入单据负责人（多人时首位为当前处理人）并向所选人员推送待办通知，随后完成状态流转</p>
          </div>
        )}

        {inter?.type === 'submit' && (
          <div className="space-y-4" key="submit">
            {(inter.fields ?? []).map((k) => {
              const f = fields.find((x) => x.key === k);
              if (!f) return null;
              const val = patch[k] !== undefined ? patch[k] : (row?.payload?.[k] ?? null);
              if (f.type === 'sub-table') {
                return (
                  <div key={k} className="space-y-1.5 border rounded-md p-3 bg-muted/20">
                    <Label className="text-sm font-semibold">{f.label}{f.required ? ' *' : ''}</Label>
                    <SubTableEditor field={f} value={val} onChange={(v) => setPatch((p) => ({ ...p, [k]: v }))} mainBizId={row?.id ?? null} />
                  </div>
                );
              }
              if (f.type === 'form-ref') {
                return (
                  <div key={k} className="space-y-1.5 border rounded-md p-3 bg-muted/20">
                    <Label className="text-sm font-semibold">{f.label}{f.required ? ' *' : ''}</Label>
                    <FormRefEditor field={f} value={val} onChange={(v) => setPatch((p) => ({ ...p, [k]: v }))} />
                  </div>
                );
              }
              return (
                <div key={k} className="space-y-1.5">
                  <Label className="text-xs">{f.label}{f.required ? ' *' : ''}</Label>
                  <FillFieldEditor field={f} value={val} onChange={(v) => setPatch((p) => ({ ...p, [k]: v }))} onChangeExtraRef={(key, v) => setPatch((p) => ({ ...p, [key]: v }))} />
                </div>
              );
            })}
            {(inter.fields ?? []).length === 0 && <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">该转换未配置提交字段，请到状态机设计中补配</p>}
            <p className="text-[11px] text-muted-foreground">提交后所选字段内容将写入单据数据，并完成状态流转</p>
          </div>
        )}

        {inter?.type === 'confirm' && (
          <div className="space-y-3" key="confirm">
            {inter?.confirm && !!inter?.message && (
              <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground whitespace-pre-wrap">{inter.message}</p>
            )}
            <div className="rounded-md border border-border divide-y divide-border">
              {(inter.fields ?? []).map((k) => {
                const f = fields.find((x) => x.key === k);
                if (!f) return null;
                const v = row?.payload?.[k];
                if (f.type === 'sub-table') {
                  const v = row?.payload?.[k];
                  return (
                    <div key={k} className="p-3 space-y-2">
                      <p className="text-xs font-semibold text-foreground">{f.label}（关联子表明细）</p>
                      <SubTableViewer field={f} value={v} />
                    </div>
                  );
                }
                if (f.type === 'form-ref') {
                  const v = row?.payload?.[k];
                  return (
                    <div key={k} className="p-3 space-y-2">
                      <p className="text-xs font-semibold text-foreground">{f.label}（关联表单数据）</p>
                      <FormRefViewer field={f} value={v} />
                    </div>
                  );
                }
                return (
                  <div key={k} className="grid grid-cols-[7rem_1fr] gap-2 px-3 py-2">
                    <p className="text-xs text-muted-foreground break-words">{f.label}</p>
                    <p className="text-sm text-foreground break-words whitespace-pre-wrap">{fmtFieldVal(f, v ?? null, new Map()) || '—'}</p>
                  </div>
                );
              })}
              {(inter.fields ?? []).length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">该转换未配置确认字段，请到状态机设计中补配</p>}
            </div>
            <p className="text-[11px] text-muted-foreground">请核对以上内容后确认流转（只读，如需修改请先编辑单据）</p>
          </div>
        )}

        {inter?.type === 'none' && (
          <div className="space-y-3" key="none">
            <p className="text-xs text-muted-foreground">请确认是否执行流转操作</p>
            {!!inter?.message && (
              <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground whitespace-pre-wrap">{inter.message}</p>
            )}
            <div className="rounded-md border border-border divide-y divide-border">
              <div className="grid grid-cols-[7rem_1fr] gap-2 px-3 py-2">
                <p className="text-xs text-muted-foreground break-words">触发事件</p>
                <p className="text-sm text-foreground break-words">{transition?.event ?? '—'}</p>
              </div>
              <div className="grid grid-cols-[7rem_1fr] gap-2 px-3 py-2">
                <p className="text-xs text-muted-foreground break-words">当前状态</p>
                <p className="text-sm text-foreground break-words">{row?.status ?? '—'} → {transition?.to ?? '—'}</p>
              </div>
              <div className="grid grid-cols-[7rem_1fr] gap-2 px-3 py-2">
                <p className="text-xs text-muted-foreground break-words">单据标题</p>
                <p className="text-sm text-foreground break-words">{row?.title ?? '—'}</p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">确认后立即执行状态流转</p>
          </div>
        )}

        {inter?.type === 'new_related_form' && (
          <div className="space-y-4" key="new-related">
            <p className="text-xs text-muted-foreground">
              点击确定后，将在 {targetFormIds.map((tid) => `「${relForms[tid]?.name || '目标表单'}」`).join('、')} 中各新增一条记录：全部创建成功后自动关联到本单据{((inter.newRelated?.fieldMappings ?? []).length > 0) ? '、按映射赋值主表字段' : ''}并完成状态流转
            </p>
            {targetFormIds.map((tid) => {
              const rf = relForms[tid];
              if (!rf) return null;
              const editable = rf.fields.filter((f) => !f.system && !SM_LAYOUT.includes(f.type));
              return (
                <div key={tid} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-xs">{rf.name}</Badge>
                    <span className="text-[11px] text-muted-foreground">全部字段（{editable.length}，带 * 为必填）</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {editable.map((f) => {
                      // 已配置映射的目标字段：自动从主表行对应 mainKey 取值回填
                      const mapM = (inter.newRelated?.fieldMappings ?? []).find((m) => m.targetKey === f.key);
                      const mainVal = mapM ? (row?.payload ?? {})[mapM.mainKey] : undefined;
                      const mappedVal = patch[f.key] !== undefined && patch[f.key] !== null && patch[f.key] !== '' ? patch[f.key] : (mainVal !== undefined && mainVal !== null && mainVal !== '' ? mainVal : null);
                      // 映射目标字段若是 form-ref / search-select（关联下拉，optionSource 指向某个目标表单）：
                      // 显示为只读文本，保存后自动关联新建记录，不可下拉更改
                      const isLinkedSelect = f.type === 'form-ref' || (!!f.optionSource?.formId && targetFormIds.includes(f.optionSource.formId));
                      if (isLinkedSelect && mapM) {
                        return (
                          <div key={f.key} className="min-w-0 space-y-1.5">
                            <Label className="text-xs">{f.label}{f.required ? ' *' : ''}</Label>
                            <Input value={mappedVal !== null ? String(mappedVal) : ''} readOnly className="bg-muted/30 h-9 w-full" placeholder="保存后自动关联新建记录" />
                          </div>
                        );
                      }
                      const val = patch[f.key] !== undefined ? patch[f.key] : (mainVal !== undefined && mainVal !== null && mainVal !== '' ? mainVal : null);
                      if (f.type === 'sub-table') {
                        return (
                          <div key={f.key} style={{ gridColumn: 'span 2 / span 2' }} className="space-y-1.5 border rounded-md p-3 bg-muted/20">
                            <Label className="text-sm font-semibold">{f.label}{f.required ? ' *' : ''}</Label>
                            <SubTableEditor field={f} value={val} onChange={(v) => setPatch((p) => ({ ...p, [f.key]: v }))} mainBizId={null} />
                          </div>
                        );
                      }
                      if (f.type === 'form-ref') {
                        return (
                          <div key={f.key} style={{ gridColumn: 'span 2 / span 2' }} className="space-y-1.5 border rounded-md p-3 bg-muted/20">
                            <Label className="text-sm font-semibold">{f.label}{f.required ? ' *' : ''}</Label>
                            <FormRefEditor field={f} value={val} onChange={(v) => setPatch((p) => ({ ...p, [f.key]: v }))} />
                          </div>
                        );
                      }
                      return (
                        <div key={f.key} className="min-w-0 space-y-1.5">
                          <Label className="text-xs">{f.label}{f.required ? ' *' : ''}</Label>
                          <FillFieldEditor field={f} value={val} onChange={(v) => setPatch((p) => ({ ...p, [f.key]: v }))} onChangeExtraRef={(key, v) => setPatch((p) => ({ ...p, [key]: v }))} smStatesOpt={relSmStates.get(tid)} deptOpts={relDepts} />
                        </div>
                      );
                    })}
                  </div>
                  {editable.length === 0 && (
                    <p className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">该表单暂无可填写字段，将创建空白记录</p>
                  )}
                </div>
              );
            })}
            {targetFormIds.length === 0 && (
              <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">未配置目标表单，请到状态机设计中配置</p>
            )}
          </div>
        )}
        </div>

        <div className={cn("flex items-center justify-end gap-2 px-6 py-4 shrink-0 border-t border-border", inter?.type === 'confirm' && 'sm:justify-end')}>
          <Button variant="outline" className="h-9" disabled={busy} onClick={onClose}>取消</Button>
          <Button className="h-9" disabled={busy || (inter?.type === 'assign' && selUsers.length === 0)} onClick={() => {
            if (inter?.type === 'assign') void run({}, selUsers);
            else if (inter?.type === 'submit') submit();
            else if (inter?.type === 'new_related_form') void submitNewRelated();
            else void run({});
          }}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {inter?.type === 'assign' ? `分配并流转（${selUsers.length}）` : inter?.type === 'submit' ? '提交并流转' : inter?.type === 'new_related_form' ? '创建并流转' : '确认并流转'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
