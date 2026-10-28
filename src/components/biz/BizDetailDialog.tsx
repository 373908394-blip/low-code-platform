import { CheckCircle2, FileText, Loader2, PencilLine, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AddressPicker, formatAddress } from '@/components/biz/AddressPicker';
import { FormAssignmentInput } from '@/components/biz/FormAssignmentInput';
import { FormRefEditor, FormRefViewer, materializeInlineRefs } from '@/components/biz/FormRefEditor';
import { MediaUploadField } from '@/components/biz/MediaUploadField';
import { isInlineRefValue, isSubTableDraftValue, persistSubTableFields, SubTableEditor, SubTableViewer, subTableValidateValue } from '@/components/biz/SubTableEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { ScopeContext } from '@/lib/field-catalog';
import { aggregateRows, BIZ_STATUS_LABELS, buildCreatorScope, computeFormCalculations, ensureSystemFields, evalFetchValue, evalFormulaExpression, expandLeaveKeysForSubmit, fmtDate, fmtMoney, formatOptionFieldValue, isAuditSystemField, isLeaveCancelStatus, optionDisplayKeys, SYSTEM_FIELD_KEYS, syncLeaveByTimeField, systemFieldValue, toChineseAmount, validateField } from '@/lib/field-catalog';
import { checkWfNodeGuards, loadFormSm } from '@/lib/status-machine';
import { cn } from '@/lib/utils';
import { collectWfNodes } from '@/lib/workflow';
import { approveBiz, fillNodeBiz } from '@/services/api';
import type { BizApproval, BizData, DataRange, Department, FormField, LeaveTimeValue, MetaForm, Profile, RuleItem, WfNode } from '@/types';
import { MultiSearchSelect, SingleSearchSelect } from './SearchSelects';

/** 系统字段取值所需的档案映射（员工姓名/所属部门/职位依赖创建人档案） */
export type SysProfile = { name: string; position?: string | null; department_id?: string | null };
export type SysMaps = {
  nameMap: Map<string, string>;
  profileMap: Map<string, SysProfile>;
  deptMap: Map<string, string>;
};

const EMPTY_MAPS: SysMaps = { nameMap: new Map(), profileMap: new Map(), deptMap: new Map() };

