import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ChartRenderer, type ChartKind } from '@/components/ui/echart';
import type { BizData, MetaForm, PageField } from '@/types';
import { applyDisplayConditions, applyManualFilters, buildCreatorScope } from '@/lib/field-catalog';
import { buildTimeRange, bucketTime, inRange, resolveFieldValue, TIME_GRANULARITY_LABELS, toChartDisplayNum } from '@/lib/chart-time';
import { fetchBizRows, fetchDepartments, fetchMetaForm, fetchProfiles, fetchStateMachine } from '@/lib/chart-data-fetch';
import type { TimeGranularity } from '@/lib/chart-time';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, Search } from 'lucide-react';

type ChartType = 'page-chart-bar' | 'page-chart-line' | 'page-chart-area' | 'page-chart-hbar' | 'page-chart-pie' | 'page-chart-radar' | 'page-chart-funnel';

interface Props {
  chart: NonNullable<PageField['chart']>;
  type: ChartType;
  /** 筛选控件（时间粒度/手动筛选）通过 portal 渲染到该 id 的容器（标题行最右侧）；不传则按原独立行展示 */
  filterAnchorId?: string;
}

/** 单页图表组件：根据数据源、维度/度量、过滤条件与时间维度聚合渲染图表 */
export default function PageChartCard({ chart, type, filterAnchorId }: Props) {
  const { profile, dataScope } = useAuth();
  const tenantId = profile?.tenant_id ?? '';

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BizData[]>([]);
  const [meta, setMeta] = useState<MetaForm | null>(null);
  const [smStateMap, setSmStateMap] = useState<Map<string, { label: string }> | undefined>(undefined);
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});
  const [filterErrors, setFilterErrors] = useState<Record<string, string>>({});
  const [formNames, setFormNames] = useState<Record<string, string>>({});

  // 时间粒度切换状态
  const granularities = useMemo<TimeGranularity[]>(() => {
    const list: TimeGranularity[] = chart.timeGranularities ?? (chart.timeGranularity ? [chart.timeGranularity] : []);
    return list.length > 0 ? list : ['month'];
  }, [chart.timeGranularities, chart.timeGranularity]);
  const [activeGran, setActiveGran] = useState<TimeGranularity>(granularities[0]);
  useEffect(() => setActiveGran(granularities[0]), [granularities[0]]);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customRangeError, setCustomRangeError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    // 数据范围：dept/dept_sub/mine 需按创建人过滤
    let creatorIds: string[] | null = null;
    const scope = chart.dataRange;
    if (scope && scope !== 'all' && profile?.id) {
      const [departments, profiles] = await Promise.all([
        fetchDepartments(tenantId),
        fetchProfiles(tenantId),
      ]);
      creatorIds = buildCreatorScope({
        dataRange: scope,
        permissionScope: dataScope,
        profile: { id: profile.id, department_id: profile.department_id ?? null },
        departments,
        profiles,
      });
    }
    const isFunnelMulti = type === 'page-chart-funnel' && (chart.formLayers?.length ?? 0) > 1;

    if (isFunnelMulti) {
      // 漏斗图多层：按 formLayers 顺序逐层加载（限流+去重共享），每层独立聚合
      const layers = chart.formLayers!;
      const [allRowsArr, metas] = await Promise.all([
        Promise.all(layers.map((layer) => fetchBizRows(layer.formId, creatorIds))),
        Promise.all(layers.map((layer) => fetchMetaForm(layer.formId))),
      ]);
      const allRows: BizData[] = [];
      const formNameMap: Record<string, string> = {};
      layers.forEach((layer, i) => {
        const filtered = applyDisplayConditions(
          allRowsArr[i] as unknown as Record<string, unknown>[],
          layer.conditions ?? [],
          layer.conditionsLogic ?? 'and',
        ) as unknown as BizData[];
        allRows.push(...filtered);
        formNameMap[layer.formId] = layer.label || metas[i]?.name || layer.formId;
      });
      setRows(allRows);
      setFormNames(formNameMap);
      setMeta(metas[0] ?? null);
      setSmStateMap(undefined);
      setLoading(false);
      return;
    }

    // 单数据源：拉取数据行与表单元数据（限流+去重共享）
    const [raw, metaForm] = await Promise.all([
      fetchBizRows(chart.formId, creatorIds),
      fetchMetaForm(chart.formId),
    ]);
    const filtered = applyDisplayConditions(raw as unknown as Record<string, unknown>[], chart.conditions ?? [], chart.conditionsLogic ?? 'and') as unknown as BizData[];
    setRows(filtered);
    setMeta(metaForm);
    // 加载状态机状态映射：status 字段优先显示状态机状态名
    const smStates = metaForm ? await fetchStateMachine(metaForm.id) : [];
    setSmStateMap(smStates.length > 0 ? new Map(smStates.map((s) => [s.key, { label: s.label }])) : undefined);
    setLoading(false);
  }, [chart.formId, chart.formLayers, chart.conditions, chart.conditionsLogic, chart.dataRange, profile, tenantId, dataScope]);

  useEffect(() => {
    if (chart.formId) load();
  }, [chart.formId, load]);

  /** 漏斗图多层模式：统计配置在各 formLayer 内，忽略全局统计/筛选配置 */
  const isFunnelLayers = type === 'page-chart-funnel' && (chart.formLayers?.length ?? 0) > 1;

  const manualFilters = isFunnelLayers ? [] : (chart.manualFilters ?? []);
  const displayRows = useMemo(
    () => applyManualFilters(rows as unknown as Record<string, unknown>[], filterVals, manualFilters, chart.manualFiltersLogic ?? 'and') as unknown as BizData[],
    [rows, filterVals, manualFilters, chart.manualFiltersLogic],
  );

  /** 是否启用时间筛选：与统计方式无关，只要配置了时间字段即生效（按字段统计也可叠加时间筛选） */
  const hasTimeFilter = !!chart.timeField;

  const timeRange = useMemo(() => {
    if (!hasTimeFilter) return null;
    return buildTimeRange(activeGran, customStart, customEnd);
  }, [hasTimeFilter, activeGran, customStart, customEnd]);

  const seriesFields = chart.seriesFields ?? [];

  type ChartResult =
    | { mode: 'series'; series: string[]; rows: Record<string, string | number>[] }
    | { mode: 'single'; series: string[]; rows: { name: string; value: number }[] };

  const chartData = useMemo<ChartResult>(() => {
    // 漏斗图多层配置
    const isFunnelMulti = type === 'page-chart-funnel' && (chart.formLayers?.length ?? 0) > 1;
    if (isFunnelMulti) {
      const layers = chart.formLayers!;
      const range = timeRange;
      // 按层聚合：每层独立配置 categoryField / valueAgg / valueField；时间筛选对所有层生效
      const rows: { name: string; value: number }[] = [];
      for (const layer of layers) {
        const layerRows = displayRows.filter((r) => {
          if (r.form_id !== layer.formId) return false;
          if (hasTimeFilter && range && !inRange(resolveFieldValue(r, chart.timeField ?? 'created_at', smStateMap), range)) return false;
          return true;
        });
        const agg = layer.valueAgg ?? 'count';
        const label = formNames[layer.formId] ?? layer.formId;

        if (layer.categoryField) {
          // 按字段值分组：取该组最大值作为本层数值
          const map = new Map<string, { sum: number; count: number }>();
          layerRows.forEach((r) => {
            const p = (r.payload ?? {}) as Record<string, unknown>;
            const cat = resolveFieldValue(r, layer.categoryField!, smStateMap) || '未分类';
            const raw = Number(p[layer.valueField ?? '']) || 0;
            const num = agg === 'count' ? 1 : toChartDisplayNum(raw, layer.valueField ?? '', meta?.schema_json?.fields);
            const cur = map.get(cat) ?? { sum: 0, count: 0 };
            cur.sum += num;
            cur.count += 1;
            map.set(cat, cur);
          });
          const topValue = Math.max(...Array.from(map.values()).map((v) =>
            agg === 'avg' ? Math.round((v.sum / v.count) * 100) / 100 : agg === 'count' ? v.count : Math.round(v.sum * 100) / 100
          ));
          rows.push({ name: label, value: topValue > 0 ? topValue : 0 });
        } else {
          // 未选分组字段：按记录数/求和/平均值聚合
          const num = layerRows.reduce((a, r) => {
            const p = (r.payload ?? {}) as Record<string, unknown>;
            const raw = Number(p[layer.valueField ?? '']) || 0;
            return a + (agg === 'count' ? 1 : toChartDisplayNum(raw, layer.valueField ?? '', meta?.schema_json?.fields));
          }, 0);
          const value = agg === 'avg' ? Math.round((num / Math.max(1, layerRows.length)) * 100) / 100 : Math.round(num * 100) / 100;
          rows.push({ name: label, value });
        }
      }
      return { mode: 'single' as const, series: [] as string[], rows: rows.filter((r) => r.value > 0) };
    }
    if (hasTimeFilter && !timeRange) return { mode: 'single', series: [], rows: [] };
    const range = timeRange as NonNullable<typeof timeRange> | null;
    const isTime = (chart.groupBy ?? 'field') === 'time';

    // 多系列（按时间统计 + 配置了分组字段）：
    // 下拉/状态机字段按每个取值拆为独立曲线（统计方式沿用全局配置）；
    // 其他字段每个字段一条曲线，各自配置统计方式和数值字段（seriesConfigs，缺省回退全局）
    if (isTime && seriesFields.length > 0) {
      const bucketSet = new Set<string>();
      const seriesSet = new Set<string>();
      const acc = new Map<string, Map<string, { sum: number; count: number }>>();
      /** 每系列独立统计方式（度量字段曲线 finalize 时按系列取值） */
      const seriesAgg = new Map<string, 'sum' | 'count' | 'avg'>();
      const fieldDefs = new Map((meta?.schema_json?.fields ?? []).map((fd) => [fd.key, fd]));
      // 维度字段：下拉单选或状态机状态字段（status 为系统字段，可能不在 schema 内）
      const isDimField = (key: string) => key === 'status' || fieldDefs.get(key)?.type === 'select';
      const dimFields = seriesFields.filter(isDimField);
      const measureFields = seriesFields.filter((sf) => !isDimField(sf));
      const cfgOf = (key: string) => (chart.seriesConfigs ?? []).find((c) => c.fieldKey === key);
      const labelOf = (key: string) => (key === 'status' ? '状态' : (fieldDefs.get(key)?.label ?? key));
      // 度量字段曲线名与统计方式：完全走每字段配置（seriesConfigs），不回退全局（全局配置仅属于下拉/状态机维度模式）
      measureFields.forEach((mf) => seriesAgg.set(labelOf(mf), cfgOf(mf)?.valueAgg ?? chart.valueAgg ?? 'count'));

      displayRows.forEach((r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        const timeVal = resolveFieldValue(r, chart.timeField ?? '', smStateMap);
        if (hasTimeFilter && !inRange(timeVal, range as NonNullable<typeof range>)) return;
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
        // 维度字段：按取值拆曲线，多个维度字段取值以「/」拼接，空值记为「未分类」
        if (dimFields.length > 0) {
          const num = chart.valueAgg === 'count' ? 1 : Number(p[chart.valueField ?? '']) || 0;
          const seriesKey = dimFields
            .map((sf) => resolveFieldValue(r, sf, smStateMap) || '未分类')
            .join(' / ') || '未分类';
          put(seriesKey, num);
        }
        // 度量字段：每个字段一条曲线，统计数值/数值字段完全取每字段配置；money 字段分→元换算
        for (const mf of measureFields) {
          const cfg = cfgOf(mf);
          const agg = cfg?.valueAgg ?? chart.valueAgg ?? 'count';
          const vField = cfg?.valueField ?? '';
          const num = agg === 'count' ? 1 : toChartDisplayNum(Number(p[vField] ?? 0) || 0, vField, meta?.schema_json?.fields);
          put(labelOf(mf), num);
        }
        acc.set(bucket, b);
      });
      // finalize 按系列各自的统计方式计算
      const finalize = (seriesKey: string, v: { sum: number; count: number }) => {
        const agg = seriesAgg.get(seriesKey) ?? chart.valueAgg ?? 'count';
        return agg === 'avg' ? Math.round((v.sum / v.count) * 100) / 100 : agg === 'count' ? v.count : Math.round(v.sum * 100) / 100;
      };
      const seriesList = Array.from(seriesSet);
      return {
        mode: 'series' as const,
        series: seriesList,
        rows: Array.from(bucketSet)
          .sort((a, b) => a.localeCompare(b))
          .map((name) => {
            const b = acc.get(name) ?? new Map();
            const row: Record<string, string | number> = { name };
            seriesList.forEach((s) => {
              const v = b.get(s);
              row[s] = v ? finalize(s, v) : 0;
            });
            return row;
          }),
      };
    }

    // 单系列：按字段统计用分类字段分桶，按时间统计用时间粒度分桶
    const map = new Map<string, { sum: number; count: number }>();
    displayRows.forEach((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const timeVal = resolveFieldValue(r, chart.timeField ?? '', smStateMap);
      if (hasTimeFilter && !inRange(timeVal, range as NonNullable<typeof range>)) return;
      const raw = Number(p[chart.valueField ?? '']) || 0;
      const num = chart.valueAgg === 'count' ? 1 : toChartDisplayNum(raw, chart.valueField ?? '', meta?.schema_json?.fields);
      const bucket = isTime ? bucketTime(timeVal, activeGran) : (resolveFieldValue(r, chart.categoryField ?? '', smStateMap) || '未分类');
      if (!bucket) return;
      const cur = map.get(bucket) ?? { sum: 0, count: 0 };
      cur.sum += num;
      cur.count += 1;
      map.set(bucket, cur);
    });
    return {
      mode: 'single' as const,
      series: [] as string[],
      rows: Array.from(map.entries())
        .map(([name, v]) => ({
          name,
          value: chart.valueAgg === 'avg' ? Math.round((v.sum / v.count) * 100) / 100 : chart.valueAgg === 'count' ? v.count : Math.round(v.sum * 100) / 100,
        }))
        .sort((a, b) => (isTime ? a.name.localeCompare(b.name) : b.value - a.value)),
    };
  }, [displayRows, chart, hasTimeFilter, activeGran, timeRange, seriesFields, smStateMap, type, formNames, meta]);

  const isSeries = chartData.mode === 'series';
  const seriesRows = isSeries ? (chartData.rows as Record<string, string | number>[]) : [];
  const seriesList = isSeries ? (chartData.series as string[]) : [];
  const singleRows = !isSeries ? (chartData.rows as { name: string; value: number }[]) : [];

  const fieldLabel = (key: string) => {
    const fd = meta?.schema_json?.fields?.find((f) => f.key === key);
    return fd?.label ?? key;
  };

  // 手动筛选值校验
  const validateFilter = (key: string, control: string, value: string): string => {
    const v = value.trim();
    if (!v) return '';
    if (control === 'input') {
      // 数值字段校验
      const fd = meta?.schema_json?.fields?.find((f) => f.key === key);
      if (fd?.type === 'number' && Number.isNaN(Number(v))) return '请输入有效的数值';
    }
    if (control === 'date' || control === 'date-range') {
      const parts = v.split('~').map((s) => s.trim());
      for (const part of parts) {
        if (part && Number.isNaN(new Date(part.replace(' ', 'T')).getTime())) return '日期格式不正确';
      }
      if (control === 'date-range' && parts.length === 2 && parts[0] && parts[1] && new Date(parts[0]) > new Date(parts[1])) return '开始时间不能晚于结束时间';
    }
    return '';
  };

  const setFilterVal = (key: string, control: string, value: string) => {
    setFilterVals((p) => ({ ...p, [key]: value }));
    setFilterErrors((p) => ({ ...p, [key]: validateFilter(key, control, value) }));
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!meta) {
    return <p className="text-xs text-muted-foreground py-8 text-center">数据源不可用</p>;
  }

  const empty = chartData.rows.length === 0;
  const hasFilterError = Object.values(filterErrors).some(Boolean);
  const showCustomRange = hasTimeFilter && activeGran === 'range';
  const customInvalid = showCustomRange && customStart && customEnd && new Date(customStart) > new Date(customEnd);

  const filterControls = (
    <>
      {/* 时间粒度切换标签 */}
      {hasTimeFilter && granularities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {granularities.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setActiveGran(g)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                activeGran === g ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60',
              )}
            >
              {TIME_GRANULARITY_LABELS[g]}
            </button>
          ))}
        </div>
      )}

      {/* 自定义时间范围 */}
      {showCustomRange && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1 min-w-[140px]">
              <span className="text-[11px] text-muted-foreground">开始日期</span>
              <DateTimePicker mode="date" className="w-full h-8 text-xs" value={customStart} onChange={(v) => { setCustomStart(v); setCustomRangeError(''); }} />
            </div>
            <div className="flex flex-col gap-1 min-w-[140px]">
              <span className="text-[11px] text-muted-foreground">结束日期</span>
              <DateTimePicker mode="date" className="w-full h-8 text-xs" value={customEnd} onChange={(v) => { setCustomEnd(v); setCustomRangeError(''); }} />
            </div>
            <Button size="sm" className="h-8" onClick={() => {
              if (customStart && customEnd && new Date(customStart) > new Date(customEnd)) { setCustomRangeError('开始时间不能晚于结束时间'); return; }
              setCustomRangeError('');
            }}>
              <Search className="mr-1 h-3.5 w-3.5" />查询
            </Button>
          </div>
          {customRangeError && <p className="text-[11px] text-destructive">{customRangeError}</p>}
        </div>
      )}

      {/* 手动筛选区 */}
      {manualFilters.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-2.5">
          {manualFilters.map((mf) => {
            const err = filterErrors[mf.fieldKey];
            return (
              <div key={mf.id} className="flex flex-col gap-1 min-w-[140px]">
                <span className="text-[11px] text-muted-foreground">{mf.label || fieldLabel(mf.fieldKey)}</span>
                {mf.control === 'select' ? (
                  <Select value={filterVals[mf.fieldKey] ?? 'all'} onValueChange={(v) => setFilterVal(mf.fieldKey, mf.control, v === 'all' ? '' : v)}>
                    <SelectTrigger className="h-8 text-xs bg-card"><SelectValue placeholder="全部" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {(mf.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : mf.control === 'date' ? (
                  <DateTimePicker mode="date" className={cn('w-full h-8 text-xs bg-card', err && 'border-destructive')} value={filterVals[mf.fieldKey] ?? ''} onChange={(v) => setFilterVal(mf.fieldKey, mf.control, v)} />
                ) : mf.control === 'date-range' ? (
                  <div className="flex items-center gap-1">
                    <DateTimePicker mode="date" className={cn('w-full h-8 text-xs bg-card', err && 'border-destructive')} value={(filterVals[mf.fieldKey] ?? '').split('~')[0]?.trim() ?? ''} onChange={(v) => {
                      const to = (filterVals[mf.fieldKey] ?? '').split('~')[1]?.trim() ?? '';
                      setFilterVal(mf.fieldKey, mf.control, `${v}~${to}`);
                    }} />
                    <span className="text-xs text-muted-foreground shrink-0">~</span>
                    <DateTimePicker mode="date" className={cn('w-full h-8 text-xs bg-card', err && 'border-destructive')} value={(filterVals[mf.fieldKey] ?? '').split('~')[1]?.trim() ?? ''} onChange={(v) => {
                      const from = (filterVals[mf.fieldKey] ?? '').split('~')[0]?.trim() ?? '';
                      setFilterVal(mf.fieldKey, mf.control, `${from}~${v}`);
                    }} />
                  </div>
                ) : (
                  <Input className={cn('h-8 text-xs px-2 bg-card', err && 'border-destructive')} placeholder={mf.placeholder || '筛选'} value={filterVals[mf.fieldKey] ?? ''} onChange={(e) => setFilterVal(mf.fieldKey, mf.control, e.target.value)} />
                )}
                {err && <p className="text-[10px] text-destructive">{err}</p>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {/* 筛选控件：配置了标题行锚点则 portal 到标题行最右侧，否则按原独立行展示 */}
      {filterAnchorId
        ? createPortal(filterControls, document.getElementById(filterAnchorId) ?? document.body)
        : filterControls}

      {hasFilterError ? (
        <div className="flex h-56 items-center justify-center text-xs text-destructive">请修正筛选条件后再查询</div>
      ) : customInvalid ? (
        <div className="flex h-56 items-center justify-center text-xs text-destructive">开始时间不能晚于结束时间</div>
      ) : empty ? (
        <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">暂无数据</div>
      ) : (
        <div className="w-full min-w-0 overflow-hidden">
          <ChartRenderer
            type={type.replace('page-chart-', '') as ChartKind}
            categories={isSeries ? seriesRows.map((r) => String(r.name)) : singleRows.map((r) => r.name)}
            series={isSeries
              ? seriesList.map((s) => ({ name: s, values: seriesRows.map((r) => Number(r[s]) || 0) }))
              : [{ name: 'value', values: singleRows.map((r) => r.value) }]}
            pieData={singleRows}
            height={260}
          />
        </div>
      )}
    </div>
  );
}