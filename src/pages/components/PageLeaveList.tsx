import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { BizData, MetaForm, PageField } from '@/types';
import { applyDisplayConditions, fmtDate } from '@/lib/field-catalog';
import { loadFormSm, resolveStatusLabel, resolveStatusColor, type FormSmMap } from '@/lib/status-machine';
import { Badge } from '@/components/ui/badge';
import { DataPagination } from '@/components/ui/data-pagination';
import { Loader2, FileText } from 'lucide-react';

interface Props {
  field: PageField;
  /** 年份筛选：仅展示开始日期属于该年度的记录 */
  year: number;
  /** 设计器紧凑模式 */
  compact?: boolean;
}

/** 默认显示列：请假编号、开始时间、结束时间、请假天数、请年假原因、状态 */
const DEFAULT_DISPLAY_FIELDS = ['__no', 'start_date', 'end_date', 'days', 'reason', 'status'];

const SPECIAL_LABELS: Record<string, string> = {
  __no: '请假编号',
  status: '状态',
};

/** 「我的请假信息-年假」列表：展示当前登录账号在指定年份的请假记录 */
export default function PageLeaveList({ field, year, compact }: Props) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const userId = profile?.id ?? '';
  const cfg = field.leaveList;

  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<MetaForm | null>(null);
  const [rows, setRows] = useState<BizData[]>([]);
  // 关联表单的状态机状态定义（key → 名称/颜色）：状态列显示自定义状态名称而非标识
  const [smMap, setSmMap] = useState<FormSmMap>(new Map());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    if (!cfg?.formId || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [formRes, dataRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', cfg.formId).maybeSingle(),
      supabase
        .from('biz_data')
        .select('*')
        .eq('form_id', cfg.formId)
        .eq('created_by', userId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);
    const form = formRes.data as MetaForm | null;
    setMeta(form);
    const all = (dataRes.data ?? []) as BizData[];
    // 年份联动：按开始日期所在年度过滤
    const inYear = all.filter((b) => {
      const payload = b.payload ?? {};
      const dateStr = (payload.start_date as string) ?? b.created_at;
      const y = dateStr ? new Date(dateStr).getFullYear() : null;
      return y === year;
    });
    const filtered = applyDisplayConditions(
      inYear as unknown as Record<string, unknown>[],
      cfg.conditions ?? [],
      cfg.conditionsLogic ?? 'and',
    ) as unknown as BizData[];
    setRows(filtered);
    // 加载关联表单状态机：状态列按自定义状态名称解析
    setSmMap(await loadFormSm([cfg.formId]));
    setLoading(false);
  }, [cfg?.formId, cfg?.conditions, cfg?.conditionsLogic, userId, year]);

  useEffect(() => {
    load();
  }, [load]);

  // 切换年份后回到第一页
  useEffect(() => {
    setPage(1);
  }, [year]);

  if (!cfg?.formId) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-6 text-muted-foreground">
        <FileText className="h-5 w-5" />
        <p className="text-xs">请在右侧属性面板关联请假表单</p>
      </div>
    );
  }

  const schemaFields = meta?.schema_json?.fields ?? [];
  const fieldDef = (key: string) => schemaFields.find((f) => f.key === key);
  const displayFields = (cfg.displayFields?.length ?? 0) > 0 ? cfg.displayFields! : DEFAULT_DISPLAY_FIELDS;

  const labelOf = (key: string) => SPECIAL_LABELS[key] ?? fieldDef(key)?.label ?? key;

  // 客户端分页
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const paged = rows.slice(offset, offset + pageSize);

  const renderCell = (row: BizData, key: string, index: number) => {
    if (key === '__no') return `QJ-${String(index + 1).padStart(4, '0')}`;
    if (key === 'status') {
      const label = resolveStatusLabel(cfg.formId, row.status, smMap);
      const c = resolveStatusColor(cfg.formId, row.status, smMap);
      return <Badge variant="secondary" className="font-normal" style={c ? { color: c, borderColor: `${c}40`, backgroundColor: `${c}15` } : undefined}>{label}</Badge>;
    }
    const def = fieldDef(key);
    const raw = (row.payload ?? {})[key];
    if (raw === undefined || raw === null || raw === '') return <span className="text-muted-foreground">—</span>;
    if (def?.type === 'date') return fmtDate(String(raw));
    if (def?.type === 'datetime') return fmtDate(String(raw), true);
    return String(raw);
  };

  if (loading) {
    return (
      <div className="flex h-16 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">我的请假信息-年假（{year}年）</p>
        <span className="text-[11px] text-muted-foreground">共 {rows.length} 条</span>
      </div>
      <div className="w-full max-w-full overflow-x-auto rounded-[5px] border border-border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {displayFields.map((key) => (
                <th key={key} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
                  {labelOf(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={displayFields.length} className="px-3 py-6 text-center text-muted-foreground">
                  暂无请假记录
                </td>
              </tr>
            ) : (
              paged.map((row, idx) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  {displayFields.map((key) => (
                    <td key={key} className="whitespace-nowrap px-3 py-2 text-foreground">
                      {renderCell(row, key, offset + idx)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <DataPagination total={rows.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
      </div>
      {compact && <p className="text-[10px] text-muted-foreground/60">预览当前账号「{profile?.name ?? '—'}」的请假记录</p>}
    </div>
  );
}