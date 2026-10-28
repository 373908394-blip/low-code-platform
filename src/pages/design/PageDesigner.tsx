import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { MetaForm, PageField, FormField, TextSourceConfig, TextColumnConfig } from '@/types';
import { PAGE_FIELD_CATALOG, ensureSystemFields } from '@/lib/field-catalog';
import { nextAutoSlug } from '@/lib/slug';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import DesignerDataPreview from '@/pages/components/DesignerDataPreview';
import DataRangeSelector from '@/pages/components/DataRangeSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Calendar, CalendarClock, CalendarRange, Clock, Search, FileText, CalendarDays,
  BarChart3, LineChart, AreaChart, BarChartHorizontal, PieChart, Radar, Filter,
  Save, Rocket, Loader2, ChevronLeft, Plus, Trash2, GripVertical, ArrowUp, ArrowDown,
  Heading, Columns3, Layout, Minus, Info, Calculator, Sigma, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import RelationFilterEditor from './props/RelationFilterEditor';
import TextSourceEditor from './props/TextSourceEditor';

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
  'page-group-title': Heading,
  'page-grid': Columns3,
  'page-layout': Layout,
  'page-divider': Minus,
  'page-description': Info,
  'page-summary': Calculator,
  'page-formula': Sigma,
  'page-action-button': Zap,
};

const CHART_LABEL: Record<string, string> = {
  'page-chart-bar': '柱状图',
  'page-chart-line': '曲线图',
  'page-chart-area': '面积图',
  'page-chart-hbar': '条形图',
  'page-chart-pie': '饼图',
  'page-chart-radar': '雷达图',
  'page-chart-funnel': '漏斗图',
};
const CHART_TYPES = Object.keys(CHART_LABEL);

