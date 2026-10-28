import { Loader2, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/db/supabase';
import { ensureSystemFields, fmtDate, systemFieldValue } from '@/lib/field-catalog';
import { cn } from '@/lib/utils';
import type { BizData, FormField, MetaForm } from '@/types';
import { fetchInlineRows, inlineRefIds, isInlineRefValue, optCellText, useOptionSrcRows } from './SubTableEditor';

/** 内嵌行快照 → BizData 形状（渲染逻辑与独立记录一致） */
const inlineToRows = (inline: { rows: Array<{ id?: string; payload: Record<string, unknown>; sys?: Record<string, unknown> }> }, formId = ''): BizData[] =>
  inline.rows.map((r, i) => ({
    id: r.id ?? `inline_${i}`,
    form_id: formId,
    payload: r.payload ?? {},
    status: (r.sys?.status as string) ?? 'approved',
    created_by: (r.sys?.created_by as string) ?? null,
    created_at: (r.sys?.created_at as string) ?? null,
    updated_by: (r.sys?.updated_by as string) ?? null,
    updated_at: (r.sys?.updated_at as string) ?? null,
  } as BizData));

/** 关联表单系统字段派生上下文：全员档案/部门映射 + 目标表单状态机状态（员工姓名/所属部门/状态解析用） */
interface RefSysCtx {
  profileMap: Map<string, { name: string; position?: string; department_id?: string | null }>;
  nameMap: Map<string, string>;
  deptMap: Map<string, string>;
  smStates: Map<string, { label: string }>;
}

/** 拉取关联表单展示上下文：全员档案与部门（系统字段姓名/部门派生）、目标表单状态机（状态名称解析） */
function useRefSysCtx(targetFormId?: string): RefSysCtx {
  const [ctx, setCtx] = useState<RefSysCtx>({ profileMap: new Map(), nameMap: new Map(), deptMap: new Map(), smStates: new Map() });
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [profRes, deptRes, smRes] = await Promise.all([
        supabase.from('profiles').select('id, name, position, department_id'),
        supabase.from('departments').select('id, name'),
        targetFormId
          ? supabase.from('meta_state_machine').select('states').eq('form_id', targetFormId).maybeSingle()
          : Promise.resolve({ data: null as { states?: { key: string; label: string }[] } | null }),
      ]);
      if (!alive) return;
      const profList = ((profRes.data ?? []) as { id: string; name: string; position?: string; department_id?: string | null }[]);
      setCtx({
        profileMap: new Map(profList.map((p) => [p.id, p])),
        nameMap: new Map(profList.map((p) => [p.id, p.name])),
        deptMap: new Map(((deptRes.data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name])),
        smStates: new Map(((smRes.data?.states ?? []) as { key: string; label: string }[]).map((s) => [s.key, { label: s.label }])),
      });
    })();
    return () => { alive = false; };
  }, [targetFormId]);
  return ctx;
}

/** 审计系统字段键（payload 不存值，运行时从行数据派生；用户自建同名普通字段同样适用兜底） */
const REF_SYS_KEYS = ['user_name', 'dept_name', 'position', 'created_by', 'updated_by', 'created_at', 'updated_at', 'status'] as const;

