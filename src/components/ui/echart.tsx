import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, RadarChart, FunnelChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, RadarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart, LineChart, PieChart, RadarChart, FunnelChart,
  GridComponent, TooltipComponent, LegendComponent, RadarComponent,
  CanvasRenderer,
]);

export type ChartKind = 'bar' | 'line' | 'area' | 'hbar' | 'pie' | 'radar' | 'funnel';

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface PieDatum {
  name: string;
  value: number;
}

interface Props {
  type: ChartKind;
  categories?: string[];
  series?: ChartSeries[];
  pieData?: PieDatum[];
  height?: number;
}

/** 从 CSS 设计变量读取颜色（light/dark 自动跟随） */
function cssVar(name: string): string {
  if (typeof window === 'undefined') return '';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : '';
}

function palette(): string[] {
  return [
    cssVar('--chart-1'), cssVar('--chart-2'), cssVar('--chart-3'),
    cssVar('--chart-4'), cssVar('--chart-5'), cssVar('--primary'),
  ].filter(Boolean);
}

function buildOption(type: ChartKind, categories: string[], series: ChartSeries[], pieData: PieDatum[]): echarts.EChartsCoreOption {
  const colors = palette();
  const textColor = cssVar('--muted-foreground') || '#666';
  const borderColor = cssVar('--border') || '#eee';
  const axisStyle = {
    axisLine: { lineStyle: { color: borderColor } },
    axisLabel: { color: textColor, fontSize: 11 },
    splitLine: { lineStyle: { color: borderColor, type: 'dashed' as const } },
  };

  if (type === 'pie') {
    return {
      color: colors,
      tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#e5e5e5', textStyle: { color: '#333' } },
      legend: { bottom: 0, textStyle: { color: textColor, fontSize: 11 } },
      series: [{
        type: 'pie',
        radius: ['35%', '62%'],
        center: ['50%', '44%'],
        data: pieData,
        label: { color: textColor, fontSize: 11 },
        emphasis: { disabled: true },
      }],
    };
  }

  if (type === 'funnel') {
    return {
      color: colors,
      tooltip: { trigger: 'item', formatter: '{b}: {c}', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#e5e5e5', textStyle: { color: '#333' } },
      series: [{
        type: 'funnel',
        left: '8%', right: '8%', top: 8, bottom: 8,
        data: pieData,
        label: { color: '#fff', fontSize: 11, position: 'inside' },
        emphasis: { disabled: true },
      }],
    };
  }

  if (type === 'radar') {
    const max = Math.max(1, ...series.flatMap((s) => s.values), ...pieData.map((d) => d.value));
    const radarSeries = series.length > 0
      ? series.map((s, i) => ({ value: s.values, name: s.name, areaStyle: { opacity: 0.3 }, lineStyle: { color: colors[i % colors.length] }, itemStyle: { color: colors[i % colors.length] } }))
      : [{ value: pieData.map((d) => d.value), name: 'value', areaStyle: { opacity: 0.3 }, lineStyle: { color: colors[0] }, itemStyle: { color: colors[0] } }];
    return {
      color: colors,
      tooltip: { backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#e5e5e5', textStyle: { color: '#333' } },
      legend: series.length > 1 ? { bottom: 0, textStyle: { color: textColor, fontSize: 11 } } : undefined,
      radar: {
        indicator: categories.map((c) => ({ name: c, max: max * 1.2 })),
        axisName: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: borderColor } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: borderColor } },
      },
      series: [{ type: 'radar', data: radarSeries, emphasis: { disabled: true } }],
    };
  }

  const isHbar = type === 'hbar';
  const isArea = type === 'area';
  const isLine = type === 'line' || isArea;
  const multi = series.length > 1;
  const seriesData = series.map((s, i) => ({
    name: s.name,
    type: isLine ? 'line' : 'bar',
    data: s.values,
    smooth: isLine,
    symbolSize: isLine ? 5 : 0,
    areaStyle: isArea ? { opacity: 0.18 } : undefined,
    itemStyle: type === 'bar' ? { borderRadius: [4, 4, 0, 0] } : isHbar ? { borderRadius: [0, 4, 4, 0] } : undefined,
    color: colors[i % colors.length],
    emphasis: { disabled: true },
  }));

  return {
    color: colors,
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#e5e5e5', textStyle: { color: '#333' } },
    legend: multi ? { bottom: 0, textStyle: { color: textColor, fontSize: 11 } } : undefined,
    grid: { left: 40, right: 16, top: 16, bottom: multi ? 36 : 24, containLabel: true },
    xAxis: isHbar
      ? { type: 'value', ...axisStyle }
      : { type: 'category', data: categories, ...axisStyle },
    yAxis: isHbar
      ? { type: 'category', data: categories, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, width: 72, overflow: 'truncate' as const } }
      : { type: 'value', ...axisStyle },
    series: seriesData,
  };
}

/** 基于 ECharts 的通用图表渲染器：按需加载 + 设计 Token 主题注入 */
export function ChartRenderer({ type, categories = [], series = [], pieData = [], height = 260 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);

  const option = useMemo(
    () => buildOption(type, categories, series, pieData),
    [type, categories, series, pieData],
  );

  useEffect(() => {
    if (!ref.current) return;
    const inst = echarts.init(ref.current);
    instRef.current = inst;
    inst.setOption(option);
    let lastW = ref.current.offsetWidth;
    let lastH = ref.current.offsetHeight;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      const el = ref.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // 尺寸未实际变化时跳过，避免 tooltip 等触发的微抖动
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => inst.resize(), 100);
    });
    ro.observe(ref.current);
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      inst.dispose();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    instRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}