/** 单页设计器：配置筛选组件、查询表单与文本显示组件（无增删改） */
export default function PageDesigner({ embedded }: { embedded?: boolean }) {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [form, setForm] = useState<MetaForm | null>(null);
  const [fields, setFields] = useState<PageField[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [allForms, setAllForms] = useState<Pick<MetaForm, 'id' | 'name' | 'schema_json'>[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [activeGridCol, setActiveGridCol] = useState(0);
  /** page-layout：选中的列索引 + 选中的子组件 id */
  const [activeLayoutCol, setActiveLayoutCol] = useState(0);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const setPubState = (v: boolean) => {
    setPublishing(v);
    if (embedded) window.dispatchEvent(new CustomEvent('designer-publishing', { detail: v }));
  };

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    const [fRes, listRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle(),
      supabase.from('meta_forms').select('id, name, schema_json').order('name'),
    ]);
    if (fRes.data) {
      const f = fRes.data as MetaForm;
      setForm(f);
      const rawFields = ((f.list_config as unknown as { pageFields?: PageField[] })?.pageFields ?? []) as PageField[];
      const normalized = rawFields.map((field) => {
        if (field.type === 'page-grid') {
          const cols = field.layout?.columns ?? (field.gridColumns?.length || 2);
          const curCols = field.gridColumns ?? [];
          const gridColumns = Array.from({ length: cols }).map((_, i) => {
            const old = curCols[i];
            if (!old) return { title: `第 ${i + 1} 栏`, formId: '', fieldKey: '', aggregate: 'first' as const, dataRange: 'permission' as const, defaultValue: '' };
            // 兼容旧结构：{ title, source: TextSourceConfig } → 直接展开为 TextSourceConfig
            const { title, source, ...rest } = old as unknown as Record<string, unknown>;
            const base = (source ?? rest) as Record<string, unknown>;
            return { title: title as string | undefined, ...(base as object) } as TextColumnConfig;
          });
          return {
            ...field,
            layout: { ...field.layout, text: field.layout?.text ?? field.label ?? '分栏布局', columns: cols },
            gridColumns,
          };
        }
        return field;
      });
      setFields(normalized);
    }
    setAllForms((listRes.data as Pick<MetaForm, 'id' | 'name' | 'schema_json'>[]) ?? []);
    setLoading(false);
  }, [formId]);

  useEffect(() => { load(); }, [load]);

  // 监听父级发布事件（嵌入模式下父级按钮触发）
  useEffect(() => {
    const h = () => { publish(); };
    window.addEventListener('designer-publish', h);
    return () => window.removeEventListener('designer-publish', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, formId, fields]);

  /** 若选中了 page-layout 的子组件，返回子组件；否则返回顶层组件 */
  const selChild = selectedChildId
    ? fields.flatMap((f) => (f.layoutColumns?.children ?? []).flat()).find((c) => c.id === selectedChildId) ?? null
    : null;
  const sel = selChild ?? fields.find((f) => f.id === selected) ?? null;

  const addField = (type: PageField['type']) => {
    const def = PAGE_FIELD_CATALOG.flatMap((c) => c.fields).find((d) => d.type === type);
    if (!def) return;
    const idx = fields.length + 1;
    // 自由布局：新组件放置在画布左上角，按序号错开
    const px = 24 + ((fields.length % 4) * 24);
    const py = 24 + (fields.length * 12);
    const f: PageField = {
      id: `pf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      label: `${def.label}${idx}`,
      key: `page_${idx}`,
      span: def.span,
      x: px,
      y: py,
      ...(type === 'page-query' ? { query: { formId: '', displayFields: [], conditions: [], manualFilters: [], dataRange: 'permission' as const } } : {}),
      ...(type === 'page-text-display' ? { dataSource: { formId: '', fieldKey: '', aggregate: 'first', dataRange: 'permission', defaultValue: '' } } : {}),
      ...(CHART_TYPES.includes(type) ? { chart: { formId: '', groupBy: 'field' as const, valueAgg: 'count' as const, timeGranularity: 'month' as const, timeGranularities: ['month'] as const, dataRange: 'permission' as const } } : {}),
      ...(type === 'page-summary' ? { summary: { formId: '', fieldKey: '', aggregate: 'count' as const } } : {}),
      ...(type === 'page-formula' ? { formula: { expression: '' } } : {}),
      ...(type === 'page-action-button' ? { action: { label: '按钮', type: 'navigate' as const, targetPath: '' } } : {}),
      ...(type === 'page-group-title' ? { layout: { text: '分组标题', size: 'h2' as const } } : {}),
      ...(type === 'page-description' ? { layout: { text: '说明文字', size: 'normal' as const } } : {}),
      ...(type === 'page-grid' ? { layout: { text: def.label, columns: 2 }, gridColumns: [
        { title: '第 1 栏', formId: '', fieldKey: '', aggregate: 'first' as const, dataRange: 'permission' as const, defaultValue: '' },
        { title: '第 2 栏', formId: '', fieldKey: '', aggregate: 'first' as const, dataRange: 'permission' as const, defaultValue: '' },
      ] } : {}),
      ...(type === 'page-layout' ? { layoutColumns: { count: 2 as const, children: [[], []] } } : {}),
    };
    // 若当前选中 page-layout 的子组件或 page-layout 本身，添加到其子组件列表
    const selField = fields.find((x) => x.id === selected);
    const layoutField = selField?.type === 'page-layout' ? selField
      : selField?.type !== undefined && fields.find((x) => x.type === 'page-layout' && (x.layoutColumns?.children ?? []).some((col) => col.some((c) => c.id === selectedChildId)))
        ? fields.find((x) => x.type === 'page-layout' && (x.layoutColumns?.children ?? []).some((col) => col.some((c) => c.id === selectedChildId)))
        : null;
    if (layoutField && type !== 'page-layout') {
      const colIdx = activeLayoutCol;
      setFields((s) => s.map((x) => {
        if (x.id !== layoutField.id) return x;
        const children = x.layoutColumns?.children ?? [];
        const newChildren = Array.from({ length: x.layoutColumns?.count ?? 2 }).map((_, i) => children[i] ?? []);
        newChildren[colIdx] = [...(newChildren[colIdx] ?? []), f];
        return { ...x, layoutColumns: { ...x.layoutColumns!, count: x.layoutColumns?.count ?? 2, children: newChildren } };
      }));
      setSelectedChildId(f.id);
    } else {
      setFields((s) => [...s, f]);
      setSelected(f.id);
    }
  };

  const updSel = (patch: Partial<PageField>) => {
    if (!sel) return;
    if (selChild) {
      // 更新 page-layout 子组件
      setFields((s) => s.map((f) => {
        if (!f.layoutColumns?.children) return f;
        const children = f.layoutColumns.children.map((col) => col.map((c) => (c.id === sel.id ? { ...c, ...patch } : c)));
        return { ...f, layoutColumns: { ...f.layoutColumns, children } };
      }));
    } else {
      setFields((s) => s.map((f) => (f.id === sel.id ? { ...f, ...patch } : f)));
    }
  };

  // 标签变更时自动生成拼音标识：标识为空、等于旧标签生成值或为系统默认标识（page_N）时跟随，人工修改后锁定
  const updSelLabel = (label: string) => {
    if (!sel) return;
    const nextKey = nextAutoSlug(label, sel.label, sel.key, /^page_\d+$/);
    updSel(nextKey !== null ? { label, key: nextKey } : { label });
  };

  // 分栏数调整辅助：支持 1-6 栏，平滑扩容或裁剪，并更新每栏配置
  const setGridColumns = (cols: number) => {
    const cur = sel?.gridColumns ?? [];
    const next = Array.from({ length: cols }).map((_, i) =>
      cur[i] ?? { title: `第 ${i + 1} 栏`, formId: '', fieldKey: '', aggregate: 'first' as const, dataRange: 'permission' as const, defaultValue: '' },
    );
    updSel({ layout: { text: sel?.layout?.text ?? sel?.label ?? '分栏布局', columns: cols, size: sel?.layout?.size ?? 'normal' }, gridColumns: next });
    if (activeGridCol >= cols) setActiveGridCol(Math.max(0, cols - 1));
  };

  /** 更新分栏容器中某一栏的配置 */
  const setGridColumn = (index: number, source: TextColumnConfig) => {
    const cols = sel?.layout?.columns ?? (sel?.gridColumns?.length || 2);
    const cur = Array.from({ length: cols }).map((_, i) =>
      sel?.gridColumns?.[i] ?? { title: `第 ${i + 1} 栏`, formId: '', fieldKey: '', aggregate: 'first' as const, dataRange: 'permission' as const, defaultValue: '' },
    );
    cur[index] = source;
    updSel({ gridColumns: cur });
  };

  const move = (id: string, dir: -1 | 1) => {
    setFields((s) => {
      const i = s.findIndex((f) => f.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };

  /** 拖拽排序：将 fromId 组件移动到 toId 组件的位置 */
  const reorderFields = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setFields((s) => {
      const from = s.findIndex((f) => f.id === fromId);
      const to = s.findIndex((f) => f.id === toId);
      if (from < 0 || to < 0) return s;
      const n = [...s];
      const [moved] = n.splice(from, 1);
      n.splice(to, 0, moved);
      return n;
    });
  };

  const removeField = (id: string) => {
    setFields((s) => s.filter((f) => f.id !== id));
    if (selected === id) setSelected(null);
  };

  /** page-layout 内子组件排序 */
  const reorderChildInLayout = (layoutId: string, colIdx: number, fromId: string, toId: string) => {
    if (fromId === toId) return;
    setFields((s) => s.map((f) => {
      if (f.id !== layoutId) return f;
      const children = f.layoutColumns?.children ?? [];
      const col = [...(children[colIdx] ?? [])];
      const from = col.findIndex((c) => c.id === fromId);
      const to = col.findIndex((c) => c.id === toId);
      if (from < 0 || to < 0) return f;
      const [moved] = col.splice(from, 1);
      col.splice(to, 0, moved);
      const newChildren = Array.from({ length: f.layoutColumns?.count ?? 2 }).map((_, i) => children[i] ?? []);
      newChildren[colIdx] = col;
      return { ...f, layoutColumns: { ...f.layoutColumns!, count: f.layoutColumns?.count ?? 2, children: newChildren } };
    }));
  };

  /** page-layout 内删除子组件 */
  const removeChildFromLayout = (layoutId: string, colIdx: number, childId: string) => {
    setFields((s) => s.map((f) => {
      if (f.id !== layoutId) return f;
      const children = f.layoutColumns?.children ?? [];
      const newChildren = Array.from({ length: f.layoutColumns?.count ?? 2 }).map((_, i) => children[i] ?? []);
      newChildren[colIdx] = (newChildren[colIdx] ?? []).filter((c) => c.id !== childId);
      return { ...f, layoutColumns: { ...f.layoutColumns!, count: f.layoutColumns?.count ?? 2, children: newChildren } };
    }));
    if (selectedChildId === childId) setSelectedChildId(null);
  };

  const save = async (silent = false) => {
    if (!form || !formId) return;
    setSaving(true);
    const nextVersion = (form.version ?? 0) + 1;
    const { error, count } = await supabase.from('meta_forms').update({
      list_config: { pageFields: fields } as unknown as MetaForm['list_config'],
      version: nextVersion,
      updated_at: new Date().toISOString(),
    }, { count: 'exact' }).eq('id', formId);
    setSaving(false);
    if (error) return toast.error('保存失败：' + error.message);
    if ((count ?? 0) === 0) return toast.error('保存失败：无权限或表单不存在');
    setForm((prev) => (prev ? { ...prev, version: nextVersion, list_config: { pageFields: fields } as unknown as MetaForm['list_config'] } : prev));
    if (!silent) toast.success('单页已保存（v' + nextVersion + '）');
  };

  const publish = async () => {
    if (!form || !formId) return;
    await save(true);
    setPubState(true);
    const newVer = (form.version ?? 0) + 1;
    const { error: pubErr, count: pubCount } = await supabase.from('meta_forms').update({
      published_version: newVer,
      status: 'published',
    }, { count: 'exact' }).eq('id', formId);
    if (pubErr) { setPubState(false); return toast.error('发布失败：' + pubErr.message); }
    if ((pubCount ?? 0) === 0) { setPubState(false); return toast.error('发布失败：无权限或表单不存在'); }
    await supabase.from('meta_version').insert({
      tenant_id: tenantId, form_id: formId, version: newVer,
      snapshot: { pageFields: fields } as unknown as Record<string, unknown>,
      changelog: `发布 v${newVer} · ${fields.length} 个组件`,
      created_by: profile?.id ?? null,
    });
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId, user_id: profile?.id, user_name: profile?.name,
      action: '发布单页', target: `${form.name} v${newVer}`, detail: { form: form.code, version: newVer },
    });
    setPubState(false);
    setForm((prev) => (prev ? { ...prev, version: newVer, published_version: newVer, status: 'published' as const, list_config: { pageFields: fields } as unknown as MetaForm['list_config'] } : prev));
    toast.success(`已发布 v${newVer}，运行时立即生效`);
  };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!form) return <div className="p-8 text-center text-muted-foreground">单页不存在</div>;

  const targetFieldOptions = (formId2: string): { key: string; label: string; type?: string }[] => {
    const target = allForms.find((f) => f.id === formId2);
    // 补齐系统字段，使状态/创建人/创建时间等系统默认字段可被选择
    const fs = ensureSystemFields((target?.schema_json?.fields ?? []) as FormField[]);
    return fs
      .filter((f) => !['group-title', 'grid', 'divider', 'description', 'action-button'].includes(f.type))
      .map((f) => ({ key: f.key, label: f.system ? `${f.label}（系统）` : f.label, type: f.type }));
  };

  return (
    <div className={cn('flex', embedded ? 'h-full' : 'h-[calc(100vh-3.5rem)]')}>
      {/* 左：组件库（纯白背景） */}
      <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border bg-white overflow-y-auto">
        <div className="px-4 py-3.5 border-b border-border sticky top-0 bg-white z-10">
          <p className="text-sm font-semibold">单页组件</p>
          <p className="text-xs text-muted-foreground mt-0.5">点击添加到画布</p>
        </div>
        <div className="p-3 space-y-3">
            {PAGE_FIELD_CATALOG.map((cat) => (
              <div key={cat.key} className="space-y-1.5">
                <p className="px-0.5 text-[11px] font-medium text-muted-foreground">{cat.label}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {cat.fields.map((def) => {
                    const Icon = PAGE_ICON_MAP[def.type] ?? FileText;
                    return (
                      <button
                        key={def.type}
                        type="button"
                        onClick={() => addField(def.type)}
                        className="flex flex-col items-center gap-1.5 rounded-md border border-border bg-card py-2.5 px-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                      >
                        <Icon className="h-4 w-4" />
                        <span className="truncate w-full text-center">{def.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
      </aside>

      {/* 中：画布 */}
      <div className="flex-1 min-w-0 flex flex-col bg-muted/30 overflow-y-auto">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-white border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            {!embedded && (
              <>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/design/apps')}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-semibold truncate">{form.name} · 单页设计</span>
                <Badge className="bg-muted text-muted-foreground hover:bg-muted shrink-0">v{form.version}{form.status === 'published' ? ` · 已发布 v${form.published_version}` : ' · 草稿'}</Badge>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => save()} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}保存</Button>
            {!embedded && <Button size="sm" className="h-8" onClick={publish} disabled={publishing}>{publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}发布</Button>}
          </div>
        </div>

        <div className="p-4 md:p-6">
          <div className="mx-auto max-w-3xl bg-card border border-border rounded-lg shadow-sm">
            <div className="px-6 py-5 border-b border-border">
              <p className="text-base font-semibold">{form.name}</p>
              <p className="text-xs text-muted-foreground mt-1">共 {fields.length} 个组件 · 拖动可调整顺序</p>
            </div>
            <div className="p-6">
              {fields.length === 0 ? (
                <div className="border border-dashed border-border rounded-md py-16 flex flex-col items-center gap-2 text-muted-foreground">
                  <Plus className="h-6 w-6" />
                  <span className="text-sm">从左侧添加筛选组件、查询表单或文本显示组件</span>
                </div>
              ) : (
                <div className="grid grid-cols-24 gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                  {fields.map((f) => {
                    const active = selected === f.id;
                    return (
                      <div key={f.id} style={{ gridColumn: `span ${f.span ?? 12} / span ${f.span ?? 12}` }} className="min-w-0">
                        <div
                          draggable
                          onDragStart={(e) => { e.stopPropagation(); setDragId(f.id); }}
                          onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== f.id) setOverId(f.id); }}
                          onDragLeave={() => setOverId((o) => (o === f.id ? null : o))}
                          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId) reorderFields(dragId, f.id); setDragId(null); setOverId(null); }}
                          onDragEnd={() => { setDragId(null); setOverId(null); }}
                          onClick={() => setSelected(f.id)}
                          className={cn(
                            'group relative rounded-md border px-3.5 py-3 transition-all cursor-pointer',
                            active ? 'border-primary ring-1 ring-primary/30 bg-primary/[0.03]' : 'border-border hover:border-primary/40 bg-card',
                            dragId === f.id && 'opacity-40',
                            overId === f.id && dragId && dragId !== f.id && 'ring-2 ring-primary/60 border-primary',
                          )}
                        >
                          {active && (
                            <span className="absolute -top-2.5 right-2 z-10 flex gap-0.5">
                              <button type="button" title="上移" className="h-5 w-5 flex items-center justify-center rounded bg-primary text-primary-foreground" onClick={(e) => { e.stopPropagation(); move(f.id, -1); }}><ArrowUp className="h-3 w-3" /></button>
                              <button type="button" title="下移" className="h-5 w-5 flex items-center justify-center rounded bg-primary text-primary-foreground" onClick={(e) => { e.stopPropagation(); move(f.id, 1); }}><ArrowDown className="h-3 w-3" /></button>
                              <button type="button" title="删除" className="h-5 w-5 flex items-center justify-center rounded bg-destructive text-destructive-foreground" onClick={(e) => { e.stopPropagation(); removeField(f.id); }}><Trash2 className="h-3 w-3" /></button>
                            </span>
                          )}
                          <GripVertical className="absolute left-1 top-3.5 h-3.5 w-3.5 text-muted-foreground/40 cursor-grab active:cursor-grabbing" />
                          {f.type !== 'page-group-title' && f.type !== 'page-divider' && f.type !== 'page-description' && f.type !== 'page-grid' && (
                            <p className="text-[10px] text-muted-foreground/70 mb-1 truncate">{f.label}</p>
                          )}
                          <DesignerDataPreview
                            field={f}
                            allForms={allForms}
                            activeGridCol={selected === f.id ? activeGridCol : undefined}
                            onSelectGridCol={(idx) => {
                              setSelected(f.id);
                              setActiveGridCol(idx);
                            }}
                          />
                          {/* page-layout：渲染子组件拖放区 */}
                          {f.type === 'page-layout' && (() => {
                            const count = f.layoutColumns?.count ?? 2;
                            const childrenArr = f.layoutColumns?.children ?? [];
                            return (
                              <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
                                {Array.from({ length: count }).map((_, colIdx) => {
                                  const colChildren = childrenArr[colIdx] ?? [];
                                  const isColActive = selected === f.id && activeLayoutCol === colIdx;
                                  return (
                                    <div
                                      key={colIdx}
                                      onClick={(e) => { e.stopPropagation(); setSelected(f.id); setActiveLayoutCol(colIdx); }}
                                      className={cn(
                                        'rounded border p-2 min-h-20 space-y-2 transition-all',
                                        isColActive ? 'border-primary ring-1 ring-primary/30 bg-primary/[0.03]' : 'border-dashed border-border/80 bg-muted/10',
                                      )}
                                    >
                                      <p className="text-[10px] text-muted-foreground/70">{isColActive ? `第 ${colIdx + 1} 列（点击左侧添加组件）` : `第 ${colIdx + 1} 列`}</p>
                                      {colChildren.map((child) => (
                                        <div
                                          key={child.id}
                                          draggable
                                          onDragStart={(e) => { e.stopPropagation(); setDragId(child.id); }}
                                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId && dragId !== child.id) setOverId(child.id); }}
                                          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId) { reorderChildInLayout(f.id, colIdx, dragId, child.id); } setDragId(null); setOverId(null); }}
                                          onDragEnd={() => { setDragId(null); setOverId(null); }}
                                          onClick={(e) => { e.stopPropagation(); setSelectedChildId(child.id); setSelected(f.id); setActiveLayoutCol(colIdx); }}
                                          className={cn(
                                            'relative rounded border px-2 py-1.5 cursor-pointer transition-all',
                                            selectedChildId === child.id ? 'border-primary ring-1 ring-primary/30 bg-primary/[0.03]' : 'border-border bg-card hover:border-primary/40',
                                            dragId === child.id && 'opacity-40',
                                            overId === child.id && dragId && dragId !== child.id && 'ring-2 ring-primary/60 border-primary',
                                          )}
                                        >
                                          <p className="text-[10px] text-muted-foreground/70 mb-0.5 truncate">{child.label}</p>
                                          <DesignerDataPreview field={child} allForms={allForms} />
                                          {selectedChildId === child.id && (
                                            <span className="absolute -top-2 -right-2 z-10 flex gap-0.5">
                                              <button type="button" title="删除" className="h-4 w-4 flex items-center justify-center rounded bg-destructive text-destructive-foreground" onClick={(e) => { e.stopPropagation(); removeChildFromLayout(f.id, colIdx, child.id); }}><Trash2 className="h-2.5 w-2.5" /></button>
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                      {colChildren.length === 0 && (
                                        <div className="flex items-center justify-center py-4 text-muted-foreground/40">
                                          <Plus className="h-4 w-4" />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 右：属性面板（纯白背景） */}
      <aside className="hidden md:flex w-80 shrink-0 flex-col border-l border-border bg-white overflow-y-auto">
        <div className="px-4 py-3.5 border-b border-border sticky top-0 bg-white z-10">
          <p className="text-sm font-semibold">属性配置</p>
          <p className="text-xs text-muted-foreground mt-0.5">{sel ? sel.label : '选择组件以配置属性'}</p>
        </div>
        <div className="p-4 space-y-4">
          {sel && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">组件标签</Label>
                <Input
                  className="h-8 text-xs px-2"
                  value={sel.label}
                  onCompositionEnd={(e) => { updSelLabel((e.target as HTMLInputElement).value); }}
                  onChange={(e) => { if ((e.nativeEvent as InputEvent).isComposing) return; updSelLabel(e.target.value); }}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">组件标识</Label>
                <Input className="h-8 text-xs px-2 font-mono" value={sel.key} onChange={(e) => updSel({ key: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">字段宽度（栅格 /24）</Label>
                <div className="flex gap-1.5">
                  {[6, 8, 12, 24].map((w) => (
                    <button key={w} type="button" onClick={() => updSel({ span: w })} className={cn('flex-1 h-8 rounded-md border text-xs transition-colors', (sel.span ?? 12) === w ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border hover:bg-muted/60')}>
                      {w === 24 ? '整行' : `${w}/24`}
                    </button>
                  ))}
                </div>
              </div>

              {sel.type === 'page-query' && (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-xs font-medium">查询表单设置</p>
                  <div className="space-y-1">
                    <Label className="text-xs">关联表单</Label>
                    <Select value={sel.query?.formId || 'none'} onValueChange={(v) => updSel({ query: { formId: v === 'none' ? '' : v, displayFields: [], conditions: [], manualFilters: [] } })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择目标表单" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">未选择</SelectItem>
                        {allForms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {sel.query?.formId && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs">展示字段</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {targetFieldOptions(sel.query.formId).map((o) => {
                            const checked = (sel.query?.displayFields ?? []).includes(o.key);
                            return (
                              <button key={o.key} type="button" onClick={() => {
                                const cur = sel.query?.displayFields ?? [];
                                updSel({ query: { formId: sel.query!.formId, displayFields: checked ? cur.filter((x) => x !== o.key) : [...cur, o.key], conditions: sel.query?.conditions ?? [], manualFilters: sel.query?.manualFilters ?? [] } });
                              }} className={cn('h-6 rounded border px-2 text-[11px] transition-colors', checked ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                                {o.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">数据范围</Label>
                        <DataRangeSelector value={sel.query?.dataRange ?? 'all'} onChange={(v) => updSel({ query: { formId: sel.query!.formId, displayFields: sel.query?.displayFields ?? [], dataRange: v, conditions: sel.query?.conditions ?? [], manualFilters: sel.query?.manualFilters ?? [] } })} />
                        <p className="text-[10px] text-muted-foreground/60">限制查询结果的数据来源范围</p>
                      </div>
                      <RelationFilterEditor
                        fieldOptions={targetFieldOptions(sel.query.formId)}
                        conditions={sel.query?.conditions ?? []}
                        conditionsLogic={sel.query?.conditionsLogic ?? 'and'}
                        manualFilters={sel.query?.manualFilters ?? []}
                        manualFiltersLogic={sel.query?.manualFiltersLogic ?? 'and'}
                        onUpdate={(patch) => updSel({ query: { formId: sel.query!.formId, displayFields: sel.query?.displayFields ?? [], dataRange: sel.query?.dataRange ?? 'all', conditions: patch.conditions ?? sel.query?.conditions ?? [], conditionsLogic: patch.conditionsLogic ?? sel.query?.conditionsLogic ?? 'and', manualFilters: patch.manualFilters ?? sel.query?.manualFilters ?? [], manualFiltersLogic: patch.manualFiltersLogic ?? sel.query?.manualFiltersLogic ?? 'and' } })}
                      />
                    </>
                  )}
                </div>
              )}

              {sel.type === 'page-leave-info' && (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-xs font-medium">我的请假信息-年假 列表设置</p>
                  <div className="space-y-1">
                    <Label className="text-xs">关联请假表单</Label>
                    <Select value={sel.leaveList?.formId || 'none'} onValueChange={(v) => updSel({ leaveList: { formId: v === 'none' ? '' : v, displayFields: [], conditions: [] } })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择请假表单" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">未选择</SelectItem>
                        {allForms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {sel.leaveList?.formId && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs">展示字段</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {[{ key: '__no', label: '请假编号' }, { key: 'status', label: '状态' }, ...targetFieldOptions(sel.leaveList.formId)].map((o) => {
                            const checked = (sel.leaveList?.displayFields ?? []).includes(o.key);
                            return (
                              <button key={o.key} type="button" onClick={() => {
                                const cur = sel.leaveList?.displayFields ?? [];
                                updSel({ leaveList: { formId: sel.leaveList!.formId, displayFields: checked ? cur.filter((x) => x !== o.key) : [...cur, o.key], conditions: sel.leaveList?.conditions ?? [] } });
                              }} className={cn('h-6 rounded border px-2 text-[11px] transition-colors', checked ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                                {o.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <RelationFilterEditor
                        fieldOptions={targetFieldOptions(sel.leaveList.formId)}
                        conditions={sel.leaveList?.conditions ?? []}
                        conditionsLogic={sel.leaveList?.conditionsLogic ?? 'and'}
                        manualFilters={[]}
                        onUpdate={(patch) => updSel({ leaveList: { formId: sel.leaveList!.formId, displayFields: sel.leaveList?.displayFields ?? [], conditions: patch.conditions ?? sel.leaveList?.conditions ?? [], conditionsLogic: patch.conditionsLogic ?? sel.leaveList?.conditionsLogic ?? 'and' } })}
                      />
                    </>
                  )}
                </div>
              )}

              {sel.type === 'page-text-display' && (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-xs font-medium">文本显示设置</p>
                  <TextSourceEditor
                    source={sel.dataSource ?? { formId: '', fieldKey: '', aggregate: 'first', dataRange: 'permission', defaultValue: '' }}
                    forms={allForms}
                    fieldOptions={targetFieldOptions}
                    onChange={(next) => updSel({ dataSource: next })}
                  />
                </div>
              )}

              {CHART_TYPES.includes(sel.type) && (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-xs font-medium">{CHART_LABEL[sel.type]}设置</p>
                  <div className="space-y-1">
                    <Label className="text-xs">关联表单</Label>
                    {sel.type === 'page-chart-funnel' ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-muted-foreground/70">选择多个表单，每个表单为一层漏斗维度，可拖拽调整顺序、独立配置</p>
                        {/* 添加表单 */}
                        <Select
                          value="add"
                          onValueChange={(v) => {
                            if (v === 'add') return;
                            const current = sel.chart?.formLayers ?? [];
                            if (current.some((l) => l.formId === v)) return;
                            updSel({ chart: { ...(sel.chart ?? { groupBy: 'field' as const, valueAgg: 'count' as const, timeGranularity: 'month' as const, timeGranularities: ['month'] as const }), formLayers: [...current, { formId: v }], formId: current[0]?.formId ?? v } });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ 添加表单层" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="add" disabled>+ 添加表单层</SelectItem>
                            {allForms.filter((f) => !(sel.chart?.formLayers ?? []).some((l) => l.formId === f.id)).map((f) => (
                              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {/* 已选层级列表 */}
                        {(sel.chart?.formLayers ?? []).length > 0 && (
                          <div className="space-y-1">
                            {(sel.chart?.formLayers ?? []).map((layer, idx) => {
                              const form = allForms.find((f) => f.id === layer.formId);
                              return (
                                <div key={layer.formId} className="rounded-md border border-border p-2 space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-muted-foreground shrink-0 w-4">{idx + 1}.</span>
                                    <span className="text-xs font-medium flex-1 truncate">{form?.name ?? layer.formId}</span>
                                    <button
                                      type="button"
                                      className="text-muted-foreground hover:text-foreground text-xs px-1"
                                      onClick={() => {
                                        const next = (sel.chart?.formLayers ?? []).filter((_, i) => i !== idx);
                                        updSel({ chart: { ...sel.chart!, formLayers: next, formId: next[0]?.formId ?? '' } });
                                      }}
                                    >✕</button>
                                    <button
                                      type="button"
                                      className="text-muted-foreground hover:text-foreground text-xs px-1 disabled:opacity-30"
                                      disabled={idx === 0}
                                      onClick={() => {
                                        const layers = [...(sel.chart?.formLayers ?? [])];
                                        [layers[idx - 1], layers[idx]] = [layers[idx], layers[idx - 1]];
                                        updSel({ chart: { ...sel.chart!, formLayers: layers } });
                                      }}
                                    >↑</button>
                                    <button
                                      type="button"
                                      className="text-muted-foreground hover:text-foreground text-xs px-1 disabled:opacity-30"
                                      disabled={idx === (sel.chart?.formLayers ?? []).length - 1}
                                      onClick={() => {
                                        const layers = [...(sel.chart?.formLayers ?? [])];
                                        [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
                                        updSel({ chart: { ...sel.chart!, formLayers: layers } });
                                      }}
                                    >↓</button>
                                  </div>
                                  {/* 每层独立配置 */}
                                  <div className="space-y-1 pl-5">
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px]">层标签</Label>
                                      <Input
                                        className="h-7 text-xs px-2"
                                        placeholder={form?.name ?? ''}
                                        value={layer.label ?? ''}
                                        onChange={(e) => {
                                          const layers = [...(sel.chart?.formLayers ?? [])];
                                          layers[idx] = { ...layers[idx], label: e.target.value };
                                          updSel({ chart: { ...sel.chart!, formLayers: layers } });
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px]">分组字段</Label>
                                      <Select
                                        value={layer.categoryField || 'none'}
                                        onValueChange={(v) => {
                                          const layers = [...(sel.chart?.formLayers ?? [])];
                                          layers[idx] = { ...layers[idx], categoryField: v === 'none' ? '' : v };
                                          updSel({ chart: { ...sel.chart!, formLayers: layers } });
                                        }}
                                      >
                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="按所属表单统计" /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">按所属表单统计</SelectItem>
                                          {targetFieldOptions(layer.formId).map((o) => (
                                            <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px]">统计方式</Label>
                                      <Select
                                        value={layer.valueAgg ?? 'count'}
                                        onValueChange={(v) => {
                                          const layers = [...(sel.chart?.formLayers ?? [])];
                                          layers[idx] = { ...layers[idx], valueAgg: v as 'sum' | 'count' | 'avg' };
                                          updSel({ chart: { ...sel.chart!, formLayers: layers } });
                                        }}
                                      >
                                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="count">统计记录数</SelectItem>
                                          <SelectItem value="sum">求和</SelectItem>
                                          <SelectItem value="avg">平均值</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    {(layer.valueAgg ?? 'count') !== 'count' && (
                                      <div className="space-y-0.5">
                                        <Label className="text-[10px]">数值字段</Label>
                                        <Select
                                          value={layer.valueField || 'none'}
                                          onValueChange={(v) => {
                                            const layers = [...(sel.chart?.formLayers ?? [])];
                                            layers[idx] = { ...layers[idx], valueField: v === 'none' ? '' : v };
                                            updSel({ chart: { ...sel.chart!, formLayers: layers } });
                                          }}
                                        >
                                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="选择数值字段" /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="none">未选择</SelectItem>
                                            {targetFieldOptions(layer.formId).filter((o) => o.type === 'number').map((o) => (
                                              <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    )}
                                    {/* 显示条件（对数据源自动过滤） */}
                                    <div className="space-y-1 pt-1 border-t border-border/60">
                                      <RelationFilterEditor
                                        fieldOptions={targetFieldOptions(layer.formId)}
                                        conditions={layer.conditions ?? []}
                                        conditionsLogic={layer.conditionsLogic ?? 'and'}
                                        manualFilters={[]}
                                        manualFiltersLogic="and"
                                        hideManualFilters
                                        onUpdate={(patch) => {
                                          const layers = [...(sel.chart?.formLayers ?? [])];
                                          layers[idx] = {
                                            ...layers[idx],
                                            conditions: patch.conditions ?? layer.conditions ?? [],
                                            conditionsLogic: patch.conditionsLogic ?? layer.conditionsLogic ?? 'and',
                                          };
                                          updSel({ chart: { ...sel.chart!, formLayers: layers } });
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Select value={sel.chart?.formId || 'none'} onValueChange={(v) => updSel({ chart: { ...(sel.chart ?? { groupBy: 'field' as const, valueAgg: 'count' as const, timeGranularity: 'month' as const, timeGranularities: ['month'] as const }), formId: v === 'none' ? '' : v } })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择目标表单" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未选择</SelectItem>
                          {allForms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {sel.chart?.formId && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">数据范围</Label>
                        <DataRangeSelector value={sel.chart?.dataRange ?? 'all'} onChange={(v) => updSel({ chart: { ...sel.chart!, dataRange: v } })} />
                        <p className="text-[10px] text-muted-foreground/70">{sel.type === 'page-chart-funnel' && (sel.chart?.formLayers?.length ?? 0) > 1 ? '限制所有关联表单的数据来源范围' : '限制图表统计的数据来源范围'}</p>
                      </div>
                      {sel.type === 'page-chart-funnel' && (sel.chart?.formLayers?.length ?? 0) > 1 && (
                        <div className="space-y-1.5 rounded-md border border-border p-2">
                          <Label className="text-xs">按时间筛选（可选）</Label>
                          <Select value={sel.chart?.timeField || 'none'} onValueChange={(v) => updSel({ chart: { ...sel.chart!, timeField: v === 'none' ? '' : v } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择时间字段后启用时间筛选" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">不启用</SelectItem>
                              <SelectItem value="created_at">创建时间（所有表单通用）</SelectItem>
                            </SelectContent>
                          </Select>
                          {sel.chart?.timeField && (
                            <>
                              <div className="flex flex-wrap gap-1.5 pt-0.5">
                                {(['day', 'week', 'month', 'year', 'range'] as const).map((g) => {
                                  const list = sel.chart?.timeGranularities ?? (sel.chart?.timeGranularity ? [sel.chart.timeGranularity] : []);
                                  const checked = list.includes(g);
                                  return (
                                    <button key={g} type="button" onClick={() => {
                                      const cur = sel.chart?.timeGranularities ?? (sel.chart?.timeGranularity ? [sel.chart.timeGranularity] : []);
                                      const next = checked ? cur.filter((x) => x !== g) : [...cur, g];
                                      updSel({ chart: { ...sel.chart!, timeGranularities: next.length > 0 ? next : ['month'] } });
                                    }} className={cn('rounded-md border px-2 py-1 text-[11px] transition-colors', checked ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                                      {g === 'day' ? '按天' : g === 'week' ? '按周' : g === 'month' ? '按月' : g === 'year' ? '按年' : '自定义'}
                                    </button>
                                  );
                                })}
                              </div>
                              <p className="text-[10px] text-muted-foreground/70">对所有关联表单生效：仅统计所选时间范围内的记录，运行时可切换粒度/自定义范围</p>
                            </>
                          )}
                        </div>
                      )}
                      {!(sel.type === 'page-chart-funnel' && (sel.chart?.formLayers?.length ?? 0) > 1) && (
                      <div className="space-y-1">
                        <Label className="text-xs">统计方式</Label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {([['field', '按字段统计'], ['time', '按时间统计']] as const).map(([val, label]) => (
                            <button key={val} type="button" onClick={() => updSel({ chart: { ...sel.chart!, groupBy: val } })}
                              className={cn('rounded-md border px-2 py-1.5 text-[11px] transition-colors text-left', (sel.chart?.groupBy ?? 'field') === val ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      )}

                      {!(sel.type === 'page-chart-funnel' && (sel.chart?.formLayers?.length ?? 0) > 1) && ((sel.chart?.groupBy ?? 'field') === 'field' ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label className="text-xs">分组字段（按每个值统计）</Label>
                            <Select value={sel.chart?.categoryField || 'none'} onValueChange={(v) => updSel({ chart: { ...sel.chart!, categoryField: v === 'none' ? '' : v } })}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="如：请假类型、部门" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">未选择</SelectItem>
                                {targetFieldOptions(sel.chart.formId).map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <p className="text-[10px] text-muted-foreground/70">选择一个下拉/单选字段，图表将按该字段的每个取值分别统计</p>
                          </div>
                          {/* 按字段统计叠加时间筛选：与按时间统计共用同一套时间筛选配置 */}
                          <div className="space-y-1.5 rounded-md border border-border p-2">
                            <Label className="text-xs">按时间筛选（可选）</Label>
                            <Select value={sel.chart?.timeField || 'none'} onValueChange={(v) => updSel({ chart: { ...sel.chart!, timeField: v === 'none' ? '' : v } })}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择时间字段后启用时间筛选" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">不启用</SelectItem>
                                {targetFieldOptions(sel.chart.formId).map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {sel.chart?.timeField && (
                              <>
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  {(['day', 'week', 'month', 'year', 'range'] as const).map((g) => {
                                    const list = sel.chart?.timeGranularities ?? (sel.chart?.timeGranularity ? [sel.chart.timeGranularity] : []);
                                    const checked = list.includes(g);
                                    return (
                                      <button key={g} type="button" onClick={() => {
                                        const cur = sel.chart?.timeGranularities ?? (sel.chart?.timeGranularity ? [sel.chart.timeGranularity] : []);
                                        const next = checked ? cur.filter((x) => x !== g) : [...cur, g];
                                        updSel({ chart: { ...sel.chart!, timeGranularities: next.length > 0 ? next : ['month'] } });
                                      }} className={cn('rounded-md border px-2 py-1 text-[11px] transition-colors', checked ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                                        {g === 'day' ? '按天' : g === 'week' ? '按周' : g === 'month' ? '按月' : g === 'year' ? '按年' : '自定义'}
                                      </button>
                                    );
                                  })}
                                </div>
                                <p className="text-[10px] text-muted-foreground/70">启用后，图表将仅统计所选时间范围内的记录，运行时可切换粒度/自定义范围</p>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-1">
                            <Label className="text-xs">时间字段</Label>
                            <Select value={sel.chart?.timeField || 'none'} onValueChange={(v) => updSel({ chart: { ...sel.chart!, timeField: v === 'none' ? '' : v } })}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="如：开始时间、创建时间" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">未选择</SelectItem>
                                {targetFieldOptions(sel.chart.formId).map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">时间粒度（可多选，运行时可切换）</Label>
                            <div className="flex flex-wrap gap-1.5">
                              {(['day', 'week', 'month', 'year', 'range'] as const).map((g) => {
                                const list = sel.chart?.timeGranularities ?? (sel.chart?.timeGranularity ? [sel.chart.timeGranularity] : []);
                                const checked = list.includes(g);
                                return (
                                  <button key={g} type="button" onClick={() => {
                                    const cur = sel.chart?.timeGranularities ?? (sel.chart?.timeGranularity ? [sel.chart.timeGranularity] : []);
                                    const next = checked ? cur.filter((x) => x !== g) : [...cur, g];
                                    updSel({ chart: { ...sel.chart!, timeGranularities: next.length > 0 ? next : ['month'] } });
                                  }} className={cn('rounded-md border px-2 py-1 text-[11px] transition-colors', checked ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                                    {g === 'day' ? '按天' : g === 'week' ? '按周' : g === 'month' ? '按月' : g === 'year' ? '按年' : '自定义'}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-muted-foreground/70">按天=近24小时(每小时)；按周=近7天(每天)；按月=近1月(每天)；按年=近1年(每月)；自定义=按时间范围(默认1个月)</p>
                          </div>
                          {/* 分组字段（可多选，每个取值一条曲线）：下拉/状态机字段与其他字段互斥 */}
                          <div className="space-y-1.5">
                            <Label className="text-xs">分组字段（可多选，每个取值一条曲线）</Label>
                            <div className="flex flex-wrap gap-1.5">
                              {targetFieldOptions(sel.chart.formId).map((o) => {
                                const list = sel.chart?.seriesFields ?? [];
                                const checked = list.includes(o.key);
                                // 下拉/状态机字段为维度字段，与其他字段互斥：选中一类时清空另一类
                                const isDimKey = (key: string) => {
                                  const fo = targetFieldOptions(sel.chart?.formId ?? '').find((x) => x.key === key);
                                  return key === 'status' || fo?.type === 'select';
                                };
                                const isDim = isDimKey(o.key);
                                return (
                                  <button key={o.key} type="button" onClick={() => {
                                    const cur = sel.chart?.seriesFields ?? [];
                                    let next: string[];
                                    if (checked) {
                                      next = cur.filter((x) => x !== o.key);
                                    } else if (isDim) {
                                      // 选维度字段：清空已选的其他字段
                                      next = [...cur.filter((x) => isDimKey(x)), o.key];
                                    } else {
                                      // 选其他字段：清空已选的下拉/状态机字段
                                      next = [...cur.filter((x) => !isDimKey(x)), o.key];
                                    }
                                    updSel({ chart: { ...sel.chart!, seriesFields: next } });
                                  }} className={cn('rounded-md border px-2 py-1 text-[11px] transition-colors', checked ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                                    {o.label}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-muted-foreground/70">下拉/状态机字段与其他字段不能同时选：下拉/状态机字段按每个取值拆分曲线（统计用下方全局配置）；其他字段每个字段一条曲线，分别配置统计数值和数值字段</p>
                          </div>
                          {/* 非下拉/状态机分组字段：每个字段单独配置统计方式和数值字段 */}
                          {(sel.chart?.seriesFields ?? [])
                            .filter((sf) => {
                              const o = targetFieldOptions(sel.chart?.formId ?? '').find((x) => x.key === sf);
                              return o ? o.type !== 'select' && sf !== 'status' : true;
                            })
                            .map((sf) => {
                              const opts = targetFieldOptions(sel.chart?.formId ?? '');
                              const label = opts.find((x) => x.key === sf)?.label ?? sf;
                              const cfgs = sel.chart?.seriesConfigs ?? [];
                              const cfg = cfgs.find((c) => c.fieldKey === sf);
                              const agg = cfg?.valueAgg ?? sel.chart?.valueAgg ?? 'count';
                              const updCfg = (patch: { valueField?: string; valueAgg?: 'sum' | 'count' | 'avg' }) => {
                                const next = cfgs.filter((c) => c.fieldKey !== sf).concat({ fieldKey: sf, ...(cfg ?? {}), ...patch });
                                updSel({ chart: { ...sel.chart!, seriesConfigs: next } });
                              };
                              return (
                                <div key={sf} className="rounded-md border border-border bg-muted/30 p-2 space-y-1.5">
                                  <span className="text-[11px] font-medium">{label}</span>
                                  <div className="flex gap-1.5">
                                    <Select value={agg} onValueChange={(v) => updCfg({ valueAgg: v as 'sum' | 'count' | 'avg' })}>
                                      <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="count">统计记录数</SelectItem>
                                        <SelectItem value="sum">对字段求和</SelectItem>
                                        <SelectItem value="avg">对字段求平均</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {agg !== 'count' && (
                                      <Select value={cfg?.valueField || 'none'} onValueChange={(v) => updCfg({ valueField: v === 'none' ? '' : v })}>
                                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="数值字段" /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">未选择</SelectItem>
                                          {opts.map((fo) => <SelectItem key={fo.key} value={fo.key}>{fo.label}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                        </>
                      ))}

                      {!(sel.type === 'page-chart-funnel' && (sel.chart?.formLayers?.length ?? 0) > 1) && (<>
                      {/* 全局统计数值/数值字段：仅为下拉/状态机分组字段模式配置；选中其他字段时隐藏（走每字段配置） */}
                      {!(sel.chart?.seriesFields ?? []).some((sf) => {
                        const fo = targetFieldOptions(sel.chart?.formId ?? '').find((x) => x.key === sf);
                        return sf !== 'status' && fo?.type !== 'select';
                      }) && (<>
                      <div className="space-y-1">
                        <Label className="text-xs">统计数值</Label>
                        <Select value={sel.chart?.valueAgg ?? 'count'} onValueChange={(v) => updSel({ chart: { ...sel.chart!, valueAgg: v as 'sum' | 'count' | 'avg' } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="count">统计记录数</SelectItem>
                            <SelectItem value="sum">对字段求和</SelectItem>
                            <SelectItem value="avg">对字段求平均</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {sel.chart?.valueAgg && sel.chart.valueAgg !== 'count' && (
                        <div className="space-y-1">
                          <Label className="text-xs">数值字段</Label>
                          <Select value={sel.chart?.valueField || 'none'} onValueChange={(v) => updSel({ chart: { ...sel.chart!, valueField: v === 'none' ? '' : v } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择数值字段" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未选择</SelectItem>
                              {targetFieldOptions(sel.chart.formId).map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      </>)}

                      <RelationFilterEditor
                        fieldOptions={targetFieldOptions(sel.chart.formId)}
                        conditions={sel.chart?.conditions ?? []}
                        conditionsLogic={sel.chart?.conditionsLogic ?? 'and'}
                        manualFilters={sel.chart?.manualFilters ?? []}
                        manualFiltersLogic={sel.chart?.manualFiltersLogic ?? 'and'}
                        onUpdate={(patch) => updSel({ chart: { ...sel.chart!, conditions: patch.conditions ?? sel.chart?.conditions ?? [], conditionsLogic: patch.conditionsLogic ?? sel.chart?.conditionsLogic ?? 'and', manualFilters: patch.manualFilters ?? sel.chart?.manualFilters ?? [], manualFiltersLogic: patch.manualFiltersLogic ?? sel.chart?.manualFiltersLogic ?? 'and' } })}
                      />
                      </>)}
                    </>
                  )}
                </div>
              )}

                  {/* 汇总统计 */}
                  {sel.type === 'page-summary' && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">数据源表单</Label>
                        <Select value={sel.summary?.formId || 'none'} onValueChange={(v) => updSel({ summary: { formId: v === 'none' ? '' : v, fieldKey: sel.summary?.fieldKey ?? '', aggregate: sel.summary?.aggregate ?? 'count' } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择目标表单" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">未选择</SelectItem>
                            {allForms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {sel.summary?.formId && (
                        <>
                          <div className="space-y-1">
                            <Label className="text-xs">统计字段</Label>
                            <Select value={sel.summary?.fieldKey || 'none'} onValueChange={(v) => updSel({ summary: { formId: sel.summary!.formId, fieldKey: v === 'none' ? '' : v, aggregate: sel.summary?.aggregate ?? 'count' } })}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="求和/平均时选择数值字段" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">未选择</SelectItem>
                                {targetFieldOptions(sel.summary.formId).map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">统计方式</Label>
                            <Select value={sel.summary?.aggregate ?? 'count'} onValueChange={(v) => updSel({ summary: { formId: sel.summary!.formId, fieldKey: sel.summary?.fieldKey ?? '', aggregate: v as 'count' | 'sum' | 'avg' } })}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="count">统计记录数</SelectItem>
                                <SelectItem value="sum">对字段求和</SelectItem>
                                <SelectItem value="avg">对字段求平均</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* 公式计算 */}
                  {sel.type === 'page-formula' && (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">计算公式</Label>
                        <Textarea className="text-xs px-2" rows={3} value={sel.formula?.expression ?? ''} onChange={(e) => updSel({ formula: { expression: e.target.value } })} placeholder="如：{page_1} + {page_2} * 0.1，引用其他组件用 {字段key}" />
                        <p className="text-[10px] text-muted-foreground/70">用 {`{字段key}`} 引用同页其他数值组件的值，支持 + - * / ( )</p>
                      </div>
                    </div>
                  )}

                  {/* 布局组件：分组标题 / 说明文字 */}
                  {(sel.type === 'page-group-title' || sel.type === 'page-description') && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">文字内容</Label>
                        <Input className="h-8 text-xs px-2" value={sel.layout?.text ?? ''} onChange={(e) => updSel({ layout: { text: e.target.value, columns: sel.layout?.columns ?? 2, size: sel.layout?.size ?? 'normal' } })} />
                      </div>
                      {sel.type === 'page-group-title' && (
                        <div className="space-y-1">
                          <Label className="text-xs">文字大小</Label>
                          <Select value={sel.layout?.size ?? 'h2'} onValueChange={(v) => updSel({ layout: { text: sel.layout?.text ?? '', columns: sel.layout?.columns ?? 2, size: v as 'normal' | 'h2' | 'h3' } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="h2">大标题</SelectItem>
                              <SelectItem value="h3">小标题</SelectItem>
                              <SelectItem value="normal">正文</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 布局组件：分栏布局（与表单设计器 FormDesigner 对齐，独立卡片配置） */}
                  {sel.type === 'page-grid' && (
                    <div className="space-y-3 rounded-md border border-border p-3">
                      <p className="text-xs font-medium">分栏布局设置</p>
                      <div className="space-y-1">
                        <Label className="text-xs">栏目条数</Label>
                        <Select
                          value={String(sel.layout?.columns ?? (sel.gridColumns?.length || 2))}
                          onValueChange={(v) => setGridColumns(Number(v))}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6].map((c) => (
                              <SelectItem key={c} value={String(c)}>{c} 栏</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">栏目属性</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {Array.from({ length: sel.layout?.columns ?? (sel.gridColumns?.length || 2) }).map((_, i) => {
                            const col = sel.gridColumns?.[i];
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setActiveGridCol(i)}
                                className={cn(
                                  'h-7 rounded border px-2 text-xs transition-colors',
                                  activeGridCol === i
                                    ? 'border-primary bg-primary/5 text-primary font-medium'
                                    : 'border-border text-muted-foreground hover:bg-muted/60',
                                )}
                              >
                                {col?.title || `第 ${i + 1} 栏`}
                              </button>
                            );
                          })}
                        </div>

                        <div className="rounded-md border border-border/80 bg-muted/20 p-3 space-y-2">
                          <div className="space-y-1">
                            <Label className="text-xs">栏目标题</Label>
                            <Input
                              className="h-8 text-xs px-2"
                              value={sel.gridColumns?.[activeGridCol]?.title ?? `第 ${activeGridCol + 1} 栏`}
                              onChange={(e) => {
                                const cols = sel.layout?.columns ?? (sel.gridColumns?.length || 2);
                                const cur = Array.from({ length: cols }).map((_, i) =>
                                  sel.gridColumns?.[i] ?? {
                                    title: `第 ${i + 1} 栏`,
                                    formId: '',
                                    fieldKey: '',
                                    aggregate: 'first' as const,
                                    dataRange: 'permission' as const,
                                    defaultValue: '',
                                  },
                                );
                                cur[activeGridCol] = { ...cur[activeGridCol], title: e.target.value };
                                updSel({ gridColumns: cur });
                              }}
                            />
                          </div>

                          <TextSourceEditor
                            source={
                              sel.gridColumns?.[activeGridCol] ?? {
                                title: `第 ${activeGridCol + 1} 栏`,
                                formId: '',
                                fieldKey: '',
                                aggregate: 'first',
                                dataRange: 'permission',
                                defaultValue: '',
                              }
                            }
                            forms={allForms}
                            fieldOptions={targetFieldOptions}
                            onChange={(next) => setGridColumn(activeGridCol, next as TextColumnConfig)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 页面布局：竖分列容器，纯排版 */}
                  {sel.type === 'page-layout' && (
                    <div className="space-y-3 rounded-md border border-border p-3">
                      <p className="text-xs font-medium">页面布局设置</p>
                      <div className="space-y-1">
                        <Label className="text-xs">列数</Label>
                        <Select
                          value={String(sel.layoutColumns?.count ?? 2)}
                          onValueChange={(v) => {
                            const count = Number(v) as 1 | 2 | 3 | 4;
                            const cur = sel.layoutColumns?.children ?? [];
                            const children = Array.from({ length: count }).map((_, i) => cur[i] ?? []);
                            updSel({ layoutColumns: { count, children } });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4].map((c) => (
                              <SelectItem key={c} value={String(c)}>{c} 列</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground/70">将页面竖向分为 {sel.layoutColumns?.count ?? 2} 列，每列可拖入组件进行排版</p>
                      </div>
                    </div>
                  )}

                  {/* 自定义按钮 */}
                  {sel.type === 'page-action-button' && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">按钮文字</Label>
                        <Input className="h-8 text-xs px-2" value={sel.action?.label ?? ''} onChange={(e) => updSel({ action: { label: e.target.value, type: sel.action?.type ?? 'navigate', targetPath: sel.action?.targetPath ?? '' } })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">动作类型</Label>
                        <Select value={sel.action?.type ?? 'navigate'} onValueChange={(v) => updSel({ action: { label: sel.action?.label ?? '按钮', type: v as 'navigate' | 'print' | 'refresh', targetPath: sel.action?.targetPath ?? '' } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="navigate">跳转页面</SelectItem>
                            <SelectItem value="print">打印</SelectItem>
                            <SelectItem value="refresh">刷新页面</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {sel.action?.type === 'navigate' && (
                        <div className="space-y-1">
                          <Label className="text-xs">跳转目标路径</Label>
                          <Input className="h-8 text-xs px-2" value={sel.action?.targetPath ?? ''} onChange={(e) => updSel({ action: { label: sel.action?.label ?? '按钮', type: 'navigate', targetPath: e.target.value } })} placeholder="如 /app/<表单ID>" />
                        </div>
                      )}
                    </div>
                  )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}