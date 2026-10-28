import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { BizData, MetaForm, PageField, Department, Profile, TextSourceConfig, DataRange, ActionDef } from '@/types';
import { passCond } from '@/lib/action-engine';
import { applyDisplayConditions, applyManualFilters, fmtDate, fmtMoney, buildCreatorScope, optionDisplayKeys, formatOptionFieldValue } from '@/lib/field-catalog';
import { loadFormSm, resolveStatusLabel, type FormSmMap } from '@/lib/status-machine';
import { getIcon } from '@/lib/icon-registry';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { toast } from 'sonner';
import { Loader2, FileText, Calendar, CalendarClock, CalendarRange, Clock, Search, X, CalendarDays, BarChart3, LineChart, AreaChart, BarChartHorizontal, PieChart, Radar, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DataPagination } from '@/components/ui/data-pagination';
import PageLeaveInfoCard from './components/PageLeaveInfoCard';
import PageChartCard from './components/PageChartCard';

/**
 * 加载文本数据源（文本显示组件 / 分栏每栏共用）：
 * 按数据范围 + 显示条件过滤后取聚合值；无关联表单时返回默认值。
 */
export async function resolveTextValue(
  source: TextSourceConfig,
  ctx: { profile: Pick<Profile, 'id' | 'department_id'>; dataScope: DataRange; tenantId: string },
): Promise<string> {
  if (!source.formId) return source.defaultValue ?? '';
  let creatorIds: string[] | null = null;
  const scope = source.dataRange;
  if (scope && scope !== 'all' && ctx.profile.id) {
    const [deptRes, profRes] = await Promise.all([
      supabase.from('departments').select('*').eq('tenant_id', ctx.tenantId),
      supabase.from('profiles').select('id, department_id').eq('tenant_id', ctx.tenantId),
    ]);
    creatorIds = buildCreatorScope({
      dataRange: scope,
      permissionScope: ctx.dataScope,
      profile: { id: ctx.profile.id, department_id: ctx.profile.department_id ?? null },
      departments: (deptRes.data as Department[]) ?? [],
      profiles: (profRes.data as Pick<Profile, 'id' | 'department_id'>[]) ?? [],
    });
  }
  let dataQuery = supabase.from('biz_data').select('*').eq('form_id', source.formId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(200);
  if (creatorIds) dataQuery = dataQuery.in('created_by', creatorIds.length > 0 ? creatorIds : ['00000000-0000-0000-0000-000000000000']);
  const { data: rows } = await dataQuery;
  const arr = applyDisplayConditions((rows ?? []) as unknown as Record<string, unknown>[], source.conditions ?? [], source.conditionsLogic ?? 'and') as unknown as BizData[];
  if (arr.length === 0) return source.defaultValue ?? '';
  if (source.aggregate === 'count') return String(arr.length);
  if (source.aggregate === 'sum') return String(arr.reduce((acc, r) => acc + (Number(r.payload?.[source.fieldKey]) || 0), 0));
  const raw = arr[0].payload?.[source.fieldKey];
  return raw === undefined || raw === null || raw === '' ? (source.defaultValue ?? '') : String(raw);
}

const PAGE_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'page-year': Calendar,
  'page-date': CalendarClock,
  'page-date-range': CalendarRange,
  'page-time': Clock,
  'page-query': Search,
  'page-text-display': FileText,
  'page-leave-info': CalendarDays,
  'page-chart-bar': BarChart3,
  'page-chart-line': LineChart,
  'page-chart-area': AreaChart,
  'page-chart-hbar': BarChartHorizontal,
  'page-chart-pie': PieChart,
  'page-chart-radar': Radar,
  'page-chart-funnel': Filter,
};

/**
 * 公式计算：将表达式中 {字段key} 替换为对应数值后求值。
 * 仅支持数字与 + - * / ( )，非法或缺失引用返回 '—'。
 */
