import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { withRetry } from '@/lib/withRetry';
import type { BizData, FormField, MetaForm } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 关联表单配置 */
  refAssign: { formId: string; mappings: Array<{ fromKey: string; toKey: string }> };
  /** 选中一条数据后回调（payload 为该记录的字段值） */
  onPick: (payload: Record<string, unknown>, row: BizData) => void;
}

/** 关联表单赋值选择弹窗：列出目标表单数据，点击一条即按映射赋值 */
export function RefAssignDialog({ open, onClose, refAssign, onPick }: Props) {
  const [meta, setMeta] = useState<Pick<MetaForm, 'id' | 'name' | 'schema_json'> | null>(null);
  const [rows, setRows] = useState<BizData[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const fields: FormField[] = useMemo(
    () => ((meta?.schema_json?.fields ?? []) as FormField[]).filter((f) => !f.system),
    [meta],
  );
  // 图片字段（image 类型），用于左侧缩略图展示
  const imgField = useMemo(() => fields.find((f) => f.type === 'image'), [fields]);
  // 列表右侧信息字段（非图片，取前 4 个）
  const cols = useMemo(() => fields.filter((f) => f.type !== 'image').slice(0, 4), [fields]);

  useEffect(() => {
    if (!open || !refAssign.formId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [m, r] = await Promise.all([
          withRetry(() => supabase.from('meta_forms').select('id, name, schema_json').eq('id', refAssign.formId).maybeSingle()),
          withRetry(() => supabase.from('biz_data')
            .select('*')
            .eq('form_id', refAssign.formId)
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
            .limit(50)),
        ]);
        if (!alive) return;
        setMeta((m.data as Pick<MetaForm, 'id' | 'name' | 'schema_json'> | null) ?? null);
        setRows((r.data as BizData[]) ?? []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, refAssign.formId]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => {
      const title = (r.title ?? '').toLowerCase();
      const hay = cols.map((c) => String((r.payload ?? {})[c.key] ?? '')).join(' ').toLowerCase();
      return title.includes(kw) || hay.includes(kw);
    });
  }, [rows, q, cols]);

  // 分组展示：标题行（名称+SKU）、价格行（单值高亮）、其余字段行
  const topFieldKeys = useMemo(() => {
    // 优先取 title 对应的业务字段（title 是记录自动生成名，字段名可能是名称/产品名称等）
    const titleField = fields.find((f) => f.key === 'title' || f.label.includes('名称') || f.label === '产品名称' || f.type === 'input');
    const skuField = fields.find((f) => /sku|编码|编号/i.test(f.key) || /sku|编码|编号/i.test(f.label));
    return {
      nameKey: titleField?.key ?? '',
      skuKey: skuField?.key ?? '',
    };
  }, [fields]);
  // 中高亮价格字段
  const priceField = useMemo(() => fields.find((f) => /价格|单价|金额|price|amount/i.test(f.key) || /价格|单价|金额/i.test(f.label)), [fields]);

  /** 从记录 payload 取图片 URL（image 字段值可能是 string[] 或 string） */
  const pickImg = (r: BizData): string | null => {
    if (!imgField) return null;
    const v = (r.payload ?? {})[imgField.key];
    if (Array.isArray(v) && v.length > 0) return String(v[0]);
    if (typeof v === 'string' && v) return v;
    return null;
  };

  /** 卡片上行显示名称：优先取产品名称字段（label 含"名称"或 key 为 name/title 的业务字段），否则回退记录 title */
  const nameField = useMemo(() =>
    fields.find((f) => /名称|name|title/i.test(f.key) && f.type !== 'image' && !f.system)
      ?? fields.find((f) => f.label.includes('名称') && f.type !== 'image' && !f.system),
    [fields]);
  /** 根据配置识别卡片三行展示 */
  const nameKey = nameField?.key ?? topFieldKeys.nameKey;
  const skuKey = topFieldKeys.skuKey;
  // 底部行字段：排除顶部/中部已展示的字段
  const bottomCols = useMemo(() => cols.filter((c) => c.key !== nameKey && c.key !== skuKey && c.key !== priceField?.key).slice(0, 4), [cols, nameKey, skuKey, priceField?.key]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-left">选择关联数据{meta ? ` · ${meta.name}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="搜索数据…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ScrollArea className="max-h-[60vh] min-h-40">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> 加载中…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">暂无可选数据</p>
          ) : (
            <div className="space-y-1.5 pr-2">
              {filtered.map((r) => {
                const imgUrl = pickImg(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { onPick((r.payload ?? {}) as Record<string, unknown>, r); onClose(); }}
                    className={cn(
                      'w-full rounded-md border border-border bg-card px-3 py-3 text-left flex items-start gap-3',
                      'hover:border-primary hover:bg-primary/5 transition-colors',
                    )}
                  >
                    {/* 左侧产品图片（无图显示默认无图样式） */}
                    <div className="shrink-0 w-16 h-16 rounded-md overflow-hidden border border-border/60 bg-muted flex items-center justify-center">
                      {imgUrl ? (
                        <img src={imgUrl} alt={r.title ?? '产品图片'} className="w-full h-full object-cover" />
                      ) : (
                        <svg className="w-6 h-6 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="9" cy="9" r="2" />
                          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                        </svg>
                      )}
                    </div>
                    {/* 右侧产品信息（上：名称+SKU / 中：价格 / 下：其他字段） */}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* 上行：产品名称 + SKU */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="shrink-0 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                          {(r.payload ?? {})[nameKey] ? String((r.payload ?? {})[nameKey]) : (r.title || '未命名记录')}
                        </span>
                        {skuKey && (
                          <span className="text-xs text-muted-foreground font-mono">
                            SKU：{(r.payload ?? {})[skuKey] ? String((r.payload ?? {})[skuKey]) : '—'}
                          </span>
                        )}
                      </div>
                      {/* 中行：价格高亮 */}
                      {priceField && (
                        <p className="text-base font-bold text-foreground">
                          {priceField.label}：{(r.payload ?? {})[priceField.key] !== undefined && (r.payload ?? {})[priceField.key] !== null && (r.payload ?? {})[priceField.key] !== ''
                            ? String((r.payload ?? {})[priceField.key])
                            : '—'}
                          元
                        </p>
                      )}
                      {/* 下行：其他字段 */}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                        {bottomCols.map((c) => {
                          const v = (r.payload ?? {})[c.key];
                          return (
                            <span key={c.key} className="text-xs text-muted-foreground truncate max-w-56">
                              {c.label}：{v === undefined || v === null || v === '' ? '—' : String(v)}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
