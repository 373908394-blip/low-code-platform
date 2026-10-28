import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { BizData, Department, FormField, MetaForm, Profile, WizardStep } from '@/types';
import { stripSystemFields, syncLeaveByTimeField, validateField, evalFormulaExpression, buildCreatorScope, toChineseAmount } from '@/lib/field-catalog';
import type { ScopeContext } from '@/lib/field-catalog';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { FillFieldEditor } from './BizDetailDialog';
import { SubTableEditor, persistSubTableFields, subTableValidateValue } from './SubTableEditor';
import { materializeInlineRefs } from './FormRefEditor';
import { cn } from '@/lib/utils';

/** 可再提交的状态：草稿/已驳回保存后可发起审批 */
const RESUBMITTABLE = ['draft', 'rejected'];

/** 单据编辑弹窗：业务字段编辑 + 请假时间联动重算 + 保存/保存并提交审核，供审批待办/工作台复用 */
export function BizEditDialog({ open, biz, form, onClose, onSaved }: {
  open: boolean;
  biz: BizData | null;
  form: MetaForm | null;
  onClose: () => void;
  /** 保存成功后回调（刷新列表并关闭弹窗） */
  onSaved: () => void;
}) {
  const { profile, isSuperadmin, dataScope } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'department_id'>[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  // 向导表单分步状态（form_mode='wizard'）
  const [wizStep, setWizStep] = useState(0);

  // 加载数据范围上下文：用于子表等组件按角色/部门过滤
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

  // 打开/切换单据时以现有内容为底，并在 open 时从数据库重新拉取最新数据
  useEffect(() => {
    if (!biz) return;
    setDraft({ ...(biz.payload ?? {}) });
    setWizStep(0);
    if (!open) return;
    let alive = true;
    void supabase.from('biz_data').select('*').eq('id', biz.id).maybeSingle().then(({ data }) => {
      if (alive && data?.payload) {
        setDraft({ ...(data.payload as Record<string, unknown>) });
      }
    });
    return () => { alive = false; };
  }, [biz, open]);

  const fields = useMemo(() => ((form?.schema_json?.fields ?? []) as FormField[]), [form]);

  // 向导表单分步（form_mode='wizard'）：未分配字段归入最后一步
  const wizSteps = useMemo<WizardStep[]>(() => {
    const base = (form?.steps ?? []).map((s) => ({ ...s, fieldKeys: s.fieldKeys ?? [] }));
    const list = base.length > 0 ? base : [{ id: 'step_1', title: '第 1 步', fieldKeys: [] }];
    const assigned = new Set(list.flatMap((s) => s.fieldKeys));
    const unassigned = fields.filter((f) => !f.system && !assigned.has(f.key)).map((f) => f.key);
    if (unassigned.length > 0) list[list.length - 1] = { ...list[list.length - 1], fieldKeys: [...list[list.length - 1].fieldKeys, ...unassigned] };
    return list;
  }, [form?.steps, fields]);
  const isWizard = form?.form_mode === 'wizard' && wizSteps.length > 0;

  /** 向导下一步：仅校验当前步骤内字段 */
  const nextStep = () => {
    const st = wizSteps[wizStep];
    if (!st || !biz) return;
    for (const f of editFields) {
      if (!st.fieldKeys.includes(f.key)) continue;
      if (f.readOnly) continue;
      const val = f.type === 'sub-table' ? subTableValidateValue(draft[f.key]) : draft[f.key];
      const err = validateField(f, val);
      if (err) return toast.error(`${f.label}：${err}`);
    }
    setWizStep((i) => Math.min(i + 1, wizSteps.length - 1));
  };

  // 请假拆分配置：自动计算结果字段（只读）、拆分时间字段（由复合控件联动写入）
  const leaveResultKeys = useMemo(() => {
    const set = new Set<string>();
    fields.forEach((f) => {
      if (f.type === 'leave-time' && f.leaveTime) {
        if (f.leaveTime.hoursKey) set.add(f.leaveTime.hoursKey);
        if (f.leaveTime.daysKey) set.add(f.leaveTime.daysKey);
      }
    });
    return set;
  }, [fields]);
  const leaveEditKeys = useMemo(() => {
    const set = new Set<string>();
    fields.forEach((f) => {
      if (f.type === 'leave-time' && f.leaveTime) {
        if (f.leaveTime.startKey) set.add(f.leaveTime.startKey);
        if (f.leaveTime.endKey) set.add(f.leaveTime.endKey);
      }
    });
    return set;
  }, [fields]);

  // 假勤表单「个别销假」模块（field_14）不在编辑弹窗展示，统一在销假/填写节点弹窗处理
  const isLeaveForm = form?.id === '71229a1d-1ffa-4c25-b7fd-f1ea953f579d';
  // 可编辑字段：排除布局/关联/查询/系统字段、拆分时间字段（由请假时间复合控件联动）、个别销假字段（关联子表保留，单独分支渲染）
  const editFields = useMemo(
    () => fields.filter((f) => !['section', 'row', 'action-button', 'wizard-step', 'form-ref', 'query'].includes(f.type) && !f.system && !leaveEditKeys.has(f.key) && !(isLeaveForm && f.key === 'field_14')),
    [fields, leaveEditKeys, isLeaveForm],
  );

  // 公式计算/大写金额字段实时计算值（编辑弹窗无关联表单数据上下文，{ref.x} 引用不生效，仅当前表单字段引用）
  const calcVals = useMemo(() => {
    const out: Record<string, number | string | null> = {};
    editFields.forEach((f) => {
      if (f.type === 'formula' && (f.formula?.expression ?? f.defaultValue)) {
        out[f.key] = evalFormulaExpression(f.formula?.expression ?? f.defaultValue ?? '', draft, {});
      } else if (f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey) {
        out[f.key] = toChineseAmount(draft[f.uppercaseAmount.fieldKey] as number | string | null | undefined);
      }
    });
    return out;
  }, [editFields, draft]);

  /** 修改开始/结束时间：反向联动重算请假时长（复合值+拆分时间+小时/天数） */
  const syncTime = (key: string, v: unknown) => {
    const res = syncLeaveByTimeField(fields, draft, key, v);
    setDraft(res ? res.draft : { ...draft, [key]: v });
  };

  const save = async (submit: boolean) => {
    if (!biz || saving) return;
    // 必填校验（请假复合字段校验其拆分时间值；只读字段跳过校验）
    for (const f of editFields) {
      if (f.type === 'leave-time' && f.leaveTime?.startKey && f.leaveTime?.endKey) {
        for (const k of [f.leaveTime.startKey, f.leaveTime.endKey]) {
          if (!draft[k]) return toast.error(`${f.label}：请选择开始与结束时间`);
        }
        continue;
      }
      if (f.readOnly) continue;
      if (f.required) {
        const err = validateField(f, f.type === 'sub-table' ? subTableValidateValue(draft[f.key]) : draft[f.key]);
        if (err) return toast.error(`${f.label}：${err}`);
      }
    }
    setSaving(true);
    // 系统审计字段由数据库自动记录，剔除防止客户端伪造；查询组件只读不入库
    let payload = stripSystemFields(draft);
    // 公式计算/大写金额字段：以保存时点计算结果写入
    editFields.forEach((f) => {
      if ((f.type === 'formula' && (f.formula?.expression ?? f.defaultValue)) || (f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey)) {
        payload[f.key] = calcVals[f.key] ?? null;
      }
    });
    const queryKeys = new Set(fields.filter((f) => f.type === 'query').map((f) => f.key));
    payload = Object.fromEntries(Object.entries(payload).filter(([k]) => !queryKeys.has(k)));
    // 关联子表明细行持久化：软删移除行、写入新增/更新行，主表 payload 存行 id 数组（随主表保存模式内嵌物化）
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? '';
      const { data: me } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
      payload = await persistSubTableFields(fields, payload, { tenantId: (me as { tenant_id?: string } | null)?.tenant_id ?? '', userId: uid });
      payload = await materializeInlineRefs(fields, payload);
    } catch (e) {
      setSaving(false);
      return toast.error(e instanceof Error ? e.message : '子表明细保存失败');
    }
    const { error } = await supabase.from('biz_data').update({ payload, updated_at: new Date().toISOString() }).eq('id', biz.id);
    if (error) {
      setSaving(false);
      return toast.error('保存失败：' + error.message);
    }
    // 草稿/驳回状态可保存并提交：仅审批表单发起审批流程；普通/状态机表单保存即完成，不走审批
    if (submit && RESUBMITTABLE.includes(biz.status) && form?.form_mode === 'approval') {
      const { error: wfErr } = await supabase.rpc('start_biz_workflow', { p_biz_id: biz.id });
      setSaving(false);
      if (wfErr) return toast.error('发起审批失败：' + wfErr.message);
      toast.success('已发起审批');
    } else {
      setSaving(false);
      toast.success('已保存');
    }
    onSaved();
  };

  const canSubmit = !!biz && RESUBMITTABLE.includes(biz.status);

  return (
    <Dialog open={open && !!biz} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑{form?.name ? ` · ${form.name}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {editFields.filter((f) => !isWizard || (wizSteps[wizStep]?.fieldKeys ?? []).includes(f.key)).map((f) => {
            const requiredMark = f.required && !f.readOnly && <span className="text-destructive ml-0.5">*</span>;
            // 请假时间复合字段（已拆分）：渲染开始/结束日期时间控件，修改后联动重算时长
            if (f.type === 'leave-time' && f.leaveTime?.startKey && f.leaveTime?.endKey) {
              const startKey = f.leaveTime.startKey;
              const endKey = f.leaveTime.endKey;
              return (
                <div key={f.key} className="min-w-0 space-y-1.5 md:col-span-2">
                  <Label className="text-sm">{f.label}{requiredMark}</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <DateTimePicker mode="datetime" value={draft[startKey] ? String(draft[startKey]) : ''} onChange={(v) => syncTime(startKey, v)} placeholder="开始时间" />
                    <DateTimePicker mode="datetime" value={draft[endKey] ? String(draft[endKey]) : ''} onChange={(v) => syncTime(endKey, v)} placeholder="结束时间" />
                  </div>
                </div>
              );
            }
            // 请假时长结果字段：由时间自动计算，只读展示
            if (leaveResultKeys.has(f.key)) {
              return (
                <div key={f.key} className="min-w-0 space-y-1.5">
                  <Label className="text-sm">{f.label}</Label>
                  <Input value={draft[f.key] !== undefined && draft[f.key] !== null && draft[f.key] !== '' ? String(draft[f.key]) : ''} readOnly placeholder="由请假时间自动计算" className="bg-muted/30 sig-num" />
                </div>
              );
            }
            // 未拆分的请假复合字段：无可编辑控件，跳过（展示见详情弹窗）
            if (f.type === 'leave-time') return null;
            // 关联子表：内嵌可编辑明细列表（主表保存时统一持久化）
            if (f.type === 'sub-table') {
              return (
                <div key={f.key} className="min-w-0 space-y-1.5 md:col-span-2">
                  <Label className="text-sm">{f.label}{requiredMark}</Label>
                  <SubTableEditor field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} onMainRecalced={(patch) => setDraft((d) => ({ ...d, ...patch }))} readOnly={f.readOnly} scopeCtx={scopeCtx} mainBizId={biz?.id ?? null} />
                  {f.readOnly && <p className="text-[11px] text-muted-foreground">只读字段</p>}
                </div>
              );
            }
            return (
              <div key={f.key} className="min-w-0 space-y-1.5">
                <Label className="text-sm">{f.label}{requiredMark}</Label>
                <FillFieldEditor
                  field={f.readOnly ? { ...f, disabled: true } : f}
                  value={draft[f.key]}
                  calcValue={calcVals[f.key]}
                  onChange={f.readOnly ? () => {} : (v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                  onAssign={f.readOnly ? undefined : (assigned) => setDraft((d) => ({ ...d, ...assigned }))}
                  onChangeExtraRef={f.readOnly ? undefined : (key, v) => setDraft((d) => ({ ...d, [key]: v }))}
                  currentFormId={form?.id}
                  scopeCtx={scopeCtx}
                />
                {f.readOnly && <p className="text-[11px] text-muted-foreground">只读字段</p>}
              </div>
            );
          })}
        </div>
        {/* 向导表单步骤导航 */}
        {isWizard && (
          <div className="pt-4 border-t border-border mt-4 space-y-3">
            <div className="flex items-center">
              {wizSteps.map((st, i) => (
                <div key={st.id} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    onClick={() => i <= wizStep && setWizStep(i)}
                    className={cn('flex items-center gap-1.5 whitespace-nowrap', i < wizStep ? 'text-primary cursor-pointer' : i === wizStep ? 'text-foreground font-medium' : 'text-muted-foreground')}
                  >
                    <span className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                      i < wizStep ? 'bg-primary text-primary-foreground' : i === wizStep ? 'bg-primary/10 text-primary ring-1 ring-primary/40' : 'bg-muted text-muted-foreground',
                    )}>{i < wizStep ? <CheckCircle2 className="h-3 w-3" /> : i + 1}</span>
                    <span className="text-xs">{st.title}</span>
                  </button>
                  {i < wizSteps.length - 1 && <div className={cn('h-px flex-1 mx-2 min-w-4', i < wizStep ? 'bg-primary/60' : 'bg-border')} />}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setWizStep((i) => Math.max(0, i - 1))} disabled={wizStep === 0 || saving}>
                <ChevronLeft className="h-4 w-4 mr-1" />上一步
              </Button>
              {wizStep < wizSteps.length - 1 ? (
                <Button onClick={nextStep} disabled={saving}>下一步<ChevronRight className="h-4 w-4 ml-1" /></Button>
              ) : (
                <Button onClick={() => save(false)} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存</Button>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          {canSubmit && !isWizard && (
            <Button onClick={() => save(true)} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存并提交审核
            </Button>
          )}
          <Button variant={canSubmit && !isWizard ? 'outline' : 'default'} onClick={() => save(false)} disabled={saving}>
            {saving && !(canSubmit && !isWizard) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