/** 关联表单单元格文本：状态列由目标状态机解析；审计系统字段键（员工姓名/所属部门等）payload 无值时从行数据+档案派生；数据源下拉列 id → 显示文本；其余普通格式化 */
const refCellText = (r: BizData, k: string, schemaFields: FormField[], sysCtx: RefSysCtx, optSrcRows: Map<string, BizData[]>): string => {
  const f = schemaFields.find((x) => x.key === k);
  // 状态列：始终取目标状态机中文名称（优先解析 r.status 与 payload 中的 status 状态 key）
  if (k === 'status') {
    const stKey = String(r.status || (r.payload?.status as string) || '');
    if (!stKey) return '—';
    return sysCtx.smStates.get(stKey)?.label ?? (stKey === 'draft' ? '草稿' : stKey === 'pending' ? '审批中' : stKey === 'approved' ? '已批准' : stKey === 'rejected' ? '已驳回' : stKey);
  }
  const pv = r.payload?.[k];
  // 数据源下拉列（select/search-select 等配置了 optionSource）：存量为文本值时原样展示，否则走 id→显示文本解析
  if (f && (f.type === 'select' || f.type === 'multi-select' || f.type === 'search-select' || f.type === 'search-multi-select') && f.optionSource?.formId) {
    return optCellText(r.payload ?? {}, k, schemaFields, optSrcRows, sysCtx.nameMap);
  }
  // 审计系统字段键：payload 有值优先（存量文本），无值从行数据+档案派生（员工姓名/所属部门/职位等）
  if ((pv === undefined || pv === null || pv === '') && (REF_SYS_KEYS as readonly string[]).includes(k)) {
    let v: unknown;
    if (k === 'created_at' || k === 'updated_at') {
      v = (r as unknown as Record<string, unknown>)[k];
      if (typeof v === 'string') return fmtDate(v, true);
    } else {
      v = systemFieldValue(k, r, sysCtx);
    }
    if (v === undefined || v === null || v === '') return '—';
    return String(v);
  }
  return optCellText(r.payload ?? {}, k, schemaFields, optSrcRows, sysCtx.nameMap);
};

/**
 * 主表保存前物化「随主表统一保存」的关联表单字段（默认模式）：
 * 值为 id 数组时拉取选中记录快照内嵌存入主表 payload；已内嵌（未改动）原样保留。
 * 单独保存且关联主表（saveMode='standalone'）的字段不受影响。
 */
export async function materializeInlineRefs(fields: FormField[], payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const refFields = fields.filter((f) => f.type === 'form-ref' && f.relation?.saveMode !== 'standalone' && !!f.relation?.formId);
  if (refFields.length === 0) return payload;
  const next = { ...payload };
  for (const f of refFields) {
    const val = next[f.key];
    if (isInlineRefValue(val)) continue; // 未改动，保持原快照
    if (Array.isArray(val)) {
      const ids = (val as unknown[]).filter((x): x is string => typeof x === 'string');
      next[f.key] = { __inline: true, ids, rows: await fetchInlineRows(ids) };
    }
  }
  return next;
}