function evalFormula(expression: string, summaryData: Record<string, string>, textData: Record<string, string>): string {
  if (!expression.trim()) return '—';
  const replaced = expression.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    const raw = summaryData[key] ?? textData[key] ?? '';
    const num = Number(raw);
    return Number.isFinite(num) ? String(num) : '0';
  });
  if (!/^[\d\s+\-*/().]+$/.test(replaced)) return '—';
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${replaced});`)();
    const num = Number(result);
    return Number.isFinite(num) ? String(Math.round(num * 100) / 100) : '—';
  } catch {
    return '—';
  }
}

/** 单页运行时：渲染筛选组件、查询表单与文本显示组件（只读查询，无增删改） */
export default function PageApp() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { profile, dataScope, hasPermission, isSuperadmin } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [form, setForm] = useState<MetaForm | null>(null);
  const [fields, setFields] = useState<PageField[]>([]);
  const [loading, setLoading] = useState(true);
  // 查询表单组件数据：fieldKey -> rows + meta
  const [queryData, setQueryData] = useState<Record<string, { rows: BizData[]; meta: MetaForm | null }>>({});
  /** page-query 关联表单的操作按钮（key → 该表单的 meta_actions），用于操作列渲染 */
  const [queryActions, setQueryActions] = useState<Record<string, ActionDef[]>>({});
  // 关联表单数据缓存：目标表单 id -> 记录 id -> 行数据（用于 form-ref 字段显示中文）
  const [refDataCache, setRefDataCache] = useState<Record<string, Map<string, BizData>>>({});
  // 文本显示组件数据：fieldKey -> 计算值
  const [textData, setTextData] = useState<Record<string, string>>({});
  // 分栏容器数据：fieldKey -> 每栏的值
  const [gridData, setGridData] = useState<Record<string, string[]>>({});
  // 汇总统计组件数据：fieldKey -> 计算值
  const [summaryData, setSummaryData] = useState<Record<string, string>>({});
  // 手动筛选值：fieldKey -> 值
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});
  /** 各查询表单组件的当前页码 / 每页条数（按组件 key 区分） */
  const [queryPages, setQueryPages] = useState<Record<string, number>>({});
  const [querySizes, setQuerySizes] = useState<Record<string, number>>({});
  // 各查询表单的状态机状态定义（formId → 状态表）：状态列显示自定义状态名称而非标识
  const [smMap, setSmMap] = useState<FormSmMap>(new Map());

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    const { data } = await supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle();
    if (!data) { setLoading(false); return; }
    const f = data as MetaForm;
    setForm(f);
    const pf = ((f.list_config as unknown as { pageFields?: PageField[] })?.pageFields ?? []) as PageField[];
    setFields(pf);

    // 预加载查询表单与文本显示组件的数据源
    const qd: Record<string, { rows: BizData[]; meta: MetaForm | null }> = {};
    const qdActions: Record<string, ActionDef[]> = {};
    const td: Record<string, string> = {};
    const sd: Record<string, string> = {};
    const gd: Record<string, string[]> = {};
    const qFields = pf.filter((x) => x.type === 'page-query' && x.query?.formId);
    const tFields = pf.filter((x) => x.type === 'page-text-display' && x.dataSource?.formId);
    const sFields = pf.filter((x) => x.type === 'page-summary' && x.summary?.formId);
    const gFields = pf.filter((x) => x.type === 'page-grid');

    await Promise.all([
      ...qFields.map(async (qf) => {
        const targetId = qf.query!.formId;
        // 数据范围：dept/dept_sub/mine 按创建人过滤
        let creatorIds: string[] | null = null;
        const scope = qf.query?.dataRange;
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
        const [dataRes, metaRes, actRes] = await Promise.all([
          dataQuery,
          supabase.from('meta_forms').select('*').eq('id', targetId).maybeSingle(),
          supabase.from('meta_actions').select('*').eq('form_id', targetId).order('sort'),
        ]);
        const rawRows = (dataRes.data as BizData[]) ?? [];
        const filtered = applyDisplayConditions(rawRows as unknown as Record<string, unknown>[], qf.query?.conditions ?? [], qf.query?.conditionsLogic ?? 'and') as unknown as BizData[];
        qd[qf.key] = { rows: filtered, meta: (metaRes.data as MetaForm) ?? null };
        qdActions[qf.key] = (actRes.data as ActionDef[]) ?? [];
        // 预取关联数据：form-ref 字段 + select/search-select 动态数据源字段，id → 中文名
        const allFields = (metaRes.data as MetaForm)?.schema_json?.fields ?? [];
        const refFields = allFields.filter((f) =>
          (f.type === 'form-ref' && f.relation?.formId) ||
          (['select', 'multi-select', 'search-select', 'search-multi-select'].includes(f.type) && f.optionSource?.formId)
        );
        for (const rf of refFields) {
          const targetFormId = rf.type === 'form-ref' ? rf.relation!.formId! : rf.optionSource!.formId!;
          const refIds = new Set<string>();
          filtered.forEach((row) => {
            const val = row.payload?.[rf.key];
            const pushIfUuid = (x: unknown) => {
              const s = String(x ?? '');
              // 只收集 UUID 格式的值，非 UUID（如已存中文名）跳过
              if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) refIds.add(s);
            };
            if (Array.isArray(val)) val.forEach(pushIfUuid);
            else if (val) pushIfUuid(val);
          });
          if (refIds.size === 0) continue;
          // 增量合并：仅拉取缓存中缺失的 id，避免后加数据显示 ID
          const existing = refDataCacheRef.current[targetFormId];
          const missing = Array.from(refIds).filter((id) => !existing?.has(id));
          if (existing && missing.length === 0) continue;
          let byId = new Map<string, BizData>(existing ?? []);
          if (missing.length > 0) {
            let refRows: BizData[] = [];
            // 分块查询，避免 in() 列表过长导致 400
            const CHUNK = 50;
            for (let ci = 0; ci < missing.length; ci += CHUNK) {
              const chunk = missing.slice(ci, ci + CHUNK);
              const { data, error } = await supabase.from('biz_data').select('*').in('id', chunk).eq('is_deleted', false);
              if (error) console.error('[PageApp] refDataCache fetch error:', error.message, 'chunk size:', chunk.length);
              if (data) refRows = [...refRows, ...(data as BizData[])];
            }
            byId = new Map([...byId, ...refRows.map((r) => [r.id, r] as const)]);
            refDataCacheRef.current = { ...refDataCacheRef.current, [targetFormId]: byId };
            const snapshot = refDataCacheRef.current;
            setRefDataCache(() => snapshot);
          }
        }
      }),
      ...tFields.map(async (tf) => {
        td[tf.key] = await resolveTextValue(tf.dataSource!, { profile: { id: profile?.id ?? '', department_id: profile?.department_id ?? null }, dataScope, tenantId });
      }),
      ...gFields.map(async (gf) => {
        const cols = gf.gridColumns ?? [];
        const vals = await Promise.all(cols.map((col) => resolveTextValue(col ?? { formId: '', fieldKey: '', aggregate: 'first' }, { profile: { id: profile?.id ?? '', department_id: profile?.department_id ?? null }, dataScope, tenantId })));
        gd[gf.key] = vals;
      }),
      ...sFields.map(async (sf) => {
        const s = sf.summary!;
        const { data: rows } = await supabase.from('biz_data').select('*').eq('form_id', s.formId).eq('is_deleted', false).limit(500);
        const arr = (rows as BizData[]) ?? [];
        let val = '—';
        if (s.aggregate === 'count') val = String(arr.length);
        else if (arr.length > 0) {
          const sum = arr.reduce((acc, r) => acc + (Number(r.payload?.[s.fieldKey]) || 0), 0);
          val = s.aggregate === 'avg' ? String(Math.round((sum / arr.length) * 100) / 100) : String(sum);
        }
        sd[sf.key] = val;
      }),
    ]);
    setQueryData(qd);
    setQueryActions(qdActions);
    setTextData(td);
    setGridData(gd);
    setSummaryData(sd);
    // 批量加载各查询表单的状态机：状态列按自定义状态名称解析
    setSmMap(await loadFormSm(qFields.map((qf) => qf.query?.formId)));
    setLoading(false);
  }, [formId, profile?.id]);

  /** 用 ref 保存最新缓存，避免 load 闭包中读到旧快照 */
  const refDataCacheRef = useRef<Record<string, Map<string, BizData>>>({});
  useEffect(() => { refDataCacheRef.current = refDataCache; }, [refDataCache]);

  useEffect(() => { load(); }, [load]);

  // 筛选条件变化后，各查询表单组件回到第一页
  useEffect(() => { setQueryPages({}); }, [filterVals]);

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!form) return <div className="p-8 text-center text-muted-foreground">单页不存在或未发布</div>;
  if (form.status !== 'published') {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
        <FileText className="h-8 w-8" />
        <p className="text-sm">该单页尚未发布</p>
        <Button size="sm" onClick={() => navigate(`/design/${formId}`)}>去设计并发布</Button>
      </div>
    );
  }

  const cellValue = (meta: MetaForm | null, r: BizData, key: string): string => {
    if (key === 'status') {
      const s = r.status;
      return s ? resolveStatusLabel(meta?.id, s, smMap) : '—';
    }
    if (key === 'created_at' || key === 'updated_at') {
      const v = r[key];
      return v ? fmtDate(String(v), true) : '—';
    }
    if (key === 'created_by' || key === 'updated_by') {
      const v = r[key];
      return v ? String(v) : '—';
    }
    const fieldDef = meta?.schema_json?.fields?.find((f) => f.key === key);
    const v = r.payload?.[key];
    if (v === undefined || v === null || v === '') return '—';
    // form-ref 关联字段：解析目标记录显示中文名
    if (fieldDef?.type === 'form-ref' && fieldDef.relation?.formId) {
      const refMap = refDataCache[fieldDef.relation.formId];
      if (refMap) {
        const ids = Array.isArray(v) ? v : [v];
        const dispKeys = (fieldDef.relation.displayFields?.length ? fieldDef.relation.displayFields : []).filter(Boolean);
        const names = ids.map((id) => {
          const s = String(id);
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s;
          const row = refMap.get(s);
          if (!row) return s;
          if (dispKeys.length > 0) {
            const txt = dispKeys.map((k) => formatOptionFieldValue(k, row)).filter(Boolean).join('-');
            if (txt) return txt;
          }
          return row.title ?? s;
        });
        return names.join('、');
      }
      return String(v);
    }
    // select/search-select 等动态数据源字段：解析 optionSource 目标记录显示中文名
    if (fieldDef && ['select', 'multi-select', 'search-select', 'search-multi-select'].includes(fieldDef.type) && fieldDef.optionSource?.formId) {
      const refMap = refDataCache[fieldDef.optionSource.formId];
      if (refMap) {
        const ids = Array.isArray(v) ? v : [v];
        const dispKeys = optionDisplayKeys(fieldDef);
        const sep = fieldDef.optionSource.separator ?? '-';
        const names = ids.map((id) => {
          const s = String(id);
          // 非 UUID 值（如直接存的中文名）原样显示
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s;
          const row = refMap.get(s);
          if (!row) return s;
          if (dispKeys.length > 0) {
            const txt = dispKeys.map((k) => formatOptionFieldValue(k, row)).filter(Boolean).join(sep);
            if (txt) return txt;
          }
          return row.title ?? s;
        });
        return names.join('、');
      }
      return String(v);
    }
    if (typeof v === 'number') return fmtMoney(v);
    if (Array.isArray(v)) return v.join('、');
    return String(v);
  };

  const fieldLabel = (meta: MetaForm | null, key: string): string => {
    const f = (meta?.schema_json?.fields ?? []).find((x) => x.key === key);
    return f?.label ?? key;
  };

  // page-query 操作列权限：同 BizApp 列表——移交/分配后仅负责人（或超管/无负责人的创建人）可见
  const rowOpsAllowed = (row: BizData | null | undefined): boolean => {
    if (!row) return true;
    if (isSuperadmin) return true;
    if (!row.assignee_id) return true;
    return row.assignee_id === profile?.id;
  };

  // page-query 操作列可见按钮：显示条件 + 权限码过滤
  const visibleQueryRowDefs = (fieldKey: string, row: BizData): ActionDef[] => {
    const defs = queryActions[fieldKey] ?? [];
    const smStates = smMap.get(row.form_id ?? '')?.states ?? new Map<string, { label: string; color?: string }>();
    return defs.filter((a) =>
      a.position === 'row' &&
      rowOpsAllowed(row) &&
      passCond(a.show_condition, row, profile, { assignee_id: row.assignee_id ?? '', assigneeName: row.assignee_name ?? '' }, smStates) &&
      (!a.permission_code || hasPermission(a.permission_code))
    );
  };

  return (
    <div className="w-full h-[calc(100vh-3.5rem)] overflow-auto bg-muted/20">
      <div className="w-full px-4 py-6 md:px-6">
        <div className="grid grid-cols-24 gap-x-4 gap-y-4" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
          {fields.map((f) => {
            const Icon = f.type === 'page-text-display' && f.dataSource?.icon
              ? getIcon(f.dataSource.icon)
              : PAGE_ICON_MAP[f.type] ?? FileText;
            return (
              <div key={f.id} style={{ gridColumn: `span ${f.span ?? 12} / span ${f.span ?? 12}` }} className="min-w-0">
                <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className="h-4 w-4 text-primary shrink-0 pointer-events-none" />
                    <Label className="text-sm font-medium flex-1 min-w-0 truncate">{f.label}</Label>
                    {f.type.startsWith('page-chart-') && f.chart?.formId && <span id={`chart-filter-${f.id}`} className="flex items-center gap-1.5 shrink-0" />}
                  </div>

                  {f.type === 'page-year' && (
                    <Input type="number" className="h-9 px-2" placeholder="如 2026" value={filterVals[f.key] ?? ''} onChange={(e) => setFilterVals((p) => ({ ...p, [f.key]: e.target.value }))} />
                  )}
                  {f.type === 'page-date' && (
                    <DateTimePicker mode="date" className="w-full h-9" value={filterVals[f.key] ?? ''} onChange={(v) => setFilterVals((p) => ({ ...p, [f.key]: v }))} />
                  )}
                  {f.type === 'page-date-range' && (
                    <Input className="h-9 px-2" placeholder="起始~结束（如 2026-01-01~2026-12-31）" value={filterVals[f.key] ?? ''} onChange={(e) => setFilterVals((p) => ({ ...p, [f.key]: e.target.value }))} />
                  )}
                  {f.type === 'page-time' && (
                    <Input type="time" className="h-9 px-2" value={filterVals[f.key] ?? ''} onChange={(e) => setFilterVals((p) => ({ ...p, [f.key]: e.target.value }))} />
                  )}

                  {f.type === 'page-query' && (() => {
                    const qd = queryData[f.key];
                    if (!qd || !qd.meta) return <p className="text-xs text-muted-foreground py-4 text-center">数据源不可用</p>;
                    const cols = (f.query?.displayFields ?? []).length > 0
                      ? f.query!.displayFields!
                      : (qd.meta.schema_json?.fields ?? []).filter((x) => !x.system && x.type !== 'action-button').slice(0, 4).map((x) => x.key);
                    const manualFilters = f.query?.manualFilters ?? [];
                    const filtered = applyManualFilters(qd.rows as unknown as Record<string, unknown>[], filterVals, manualFilters, f.query?.manualFiltersLogic ?? 'and') as unknown as BizData[];
                    return (
                      <div className="space-y-2">
                        {manualFilters.length > 0 && (
                          <div className="flex flex-wrap items-end gap-2">
                            {manualFilters.map((mf) => (
                              <div key={mf.id} className="flex flex-col gap-1 min-w-[140px]">
                                <span className="text-[11px] text-muted-foreground">{mf.label || fieldLabel(qd.meta, mf.fieldKey)}</span>
                                {mf.control === 'select' ? (
                                  <Select value={filterVals[mf.fieldKey] ?? 'all'} onValueChange={(v) => setFilterVals((p) => ({ ...p, [mf.fieldKey]: v === 'all' ? '' : v }))}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="全部" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="all">全部</SelectItem>
                                      {(mf.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                ) : mf.control === 'date' ? (
                                  <DateTimePicker mode="date" className="w-full h-8 text-xs" value={filterVals[mf.fieldKey] ?? ''} onChange={(v) => setFilterVals((p) => ({ ...p, [mf.fieldKey]: v }))} />
                                ) : mf.control === 'date-range' ? (
                                  <div className="flex items-center gap-1">
                                    <DateTimePicker mode="date" className="w-full h-8 text-xs" value={(filterVals[mf.fieldKey] ?? '').split('~')[0]?.trim() ?? ''} onChange={(v) => {
                                      const to = (filterVals[mf.fieldKey] ?? '').split('~')[1]?.trim() ?? '';
                                      setFilterVals((p) => ({ ...p, [mf.fieldKey]: `${v}~${to}` }));
                                    }} />
                                    <span className="text-xs text-muted-foreground shrink-0">~</span>
                                    <DateTimePicker mode="date" className="w-full h-8 text-xs" value={(filterVals[mf.fieldKey] ?? '').split('~')[1]?.trim() ?? ''} onChange={(v) => {
                                      const from = (filterVals[mf.fieldKey] ?? '').split('~')[0]?.trim() ?? '';
                                      setFilterVals((p) => ({ ...p, [mf.fieldKey]: `${from}~${v}` }));
                                    }} />
                                  </div>
                                ) : (
                                  <Input className="h-8 text-xs px-2" placeholder="筛选" value={filterVals[mf.fieldKey] ?? ''} onChange={(e) => setFilterVals((p) => ({ ...p, [mf.fieldKey]: e.target.value }))} />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {filtered.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-4 text-center">暂无数据</p>
                        ) : (() => {
                          const qSize = querySizes[f.key] ?? 10;
                          const qTotal = Math.max(1, Math.ceil(filtered.length / qSize));
                          const qSafe = Math.min(queryPages[f.key] ?? 1, qTotal);
                          const qPaged = filtered.slice((qSafe - 1) * qSize, qSafe * qSize);
                          const qRowDefs = (r: BizData) => visibleQueryRowDefs(f.key, r);
                          const hasAnyOps = qPaged.some((r) => qRowDefs(r).length > 0);
                          return (
                            <div className="rounded-[5px] border border-border bg-card">
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-muted/50">
                                    <tr>
                                      {cols.map((k) => <th key={k} className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground">{fieldLabel(qd.meta, k)}</th>)}
                                      {hasAnyOps && <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground w-24">操作</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {qPaged.map((r) => (
                                      <tr key={r.id} className="border-t border-border">
                                        {cols.map((k) => <td key={k} className="whitespace-nowrap px-3 py-2.5 text-foreground">{cellValue(qd.meta, r, k)}</td>)}
                                        {hasAnyOps && (
                                          <td className="whitespace-nowrap px-3 py-2.5">
                                            <div className="flex items-center gap-1">
                                              {qRowDefs(r).map((def) => (
                                                <button
                                                  key={def.id}
                                                  type="button"
                                                  className="text-primary hover:underline text-xs"
                                                  onClick={() => navigate(`/app/${r.form_id}?row=${r.id}`)}
                                                >
                                                  {def.name}
                                                </button>
                                              ))}
                                            </div>
                                          </td>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <DataPagination
                                total={filtered.length}
                                page={qSafe}
                                pageSize={qSize}
                                onPageChange={(p) => setQueryPages((s) => ({ ...s, [f.key]: p }))}
                                onPageSizeChange={(ps) => { setQuerySizes((s) => ({ ...s, [f.key]: ps })); setQueryPages((s) => ({ ...s, [f.key]: 1 })); }}
                              />
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}

                  {f.type === 'page-text-display' && (() => {
                    const ds = f.dataSource;
                    const hasForm = !!ds?.formId;
                    const val = textData[f.key] ?? (hasForm ? '—' : ds?.defaultValue ?? '');
                    const unitText = ds?.unit || (hasForm && ds?.aggregate === 'count' ? '条' : '');
                    const colorClass = ds?.color ? '' : 'text-primary';
                    const style = ds?.color ? { color: ds.color } : undefined;
                    return (
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-2xl font-bold ${colorClass}`} style={style}>{val}</span>
                        {unitText && <span className="text-xs text-muted-foreground">{unitText}</span>}
                      </div>
                    );
                  })()}

                  {f.type === 'page-leave-info' && <PageLeaveInfoCard field={f} />}

                  {f.type.startsWith('page-chart-') && (
                    f.chart?.formId ? <PageChartCard chart={f.chart} type={f.type as 'page-chart-bar' | 'page-chart-line' | 'page-chart-pie' | 'page-chart-funnel'} filterAnchorId={`chart-filter-${f.id}`} /> : <p className="text-xs text-muted-foreground py-4 text-center">未关联数据源</p>
                  )}

                  {f.type === 'page-group-title' && (() => {
                    const size = f.layout?.size ?? 'h2';
                    const cls = size === 'h2' ? 'text-lg font-bold text-foreground' : size === 'h3' ? 'text-base font-semibold text-foreground' : 'text-sm text-foreground';
                    return <p className={cls}>{f.layout?.text || '分组标题'}</p>;
                  })()}

                  {f.type === 'page-description' && <p className="text-sm text-muted-foreground">{f.layout?.text || '说明文字'}</p>}

                  {f.type === 'page-divider' && <div className="border-t border-border" />}

                  {f.type === 'page-grid' && (() => {
                    const cols = f.layout?.columns ?? 2;
                    const columns = f.gridColumns ?? [];
                    const vals = gridData[f.key] ?? [];
                    return (
                      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                        {Array.from({ length: cols }).map((_, i) => {
                          const col = columns[i];
                          const hasForm = !!col?.formId;
                          const val = vals[i] ?? (hasForm ? '—' : col?.defaultValue ?? '');
                          const IconComp = col?.icon ? getIcon(col.icon) : null;
                          const unitText = col?.unit || (hasForm && col?.aggregate === 'count' ? '条' : '');
                          const colorClass = col?.color ? '' : 'text-primary';
                          const colStyle = col?.color ? { color: col.color } : undefined;
                          return (
                            <div key={i} className="min-h-16 rounded border border-border bg-muted/20 p-3 space-y-1">
                              {col?.title && <p className="text-xs text-muted-foreground truncate">{col.title}</p>}
                              <div className="flex items-center gap-2">
                                {IconComp && (
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                                    <IconComp className="h-4 w-4 text-primary pointer-events-none" />
                                  </div>
                                )}
                                <div className="flex items-baseline gap-1">
                                  <span className={`text-xl font-bold ${colorClass}`} style={colStyle}>{val}</span>
                                  {unitText && <span className="text-[10px] text-muted-foreground">{unitText}</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* 页面布局容器：竖分列，每列渲染子组件，纯排版无样式 */}
                  {f.type === 'page-layout' && (() => {
                    const count = f.layoutColumns?.count ?? 2;
                    const childrenArr = f.layoutColumns?.children ?? [];
                    return (
                      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
                        {Array.from({ length: count }).map((_, colIdx) => {
                          const colChildren = childrenArr[colIdx] ?? [];
                          return (
                            <div key={colIdx} className="min-w-0 space-y-3">
                              {colChildren.length === 0 && (
                                <div className="min-h-24 rounded border border-dashed border-border/60" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {f.type === 'page-summary' && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-primary">{summaryData[f.key] ?? '—'}</span>
                      {f.summary?.aggregate === 'count' && <Badge variant="outline" className="text-xs">条</Badge>}
                    </div>
                  )}

                  {f.type === 'page-formula' && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-primary">{evalFormula(f.formula?.expression ?? '', summaryData, textData)}</span>
                    </div>
                  )}

                  {f.type === 'page-action-button' && (
                    <Button size="sm" onClick={() => {
                      const a = f.action;
                      if (!a) return;
                      if (a.type === 'navigate' && a.targetPath) navigate(a.targetPath);
                      else if (a.type === 'print') window.print();
                      else if (a.type === 'refresh') load();
                    }}>
                      {f.action?.label || '按钮'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}