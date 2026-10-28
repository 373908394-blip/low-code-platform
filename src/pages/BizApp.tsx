import { CheckCircle2, ChevronDown, ChevronLeft, Clock, FileText, Loader2, MapPin, MoreHorizontal, PencilLine, Plus, Search, UserPlus, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AddressPicker, formatAddress } from '@/components/biz/AddressPicker';
import { FormAssignmentText, isMultiFieldSelect, RefOptionText } from '@/components/biz/BizDetailDialog';
import { DateRangeFilter } from '@/components/biz/DateRangeFilter';
import { FormAssignmentInput } from '@/components/biz/FormAssignmentInput';
import { FormRefEditor, FormRefViewer, materializeInlineRefs } from '@/components/biz/FormRefEditor';
import { MultiSearchSelect, SingleSearchSelect } from '@/components/biz/SearchSelects';
import { SmTransDialog } from '@/components/biz/SmTransDialogs';
import { inlineRefIds, isInlineRefValue, isSubTableDraftValue, persistSubTableFieldsEx, SubTableEditor, SubTableViewer, subTableValidateValue } from '@/components/biz/SubTableEditor';
import EntityPicker from '@/components/form/EntityPicker';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataPagination } from '@/components/ui/data-pagination';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { triggerBrowserPrint, downloadExcelViaEdgeFunction, materializeSubTables, resolveDisplayRows } from '@/lib/print-export';
import { type ActionContext, executeAction, passCond, setConfirmBridge } from '@/lib/action-engine';
import type { ScopeContext } from '@/lib/field-catalog';
import { aggregateRows, applyDisplayConditions, applyManualFilters, BIZ_STATUS_LABELS, buildCreatorScope, calcLeave, computeFormCalculations, ensureSystemFields, evalFetchValue, evalFormulaExpression, expandLeaveKeysForSubmit, fieldInitialValue, findFieldDef, fmtDate, fmtMoney, formatOptionFieldValue, isAuditSystemField, leaveTimeStr, normalizeWorkHours, optionDisplayKeys, SYSTEM_FIELD_KEYS, stripSystemFields, syncLeaveByTimeField, systemFieldValue, toChineseAmount, validateField } from '@/lib/field-catalog';
import { checkWfNodeGuards, evalSmGuards, type FormSmData } from '@/lib/status-machine';
import { checkUniqueFields } from '@/lib/unique-check';
import { withRetry } from '@/lib/withRetry';
import { MediaUploadField } from '@/components/biz/MediaUploadField';
import { RefAssignDialog } from '@/components/biz/RefAssignDialog';

// my_visible_biz_ids 结果内存缓存（模块级，跨组件实例共享）：key = `${formId}_${userId}`
// 任何时刻有缓存先用缓存渲染列表，同时后台始终调用 RPC 刷新，彻底避免 429 时空白列表
const bizVisCache = new Map<string, { ids: string[] }>();
import { cn } from '@/lib/utils';
import { evaluateVisibility } from '@/lib/visibility';
import { collectWfNodes, currentTurnOf } from '@/lib/workflow';
import type { ActionDef, BizApproval, BizData, DataRange, Department, FieldPermission, FormField, LeaveTimeValue, MetaForm, MetaRelation, Profile, Role, RuleItem, SerialRule, SmTransition, WfNode, WizardStep } from '@/types';
import { variantClass } from './design/ActionPanel';

const LAYOUT_TYPES = ['group-title', 'grid', 'divider', 'description', 'wizard-step'];
/** 比较 id 数组集合是否一致（关联子表/关联表单变更判定，与顺序无关；内嵌值取快照 ids） */
const sameRefIds = (a: unknown, b: unknown): boolean => {
  const norm = (v: unknown) => {
    if (isInlineRefValue(v)) return [...inlineRefIds(v)].sort().join(',');
    return Array.isArray(v) ? [...(v as string[])].sort().join(',') : '';
  };
  return norm(a) === norm(b);
};
/** 审计字段 key：创建人/创建时间/更新人/更新时间，详情与列表中默认折叠 */
const AUDIT_FIELD_KEYS = ['created_by', 'created_at', 'updated_by', 'updated_at'] as const;
type AuditKey = (typeof AUDIT_FIELD_KEYS)[number];
/** 系统默认字段（流水号）未配置规则时的兜底规则：前缀 SN + 日期 + 5 位计数 */
const DEFAULT_SERIAL_RULES: SerialRule[] = [
  { id: 'sys_fixed', type: 'fixed', value: 'SN' },
  { id: 'sys_date', type: 'date', format: 'yyyyMMdd' },
  { id: 'sys_counter', type: 'counter', digits: 5, pad: true, resetCycle: 'never', start: 1 },
];

import { resolveTextValue } from '@/pages/PageApp';
import type { TextSourceConfig } from '@/types';

/** 根据字段类型渲染输入控件 */
/** 单据/审批状态中文映射（优先使用 field-catalog 统一映射，本地保留兜底） */
const STATUS_LABEL: Record<string, string> = { ...BIZ_STATUS_LABELS };
const statusLabel = (s?: string | null) => STATUS_LABEL[s ?? ''] ?? s ?? '—';
const statusData = (s?: string | null) => (s === 'approved' || s === 'completed' ? 'passed' : s === 'rejected' ? 'failed' : s === 'draft' ? 'draft' : 'running');

/** 请假时间展示：仅显示开始日期+时间点、结束日期+时间点（天数/小时已由独立字段单独存储，此处不再重复） */
const fmtLeave = (v: LeaveTimeValue): string => {
  const t = (h?: number) => (h === undefined || h === null ? '' : `${String(h).padStart(2, '0')}:00`);
  const parts: string[] = [];
  if (v.start_date) parts.push(`开始 ${v.start_date}${v.start_time !== undefined ? ' ' + t(v.start_time) : ''}`);
  if (v.end_date) parts.push(`结束 ${v.end_date}${v.end_time !== undefined ? ' ' + t(v.end_time) : ''}`);
  return parts.join('，') || '—';
};