/** 关联表单只读展示组件：在确认弹窗或详情中展示已选关联记录的指定显示字段表格（支持随主表保存的内嵌值直读） */
export function FormRefViewer({ field, value }: { field: FormField; value: unknown }) {
  const targetFormId = field.relation?.formId;
  const displayFields = field.relation?.displayFields ?? [];
  const inline = isInlineRefValue(value) ? value : null;
  const ids = inline ? [] : Array.isArray(value) ? (value as string[]).filter((x) => typeof x === 'string') : [];
  const [targetForm, setTargetForm] = useState<MetaForm | null>(null);
  const [rows, setRows] = useState<BizData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!targetFormId) { setTargetForm(null); setRows([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    void (async () => {
      const formRes = await supabase.from('meta_forms').select('*').eq('id', targetFormId).maybeSingle();
      const list = ids.filter(Boolean);
      const rowsRes = list.length > 0 ? await supabase.from('biz_data').select('*').in('id', list).eq('is_deleted', false) : { data: [] as BizData[] | null };
      if (!alive) return;
      setTargetForm((formRes.data as MetaForm | null) ?? null);
      const byId = new Map(((rowsRes.data as BizData[]) ?? []).map((r) => [r.id, r]));
      setRows(list.map((id) => byId.get(id)).filter(Boolean) as BizData[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [targetFormId, ids.join(',')]);

  const showRows = useMemo(() => (inline ? inlineToRows(inline, targetFormId) : rows), [inline, targetFormId, rows]);

  const targetSchemaFields = useMemo(() => ensureSystemFields((targetForm?.schema_json?.fields ?? []) as FormField[]), [targetForm]);
  const cols = useMemo(() => {
    const list = displayFields.filter((k) => targetSchemaFields.some((f) => f.key === k));
    return list.length > 0 ? list : targetSchemaFields.filter((f) => !f.system && !['section', 'row', 'action-button', 'wizard-step'].includes(f.type)).slice(0, 3).map((f) => f.key);
  }, [displayFields, targetSchemaFields]);

  const colLabel = (k: string) => targetSchemaFields.find((f) => f.key === k)?.label ?? k;
  // 单元格文本：系统字段（员工姓名/所属部门/状态）从行数据+档案派生、数据源下拉列 id→显示文本（与主表列表一致）
  const sysCtx = useRefSysCtx(targetFormId);
  const optSrcRows = useOptionSrcRows(targetSchemaFields);
  const cellVal = (r: BizData, k: string) => refCellText(r, k, targetSchemaFields, sysCtx, optSrcRows);

  if (loading) return <div className="flex items-center justify-center py-3 text-xs text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />加载关联数据…</div>;
  if (!targetForm) return <p className="text-xs text-muted-foreground">关联目标表单不存在</p>;
  if (showRows.length === 0) return <p className="text-xs text-muted-foreground">暂无关联数据</p>;

  return (
    <div className="rounded-md border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 border-b border-border">
          <tr>
            <th className="w-10 px-2.5 py-1.5 font-medium text-muted-foreground">#</th>
            {cols.map((k) => <th key={k} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{colLabel(k)}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {showRows.map((r, i) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <td className="px-2.5 py-1.5 text-muted-foreground">{i + 1}</td>
              {cols.map((k) => <td key={k} className="px-3 py-1.5 whitespace-nowrap text-foreground">{cellVal(r, k)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 关联表单编辑组件：在流转提交弹窗或填写确认弹窗中选择并维护关联记录 */
export function FormRefEditor({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: FormField;
  value: unknown;
  onChange: (ids: string[]) => void;
  readOnly?: boolean;
}) {
  // 当前选中 id 列表：随主表保存的内嵌值取快照 ids，其余取 id 数组
  const ids = isInlineRefValue(value) ? inlineRefIds(value) : Array.isArray(value) ? (value as string[]).filter((x) => typeof x === 'string') : [];
  const targetFormId = field.relation?.formId;
  const displayFields = field.relation?.displayFields ?? [];
  const inline = isInlineRefValue(value) ? value : null;

  const [targetForm, setTargetForm] = useState<MetaForm | null>(null);
  const [selectedRows, setSelectedRows] = useState<BizData[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [candidates, setCandidates] = useState<BizData[]>([]);
  const [pickerSel, setPickerSel] = useState<string[]>([]);
  const [searchKw, setSearchKw] = useState('');

  // 加载目标表单及已选记录（内嵌值直接用快照，不查库）
  useEffect(() => {
    if (!targetFormId) return;
    let alive = true;
    void (async () => {
      const formRes = await supabase.from('meta_forms').select('*').eq('id', targetFormId).maybeSingle();
      if (!alive) return;
      setTargetForm((formRes.data as MetaForm | null) ?? null);
      if (inline) {
        setSelectedRows(inlineToRows(inline, targetFormId));
        return;
      }
      if (ids.length > 0) {
        const rowsRes = await supabase.from('biz_data').select('*').in('id', ids).eq('is_deleted', false);
        if (!alive) return;
        const byId = new Map(((rowsRes.data as BizData[]) ?? []).map((r) => [r.id, r]));
        setSelectedRows(ids.map((id) => byId.get(id)).filter(Boolean) as BizData[]);
      } else {
        setSelectedRows([]);
      }
    })();
    return () => { alive = false; };
  }, [targetFormId, ids.join(',')]);

  const targetSchemaFields = useMemo(() => ensureSystemFields((targetForm?.schema_json?.fields ?? []) as FormField[]), [targetForm]);
  const cols = useMemo(() => {
    const list = displayFields.filter((k) => targetSchemaFields.some((f) => f.key === k));
    return list.length > 0 ? list : targetSchemaFields.filter((f) => !f.system && !['section', 'row', 'action-button', 'wizard-step'].includes(f.type)).slice(0, 3).map((f) => f.key);
  }, [displayFields, targetSchemaFields]);

  const colLabel = (k: string) => targetSchemaFields.find((f) => f.key === k)?.label ?? k;
  // 单元格文本：系统字段（员工姓名/所属部门/状态）从行数据+档案派生、数据源下拉列 id→显示文本（与主表列表一致）
  const sysCtx = useRefSysCtx(targetFormId);
  const optSrcRows = useOptionSrcRows(targetSchemaFields);
  const cellVal = (r: BizData, k: string) => refCellText(r, k, targetSchemaFields, sysCtx, optSrcRows);

  const openPicker = async () => {
    if (!targetFormId) return;
    setPickerSel(ids);
    setSearchKw('');
    setPickerOpen(true);
    setPickerLoading(true);
    const { data } = await supabase.from('biz_data').select('*').eq('form_id', targetFormId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(100);
    setCandidates((data as BizData[]) ?? []);
    setPickerLoading(false);
  };

  const removeId = (id: string) => {
    onChange(ids.filter((x) => x !== id));
  };

  const filteredCandidates = useMemo(() => {
    if (!searchKw.trim()) return candidates;
    const kw = searchKw.trim().toLowerCase();
    return candidates.filter((r) => {
      return cols.some((k) => {
        const txt = cellVal(r, k).toLowerCase();
        return txt.includes(kw);
      });
    });
  }, [candidates, searchKw, cols]);

  if (readOnly) {
    return <FormRefViewer field={field} value={value} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">已关联 {ids.length} 条数据</span>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void openPicker()}>
          <Plus className="h-3.5 w-3.5 mr-1" />选择关联数据
        </Button>
      </div>

      <div className="rounded-md border border-border overflow-hidden">
        {ids.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">点击「选择关联数据」添加关联</p>
        ) : (
          <div className="max-h-52 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0 border-b border-border">
                <tr>
                  {cols.map((k) => <th key={k} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{colLabel(k)}</th>)}
                  <th className="w-8 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ids.map((id) => {
                  const r = selectedRows.find((x) => x.id === id);
                  return (
                    <tr key={id} className="hover:bg-muted/40">
                      {cols.map((k) => (
                        <td key={k} className="px-3 py-1.5 whitespace-nowrap text-foreground">{r ? cellVal(r, k) : <span className="text-muted-foreground/60">数据加载中或已失效</span>}</td>
                      ))}
                      <td className="px-2 py-1.5 text-right">
                        <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => removeId(id)} title="移除">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>选择关联数据 · {field.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-9 text-xs"
                placeholder="搜索候选数据…"
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
              />
            </div>

            {pickerLoading ? (
              <div className="flex items-center justify-center py-10 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-1.5" />加载中…</div>
            ) : filteredCandidates.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">暂无符合条件的候选数据</p>
            ) : (
              <div className="border border-border rounded-md overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs min-w-max">
                  <thead className="bg-muted/50 sticky top-0 border-b border-border">
                    <tr>
                      <th className="w-10 px-2.5 py-2" />
                      {cols.map((k) => <th key={k} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{colLabel(k)}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredCandidates.map((r) => {
                      const checked = pickerSel.includes(r.id);
                      return (
                        <tr key={r.id} className={cn('hover:bg-muted/50 cursor-pointer', checked && 'bg-primary/5')} onClick={() => setPickerSel((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}>
                          <td className="px-2.5 py-2">
                            <Checkbox checked={checked} onCheckedChange={(v) => setPickerSel((s) => (v ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
                          </td>
                          {cols.map((k) => <td key={k} className="px-3 py-2 whitespace-nowrap text-foreground">{cellVal(r, k)}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>取消</Button>
            <Button onClick={() => { onChange(pickerSel); setPickerOpen(false); }}>
              确认所选（{pickerSel.length}）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
