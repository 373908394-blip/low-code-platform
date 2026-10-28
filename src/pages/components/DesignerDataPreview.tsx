import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ChartRenderer, type ChartKind } from '@/components/ui/echart';
import { supabase } from '@/db/supabase';
import type { BizData, MetaForm, PageField, SysSettings } from '@/types';
import { applyDisplayConditions, optionDisplayKeys, formatOptionFieldValue } from '@/lib/field-catalog';
import { calcTotalDays, isPrevYearExpired, fmtDays } from '@/lib/annual-leave';
import { fmtDate } from '@/lib/field-catalog';
import { buildTimeRange, bucketTime, inRange, resolveFieldValue, toChartDisplayNum } from '@/lib/chart-time';
import { getIcon } from '@/lib/icon-registry';
import { Loader2, CalendarDays } from 'lucide-react';
import PageLeaveList from './PageLeaveList';

import { cn } from '@/lib/utils';

interface Props {
  field: PageField;
  allForms: Pick<MetaForm, 'id' | 'name' | 'schema_json'>[];
  activeGridCol?: number;
  onSelectGridCol?: (idx: number) => void;
}

/**
 * 设计器中的数据预览：根据组件配置（查询表单/文本显示/图表/我的年假信息）
 * 拉取真实数据并渲染紧凑预览，供中间画布实时呈现设置效果。
 */