function FieldControl({ field, value, onChange, onChangeExtra, disabled, departments, refOptions, refSrcRows, members, queryRows, queryMeta, sysValue, queryFilterVals, onQueryFilterChange, calcVals, currentFormId, scopeCtx, smStates }: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  /** 额外联动写入其他字段（如请假时长同步到独立字段） */
  onChangeExtra?: (key: string, v: unknown) => void;
  disabled?: boolean;
  departments: Department[];
  refOptions: Record<string, { id: string; label: string }[]>;
  /** 下拉动态数据源多字段拼接的完整记录（选项值为记录 id）：分字段引用存储与回显用 */
  refSrcRows: Record<string, BizData[]>;
  members: { id: string; name: string; position?: string; department_id?: string | null }[];
  queryRows: Record<string, BizData[]>;
  queryMeta: Record<string, MetaForm>;
  /** 系统字段取值函数（查询组件展示系统字段时使用） */
  sysValue?: (key: string, r: BizData) => unknown;
  /** 查询表单手动筛选值 */
  queryFilterVals?: Record<string, string>;
  onQueryFilterChange?: (key: string, v: string) => void;
  /** 公式计算/汇总统计/关联取值字段的实时计算值 */
  calcVals?: Record<string, unknown>;
  /** 当前表单 id（表单赋值组件「当前表单」来源兜底） */
  currentFormId?: string;
  /** 数据范围上下文：用于表单赋值等组件按角色/部门过滤候选数据 */
  scopeCtx?: ScopeContext;
  /** 状态机状态表（system-status 组件下拉选项与默认值用） */
  smStates?: Map<string, { label: string; color?: string }>;
}) {
  const common = { disabled: disabled || field.disabled, placeholder: field.placeholder ?? '' };
  // 选项联动赋值：当本字段取某值时，将指定值写入其他字段
  const applyAssign = (next: unknown) => {
    const rules = field.valueAssign;
    if (!rules || rules.length === 0) return;
    const isMulti = field.type === 'checkbox' || field.type === 'multi-select';
    rules.forEach((rule) => {
      if (!rule.whenValue || !rule.targetKey) return;
      const matched = isMulti ? Array.isArray(next) && (next as string[]).includes(rule.whenValue) : next === rule.whenValue;
      if (matched) onChangeExtra?.(rule.targetKey, rule.value);
    });
  };
  // 关联表单下拉选项：选中后将被引用的目标字段值以 ref_{组件标识}_{目标字段标识} 前缀分字段写入当前表单
  const applyRefStore = (next: unknown) => {
    const multiKeys = optionDisplayKeys(field);
    if (multiKeys.length === 0 || !field.optionSource?.formId) return;
    const rows = refSrcRows[field.key] ?? [];
    const writeRef = (id: string | null) => {
      const rec = id ? rows.find((r) => r.id === id) : undefined;
      for (const k of multiKeys) {
        const v = (rec?.payload as Record<string, unknown> | undefined)?.[k];
        onChangeExtra?.(`ref_${field.key}_${k}`, v ?? null);
      }
    };
    if (Array.isArray(next)) (next as (string | null)[]).forEach((id) => writeRef(id ?? null));
    else writeRef((next as string | null) ?? null);
  };
  // 选项选择统一入口：联动赋值 + 多字段拼接引用存储
  const selectValue = (next: unknown) => { onChange(next); applyAssign(next); applyRefStore(next); };
  switch (field.type) {
    case 'phone':
      return <Input type="tel" inputMode="numeric" maxLength={11} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))} {...common} />;
    case 'textarea':
    case 'richtext':
      return <Textarea className="min-h-20" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'number':
    case 'money':
    case 'percent':
      return <Input type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} {...common} />;
    case 'formula': {
      // 配置了计算公式即只读展示实时计算值（系统预置与自定义字段一致；引用字段未填完整时显示空）
      const expr = field.formula?.expression ?? field.defaultValue;
      if (expr) {
        const shown = calcVals?.[field.key];
        return <Input type="number" readOnly value={shown !== undefined && shown !== null ? Number(shown) : ''} className="bg-muted/30" placeholder="自动计算" disabled={common.disabled} />;
      }
      return <Input type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} {...common} />;
    }
    case 'summary': {
      // 汇总统计：配置了汇总规则即只读展示自动统计值（系统预置与自定义字段一致）
      if (field.summary) {
        const shown = calcVals?.[field.key];
        return <Input readOnly value={shown !== undefined && shown !== null ? String(shown) : ''} className="bg-muted/30" placeholder="自动统计" disabled={common.disabled} />;
      }
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    }
    case 'amount-uppercase': {
      // 大写金额：只读展示关联金额字段的中文大写换算结果（实时跟随，保存时写入）
      const shown = calcVals?.[field.key];
      return <Input readOnly value={shown !== undefined && shown !== null ? String(shown) : ''} className="bg-muted/30" placeholder="自动换算" disabled={common.disabled} />;
    }
    case 'fetch-value': {
      // 关联取值：配置了取值规则即只读展示自动取值（系统预置与自定义字段一致）
      if (field.fetchValue) {
        const shown = calcVals?.[field.key];
        return <Input readOnly value={shown !== undefined && shown !== null ? String(shown) : ''} className="bg-muted/30" placeholder="自动取值" disabled={common.disabled} />;
      }
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    }
    case 'form-assignment':
      return (
        <FormAssignmentInput
          field={field}
          value={value}
          onChange={(v) => onChange(v)}
          onAssign={(assignedMap) => {
            Object.entries(assignedMap).forEach(([k, v]) => {
              onChangeExtra?.(k, v);
            });
          }}
          disabled={common.disabled}
          placeholder={field.placeholder ?? '点击选择关联数据'}
          currentFormId={currentFormId}
          scopeCtx={scopeCtx}
        />
      );
    case 'date':
      return <DateTimePicker mode="date" value={(value as string) ?? ''} onChange={(v) => onChange(v)} disabled={common.disabled} placeholder="选择日期" />;
    case 'time':
      return <DateTimePicker mode="time" value={(value as string) ?? ''} onChange={(v) => onChange(v)} disabled={common.disabled} placeholder="选择时间" />;
    case 'datetime':
      return <DateTimePicker mode="datetime" value={(value as string) ?? ''} onChange={(v) => onChange(v)} disabled={common.disabled} placeholder="选择日期时间" />;
    case 'search-select': {
      const opts = field.optionSource?.formId ? (refOptions[field.key] ?? []) : (field.options ?? []).map((o) => ({ id: o, label: o }));
      return (
        <SingleSearchSelect
          disabled={common.disabled}
          placeholder={field.placeholder ?? '请选择（可搜索）'}
          options={opts}
          value={(value as string) ?? ''}
          onChange={(v) => selectValue(v || null)}
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
      const opts = field.optionSource?.formId ? (refOptions[field.key] ?? []) : (field.options ?? []).map((o) => ({ id: o, label: o }));
      return (
        <Select disabled={common.disabled} value={(value as string) ?? 'none'} onValueChange={(v) => selectValue(v === 'none' ? null : v)}>
          <SelectTrigger><SelectValue placeholder={field.placeholder ?? '请选择'} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未选择</SelectItem>            {opts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case 'system-status': {
      // 系统状态下拉：选项读取状态机状态；默认显示系统 status 字段值，变更时同步写入 status
      const stOpts = Array.from((smStates ?? new Map()).entries()).map(([key, info]) => ({ id: key, label: info.label }));
      return (
        <Select disabled={common.disabled} value={(value as string) ?? 'none'} onValueChange={(v) => onChange(v === 'none' ? null : v)}>
          <SelectTrigger><SelectValue placeholder="请选择状态" /></SelectTrigger>
          <SelectContent>
            {stOpts.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">状态机未配置状态</p>}
            {stOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case 'user-select':
      return (
        <EntityPicker
          options={members.map((m) => ({ id: m.id, label: m.name, sub: m.position }))}
          value={value}
          multi={field.multi}
          onChange={onChange}
          disabled={common.disabled}
          placeholder={field.placeholder ?? '请选择人员'}
        />
      );
    case 'dept-select':
      return (
        <EntityPicker
          options={departments.map((d) => ({ id: d.id, label: d.name, sub: departments.find((p) => p.id === d.parent_id)?.name }))}
          value={value}
          multi={field.multi}
          onChange={onChange}
          disabled={common.disabled}
          placeholder={field.placeholder ?? '请选择部门'}
        />
      );
    case 'query': {
      const meta = queryMeta[field.key];
      const cols = (field.query?.displayFields ?? []).length > 0
        ? field.query!.displayFields!
        : (meta?.schema_json?.fields ?? []).filter((x: FormField) => !x.system && x.type !== 'action-button').slice(0, 4).map((x) => x.key);
      // 应用手动筛选
      const manualFilters = field.query?.manualFilters ?? [];
      const filteredRows = applyManualFilters(
        (queryRows[field.key] ?? []) as unknown as Record<string, unknown>[],
        queryFilterVals ?? {},
        manualFilters,
        field.query?.manualFiltersLogic ?? 'and',
      ) as unknown as BizData[];
      const rows = filteredRows;
      if (!meta) return <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">关联数据源不可用</div>;
      return (
        <div className="space-y-2">
          {manualFilters.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2 bg-muted/30">
              {manualFilters.map((mf) => (
                <div key={mf.id} className="flex flex-col gap-1 min-w-[120px]">
                  <span className="text-[11px] text-muted-foreground">{mf.label || queryFieldLabel(meta, mf.fieldKey)}</span>
                  {mf.control === 'select' ? (
                    <Select value={queryFilterVals?.[mf.fieldKey] ?? ''} onValueChange={(v) => onQueryFilterChange?.(mf.fieldKey, v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="全部" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部</SelectItem>
                        {(mf.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : mf.control === 'date-range' ? (
                    <DateRangeFilter
                      size="default"
                      value={queryFilterVals?.[mf.fieldKey] ?? ''}
                      onChange={(v) => onQueryFilterChange?.(mf.fieldKey, v)}
                    />
                  ) : (
                    <Input
                      className="h-8 text-xs px-2"
                      placeholder="筛选"
                      value={queryFilterVals?.[mf.fieldKey] ?? ''}
                      onChange={(e) => onQueryFilterChange?.(mf.fieldKey, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">暂无关联数据</div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>{cols.map((k) => <th key={k} className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium text-muted-foreground">{queryFieldLabel(meta, k)}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      {cols.map((k) => <td key={k} className="whitespace-nowrap px-2.5 py-1.5 text-foreground">{queryCellValue(meta, r, k, sysValue)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }
    case 'multi-select':
    case 'search-multi-select': {
      const opts = field.optionSource?.formId ? (refOptions[field.key] ?? []) : (field.options ?? []).map((o) => ({ id: o, label: o }));
      const cur = Array.isArray(value) ? (value as string[]) : [];
      // 带搜索的下拉多选：搜索过滤 + 多选标签（数据与行为同下拉多选）
      if (field.type === 'search-multi-select') {
        return (
          <MultiSearchSelect
            disabled={common.disabled}
            placeholder={field.placeholder ?? '请选择（可搜索）'}
            options={opts}
            value={cur}
            onChange={(next) => selectValue(next)}
          />
        );
      }
      return (
        <Select disabled={common.disabled} value="none" onValueChange={(v) => { if (v !== 'none' && !cur.includes(v)) { const next = [...cur, v]; selectValue(next); } }}>
          <SelectTrigger><SelectValue placeholder={field.placeholder ?? '请选择'} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未选择</SelectItem>
            {opts.filter((o) => !cur.includes(o.id)).map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case 'serial-number':
      return (
        <Input
          {...common}
          value={value ? String(value) : ''}
          placeholder={field.system ? '保存时自动生成' : (field.placeholder || '提交时自动生成')}
          readOnly
          className="bg-muted/30"
        />
      );
    case 'leave-time': {
      const wh = normalizeWorkHours(field.workHours);
      const v = (value as LeaveTimeValue) ?? {};
      const pt = (h: number) => `${String(h).padStart(2, '0')}:00`;
      // 开始时间点：上午/下午上班整点；结束时间点：上午/下午下班整点
      const startOpts = [wh.amStart, wh.pmStart];
      const endOpts = [wh.amEnd, wh.pmEnd];
      const upd = (patch: Partial<LeaveTimeValue>) => {
        const next = { ...v, ...patch };
        const c = calcLeave(next, field.workHours);
        const withCalc = c ? { ...next, hours: c.hours, days: c.days } : next;
        onChange(withCalc);
        // 同步写入绑定的开始/结束时间与请假小时/天数独立字段（业务层面拆分存储）
        const s = leaveTimeStr(withCalc, 'start');
        const e = leaveTimeStr(withCalc, 'end');
        if (field.leaveTime?.startKey && s) onChangeExtra?.(field.leaveTime.startKey, s);
        if (field.leaveTime?.endKey && e) onChangeExtra?.(field.leaveTime.endKey, e);
        if (field.leaveTime?.hoursKey && c) onChangeExtra?.(field.leaveTime.hoursKey, c.hours);
        if (field.leaveTime?.daysKey && c) onChangeExtra?.(field.leaveTime.daysKey, c.days);
      };
      const calc = calcLeave(v, field.workHours);
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <DateTimePicker mode="date" value={v.start_date ?? ''} onChange={(d) => upd({ start_date: d || undefined })} disabled={common.disabled} placeholder="开始日期" />
            <Select disabled={common.disabled} value={v.start_time !== undefined ? String(v.start_time) : 'none'} onValueChange={(x) => upd({ start_time: x === 'none' ? undefined : Number(x) })}>
              <SelectTrigger><SelectValue placeholder="开始时间点" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未选择</SelectItem>
                {startOpts.map((h) => <SelectItem key={h} value={String(h)}>{pt(h)}</SelectItem>)}
              </SelectContent>
            </Select>
            <DateTimePicker mode="date" value={v.end_date ?? ''} onChange={(d) => upd({ end_date: d || undefined })} disabled={common.disabled} placeholder="结束日期" />
            <Select disabled={common.disabled} value={v.end_time !== undefined ? String(v.end_time) : 'none'} onValueChange={(x) => upd({ end_time: x === 'none' ? undefined : Number(x) })}>
              <SelectTrigger><SelectValue placeholder="结束时间点" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未选择</SelectItem>
                {endOpts.map((h) => <SelectItem key={h} value={String(h)}>{pt(h)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className={cn('flex items-center justify-between rounded-md border px-3 py-2 text-xs', calc ? 'border-primary/40 bg-primary/5 text-primary' : 'border-dashed border-border text-muted-foreground')}>
            <span>{calc ? `请假 ${calc.hours} 小时 ≈ ${calc.days} 天` : '填写时间段后自动计算时长'}</span>
            <span className="text-muted-foreground">{`工时 ${pt(wh.amStart)}-${pt(wh.amEnd)} / ${pt(wh.pmStart)}-${pt(wh.pmEnd)}`}</span>
          </div>
        </div>
      );
    }
    case 'radio': {
      const opts = (field.options ?? []).map((o) => ({ id: o, label: o }));
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-border min-h-10 px-3 py-2">
          {opts.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name={`radio_${field.key}`}
                className="h-4 w-4 accent-primary"
                checked={value === o.id}
                disabled={common.disabled}
                onChange={() => { onChange(o.id); applyAssign(o.id); }}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case 'checkbox':
    case 'multi-select':
    case 'checkbox-group':
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-border min-h-10 px-3 py-2">
          {(field.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={Array.isArray(value) && (value as string[]).includes(o)}
                onCheckedChange={(c) => { const next = c ? [...((value as string[]) ?? []), o] : ((value as string[]) ?? []).filter((x) => x !== o); onChange(next); applyAssign(next); }}
              />
              {o}
            </label>
          ))}
        </div>
      );
    case 'switch':
      return <Checkbox checked={value === true} onCheckedChange={(c) => onChange(c === true)} disabled={common.disabled} />;
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
    case 'location': {
      // 定位：浏览器 Geolocation 获取经纬度 + 地址文本；有值时显示地图链接
      const locVal = (value as string) ?? '';
      const acquiring = locVal === '__acquiring__';
      return (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              value={acquiring ? '定位中…' : locVal}
              onChange={(e) => onChange(e.target.value)}
              placeholder="点击右侧按钮获取定位"
              readOnly={acquiring}
              className="h-9 w-full"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 px-3"
              disabled={common.disabled || acquiring}
              onClick={() => {
                if (!navigator.geolocation) return toast.error('当前浏览器不支持定位');
                onChange('__acquiring__');
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const { latitude, longitude } = pos.coords;
                    onChange(`${latitude.toFixed(6)},${longitude.toFixed(6)}`);
                  },
                  (err) => { onChange(''); toast.error('定位失败：' + err.message); },
                  { timeout: 10_000, enableHighAccuracy: false },
                );
              }}
            >
              <MapPin className="h-3.5 w-3.5 mr-1" />
              定位
            </Button>
          </div>
          {!acquiring && locVal && /-?\d+\.\d+,-?\d+\.\d+/.test(locVal) && (
            <a
              href={`https://uri.amap.com/marker?position=${locVal.split(',')[1]},${locVal.split(',')[0]}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              在地图中查看
            </a>
          )}
        </div>
      );
    }
    default:
      // 系统审计字段：只读展示，保存时由数据库自动记录
      if (field.system) {
        return (
          <Input
            {...common}
            value={value ? String(value) : ''}
            placeholder="保存时自动记录"
            readOnly
            className="bg-muted/30"
          />
        );
      }
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
  }
}

/** 查询表单组件：目标表单字段标题 */
function queryFieldLabel(meta: MetaForm, key: string): string {
  const f = meta.schema_json?.fields?.find((x: FormField) => x.key === key);
  return f?.label ?? key;
}

/** 查询表单组件：目标表单字段单元格值（含系统字段，由 sysValue 派生） */
function queryCellValue(meta: MetaForm, r: BizData, key: string, sysValue?: (key: string, r: BizData) => unknown): string {
  let v: unknown = r.payload?.[key];
  if (v === undefined && SYSTEM_FIELD_KEYS.includes(key as (typeof SYSTEM_FIELD_KEYS)[number])) {
    v = sysValue?.(key, r);
  }
  if (v === undefined || v === null || v === '') return '—';
  if ((key === 'created_at' || key === 'updated_at') && typeof v === 'string') return fmtDate(v, true);
  const tf = meta.schema_json?.fields?.find((x: FormField) => x.key === key);
  if (tf?.type === 'money' && typeof v === 'number') return fmtMoney(v);
  if (tf?.type === 'date') return fmtDate(String(v));
  if (tf?.type === 'datetime') return fmtDate(String(v), true);
  if (tf?.type === 'percent' && typeof v === 'number') return `${v}%`;
  if (Array.isArray(v)) return v.join('、');
  return String(v);
}

export default function BizApp() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // 路由模式解析（通配路由 /app/:formId/*，组件常驻不卸载，列表筛选/数据天然保留）：
  // /app/:fid 列表 | /app/:fid/new 新增 | /app/:fid/:bizId 详情 | /app/:fid/:bizId/edit 编辑
  const routeMode = useMemo(() => {
    const segs = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const rest = segs.slice(2);
    if (rest.length === 0) return { mode: 'list' as const, bizId: null as string | null };
    if (rest[0] === 'new') return { mode: 'new' as const, bizId: null as string | null };
    if (rest.length >= 2 && rest[1] === 'edit') return { mode: 'edit' as const, bizId: rest[0] };
    if (rest.length === 1) return { mode: 'view' as const, bizId: rest[0] };
    return { mode: 'list' as const, bizId: null as string | null };
  }, [location.pathname]);
  /** 返回列表页（保留筛选与分页状态） */
  const backToList = () => navigate(`/app/${formId}`);
  /** 面包屑「返回」：优先浏览器历史返回，无来源时回列表页 */
  const breadcrumbBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(`/app/${formId}`);
  };
  const { profile, hasPermission, isSuperadmin, dataScope } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [form, setForm] = useState<MetaForm | null>(null);
  /** 面包屑第一段：当前表单所属一级模块名（从 meta_menu 解析） */
  const [breadcrumbModule, setBreadcrumbModule] = useState('');
  // 加载令牌：快速切换路由时丢弃过期请求的结果，避免竞态导致“应用不存在”
  const loadTokenRef = useRef(0);
  const [rows, setRows] = useState<BizData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [searchVals, setSearchVals] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<BizData | null>(null);
  // 直接链接进入编辑/详情页时，目标行不在当前列表：单查兜底后标记（用于渲染「未找到」空态）
  const [routeRowMissing, setRouteRowMissing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<BizData | null>(null);
  const [approvals, setApprovals] = useState<BizApproval[]>([]);
  // 系统操作日志（非审批表单详情页底部展示）：时间/操作人姓名/操作内容
  const [bizLogs, setBizLogs] = useState<Array<{ id: string; created_at: string; user_name: string | null; action: string; target: string | null; detail: Record<string, unknown> | null }>>([]);
  const loadBizLogs = useCallback(async (bizId: string) => {
    const { data } = await supabase
      .from('audit_logs')
      .select('id, created_at, user_name, action, target, detail')
      .contains('detail', { biz_id: bizId })
      .order('created_at', { ascending: false })
      .limit(50);
    setBizLogs((data as Array<{ id: string; created_at: string; user_name: string | null; action: string; target: string | null; detail: Record<string, unknown> | null }>) ?? []);
  }, []);
  // 记录系统操作日志（普通表单保存/删除等操作统一落 audit_logs，详情页底部展示）
  // 写操作日志：失败（含 429 限流）时用 withRetry 重试，仍失败则提示用户避免日志静默丢失
  const writeBizLog = useCallback(async (bizId: string, action: string, bizTitle?: string | null) => {
    if (!profile?.tenant_id) return;
    const { error } = await withRetry(() => supabase.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: profile.id,
      user_name: profile.name,
      action,
      target: bizTitle || form?.name || bizId,
      detail: { biz_id: bizId },
    }));
    if (error) toast.error('操作日志写入失败：' + error.message);
  }, [profile, form?.name]);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);
  // 动作引擎状态
  const [actionDefs, setActionDefs] = useState<ActionDef[]>([]);
  const [relations, setRelations] = useState<MetaRelation[]>([]);
  const [smTrans, setSmTrans] = useState<SmTransition[]>([]);
  // 已关联且配置了字段赋值映射的主表字段：编辑页只读不可编辑（赋值后锁定，新建未关联时可编辑）
  // 来源 1：meta_relations 字段映射；来源 2：状态机「新增关联表单」的 fieldMappings（主表字段赋值）
  const relAssignedReadonlyKeys = useMemo(() => {
    const s = new Set<string>();
    const payload = (editing?.payload ?? draft ?? {}) as Record<string, unknown>;
    for (const rel of relations) {
      if (rel.source_form_id !== formId || !(rel.field_mappings ?? []).length) continue;
      const linked = payload[rel.backfill_field];
      if (Array.isArray(linked) && linked.length > 0) (rel.field_mappings ?? []).forEach((m) => { if (m.mainKey) s.add(m.mainKey); });
    }
    // 状态机新增关联表单：配置了 fieldMappings 且已产生关联记录（回填字段有值）时锁定主表字段
    const nrBackfills = new Map<string, string>();
    for (const t of smTrans) {
      const nr = t.interaction?.newRelated;
      if (!nr) continue;
      const bfs = nr.backfillFields ?? {};
      for (const tid of nr.targetFormIds ?? (nr.targetFormId ? [nr.targetFormId] : [])) {
        const bf = bfs[tid];
        if (bf) nrBackfills.set(tid, bf);
      }
    }
    for (const bf of nrBackfills.values()) {
      const linked = payload[bf];
      if (!Array.isArray(linked) || linked.length === 0) continue;
      for (const t of smTrans) {
        for (const m of t.interaction?.newRelated?.fieldMappings ?? []) {
          if (m.mainKey) s.add(m.mainKey);
        }
      }
    }
    return s;
  }, [relations, formId, editing, draft, smTrans]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmState, setConfirmState] = useState<{ text: string; resolve: (v: boolean) => void } | null>(null);
  // 关联弹窗状态
  const [relatedDlg, setRelatedDlg] = useState<{ relation: MetaRelation; row: BizData; mode: 'select' | 'view' | 'unlink' } | null>(null);
  const [relatedRows, setRelatedRows] = useState<BizData[]>([]);
  const [relatedSel, setRelatedSel] = useState<string[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string; position?: string; department_id?: string | null }[]>([]);
  const [refOptions, setRefOptions] = useState<Record<string, { id: string; label: string }[]>>({});
  // 下拉多字段拼接数据源的完整记录缓存（fieldKey -> 记录列表）：保存分字段引用存储与选中回显用
  const [refSrcRows, setRefSrcRows] = useState<Record<string, BizData[]>>({});
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());
  // 系统字段取值映射（员工姓名/所属部门/职位依赖创建人档案与部门表）
  const [profileMap, setProfileMap] = useState<Map<string, { name: string; position?: string | null; department_id?: string | null }>>(new Map());
  // 角色映射：审批人可能是角色 id，展示审批流转时转角色名
  const [roleMap, setRoleMap] = useState<Map<string, string>>(new Map());
  const [deptMap, setDeptMap] = useState<Map<string, string>>(new Map());
  // 当前列表页各行的待处理节点（填写按钮/当前审批人判定）
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, BizApproval[]>>({});
  // 填写节点确认弹窗（审批记录 + 单据行）
  const [fillAppr, setFillAppr] = useState<{ appr: BizApproval; row: BizData } | null>(null);
  const [fillDraft, setFillDraft] = useState<Record<string, unknown>>({});
  const [filling, setFilling] = useState(false);
  // 流程节点字段权限：node_id → { 字段key: 权限 }（审批/填写弹窗按节点权限区分只读与可编辑）
  const [wfNodePerms, setWfNodePerms] = useState<Map<string, Record<string, FieldPermission>>>(new Map());
  // 流程填写节点守卫条件：node_id → RuleItem[]（提交时逐条评估，全部满足才能流转下一节点）
  const [wfNodeGuards, setWfNodeGuards] = useState<Map<string, RuleItem[]>>(new Map());
  // 状态机状态：key → { label, color }（自定义状态展示用）
  const [smStates, setSmStates] = useState<Map<string, { label: string; color?: string }>>(new Map());
  // 状态机流转交互弹窗（SM_TRANSITION 动作触发：人员分配/内容提交/内容确定）
  const [smDlg, setSmDlg] = useState<{ transition: SmTransition; row: BizData; def: ActionDef } | null>(null);
  // 转移给他人/分配弹窗：选择接收人后把单据移交给其处理
  const [transferDlg, setTransferDlg] = useState<{ def: ActionDef; row: BizData } | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferUserId, setTransferUserId] = useState('');
  // 新增备注弹窗（REMARK 动作）：填写备注内容后写入操作日志
  const [remarkDlg, setRemarkDlg] = useState<{ def: ActionDef; row: BizData } | null>(null);
  const [remarkText, setRemarkText] = useState('');
  // 当前用户角色（角色池认领判定用；data_scope 用于数据范围「跟随权限」解析）
  const [myRoles, setMyRoles] = useState<{ id: string; name: string; data_scope: string }[]>([]);
  // 状态文本：优先使用状态机自定义 label，其次内置标签，最后原样返回
  const statusText = (s?: string | null) => smStates.get(s ?? '')?.label ?? statusLabel(s);
  const statusColor = (s?: string | null) => smStates.get(s ?? '')?.color;
  // 状态机守卫条件评估（列表流转按钮可用性）：按当前行数据评估绑定转换的守卫条件
  const smGuardsPass = (row: BizData | null | undefined, transitionId: string | undefined): boolean => {
    if (!transitionId || !row || !form) return true;
    const tr = smTrans.find((x) => x.id === transitionId);
    if (!tr || !tr.guards || tr.guards.length === 0) return true;
    const fm: FormSmData = { states: smStates, transitions: [] };
    return evalSmGuards(tr.guards, row, form.id, new Map([[form.id, fm]]));
  };
  // 普通表单无系统默认状态（草稿/审批中等）：详情弹窗不显示系统状态徽标；列表状态列统一由「列表设计-列表显示」勾选控制
  const showSysStatus = form?.form_mode !== 'normal';

  // 当前用户角色列表（字段权限表达式 + 角色池认领判定用）；超管权限由 isSuperadmin 变量单独表达
  useEffect(() => {
    if (!profile?.id || isSuperadmin) { setMyRoles([]); return; }
    let alive = true;
    void supabase.from('user_roles').select('roles(id, name, data_scope)').eq('user_id', profile.id).then(({ data }) => {
      if (!alive) return;
      setMyRoles((((data as unknown as { roles: { id: string; name: string; data_scope: string } }[] | null) ?? []).map((x) => x.roles)).filter(Boolean));
    });
    return () => { alive = false; };
  }, [profile?.id, isSuperadmin]);

  const statusBadgeStyle = (s?: string | null) => {
    const c = statusColor(s);
    return c ? { color: c, borderColor: `${c}40`, backgroundColor: `${c}15` } : undefined;
  };

  // 数据范围上下文：供表单赋值、关联取值等组件按角色/部门过滤候选数据
  const scopeCtx: ScopeContext = useMemo(() => ({
    permissionScope: isSuperadmin ? 'all' : dataScope,
    profile: { id: profile?.id ?? '', department_id: profile?.department_id ?? null },
    departments,
    profiles: members.map((m) => ({ id: m.id, department_id: m.department_id ?? null })),
  }), [isSuperadmin, dataScope, profile, departments, members]);
  // 审批操作弹窗：先展示全部字段内容，确认后提交（approve 可同时写入可编辑字段值）
  const [approveDialog, setApproveDialog] = useState<{ action: 'approve' | 'reject'; appr: BizApproval; row: BizData } | null>(null);
  const [apprDraft, setApprDraft] = useState<Record<string, unknown>>({});
  // 查询表单组件：目标表单数据与元数据（按当前申请人自动查询）
  const [queryRows, setQueryRows] = useState<Record<string, BizData[]>>({});
  const [queryMeta, setQueryMeta] = useState<Record<string, MetaForm>>({});
  // 关联表单目标数据：fieldKey -> 目标表单数据行（用于子列表展示与选择弹窗）
  const [refRows, setRefRows] = useState<Record<string, BizData[]>>({});
  // 汇总统计（当前表单来源）全量记录（≤500 条，不随列表筛选分页变化）
  const [summaryRows, setSummaryRows] = useState<Array<{ payload?: Record<string, unknown> }>>([]);
  // 关联取值（指定表单来源）目标表单数据：formId -> 数据行（≤500 条）
  const [formRowsCache, setFormRowsCache] = useState<Record<string, Array<{ payload?: Record<string, unknown>; created_at?: string; created_by?: string }>>>({});
  // 当前打开单据的子表明细已存行（payload 存行 id 数组时按 id 查出，供汇总统计/关联取值计算）
  const [subRowsCache, setSubRowsCache] = useState<Record<string, BizData[]>>({});
  // 关联表单目标表单元数据：fieldKey -> 目标表单（用于复用其列表列与筛选项）
  const [refFormMeta, setRefFormMeta] = useState<Record<string, MetaForm>>({});
  // 关联表单选择弹窗状态
  const [refPicker, setRefPicker] = useState<{ field: FormField } | null>(null);
  const [refPickerSel, setRefPickerSel] = useState<string[]>([]);
  // 按钮关联表单赋值弹窗：当前触发的按钮字段
  const [refAssignField, setRefAssignField] = useState<FormField | null>(null);
  // 关联表单目标表单的状态机映射：fieldKey/targetFormId -> Map<stateKey, { label: string }>
  const [refSmStates, setRefSmStates] = useState<Record<string, Map<string, { label: string }>>>({});
  // 关联表单选择弹窗：目标表单数据源下拉字段的源表单记录缓存（源表单 id → 记录行，所属项目等 id→显示文本解析用）
  const [refPickerSrcRows, setRefPickerSrcRows] = useState<Record<string, BizData[]>>({});
  // 弹窗打开时按目标表单的数据源下拉字段配置与状态机预取兜底
  useEffect(() => {
    const f = refPicker?.field;
    if (!f) return;
    const targetMeta = refFormMeta[f.key];
    const targetFormId = f.relation?.formId;
    let alive = true;
    // 兜底补拉目标表单状态机（若 load 未能覆盖）
    if (targetFormId && !refSmStates[f.key] && !refSmStates[targetFormId]) {
      void supabase.from('meta_state_machine').select('states').eq('form_id', targetFormId).maybeSingle().then(({ data }) => {
        if (!alive || !data?.states) return;
        const smMap = new Map((data.states as Array<{ key: string; label: string }>).map((s) => [s.key, { label: s.label }]));
        setRefSmStates((prev) => ({ ...prev, [f.key]: smMap, [targetFormId]: smMap }));
      });
    }
    // 兜底补拉目标表单数据源下拉源记录
    const srcIds = [...new Set(((targetMeta?.schema_json?.fields ?? []) as FormField[])
      .filter((x) => (x.type === 'select' || x.type === 'multi-select' || x.type === 'search-select' || x.type === 'search-multi-select') && x.optionSource?.formId)
      .map((x) => x.optionSource!.formId!))];
    if (srcIds.length === 0) return;
    void Promise.all(srcIds.map(async (sid) => {
      const { data } = await supabase.from('biz_data').select('*').eq('form_id', sid).eq('is_deleted', false).limit(500);
      return [sid, ((data as BizData[]) ?? [])] as const;
    })).then((pairs) => {
      if (alive) setRefPickerSrcRows((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => { alive = false; };
  }, [refPicker?.field, refFormMeta, refSmStates]);
  // 关联表单选择弹窗的搜索值（复用目标表单筛选项）
  const [refPickerSearch, setRefPickerSearch] = useState<Record<string, string>>({});
  // 关联表单选择弹窗：手动筛选值
  const [refPickerManual, setRefPickerManual] = useState<Record<string, string>>({});
  // 查询表单组件：手动筛选值（fieldKey -> 筛选值）
  const [queryFilterVals, setQueryFilterVals] = useState<Record<string, string>>({});

  // 分栏布局组件每栏解析值（fieldKey -> 每栏值数组）
  const [gridValues, setGridValues] = useState<Record<string, string[]>>({});
  // 表单字段（含系统字段补齐）：必须在 load 之前声明——load 的依赖数组引用 fields，声明在后会在渲染期触发 TDZ 崩溃
  const fields = useMemo(() => ensureSystemFields((form?.schema_json?.fields ?? []).filter((f: FormField) => f.type !== 'action-button' && f.type !== 'wizard-step' && (f.type === 'grid' || !LAYOUT_TYPES.includes(f.type)))), [form]);

  const load = useCallback(async () => {
    if (!formId) return;
    const token = ++loadTokenRef.current;
    setLoading(true);
    const [formRes, actRes, relRes, deptRes, profRes, wfRes, roleRes, smRes] = await Promise.all([
      withRetry(() => supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle()),
      withRetry(() => supabase.from('meta_actions').select('*').eq('form_id', formId).order('sort')),
      withRetry(() => supabase.from('meta_relations').select('*').or(`source_form_id.eq.${formId},target_form_id.eq.${formId}`)),
      withRetry(() => supabase.from('departments').select('*').order('sort_order')),
      withRetry(() => supabase.from('profiles').select('id, name, position, department_id')),
      withRetry(() => supabase.from('meta_workflow').select('nodes').eq('form_id', formId).maybeSingle()),
      withRetry(() => supabase.from('roles').select('id, name')),
      withRetry(() => supabase.from('meta_state_machine').select('states, transitions').eq('form_id', formId).maybeSingle()),
    ]);
    // 快速切换路由时丢弃过期请求的结果，避免竞态导致“应用不存在”
    if (token !== loadTokenRef.current) return;
    const f = formRes.data as MetaForm | null;
    // 单页设计类型：重定向到单页运行时（兼容历史 /app 路径）
    if (f && f.app_type === 'page') {
      navigate(`/page/${formId}`, { replace: true });
      return;
    }
    setForm(f);
    // 面包屑一级模块名：找当前表单归属的一级菜单（meta_menu 中 parent_id 为 null 的根）
    if (f) {
      supabase.from('meta_menu').select('id, name, parent_id, form_id').eq('tenant_id', tenantId).then(({ data: menuRows }) => {
        const list = (menuRows as { id: string; name: string; parent_id: string | null; form_id: string | null }[]) ?? [];
        const byId = new Map(list.map((m) => [m.id, m]));
        let first = '';
        for (const m of list) {
          if (m.form_id !== formId) continue;
          let cur = m;
          while (cur.parent_id && byId.has(cur.parent_id)) cur = byId.get(cur.parent_id)!;
          if (cur.id !== m.id || !m.parent_id) first = cur.name;
          break;
        }
        setBreadcrumbModule(first);
      });
    }
    setActionDefs((actRes.data as ActionDef[]) ?? []);
    setRelations((relRes.data as MetaRelation[]) ?? []);
    setDepartments((deptRes.data as Department[]) ?? []);
    const profList = (profRes.data as { id: string; name: string; position?: string; department_id?: string | null }[]) ?? [];
    setMembers(profList);
    // 用户 id→姓名映射（系统字段创建人/更新人展示用）
    setUserMap(new Map(profList.map((p) => [p.id, p.name])));
    // 系统字段取值映射：创建人档案（职位/部门）与部门名称
    setProfileMap(new Map(profList.map((p) => [p.id, { name: p.name, position: p.position, department_id: p.department_id }])));
    const dList = (deptRes.data as Department[]) ?? [];
    setDeptMap(new Map(dList.map((d) => [d.id, d.name])));
    setRoleMap(new Map(((roleRes.data as Pick<Role, 'id' | 'name'>[]) ?? []).map((r) => [r.id, r.name])));
    setSmStates(new Map((((smRes.data as { states?: { key: string; label: string; color?: string }[] } | null)?.states) ?? []).map((s) => [s.key, { label: s.label, color: s.color }])));
    setSmTrans(((smRes.data as { transitions?: SmTransition[] } | null)?.transitions) ?? []);
    // 下拉单选/多选动态数据源：从目标表单字段拉取去重选项（含带搜索的变体）；多字段拼接时选项为完整记录（id 为值、多字段拼接为显示文本）
    const srcFields = (f?.schema_json?.fields ?? []).filter((x: FormField) => (x.type === 'select' || x.type === 'multi-select' || x.type === 'search-select' || x.type === 'search-multi-select') && optionDisplayKeys(x).length > 0);
    const opts: Record<string, { id: string; label: string }[]> = {};
    const srcRows: Record<string, BizData[]> = {};
    await Promise.all(srcFields.map(async (sf: FormField) => {
      // 数据范围：dept/dept_sub/mine 按创建人过滤
      let creatorIds: string[] | null = null;
      const scope = sf.optionSource?.dataRange;
      if (scope && scope !== 'all' && profile?.id) {
        const [deptRes, profRes] = await Promise.all([
          supabase.from('departments').select('*').eq('tenant_id', tenantId),
          supabase.from('profiles').select('id, department_id').eq('tenant_id', tenantId),
        ]);
        creatorIds = buildCreatorScope({
          dataRange: scope,
          permissionScope: dataScope,
          profile: { id: profile.id, department_id: profile.department_id ?? null },
          departments: (deptRes.data as Department[]) ?? [],
          profiles: (profRes.data as Pick<Profile, 'id' | 'department_id'>[]) ?? [],
        });
      }
      let optQuery = supabase.from('biz_data').select('*').eq('form_id', sf.optionSource!.formId).eq('is_deleted', false).limit(500);
      if (creatorIds) optQuery = optQuery.in('created_by', creatorIds.length > 0 ? creatorIds : ['00000000-0000-0000-0000-000000000000']);
      const { data } = await optQuery;
      const rows = ((data as BizData[]) ?? []);
      // 统一显示字段模式：选项值为记录 id；勾选 1 个字段时 join 单元素等价于直接显示该字段值，多个字段按分隔符拼接
      const multiKeys = optionDisplayKeys(sf);
      if (multiKeys.length === 0) return;
      const sep = sf.optionSource!.separator ?? '-';
      srcRows[sf.key] = rows;
      opts[sf.key] = rows.map((r) => ({
        id: r.id,
        label: multiKeys.map((k) => formatOptionFieldValue(k, r, userMap, smStates)).filter(Boolean).join(sep) || '（空记录）',
      }));
    }));
    setRefOptions(opts);
    setRefSrcRows(srcRows);
    // 表单赋值字段：拉取目标表单记录缓存（列表 id→显示文本实时解析用；不做数据范围过滤）
    const assignFields = (f?.schema_json?.fields ?? []).filter((x: FormField) => x.type === 'form-assignment' && x.assignment?.formId);
    if (assignFields.length > 0) {
      await Promise.all(assignFields.map(async (af: FormField) => {
        const { data: arows } = await supabase.from('biz_data').select('*').eq('form_id', af.assignment!.formId).eq('is_deleted', false).limit(500);
        srcRows[af.key] = (arows as BizData[]) ?? [];
      }));
      setRefSrcRows({ ...srcRows });
    }

    // 关联表单字段：加载目标表单数据用于子列表展示与选择弹窗
    const refFields = (f?.schema_json?.fields ?? []).filter((x: FormField) => x.type === 'form-ref' && x.relation?.formId);
    const rows: Record<string, BizData[]> = {};
    const meta: Record<string, MetaForm> = {};
    const smMap: Record<string, Map<string, { label: string }>> = {};
    const optSrcMap: Record<string, BizData[]> = {};
    await Promise.all(refFields.map(async (rf: FormField) => {
      const targetId = rf.relation!.formId;
      // 数据范围：dept/dept_sub/mine 按创建人过滤
      let creatorIds: string[] | null = null;
      const scope = rf.relation?.dataRange;
      if (scope && scope !== 'all' && profile?.id) {
        const [deptRes, profRes] = await Promise.all([
          supabase.from('departments').select('*').eq('tenant_id', tenantId),
          supabase.from('profiles').select('id, department_id').eq('tenant_id', tenantId),
        ]);
        creatorIds = buildCreatorScope({
          dataRange: scope,
          permissionScope: dataScope,
          profile: { id: profile.id, department_id: profile.department_id ?? null },
          departments: (deptRes.data as Department[]) ?? [],
          profiles: (profRes.data as Pick<Profile, 'id' | 'department_id'>[]) ?? [],
        });
      }
      let dataQuery = supabase.from('biz_data').select('*').eq('form_id', targetId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(200);
      if (creatorIds) dataQuery = dataQuery.in('created_by', creatorIds.length > 0 ? creatorIds : ['00000000-0000-0000-0000-000000000000']);
      const [dataRes, metaRes, smRes] = await Promise.all([
        dataQuery,
        supabase.from('meta_forms').select('*').eq('id', targetId).maybeSingle(),
        supabase.from('meta_state_machine').select('states').eq('form_id', targetId).maybeSingle(),
      ]);
      // 应用显示条件过滤数据源
      const rawRows = (dataRes.data as BizData[]) ?? [];
      const filtered = applyDisplayConditions(rawRows as unknown as Record<string, unknown>[], rf.relation?.conditions ?? [], rf.relation?.conditionsLogic ?? 'and') as unknown as BizData[];
      rows[rf.key] = filtered;
      const targetMeta = (metaRes.data as MetaForm) ?? null as unknown as MetaForm;
      meta[rf.key] = targetMeta;
      const smStatesArr = ((smRes.data?.states ?? []) as Array<{ key: string; label: string }>);
      const targetStatesMap = new Map(smStatesArr.map((s) => [s.key, { label: s.label }]));
      smMap[rf.key] = targetStatesMap;
      smMap[targetId] = targetStatesMap;
      // 目标表单若包含数据源下拉字段（例如借款管理中的「项目所属」），预取源表单记录供显示字段拼接
      const srcIds = [...new Set(((targetMeta?.schema_json?.fields ?? []) as FormField[])
        .filter((x) => (x.type === 'select' || x.type === 'multi-select' || x.type === 'search-select' || x.type === 'search-multi-select') && x.optionSource?.formId)
        .map((x) => x.optionSource!.formId!))];
      await Promise.all(srcIds.map(async (sid) => {
        if (!optSrcMap[sid]) {
          const { data: sdata } = await supabase.from('biz_data').select('*').eq('form_id', sid).eq('is_deleted', false).limit(500);
          optSrcMap[sid] = ((sdata as BizData[]) ?? []);
        }
      }));
    }));
    setRefRows(rows);
    setRefFormMeta(meta);
    setRefSmStates(smMap);
    setRefPickerSrcRows((prev) => ({ ...prev, ...optSrcMap }));
    // 汇总统计（当前表单来源）：拉取全量记录用于聚合统计
    const hasCurrentSummary = (f?.schema_json?.fields ?? []).some((x: FormField) => x.type === 'summary' && (x.summary?.source ?? 'current') === 'current');
    if (hasCurrentSummary) {
      void supabase.from('biz_data').select('payload').eq('form_id', formId).eq('is_deleted', false).limit(500).then(({ data }) => {
        setSummaryRows((data as { payload: Record<string, unknown> }[]) ?? []);
      });
    } else {
      setSummaryRows([]);
    }
    // 关联取值（指定表单来源）：拉取目标表单全量记录用于取值计算
    const fetchFormIds = Array.from(new Set(
      ((f?.schema_json?.fields ?? []) as FormField[])
        .filter((x) => x.type === 'fetch-value' && x.fetchValue?.source === 'form' && !!x.fetchValue.formId)
        .map((x) => x.fetchValue!.formId as string),
    ));
    if (fetchFormIds.length > 0) {
      void Promise.all(
        fetchFormIds.map(async (fid) => {
          const { data: rows } = await supabase.from('biz_data').select('payload, created_at, created_by').eq('form_id', fid).eq('is_deleted', false).order('created_at', { ascending: false }).limit(500);
          return { fid, rows: (rows as Array<{ payload: Record<string, unknown>; created_at: string; created_by?: string }>) ?? [] };
        }),
      ).then((results) => {
        if (token !== loadTokenRef.current) return;
        const cache: Record<string, Array<{ payload?: Record<string, unknown>; created_at?: string }>> = {};
        results.forEach((r) => { cache[r.fid] = r.rows; });
        setFormRowsCache(cache);
      });
    } else {
      setFormRowsCache({});
    }
    // 分栏布局组件：加载每栏绑定的文本数据源
    const gridFields = (f?.schema_json?.fields ?? []).filter((x: FormField) => x.type === 'grid');
    const gVals: Record<string, string[]> = {};
    await Promise.all(gridFields.map(async (gf: FormField) => {
      const cols = gf.gridColumns ?? [];
      const vals = await Promise.all(cols.map((col) =>
        resolveTextValue(col ?? { formId: '', fieldKey: '', aggregate: 'first' }, {
          profile: { id: profile?.id ?? '', department_id: profile?.department_id ?? null },
          dataScope,
          tenantId,
        })
      ));
      gVals[gf.key] = vals;
    }));
    setGridValues(gVals);
    // 流程节点字段权限（含条件分支内的节点）：审批/填写弹窗按节点权限渲染只读/可编辑/隐藏
    const wfNodes = (((wfRes.data as { nodes?: WfNode[] } | null)?.nodes ?? []) as WfNode[]);
    setWfNodePerms(new Map(collectWfNodes(wfNodes).map((n) => [n.id, n.fieldPermissions ?? {}])));
    // 流程填写节点守卫条件（含条件分支内的节点）：提交时逐条评估，全部满足才能流转
    setWfNodeGuards(new Map(collectWfNodes(wfNodes).map((n) => [n.id, n.guards ?? []])));
    setLoading(false);
  }, [formId, profile?.id]);

  // 搜索上下文最新值镜像：loadRows 闭包不随成员/部门/关联数据重建（避免重复触发列表查询），搜索时读取最新引用
  const searchCtxRef = useRef({ members, departments, userMap, smStates, refSrcRows, refRows, refFormMeta });
  searchCtxRef.current = { members, departments, userMap, smStates, refSrcRows, refRows, refFormMeta };

  const loadRows = useCallback(async () => {
    if (!formId) return;
    let q = supabase.from('biz_data').select('*', { count: 'exact' }).eq('form_id', formId).eq('is_deleted', false);
    // 数据权限：非超管仅显示其角色权限范围内可见的数据（按 data_scope/row_rules 过滤）
    // 429 根治：my_visible_biz_ids 结果内存缓存（模块级），任何时刻有缓存先用缓存渲染，
    // 同时后台始终调用 RPC 刷新缓存；首次无缓存且 429 时用空数组兜底避免列表误显示为空
    if (!isSuperadmin) {
      const cacheKey = `${formId}_${profile?.id ?? ''}`;
      let visIds: { id: string }[] | null = null;
      const memCached = bizVisCache.get(cacheKey);
      if (memCached) {
        // 有缓存（不论 TTL）：立即用缓存渲染，后台始终刷新缓存供下次使用
        visIds = memCached.ids.map((id) => ({ id }));
        void withRetry(() => supabase.rpc('my_visible_biz_ids', { p_form_id: formId })).then(({ data }) => {
          bizVisCache.set(cacheKey, { ids: ((data as { id: string }[] | null) ?? []).map((x) => x.id) });
        });
      } else {
        // 无缓存：带重试请求；429 重试仍失败时兜底空数组（避免列表崩溃），后台继续刷新缓存
        const { data, error } = await withRetry(() => supabase.rpc('my_visible_biz_ids', { p_form_id: formId }));
        visIds = (data as { id: string }[] | null) ?? [];
        if (!error) {
          bizVisCache.set(cacheKey, { ids: visIds.map((x) => x.id) });
        } else {
          // 429 兜底：用空数组（不显示数据但不报错），后台静默刷新缓存供下次恢复
          void withRetry(() => supabase.rpc('my_visible_biz_ids', { p_form_id: formId })).then(({ data: d2 }) => {
            bizVisCache.set(cacheKey, { ids: ((d2 as { id: string }[] | null) ?? []).map((x) => x.id) });
          });
        }
      }
      const ids = (visIds ?? []).map((x) => x.id);
      q = q.in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
    }
    Object.entries(searchVals).forEach(([k, v]) => {
      if (!v) return;
      const sc = searchCfg.find((x) => x.key === k);
      // status / created_at 为 biz_data 原生列，需按列精确过滤（非 payload 字段）
      if (k === 'status') {
        q = q.eq('status', v);
      } else if (k === 'created_at') {
        if (sc?.control === 'date-range' && v.includes('~')) {
          // 范围过滤：起始 00:00:00 ~ 结束 23:59:59.999
          const [f, t] = v.split('~').map((x) => x.trim());
          if (f) q = q.gte('created_at', new Date(`${f}T00:00:00`).toISOString());
          if (t) q = q.lte('created_at', new Date(`${t}T23:59:59.999`).toISOString());
        } else {
          const start = new Date(`${v}T00:00:00`).toISOString();
          const end = new Date(`${v}T23:59:59.999`).toISOString();
          q = q.gte('created_at', start).lte('created_at', end);
        }
      } else if (sc?.control === 'date-range' && v.includes('~')) {
        // payload 日期范围：按日期前缀字符串比较（兼容 YYYY-MM-DD 与 ISO 两种存储）
        const [f, t] = v.split('~').map((x) => x.trim());
        if (f) q = q.gte(`payload->>${k}`, f);
        if (t) q = q.lte(`payload->>${k}`, `${t}T23:59:59.999`);
      } else if (SYSTEM_FIELD_KEYS.includes(k as (typeof SYSTEM_FIELD_KEYS)[number]) && k !== 'status' && k !== 'created_at' && k !== 'updated_at') {
        // 系统字段（员工姓名/所属部门/职位/创建人/更新人）：payload 不存值，按显示名模糊反查用户 id 集后过滤原生列
        const ctx = searchCtxRef.current;
        const kw = v.trim().toLowerCase();
        let ids: string[] = [];
        if (k === 'dept_name') {
          const dIds = new Set(ctx.departments.filter((d) => d.name?.toLowerCase().includes(kw)).map((d) => d.id));
          ids = ctx.members.filter((m) => m.department_id && dIds.has(m.department_id)).map((m) => m.id);
        } else if (k === 'position') {
          ids = ctx.members.filter((m) => m.position?.toLowerCase().includes(kw)).map((m) => m.id);
        } else {
          // user_name / created_by / updated_by：按成员姓名模糊匹配
          ids = ctx.members.filter((m) => m.name?.toLowerCase().includes(kw)).map((m) => m.id);
        }
        const esc = (s: string) => s.replace(/"/g, '\\"');
        const conds = [`payload->>${k}.ilike."%${esc(v)}%"`];
        if (ids.length > 0) conds.push(`${k === 'updated_by' ? 'updated_by' : 'created_by'}.in.(${ids.slice(0, 40).join(',')})`);
        q = q.or(conds.join(','));
      } else {
        // 普通字段模糊匹配；人员/部门/表单赋值/下拉动态源/关联表单等 ID 类字段同时按显示文本反查 id 后 or 匹配
        const ctx = searchCtxRef.current;
        const fd = fields.find((x) => x.key === k);
        const kw = v.trim().toLowerCase();
        const esc = (s: string) => s.replace(/"/g, '\\"');
        const conds = [`payload->>${k}.ilike."%${esc(v)}%"`];
        const pushIds = (ids: string[]) => ids.slice(0, 40).forEach((id) => conds.push(`payload->>${k}.ilike."%${esc(id)}%"`));
        if (fd?.type === 'user-select') {
          pushIds(ctx.members.filter((m) => m.name?.toLowerCase().includes(kw)).map((m) => m.id));
        } else if (fd?.type === 'dept-select') {
          pushIds(ctx.departments.filter((d) => d.name?.toLowerCase().includes(kw)).map((d) => d.id));
        } else if (fd && (fd.type === 'form-assignment' || ((fd.type === 'select' || fd.type === 'multi-select' || fd.type === 'search-select' || fd.type === 'search-multi-select') && optionDisplayKeys(fd).length > 0))) {
          // 表单赋值与下拉动态数据源：选项值为目标记录 id，按显示文本模糊反查
          const dispKeys = fd.type === 'form-assignment' ? (fd.assignment?.displayFieldKeys ?? []) : optionDisplayKeys(fd);
          const sep = fd.type === 'form-assignment' ? (fd.assignment?.displaySeparator ?? ' ') : (fd.optionSource?.separator ?? '-');
          const srcRows = ctx.refSrcRows[k] ?? [];
          pushIds(srcRows.filter((row) => dispKeys.map((kk) => formatOptionFieldValue(kk, row, ctx.userMap, ctx.smStates)).filter(Boolean).join(sep).toLowerCase().includes(kw)).map((row) => row.id));
        } else if (fd?.type === 'form-ref' && fd.relation?.formId) {
          // 关联表单：payload 存记录 id 数组，按目标表单显示字段文本模糊反查
          const target = ctx.refFormMeta[k];
          const dispKeys = (fd.relation.displayFields?.length ? fd.relation.displayFields : (target?.list_config?.columns ?? []).map((c) => c.key)).filter(Boolean);
          const srcRows = ctx.refRows[k] ?? [];
          pushIds(srcRows.filter((row) => dispKeys.map((kk) => formatOptionFieldValue(kk, row, ctx.userMap, ctx.smStates)).filter(Boolean).join('-').toLowerCase().includes(kw)).map((row) => row.id));
        }
        q = q.or(conds.join(','));
      }
    });
    const from = page * pageSize;
    const { data, count } = await q.order('created_at', { ascending: false }).range(from, from + pageSize - 1);
    const list = (data as BizData[]) ?? [];
    setRows(list);
    setTotal(count ?? 0);
    // 预取当前页各行的子表明细行：列表/详情对汇总统计与公式字段的实时计算回退依赖 subRowsCache（所有含子表的表单通用）
    const subFields = fields.filter((f) => f.type === 'sub-table' && f.subTable?.targetFormId);
    if (list.length > 0 && subFields.length > 0) {
      const subCache: Record<string, BizData[]> = {};
      await Promise.all(subFields.map(async (f) => {
        const allIds = list.flatMap((r) => {
          const v = r.payload?.[f.key];
          return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
        });
        if (allIds.length === 0) return;
        const { data: subData } = await supabase.from('biz_data').select('*').in('id', allIds).eq('is_deleted', false);
        if (subData) subCache[f.key] = subData as BizData[];
      }));
      if (Object.keys(subCache).length > 0) setSubRowsCache((c) => ({ ...c, ...subCache }));
    }
    // 拉取当前页各行的待处理节点（当前审批/填写节点），用于列表按钮与权限判定
    if (list.length > 0) {
      const { data: apprRes } = await supabase.from('biz_approval')
        .select('*').in('biz_id', list.map((r) => r.id)).eq('state', 'pending').eq('current', true).order('created_at');
      const map: Record<string, BizApproval[]> = {};
      ((apprRes as BizApproval[]) ?? []).forEach((a) => {
        map[a.biz_id] = [...(map[a.biz_id] ?? []), a];
      });
      setPendingApprovals(map);
    } else {
      setPendingApprovals({});
    }
  }, [formId, page, pageSize, searchVals, isSuperadmin, fields, profile?.id]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // 查询表单组件：按配置的数据范围拉取关联表单数据（旧 filterByApplicant 兼容为仅本人）
  useEffect(() => {
    if (!form) return;
    const qFields = (form.schema_json.fields ?? []).filter((x: FormField) => x.type === 'query' && x.query?.formId);
    if (qFields.length === 0) {
      setQueryRows({});
      setQueryMeta({});
      return;
    }
    const applicant = editing?.created_by ?? profile?.id;
    if (!applicant) return;
    let cancelled = false;
    Promise.all(
      qFields.map(async (qf: FormField) => {
        const targetId = qf.query!.formId;
        const scope = qf.query?.dataRange ?? (qf.query?.filterByApplicant === false ? 'all' : 'mine');
        let dataQuery = supabase.from('biz_data').select('*').eq('form_id', targetId).eq('is_deleted', false);
        if (scope === 'mine') {
          dataQuery = dataQuery.eq('created_by', applicant);
        } else if (scope !== 'all' && scopeCtx) {
          const allowed = buildCreatorScope({ ...scopeCtx, dataRange: scope });
          dataQuery = dataQuery.in('created_by', allowed && allowed.length > 0 ? allowed : ['00000000-0000-0000-0000-000000000000']);
        }
        const [dataRes, metaRes] = await Promise.all([
          dataQuery.order('created_at', { ascending: false }).limit(50),
          supabase.from('meta_forms').select('*').eq('id', targetId).maybeSingle(),
        ]);
        // 应用显示条件过滤数据源
        const rawRows = (dataRes.data as BizData[]) ?? [];
        const filtered = applyDisplayConditions(rawRows as unknown as Record<string, unknown>[], qf.query?.conditions ?? [], qf.query?.conditionsLogic ?? 'and') as unknown as BizData[];
        return { key: qf.key, rows: filtered, meta: (metaRes.data as MetaForm) ?? null };
      }),
    ).then((results) => {
      if (cancelled) return;
      const rows: Record<string, BizData[]> = {};
      const meta: Record<string, MetaForm> = {};
      results.forEach((r) => {
        rows[r.key] = r.rows;
        if (r.meta) meta[r.key] = r.meta;
      });
      setQueryRows(rows);
      setQueryMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, [form, editing, profile, scopeCtx]);

  // 公式计算/汇总统计/关联取值字段的实时计算值：公式引用传入的填写值与关联表单选中记录；汇总/取值按配置聚合
  const calcFor = useCallback((vals: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    // 按字段数据范围过滤候选记录（全部 / 跟随角色 / 本部门及下级 / 本部门 / 仅本人）
    const filterByDataRange = <T extends { created_by?: string }>(rows: T[], dataRange?: DataRange): T[] => {
      if (!dataRange || dataRange === 'all' || !scopeCtx) return rows;
      const allowed = buildCreatorScope({ ...scopeCtx, dataRange });
      if (!allowed) return rows;
      const set = new Set(allowed);
      return rows.filter((r) => set.has(r.created_by ?? ''));
    };
    // 子表明细候选：编辑草稿（含行 payload）直接用；随主表保存的内嵌值用行快照；已存 id 数组按 subRowsCache 解析（仅当前单据关联的行）
    const subRowsFor = (subKey: string) => {
      const v = vals[subKey];
      if (isSubTableDraftValue(v)) return v.rows.map((r, i) => ({ payload: r.payload, rowOrder: i }));
      if (isInlineRefValue(v)) return v.rows.map((r) => ({ payload: r.payload ?? {}, created_at: (r.sys?.created_at as string) ?? null }));
      const ids = Array.isArray(v) ? (v as string[]) : [];
      if (ids.length === 0) return [];
      return (subRowsCache[subKey] ?? []).filter((r) => ids.includes(r.id)).map((r) => ({ payload: r.payload, created_at: r.created_at }));
    };
    // 关联表单候选：关联字段选中的记录（随主表保存的内嵌值用行快照）
    const refRowsFor = (refKey: string) => {
      const v = vals[refKey];
      if (isInlineRefValue(v)) return v.rows.map((r) => ({ payload: r.payload ?? {}, created_at: (r.sys?.created_at as string) ?? null }));
      const ids = Array.isArray(v) ? (v as string[]) : [];
      if (ids.length === 0) return [];
      return (refRows[refKey] ?? []).filter((r) => ids.includes(r.id)).map((r) => ({ payload: r.payload, created_at: r.created_at }));
    };
    const refRecords: Record<string, Record<string, unknown> | undefined> = {};
    fields.filter((f) => f.type === 'form-ref').forEach((rf) => {
      const v = vals[rf.key];
      if (isInlineRefValue(v)) {
        refRecords[rf.key] = v.rows[0]?.payload;
        return;
      }
      const ids = Array.isArray(v) ? (v as string[]) : [];
      const first = ids.length > 0 ? (refRows[rf.key] ?? []).find((r) => r.id === ids[0]) : undefined;
      refRecords[rf.key] = first?.payload;
    });
    // 第一轮：汇总统计 (summary) 与关联取值 (fetch-value)（不依赖其他字段实时值）
    fields.forEach((f) => {
      if (f.type === 'summary' && f.summary) {
        let rows: Array<{ payload?: Record<string, unknown> }>;
        if (f.summary.source === 'subtable') rows = subRowsFor(f.summary.subFieldKey ?? '');
        else if (f.summary.source === 'ref') rows = refRowsFor(f.summary.refFieldKey ?? '');
        else rows = summaryRows;
        const aggVal = aggregateRows(f.summary.aggregate, f.summary.fieldKey ?? '', rows);
        // 空行集归一为 0（无明细行时总额应为 0 而非 null，公式与大写金额字段可正常引用）
        out[f.key] = aggVal === null && rows.length === 0 ? 0 : aggVal;
      } else if (f.type === 'fetch-value' && f.fetchValue) {
        const cands = f.fetchValue.source === 'subtable'
          ? subRowsFor(f.fetchValue.subFieldKey ?? '')
          : filterByDataRange(formRowsCache[f.fetchValue.formId ?? ''] ?? [], f.fetchValue.dataRange);
        out[f.key] = evalFetchValue(f.fetchValue, cands);
      }
    });
    // 第二轮：公式 (formula) 与大写金额 (amount-uppercase) 读「输入值 + 已计算值」合并视图——关联字段为自动计算（汇总/关联取值）时实时联动
    let merged = { ...vals, ...out };
    fields.forEach((f) => {
      if (f.type === 'formula') {
        const expr = f.formula?.expression ?? f.defaultValue ?? '';
        if (expr) out[f.key] = evalFormulaExpression(expr, merged, refRecords);
      } else if (f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey) {
        // 大写金额：关联字段可为输入字段或自动计算字段，统一从合并视图取值实时换算
        out[f.key] = toChineseAmount(merged[f.uppercaseAmount.fieldKey] as number | string | null | undefined);
      }
    });
    // 第三轮：公式级联（公式依赖其他公式字段，取级联后的值）
    merged = { ...vals, ...out };
    fields.forEach((f) => {
      if (f.type === 'formula') {
        const expr = f.formula?.expression ?? f.defaultValue ?? '';
        if (expr) {
          const nextVal = evalFormulaExpression(expr, merged, refRecords);
          if (nextVal !== null) out[f.key] = nextVal;
        }
      }
    });
    // 第四轮：大写金额兜底重算（关联公式等计算字段时取级联后的最终值）
    merged = { ...vals, ...out };
    fields.forEach((f) => {
      if (f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey) {
        out[f.key] = toChineseAmount(merged[f.uppercaseAmount.fieldKey] as number | string | null | undefined);
      }
    });
    return out;
  }, [fields, refRows, summaryRows, subRowsCache, formRowsCache, scopeCtx]);
  // 新增/编辑表单草稿的计算值
  const calcVals = useMemo(() => calcFor(draft), [calcFor, draft]);

  // 保存后刷新汇总统计全量数据（当前表单记录数/求和/平均随新增变化）
  const refreshSummary = useCallback(() => {
    if (!formId) return;
    const hasCurrentSummary = fields.some((f) => f.type === 'summary' && (f.summary?.source ?? 'current') === 'current');
    if (!hasCurrentSummary) return;
    void supabase.from('biz_data').select('payload').eq('form_id', formId).eq('is_deleted', false).limit(500).then(({ data }) => {
      setSummaryRows((data as { payload: Record<string, unknown> }[]) ?? []);
    });
  }, [formId, fields]);
  const fieldByKey = useMemo(() => new Map((form?.schema_json?.fields ?? []).map((f: FormField) => [f.key, f])), [form]);
  // 系统字段取值上下文与便捷函数（列表/关联/查询展示复用；smStates 支持状态机自定义状态名称展示）
  const sysCtx = { profileMap, deptMap, smStates };
  const sysVal = (key: string, r: BizData) => systemFieldValue(key, r, sysCtx);
  // 请假时间组件绑定的「请假小时/天数」结果字段 key 集合（这些文本框由请假时间自动计算，只读）
  const leaveResultKeys = useMemo(() => {
    const set = new Set<string>();
    (form?.schema_json?.fields ?? []).forEach((f: FormField) => {
      if (f.type === 'leave-time') {
        if (f.leaveTime?.hoursKey) set.add(f.leaveTime.hoursKey);
        if (f.leaveTime?.daysKey) set.add(f.leaveTime.daysKey);
      }
    });
    return set;
  }, [form]);
  // 请假时间已拆分为独立「开始时间/结束时间」字段时，详情区不再重复显示复合组件值
  const leaveHiddenKeys = useMemo(() => {
    const set = new Set<string>();
    (form?.schema_json?.fields ?? []).forEach((f: FormField) => {
      if (f.type === 'leave-time' && f.leaveTime?.startKey && f.leaveTime?.endKey) set.add(f.key);
    });
    return set;
  }, [form]);
  // 请假拆分出的「开始时间/结束时间」字段 key：任何状态页面均可直接编辑，修改后自动保存并重算时长
  const leaveEditKeys = useMemo(() => {
    const set = new Set<string>();
    (form?.schema_json?.fields ?? []).forEach((f: FormField) => {
      if (f.type === 'leave-time') {
        if (f.leaveTime?.startKey) set.add(f.leaveTime.startKey);
        if (f.leaveTime?.endKey) set.add(f.leaveTime.endKey);
      }
    });
    return set;
  }, [form]);
  const searchCfg = form?.list_config?.search ?? [];
  // 列表显示列：严格取列表设计「列表显示」勾选配置；状态列不再默认展示，需在列表设计中勾选状态字段后才显示
  const colCfg = (form?.list_config?.columns ?? []).length > 0
    ? form!.list_config!.columns!
    : fields.filter((f: FormField) => f.key !== 'status').slice(0, 5).map((f: FormField) => ({ key: f.key, label: f.label, align: 'left' as const, format: 'none' as const }));
  const rowVisibleLimit = form?.list_config?.row_visible_limit ?? 3;

  // 动作引擎上下文钩子（携带状态机状态与条件附加变量，保证引擎兜底校验与列表渲染同口径）
  const actionCtx = (row?: BizData | null, rows?: BizData[]): ActionContext => ({
    user: profile,
    row,
    rows,
    fields,
    smStates,
    condVars: condExtra(row ?? null),
    hooks: {
      refresh: loadRows,
      closeDialog: () => { setViewing(null); navigate(`/app/${formId}`); },
      navigate: (path, newWindow) => { if (newWindow) window.open(window.location.origin + path, '_blank'); else navigate(path); },
      openCreate,
      openEdit,
      openView,
      openRelated: (relation, r, mode) => openRelated(relation, r, mode),
      /** 普通表单操作日志补写（DELETE 等写动作后由引擎回调记录操作轨迹） */
      writeLog: (r: BizData | null, action: string) => { if (r && form?.form_mode !== 'approval') writeBizLog(r.id, action, r.title ?? (form?.name ?? '')); },
      openFill: (r) => {
        // 填写节点确认（如销假）：定位当前待处理填写节点打开填写弹窗
        const appr = (pendingApprovals[r.id] ?? []).find((a) => a.current && a.state === 'pending' && a.node_type === 'fill' && (a.approvers ?? []).includes(profile?.id ?? ''));
        if (!appr) return toast.error('该单据没有待您处理的填写节点');
        openFill(appr, r);
      },
      openSmTrans: (d, r) => {
        // 状态机流转：无交互直接流转；有交互按转换配置打开对应弹窗
        if (!r) return;
        const tr = smTrans.find((x) => x.id === d.config.transitionId);
        if (!tr) return toast.error('该流转动作已下线：对应状态机转换已被删除');
        const inter = tr.interaction;
        if (!inter || inter.type === 'none') {
          // 无交互：若配置 confirm=true 则走二次确认（下方 setSmDlg 统一处理）；否则直接流转
          if (inter?.confirm) {
            setSmDlg({ transition: tr, row: r, def: d });
            return;
          }
          void (async () => {
            const { data, error } = await supabase.rpc('change_biz_status', { p_biz_id: r.id, p_event: tr.event, p_mappings: {} });
            if (error) return toast.error('流转失败：' + error.message);
            if (form?.form_mode !== 'approval') await writeBizLog(r.id, `状态机流转：${tr.event ?? ''}（${tr.from ?? ''} → ${tr.to ?? ''}）`, r.title);
            toast.success(d.success_text ?? ((data as { message?: string })?.message ?? '状态已流转'));
            void loadRows();
          })();
          return;
        }
        setSmDlg({ transition: tr, row: r, def: d });
      },
      openRemark: (d, r) => {
        // 新增备注：打开填写框，确认后写入操作日志
        if (!r) return toast.error('请先选择要备注的数据行');
        setRemarkText('');
        setRemarkDlg({ def: d, row: r });
      },
      openTransfer: (d, r) => {
        // 转移给他人/分配：打开人员选择弹窗（单选接收人），确认后移交单据
        if (!r) return toast.error('请先选择要移交的数据行');
        setTransferUserId('');
        setTransferDlg({ def: d, row: r });
      },
      print: (templateId?: string) => {
        const templates = form?.list_config?.templates ?? [];
        const tpl = (templateId ? templates.find((t) => t.id === templateId) : null) ?? templates[0];
        const safeRows = rows ?? [];
        const targetRows = row ? [row] : (selectedIds.length > 0 ? safeRows.filter((r) => selectedIds.includes(r.id)) : safeRows);
        if (tpl && targetRows.length > 0) {
          // standalone 子表物化 + 关联显示值解析（成员/部门/关联选项 → 可读文本）
          void materializeSubTables(targetRows as unknown as Record<string, unknown>[], fields)
            .then((matRows) => resolveDisplayRows(matRows, fields, [], { userMap, deptMap: new Map(departments.map((d) => [d.id, d.name])), profileMap }))
            .then((resolvedRows) => {
              triggerBrowserPrint(tpl, resolvedRows, fields);
            });
        } else {
          window.print();
        }
      },
      exportCsv: async (templateId?: string) => {
        const templates = form?.list_config?.templates ?? [];
        const tpl = (templateId ? templates.find((t) => t.id === templateId) : null) ?? templates[0];
        const safeRows = rows ?? [];
        const targetRows = row ? [row] : (selectedIds.length > 0 ? safeRows.filter((r) => selectedIds.includes(r.id)) : safeRows);
        if (tpl && targetRows.length > 0) {
          const toastId = toast.loading('正在通过 Edge Function 生成 Excel...');
          const matRows = await materializeSubTables(targetRows as unknown as Record<string, unknown>[], fields);
          const resolvedRows = await resolveDisplayRows(matRows, fields, [], { userMap, deptMap: new Map(departments.map((d) => [d.id, d.name])), profileMap });
          const res = await downloadExcelViaEdgeFunction({
            template: tpl,
            rows: resolvedRows,
            fields,
            fileName: `${form?.name || '数据'}_${tpl.name}_${new Date().toISOString().slice(0, 10)}.xlsx`,
          });
          toast.dismiss(toastId);
          if (res.ok) {
            toast.success(`已按「${tpl.name}」导出 Excel`);
          } else {
            toast.error('导出失败：' + (res.error || 'Edge Function 执行错误'));
          }
        } else {
          exportCsv();
        }
      },
    },
  });

  const runAct = (def: ActionDef, row?: BizData | null) => {
    void executeAction(def, actionCtx(row, selectedIds.length > 0 ? rows.filter((r) => selectedIds.includes(r.id)) : undefined));
  };

  // 可见按钮过滤（显示条件 + 权限由引擎内部兜底；状态机自定义状态名称同样参与 status 比较）
  // 移交/分配后单据负责人（assignee）限定：行操作按钮仅负责人（或超管/无负责人的创建人）可见可操作，权限转移给接收人
  const rowOpsAllowed = (row: BizData | null | undefined): boolean => {
    if (!row) return true;
    if (isSuperadmin) return true;
    if (!row.assignee_id) return true;
    return row.assignee_id === profile?.id;
  };
  const visibleDefs = (pos: ActionDef['position'], row?: BizData | null): ActionDef[] =>
    actionDefs.filter((a) => a.position === pos && (pos !== 'row' || rowOpsAllowed(row)) && passCond(a.show_condition, row ?? null, profile, condExtra(row ?? null), smStates) && (!a.permission_code || hasPermission(a.permission_code)));

  // 向导表单：当前步骤与有效步骤列表（向导步骤已组件化：wizard-step 容器字段 + parentId 归属，兼容旧 form.steps 配置）
  const [wizardStep, setWizardStep] = useState(0);
  const wizSteps = useMemo<WizardStep[]>(() => {
    const stepFields = fields.filter((f) => f.type === 'wizard-step');
    if (stepFields.length > 0) {
      // 组件化步骤：容器字段 + parentId 归属
      return stepFields.map((sf) => ({
        id: sf.id,
        title: sf.layout?.text || `第 ${stepFields.indexOf(sf) + 1} 步`,
        description: sf.layout?.description ?? '',
        fieldKeys: fields.filter((f) => f.parentId === sf.id && !f.system).map((f) => f.key),
      }));
    }
    // 旧配置兼容：form.steps
    const base = (form?.steps ?? []).map((s) => ({ ...s, fieldKeys: s.fieldKeys ?? [] }));
    const list = base.length > 0 ? base : [{ id: 'step_1', title: '第 1 步', fieldKeys: [] }];
    const assigned = new Set(list.flatMap((s) => s.fieldKeys));
    const unassigned = fields.filter((f) => !f.system && !assigned.has(f.key)).map((f) => f.key);
    if (unassigned.length > 0) list[list.length - 1] = { ...list[list.length - 1], fieldKeys: [...list[list.length - 1].fieldKeys, ...unassigned] };
    return list;
  }, [form?.steps, fields]);
  // 仅当表单含向导步骤组件（或旧 form.steps 配置）时启用向导模式；普通表单不渲染步骤条/上一步等
  const isWizard = fields.some((f) => f.type === 'wizard-step') || (form?.steps?.length ?? 0) > 0;

  /** 向导下一步：仅校验当前步骤内字段（数据缓存在 draft，跨步骤不丢失） */
  const nextStep = () => {
    const st = wizSteps[wizardStep];
    if (!st || !form) return;
    const hiddenKeys = evaluateVisibility(form.settings?.visibilityRules, draft);
    for (const f of fields) {
      if (!st.fieldKeys.includes(f.key)) continue;
      if (hiddenKeys.has(f.key) || leaveResultKeys.has(f.key)) continue;
      if (f.readOnly) continue;
      const val = f.type === 'sub-table' ? subTableValidateValue(draft[f.key]) : draft[f.key];
      const err = validateField(f, val);
      if (err) return toast.error(`${f.label}：${err}`);
    }
    setWizardStep((i) => Math.min(i + 1, wizSteps.length - 1));
  };

  const openCreate = () => navigate(`/app/${formId}/new`);
  /** 编辑入口权限：单据已移交/分配给他人时，原处理人无编辑权限，仅当前负责人（或超管）可编辑；同步业务「负责人」字段，保持列表/详情一致 */
  const openEdit = (r: BizData) => {
    if (!isSuperadmin && r.assignee_id && r.assignee_id !== profile?.id) {
      return toast.error(`该单据已移交给 ${r.assignee_name ?? '他人'} 处理，您无编辑权限`);
    }
    if (r.assignee_id && r.assignee_id === profile?.id && fields.some((f) => f.key === 'responsible_person') && r.payload?.responsible_person !== r.assignee_name) {
      void supabase.from('biz_data').update({
        payload: { ...(r.payload ?? {}), responsible_person: r.assignee_name },
        updated_at: new Date().toISOString(),
      }).eq('id', r.id).then(({ error }) => {
        if (!error) r.payload = { ...(r.payload ?? {}), responsible_person: r.assignee_name };
      });
    }
    navigate(`/app/${formId}/${r.id}/edit`);
  };

  // 路由驱动新增/编辑/详情页：URL 变化时初始化页面数据（组件常驻，列表刷新不重置已填内容）
  const initKeyRef = useRef('');
  const initRow = (r: BizData, mode: 'edit' | 'view') => {
    setRouteRowMissing(false);
    // 加载本单据子表明细已存行（汇总统计/关联取值计算用：payload 存行 id 数组）
    const subIdMap: Record<string, string[]> = {};
    fields.filter((f) => f.type === 'sub-table' && f.subTable?.targetFormId).forEach((f) => {
      const v = r.payload?.[f.key];
      if (Array.isArray(v) && v.length > 0) subIdMap[f.key] = v as string[];
    });
    if (Object.keys(subIdMap).length > 0) {
      const allIds = [...new Set(Object.values(subIdMap).flat())];
      void supabase.from('biz_data').select('*').in('id', allIds).eq('is_deleted', false).then(({ data }) => {
        const rows = (data as BizData[]) ?? [];
        setSubRowsCache(Object.fromEntries(Object.entries(subIdMap).map(([k, ids]) => [k, rows.filter((x) => ids.includes(x.id))])));
      });
    } else {
      setSubRowsCache({});
    }
    if (mode === 'edit') {
      setEditing(r);
      setWizardStep(0);
      // 系统字段从行数据派生（仅用于只读展示，保存时剔除）
      const sys: Record<string, unknown> = {};
      SYSTEM_FIELD_KEYS.forEach((k) => {
        const v = systemFieldValue(k, r, sysCtx);
        sys[k] = (k === 'created_at' || k === 'updated_at') && v ? fmtDate(String(v), true) : v;
      });
      setDraft({ ...r.payload, ...sys });
    } else {
      setViewing(r);
      setComment('');
      void supabase.from('biz_approval').select('*').eq('biz_id', r.id).order('created_at').then(({ data }) => setApprovals((data as BizApproval[]) ?? []));
      // 系统操作日志：进入详情页即加载该单据的全部操作记录（非审批表单底部展示）
      void loadBizLogs(r.id);
    }
  };
  useEffect(() => {
    const key = `${routeMode.mode}:${routeMode.bizId ?? ''}`;
    if (initKeyRef.current === key) return;
    initKeyRef.current = key;
    if (routeMode.mode === 'list') { setEditing(null); setViewing(null); setRouteRowMissing(false); return; }
    if (routeMode.mode === 'new') {
      // 等表单字段加载完成再初始化草稿（直接链接进入时 fields 尚未就绪），key 置空待下轮补初始化
      if (fields.length === 0) { initKeyRef.current = ''; return; }
      setEditing(null);
      setWizardStep(0);
      setSubRowsCache({});
      const d: Record<string, unknown> = {};
      fields.forEach((f: FormField) => {
        const v = fieldInitialValue(f);
        d[f.key] = v;
        // 请假时间默认值同步计算时长结果（与组件 onChange 行为一致）：不改默认值直接提交时，时长与绑定结果字段也完整入库
        if (f.type === 'leave-time' && v && typeof v === 'object') {
          const c = calcLeave(v as LeaveTimeValue, f.workHours);
          if (c) {
            d[f.key] = { ...(v as LeaveTimeValue), hours: c.hours, days: c.days };
            if (f.leaveTime?.hoursKey) d[f.leaveTime.hoursKey] = c.hours;
            if (f.leaveTime?.daysKey) d[f.leaveTime.daysKey] = c.days;
          }
        }
      });
      setDraft(d);
      return;
    }
    // 编辑/详情：先取当前列表数据快速展示，同时强制从数据库拉取单据最新数据与子表缓存
    const r = rows.find((x) => x.id === routeMode.bizId);
    if (r) initRow(r, routeMode.mode);
    if (routeMode.bizId) {
      void supabase.from('biz_data').select('*').eq('id', routeMode.bizId).maybeSingle().then(async ({ data }) => {
        if (!data) {
          if (!r) setRouteRowMissing(true);
          return;
        }
        const fresh = data as BizData;
        initRow(fresh, routeMode.mode === 'edit' ? 'edit' : 'view');
        // 同步更新 rows 列表缓存
        setRows((rs) => rs.map((it) => (it.id === fresh.id ? fresh : it)));
        // 预取最新子表行数据
        const subFields = fields.filter((f) => f.type === 'sub-table' && f.subTable?.targetFormId);
        const subCache: Record<string, BizData[]> = {};
        await Promise.all(subFields.map(async (f) => {
          const v = fresh.payload?.[f.key];
          const ids = Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
          if (ids.length > 0) {
            const { data: subData } = await supabase.from('biz_data').select('*').in('id', ids).eq('is_deleted', false);
            if (subData) subCache[f.key] = subData as BizData[];
          }
        }));
        if (Object.keys(subCache).length > 0) setSubRowsCache((c) => ({ ...c, ...subCache }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMode.mode, routeMode.bizId, rows, fields.length]);

  // 旧链接兼容：URL ?edit=<bizId> 重定向到独立编辑页
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId) navigate(`/app/${formId}/${editId}/edit`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, formId]);

  const generateSerialNumbers = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (!formId || !profile?.tenant_id) return payload;
    // 系统默认字段（system 标记）保存时始终自动生成；普通流水号字段需已配置规则
    const serialFields = fields.filter((f) => f.type === 'serial-number' && !payload[f.key] && (f.system || (f.serialRules && f.serialRules.length > 0)));
    if (serialFields.length === 0) return payload;
    const next = { ...payload };
    await Promise.all(serialFields.map(async (f) => {
      const { data, error } = await supabase.rpc('generate_serial_number', {
        p_tenant_id: profile.tenant_id,
        p_form_id: formId,
        p_field_key: f.key,
        p_rules: f.serialRules && f.serialRules.length > 0 ? f.serialRules : DEFAULT_SERIAL_RULES,
        p_payload: next,
      });
      if (error) {
        toast.error(`流水号 ${f.label} 生成失败：${error.message}`);
        return;
      }
      next[f.key] = data as string;
    }));
    return next;
  };

  const save = async (submit: boolean) => {
    if (!form || !formId) return;
    const hiddenKeys = evaluateVisibility(form.settings?.visibilityRules, draft);
    // 校验（请假小时/天数结果字段由请假时间自动计算，跳过必填校验；被显隐规则隐藏的字段也跳过）
    for (const f of fields) {
      if (leaveResultKeys.has(f.key)) continue;
      if (hiddenKeys.has(f.key)) continue;
      if (f.readOnly) continue;
      // system-status 字段编辑时显示用 editing.status 兜底，校验/保存同样兜底（payload 不一定存状态值）
      const v = f.type === 'system-status' && draft[f.key] === undefined ? (editing?.status ?? null) : draft[f.key];
      const err = validateField(f, f.type === 'sub-table' ? subTableValidateValue(v) : v);
      if (err) return toast.error(`${f.label}：${err}`);
    }
    setSaving(true);
    let payload = await generateSerialNumbers(draft);
    // system-status 字段：把兜底的状态值补进 payload（与显示一致）
    const sysStatusField = fields.find((f) => f.type === 'system-status');
    if (sysStatusField && payload[sysStatusField.key] === undefined && editing) {
      payload = { ...payload, [sysStatusField.key]: editing.status };
    }
    // 计算字段（公式计算/汇总统计/关联取值）：配置了规则即以提交时点计算结果写入单据（系统预置与自定义字段一致；引用数据未就绪时写 null）
    fields.filter((f) => f.type === 'formula' || f.type === 'summary' || f.type === 'fetch-value').forEach((f) => {
      const configured = f.type === 'formula' ? (f.formula?.expression ?? f.defaultValue) : (f.type === 'summary' ? f.summary : f.fetchValue);
      if (configured) payload[f.key] = calcVals[f.key] ?? null;
    });
    // 大写金额字段：配置了关联字段即随单据保存换算结果（不要求系统默认字段）
    fields.filter((f) => f.type === 'amount-uppercase' && f.uppercaseAmount?.fieldKey).forEach((f) => {
      payload[f.key] = calcVals[f.key] ?? null;
    });
    // 请假时长兜底：值存在但缺计算结果时补算（含绑定的结果字段），防止不改默认值或旧数据漏算
    fields.filter((f) => f.type === 'leave-time').forEach((f) => {
      const v = payload[f.key];
      if (v && typeof v === 'object' && (v as LeaveTimeValue).start_date) {
        const lv = v as LeaveTimeValue;
        const c = calcLeave(lv, f.workHours);
        if (c) {
          if (lv.hours === undefined || lv.days === undefined) payload[f.key] = { ...lv, hours: c.hours, days: c.days };
          // 绑定的开始/结束时间独立字段：缺失时由请假时间值派生补写，防止不改默认值直接提交导致列表为空
          const s = leaveTimeStr(payload[f.key] as LeaveTimeValue, 'start');
          const e = leaveTimeStr(payload[f.key] as LeaveTimeValue, 'end');
          if (f.leaveTime?.startKey && (payload[f.leaveTime.startKey] === undefined || payload[f.leaveTime.startKey] === '') && s) payload[f.leaveTime.startKey] = s;
          if (f.leaveTime?.endKey && (payload[f.leaveTime.endKey] === undefined || payload[f.leaveTime.endKey] === '') && e) payload[f.leaveTime.endKey] = e;
          if (f.leaveTime?.hoursKey && (payload[f.leaveTime.hoursKey] === undefined || payload[f.leaveTime.hoursKey] === '')) payload[f.leaveTime.hoursKey] = c.hours;
          if (f.leaveTime?.daysKey && (payload[f.leaveTime.daysKey] === undefined || payload[f.leaveTime.daysKey] === '')) payload[f.leaveTime.daysKey] = c.days;
        }
      }
    });
    // 系统审计字段由数据库自动记录，剔除防止客户端伪造
    payload = stripSystemFields(payload);
    // 查询表单组件为只读展示，不入库
    const queryKeys = new Set(fields.filter((f) => f.type === 'query').map((f) => f.key));
    payload = Object.fromEntries(Object.entries(payload).filter(([k]) => !queryKeys.has(k)));
    // 系统状态组件：取所选状态作为单据状态（编辑变更状态时同步系统 status 字段；新建不指定则交由状态机初始状态）
    const statusField = fields.find((f) => f.type === 'system-status');
    const pickedStatus = statusField ? payload[statusField.key] : undefined;
    if (statusField) {
      delete payload[statusField.key];
      payload = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== statusField.key));
    }
    // 关联子表明细行持久化：软删移除行、写入新增/更新行，主表 payload 存行 id 数组（随主表保存模式内嵌物化）
    try {
      const subR = await persistSubTableFieldsEx(fields, payload, { tenantId, userId: profile?.id ?? '' });
      payload = subR.payload;
      if (Object.keys(subR.subRows).length > 0) setSubRowsCache((c) => ({ ...c, ...subR.subRows }));
      payload = await materializeInlineRefs(fields, payload);
    } catch (e) {
      setSaving(false);
      return toast.error(e instanceof Error ? e.message : '子表明细保存失败');
    }
    if (editing) {
      // 唯一字段校验：同表单内该字段值不可重复（排除自身；软删数据不占用唯一性）
      const uniqErr = await checkUniqueFields(formId ?? '', fields, payload, editing.id);
      if (uniqErr) { setSaving(false); return toast.error(uniqErr); }
      // 系统状态组件选了新状态：同步更新系统 status 字段（与 payload 同一次更新，保持一致）
      const statusChanged = pickedStatus !== undefined && pickedStatus !== '' && pickedStatus !== editing.status;
      const { error } = await supabase.from('biz_data').update({ payload, ...(statusChanged ? { status: pickedStatus as string } : {}), updated_at: new Date().toISOString() }).eq('id', editing.id);
      if (error) {
        setSaving(false);
        return toast.error('保存失败：' + error.message);
      }
      // 普通表单补写操作日志（审批表单由 RPC 生成审批日志）
      if (form?.form_mode !== 'approval') writeBizLog(editing.id, submit ? '提交数据' : '编辑数据', (payload[fields[0]?.key] as string) ?? form.name);
      setDraft(payload);
      // 草稿/驳回状态提交：更新数据后发起审批流程
      // 状态机表单（form_mode='state'）：编辑保存只更新数据，不改变状态、不走审批（状态变更通过状态机转换操作触发）
      if (submit && (editing.status === 'draft' || editing.status === 'rejected')) {
        if (form?.form_mode === 'normal' || form?.form_mode === 'state') {
          setSaving(false);
          toast.success('已保存');
        } else {
          const { error: wfErr } = await supabase.rpc('start_biz_workflow', { p_biz_id: editing.id });
          setSaving(false);
          if (wfErr) return toast.error('发起审批失败：' + wfErr.message);
          toast.success('已发起审批');
        }
      } else {
        setSaving(false);
        toast.success('已保存');
      }
      navigate(`/app/${formId}`);
      loadRows();
      refreshSummary();
      return;
    }
    // 新建 → 唯一字段校验后调 submit_biz RPC（创建数据 + 状态流转 + 生成审批待办）
    const uniqErr = await checkUniqueFields(formId ?? '', fields, payload);
    if (uniqErr) { setSaving(false); return toast.error(uniqErr); }
    const { data: newBiz, error } = await supabase.rpc('submit_biz', {
      p_form_id: formId,
      p_payload: payload,
      p_title: (payload[fields[0]?.key] as string) ?? form.name,
      p_amount: typeof payload.amount === 'number' ? payload.amount : null,
      p_submit: submit,
    });
    // 系统状态组件新建时指定初始状态：创建成功后回写 status（未选则保持状态机默认初始状态）
    if (!error && pickedStatus !== undefined && pickedStatus !== '') {
      const newId = (newBiz as { id?: string } | null)?.id;
      if (newId) await supabase.from('biz_data').update({ status: pickedStatus as string, updated_at: new Date().toISOString() }).eq('id', newId);
    }
    setSaving(false);
    if (error) return toast.error('提交失败：' + error.message);
    // 新建成功：普通（非审批）表单写入操作日志（创建记录计入详情页日志）
    {
      const newId = (newBiz as { id?: string } | null)?.id;
      if (form?.form_mode !== 'approval' && newId) {
        writeBizLog(newId, '创建数据', (payload[fields[0]?.key] as string) ?? form.name);
      }
    }
    // 新增关联数据回链：新建保存成功后自动把新记录 ID 回填到源单据 backfill_field 并返回源单据详情
    const linkbackRaw = searchParams.get('linkback');
    if (linkbackRaw) {
      const newId = (newBiz as { id?: string } | null)?.id;
      let link: { s?: string; f?: string; k?: string; m?: boolean; r?: string } = {};
      try { link = JSON.parse(decodeURIComponent(linkbackRaw)); } catch { /* 忽略非法回链参数 */ }
      if (newId && link.s && link.k) {
        const { data: srcRow } = await supabase.from('biz_data').select('payload').eq('id', link.s).maybeSingle();
        const srcPayload = (srcRow?.payload ?? {}) as Record<string, unknown>;
        const cur = (srcPayload[link.k] as string[]) ?? [];
        const next = link.m ? [...new Set([...cur, newId])] : [newId];
        // 字段赋值：按关联定义的映射把新建记录字段值写入主表对应字段
        let patch: Record<string, unknown> = {};
        if (link.r) {
          const relDef = relations.find((x) => x.id === link.r);
          const mappings = relDef?.field_mappings ?? [];
          if (mappings.length > 0) {
            const { data: newRow } = await supabase.from('biz_data').select('title, payload').eq('id', newId).maybeSingle();
            if (newRow) {
              for (const m of mappings) {
                if (!m.mainKey || !m.targetKey) continue;
                const v = m.targetKey === 'title' ? newRow.title : (newRow.payload as Record<string, unknown> | null)?.[m.targetKey];
                if (v !== undefined && v !== null) patch[m.mainKey] = v;
              }
            }
          }
        }
        const { error: linkErr } = await supabase.from('biz_data').update({ payload: { ...srcPayload, [link.k]: next, ...patch }, updated_at: new Date().toISOString() }).eq('id', link.s);
        if (linkErr) toast.error('新建成功，但回写关联失败：' + linkErr.message);
        else toast.success(Object.keys(patch).length > 0 ? '已新建、自动关联并赋值主表字段' : '已新建并自动关联到源单据');
        if (link.f) { navigate(`/app/${link.f}/${link.s}`); return; }
      }
    }
    toast.success(submit ? (form?.form_mode === 'approval' ? '已提交，进入审批流程' : '已提交') : '已保存为草稿');
    navigate(`/app/${formId}`);
    loadRows();
    refreshSummary();
  };

  const openView = (r: BizData) => {
    navigate(`/app/${formId}/${r.id}`);
  };

  /** 角色池认领：把单据当前处理人写为自己 */
  const claim = async () => {
    if (!viewing) return;
    const { error } = await supabase.from('biz_data').update({ assignee_id: profile?.id ?? null, assignee_name: profile?.name ?? null }).eq('id', viewing.id);
    if (error) return toast.error('认领失败：' + error.message);
    toast.success('已认领，该单据由您处理');
    setViewing({ ...viewing, assignee_id: profile?.id ?? null, assignee_name: profile?.name ?? null });
    loadRows();
  };

  /** 字段旁按钮：FormDesigner 配置的 action-button 字段 → 构造临时 ActionDef 交动作引擎执行 */
  const runFieldButton = (f: FormField, row: BizData | null) => {
    const b = f.button;
    if (!b) return toast.error('该按钮未配置动作');
    const def: ActionDef = {
      id: `field_${f.id}`,
      tenant_id: '', form_id: formId ?? '',
      position: 'field', name: f.label, icon: 'zap',
      variant: 'primary',
      action_type: b.actionType,
      config: {
        targetFormId: b.targetFormId,
        targetStatus: b.targetStatus,
        stateMachineEvent: b.stateMachineEvent,
        updates: b.updates,
        url: b.targetUrl,
        method: b.targetUrl ? 'POST' : undefined,
        targetType: b.targetFormId ? 'form-list' : undefined,
      },
      show_condition: null, enable_condition: null,
      permission_code: null, confirm_text: null,
      success_text: null, after_behavior: 'refresh',
      sort: 0, version: 1, created_at: '', updated_at: '',
    };
    void executeAction(def, actionCtx(row ?? viewing, undefined));
  };

  const act = async (action: 'approve' | 'reject') => {
    const r = approveDialog?.row;
    if (!r) return;
    // 驳回必须填写理由
    if (action === 'reject' && !comment.trim()) return toast.error('驳回时必须填写理由');
    setActing(true);
    // 通过时同步提交当前节点「字段权限=可编辑」的字段值（服务端剔除系统字段防伪造），并记录修改内容
    let data: Record<string, unknown> = {};
    const changes: { label: string; from: string; to: string }[] = [];
    if (action === 'approve' && approveDialog) {
      const perms = wfNodePerms.get(approveDialog.appr.node_id ?? '') ?? {};
      const editableKeys = Object.entries(perms).filter(([, p]) => p === 'editable').map(([k]) => k);
      // 含请假拆分字段时扩展提交联动字段（复合值+开始/结束时间+小时/天数）
      expandLeaveKeysForSubmit(fields, editableKeys).forEach((k) => {
        if (SYSTEM_FIELD_KEYS.includes(k as (typeof SYSTEM_FIELD_KEYS)[number])) return;
        data[k] = apprDraft[k];
      });

      // 审批通过时若修改了关联子表，先持久化明细行（主表 payload 替换为行 id 数组；随主表保存模式内嵌物化）
      try {
        const uid = profile?.id ?? '';
        const { data: me } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
        const subR = await persistSubTableFieldsEx(fields, data, { tenantId: (me as { tenant_id?: string } | null)?.tenant_id ?? '', userId: uid });
        data = subR.payload;
        if (Object.keys(subR.subRows).length > 0) setSubRowsCache((c) => ({ ...c, ...subR.subRows }));
        data = await materializeInlineRefs(fields, data);
      } catch (e) {
        setActing(false);
        return toast.error(e instanceof Error ? e.message : '子表明细保存失败');
      }

      // 基于持久化后的最终值记录修改内容：复合字段比较 id 集合并以「共 N 条明细/关联数据」描述
      expandLeaveKeysForSubmit(fields, editableKeys).forEach((k) => {
        if (SYSTEM_FIELD_KEYS.includes(k as (typeof SYSTEM_FIELD_KEYS)[number])) return;
        const f = fieldByKey.get(k);
        if (!f) return;
        const oldV = r.payload?.[k];
        const newV = data[k];
        if (f.type === 'sub-table') {
          // 子表只要在编辑器中被触碰（增删改行）即视为变更；行数相同时标注「内容已更新」
          const touched = isSubTableDraftValue(apprDraft[k]);
          if (!touched && sameRefIds(oldV, newV)) return;
          const oldN = isInlineRefValue(oldV) ? oldV.rows.length : Array.isArray(oldV) ? (oldV as string[]).length : 0;
          const newN = isInlineRefValue(newV) ? newV.rows.length : Array.isArray(newV) ? (newV as string[]).length : 0;
          if (oldN === 0 && newN === 0) return;
          changes.push({ label: f.label, from: fmtChangeVal(f, oldV), to: oldN === newN ? `${fmtChangeVal(f, newV)}（内容已更新）` : fmtChangeVal(f, newV) });
          return;
        }
        if (f.type === 'form-ref') {
          if (sameRefIds(oldV, newV)) return;
        } else if (JSON.stringify(oldV ?? null) === JSON.stringify(newV ?? null)) {
          return;
        }
        changes.push({ label: f.label, from: fmtChangeVal(f, oldV), to: fmtChangeVal(f, newV) });
      });
    }
    const { data: res, error } = await supabase.rpc('approve_biz', {
      p_biz_id: r.id,
      p_action: action,
      p_comment: comment,
      p_data: data,
      p_changes: changes,
    });
    setActing(false);
    if (error) return toast.error('操作失败：' + error.message);
    // 依次审批/会签中间态：展示服务端轮转或等待提示（如「已同意，已流转给下一位审批人」）
    const msg = (res as { message?: string } | null)?.message;
    toast.success(action === 'approve' ? (msg || '已同意') : '已驳回');
    setViewing(null);
    setComment('');
    setApproveDialog(null);
    navigate(`/app/${formId}`);
    loadRows();
  };

  /** 打开审批操作弹窗：先展示全部字段内容（只读与可编辑以填充色区分），确认后提交；可从列表动作按钮直接进入（指定行数据） */
  const openApprove = async (action: 'approve' | 'reject', a: BizApproval, row?: BizData) => {
    const r = row ?? viewing;
    if (!r) return;
    // 审批弹窗自带全部字段内容，不再打开详情弹窗，避免与详情弹窗双层叠加
    setApproveDialog({ action, appr: a, row: r });
    const sys: Record<string, unknown> = {};
    SYSTEM_FIELD_KEYS.forEach((k) => {
      const v = systemFieldValue(k, r, sysCtx);
      sys[k] = (k === 'created_at' || k === 'updated_at') && v ? fmtDate(String(v), true) : v;
    });
    setApprDraft({ ...r.payload, ...sys });

    // 每次打开审批弹窗强制从数据库刷新单据数据与关联子表数据
    try {
      const [bRes, aRes] = await Promise.all([
        supabase.from('biz_data').select('*').eq('id', r.id).maybeSingle(),
        supabase.from('biz_approval').select('*').eq('biz_id', r.id).order('created_at'),
      ]);
      const freshBiz = (bRes.data as BizData | null) ?? r;
      const freshApprs = (aRes.data as BizApproval[]) ?? [];
      const freshA = freshApprs.find((x) => x.id === a.id) ?? a;
      setApproveDialog({ action, appr: freshA, row: freshBiz });

      const subFields = fields.filter((f) => f.type === 'sub-table' && f.subTable?.targetFormId);
      const subCache: Record<string, BizData[]> = {};
      await Promise.all(subFields.map(async (f) => {
        const v = freshBiz.payload?.[f.key];
        const ids = Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
        if (ids.length > 0) {
          const { data: subData } = await supabase.from('biz_data').select('*').in('id', ids).eq('is_deleted', false);
          if (subData) subCache[f.key] = subData as BizData[];
        }
      }));
      if (Object.keys(subCache).length > 0) setSubRowsCache((c) => ({ ...c, ...subCache }));

      const calced = computeFormCalculations({
        fields,
        vals: freshBiz.payload ?? {},
        subRowsMap: subCache,
        refRowsMap: refRows,
        summaryRows,
        formRowsCache,
        scopeCtx,
      });
      const freshSys: Record<string, unknown> = {};
      SYSTEM_FIELD_KEYS.forEach((k) => {
        const v = systemFieldValue(k, freshBiz, sysCtx);
        freshSys[k] = (k === 'created_at' || k === 'updated_at') && v ? fmtDate(String(v), true) : v;
      });
      setApprDraft({ ...(freshBiz.payload ?? {}), ...calced, ...freshSys });
    } catch (err) {
      console.warn('刷新审批弹窗数据失败：', err);
    }
  };

  /** 打开填写节点确认弹窗（按钮名为节点名称，仅填写人可见） */
  const openFill = async (a: BizApproval, r: BizData) => {
    setFillAppr({ appr: a, row: r });
    const sys: Record<string, unknown> = {};
    SYSTEM_FIELD_KEYS.forEach((k) => {
      const v = systemFieldValue(k, r, sysCtx);
      sys[k] = (k === 'created_at' || k === 'updated_at') && v ? fmtDate(String(v), true) : v;
    });
    setFillDraft({ ...r.payload, ...sys });

    // 每次点击弹出窗口强制从数据库刷新单据数据、流程节点与关联子表数据
    try {
      const [bRes, aRes] = await Promise.all([
        supabase.from('biz_data').select('*').eq('id', r.id).maybeSingle(),
        supabase.from('biz_approval').select('*').eq('biz_id', r.id).order('created_at'),
      ]);
      const freshBiz = (bRes.data as BizData | null) ?? r;
      const freshApprs = (aRes.data as BizApproval[]) ?? [];
      const freshA = freshApprs.find((x) => x.id === a.id) ?? a;
      setFillAppr({ appr: freshA, row: freshBiz });

      const subFields = fields.filter((f) => f.type === 'sub-table' && f.subTable?.targetFormId);
      const subCache: Record<string, BizData[]> = {};
      await Promise.all(subFields.map(async (f) => {
        const v = freshBiz.payload?.[f.key];
        const ids = Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
        if (ids.length > 0) {
          const { data: subData } = await supabase.from('biz_data').select('*').in('id', ids).eq('is_deleted', false);
          if (subData) subCache[f.key] = subData as BizData[];
        }
      }));
      if (Object.keys(subCache).length > 0) setSubRowsCache((c) => ({ ...c, ...subCache }));

      const calced = computeFormCalculations({
        fields,
        vals: freshBiz.payload ?? {},
        subRowsMap: subCache,
        refRowsMap: refRows,
        summaryRows,
        formRowsCache,
        scopeCtx,
      });
      const freshSys: Record<string, unknown> = {};
      SYSTEM_FIELD_KEYS.forEach((k) => {
        const v = systemFieldValue(k, freshBiz, sysCtx);
        freshSys[k] = (k === 'created_at' || k === 'updated_at') && v ? fmtDate(String(v), true) : v;
      });
      setFillDraft({ ...(freshBiz.payload ?? {}), ...calced, ...freshSys });
    } catch (err) {
      console.warn('刷新填写弹窗数据失败：', err);
    }
  };

  /** 填写节点确认：提交确认字段内容并推进流程 */
  const submitFill = async () => {
    if (!fillAppr) return;
    const confirmKeys = fillAppr.appr.confirm_fields ?? [];
    const cFields = fields.filter((f: FormField) => confirmKeys.includes(f.key));
    for (const f of cFields) {
      const err = validateField(f, f.type === 'sub-table' ? subTableValidateValue(fillDraft[f.key]) : fillDraft[f.key]);
      if (err) return toast.error(`${f.label}：${err}`);
    }
    setFilling(true);
    // 提交确认字段及其联动的请假拆分字段（服务端校验填写人并剔除系统字段防伪造）
    let data: Record<string, unknown> = {};
    expandLeaveKeysForSubmit(fields, confirmKeys).forEach((k) => {
      if (SYSTEM_FIELD_KEYS.includes(k as (typeof SYSTEM_FIELD_KEYS)[number])) return;
      data[k] = fillDraft[k];
    });

    // 填写节点守卫条件评估：合并单据现有数据与本次填写数据逐条校验，未满足则阻断提交并提示具体原因
    const nodeGuards = wfNodeGuards.get(fillAppr.appr.node_id ?? '') ?? [];
    if (nodeGuards.length > 0) {
      const merged = { ...(fillAppr.row.payload ?? {}), ...data };
      const chk = checkWfNodeGuards(nodeGuards, merged, (k) => fields.find((f) => f.key === k)?.label ?? k);
      if (!chk.pass) {
        setFilling(false);
        return toast.error(`守卫条件未满足：${chk.failed}`);
      }
    }

    // 关联子表明细持久化（主表 payload 替换为行 id 数组；随主表保存模式内嵌物化）：先持久化再计算变更，避免子表草稿值被格式化为「（空）」
    try {
      const uid = profile?.id ?? '';
      const { data: me } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
      const subR = await persistSubTableFieldsEx(fields, data, { tenantId: (me as { tenant_id?: string } | null)?.tenant_id ?? '', userId: uid });
      data = subR.payload;
      if (Object.keys(subR.subRows).length > 0) setSubRowsCache((c) => ({ ...c, ...subR.subRows }));
      data = await materializeInlineRefs(fields, data);
    } catch (e) {
      setFilling(false);
      return toast.error(e instanceof Error ? e.message : '子表明细保存失败');
    }

    // 基于持久化后的最终值记录修改内容：复合字段比较 id 集合并以「共 N 条明细/关联数据」描述
    const changes: { label: string; from: string; to: string }[] = [];
    expandLeaveKeysForSubmit(fields, confirmKeys).forEach((k) => {
      if (SYSTEM_FIELD_KEYS.includes(k as (typeof SYSTEM_FIELD_KEYS)[number])) return;
      const f = fieldByKey.get(k);
      if (!f) return;
      const oldV = fillAppr.row.payload?.[k];
      const newV = data[k];
      if (f.type === 'sub-table') {
        // 子表只要在编辑器中被触碰（增删改行）即视为变更；行数相同时标注「内容已更新」
        const touched = isSubTableDraftValue(fillDraft[k]);
        if (!touched && sameRefIds(oldV, newV)) return;
        const oldN = isInlineRefValue(oldV) ? oldV.rows.length : Array.isArray(oldV) ? (oldV as string[]).length : 0;
        const newN = isInlineRefValue(newV) ? newV.rows.length : Array.isArray(newV) ? (newV as string[]).length : 0;
        if (oldN === 0 && newN === 0) return;
        changes.push({ label: f.label, from: fmtChangeVal(f, oldV), to: oldN === newN ? `${fmtChangeVal(f, newV)}（内容已更新）` : fmtChangeVal(f, newV) });
        return;
      }
      if (f.type === 'form-ref') {
        if (sameRefIds(oldV, newV)) return;
      } else if (JSON.stringify(oldV ?? null) === JSON.stringify(newV ?? null)) {
        return;
      }
      changes.push({ label: f.label, from: fmtChangeVal(f, oldV), to: fmtChangeVal(f, newV) });
    });

    const { error } = await supabase.rpc('fill_node_biz', { p_biz_id: fillAppr.appr.biz_id, p_data: data, p_changes: changes });
    setFilling(false);
    if (error) return toast.error('填写确认失败：' + error.message);
    toast.success('已确认，流程进入下一节点');
    setFillAppr(null);
    setViewing(null);
    navigate(`/app/${formId}`);
    loadRows();
  };

  const refFieldLabel = (f: FormField, key: string) => {
    const meta = refFormMeta[f.key];
    const fd = meta?.schema_json?.fields?.find((x: FormField) => x.key === key);
    return fd?.label ?? key;
  };

  // 目标表单字段若为已拆分的请假时间复合字段，关联展示列不再显示
  const isSplitLeaveRefKey = (f: FormField, key: string) => {
    const meta = refFormMeta[f.key];
    const fd = meta?.schema_json?.fields?.find((x: FormField) => x.key === key);
    return !!fd && fd.type === 'leave-time' && !!fd.leaveTime?.startKey && !!fd.leaveTime?.endKey;
  };

  const refFieldValue = (f: FormField, r: BizData, key: string) => {
    const meta = refFormMeta[f.key];
    const tf = meta?.schema_json?.fields?.find((x: FormField) => x.key === key);
    let v = r.payload?.[key];
    const targetSm = refSmStates[f.key] || (f.relation?.formId ? refSmStates[f.relation.formId] : null);
    // 状态字段：始终从目标表单状态机（优先）或全局状态机解析出状态名称（标签）
    if (key === 'status') {
      const stVal = String(r.status || (r.payload?.status as string) || '');
      if (!stVal) return '—';
      return targetSm?.get(stVal)?.label ?? smStates.get(stVal)?.label ?? (stVal === 'draft' ? '草稿' : stVal === 'pending' ? '审批中' : stVal === 'approved' ? '已批准' : stVal === 'rejected' ? '已驳回' : stVal);
    }
    // 关联展示字段可为系统字段：从行数据与档案映射取值
    if ((v === undefined || v === null || v === '') && SYSTEM_FIELD_KEYS.includes(key as (typeof SYSTEM_FIELD_KEYS)[number])) {
      if (key === 'created_by') v = userMap.get(r.created_by ?? '') ?? r.created_by;
      else if (key === 'updated_by') v = r.updated_by ? (userMap.get(r.updated_by) ?? r.updated_by) : undefined;
      else if (key === 'created_at') v = r.created_at;
      else if (key === 'updated_at') v = r.updated_at;
      else v = sysVal(key, r);
    }
    // 数据源下拉字段（例如项目所属）：选项值为目标记录 id，按显示字段配置解析为显示文本
    if (tf && (tf.type === 'select' || tf.type === 'multi-select' || tf.type === 'search-select' || tf.type === 'search-multi-select') && tf.optionSource?.formId && optionDisplayKeys(tf).length > 0) {
      if (v === undefined || v === null || v === '') return '—';
      const srcRows = refPickerSrcRows[tf.optionSource.formId] ?? [];
      const sep = tf.optionSource.separator ?? '-';
      const keys = optionDisplayKeys(tf);
      const resolve = (id: string): string => {
        const rec = srcRows.find((row) => row.id === id);
        if (!rec) return id;
        const joined = keys.map((k) => formatOptionFieldValue(k, rec, userMap, targetSm ?? smStates)).filter(Boolean).join(sep);
        return joined || id;
      };
      if (Array.isArray(v)) return v.map((x) => resolve(String(x))).join('、') || '—';
      return resolve(String(v));
    }
    if (v === undefined || v === null || v === '') return '—';
    if ((key === 'created_at' || key === 'updated_at') && typeof v === 'string') return fmtDate(v, true);
    if (tf?.type === 'money' && typeof v === 'number') return fmtMoney(v);
    if (tf?.type === 'date') return fmtDate(String(v));
    if (tf?.type === 'datetime') return fmtDate(String(v), true);
    if (tf?.type === 'percent' && typeof v === 'number') return `${v}%`;
    if (tf?.type === 'dept-select') return departments.find((d) => d.id === String(v))?.name ?? '—';
    if (tf?.type === 'user-select') {
      const ids = Array.isArray(v) ? (v as string[]) : [v as string];
      return ids.map((id) => userMap.get(String(id)) ?? String(id)).join('、') || '—';
    }
    if (tf?.type === 'leave-time') {
      const lv = v as LeaveTimeValue;
      return lv.days !== undefined || lv.hours !== undefined ? `${lv.days ?? 0} 天 / ${lv.hours ?? 0} 小时` : '—';
    }
    if (Array.isArray(v)) return v.join('、');
    return String(v);
  };

  const fmtCell = (r: BizData, key: string, format?: string) => {
    let v = r.payload?.[key];
    // 负责人列：优先显示单据当前处理人（assignee，转移/分配后同步更新）；无负责人时回退业务字段值
    if (key === 'responsible_person' && r.assignee_name) v = r.assignee_name;
    // 系统字段从行数据派生（payload 不存储，防伪造）
    if (v === undefined && SYSTEM_FIELD_KEYS.includes(key as (typeof SYSTEM_FIELD_KEYS)[number])) {
      v = sysVal(key, r);
    } else if (v === undefined) {
      v = key === 'status' ? statusText(r.status) : key === 'created_at' ? r.created_at : undefined;
    }
    // 计算字段（汇总/公式/大写金额/关联取值）payload 为空时回退实时计算，保证列表不出现「—」（子表行已随列表预取到 subRowsCache）
    const calcDef = fieldByKey.get(key);
    if ((v === undefined || v === null || v === '') && calcDef && (calcDef.type === 'summary' || calcDef.type === 'formula' || calcDef.type === 'amount-uppercase' || calcDef.type === 'fetch-value')) {
      v = calcFor(r.payload ?? {})[key];
    }
    if (v === undefined || v === null || v === '') return '—';
    if ((key === 'created_at' || key === 'updated_at') && typeof v === 'string') return fmtDate(v, true);
    if (format === 'money' && typeof v === 'number') return fmtMoney(v);
    if (format === 'date') return fmtDate(String(v));
    if (format === 'datetime') return fmtDate(String(v), true);
    if (format === 'percent' && typeof v === 'number') return `${v}%`;
    if (Array.isArray(v)) return v.length > 0 ? v.map((x) => (x && typeof x === 'object' ? formatAddress(x) : String(x))).join('、') : '—';
    const f = fieldByKey.get(key);
    if (f?.type === 'address') return formatAddress(v) || '—';
    if (f?.type === 'dept-select') return departments.find((d) => d.id === String(v))?.name ?? '—';
    if (f?.type === 'user-select') {
      const ids = Array.isArray(v) ? (v as string[]) : [v as string];
      return ids.map((id) => userMap.get(String(id)) ?? String(id)).join('、') || '—';
    }
    if (f?.type === 'form-ref') {
      const ids = Array.isArray(v) ? (v as string[]) : [];
      return ids.length > 0 ? `${ids.length} 条关联` : '—';
    }
    // 表单赋值字段：存储为记录 id，列表展示选项文本（refSrcRows 缓存实时解析，回退展示已存值）
    if (f?.type === 'form-assignment') {
      const cfg = f.assignment;
      const rec = cfg?.formId ? (refSrcRows[f.key] ?? []).find((row) => row.id === String(v)) : undefined;
      if (!rec) return String(v);
      const sep = cfg?.displaySeparator ?? ' ';
      const keys = cfg?.displayFieldKeys ?? [];
      const joined = keys.map((k) => { const rv = (rec.payload as Record<string, unknown> | undefined)?.[k]; return rv === undefined || rv === null || rv === '' ? '' : (typeof rv === 'object' ? JSON.stringify(rv) : String(rv)); }).filter(Boolean).join(sep);
      return joined || String(v);
    }
    // 下拉动态数据源：选项值为记录 id，按显示字段配置回显文本（存量数据仍为普通文本值时原样兜底）
    if ((f?.type === 'select' || f?.type === 'multi-select' || f?.type === 'search-select' || f?.type === 'search-multi-select') && optionDisplayKeys(f).length > 0) {
      const rows = refSrcRows[f.key] ?? [];
      const resolve = (id: string) => {
        const rec = rows.find((row) => row.id === id);
        if (!rec) return id;
        const sep = f.optionSource?.separator ?? '-';
        const joined = optionDisplayKeys(f).map((k) => formatOptionFieldValue(k, rec, userMap, smStates)).filter(Boolean).join(sep);
        return joined || id;
      };
      if (Array.isArray(v)) return v.map((x) => resolve(String(x))).join('、') || '—';
      return resolve(String(v));
    }
    if (f?.type === 'leave-time') {
      const lv = v as LeaveTimeValue;
      return fmtLeave(lv);
    }
    // 对象值兜底安全格式化（如地址对象），避免直接转字符串显示 [object Object]
    if (typeof v === 'object' && v !== null) return formatAddress(v) || '—';
    return String(v);
  };

  // 详情弹窗字段展示值（与列表 fmtCell 一致的格式化逻辑，但空值返回空串由调用方决定是否隐藏）
  const fmtDisplayValue = (f: FormField, raw: unknown): string => {
    let v = raw;
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return '';
    // 复合字段内嵌值（随主表统一保存）：摘要计数展示，避免对象被展开为地址串
    if ((f.type === 'sub-table' || f.type === 'form-ref') && isInlineRefValue(v)) {
      const n = v.rows.length;
      return n === 0 ? '' : f.type === 'sub-table' ? `共 ${n} 条明细` : `共 ${n} 条关联数据`;
    }
    if ((f.key === 'created_at' || f.key === 'updated_at') && typeof v === 'string') return fmtDate(v, true);
    if (findFieldDef(f.type)?.type === 'money' && typeof v === 'number') return fmtMoney(v);
    if (f.type === 'date') return fmtDate(String(v));
    if (f.type === 'datetime') return fmtDate(String(v), true);
    if (f.type === 'percent' && typeof v === 'number') return `${v}%`;
    if (f.type === 'address') return formatAddress(v);
    if ((f.type === 'select' || f.type === 'multi-select' || f.type === 'search-select' || f.type === 'search-multi-select') && optionDisplayKeys(f).length > 0) {
      const rows = refSrcRows[f.key] ?? [];
      const resolve = (id: string) => {
        const rec = rows.find((row) => row.id === id);
        if (!rec) return id;
        const sep = f.optionSource?.separator ?? '-';
        const joined = optionDisplayKeys(f).map((k) => formatOptionFieldValue(k, rec, userMap, smStates)).filter(Boolean).join(sep);
        return joined || id;
      };
      if (Array.isArray(v)) return v.map((x) => resolve(String(x))).join('、');
      return resolve(String(v));
    }
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? formatAddress(x) : String(x))).join('、');
    if (f.type === 'dept-select') return departments.find((d) => d.id === String(v))?.name ?? '';
    if (f.type === 'user-select') {
      const ids = Array.isArray(v) ? (v as string[]) : [v as string];
      return ids.map((id) => userMap.get(String(id)) ?? String(id)).join('、');
    }
    if (f.type === 'leave-time') {
      const lv = v as LeaveTimeValue;
      return lv.start_date ? fmtLeave(lv) : '';
    }
    // 对象值兜底安全格式化（如地址对象），避免直接转字符串显示 [object Object]
    if (typeof v === 'object' && v !== null) return formatAddress(v);
    return String(v);
  };

  // 变更记录取值：复合字段（关联子表/关联表单）以「共 N 条明细/关联数据」描述，避免子表草稿或 id 数组被显示为「（空）」或 UUID 串
  const fmtChangeVal = (f: FormField, v: unknown): string => {
    if (f.type === 'sub-table' || f.type === 'form-ref') {
      const n = isSubTableDraftValue(v) ? v.rows.length : isInlineRefValue(v) ? v.rows.length : Array.isArray(v) ? (v as string[]).length : 0;
      if (n === 0) return '（空）';
      return f.type === 'sub-table' ? `共 ${n} 条明细` : `共 ${n} 条关联数据`;
    }
    return fmtDisplayValue(f, v) || '（空）';
  };

  /** 销假等填写弹窗修改时间后即时入库：不等「确定」，修改即自动保存新时间与重算的天数/小时 */  const autoSaveLeavePatch = async (patch: Record<string, unknown>) => {
    if (!fillAppr) return;
    const { error } = await supabase.from('biz_data')
      .update({ payload: { ...(fillAppr.row.payload ?? {}), ...patch }, updated_at: new Date().toISOString() })
      .eq('id', fillAppr.appr.biz_id);
    if (error) return toast.error('自动保存失败：' + error.message);
    toast.success('时间已自动保存，请假时长已同步重算');
    loadRows();
  };

  const exportCsv = () => {
    const header = colCfg.map((c) => c.label).join(',');
    const body = rows.map((r) => colCfg.map((c) => `"${fmtCell(r, c.key, c.format).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${form?.name ?? 'data'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('已导出 CSV');
  };

  // 关联弹窗：加载目标表单数据（选择模式过滤掉已关联项）
  const openRelated = async (relation: MetaRelation, row: BizData, mode: 'select' | 'view' | 'unlink') => {
    setRelatedDlg({ relation, row, mode });
    setRelatedLoading(true);
    setRelatedSel([]);
    const linked = (row.payload?.[relation.backfill_field] as string[]) ?? [];
    let q = supabase.from('biz_data').select('*').eq('form_id', relation.target_form_id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
    if (mode === 'view' || mode === 'unlink') {
      if (linked.length > 0) q = q.in('id', linked);
      else { setRelatedRows([]); setRelatedLoading(false); return; }
    }
    const { data } = await q;
    setRelatedRows((data as BizData[]) ?? []);
    setRelatedLoading(false);
  };

  // 确认选择关联：回填 backfill_field，并按关联定义的赋值映射把关联表字段值写入主表字段
  const saveRelated = async () => {
    if (!relatedDlg || relatedDlg.mode !== 'select') return;
    const { relation, row } = relatedDlg;
    const cur = new Set((row.payload?.[relation.backfill_field] as string[]) ?? []);
    if (!relation.multiple) cur.clear();
    relatedSel.forEach((id) => cur.add(id));
    const nextIds = [...cur];
    // 字段赋值：取最新关联的记录（单选取唯一值；多选取第一条），按映射写入主表 payload
    let patch: Record<string, unknown> = {};
    const mappings = relation.field_mappings ?? [];
    if (mappings.length > 0 && nextIds.length > 0) {
      const { data: tRows } = await supabase.from('biz_data').select('title, payload, created_at').in('id', nextIds).order('created_at', { ascending: false });
      const first = (tRows ?? [])[0];
      if (first) {
        for (const m of mappings) {
          if (!m.mainKey || !m.targetKey) continue;
          const v = m.targetKey === 'title' ? first.title : (first.payload as Record<string, unknown> | null)?.[m.targetKey];
          if (v !== undefined && v !== null) patch[m.mainKey] = v;
        }
      }
    }
    const { error } = await supabase.from('biz_data').update({
      payload: { ...row.payload, [relation.backfill_field]: nextIds, ...patch },
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) return toast.error('关联失败：' + error.message);
    toast.success(mappings.length > 0 && Object.keys(patch).length > 0 ? `已关联，并赋值 ${Object.keys(patch).length} 个主表字段` : (relation.multiple ? `已关联 ${relatedSel.length} 条记录` : '已关联'));
    setRelatedDlg(null);
    loadRows();
  };

  // 解除关联：从源单据 backfill_field 中移除指定记录 ID（目标记录本身保留）
  const removeRelated = async (targetId: string) => {
    if (!relatedDlg || relatedDlg.mode !== 'unlink') return;
    const { relation, row } = relatedDlg;
    const next = ((row.payload?.[relation.backfill_field] as string[]) ?? []).filter((id) => id !== targetId);
    const { error } = await supabase.from('biz_data').update({
      payload: { ...row.payload, [relation.backfill_field]: next },
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) return toast.error('解除关联失败：' + error.message);
    toast.success('已解除关联（目标记录保留）');
    setRelatedDlg(null);
    loadRows();
  };

  // 注册确认对话框桥接（动作引擎二次确认）
  useEffect(() => {
    setConfirmBridge((text) => new Promise<boolean>((resolve) => setConfirmState({ text, resolve })));
    return () => setConfirmBridge(() => Promise.resolve(true));
  }, []);

  // URL focus 参数：跳转详情
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (focus && rows.length > 0) {
      const target = rows.find((r) => r.id === focus);
      if (target) openView(target);
    }
  }, [rows]);

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!form) return <div className="p-8 text-center text-muted-foreground">应用不存在或未发布</div>;
  /** 表单页顶部通栏面包屑：模块 > 表单名 > 页面动作，右侧返回 */
  const crumbAction = routeMode.mode === 'new' ? '新建' : routeMode.mode === 'edit' ? '编辑' : routeMode.mode === 'view' ? '详情' : '';
  const breadcrumbBar = (routeMode.mode !== 'list' && crumbAction) ? (
    <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-block w-1 h-4 bg-primary rounded-full shrink-0" aria-hidden="true" />
        <span className="text-sm truncate">
          {breadcrumbModule && <span className="text-muted-foreground">{breadcrumbModule}</span>}
          {breadcrumbModule && <span className="mx-1.5 text-muted-foreground/60">/</span>}
          <span className="text-foreground font-medium">{form.name}</span>
          <span className="mx-1.5 text-muted-foreground/60">/</span>
          <span className="text-muted-foreground">{crumbAction}</span>
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={breadcrumbBack} className="shrink-0 border border-border text-muted-foreground hover:text-foreground">返回</Button>
    </div>
  ) : null;
  if (form.status !== 'published') {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
        <FileText className="h-8 w-8" />
        <p className="text-sm">该应用尚未发布</p>
        <Button size="sm" onClick={() => navigate(`/design/${formId}?tab=form`)}>去设计并发布</Button>
      </div>
    );
  }

  // 通过/驳回按钮仅当前审批人可见（审批人列表匹配，超管不再直接放开）；已在该节点操作过的人（会签场景）不再显示；依次审批仅当前轮到的人可见
  const canApprove = (a: BizApproval) => a.current && a.state === 'pending' && a.approvers.includes(profile?.id ?? '') && !a.acts.some((act) => act.user_id === profile?.id) && (a.mode !== 'sequential' || currentTurnOf(a) === (profile?.id ?? ''));
  // 填写确认按钮仅当前填写人可见；已操作过不再显示
  const canFill = (a: BizApproval) => a.current && a.state === 'pending' && a.node_type === 'fill' && a.approvers.includes(profile?.id ?? '') && !a.acts.some((act) => act.user_id === profile?.id);
  /** 条件表达式附加变量：canApprove/canFill = 当前用户是否为该单据当前待处理节点的审批人/填写人（含会签未处理判断），供 JSONLogic 显示/启用条件引用 */
  const condExtra = (row: BizData | null): Record<string, unknown> => {
    const uid = profile?.id ?? '';
    // 使用 loadRows 预取的当前页各行待处理节点（pendingApprovals），保证列表渲染时 canApprove/canFill 正确
    const list = (row ? pendingApprovals[row.id] : undefined) ?? [];
    const has = (fill: boolean) => list.some((a) => a.current && a.state === 'pending' && (fill ? a.node_type === 'fill' : a.node_type !== 'fill')
      && a.approvers.includes(uid) && !a.acts.some((act) => act.user_id === uid) && (a.mode !== 'sequential' || currentTurnOf(a) === uid));
    // 我负责的：单据当前处理人（assignee）id/姓名——转移给我的或分配给我的单据
    return { canApprove: has(false), canFill: has(true), assignee_id: row?.assignee_id ?? '', assigneeName: row?.assignee_name ?? '' };
  };
  /** 审批人名单展示：user id 转姓名，role id 转角色名，无法识别时降级显示前 8 位 */
  const apprNames = (ids: string[]) => ids.map((id) => userMap.get(id) ?? roleMap.get(id) ?? `${id.slice(0, 8)}…`).join('、');
  const toolbarDefs = visibleDefs('toolbar');
  const batchDefs = visibleDefs('batch');
  const selRows = rows.filter((r) => selectedIds.includes(r.id));
  const formTopDefs = viewing ? visibleDefs('form-top', viewing) : [];
  const formBottomDefs = viewing ? visibleDefs('form-bottom', viewing) : [];

  /** 按钮样式渲染（行/工具栏/批量统一入口） */
  const ActBtn = ({ def, row, rows, size = 'sm' }: { def: ActionDef; row?: BizData | null; rows?: BizData[]; size?: 'sm' | 'default' }) => {
    // 启用条件不满足：按钮置灰禁用并提示（引擎执行时亦兜底拦截）；状态机流转动作叠加守卫条件评估
  const enabled = passCond(def.enable_condition, row ?? null, profile, condExtra(row ?? null), smStates) && (def.action_type !== 'SM_TRANSITION' || smGuardsPass(row, def.config.transitionId));
    return (
      <button
        type="button"
        disabled={!enabled}
        title={!enabled ? '当前数据不满足执行条件' : undefined}
        onClick={() => {
          if (!enabled) return;
          // 审核通过/驳回：不直接执行，先打开对应审批节点信息弹窗，查看单据内容后在弹窗内操作
          if ((def.action_type === 'APPROVE' || def.action_type === 'REJECT') && row) {
            const appr = (pendingApprovals[row.id] ?? []).find((a) => a.current && a.state === 'pending' && a.node_type !== 'fill' && (a.approvers ?? []).includes(profile?.id ?? ''));
            if (!appr) return toast.error('该单据没有待您处理的审批节点');
            openApprove(def.action_type === 'APPROVE' ? 'approve' : 'reject', appr, row);
            return;
          }
          // 填写节点确认（如销假）：定位当前待处理填写节点打开填写弹窗
          if (def.action_type === 'FILL_NODE' && row) {
            const appr = (pendingApprovals[row.id] ?? []).find((a) => a.current && a.state === 'pending' && a.node_type === 'fill' && (a.approvers ?? []).includes(profile?.id ?? ''));
            if (!appr) return toast.error('该单据没有待您处理的填写节点');
            openFill(appr, row);
            return;
          }
          const batchRows = rows ?? (def.position === 'batch' ? selRows : undefined);
          void executeAction(def, actionCtx(row, batchRows));
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors',
          size === 'sm' ? 'h-7 px-2.5' : 'h-9 px-3.5',
          variantClass(def.variant),
          !enabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        {def.name}
      </button>
    );
  };

  return (
    <div className="p-4 md:p-8">
      {breadcrumbBar}
      {/* 列表模式：工具栏/筛选/表格/分页（页面模式下隐藏，组件常驻保留筛选状态） */}
      {routeMode.mode === 'list' && (
      <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-balance">{form.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">共 {total} 条数据</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {toolbarDefs.map((a) => (
            <ActBtn key={a.id} def={a} size="default" />
          ))}
        </div>
      </div>

      {/* 搜索筛选区 */}
      {searchCfg.length > 0 && (
        <div className="bg-card border border-border rounded-lg px-4 py-3 mb-4 flex flex-wrap items-end gap-3">
          {searchCfg.map((s) => (
            <div key={s.key} className="space-y-1 min-w-40">
              <Label className="text-xs text-muted-foreground">{s.label}</Label>
              {s.control === 'select' ? (
                <Select value={searchVals[s.key] ?? 'all'} onValueChange={(v) => { setSearchVals((x) => ({ ...x, [s.key]: v === 'all' ? '' : v })); setPage(0); }}>
                  <SelectTrigger className="w-40 h-9"><SelectValue placeholder="全部" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    {(s.key === 'status'
                      ? Array.from(smStates.entries()).map(([key, info]) => ({ value: key, label: info.label }))
                      : (s.options ?? []).map((o) => ({ value: o, label: o }))
                    ).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : s.control === 'date-range' ? (
                <DateRangeFilter value={searchVals[s.key] ?? ''} onChange={(v) => { setSearchVals((x) => ({ ...x, [s.key]: v })); setPage(0); }} />
              ) : (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input className="pl-8 w-44 h-9" placeholder={`搜索${s.label}`} value={searchVals[s.key] ?? ''} onChange={(e) => { setSearchVals((x) => ({ ...x, [s.key]: e.target.value })); setPage(0); }} />
                </div>
              )}
            </div>
          ))}
          {Object.values(searchVals).some(Boolean) && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearchVals({}); setPage(0); }}><X className="mr-1 h-3.5 w-3.5" />清空</Button>
          )}
        </div>
      )}

      {/* 批量操作栏（勾选后显示） */}
      {selectedIds.length > 0 && batchDefs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 mb-4 rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-2.5">
          <span className="text-xs font-medium">已选 {selectedIds.length} 项</span>
          <div className="flex flex-wrap gap-2">
            {batchDefs.map((a) => (
              <ActBtn key={a.id} def={a} rows={selRows} />
            ))}
          </div>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs ml-auto" onClick={() => setSelectedIds([])}>取消选择</Button>
        </div>
      )}

      {/* 列表 */}
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              {batchDefs.length > 0 && <th className="w-10 px-3 py-2.5"><Checkbox checked={selectedIds.length === rows.length && rows.length > 0} onCheckedChange={(v) => setSelectedIds(v === true ? rows.map((r) => r.id) : [])} aria-label="全选" /></th>}
              {colCfg.map((c) => (
                <th key={c.key} className={cn('px-4 py-2.5 font-medium whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>{c.label}</th>
              ))}
              <th className="px-5 py-2.5 font-medium text-right whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const rowDefs = visibleDefs('row', r);
              const visible = rowDefs.slice(0, rowVisibleLimit);
              const overflow = rowDefs.slice(rowVisibleLimit);
              return (
                <tr key={r.id} className="hover:bg-muted/50">
                  {batchDefs.length > 0 && (
                    <td className="px-3 py-3">
                      <Checkbox checked={selectedIds.includes(r.id)} onCheckedChange={(v) => setSelectedIds((s) => (v ? [...s, r.id] : s.filter((x) => x !== r.id)))} aria-label="选择" />
                    </td>
                  )}
                  {colCfg.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 whitespace-nowrap', c.align === 'right' && 'text-right', c.format === 'money' && 'sig-num')}>
                      {/* 状态列：勾选后以徽章渲染状态机名称（含自定义状态颜色），未配置则不显示该列 */}
                      {c.key === 'status'
                        ? <span className="sig-status" style={statusBadgeStyle(r.status)} data-status={statusData(r.status)}>{statusText(r.status)}</span>
                        : fmtCell(r, c.key, c.format)}
                    </td>
                  ))}
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      {/* 填写节点（如销假）不再自动渲染：统一在「列表设计-操作项配置」中添加「填写节点确认」动作 */}
                      {visible.map((a) => (
                        <ActBtn key={a.id} def={a} row={r} />
                      ))}
                      {overflow.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="h-7 px-2.5 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors inline-flex items-center gap-0.5">
                              更多<MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {overflow.map((a) => (
                              <DropdownMenuItem key={a.id} onClick={() => runAct(a, r)} className={cn('text-xs', a.variant === 'danger' && 'text-destructive focus:text-destructive')}>
                                {a.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {rowDefs.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={colCfg.length + 1 + (batchDefs.length > 0 ? 1 : 0)} className="px-5 py-14 text-center text-muted-foreground">暂无数据，点击右上角新建</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <DataPagination
        total={total}
        page={page + 1}
        pageSize={pageSize}
        onPageChange={(p) => setPage(p - 1)}
        onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
      />
      </>
      )}

      {/* 新建/编辑独立页面（路由驱动，弃弹窗） */}
      {(routeMode.mode === 'new' || routeMode.mode === 'edit') && form && (routeMode.mode === 'new' || editing) && (
        <div className="min-h-full bg-white p-4 md:p-6">
          <div className="mx-auto w-full md:w-1/2">
            <div className="bg-card border border-border rounded-lg p-4 md:p-6 shadow-sm">
            <div className="grid gap-x-4 gap-y-4" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
            {(() => {
              const hiddenKeys = evaluateVisibility(form.settings?.visibilityRules, draft);
              // 全局 fields 已过滤 action-button（列表/详情不渲染按钮）；此处按 schema 原始顺序取回按钮字段，保持设计器中的栅格位置
              const buttonFields = (form?.schema_json?.fields ?? []).filter((f: FormField) => f.type === 'action-button' && !f.system);
              const renderFields = [
                ...fields.filter((f: FormField) => !f.system),
                ...buttonFields,
              ].sort((a, b) => {
                const ia = (form?.schema_json?.fields ?? []).findIndex((x) => x.id === a.id);
                const ib = (form?.schema_json?.fields ?? []).findIndex((x) => x.id === b.id);
                return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
              });
              return renderFields.filter((f: FormField) => (!isWizard || (wizSteps[wizardStep]?.fieldKeys ?? []).includes(f.key) || f.type === 'action-button')).map((f: FormField) => {
              if (f.type !== 'grid' && LAYOUT_TYPES.includes(f.type)) return null;
              if (hiddenKeys.has(f.key)) return null;
              // 请假拆分的时间字段由请假时间组件联动写入，编辑弹窗不重复显示
              if (leaveEditKeys.has(f.key)) return null;
              const span = f.span ?? 12;
              if (f.type === 'grid') {
                const cols = f.layout?.columns ?? (f.gridColumns?.length || 2);
                const columns = f.gridColumns ?? [];
                const vals = gridValues[f.key] ?? [];
                return (
                  <div key={f.id} style={{ gridColumn: 'span 24 / span 24' }} className="min-w-0">
                    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-border/50">
                        <span className="text-sm font-semibold text-foreground">{f.label || '分栏布局'}</span>
                        <span className="text-xs text-muted-foreground">{cols} 栏</span>
                      </div>
                      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                        {Array.from({ length: cols }).map((_, i) => {
                          const col = columns[i];
                          const val = vals[i] ?? col?.defaultValue ?? '—';
                          return (
                            <div key={i} className="rounded-md border border-border/70 bg-muted/20 p-3 flex flex-col justify-between min-h-16">
                              <p className="text-xs font-medium text-muted-foreground">{col?.title || `第 ${i + 1} 栏`}</p>
                              <p className="text-base font-bold text-foreground mt-1 truncate">{val || '—'}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }
              if (f.type === 'action-button') {
                return (
                  <div key={f.id} style={{ gridColumn: `span ${span} / span ${span}` }} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        // 关联表单赋值：弹出关联表单数据列表，选中后按映射写入当前表单字段
                        if (f.button?.actionType === 'REF_ASSIGN') {
                          if (!f.button.refAssign?.formId) return toast.error('该按钮未配置关联表单');
                          if ((f.button.refAssign.mappings ?? []).length === 0) return toast.error('该按钮未配置字段赋值映射');
                          setRefAssignField(f);
                          return;
                        }
                        runFieldButton(f, editing ?? null);
                      }}
                      className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      {f.label}
                    </button>
                  </div>
                );
              }
              if (leaveResultKeys.has(f.key)) {
                return (
                  <div key={f.id} style={{ gridColumn: `span ${span} / span ${span}` }} className="min-w-0 space-y-1.5">
                    <Label className="text-sm">{f.label}</Label>
                    <Input value={draft[f.key] !== undefined && draft[f.key] !== null && draft[f.key] !== '' ? String(draft[f.key]) : ''} readOnly placeholder="由请假时间自动计算" className="bg-muted/30" />
                  </div>
                );
              }
              if (f.type === 'form-ref') {
                const rows = (Array.isArray(draft[f.key]) ? (draft[f.key] as string[]) : []);
                const displayFields = (f.relation?.displayFields?.length ? f.relation.displayFields : ['title']).filter((k) => !isSplitLeaveRefKey(f, k));
                const allTarget = refRows[f.key] ?? [];
                return (
                  <div key={f.id} style={{ gridColumn: `span ${span} / span ${span}` }} className="min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setRefPicker({ field: f }); setRefPickerSel(rows); }}>
                        <Plus className="h-3.5 w-3.5 mr-1" />选择
                      </Button>
                    </div>
                    <div className="rounded-md border border-border overflow-hidden">
                      <div className="max-h-52 overflow-y-auto">
                        {rows.length === 0 ? (
                          <p className="px-3 py-4 text-xs text-muted-foreground text-center">点击「选择」添加关联数据</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                              <tr>
                                {displayFields.map((k) => <th key={k} className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium text-muted-foreground">{refFieldLabel(f, k)}</th>)}
                                <th className="w-10 px-2 py-1.5" />
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((id) => {
                                const r = allTarget.find((x) => x.id === id);
                                return (
                                  <tr key={id} className="border-t border-border">
                                    {displayFields.map((k) => (
                                      <td key={k} className="whitespace-nowrap px-2.5 py-1.5 text-foreground">{r ? refFieldValue(f, r, k) : <span className="text-muted-foreground/60">关联数据已失效</span>}</td>
                                    ))}
                                    <td className="px-2 py-1.5 text-right">
                                      <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setDraft((d) => ({ ...d, [f.key]: rows.filter((x) => x !== id) }))}><X className="h-3.5 w-3.5" /></button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              if (f.type === 'sub-table') {
                // 关联子表：内嵌可编辑明细列表（主表保存时统一持久化，草稿暂存于内存）
                return (
                  <div key={f.id} style={{ gridColumn: 'span 24 / span 24' }} className="min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">
                        {f.label}
                        {f.required && <span className="text-destructive ml-0.5">*</span>}
                      </Label>
                      <span className="text-[11px] text-muted-foreground">{f.subTable?.saveMode === 'standalone' ? '单独保存（行确定即入库）' : '随主表统一保存'}</span>
                    </div>
                    <SubTableEditor field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} onMainRecalced={(patch) => setDraft((d) => ({ ...d, ...patch }))} readOnly={f.readOnly} scopeCtx={scopeCtx} mainBizId={editing?.id ?? null} />
                  </div>
                );
              }
              return (
                <div key={f.id} style={{ gridColumn: `span ${span} / span ${span}` }} className="min-w-0 space-y-1.5">
                  <Label className="text-sm">
                    {f.label}
                    {f.required && <span className="text-destructive ml-0.5">*</span>}
                  </Label>
                  <FieldControl field={f.readOnly || relAssignedReadonlyKeys.has(f.key) ? { ...f, disabled: true } : f} value={f.type === 'system-status' && draft[f.key] === undefined && editing ? editing.status : draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} onChangeExtra={(key, v) => setDraft((d) => ({ ...d, [key]: v }))} departments={departments} refOptions={refOptions} refSrcRows={refSrcRows} members={members} queryRows={queryRows} queryMeta={queryMeta} sysValue={sysVal} queryFilterVals={queryFilterVals} onQueryFilterChange={(k, v) => setQueryFilterVals((p) => ({ ...p, [k]: v }))} calcVals={calcVals} currentFormId={form?.id} scopeCtx={scopeCtx} smStates={smStates} />
                  {(f.readOnly || relAssignedReadonlyKeys.has(f.key)) && <p className="text-[11px] text-muted-foreground">{relAssignedReadonlyKeys.has(f.key) && !f.readOnly ? '关联赋值字段，只读' : '只读字段'}</p>}
                </div>
              );
            });
            })()}
          </div>
          {/* 向导表单步骤导航：步骤条 + 上一步/下一步（最后一步改为提交） */}
          {isWizard && (
            <div className="pt-4 border-t border-border mt-4 space-y-3">
              <div className="flex items-center">
                {wizSteps.map((st, i) => (
                  <div key={st.id} className="flex items-center flex-1 last:flex-none">
                    <button
                      type="button"
                      onClick={() => i <= wizardStep && setWizardStep(i)}
                      className={cn(
                        'flex items-center gap-1.5 whitespace-nowrap',
                        i < wizardStep ? 'text-primary cursor-pointer' : i === wizardStep ? 'text-foreground font-medium' : 'text-muted-foreground',
                      )}
                    >
                      <span className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                        i < wizardStep ? 'bg-primary text-primary-foreground' : i === wizardStep ? 'bg-primary/10 text-primary ring-1 ring-primary/40' : 'bg-muted text-muted-foreground',
                      )}>{i < wizardStep ? <CheckCircle2 className="h-3 w-3" /> : i + 1}</span>
                      <span className="text-xs">{st.title}</span>
                    </button>
                    {i < wizSteps.length - 1 && <div className={cn('h-px flex-1 mx-2 min-w-4', i < wizardStep ? 'bg-primary/60' : 'bg-border')} />}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setWizardStep((i) => Math.max(0, i - 1))} disabled={wizardStep === 0 || saving}>
                  <ChevronDown className="h-4 w-4 mr-1 rotate-90" />上一步
                </Button>
                {wizardStep < wizSteps.length - 1 ? (
                  <Button onClick={nextStep} disabled={saving}>下一步<ChevronDown className="h-4 w-4 ml-1 -rotate-90" /></Button>
                ) : (
                  <Button onClick={() => save(true)} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}提交</Button>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border">
            <Button variant="outline" onClick={backToList}>取消</Button>
            {/* 向导模式主按钮位于步骤导航区（最后一步提交）；普通表单无草稿概念，仅提供提交 */}
            {!editing && !isWizard && form?.form_mode !== 'normal' && <Button variant="outline" onClick={() => save(false)} disabled={saving}>存草稿</Button>}
            {!isWizard && <Button onClick={() => save(true)} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? '保存' : '提交'}</Button>}
          </div>
          </div>
          </div>
        </div>
      )}
      {routeMode.mode === 'edit' && !editing && (
        <div className="py-24 text-center text-sm text-muted-foreground">{routeRowMissing ? '未找到该单据，可能已被删除或您无权访问' : '正在加载单据…'}</div>
      )}

      {/* 详情独立页面（路由驱动，弃弹窗）：审批/填写/关联等流程交互仍以弹窗承载 */}
      {routeMode.mode === 'view' && form && viewing && (
        <div className="w-full">
          {(showSysStatus || viewing.assignee_name) && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {showSysStatus && <span className="sig-status" style={statusBadgeStyle(viewing.status)} data-status={statusData(viewing.status)}>{statusText(viewing.status)}</span>}
              {viewing.assignee_name && <span className="text-xs font-normal text-muted-foreground">当前处理人：{viewing.assignee_name}</span>}
            </div>
          )}
          <div className="bg-card border border-border rounded-lg p-4 md:p-6 shadow-sm space-y-4">
            <>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {fields.filter((f: FormField) => f.type !== 'form-ref' && f.type !== 'query' && f.type !== 'sub-table' && !AUDIT_FIELD_KEYS.includes(f.key as AuditKey) && !leaveHiddenKeys.has(f.key) && (showSysStatus || f.key !== 'status')).map((f: FormField) => {
                  let v: unknown = viewing.payload?.[f.key];
                  if (v == null && (f.type === 'summary' || f.type === 'formula' || f.type === 'amount-uppercase' || f.type === 'fetch-value')) {
                    v = calcFor(viewing.payload ?? {})[f.key];
                  }
                  if (isAuditSystemField(f)) {
                    // 系统字段从行数据派生（申请人姓名/所属部门/职位/状态/创建更新信息），不读 payload 防伪造
                    v = systemFieldValue(f.key, viewing, sysCtx);
                    if ((f.key === 'created_at' || f.key === 'updated_at') && v) v = fmtDate(String(v), true);
                  }
                  // 空值字段隐藏（如未填写的销假等），保持详情简洁
                  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
                  return (
                    <div key={f.id} className="min-w-0">
                      <p className="text-xs text-muted-foreground">{f.label}</p>
                      <p className="text-sm font-medium break-words">
                        {f.type === 'form-assignment' ? <FormAssignmentText value={v} field={f} /> : isMultiFieldSelect(f) ? <RefOptionText value={v} field={f} rows={refSrcRows[f.key]} nameMap={userMap} smStateMap={smStates} /> : fmtDisplayValue(f, v)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* 分栏布局展示（详情弹窗） */}
              {fields.filter((f: FormField) => f.type === 'grid').map((f: FormField) => {
                const cols = f.layout?.columns ?? (f.gridColumns?.length || 2);
                const columns = f.gridColumns ?? [];
                const vals = gridValues[f.key] ?? [];
                return (
                  <div key={f.id} className="border-t border-border pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold">{f.label || '分栏布局'}</p>
                      <span className="text-xs text-muted-foreground">{cols} 栏</span>
                    </div>
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                      {Array.from({ length: cols }).map((_, i) => {
                        const col = columns[i];
                        const val = vals[i] ?? col?.defaultValue ?? '—';
                        return (
                          <div key={i} className="rounded-md border border-border/70 bg-muted/20 p-3 flex flex-col justify-between min-h-16">
                            <p className="text-xs font-medium text-muted-foreground">{col?.title || `第 ${i + 1} 栏`}</p>
                            <p className="text-base font-bold text-foreground mt-1 truncate">{val || '—'}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* 审计信息（创建人/时间、更新人/时间）默认折叠，点击展开 */}
              <AuditFieldsCollapsible row={viewing} fields={fields} sysCtx={sysCtx} />

              {/* 关联表单子列表展示 */}
              {fields.filter((f: FormField) => f.type === 'form-ref' && !f.relation?.hideInDetail).map((f: FormField) => {
                const ids = Array.isArray(viewing.payload?.[f.key]) ? (viewing.payload?.[f.key] as string[]) : [];
                const displayFields = (f.relation?.displayFields?.length ? f.relation.displayFields : ['title']).filter((k) => !isSplitLeaveRefKey(f, k));
                const allTarget = refRows[f.key] ?? [];
                return (
                  <div key={f.id} className="border-t border-border pt-4">
                    <p className="text-sm font-semibold mb-2">{f.label}（{ids.length}）</p>
                    {ids.length === 0 ? (
                      <p className="text-xs text-muted-foreground">暂无关联数据</p>
                    ) : (
                      <div className="rounded-md border border-border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr>{displayFields.map((k) => <th key={k} className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium text-muted-foreground">{refFieldLabel(f, k)}</th>)}</tr>
                          </thead>
                          <tbody>
                            {ids.map((id) => {
                              const r = allTarget.find((x) => x.id === id);
                              return (
                                <tr key={id} className="border-t border-border">
                                  {displayFields.map((k) => <td key={k} className="whitespace-nowrap px-2.5 py-1.5 text-foreground">{r ? refFieldValue(f, r, k) : <span className="text-muted-foreground/60">关联数据已失效</span>}</td>)}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 关联子表明细回显 */}
              {fields.filter((f: FormField) => f.type === 'sub-table').map((f: FormField) => {
                const v = viewing.payload?.[f.key];
                const n = isInlineRefValue(v) ? v.rows.length : Array.isArray(v) ? (v as string[]).length : 0;
                return (
                  <div key={f.id} className="border-t border-border pt-4">
                    <p className="text-sm font-semibold mb-2">{f.label}（{n}）</p>
                    {n === 0 ? <p className="text-xs text-muted-foreground">暂无明细</p> : <SubTableViewer field={f} value={v} />}
                  </div>
                );
              })}

                {/* 关联数据展示 */}
                {relations.filter((rel) => rel.source_form_id === formId).map((rel) => {
                  const linked = (viewing.payload?.[rel.backfill_field] as string[]) ?? [];
                  if (linked.length === 0) return null;
                  return (
                    <div key={rel.id} className="border-t border-border pt-4">
                      <p className="text-sm font-semibold mb-2">{rel.name}（{linked.length}）</p>
                      <div className="flex flex-wrap gap-1.5">
                        {linked.map((id) => <Badge key={id} className="bg-muted text-muted-foreground hover:bg-muted font-mono text-[10px]">{id.slice(0, 8)}…</Badge>)}
                      </div>
                    </div>
                  );
                })}

                {/* 角色池认领：无处理人且到达当前状态的转换配置了角色池时，对应角色成员可认领 */}
                {(() => {
                  const t = smTrans.find((x) => x.to === viewing.status && x.assignAction?.type === 'role_pool' && !!x.assignAction.value);
                  if (!t) return null;
                  if (viewing.assignee_id) return null;
                  const canClaim = isSuperadmin || myRoles.some((r) => r.id === t.assignAction?.value);
                  if (!canClaim) return null;
                  return <Button size="sm" variant="outline" onClick={claim}><UserPlus className="h-3.5 w-3.5 mr-1" />认领处理</Button>;
                })()}

                {/* 表单顶部自定义按钮（动作引擎） */}
                {formTopDefs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formTopDefs.map((a) => (
                      <ActBtn key={a.id} def={a} row={viewing} />
                    ))}
                  </div>
                )}

              {/* 审批流转（仅审批流程表单展示；非审批流程不显示「审批流转/无审批流程」区块） */}
              {form?.form_mode === 'approval' && (
              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-sm font-semibold">审批流转</p>
                {approvals.length === 0 && <p className="text-xs text-muted-foreground">无审批流程（直接生效）</p>}
                {approvals.map((a) => {
                  const can = canApprove(a);
                  const isFill = a.node_type === 'fill';
                  const canDoFill = canFill(a);
                  return (
                    <div key={a.id} className={`rounded-md border px-3.5 py-3 ${a.current && a.state === 'pending' ? 'border-primary/50 bg-primary/[0.03]' : 'border-border'}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground">{fmtDate(a.created_at, true)}</span>
                        <span className="text-sm font-medium">{a.node_name}</span>
                        <span className="sig-status" data-status={statusData(a.state)}>
                          {a.state === 'approved' ? (isFill ? '已填写' : '已通过') : a.state === 'rejected' ? '已驳回' : a.state === 'pending' ? (isFill ? '待填写' : '待审批') : '已跳过'}
                        </span>
                        {!isFill && <span className="text-xs text-muted-foreground">{a.mode === 'countersign' ? `会签·${a.acts.filter((x) => x.action === 'approve').length}/${a.approvers.length}` : a.mode === 'sequential' ? `依次·${a.acts.filter((x) => x.action === 'approve').length}/${a.approvers.length}` : '或签'}</span>}
                        {canDoFill && <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[10px] ml-auto">待我填写</Badge>}
                        {!isFill && can && <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-[10px] ml-auto">待我处理</Badge>}
                      </div>
                      {a.state === 'pending' && (
                        <p className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 shrink-0" />
                          {isFill ? '需要填写' : '需要审批'}：
                          {!isFill && a.mode === 'sequential' && currentTurnOf(a)
                            ? `当前轮到 ${apprNames([currentTurnOf(a)!])}（第 ${a.acts.filter((x) => x.action === 'approve').length + 1}/${a.approvers.length} 位）`
                            : apprNames(a.approvers)}
                        </p>
                      )}
                      {a.acts.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {a.acts.map((act, i) => (
                            <div key={i} className="text-xs text-muted-foreground">
                              <p>
                                <CheckCircle2 className="h-3 w-3 inline mr-1 text-primary" />
                                {act.user_name} · {act.action === 'approve' ? '同意' : act.action === 'fill' ? '已填写确认内容' : '驳回'} · {fmtDate(act.at, true)}{act.comment ? ` ·「${act.comment}」` : ''}
                              </p>
                              {act.changes && act.changes.length > 0 && (
                                <p className="ml-4 mt-0.5">修改了 {act.changes.map((c) => `${c.label}：${c.from} → ${c.to}`).join('；')}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {canDoFill && (
                        <Button size="sm" className="mt-3" onClick={() => openFill(a, viewing!)} disabled={filling}>
                          {filling && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          <PencilLine className="mr-1 h-3.5 w-3.5" />填写并确认
                        </Button>
                      )}
                      {can && !isFill && (
                        <div className="mt-3 space-y-2">
                          <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="sm" className="border border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => openApprove('reject', a)} disabled={acting}>驳回</Button>
                            <Button size="sm" onClick={() => openApprove('approve', a)} disabled={acting}>同意</Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground text-right">点击后可查看全部字段内容，通过时可修改「需确定内容」</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}

              {/* 系统操作日志（非审批表单详情页底部一律展示）：时间/操作人姓名/操作内容 */}
              {form?.form_mode !== 'approval' && (
                <div className="border-t border-border pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <p className="text-sm font-semibold">操作日志</p>
                    <span className="text-xs text-muted-foreground">系统自动记录该单据的全部操作轨迹</span>
                  </div>
                  {bizLogs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无操作记录</p>
                  ) : (
                    <div className="w-full max-w-full overflow-x-auto bg-card">
                      <table className="w-full min-w-max text-xs">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-6 font-medium whitespace-nowrap">时间</th>
                            <th className="py-2 pr-6 font-medium whitespace-nowrap">操作人</th>
                            <th className="py-2 pr-6 font-medium whitespace-nowrap">操作内容</th>
                            <th className="py-2 font-medium whitespace-nowrap">相关对象</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bizLogs.map((log) => (
                            <tr key={log.id} className="border-b border-border/60">
                              <td className="py-2 pr-6 whitespace-nowrap text-muted-foreground">{fmtDate(log.created_at, true)}</td>
                              <td className="py-2 pr-6 whitespace-nowrap font-medium">{log.user_name || '—'}</td>
                              <td className="py-2 pr-6 whitespace-nowrap">{log.action}</td>
                              <td className="py-2 whitespace-nowrap text-muted-foreground break-words">{log.target || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* 表单底部自定义按钮（动作引擎） */}
              {formBottomDefs.length > 0 && (
                <div className="border-t border-border pt-4 flex flex-wrap gap-2 justify-end">
                  {formBottomDefs.map((a) => (
                    <ActBtn key={a.id} def={a} row={viewing} size="default" />
                  ))}
                </div>
              )}
            </>
          </div>
        </div>
      )}
      {routeMode.mode === 'view' && (!viewing || !form) && (
        <div className="py-24 text-center text-sm text-muted-foreground">{routeRowMissing ? '未找到该单据，可能已被删除或您无权访问' : '正在加载单据…'}</div>
      )}

      {/* 填写节点确认弹窗：展示表单内容，确认字段可编辑 */}
      <Dialog open={!!fillAppr} onOpenChange={(v) => { if (!v) { setFillAppr(null); void loadRows(); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          {fillAppr && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <PencilLine className="h-4 w-4 text-accent" />{fillAppr.appr.node_name}
                </DialogTitle>
              </DialogHeader>

              {/* 详情样式展示全部字段内容（只读，空值隐藏） */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {fields.filter((f: FormField) => f.type !== 'form-ref' && f.type !== 'query' && f.type !== 'sub-table' && !AUDIT_FIELD_KEYS.includes(f.key as AuditKey) && !leaveHiddenKeys.has(f.key) && !(fillAppr.appr.confirm_fields ?? []).includes(f.key)).map((f: FormField) => {
                  let v: unknown = fillAppr.row.payload?.[f.key];
                  if (isAuditSystemField(f)) {
                    v = systemFieldValue(f.key, fillAppr.row, sysCtx);
                    if ((f.key === 'created_at' || f.key === 'updated_at') && v) v = fmtDate(String(v), true);
                  }
                  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
                  return (
                    <div key={f.id} className="min-w-0">
                      <p className="text-xs text-muted-foreground">{f.label}</p>
                      <p className="text-sm font-medium break-words">
                        {f.type === 'form-assignment' ? <FormAssignmentText value={v} field={f} /> : isMultiFieldSelect(f) ? <RefOptionText value={v} field={f} rows={refSrcRows[f.key]} nameMap={userMap} smStateMap={smStates} /> : fmtDisplayValue(f, v)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* 详情中非确认字段的复合字段只读展示 */}
              {fields.filter((f: FormField) => (f.type === 'form-ref' || f.type === 'sub-table') && !(fillAppr.appr.confirm_fields ?? []).includes(f.key)).map((f: FormField) => {
                const v = fillAppr.row.payload?.[f.key];
                if (f.type === 'sub-table') {
                  return (
                    <div key={f.id} className="border-t border-border pt-3 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground">{f.label}（关联子表明细）</p>
                      <SubTableViewer field={f} value={v} />
                    </div>
                  );
                }
                return (
                  <div key={f.id} className="border-t border-border pt-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">{f.label}（关联表单）</p>
                    <FormRefViewer field={f} value={v} />
                  </div>
                );
              })}

              <AuditFieldsCollapsible row={fillAppr.row} fields={fields} sysCtx={sysCtx} />

              {/* 需确定内容：流程设计中选定的确认字段，按节点字段权限区分只读/可编辑展示 */}
              {(() => {
                const confirmKeys = fillAppr.appr.confirm_fields ?? [];
                const perms = fillAppr.appr.field_perms ?? {};
                const cFields = fields.filter((f: FormField) => f.type !== 'query' && confirmKeys.includes(f.key) && !leaveHiddenKeys.has(f.key));
                if (cFields.length === 0) return null;
                return (
                  <div className="border-t border-border pt-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">需确定内容</p>
                      <p className="text-xs text-muted-foreground">以下内容可修改，修改后将记录在审批流转中</p>
                    </div>
                    <div className="grid gap-x-6 gap-y-4" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                      {cFields.map((f: FormField) => {
                        const isEditable = perms[f.key] === 'editable';
                        if (f.type === 'sub-table') {
                          return (
                            <div key={f.id} style={{ gridColumn: 'span 24 / span 24' }} className="min-w-0 space-y-1.5 border rounded-md p-3 bg-muted/20">
                              <Label className="text-sm font-semibold">{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                              {isEditable ? (
                                <SubTableEditor
                                  field={f}
                                  value={fillDraft[f.key]}
                                  onChange={(v) => setFillDraft((d) => ({ ...d, [f.key]: v }))}
                                  onMainRecalced={(patch) => {
                                    setFillDraft((d) => ({ ...d, ...patch }));
                                    setRows((rs) => rs.map((r) => (r.id === fillAppr.row.id ? { ...r, payload: { ...(r.payload ?? {}), ...patch } } : r)));
                                    if (viewing?.id === fillAppr.row.id) {
                                      setViewing((v) => v ? { ...v, payload: { ...(v.payload ?? {}), ...patch } } : v);
                                    }
                                  }}
                                  scopeCtx={scopeCtx}
                                  mainBizId={fillAppr.row.id}
                                />
                              ) : (
                                <SubTableViewer field={f} value={fillDraft[f.key]} />
                              )}
                            </div>
                          );
                        }
                        if (f.type === 'form-ref') {
                          return (
                            <div key={f.id} style={{ gridColumn: 'span 24 / span 24' }} className="min-w-0 space-y-1.5 border rounded-md p-3 bg-muted/20">
                              <Label className="text-sm font-semibold">{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                              {isEditable ? (
                                <FormRefEditor field={f} value={fillDraft[f.key]} onChange={(v) => setFillDraft((d) => ({ ...d, [f.key]: v }))} />
                              ) : (
                                <FormRefViewer field={f} value={fillDraft[f.key]} />
                              )}
                            </div>
                          );
                        }
                        const span = f.span ?? 12;
                        return (
                          <div key={f.id} style={{ gridColumn: `span ${span} / span ${span}` }} className="min-w-0 space-y-1.5">
                            <Label className="text-sm text-muted-foreground">{f.label}</Label>
                            {isEditable ? (
                              <FieldControl
                                field={f}
                                value={fillDraft[f.key]}
                                onChange={(v) => {
                                  // 修改开始/结束时间：反向联动重算时长并即时自动保存
                                  const res = syncLeaveByTimeField(fields, fillDraft, f.key, v);
                                  setFillDraft(res ? res.draft : { ...fillDraft, [f.key]: v });
                                  if (res) void autoSaveLeavePatch(res.patch);
                                }}
                                onChangeExtra={(key, v) => setFillDraft((d) => ({ ...d, [key]: v }))}
                                currentFormId={form?.id}
                                departments={departments}
                                refOptions={refOptions}
                                refSrcRows={refSrcRows}
                                members={members}
                                queryRows={queryRows}
                                queryMeta={queryMeta}
                                sysValue={sysVal}
                                queryFilterVals={queryFilterVals}
                                onQueryFilterChange={(k, v) => setQueryFilterVals((p) => ({ ...p, [k]: v }))}
                                calcVals={calcFor(fillDraft)}
                                scopeCtx={scopeCtx}
                              />
                            ) : (
                              <p className="text-sm font-medium break-words">{fmtDisplayValue(f, fillDraft[f.key] ?? calcFor(fillDraft)[f.key]) || '—'}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <DialogFooter>
                <Button variant="outline" onClick={() => { setFillAppr(null); void loadRows(); }}>取消</Button>
                <Button onClick={submitFill} disabled={filling}>{filling && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}确定</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 审批操作弹窗：先查看全部字段内容，只读与可编辑以填充色区分；通过时可修改可编辑字段 */}
      <Dialog open={!!approveDialog} onOpenChange={(v) => { if (!v) { setApproveDialog(null); setComment(''); void loadRows(); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          {approveDialog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {approveDialog.action === 'approve'
                    ? <CheckCircle2 className="h-4 w-4 text-primary" />
                    : <X className="h-4 w-4 text-destructive" />}
                  {approveDialog.action === 'approve' ? '审批通过' : '审批驳回'} · {approveDialog.appr.node_name}
                </DialogTitle>
              </DialogHeader>

              {/* 详情样式展示全部字段内容（只读，空值隐藏） */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {fields.filter((f: FormField) => f.type !== 'form-ref' && f.type !== 'query' && f.type !== 'sub-table' && !AUDIT_FIELD_KEYS.includes(f.key as AuditKey) && !leaveHiddenKeys.has(f.key)).map((f: FormField) => {
                  let v: unknown = approveDialog.row.payload?.[f.key];
                  if (isAuditSystemField(f)) {
                    v = systemFieldValue(f.key, approveDialog.row, sysCtx);
                    if ((f.key === 'created_at' || f.key === 'updated_at') && v) v = fmtDate(String(v), true);
                  }
                  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
                  return (
                    <div key={f.id} className="min-w-0">
                      <p className="text-xs text-muted-foreground">{f.label}</p>
                      <p className="text-sm font-medium break-words">
                        {f.type === 'form-assignment' ? <FormAssignmentText value={v} field={f} /> : isMultiFieldSelect(f) ? <RefOptionText value={v} field={f} rows={refSrcRows[f.key]} nameMap={userMap} smStateMap={smStates} /> : fmtDisplayValue(f, v)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* 审批弹窗详情中复合字段只读展示（非当前节点可编辑字段时） */}
              {fields.filter((f: FormField) => {
                const perms = wfNodePerms.get(approveDialog.appr.node_id ?? '') ?? {};
                const isEditable = perms[f.key] === 'editable';
                return (f.type === 'form-ref' || f.type === 'sub-table') && !isEditable;
              }).map((f: FormField) => {
                const v = approveDialog.row.payload?.[f.key];
                if (f.type === 'sub-table') {
                  return (
                    <div key={f.id} className="border-t border-border pt-3 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground">{f.label}（关联子表明细）</p>
                      <SubTableViewer field={f} value={v} />
                    </div>
                  );
                }
                return (
                  <div key={f.id} className="border-t border-border pt-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">{f.label}（关联表单）</p>
                    <FormRefViewer field={f} value={v} />
                  </div>
                );
              })}

              <AuditFieldsCollapsible row={approveDialog.row} fields={fields} sysCtx={sysCtx} />

              {/* 需确定内容：流程设计中可编辑的字段，通过时可修改，修改内容将记录在审批流转中 */}
              {approveDialog.action === 'approve' && (() => {
                const perms = wfNodePerms.get(approveDialog.appr.node_id ?? '') ?? {};
                const editableFields = fields.filter((f: FormField) => f.type !== 'query' && perms[f.key] === 'editable' && !leaveHiddenKeys.has(f.key));
                if (editableFields.length === 0) return null;
                return (
                  <div className="border-t border-border pt-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">需确定内容</p>
                      <p className="text-xs text-muted-foreground">以下内容可在通过时修改，修改后将记录在审批流转中</p>
                    </div>
                    <div className="grid gap-x-4 gap-y-4" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                      {editableFields.map((f: FormField) => {
                        if (f.type === 'sub-table') {
                          return (
                            <div key={f.id} style={{ gridColumn: 'span 24 / span 24' }} className="min-w-0 space-y-1.5 rounded-md border border-accent/40 bg-accent/[0.04] p-2.5">
                              <Label className="text-sm flex items-center gap-1.5 font-semibold">
                                {f.label}
                                <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[9px] shrink-0">可编辑</Badge>
                              </Label>
                              <SubTableEditor
                                field={f}
                                value={apprDraft[f.key]}
                                onChange={(v) => setApprDraft((d) => ({ ...d, [f.key]: v }))}
                                onMainRecalced={(patch) => {
                                  setApprDraft((d) => ({ ...d, ...patch }));
                                  setRows((rs) => rs.map((r) => (r.id === approveDialog.row.id ? { ...r, payload: { ...(r.payload ?? {}), ...patch } } : r)));
                                }}
                                scopeCtx={scopeCtx}
                                mainBizId={approveDialog.row.id}
                              />
                            </div>
                          );
                        }
                        if (f.type === 'form-ref') {
                          return (
                            <div key={f.id} style={{ gridColumn: 'span 24 / span 24' }} className="min-w-0 space-y-1.5 rounded-md border border-accent/40 bg-accent/[0.04] p-2.5">
                              <Label className="text-sm flex items-center gap-1.5 font-semibold">
                                {f.label}
                                <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[9px] shrink-0">可编辑</Badge>
                              </Label>
                              <FormRefEditor field={f} value={apprDraft[f.key]} onChange={(v) => setApprDraft((d) => ({ ...d, [f.key]: v }))} />
                            </div>
                          );
                        }
                        const span = f.span ?? 12;
                        return (
                          <div key={f.id} style={{ gridColumn: `span ${span} / span ${span}` }} className="min-w-0 space-y-1.5 rounded-md border border-accent/40 bg-accent/[0.04] p-2.5">
                            <Label className="text-sm flex items-center gap-1.5">
                              {f.label}
                              <Badge className="bg-accent/10 text-accent hover:bg-accent/10 text-[9px] shrink-0">可编辑</Badge>
                            </Label>
                            <FieldControl
                              field={f}
                              value={apprDraft[f.key]}
                              onChange={(v) => {
                                // 修改开始/结束时间：反向联动重算请假时长（通过时随可编辑字段一并提交）
                                const res = syncLeaveByTimeField(fields, apprDraft, f.key, v);
                                setApprDraft(res ? res.draft : { ...apprDraft, [f.key]: v });
                              }}
                              onChangeExtra={(key, v) => setApprDraft((d) => ({ ...d, [key]: v }))}
                              currentFormId={form?.id}
                              departments={departments}
                              refOptions={refOptions}
                              refSrcRows={refSrcRows}
                              members={members}
                              queryRows={queryRows}
                              queryMeta={queryMeta}
                              sysValue={sysVal}
                              queryFilterVals={queryFilterVals}
                              onQueryFilterChange={(k, v) => setQueryFilterVals((p) => ({ ...p, [k]: v }))}
                              calcVals={calcFor(apprDraft)}
                              scopeCtx={scopeCtx}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <Label className="text-xs">审批意见{approveDialog.action === 'reject' ? '（必填）' : '（可选）'}</Label>
                <Textarea placeholder={approveDialog.action === 'reject' ? '驳回时必须填写理由' : '选填，将通知发起人'} value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setApproveDialog(null); setComment(''); void loadRows(); }}>取消</Button>
                <Button
                  variant={approveDialog.action === 'approve' ? 'default' : 'ghost'}
                  className={approveDialog.action === 'reject' ? 'border border-destructive/50 text-destructive hover:bg-destructive/10' : undefined}
                  onClick={() => void act(approveDialog.action)}
                  disabled={acting}
                >
                  {acting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {approveDialog.action === 'approve' ? '确认通过' : '确认驳回'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 二次确认（动作引擎桥接） */}
      <AlertDialog open={!!confirmState} onOpenChange={(v) => { if (!v) { confirmState?.resolve(false); setConfirmState(null); } }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>操作确认</AlertDialogTitle>
            <AlertDialogDescription>{confirmState?.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { confirmState?.resolve(false); setConfirmState(null); }}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmState?.resolve(true); setConfirmState(null); }}>确认执行</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 关联选择/查看弹窗（动作引擎关联表动作） */}
      <Dialog open={!!relatedDlg} onOpenChange={(v) => !v && setRelatedDlg(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          {relatedDlg && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {relatedDlg.mode === 'select' ? '选择关联' : relatedDlg.mode === 'unlink' ? '解除关联' : '查看关联'} · {relatedDlg.relation.name}
                  <Badge className="bg-muted text-muted-foreground hover:bg-muted shrink-0">{relatedDlg.relation.multiple ? '多选' : '单选'}</Badge>
                </DialogTitle>
              </DialogHeader>
              {relatedLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : relatedRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{relatedDlg.mode === 'select' ? '目标表单暂无数据，可先去目标表单新建' : '暂无关联数据'}</p>
              ) : (
                <div className="border border-border rounded-[5px] divide-y divide-border max-h-80 overflow-y-auto">
                  {relatedRows.map((r) => {
                    const checked = relatedDlg.mode === 'select' && relatedSel.includes(r.id);
                    const linked = ((relatedDlg.row.payload?.[relatedDlg.relation.backfill_field] as string[]) ?? []).includes(r.id);
                    return (
                      <label key={r.id} className="flex items-center gap-3 px-3.5 py-3 hover:bg-muted/50">
                        {relatedDlg.mode === 'select' && (
                          <Checkbox checked={checked} onCheckedChange={(v) => setRelatedSel((s) => (relatedDlg.relation.multiple ? (v ? [...s, r.id] : s.filter((x) => x !== r.id)) : v ? [r.id] : []))} />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{r.title || r.id.slice(0, 8)}</p>
                          <p className="text-xs text-muted-foreground truncate">{relatedDlg.relation.display_fields.map((k) => String(k === 'created_at' ? fmtDate(r.created_at, true) : k === 'updated_at' ? fmtDate(r.updated_at, true) : k === 'created_by' ? (userMap.get(r.created_by) ?? r.created_by) : k === 'updated_by' ? (r.updated_by ? (userMap.get(r.updated_by) ?? r.updated_by) : '—') : (r.payload?.[k] ?? '—'))).join(' · ')}</p>
                        </div>
                        {linked && <Badge className="bg-primary/10 text-primary hover:bg-primary/10 shrink-0">已关联</Badge>}
                        <span className="sig-status shrink-0" style={statusBadgeStyle(r.status)} data-status={statusData(r.status)}>{statusText(r.status)}</span>
                        {relatedDlg.mode === 'unlink' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shrink-0 border border-destructive/50 text-destructive hover:bg-destructive/10"
                            onClick={(e) => { e.preventDefault(); void removeRelated(r.id); }}
                          >
                            解除
                          </Button>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
              {relatedDlg.mode === 'select' && (
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRelatedDlg(null)}>取消</Button>
                  <Button onClick={saveRelated} disabled={relatedSel.length === 0}>关联所选（{relatedSel.length}）</Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 关联表单选择弹窗：复用目标表单原列表列与筛选项 */}
      {/* 按钮关联表单赋值弹窗：选择目标表单数据后按映射写入当前表单字段 */}
      {refAssignField?.button?.refAssign?.formId && (
        <RefAssignDialog
          open
          onClose={() => setRefAssignField(null)}
          refAssign={refAssignField.button.refAssign}
          onPick={(payload) => {
            const maps = refAssignField.button!.refAssign!.mappings ?? [];
            const patch: Record<string, unknown> = {};
            for (const m of maps) {
              if (!m.fromKey || !m.toKey) continue;
              const v = payload[m.fromKey];
              if (v !== undefined && v !== null) patch[m.toKey] = v;
            }
            if (Object.keys(patch).length === 0) return toast.error('所选数据无映射字段值可赋值');
            setDraft((d) => ({ ...d, ...patch }));
            toast.success(`已按映射赋值 ${Object.keys(patch).length} 个字段`);
          }}
        />
      )}
      <Dialog open={!!refPicker} onOpenChange={(v) => { if (!v) { setRefPicker(null); setRefPickerSearch({}); setRefPickerManual({}); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          {refPicker && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">选择关联数据 · {refPicker.field.label}</DialogTitle>
              </DialogHeader>
              {(() => {
                const f = refPicker.field;
                const targetMeta = refFormMeta[f.key];
                const targetFields = ensureSystemFields((targetMeta?.schema_json?.fields ?? []).filter((x: FormField) => !LAYOUT_TYPES.includes(x.type) && x.type !== 'action-button'));
                const targetFieldByKey = new Map(targetFields.map((x: FormField) => [x.key, x]));
                const targetSearch = targetMeta?.list_config?.search ?? [];
                const manualFilters = f.relation?.manualFilters ?? [];
                const targetCols = (targetMeta?.list_config?.columns ?? []).length > 0
                  ? targetMeta!.list_config!.columns!
                  : targetFields.slice(0, 5).map((x: FormField) => ({ key: x.key, label: x.label, align: 'left' as const, format: 'none' as const }));
                const fmtRefCell = (r: BizData, key: string, format?: string) => {
                  let v = r.payload?.[key];
                  const targetSm = refSmStates[f.key] || (f.relation?.formId ? refSmStates[f.relation.formId] : null);
                  // 状态字段：始终从目标表单状态机（优先）或全局状态机解析出状态名称（标签）
                  if (key === 'status') {
                    const stVal = String(r.status || (r.payload?.status as string) || '');
                    if (!stVal) return '—';
                    return targetSm?.get(stVal)?.label ?? smStates.get(stVal)?.label ?? (stVal === 'draft' ? '草稿' : stVal === 'pending' ? '审批中' : stVal === 'approved' ? '已批准' : stVal === 'rejected' ? '已驳回' : stVal);
                  }
                  // 审计系统字段键（员工姓名/所属部门/职位等）payload 无值时从行数据+档案派生（目标表单自建字段与系统字段一致处理）
                  if ((v === undefined || v === null || v === '') && SYSTEM_FIELD_KEYS.includes(key as (typeof SYSTEM_FIELD_KEYS)[number])) {
                    if (key === 'created_by') v = userMap.get(r.created_by ?? '') ?? r.created_by;
                    else if (key === 'updated_by') v = r.updated_by ? (userMap.get(r.updated_by) ?? r.updated_by) : undefined;
                    else if (key === 'created_at') v = r.created_at;
                    else if (key === 'updated_at') v = r.updated_at;
                    else v = sysVal(key, r);
                  }
                  // 数据源下拉字段（optionSource）：选项值为目标记录 id，按显示字段配置解析文本（与主表列表一致）
                  const tf0 = targetFieldByKey.get(key);
                  if (tf0 && (tf0.type === 'select' || tf0.type === 'multi-select' || tf0.type === 'search-select' || tf0.type === 'search-multi-select') && tf0.optionSource?.formId && optionDisplayKeys(tf0).length > 0) {
                    if (v === undefined || v === null || v === '') return '—';
                    const srcRows = refPickerSrcRows[tf0.optionSource.formId] ?? [];
                    const sep = tf0.optionSource.separator ?? '-';
                    const keys = optionDisplayKeys(tf0);
                    const resolve = (id: string): string => {
                      const rec = srcRows.find((row) => row.id === id);
                      if (!rec) return id;
                      const joined = keys.map((k) => formatOptionFieldValue(k, rec, userMap, targetSm ?? smStates)).filter(Boolean).join(sep);
                      return joined || id;
                    };
                    if (Array.isArray(v)) return v.map((x) => resolve(String(x))).join('、') || '—';
                    return resolve(String(v));
                  }
                  if (v === undefined || v === null || v === '') return '—';
                  if ((key === 'created_at' || key === 'updated_at') && typeof v === 'string') return fmtDate(v, true);
                  if (format === 'money' && typeof v === 'number') return fmtMoney(v);
                  if (format === 'date') return fmtDate(String(v));
                  if (format === 'datetime') return fmtDate(String(v), true);
                  if (format === 'percent' && typeof v === 'number') return `${v}%`;
                  if (Array.isArray(v)) return v.join('、');
                  const tf = targetFieldByKey.get(key);
                  if (tf?.type === 'dept-select') return departments.find((d) => d.id === String(v))?.name ?? '—';
                  if (tf?.type === 'leave-time') {
                    const lv = v as LeaveTimeValue;
                    return lv.days !== undefined || lv.hours !== undefined ? `${lv.days ?? 0} 天 / ${lv.hours ?? 0} 小时` : '—';
                  }
                  return String(v);
                };
                const allTarget = applyManualFilters(
                  (refRows[f.key] ?? []) as unknown as Record<string, unknown>[],
                  refPickerManual,
                  manualFilters,
                  f.relation?.manualFiltersLogic ?? 'and',
                ) as unknown as BizData[];
                const cur = Array.isArray(draft[f.key]) ? (draft[f.key] as string[]) : [];
                const filtered = allTarget.filter((r) => {
                  return Object.entries(refPickerSearch).every(([k, sv]) => {
                    if (!sv) return true;
                    const cell = fmtRefCell(r, k);
                    const sc = targetSearch.find((x) => x.key === k);
                    // 日期范围：按日期前缀比较（fmtDate 输出 YYYY-MM-DD）
                    if (sc?.control === 'date-range' && sv.includes('~')) {
                      const [f, t] = sv.split('~').map((x) => x.trim());
                      const day = String(cell).slice(0, 10);
                      return (!f || day >= f) && (!t || day <= t);
                    }
                    return String(cell).toLowerCase().includes(sv.toLowerCase());
                  });
                });
                return (
                  <>
                    {manualFilters.length > 0 && (
                      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-2 bg-muted/30">
                        {manualFilters.map((mf) => (
                          <div key={mf.id} className="space-y-1 min-w-40">
                            <Label className="text-xs text-muted-foreground">{mf.label || (targetFieldByKey.get(mf.fieldKey)?.label ?? mf.fieldKey)}</Label>
                            {mf.control === 'select' ? (
                              <Select value={refPickerManual[mf.fieldKey] ?? 'all'} onValueChange={(v) => setRefPickerManual((x) => ({ ...x, [mf.fieldKey]: v === 'all' ? '' : v }))}>
                                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">全部</SelectItem>
                                  {(mf.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : mf.control === 'date-range' ? (
                              <DateRangeFilter value={refPickerManual[mf.fieldKey] ?? ''} onChange={(v) => setRefPickerManual((x) => ({ ...x, [mf.fieldKey]: v }))} />
                            ) : (
                              <Input className="w-40 h-9 px-2" placeholder="筛选" value={refPickerManual[mf.fieldKey] ?? ''} onChange={(e) => setRefPickerManual((x) => ({ ...x, [mf.fieldKey]: e.target.value }))} />
                            )}
                          </div>
                        ))}
                        {Object.values(refPickerManual).some(Boolean) && (
                          <Button variant="ghost" size="sm" className="h-9" onClick={() => setRefPickerManual({})}><X className="mr-1 h-3.5 w-3.5" />清空</Button>
                        )}
                      </div>
                    )}
                    {targetSearch.length > 0 && (
                      <div className="flex flex-wrap items-end gap-3">
                        {targetSearch.map((s) => (
                          <div key={s.key} className="space-y-1 min-w-40">
                            <Label className="text-xs text-muted-foreground">{s.label}</Label>
                            {s.control === 'select' ? (
                              <Select value={refPickerSearch[s.key] ?? 'all'} onValueChange={(v) => setRefPickerSearch((x) => ({ ...x, [s.key]: v === 'all' ? '' : v }))}>
                                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">全部</SelectItem>
                                  {(s.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : s.control === 'date-range' ? (
                              <DateRangeFilter value={refPickerSearch[s.key] ?? ''} onChange={(v) => setRefPickerSearch((x) => ({ ...x, [s.key]: v }))} />
                            ) : (
                              <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input className="pl-8 w-44 h-9" placeholder={`搜索${s.label}`} value={refPickerSearch[s.key] ?? ''} onChange={(e) => setRefPickerSearch((x) => ({ ...x, [s.key]: e.target.value }))} />
                              </div>
                            )}
                          </div>
                        ))}
                        {Object.values(refPickerSearch).some(Boolean) && (
                          <Button variant="ghost" size="sm" className="h-9" onClick={() => setRefPickerSearch({})}><X className="mr-1 h-3.5 w-3.5" />清空</Button>
                        )}
                      </div>
                    )}
                    {allTarget.length === 0 ? (
                      <p className="py-10 text-center text-sm text-muted-foreground">目标表单暂无数据，可先去目标表单新建</p>
                    ) : filtered.length === 0 ? (
                      <p className="py-10 text-center text-sm text-muted-foreground">没有符合筛选条件的数据</p>
                    ) : (
                      <div className="border border-border rounded-[5px] overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full min-w-max text-xs">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr>
                              <th className="w-10 px-2 py-2" />
                              {targetCols.map((c) => (
                                <th key={c.key} className={cn('px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>{c.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {filtered.map((r) => {
                              const checked = refPickerSel.includes(r.id);
                              const already = cur.includes(r.id);
                              return (
                                <tr key={r.id} className={cn(already ? 'opacity-50' : 'hover:bg-muted/50')}>
                                  <td className="px-2 py-2">
                                    <Checkbox checked={checked} disabled={already} onCheckedChange={(v) => setRefPickerSel((s) => (v ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
                                  </td>
                                  {targetCols.map((c) => (
                                    <td key={c.key} className={cn('px-3 py-2 text-foreground whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>{fmtRefCell(r, c.key, c.format)}</td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => { setRefPicker(null); setRefPickerSearch({}); setRefPickerManual({}); }}>取消</Button>
                      <Button onClick={() => { setDraft((d) => ({ ...d, [f.key]: refPickerSel })); setRefPicker(null); setRefPickerSearch({}); setRefPickerManual({}); }} disabled={refPickerSel.length === 0}>添加所选（{refPickerSel.length}）</Button>
                    </DialogFooter>
                  </>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 状态机流转交互弹窗：人员分配（部门/角色→模糊搜索多选）/内容提交/内容确定 */}
      <SmTransDialog
        open={!!smDlg}
        transition={smDlg?.transition ?? null}
        row={smDlg?.row ?? null}
        successText={smDlg?.def.success_text}
        onClose={() => setSmDlg(null)}
        onDone={() => {
          // 状态机流转完成：普通（非审批）表单写入操作日志，详情页操作日志按时间完整展示
          if (form?.form_mode !== 'approval' && smDlg?.row) {
            const tr = smDlg.transition;
            writeBizLog(smDlg.row.id, `状态机流转：${tr.event ?? ''}（${tr.from ?? ''} → ${tr.to ?? ''}）`, smDlg.row.title);
          }
          void loadRows();
        }}
      />

      {/* 转移给他人/分配弹窗：选择接收人，确认后移交单据（写 assignee + 操作日志） */}
      <Dialog open={!!transferDlg} onOpenChange={(v) => !v && setTransferDlg(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              {transferDlg?.def.action_type === 'TRANSFER_OWNER' ? '转移给他人' : '分配负责人'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              将「{transferDlg?.row.title || transferDlg?.row.id.slice(0, 8)}」移交给所选人员处理
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">接收人 *</Label>
              <Select value={transferUserId || 'none'} onValueChange={(v) => setTransferUserId(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="选择接收人员" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未选择</SelectItem>
                  {members.filter((m) => m.id !== profile?.id).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}{m.position ? ` · ${m.position}` : ''}</SelectItem>
                  ))}
                  {members.filter((m) => m.id !== profile?.id).length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无可选人员</p>}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {transferDlg?.def.action_type === 'TRANSFER_OWNER' ? '转移后单据由接收人继续处理，原处理人不再持有' : '分配后单据指派给所选人员作为负责人'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDlg(null)} disabled={transferBusy}>取消</Button>
            <Button disabled={transferBusy || !transferUserId} onClick={() => void (async () => {
              if (!transferDlg || !transferUserId) return;
              setTransferBusy(true);
              const recv = members.find((m) => m.id === transferUserId);
              const { error } = await supabase.from('biz_data').update({
                assignee_id: transferUserId,
                assignee_name: recv?.name ?? null,
                updated_at: new Date().toISOString(),
              }).eq('id', transferDlg.row.id);
              setTransferBusy(false);
              if (error) return toast.error('移交失败：' + error.message);
              if (form?.form_mode !== 'approval') writeBizLog(transferDlg.row.id, `${transferDlg.def.action_type === 'TRANSFER_OWNER' ? '转移给他人' : '分配'}：${recv?.name ?? transferUserId}（单据操作权限已转移给该人员）`, transferDlg.row.title);
              toast.success(transferDlg.def.success_text ?? `已移交${recv?.name ? `给 ${recv.name}` : ''}`);
              setTransferDlg(null);
              void loadRows();
              // 详情弹窗内触发时同步刷新当前查看数据
              setViewing((v) => (v && v.id === transferDlg.row.id ? { ...v, assignee_id: transferUserId, assignee_name: recv?.name ?? null } : v));
            })()}>
              {transferBusy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              确认移交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新增备注弹窗（REMARK 动作）：填写备注内容后写入操作日志 */}
      <Dialog open={!!remarkDlg} onOpenChange={(v) => !v && setRemarkDlg(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              新增备注
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">为「{remarkDlg?.row.title || remarkDlg?.row.id.slice(0, 8)}」填写备注，保存后计入操作日志</p>
            <Textarea
              autoFocus
              placeholder="请输入备注内容…"
              className="min-h-[100px] text-sm"
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemarkDlg(null)}>取消</Button>
            <Button
              disabled={!remarkText.trim()}
              onClick={async () => {
                if (!remarkDlg || !remarkText.trim()) return;
                // 等待插入完成再提示成功，避免用户立即打开详情页看不到日志
                const { error } = await supabase.from('audit_logs').insert({
                  tenant_id: profile?.tenant_id ?? '',
                  user_id: profile?.id ?? '',
                  user_name: profile?.name ?? '',
                  action: `新增备注：${remarkText.trim()}`,
                  target: remarkDlg.row.title || form?.name || remarkDlg.row.id,
                  detail: { biz_id: remarkDlg.row.id },
                });
                if (error) return toast.error('备注保存失败：' + error.message);
                toast.success(remarkDlg.def.success_text ?? '备注已保存');
                setRemarkDlg(null);
                setRemarkText('');
                // 详情页打开时刷新日志展示
                if (viewing?.id === remarkDlg.row.id) void loadBizLogs(remarkDlg.row.id);
              }}
            >
              保存备注
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 字段旁自定义按钮执行（FormDesigner 的 action-button 字段 → 动作引擎） */
function useFieldButtonRunner() {
  // 交由 BizApp 内部实现，此处仅占位避免 lint 未使用告警
}

/** 审计信息折叠区：创建人/创建时间/更新人/更新时间默认折叠，点击展开 */
function AuditFieldsCollapsible({ row, fields, sysCtx }: { row: BizData; fields: FormField[]; sysCtx: { profileMap: Map<string, { name: string; position?: string | null; department_id?: string | null }>; deptMap: Map<string, string> } }) {
  const [open, setOpen] = useState(false);
  const auditFields = fields.filter((f) => AUDIT_FIELD_KEYS.includes(f.key as AuditKey));
  if (auditFields.length === 0) return null;
  return (
    <div className="border-t border-border pt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        审计信息
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3">
          {auditFields.map((f) => {
            let v: unknown = row.payload?.[f.key];
            if (f.system) {
              v = systemFieldValue(f.key, row, sysCtx);
              if ((f.key === 'created_at' || f.key === 'updated_at') && v) v = fmtDate(String(v), true);
            }
            const display = v === undefined || v === null || v === '' ? '—' : String(v);
            return (
              <div key={f.id} className="min-w-0">
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <p className="text-sm font-medium break-words">{display}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}