/** 单据详情弹窗：字段展示 + 审核记录 + 审批操作（通过/驳回）+ 填写节点确认，供工作台/审批待办/通知中心复用 */
export function BizDetailDialog({ open, biz, form, approvals, maps, userId, onClose, onActed, calcCtx }: {
  open: boolean;
  biz: BizData | null;
  form: MetaForm | null;
  approvals: BizApproval[];
  maps?: SysMaps;
  userId?: string;
  onClose: () => void;
  /** 审批/填写完成后回调（刷新列表并关闭弹窗） */
  onActed: () => void;
  /** 计算上下文：关联表单数据（公式引用关联字段）与当前表单全量记录（汇总统计）、子表明细行（汇总/取值） */
  calcCtx?: {
    refRows?: Record<string, BizData[]>;
    summaryRows?: Array<{ payload?: Record<string, unknown> }>;
    subRows?: Record<string, BizData[]>;
  };
}) {
  const { profile, isSuperadmin, dataScope } = useAuth();
  const { nameMap, profileMap, deptMap } = maps ?? EMPTY_MAPS;
  const [comment, setComment] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'department_id'>[]>([]);
  const [fillDraft, setFillDraft] = useState<Record<string, unknown>>({});
  // 本地持有的单据最新状态（弹窗打开时自动刷新最新数据）
  const [activeBiz, setActiveBiz] = useState<BizData | null>(biz);
  useEffect(() => { setActiveBiz(biz); }, [biz]);
  // 子表（standalone）行实时缓存：编辑器行确定即入库后同步填充，供本弹窗内汇总/取值计算（如「打款总额」），不依赖外部 calcCtx
  const [subRows, setSubRows] = useState<Record<string, BizData[]>>({});
  const [acting, setActing] = useState(false);
  const [filling, setFilling] = useState(false);
  // 表单状态机自定义状态（key → 名称/颜色）：状态徽标与 status 系统字段展示用，避免显示原始状态标识
  const [smStates, setSmStates] = useState<Map<string, { label: string; color?: string }>>(new Map());
  // 关联取值（指定表单来源）目标表单数据：formId -> 数据行（≤500 条）
  const [fetchFormRows, setFetchFormRows] = useState<Record<string, Array<{ payload?: Record<string, unknown>; created_at?: string; created_by?: string }>>>({});

  // 加载关联取值（指定表单来源）的目标表单全量数据
  useEffect(() => {
    if (!open || !form) { setFetchFormRows({}); return; }
    const ids = Array.from(new Set(
      ((form.schema_json?.fields ?? []) as FormField[])
        .filter((f) => f.type === 'fetch-value' && f.fetchValue?.source === 'form' && !!f.fetchValue.formId)
        .map((f) => f.fetchValue!.formId as string),
    ));
    if (ids.length === 0) { setFetchFormRows({}); return; }
    let cancelled = false;
    void Promise.all(
      ids.map(async (fid) => {
        const { data: rows } = await supabase.from('biz_data').select('payload, created_at, created_by').eq('form_id', fid).eq('is_deleted', false).order('created_at', { ascending: false }).limit(500);
        return { fid, rows: (rows as Array<{ payload: Record<string, unknown>; created_at: string; created_by?: string }>) ?? [] };
      }),
    ).then((results) => {
      if (cancelled) return;
      const cache: Record<string, Array<{ payload?: Record<string, unknown>; created_at?: string }>> = {};
      results.forEach((r) => { cache[r.fid] = r.rows; });
      setFetchFormRows(cache);
    });
    return () => { cancelled = true; };
  }, [open, form]);

  // 加载当前表单状态机自定义状态（状态展示用）
  useEffect(() => {
    if (!open || !form?.id) { setSmStates(new Map()); return; }
    let cancelled = false;
    void loadFormSm([form.id]).then((map) => {
      if (!cancelled) setSmStates(map.get(form.id)?.states ?? new Map());
    });
    return () => { cancelled = true; };
  }, [open, form?.id]);

  // 加载数据范围上下文：用于表单赋值/关联取值等按角色/部门过滤
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([
      supabase.from('departments').select('*'),
      supabase.from('profiles').select('id, department_id'),
    ]).then(([dRes, pRes]) => {
      if (!alive) return;
      setDepartments((dRes.data as Department[]) ?? []);
      setProfiles((pRes.data as Pick<Profile, 'id' | 'department_id'>[]) ?? []);
    });
    return () => { alive = false; };
  }, [open]);

  const scopeCtx: ScopeContext = useMemo(() => ({
    permissionScope: isSuperadmin ? 'all' : dataScope,
    profile: { id: profile?.id ?? '', department_id: profile?.department_id ?? null },
    departments,
    profiles,
  }), [isSuperadmin, dataScope, profile, departments, profiles]);

  // 打开/切换单据时重置状态，填写草稿以单据现有内容为底
  useEffect(() => {
    if (!biz) return;
    setComment('');
    setSubRows({});
    const sys: Record<string, unknown> = {};
    SYSTEM_FIELD_KEYS.forEach((k) => {
      const v = systemFieldValue(k, biz, { profileMap, deptMap, smStates });
      sys[k] = (k === 'created_at' || k === 'updated_at') && v ? fmtDate(String(v), true) : v;
    });
    setFillDraft({ ...(biz.payload ?? {}), ...sys });
  }, [biz, profileMap, deptMap]);

  // 每次打开弹窗强制从数据库刷新单据数据与关联子表数据，保证即使用户直接取消重进也能看见最新子表与计算数据
  useEffect(() => {
    if (!open || !biz?.id) return;
    let alive = true;
    void (async () => {
      try {
        const { data: freshBiz } = await supabase.from('biz_data').select('*').eq('id', biz.id).maybeSingle();
        if (!alive || !freshBiz) return;
        const b = freshBiz as BizData;
        setActiveBiz(b);
        const allFields = (form?.schema_json?.fields ?? []) as FormField[];
        const subFields = allFields.filter((f) => f.type === 'sub-table' && f.subTable?.targetFormId);
        const subCache: Record<string, BizData[]> = {};
        await Promise.all(subFields.map(async (f) => {
          const v = b.payload?.[f.key];
          const ids = Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
          if (ids.length > 0) {
            const { data: subData } = await supabase.from('biz_data').select('*').in('id', ids).eq('is_deleted', false);
            if (subData) subCache[f.key] = subData as BizData[];
          }
        }));
        if (alive) {
          if (Object.keys(subCache).length > 0) setSubRows((s) => ({ ...s, ...subCache }));
          const sys: Record<string, unknown> = {};
          SYSTEM_FIELD_KEYS.forEach((k) => {
            const v = systemFieldValue(k, b, { profileMap, deptMap, smStates });
            sys[k] = (k === 'created_at' || k === 'updated_at') && v ? fmtDate(String(v), true) : v;
          });
          const calced = computeFormCalculations({
            fields: allFields,
            vals: b.payload ?? {},
            subRowsMap: subCache,
            scopeCtx,
          });
          setFillDraft({ ...(b.payload ?? {}), ...calced, ...sys });
        }
      } catch (e) {
        console.warn('BizDetailDialog 刷新失败：', e);
      }
    })();
    return () => { alive = false; };
  }, [open, biz?.id, form, profileMap, deptMap, smStates, scopeCtx]);

  // 公式计算/汇总统计/关联取值字段的实时计算值（填写草稿 + 计算上下文）
  const calcVals = useMemo(() => {
    const out: Record<string, unknown> = {};
    const allFields = (form?.schema_json?.fields ?? []) as FormField[];
    // 按字段数据范围过滤候选记录（全部 / 跟随角色 / 本部门及下级 / 本部门 / 仅本人）
    const filterByDataRange = <T extends { created_by?: string }>(rows: T[], dataRange?: DataRange): T[] => {
      if (!dataRange || dataRange === 'all' || !scopeCtx) return rows;
      const allowed = buildCreatorScope({ ...scopeCtx, dataRange });
      if (!allowed) return rows;
      const set = new Set(allowed);
      return rows.filter((r) => set.has(r.created_by ?? ''));
    };
    const subRowsFor = (subKey: string) => {
      const v = fillDraft[subKey];
      // 随主表统一保存的内嵌值：直接用行快照参与汇总计算
      if (isInlineRefValue(v)) return v.rows.map((r) => ({ payload: r.payload ?? {}, created_at: (r.sys?.created_at as string) ?? null }));
      if (isSubTableDraftValue(v)) return v.rows.map((r) => ({ payload: r.payload ?? {} }));
      const ids = Array.isArray(v) ? (v as string[]) : [];
      if (ids.length === 0) return [];
      // 优先用本弹窗实时缓存（standalone 行确定即入库时已填充），缺行再回退外部 calcCtx
      const fromLive = (subRows[subKey] ?? []).filter((r) => ids.includes(r.id));
      const fromCtx = (calcCtx?.subRows?.[subKey] ?? []).filter((r) => ids.includes(r.id) && !fromLive.some((x) => x.id === r.id));
      return [...fromLive, ...fromCtx].map((r) => ({ payload: r.payload, created_at: r.created_at }));
    };
    const refRowsFor = (refKey: string) => {
      const v = fillDraft[refKey];
      if (isInlineRefValue(v)) return v.rows.map((r) => ({ payload: r.payload ?? {}, created_at: (r.sys?.created_at as string) ?? null }));
      const ids = Array.isArray(v) ? (v as string[]) : [];
      if (ids.length === 0) return [];
      return (calcCtx?.refRows?.[refKey] ?? []).filter((r) => ids.includes(r.id)).map((r) => ({ payload: r.payload, created_at: r.created_at }));
    };
    const refRecords: Record<string, Record<string, unknown> | undefined> = {};
    allFields.filter((f) => f.type === 'form-ref').forEach((rf) => {
      const v = fillDraft[rf.key];
      if (isInlineRefValue(v)) {
        refRecords[rf.key] = v.rows[0]?.payload;
        return;
      }
      const ids = Array.isArray(v) ? (v as string[]) : [];
      const first = ids.length > 0 ? (calcCtx?.refRows?.[rf.key] ?? []).find((r) => r.id === ids[0]) : undefined;
      refRecords[rf.key] = first?.payload;
    });
    // 第一轮：汇总统计 (summary) 与关联取值 (fetch-value)（不依赖其他字段实时值）
    allFields.forEach((f) => {
      if (f.type === 'summary' && f.summary) {
        let rows: Array<{ payload?: Record<string, unknown> }>;
        if (f.summary.source === 'subtable') {
          rows = subRowsFor(f.summary.subFieldKey ?? '');
        } else if (f.summary.source === 'ref') {
          rows = refRowsFor(f.summary.refFieldKey ?? '');
        } else {
          rows = calcCtx?.summaryRows ?? [];
        }
        const aggVal = aggregateRows(f.summary.aggregate, f.summary.fieldKey ?? '', rows);
        // 空行集归一为 0（无明细行时总额应为 0 而非 null，公式与大写金额字段可正常引用）
        out[f.key] = aggVal === null && rows.length === 0 ? 0 : aggVal;
      } else if (f.type === 'fetch-value' && f.fetchValue) {
        const cands = f.fetchValue.source === 'subtable'
          ? subRowsFor(f.fetchValue.subFieldKey ?? '')
          : filterByDataRange(fetchFormRows[f.fetchValue.formId ?? ''] ?? [], f.fetchValue.dataRange);
        out[f.key] = evalFetchValue(f.fetchValue, cands);
      }
    });
    // 第二轮：公式与大写金额读「输入值 + 已计算值」合并视图——关联字段为自动计算（汇总/关联取值）时实时联动
    let merged = { ...fillDraft, ...out };
    allFields.forEach((f) => {
      if (f.type === 'formula') {
        const expr = f.formula?.expression ?? f.defaultValue ?? '';
        if (expr) out[f.key] = evalFormulaExpression(expr, merged, refRecords);
      } else if (f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey) {
        // 大写金额：关联字段可为输入字段或自动计算字段，统一从合并视图取值实时换算
        out[f.key] = toChineseAmount(merged[f.uppercaseAmount.fieldKey] as number | string | null | undefined);
      }
    });
    // 第三轮：公式级联（公式依赖其他公式字段，取级联后的值）
    merged = { ...fillDraft, ...out };
    allFields.forEach((f) => {
      if (f.type === 'formula') {
        const expr = f.formula?.expression ?? f.defaultValue ?? '';
        if (expr) {
          const nextVal = evalFormulaExpression(expr, merged, refRecords);
          if (nextVal !== null) out[f.key] = nextVal;
        }
      }
    });
    // 第四轮：大写金额兜底重算（关联公式等计算字段时取级联后的最终值）
    merged = { ...fillDraft, ...out };
    allFields.forEach((f) => {
      if (f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey) {
        out[f.key] = toChineseAmount(merged[f.uppercaseAmount.fieldKey] as number | string | null | undefined);
      }
    });
    return out;
  }, [form, fillDraft, calcCtx, subRows, fetchFormRows, scopeCtx]);

  const onAct = async (action: 'approve' | 'reject') => {
    if (!biz || acting) return;
    // 驳回必须填写理由
    if (action === 'reject' && !comment.trim()) return toast.error('驳回时必须填写理由');
    setActing(true);
    const { data, error } = await approveBiz(biz.id, action, comment.trim() || '同意');
    setActing(false);
    if (error) {
      toast.error((error as { message: string }).message || '操作失败');
    } else {
      toast.success((data as { message?: string })?.message || '操作成功');
      onActed();
    }
  };

  /** 填写节点确认：校验确认字段后提交，推进流程 */
  const onFill = async () => {
    if (!biz || filling) return;
    const fields = (form?.schema_json?.fields ?? []) as FormField[];
    const myFills = approvals.filter((a) => a.state === 'pending' && a.current && a.node_type === 'fill' && (a.approvers ?? []).includes(userId ?? ''));
    if (myFills.length === 0) return;
    const confirmKeys = myFills[0].confirm_fields ?? [];
    for (const key of confirmKeys) {
      const f = fields.find((x) => x.key === key);
      if (!f) continue;
      const err = validateField(f, f.type === 'sub-table' ? subTableValidateValue(fillDraft[key]) : fillDraft[key]);
      if (err) return toast.error(`${f.label}：${err}`);
    }
    setFilling(true);
    // 提交确认字段及其联动的请假拆分字段（复合值+开始/结束时间+小时/天数，服务端剔除系统字段防伪造）
    let data: Record<string, unknown> = {};
    expandLeaveKeysForSubmit(fields, confirmKeys).forEach((k) => {
      if (!SYSTEM_FIELD_KEYS.includes(k as (typeof SYSTEM_FIELD_KEYS)[number])) data[k] = fillDraft[k];
    });
    // 公式计算/汇总统计字段在确认范围内时：以提交时点计算结果覆盖
    confirmKeys.forEach((k) => {
      if (calcVals[k] !== undefined) data[k] = calcVals[k] ?? null;
    });

    // 填写节点守卫条件评估：读取流程节点配置，合并单据现有数据与本次填写数据逐条校验，未满足则阻断提交
    const { data: wfRes } = await supabase.from('meta_workflow').select('nodes').eq('form_id', biz.form_id).maybeSingle();
    const nodeGuards = (collectWfNodes(((wfRes as { nodes?: WfNode[] } | null)?.nodes ?? []) as WfNode[]).find((n) => n.id === myFills[0].node_id)?.guards ?? []) as RuleItem[];
    if (nodeGuards.length > 0) {
      const merged = { ...(biz.payload ?? {}), ...data };
      const chk = checkWfNodeGuards(nodeGuards, merged, (k) => fields.find((f) => f.key === k)?.label ?? k);
      if (!chk.pass) {
        setFilling(false);
        return toast.error(`守卫条件未满足：${chk.failed}`);
      }
    }

    // 关联子表明细持久化（随主表保存模式内嵌物化）
    try {
      const uid = userId ?? (await supabase.auth.getUser()).data.user?.id ?? '';
      const { data: me } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
      data = await persistSubTableFields(fields, data, { tenantId: (me as { tenant_id?: string } | null)?.tenant_id ?? '', userId: uid });
      data = await materializeInlineRefs(fields, data);
    } catch (e) {
      setFilling(false);
      return toast.error(e instanceof Error ? e.message : '子表明细保存失败');
    }

    const { error } = await fillNodeBiz(biz.id, data);
    setFilling(false);
    if (error) {
      toast.error((error as { message: string }).message || '填写确认失败');
      return;
    }
    toast.success('已确认，流程进入下一节点');
    onActed();
  };

  /** 销假填写：修改开始/结束时间后即时入库（不等「确定」），自动保存新时间与重算的请假天数/小时 */
  const autoSaveLeave = async (patch: Record<string, unknown>) => {
    if (!biz) return;
    const nextPayload = { ...(biz.payload ?? {}), ...patch };
    const { error } = await supabase.from('biz_data').update({ payload: nextPayload, updated_at: new Date().toISOString() }).eq('id', biz.id);
    if (error) return toast.error('自动保存失败：' + error.message);
    toast.success('时间已自动保存，请假时长已同步重算');
  };

  return (
    <Dialog open={open && !!biz} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
        {biz && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <span className="truncate">{biz.title || '单据详情'}</span>
                <StatusBadge status={biz.status} label={smStates.get(biz.status)?.label} />
              </DialogTitle>
            </DialogHeader>

            <BizDetail biz={biz} form={form} nameMap={nameMap} profileMap={profileMap} deptMap={deptMap} smStates={smStates} />

            {/* 审核记录 */}
            <ApprovalTimeline approvals={approvals} nameMap={nameMap} />

            {/* 填写节点确认：当前存在待处理填写节点且当前用户为填写人时可见（含销假等自定义状态） */}
            {(biz.status === 'pending' || isLeaveCancelStatus(biz.status)) && (() => {
              const myFills = approvals.filter((a) => a.state === 'pending' && a.current && a.node_type === 'fill' && (a.approvers ?? []).includes(userId ?? ''));
              if (myFills.length === 0) return null;
              const a = myFills[0];
              const confirmKeys = a.confirm_fields ?? [];
              const perms = a.field_perms ?? {};
              // 已拆分的请假时间复合字段不再显示（仅展示拆分后的开始/结束时间等字段）
              const cFields = ((form?.schema_json?.fields ?? []) as FormField[]).filter((f) => confirmKeys.includes(f.key) && !(f.type === 'leave-time' && f.leaveTime?.startKey && f.leaveTime?.endKey));
              return (
                <div className="space-y-3 border-t border-border pt-4">
                  <div className="flex items-center gap-2">
                    <PencilLine className="h-4 w-4 text-accent" />
                    <p className="text-sm font-semibold">{a.node_name}</p>
                    <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[10px]">待我填写</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">请查看单据内容，编辑并确认以下字段后提交，流程将进入下一节点</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                    {cFields.map((f) => {
                      // 按节点字段权限区分：editable 可编辑，其余（visible 等）只读展示数值
                      const isEditable = perms[f.key] === 'editable';
                      if (f.type === 'sub-table') {
                        return (
                          <div key={f.key} className="min-w-0 space-y-1.5 md:col-span-2 border rounded-md p-3 bg-muted/20">
                            <Label className="text-sm font-semibold">{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                            {isEditable ? (
                              <SubTableEditor
                                field={f}
                                value={fillDraft[f.key]}
                                onChange={(v) => {
                                  setFillDraft((d) => ({ ...d, [f.key]: v }));
                                  if (f.subTable?.saveMode === 'standalone' && Array.isArray(v) && v.length > 0) {
                                    const ids = v as string[];
                                    const known = new Set((subRows[f.key] ?? []).map((r) => r.id));
                                    const missing = ids.filter((id) => !known.has(id));
                                    if (missing.length > 0) {
                                      void supabase.from('biz_data').select('*').in('id', missing).eq('is_deleted', false).then(({ data }) => {
                                        const rows = (data as BizData[]) ?? [];
                                        if (rows.length > 0) setSubRows((s) => ({ ...s, [f.key]: [...(s[f.key] ?? []), ...rows] }));
                                      });
                                    }
                                  }
                                }}
                                onMainRecalced={(patch) => {
                                  setFillDraft((d) => ({ ...d, ...patch }));
                                  setActiveBiz((b) => b ? { ...b, payload: { ...(b.payload ?? {}), ...patch } } : b);
                                }}
                                scopeCtx={scopeCtx}
                                mainBizId={activeBiz?.id ?? biz.id}
                              />
                            ) : (
                              <SubTableViewer field={f} value={fillDraft[f.key]} />
                            )}
                          </div>
                        );
                      }
                      if (f.type === 'form-ref') {
                        return (
                          <div key={f.key} className="min-w-0 space-y-1.5 md:col-span-2 border rounded-md p-3 bg-muted/20">
                            <Label className="text-sm font-semibold">{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                            {isEditable ? (
                              <FormRefEditor field={f} value={fillDraft[f.key]} onChange={(v) => setFillDraft((d) => ({ ...d, [f.key]: v }))} />
                            ) : (
                              <FormRefViewer field={f} value={fillDraft[f.key]} />
                            )}
                          </div>
                        );
                      }
                      return (
                        <div key={f.key} className="min-w-0 space-y-1.5">
                          <Label className="text-sm">{f.label}</Label>
                          {isEditable ? (
                            <FillFieldEditor field={f} value={fillDraft[f.key]} calcValue={calcVals[f.key]} currentFormId={form?.id} scopeCtx={scopeCtx} onChange={(v) => {
                              // 修改开始/结束时间：反向联动重算时长并即时自动保存
                              const allFields = (form?.schema_json?.fields ?? []) as FormField[];
                              const res = syncLeaveByTimeField(allFields, fillDraft, f.key, v);
                              setFillDraft(res ? res.draft : { ...fillDraft, [f.key]: v });
                              if (res) void autoSaveLeave(res.patch);
                            }} />
                          ) : (
                            <p className="break-words text-sm font-medium">{fmtFieldVal(f, fillDraft[f.key] ?? calcVals[f.key], nameMap, smStates) || '—'}</p>
                          )}
                        </div>
                      );
                    })}
                    {cFields.length === 0 && <p className="text-xs text-muted-foreground">该节点未设置确认字段</p>}
                  </div>
                  <div className="flex justify-end">
                    <Button className="h-9" disabled={filling} onClick={() => onFill()}>
                      {filling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <PencilLine className="mr-1 h-4 w-4" />确定
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* 审批操作：仅当前审批人（非填写节点）可见 */}
            {biz.status === 'pending' && (() => {
              const canAct = approvals.some((a) => a.state === 'pending' && a.current && a.node_type !== 'fill' && (a.approvers ?? []).includes(userId ?? ''));
              if (!canAct) return null;
              return (
                <div className="space-y-2 border-t border-border pt-4">
                  <Label className="text-xs">审批意见（驳回时必填）</Label>
                  <Textarea
                    className="min-h-20 text-sm"
                    placeholder="请输入审批意见；驳回时必须填写理由"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" className="h-9" disabled={acting} onClick={() => onAct('reject')}>
                      {acting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <XCircle className="mr-2 h-4 w-4" />驳回
                    </Button>
                    <Button className="h-9" disabled={acting} onClick={() => onAct('approve')}>
                      {acting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <CheckCircle2 className="mr-2 h-4 w-4" />通过
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-right">驳回时必须填写理由</p>
                </div>
              );
            })()}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 状态徽标（与业务列表一致的双编码样式）：状态机自定义状态走 accent 中性色（颜色随租户主题） */
export function StatusBadge({ status, label }: { status: BizData['status']; label?: string }) {
  const text = label ?? BIZ_STATUS_LABELS[status] ?? status;
  if (status === 'pending') return <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-[10px] shrink-0">{text}</Badge>;
  if (status === 'approved') return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-[10px] shrink-0">{text}</Badge>;
  if (status === 'xiaojia' || status === 'xiaojiazhong') return <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[10px] shrink-0">{text}</Badge>;
  if (BIZ_STATUS_LABELS[status] === undefined) return <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[10px] shrink-0">{text}</Badge>;
  if (status === 'draft') return <Badge className="bg-muted text-muted-foreground hover:bg-muted text-[10px] shrink-0">{text}</Badge>;
  return <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/10 text-[10px] shrink-0">{text}</Badge>;
}

/** 表单赋值字段值展示：存储的是记录 id，实时查询目标表单按「显示信息」拼接回显（记录不存在时提示） */
export function FormAssignmentText({ value, field }: { value: unknown; field: FormField }) {
  const cfg = field.assignment;
  const targetFormId = cfg?.formId ?? '';
  const [text, setText] = useState('');
  const str = value !== undefined && value !== null ? String(value) : '';
  // 存量数据兼容：历史版本存储拼接文本（非 uuid）直接原样展示
  const isIdLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  const keysKey = (cfg?.displayFieldKeys ?? []).join(',');
  useEffect(() => {
    if (!isIdLike || !targetFormId) { setText(str); return; }
    let cancelled = false;
    setText('');
    void Promise.all([
      supabase.from('biz_data').select('*').eq('id', str).eq('form_id', targetFormId).maybeSingle(),
      // 成员档案：显示字段含系统字段（员工姓名等）时派生解析用
      supabase.from('profiles').select('id, name'),
    ]).then(([rowRes, profRes]) => {
      if (cancelled) return;
      const rec = rowRes.data as BizData | null;
      if (!rec) { setText('关联记录已不存在'); return; }
      const nameMap = new Map(((profRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      const sep = cfg?.displaySeparator ?? ' ';
      const keys = keysKey ? keysKey.split(',') : [];
      // 统一复用关联表单字段取值格式化（系统字段派生 + 地址对象友好展示）
      const joined = keys.map((k) => formatOptionFieldValue(k, rec, nameMap)).filter(Boolean).join(sep);
      setText(joined || str);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [str, isIdLike, targetFormId, keysKey, cfg?.displaySeparator]);
  return <>{text || (isIdLike ? '' : str)}</>;
}

/** 下拉动态数据源选项文本展示：选项值为记录 id，按显示字段配置解析文本（勾选 1 个字段直接显示该字段值，多个字段拼接；rows 未提供时实时查询目标表单） */
export function RefOptionText({ value, field, rows, nameMap, smStateMap }: { value: unknown; field: FormField; rows?: BizData[]; nameMap?: Map<string, string>; smStateMap?: Map<string, { label: string }> }) {
  const cfg = field.optionSource;
  const keys = optionDisplayKeys(field);
  const sep = cfg?.separator ?? '-';
  const [fetched, setFetched] = useState<BizData[] | null>(null);
  useEffect(() => {
    if (rows || !cfg?.formId || keys.length === 0) return;
    let cancelled = false;
    void supabase.from('biz_data').select('*').eq('form_id', cfg.formId).eq('is_deleted', false).limit(500).then(({ data }) => {
      if (!cancelled) setFetched((data as BizData[]) ?? []);
    });
    return () => { cancelled = true; };
  }, [rows, cfg?.formId, keys.length]);
  const all = rows ?? fetched ?? [];
  const resolve = (id: string) => {
    const rec = all.find((r) => r.id === id);
    if (!rec) return id;
    const joined = keys.map((k) => formatOptionFieldValue(k, rec, nameMap, smStateMap)).filter(Boolean).join(sep);
    return joined || id;
  };
  const text = Array.isArray(value) ? value.map((x) => resolve(String(x))).join('、') : resolve(String(value ?? ''));
  return <>{text}</>;
}

/** 下拉类字段是否为关联表单数据源（选项值为记录 id，展示需按显示字段配置解析文本；历史单字段 fieldKey 自动兼容） */
export const isMultiFieldSelect = (f: FormField) =>
  (f.type === 'select' || f.type === 'multi-select' || f.type === 'search-select' || f.type === 'search-multi-select') &&
  optionDisplayKeys(f).length > 0;

/** 单据详情：表单字段 + 系统字段（员工姓名/所属部门/职位/创建人/创建时间/更新人/更新时间/状态） */
export function BizDetail({ biz, form, nameMap, profileMap, deptMap, smStates }: {
  biz: BizData;
  form: MetaForm | null;
  nameMap: Map<string, string>;
  profileMap: Map<string, SysProfile>;
  deptMap: Map<string, string>;
  /** 状态机自定义状态（key → 名称）：status 系统字段展示优先取自定义名称 */
  smStates?: Map<string, { label: string }>;
}) {
  const fields = ensureSystemFields((form?.schema_json?.fields ?? []).filter((f) => !['section', 'row', 'action-button', 'wizard-step'].includes(f.type)));
  const payload = (biz.payload ?? {}) as Record<string, unknown>;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        {fields.filter((f) => !(f.type === 'leave-time' && f.leaveTime?.startKey && f.leaveTime?.endKey)).map((f) => {
          // 系统字段从行数据派生，业务字段取 payload
          const value = isAuditSystemField(f) ? systemFieldValue(f.key, biz, { profileMap, deptMap, smStates }) : payload[f.key];
          return (
            <div key={f.key} className="min-w-0">
              <p className="text-[11px] text-muted-foreground">{f.label}</p>
              <p className="text-sm text-foreground mt-0.5 break-words">
                {f.type === 'form-assignment'
                  ? (value ? <FormAssignmentText value={value} field={f} /> : <span className="text-muted-foreground/60">—</span>)
                  : isMultiFieldSelect(f)
                    ? (value ? <RefOptionText value={value} field={f} nameMap={nameMap} /> : <span className="text-muted-foreground/60">—</span>)
                    : (fmtFieldVal(f, value, nameMap, smStates) || <span className="text-muted-foreground/60">—</span>)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 审核记录时间线 */
export function ApprovalTimeline({ approvals, nameMap }: { approvals: BizApproval[]; nameMap: Map<string, string> }) {
  const acts = approvals.flatMap((a) => (a.acts ?? []).map((act) => ({ ...act, nodeName: a.node_name })));
  if (acts.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground">审核记录</p>
      <div className="relative pl-5">
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
        <div className="space-y-4">
          {acts.map((act, i) => {
            const isApprove = act.action === 'approve';
            const isFill = act.action === 'fill';
            return (
              <div key={i} className="relative">
                <span className={cn('absolute -left-5 top-0.5 h-3.5 w-3.5 rounded-full border border-background', isFill ? 'bg-accent' : isApprove ? 'bg-primary' : 'bg-destructive')} />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-foreground">{act.user_name || (nameMap.get(act.user_id) ?? '审批人')}</span>
                  {isFill ? (
                    <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[10px] h-4 px-1.5">已填写</Badge>
                  ) : (
                    <Badge variant={isApprove ? 'default' : 'destructive'} className="text-[10px] h-4 px-1.5">{isApprove ? '通过' : '驳回'}</Badge>
                  )}
                  {act.nodeName && <span className="text-[11px] text-muted-foreground">· {act.nodeName}</span>}
                </div>
                {act.comment && <p className="text-xs text-muted-foreground mt-1 break-words">{act.comment}</p>}
                {act.at && <p className="text-[11px] text-muted-foreground/70 mt-0.5 sig-num">{fmtDate(act.at, true)}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 字段值展示格式化 */
export function fmtFieldVal(field: FormField, value: unknown, nameMap: Map<string, string>, smStates?: Map<string, { label: string }>): string {
  if (value === undefined || value === null || value === '') return '';
  // 复合字段内嵌值（随主表统一保存）：摘要计数展示，避免对象被展开
  if ((field.type === 'sub-table' || field.type === 'form-ref') && isInlineRefValue(value)) {
    const n = value.rows.length;
    return n === 0 ? '' : field.type === 'sub-table' ? `共 ${n} 条明细` : `共 ${n} 条关联数据`;
  }
  // 系统字段：状态映射中文（优先状态机自定义名称）、时间格式化
  if (field.system) {
    if (field.key === 'status') return smStates?.get(String(value))?.label ?? BIZ_STATUS_LABELS[String(value)] ?? String(value);
    if (field.key === 'created_at' || field.key === 'updated_at') return fmtDate(String(value), true);
  }
  if (field.type === 'money') return fmtMoney(Number(value));
  if (field.type === 'address') return formatAddress(value);
  if (field.type === 'date' || field.type === 'datetime') return fmtDate(String(value), field.type === 'datetime');
  // 系统状态下拉：值存的是状态机状态 key，映射为状态中文名
  if (field.type === 'system-status') return smStates?.get(String(value))?.label ?? BIZ_STATUS_LABELS[String(value)] ?? String(value);
  // 请假时间复合值：以「开始 日期 时间 ~ 结束 日期 时间」展示（已拆分为独立字段时不渲染本分支）
  if (field.type === 'leave-time') {
    const lv = (value ?? {}) as LeaveTimeValue;
    const h = (t?: string | number) => (t === undefined || t === null ? '' : `${String(t).padStart(2, '0')}:00`);
    return lv.start_date ? `${lv.start_date} ${h(lv.start_time)} ~ ${lv.end_date ?? ''} ${h(lv.end_time)}`.replace(/\s+/g, ' ').trim() : '';
  }
  if (field.type === 'user-select' || field.type === 'dept-select') {
    const ids = Array.isArray(value) ? value : [value];
    return ids.map((id) => nameMap.get(String(id)) ?? String(id)).join('、');
  }
  if (Array.isArray(value)) return value.map((v) => (v && typeof v === 'object' ? formatAddress(v) : String(v))).join('、');
  // 对象值兜底安全格式化（如地址对象），避免直接转字符串显示 [object Object]
  if (typeof value === 'object' && value !== null) return formatAddress(value);
  return String(value);
}

/** 填写节点确认字段编辑器（按字段类型渲染轻量控件，供详情填写确认与编辑弹窗复用） */
/** 拉取下拉动态数据源选项（弹窗填写场景，不做数据范围过滤）：选项值为记录 id；勾选 1 个字段直接显示该字段值，多个字段按分隔符拼接 */
async function fetchOptionSourceOption(field: FormField, nameMap?: Map<string, string>): Promise<{ id: string; label: string }[]> {
  const cfg = field.optionSource;
  if (!cfg?.formId) return [];
  const multiKeys = optionDisplayKeys(field);
  if (multiKeys.length === 0) return [];
  const { data } = await supabase.from('biz_data').select('*').eq('form_id', cfg.formId).eq('is_deleted', false).limit(500);
  const rows = (data as BizData[]) ?? [];
  const sep = cfg.separator ?? '-';
  return rows.map((r) => ({
    id: r.id,
    label: multiKeys.map((k) => formatOptionFieldValue(k, r, nameMap)).filter(Boolean).join(sep) || '（空记录）',
  }));
}

export function FillFieldEditor({ field, value, onChange, onChangeExtraRef, calcValue, onAssign, currentFormId, scopeCtx, smStatesOpt, deptOpts, nameMap }: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  /** 额外写入其他字段（多字段拼接下拉的 ref_ 前缀引用存储） */
  onChangeExtraRef?: (key: string, v: unknown) => void;
  /** 公式计算/汇总统计/关联取值字段的实时计算值（未传时回退展示已存值） */
  calcValue?: unknown;
  /** 表单赋值组件回填其它字段回调 */
  onAssign?: (assigned: Record<string, unknown>) => void;
  /** 当前表单 id（表单赋值组件「当前表单」来源兜底） */
  currentFormId?: string;
  /** 数据范围上下文：用于表单赋值等组件按角色/部门过滤候选数据 */
  scopeCtx?: ScopeContext;
  /** 状态机状态映射（system-status 字段下拉选项；未传时保持只读） */
  smStatesOpt?: Map<string, { label: string; color?: string }>;
  /** 部门下拉选项（dept-select 字段；未传时保持只读） */
  deptOpts?: { id: string; name: string }[];
  /** 用户姓名映射，用于系统字段格式化展示 */
  nameMap?: Map<string, string>;
}) {
  // 下拉动态数据源（关联表单）：拉取选项；无 optionSource 时为 null（走静态 options）
  const [dynOpts, setDynOpts] = useState<{ id: string; label: string }[] | null>(null);
  // 多字段拼接数据源的完整记录缓存：选中后按 ref_ 前缀分字段写入
  const [dynRows, setDynRows] = useState<BizData[] | null>(null);
  useEffect(() => {
    const src = field.optionSource;
    if (!src?.formId || optionDisplayKeys(field).length === 0) {
      setDynOpts(null);
      setDynRows(null);
      return;
    }
    let cancelled = false;
    setDynOpts([]);
    setDynRows(null);
    void fetchOptionSourceOption(field, nameMap).then((o) => {
      if (!cancelled) setDynOpts(o);
    });
    // 同时拉取完整记录用于 ref_ 前缀分字段引用存储
    void supabase.from('biz_data').select('*').eq('form_id', src.formId).eq('is_deleted', false).limit(500).then(({ data }) => {
      if (!cancelled) setDynRows((data as BizData[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [field]);
  // 关联表单下拉选项选中：将被引用的目标字段值以 ref_{组件标识}_{目标字段标识} 前缀分字段写入
  const refStore = (next: unknown): unknown => {
    const multiKeys = optionDisplayKeys(field);
    if (multiKeys.length === 0 || !dynRows) return next;
    const writeRef = (id: string | null) => {
      const rec = id ? dynRows.find((r) => r.id === id) : undefined;
      for (const k of multiKeys) {
        const v = (rec?.payload as Record<string, unknown> | undefined)?.[k];
        onChangeExtraRef?.(`ref_${field.key}_${k}`, v ?? null);
      }
    };
    if (Array.isArray(next)) (next as (string | null)[]).forEach((id) => writeRef(id ?? null));
    else writeRef((next as string | null) ?? null);
    return next;
  };
  const common = { disabled: field.disabled, placeholder: field.placeholder ?? '', className: 'w-full h-9' };
  switch (field.type) {
    case 'serial-number':
      return <Input value={(value as string) ?? ''} readOnly className="bg-muted/30 sig-num" placeholder={field.system ? '保存时自动生成' : '提交时自动生成'} />;
    case 'textarea':
    case 'richtext':
      return <Textarea className="min-h-20 resize-y text-sm w-full" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} disabled={common.disabled} placeholder={common.placeholder} />;
    case 'number':
    case 'money':
    case 'percent':
      return <Input type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} {...common} />;
    case 'formula': {
      // 配置了计算公式即只读展示实时计算值（系统预置与自定义字段一致；未传计算值时展示已存值）
      const expr = field.formula?.expression ?? field.defaultValue;
      if (expr) {
        const shown = calcValue !== undefined ? (calcValue as number) ?? '' : ((value as number) ?? '');
        return <Input type="number" readOnly value={shown} className="bg-muted/30" placeholder="自动计算" />;
      }
      return <Input type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} {...common} />;
    }
    case 'summary': {
      // 汇总统计：配置了汇总规则即只读展示自动统计值（系统预置与自定义字段一致）
      if (field.summary) {
        const shown = calcValue !== undefined ? (calcValue as number) ?? '' : ((value as number) ?? '');
        return <Input type="number" readOnly value={shown} className="bg-muted/30" placeholder="自动统计" />;
      }
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    }
    case 'fetch-value': {
      // 关联取值：配置了取值规则即只读展示自动取值（系统预置与自定义字段一致）
      if (field.fetchValue) {
        const shown = calcValue !== undefined ? (calcValue ?? '') : (value ?? '');
        return <Input readOnly value={String(shown)} className="bg-muted/30" placeholder="自动取值" />;
      }
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    }
    case 'amount-uppercase': {
      // 大写金额：只读展示关联金额字段的中文大写换算结果（实时跟随，保存时写入）
      const shown = calcValue !== undefined ? String(calcValue ?? '') : ((value as string) ?? '');
      return <Input readOnly value={shown} className="bg-muted/30" placeholder="自动换算" />;
    }
    case 'form-assignment':
      return (
        <FormAssignmentInput
          field={field}
          value={value}
          onChange={(v) => onChange(v)}
          onAssign={(assignedMap) => {
            onAssign?.(assignedMap);
          }}
          disabled={common.disabled}
          placeholder={field.placeholder ?? '点击选择关联数据'}
          currentFormId={currentFormId}
          scopeCtx={scopeCtx}
        />
      );
    case 'date':
      return <DateTimePicker mode="date" value={(value as string) ?? ''} onChange={(v) => onChange(v)} disabled={common.disabled} placeholder="选择日期" className="h-9" />;
    case 'time':
      return <DateTimePicker mode="time" value={(value as string) ?? ''} onChange={(v) => onChange(v)} disabled={common.disabled} placeholder="选择时间" className="h-9" />;
    case 'datetime':
      return <DateTimePicker mode="datetime" value={(value as string) ?? ''} onChange={(v) => onChange(v)} disabled={common.disabled} placeholder="选择日期时间" className="h-9" />;
    case 'search-select': {
      const opts = field.optionSource?.formId ? (dynOpts ?? []) : (field.options ?? []).map((o) => ({ id: o, label: o }));
      return (
        <SingleSearchSelect
          className="w-full h-9"
          disabled={common.disabled}
          placeholder={field.placeholder ?? '请选择（可搜索）'}
          options={opts}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(refStore(v || null))}
        />
      );
    }
    case 'address':
      return (
        <AddressPicker
          disabled={common.disabled}
          placeholder={field.placeholder ?? '请选择省 / 市 / 区县'}
          value={value}
          onChange={(v) => onChange(v)}
        />
      );
    case 'select': {
      const opts = field.optionSource?.formId ? (dynOpts ?? []) : (field.options ?? []).map((o) => ({ id: o, label: o }));
      return (
        <Select disabled={common.disabled} value={(value as string) ?? 'none'} onValueChange={(v) => onChange(refStore(v === 'none' ? null : v))}>
          <SelectTrigger className="w-full h-9"><SelectValue placeholder={field.placeholder ?? '请选择'} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未选择</SelectItem>
            {opts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case 'multi-select':
    case 'search-multi-select':
    case 'checkbox': {
      const opts = field.options ?? [];
      // 动态数据源（关联表单）：统一 {id,label} 结构；静态选项同构转换
      const pairOpts = field.optionSource?.formId ? (dynOpts ?? []) : opts.map((o) => ({ id: o, label: o }));
      // 带搜索的下拉多选：搜索过滤 + 多选标签（数据与行为同下拉多选）
      if (field.type === 'search-multi-select') {
        return (
          <MultiSearchSelect
            className="w-full h-9"
            disabled={common.disabled}
            placeholder={field.placeholder ?? '请选择（可搜索）'}
            options={pairOpts}
            value={(value as string[]) ?? []}
            onChange={(next) => onChange(refStore(next))}
          />
        );
      }
      // 单选项 checkbox 使用原生复选框，更贴合个别销假等确认项场景
      if (field.type === 'checkbox' && opts.length === 1) {
        const opt = opts[0];
        const checked = Array.isArray(value) ? value.includes(opt) : value === true || value === opt;
        const id = `fill-cb-${field.key}`;
        return (
          <div className="flex items-center gap-2">
            <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v ? [opt] : [])} />
            <Label htmlFor={id} className="text-sm font-normal cursor-pointer">{opt}</Label>
          </div>
        );
      }
      const cur = new Set((value as string[]) ?? []);
      return (
        <div className="flex flex-wrap gap-1.5">
          {pairOpts.length === 0 && <span className="text-xs text-muted-foreground">无选项</span>}
          {pairOpts.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { const next = new Set(cur); if (next.has(o.id)) next.delete(o.id); else next.add(o.id); onChange(refStore([...next])); }}
              className={cn('h-7 rounded border px-2 text-xs transition-colors', cur.has(o.id) ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
            >
              {o.label}
            </button>
          ))}
        </div>
      );
    }
    case 'system-status': {
      // 有状态映射时下拉可选（如转换弹窗中新建目标记录选初始状态），无映射时只读展示
      if (smStatesOpt && smStatesOpt.size > 0) {
        return (
          <Select value={(value as string) ?? ''} onValueChange={(v) => onChange(v)}>
            <SelectTrigger className={common.className}><SelectValue placeholder="选择状态" /></SelectTrigger>
            <SelectContent>
              {[...smStatesOpt.entries()].map(([k, s]) => (
                <SelectItem key={k} value={k}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      return <Input value={smStatesOpt?.get(String(value))?.label ?? BIZ_STATUS_LABELS[String(value)] ?? String(value ?? '')} readOnly className="bg-muted/30" disabled />;
    }
    case 'user-select':
    case 'dept-select': {
      // 有部门选项时下拉可选（如转换弹窗中新建目标记录选所属部门），无选项时保持原只读行为
      if (field.type === 'dept-select' && deptOpts && deptOpts.length > 0) {
        return (
          <Select value={(value as string) ?? ''} onValueChange={(v) => onChange(v)}>
            <SelectTrigger className={common.className}><SelectValue placeholder="选择部门" /></SelectTrigger>
            <SelectContent>
              {deptOpts.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={common.placeholder || '请到业务列表中操作选择组件'} disabled />;
    }
    case 'attachment':
    case 'image':
      return (
        <MediaUploadField
          type={field.type as 'image' | 'attachment'}
          value={value}
          onChange={(v) => onChange(v)}
          maxCount={field.maxCount ?? 1}
          disabled={common.disabled}
          bucket="biz-media"
        />
      );
    default:
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
  }
}