export default function DesignerDataPreview({ field, allForms, activeGridCol, onSelectGridCol }: Props) {
  const [rows, setRows] = useState<BizData[]>([]);
  const [meta, setMeta] = useState<MetaForm | null>(null);
  const [smStateMap, setSmStateMap] = useState<Map<string, { label: string }> | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [refDataCache, setRefDataCache] = useState<Record<string, Map<string, BizData>>>({});

  const formId = field.query?.formId || field.dataSource?.formId || field.chart?.formId || '';
  const target = useMemo(() => allForms.find((f) => f.id === formId) ?? null, [allForms, formId]);

  useEffect(() => {
    let alive = true;
    if (!formId) { setRows([]); setMeta(null); setSmStateMap(undefined); return; }
    setLoading(true);
    (async () => {
      const [dataRes] = await Promise.all([
        supabase.from('biz_data').select('*').eq('form_id', formId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50),
      ]);
      if (!alive) return;
      const raw = (dataRes.data as BizData[]) ?? [];
      const conditions = field.query?.conditions ?? field.chart?.conditions ?? [];
      const logic = field.query?.conditionsLogic ?? field.chart?.conditionsLogic ?? 'and';
      const filtered = applyDisplayConditions(raw as unknown as Record<string, unknown>[], conditions, logic) as unknown as BizData[];
      setRows(filtered);
      setMeta(target as unknown as MetaForm | null);
      // 预取关联数据：form-ref + select/search-select 动态数据源字段
      const allFields = (target as unknown as MetaForm)?.schema_json?.fields ?? [];
      const refFields = allFields.filter((f) =>
        (f.type === 'form-ref' && f.relation?.formId) ||
        (['select', 'multi-select', 'search-select', 'search-multi-select'].includes(f.type) && f.optionSource?.formId)
      );
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const newCache: Record<string, Map<string, BizData>> = {};
      for (const rf of refFields) {
        const targetFormId = rf.type === 'form-ref' ? rf.relation!.formId! : rf.optionSource!.formId!;
        const refIds = new Set<string>();
        filtered.forEach((row) => {
          const val = row.payload?.[rf.key];
          const pushIfUuid = (x: unknown) => { const s = String(x ?? ''); if (uuidRe.test(s)) refIds.add(s); };
          if (Array.isArray(val)) val.forEach(pushIfUuid);
          else if (val) pushIfUuid(val);
        });
        if (refIds.size === 0) continue;
        const { data: refRows } = await supabase.from('biz_data').select('*').in('id', Array.from(refIds)).eq('is_deleted', false);
        newCache[targetFormId] = new Map(((refRows as BizData[]) ?? []).map((r) => [r.id, r]));
      }
      if (Object.keys(newCache).length > 0) setRefDataCache((prev) => ({ ...prev, ...newCache }));
      // 加载状态机状态映射：status 字段优先显示状态机状态名
      const { data: sm } = await supabase.from('meta_state_machine').select('states').eq('form_id', formId).maybeSingle();
      const smStates = ((sm as { states?: { key: string; label: string }[] })?.states ?? []) as { key: string; label: string }[];
      if (!alive) return;
      setSmStateMap(smStates.length > 0 ? new Map(smStates.map((s) => [s.key, { label: s.label }])) : undefined);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [formId, target, field.query?.conditions, field.chart?.conditions, field.query?.conditionsLogic, field.chart?.conditionsLogic]);

  // 我的年假信息：不依赖数据源配置，添加到画布后即可预览真实年假统计信息
  if (field.type === 'page-leave-info') {
    return <LeaveInfoPreview field={field} />;
  }

  // 布局组件预览：分组标题 / 说明文字 / 分割线 / 分栏（不依赖全局数据源 formId，直接在画布呈现预览）
  if (field.type === 'page-group-title') {
    const size = field.layout?.size ?? 'h2';
    const cls = size === 'h2' ? 'text-base font-bold text-foreground' : size === 'h3' ? 'text-sm font-semibold text-foreground' : 'text-sm text-foreground';
    return <p className={cls}>{field.layout?.text || '分组标题'}</p>;
  }
  if (field.type === 'page-description') {
    return <p className="text-xs text-muted-foreground">{field.layout?.text || '说明文字'}</p>;
  }
  if (field.type === 'page-divider') {
    return <div className="border-t border-border" />;
  }
  if (field.type === 'page-grid') {
    const cols = field.layout?.columns ?? (field.gridColumns?.length || 2);
    const columns = field.gridColumns ?? [];
    return (
      <div className="rounded-md border border-border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground pb-1 border-b border-border/50">
          <span className="font-medium text-foreground">{field.label || '分栏布局'}</span>
          <span>{cols} 栏</span>
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((_, i) => {
            const col = columns[i];
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
                  'rounded border p-2 min-h-14 flex flex-col justify-between transition-all cursor-pointer',
                  isCurrent
                    ? 'border-primary ring-1 ring-primary/40 bg-primary/5'
                    : 'border-dashed border-border/80 hover:border-primary/50 bg-muted/20',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className={cn('text-xs font-medium truncate', isCurrent ? 'text-primary' : 'text-foreground')}>
                    {col?.title || `第 ${i + 1} 栏`}
                  </p>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">栏 {i + 1}</span>
                </div>
                <p className="text-[10px] text-muted-foreground truncate mt-1">
                  {col?.formId
                    ? `${col.fieldKey || '已选表单'} · ${col.aggregate === 'sum' ? '求和' : col.aggregate === 'count' ? '计数' : '取首条'}`
                    : col?.defaultValue
                      ? `默认: ${col.defaultValue}`
                      : '未关联数据源'}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  // 公式计算预览（不依赖全局数据源）
  if (field.type === 'page-formula') {
    const expr = field.formula?.expression ?? '';
    return <p className="text-xs text-muted-foreground">{expr ? `= ${expr}` : '请配置计算公式'}</p>;
  }
  // 自定义按钮预览（不依赖全局数据源）
  if (field.type === 'page-action-button') {
    return (
      <span className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
        {field.action?.label || '按钮'}
      </span>
    );
  }

  if (!formId) {
    return <p className="text-[11px] text-muted-foreground/60 py-2">未关联数据源，请在右侧配置</p>;
  }
  if (loading) {
    return <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  const labelOf = (key: string) => {
    const fd = meta?.schema_json?.fields?.find((f) => f.key === key);
    return fd?.label ?? key;
  };

  // 查询表单预览：迷你表格
  if (field.type === 'page-query') {
    const cols = (field.query?.displayFields ?? []).length > 0
      ? field.query!.displayFields!
      : (meta?.schema_json?.fields ?? []).filter((x) => !x.system && x.type !== 'action-button').slice(0, 3).map((x) => x.key);
    if (rows.length === 0) return <p className="text-[11px] text-muted-foreground/60 py-2">暂无符合条件的数据</p>;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const cellValue = (key: string, raw: unknown): string => {
      if (raw === undefined || raw === null || raw === '') return '—';
      const fieldDef = meta?.schema_json?.fields?.find((f) => f.key === key);
      // form-ref 字段：解析目标记录显示中文名
      if (fieldDef?.type === 'form-ref' && fieldDef.relation?.formId) {
        const refMap = refDataCache[fieldDef.relation.formId];
        if (refMap) {
          const ids = Array.isArray(raw) ? raw : [raw];
          const dispKeys = (fieldDef.relation.displayFields ?? []).filter(Boolean);
          return ids.map((id) => {
            const s = String(id);
            if (!uuidRe.test(s)) return s;
            const row = refMap.get(s);
            if (!row) return s;
            if (dispKeys.length > 0) {
              const txt = dispKeys.map((k) => formatOptionFieldValue(k, row)).filter(Boolean).join('-');
              if (txt) return txt;
            }
            return row.title ?? s;
          }).join('、');
        }
      }
      // select/search-select 动态数据源字段：解析 optionSource 目标记录显示中文名
      if (fieldDef && ['select', 'multi-select', 'search-select', 'search-multi-select'].includes(fieldDef.type) && fieldDef.optionSource?.formId) {
        const refMap = refDataCache[fieldDef.optionSource.formId];
        if (refMap) {
          const ids = Array.isArray(raw) ? raw : [raw];
          const dispKeys = optionDisplayKeys(fieldDef);
          const sep = fieldDef.optionSource.separator ?? '-';
          return ids.map((id) => {
            const s = String(id);
            if (!uuidRe.test(s)) return s;
            const row = refMap.get(s);
            if (!row) return s;
            if (dispKeys.length > 0) {
              const txt = dispKeys.map((k) => formatOptionFieldValue(k, row)).filter(Boolean).join(sep);
              if (txt) return txt;
            }
            return row.title ?? s;
          }).join('、');
        }
      }
      return String(raw);
    };
    return (
      <div className="overflow-x-auto rounded border border-border bg-background">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-muted/50">
              {cols.map((k) => <th key={k} className="whitespace-nowrap px-2 py-1 text-left font-medium text-muted-foreground">{labelOf(k)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 4).map((r) => (
              <tr key={r.id} className="border-t border-border">
                {cols.map((k) => {
                  const raw = (r.payload as Record<string, unknown> | undefined)?.[k];
                  return <td key={k} className="whitespace-nowrap px-2 py-1 text-foreground">{cellValue(k, raw)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 文本显示预览
  if (field.type === 'page-text-display') {
    const ds = field.dataSource!;
    let val = '—';
    if (rows.length > 0) {
      if (ds.aggregate === 'count') val = String(rows.length);
      else if (ds.aggregate === 'sum') val = String(rows.reduce((a, r) => a + (Number((r.payload as Record<string, unknown>)?.[ds.fieldKey]) || 0), 0));
      else { const raw = (rows[0].payload as Record<string, unknown>)?.[ds.fieldKey]; val = raw === undefined || raw === null || raw === '' ? '—' : String(raw); }
    }
    const unitText = ds?.unit || (ds.aggregate === 'count' ? '条' : '');
    const colorClass = ds?.color ? '' : 'text-primary';
    const style = ds?.color ? { color: ds.color } : undefined;
    return (
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-bold ${colorClass}`} style={style}>{val}</span>
        {unitText && <span className="text-[11px] text-muted-foreground">{unitText}</span>}
      </div>
    );
  }

  // 图表预览
  if (field.type.startsWith('page-chart-')) {
    const chart = field.chart!;
    // 漏斗图多层模式：按 formLayers 逐层加载、逐层独立聚合
    const isFunnelLayers = field.type === 'page-chart-funnel' && (chart.formLayers?.length ?? 0) > 1;
    if (isFunnelLayers) {
      return <FunnelLayersPreview chart={chart} allForms={allForms} />;
    }
    const granList = chart.timeGranularities ?? (chart.timeGranularity ? [chart.timeGranularity] : ['month']);
    const activeGran = granList[0];
    const hasTimeFilter = !!chart.timeField;
    const range = hasTimeFilter ? buildTimeRange(activeGran) : null;
    const fields = meta?.schema_json?.fields ?? [];
    const fieldDefs = new Map(fields.map((fd) => [fd.key, fd]));
    const isDimField = (key: string) => key === 'status' || fieldDefs.get(key)?.type === 'select';
    const labelOf = (key: string) => (key === 'status' ? '状态' : (fieldDefs.get(key)?.label ?? key));
    const seriesList = chart.seriesFields ?? [];
    const dimFields = seriesList.filter(isDimField);
    const measureFields = seriesList.filter((sf) => !isDimField(sf));
    const cfgOf = (key: string) => (chart.seriesConfigs ?? []).find((c) => c.fieldKey === key);

    // 多系列（按时间统计 + 分组字段）：下拉/状态机字段按取值拆曲线，其他字段每字段一条曲线（各自统计配置）
    if ((chart.groupBy ?? 'field') === 'time' && seriesList.length > 0) {
      const bucketSet = new Set<string>();
      const seriesSet = new Set<string>();
      const acc = new Map<string, Map<string, { sum: number; count: number }>>();
      const seriesAgg = new Map<string, 'sum' | 'count' | 'avg'>();
      measureFields.forEach((mf) => seriesAgg.set(labelOf(mf), cfgOf(mf)?.valueAgg ?? chart.valueAgg ?? 'count'));
      rows.forEach((r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        const timeVal = resolveFieldValue(r, chart.timeField ?? '', smStateMap);
        if (hasTimeFilter && (!range || !inRange(timeVal, range))) return;
        const bucket = bucketTime(timeVal, activeGran);
        if (!bucket) return;
        bucketSet.add(bucket);
        const b = acc.get(bucket) ?? new Map();
        const put = (seriesKey: string, num: number) => {
          seriesSet.add(seriesKey);
          const cur = b.get(seriesKey) ?? { sum: 0, count: 0 };
          cur.sum += num;
          cur.count += 1;
          b.set(seriesKey, cur);
        };
        if (dimFields.length > 0) {
          const num = chart.valueAgg === 'count' ? 1 : toChartDisplayNum(Number(p[chart.valueField ?? '']) || 0, chart.valueField ?? '', fields);
          const seriesKey = dimFields.map((sf) => resolveFieldValue(r, sf, smStateMap) || '未分类').join(' / ') || '未分类';
          put(seriesKey, num);
        }
        for (const mf of measureFields) {
          const cfg = cfgOf(mf);
          const agg = cfg?.valueAgg ?? chart.valueAgg ?? 'count';
          const vField = cfg?.valueField ?? '';
          const num = agg === 'count' ? 1 : toChartDisplayNum(Number(p[vField] ?? 0) || 0, vField, fields);
          put(labelOf(mf), num);
        }
        acc.set(bucket, b);
      });
      const finalize = (seriesKey: string, v: { sum: number; count: number }) => {
        const agg = seriesAgg.get(seriesKey) ?? chart.valueAgg ?? 'count';
        return agg === 'avg' ? Math.round((v.sum / v.count) * 100) / 100 : agg === 'count' ? v.count : Math.round(v.sum * 100) / 100;
      };
      const seriesNames = Array.from(seriesSet);
      const cats = Array.from(bucketSet).sort((a, b) => a.localeCompare(b));
      const seriesData = seriesNames.map((s) => ({ name: s, values: cats.map((c) => { const v = acc.get(c)?.get(s); return v ? finalize(s, v) : 0; }) }));
      if (cats.length === 0) return <p className="text-[11px] text-muted-foreground/60 py-2">暂无符合条件的数据</p>;
      return (
        <div className="w-full min-w-0 overflow-hidden">
          <ChartRenderer
            type={field.type.replace('page-chart-', '') as ChartKind}
            categories={cats}
            series={seriesData}
            height={150}
          />
        </div>
      );
    }

    const map = new Map<string, { sum: number; count: number }>();
    rows.forEach((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const timeVal = resolveFieldValue(r, chart.timeField ?? '', smStateMap);
      if (hasTimeFilter && (!range || !inRange(timeVal, range))) return;
      const raw = Number(p[chart.valueField ?? '']) || 0;
      const num = chart.valueAgg === 'count' ? 1 : toChartDisplayNum(raw, chart.valueField ?? '', meta?.schema_json?.fields);
      const bucket = (chart.groupBy ?? 'field') === 'time'
        ? bucketTime(timeVal, activeGran)
        : (resolveFieldValue(r, chart.categoryField ?? '', smStateMap) || '未分类');
      if (!bucket) return;
      const cur = map.get(bucket) ?? { sum: 0, count: 0 };
      cur.sum += num;
      cur.count += 1;
      map.set(bucket, cur);
    });
    const data = Array.from(map.entries()).map(([name, v]) => ({
      name,
      value: chart.valueAgg === 'avg' ? Math.round((v.sum / v.count) * 100) / 100 : chart.valueAgg === 'count' ? v.count : Math.round(v.sum * 100) / 100,
    })).sort((a, b) => ((chart.groupBy ?? 'field') === 'time' ? a.name.localeCompare(b.name) : b.value - a.value));
    if (data.length === 0) return <p className="text-[11px] text-muted-foreground/60 py-2">暂无符合条件的数据</p>;
    return (
      <div className="w-full min-w-0 overflow-hidden">
        <ChartRenderer
          type={field.type.replace('page-chart-', '') as ChartKind}
          categories={data.map((d) => d.name)}
          series={[{ name: 'value', values: data.map((d) => d.value) }]}
          pieData={data}
          height={150}
        />
      </div>
    );
  }

  // 汇总统计预览
  if (field.type === 'page-summary') {
    const s = field.summary;
    if (!s?.formId) return <p className="text-[11px] text-muted-foreground/60 py-2">未关联数据源，请在右侧配置</p>;
    let val = '—';
    if (s.aggregate === 'count') val = String(rows.length);
    else if (rows.length > 0) {
      const sum = rows.reduce((a, r) => a + (Number((r.payload as Record<string, unknown>)?.[s.fieldKey]) || 0), 0);
      val = s.aggregate === 'avg' ? String(Math.round((sum / rows.length) * 100) / 100) : String(sum);
    }
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold text-primary">{val}</span>
        {s.aggregate === 'count' && <span className="text-[11px] text-muted-foreground">条</span>}
      </div>
    );
  }

  return null;
}

/** 我的年假信息实时预览：读取当前登录账号的年假数据 */
function LeaveInfoPreview({ field }: { field: PageField }) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const userId = profile?.id ?? '';
  const currentYear = new Date().getFullYear();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<SysSettings['annual_leave_rules']>([]);
  const [expire, setExpire] = useState('03-31');
  const [used, setUsed] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!tenantId) return;
    (async () => {
      const [sRes, formRes] = await Promise.all([
        supabase.from('sys_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('meta_forms').select('id').eq('code', 'leave_request').eq('tenant_id', tenantId).maybeSingle(),
      ]);
      const settings = sRes.data as SysSettings | null;
      const formId = (formRes.data as { id: string } | null)?.id;
      setRules(settings?.annual_leave_rules ?? []);
      setExpire(settings?.annual_leave_expire ?? '03-31');
      let total = 0;
      if (formId && userId) {
        const { data } = await supabase.from('biz_data').select('created_at, status, payload').eq('form_id', formId).eq('created_by', userId).in('status', ['approved', 'xiaojia', 'xiaojiazhong']);
        (data ?? []).forEach((b) => {
          const p = (b as { payload: Record<string, unknown> }).payload ?? {};
          if (p.leave_type === '年假') total += Number(p.days) || 0;
        });
      }
      if (!alive) return;
      setUsed(total);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tenantId, userId]);

  const hireDate = profile?.hire_date ?? null;
  const total = calcTotalDays(rules, hireDate, currentYear);
  const remaining = Math.max(0, total - used);
  const prevTotal = calcTotalDays(rules, hireDate, currentYear - 1);
  const prevExpired = isPrevYearExpired(expire, currentYear);
  const prevRemaining = prevExpired ? 0 : Math.max(0, prevTotal - used);

  if (loading) {
    return <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  // 未设置入职日期时无法计算年假额度，给出明确提示而非全 0
  if (!hireDate) {
    return (
      <div className="space-y-2">
        <div className="rounded-[5px] border border-white bg-card p-3 text-center">
          <CalendarDays className="h-5 w-5 text-muted-foreground mx-auto mb-1.5" />
          <p className="text-xs text-muted-foreground">当前账号「{profile?.name ?? '—'}」未设置入职日期</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">设置入职日期后即可预览年假额度信息</p>
        </div>
        <PageLeaveList field={field} year={currentYear} compact />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>入职日期：{hireDate ? fmtDate(hireDate) : '未设置'}</span>
        <span>年份：{currentYear}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[['本年度年假总数', fmtDays(total), 'text-foreground', 'bg-muted/60'], ['本年度剩余', fmtDays(remaining), 'text-primary', 'bg-primary/5'], ['上一年度剩余', fmtDays(prevRemaining), 'text-foreground', 'bg-muted/60']].map(([t, v, color, bg]) => (
          <div key={t} className={`rounded-[5px] border border-white ${bg} p-2`}>
            <p className="text-[10px] text-muted-foreground">{t}</p>
            <p className={`text-base font-bold ${color}`}>{v}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">天</span></p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground/60">预览当前账号「{profile?.name ?? '—'}」的年假数据</p>
      <PageLeaveList field={field} year={currentYear} compact />
    </div>
  );
}

/** 漏斗图多层模式实时预览：逐层加载数据，按每层独立配置聚合 */
function FunnelLayersPreview({ chart, allForms }: { chart: NonNullable<PageField['chart']>; allForms: Pick<MetaForm, 'id' | 'name' | 'schema_json'>[] }) {
  const { profile } = useAuth();
  const [layerRows, setLayerRows] = useState<Record<string, BizData[]>>({});
  const [formNames, setFormNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const layers = chart.formLayers ?? [];
      const rowsMap: Record<string, BizData[]> = {};
      const names: Record<string, string> = {};
      for (const layer of layers) {
        const { data } = await supabase
          .from('biz_data')
          .select('*')
          .eq('form_id', layer.formId)
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })
          .limit(50);
        const raw = (data as BizData[]) ?? [];
        const filtered = applyDisplayConditions(
          raw as unknown as Record<string, unknown>[],
          layer.conditions ?? [],
          layer.conditionsLogic ?? 'and',
        ) as unknown as BizData[];
        rowsMap[layer.formId] = filtered;
        // 获取表单名
        const { data: formData } = await supabase
          .from('meta_forms')
          .select('name')
          .eq('id', layer.formId)
          .maybeSingle();
        names[layer.formId] = layer.label || ((formData as { name?: string })?.name ?? layer.formId);
      }
      if (!alive) return;
      setLayerRows(rowsMap);
      setFormNames(names);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [chart.formLayers]);

  const data = useMemo(() => {
    const layers = chart.formLayers ?? [];
    const hasTimeFilter = !!chart.timeField;
    const granList = chart.timeGranularities ?? (chart.timeGranularity ? [chart.timeGranularity] : ['month']);
    const range = hasTimeFilter ? buildTimeRange(granList[0]) : null;

    return layers.map((layer) => {
      const rows = layerRows[layer.formId] ?? [];
      const agg = layer.valueAgg ?? 'count';
      const label = formNames[layer.formId] ?? layer.formId;
      // 该层表单字段定义（用于 money 分→元换算）
      const layerMetaFields = (allForms.find((f) => f.id === layer.formId)?.schema_json?.fields ?? []) as { key: string; type?: string }[];

      const filtered = rows.filter((r) => {
        if (!hasTimeFilter || !range) return true;
        return inRange(resolveFieldValue(r, chart.timeField ?? 'created_at'), range);
      });

      if (layer.categoryField) {
        const map = new Map<string, { sum: number; count: number }>();
        filtered.forEach((r) => {
          const p = (r.payload ?? {}) as Record<string, unknown>;
          const cat = resolveFieldValue(r, layer.categoryField!) || '未分类';
          const raw = Number(p[layer.valueField ?? '']) || 0;
          const num = agg === 'count' ? 1 : toChartDisplayNum(raw, layer.valueField ?? '', layerMetaFields);
          const cur = map.get(cat) ?? { sum: 0, count: 0 };
          cur.sum += num;
          cur.count += 1;
          map.set(cat, cur);
        });
        const values = Array.from(map.values()).map((v) =>
          agg === 'avg' ? Math.round((v.sum / v.count) * 100) / 100 : agg === 'count' ? v.count : Math.round(v.sum * 100) / 100,
        );
        return { name: label, value: Math.max(...values, 0) };
      }

      const sum = filtered.reduce((a, r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        const raw = Number(p[layer.valueField ?? '']) || 0;
        return a + (agg === 'count' ? 1 : toChartDisplayNum(raw, layer.valueField ?? '', layerMetaFields));
      }, 0);
      const value = agg === 'avg' ? Math.round((sum / Math.max(1, filtered.length)) * 100) / 100 : Math.round(sum * 100) / 100;
      return { name: label, value };
    }).filter((r) => r.value > 0);
  }, [layerRows, formNames, chart.formLayers, chart.timeField, chart.timeGranularity, chart.timeGranularities]);

  if (loading) return <p className="text-[11px] text-muted-foreground/60 py-2">加载中…</p>;
  if (data.length === 0) return <p className="text-[11px] text-muted-foreground/60 py-2">暂无符合条件的数据</p>;
  return (
    <div className="w-full min-w-0 overflow-hidden">
      <ChartRenderer
        type="funnel"
        categories={data.map((d) => d.name)}
        series={[{ name: 'value', values: data.map((d) => d.value) }]}
        pieData={data}
        height={150}
      />
    </div>
  );
}