import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { supabase } from '@/db/supabase';
import type { ScopeContext } from '@/lib/field-catalog';
import { BIZ_STATUS_LABELS, buildCreatorScope, computeFormCalculations, ensureSystemFields, fieldInitialValue, formatOptionFieldValue, optionDisplayKeys, validateField } from '@/lib/field-catalog';
import { cn } from '@/lib/utils';
import type { BizData, FormField, MetaForm } from '@/types';
import { FillFieldEditor } from './BizDetailDialog';
import { RefAssignDialog } from './RefAssignDialog';

/** 关联子表草稿行：未持久化的新行 rowId 为空 */
export interface SubTableRowDraft {
  /** 前端临时标识 */
  key: string;
  /** 已持久化的子表行 id（新行为空） */
  rowId?: string;
  payload: Record<string, unknown>;
  /** 已持久化行的顶层系统列（状态/创建人/创建时间等，勾选系统显示列时回显用） */
  sys?: Record<string, unknown>;
}

/** 关联子表字段草稿值（编辑态）；主表保存后 payload 中为行 id 数组 */
export interface SubTableDraftValue {
  rows: SubTableRowDraft[];
  /** 已移除的持久化行 id（保存时软删除） */
  removedIds: string[];
}

/** 是否为关联子表草稿值（区别于已持久化的行 id 数组与随主表保存的内嵌值） */
export function isSubTableDraftValue(v: unknown): v is SubTableDraftValue {
  return !!v && typeof v === 'object' && Array.isArray((v as SubTableDraftValue).rows) && (v as { __inline?: unknown }).__inline !== true;
}

/** 随主表统一保存的内嵌值（saveMode='with-main'）：明细/关联记录快照直接存入主表 payload，不产生独立业务记录 */
export interface InlineRefValue {
  /** 内嵌标记：区分草稿值与 id 数组 */
  __inline: true;
  /** 关联记录 id 列表（form-ref 物化保留原 id；子表新行无 id） */
  ids?: string[];
  /** 记录快照：payload + 顶层系统列（状态/创建人等，勾选系统显示列时回显用） */
  rows: Array<{ id?: string; payload: Record<string, unknown>; sys?: Record<string, unknown> }>;
}

/** 是否为随主表统一保存的内嵌值 */
export function isInlineRefValue(v: unknown): v is InlineRefValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && (v as { __inline?: unknown }).__inline === true && Array.isArray((v as InlineRefValue).rows);
}

/** 取内嵌值的关联 id 列表（优先 ids，其次 rows 中带 id 的行） */
export function inlineRefIds(v: InlineRefValue): string[] {
  if (Array.isArray(v.ids)) return v.ids.filter(Boolean);
  return v.rows.map((r) => r.id).filter((x): x is string => !!x);
}

/** 校验用取值：草稿值取行数组，内嵌值取行数组，id 数组原样，其余空数组（validateField 仅关心行数） */
export function subTableValidateValue(v: unknown): unknown[] {
  if (isSubTableDraftValue(v)) return v.rows;
  if (isInlineRefValue(v)) return v.rows;
  return Array.isArray(v) ? v : [];
}

/** 取子表 payload 的首个非空文本作为行标题 */
const firstTextValue = (payload: Record<string, unknown>): string | null => {
  for (const v of Object.values(payload)) {
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 50);
    if (typeof v === 'number') return String(v);
  }
  return null;
};

/** id 数组 → biz_data 行快照（with-main 物化用）：保留顶层系统列便于系统显示列回显 */
export const fetchInlineRows = async (ids: string[]): Promise<Array<{ id?: string; payload: Record<string, unknown>; sys?: Record<string, unknown> }>> => {
  if (ids.length === 0) return [];
  const { data } = await supabase.from('biz_data').select('*').in('id', ids).eq('is_deleted', false);
  const byId = new Map(((data as BizData[]) ?? []).map((r) => [r.id, r]));
  return ids.filter((id) => byId.has(id)).map((id) => {
    const r = byId.get(id)!;
    return {
      id: r.id,
      payload: { ...(r.payload ?? {}) },
      sys: { status: r.status, created_by: r.created_by, created_at: r.created_at, updated_by: r.updated_by, updated_at: r.updated_at },
    };
  });
};

/** 单独保存模式行即时写入的执行人上下文：当前登录用户 id 与租户 id */
const getActorCtx = async (): Promise<{ userId: string; tenantId: string }> => {
  const uid = (await supabase.auth.getUser()).data.user?.id ?? '';
  const { data: me } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
  return { userId: uid, tenantId: (me as { tenant_id?: string } | null)?.tenant_id ?? '' };
};

/**
 * 主表保存前持久化关联子表明细：
 * - saveMode='with-main'（默认，随主表统一保存）：明细以 JSON 内嵌存入主表 payload（草稿/历史 id 数组统一物化），不产生独立业务记录
 * - saveMode='standalone'（单独保存且关联主表）：行弹窗确定时已即时入库（编辑器内直接写 biz_data），此处仅兜底处理历史草稿值：
 *   - removedIds 中的已有行软删除（is_deleted=true）
 *   - 新行插入 biz_data（子表单 form_id；普通表单明细直接置完成态，其余为草稿）
 *   - 已有行更新 payload
 *   - 主表 payload 中该字段替换为行 id 数组
 * 未改动的字段（值已是 id 数组或为空）保持原样。
 * 返回值 extra.subRows 为本次持久化后该单据的子表行快照（fieldKey -> 行），供调用方同步刷新汇总/取值的计算缓存。
 */
export async function persistSubTableFields(fields: FormField[], payload: Record<string, unknown>, ctx: { tenantId: string; userId: string }): Promise<Record<string, unknown>> {
  const r = await persistSubTableFieldsEx(fields, payload, ctx);
  return r.payload;
}

export async function persistSubTableFieldsEx(fields: FormField[], payload: Record<string, unknown>, ctx: { tenantId: string; userId: string }): Promise<{ payload: Record<string, unknown>; subRows: Record<string, BizData[]> }> {
  const subFields = fields.filter((f) => f.type === 'sub-table' && !!f.subTable?.targetFormId);
  if (subFields.length === 0) return { payload, subRows: {} };
  const next = { ...payload };
  const subRows: Record<string, BizData[]> = {};
  for (const f of subFields) {
    const val = next[f.key];
    const cfg = f.subTable!;
    // 随主表统一保存（默认）：草稿值物化为内嵌结构；历史 id 数组拉取行快照物化；已内嵌原样保留。不写子表业务数据。
    if (cfg.saveMode !== 'standalone') {
      if (isSubTableDraftValue(val)) {
        next[f.key] = { __inline: true, ids: val.rows.map((r) => r.rowId).filter(Boolean), rows: val.rows.map((r) => ({ id: r.rowId, payload: r.payload, sys: r.sys })) };
      } else if (Array.isArray(val) && val.length > 0) {
        const ids = (val as string[]).filter((x) => typeof x === 'string');
        next[f.key] = { __inline: true, ids, rows: await fetchInlineRows(ids) };
      }
      continue;
    }
    if (!isSubTableDraftValue(val)) continue;
    // 行快照供汇总/取值计算缓存刷新：更新已有行 + 本次新插入行（仅 standalone 分支产生）
    if (val.removedIds.length > 0) {
      const { error } = await supabase.from('biz_data').update({ is_deleted: true, updated_at: new Date().toISOString() }).in('id', val.removedIds);
      if (error) throw new Error(`删除「${f.label}」明细失败：${error.message}`);
    }
    // 子表单为普通表单时明细行直接置完成态，其余模式保持草稿（明细数据不独立走流程）
    const { data: childForm } = await supabase.from('meta_forms').select('form_mode').eq('id', cfg.targetFormId).maybeSingle();
    const childStatus = (childForm as { form_mode?: string } | null)?.form_mode === 'normal' ? 'approved' : 'draft';
    const ids: string[] = [];
    const liveRows: BizData[] = [];
    for (const row of val.rows) {
      if (row.rowId) {
        const { error } = await supabase.from('biz_data').update({ payload: row.payload, updated_at: new Date().toISOString() }).eq('id', row.rowId);
        if (error) throw new Error(`保存「${f.label}」明细失败：${error.message}`);
        ids.push(row.rowId);
        liveRows.push({ id: row.rowId, payload: row.payload } as BizData);
      } else {
        const { data: inserted, error } = await supabase.from('biz_data').insert({
          tenant_id: ctx.tenantId || null,
          form_id: cfg.targetFormId,
          status: childStatus,
          title: firstTextValue(row.payload) ?? f.label,
          amount: null,
          payload: row.payload,
          created_by: ctx.userId || null,
        }).select('id').single();
        if (error) throw new Error(`新增「${f.label}」明细失败：${error.message}`);
        ids.push((inserted as { id: string }).id);
        liveRows.push({ id: (inserted as { id: string }).id, payload: row.payload } as BizData);
      }
    }
    subRows[f.key] = liveRows;
    next[f.key] = ids;
  }
  return { payload: next, subRows };
}

/** 子表弹窗可填写的字段：排除布局/关联/查询/系统字段与已拆分的请假复合字段（action-button 保留，供按钮动作渲染） */
const childFillFields = (childForm: MetaForm | null): FormField[] => {
  if (!childForm) return [];
  return ensureSystemFields((childForm.schema_json?.fields ?? []) as FormField[]).filter(
    (f) => !f.system && !['section', 'row', 'wizard-step', 'form-ref', 'query', 'sub-table', 'leave-time', 'serial-number'].includes(f.type),
  );
};

/** 子表显示列候选字段：业务字段 + 系统默认字段（状态/创建人/创建时间等，系统字段由系统写入只展示不可填写） */
const childDisplayFields = (childForm: MetaForm | null): FormField[] => {
  if (!childForm) return [];
  return ensureSystemFields((childForm.schema_json?.fields ?? []) as FormField[]).filter(
    (f) => !['section', 'row', 'action-button', 'wizard-step', 'form-ref', 'query', 'sub-table', 'leave-time', 'serial-number'].includes(f.type),
  );
};

/** 系统字段列 key（取值：payload 优先，回退 biz_data 行顶层系统列） */
const SYS_COL_KEYS = ['status', 'created_by', 'created_at', 'updated_by', 'updated_at'];

/** 系统字段展示值：状态转中文、时间截取本地格式、人员 id 转姓名，空值显示占位符 */
const sysCellText = (payload: Record<string, unknown>, sys: Record<string, unknown>, key: string, userNames: Map<string, string>): string => {
  const pv = payload[key];
  const v = (pv !== undefined && pv !== null && pv !== '') ? pv : sys[key];
  if (v === undefined || v === null || v === '') return '—';
  if (key === 'status') return BIZ_STATUS_LABELS[String(v)] ?? String(v);
  if (key === 'created_at' || key === 'updated_at') return String(v).slice(0, 16).replace('T', ' ');
  if ((key === 'created_by' || key === 'updated_by') && userNames.get(String(v))) return userNames.get(String(v))!;
  return String(v);
};

const cellText = (payload: Record<string, unknown>, key: string): string => {
  const v = payload[key];
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
  return String(v);
};

/** 数据源下拉列的 id → 显示文本解析（与主表列表一致）：按 optionSource 源表单记录拼接显示字段；存量纯文本值原样展示 */
export const optCellText = (payload: Record<string, unknown>, key: string, fields: FormField[], srcRows: Map<string, BizData[]>, userNames?: Map<string, string>): string => {
  const f = fields.find((x) => x.key === key);
  if (f && (f.type === 'select' || f.type === 'multi-select' || f.type === 'search-select' || f.type === 'search-multi-select') && f.optionSource?.formId && optionDisplayKeys(f).length > 0) {
    const v = payload[key];
    if (v === undefined || v === null || v === '') return '—';
    const rows = srcRows.get(f.optionSource.formId) ?? [];
    const sep = f.optionSource.separator ?? '-';
    const resolve = (id: string): string => {
      const rec = rows.find((r) => r.id === id);
      if (!rec) return id;
      const joined = optionDisplayKeys(f).map((k) => formatOptionFieldValue(k, rec, userNames)).filter(Boolean).join(sep);
      return joined || id;
    };
    if (Array.isArray(v)) return v.map((x) => resolve(String(x))).join('、') || '—';
    return resolve(String(v));
  }
  return cellText(payload, key);
};

/** 子表显示列含数据源下拉字段时拉取源表单记录（源表单 id → 记录行），供单元格 id → 显示文本解析 */
export function useOptionSrcRows(displayFields: FormField[]) {
  const srcFormIds = useMemo(() => [...new Set(displayFields
    .filter((f) => (f.type === 'select' || f.type === 'multi-select' || f.type === 'search-select' || f.type === 'search-multi-select') && f.optionSource?.formId)
    .map((f) => f.optionSource!.formId!))], [displayFields]);
  const idsKey = srcFormIds.join(',');
  const [srcRows, setSrcRows] = useState<Map<string, BizData[]>>(new Map());
  useEffect(() => {
    if (!idsKey) { setSrcRows(new Map()); return; }
    let alive = true;
    void Promise.all(idsKey.split(',').map(async (formId) => {
      const { data } = await supabase.from('biz_data').select('*').eq('form_id', formId).eq('is_deleted', false).limit(500);
      return [formId, ((data as BizData[]) ?? [])] as const;
    })).then((pairs) => {
      if (alive) setSrcRows(new Map(pairs));
    });
    return () => { alive = false; };
  }, [idsKey]);
  return srcRows;
}

/**
 * 关联子表编辑器：主表填写时内嵌的可编辑明细列表。
 * - 随主表统一保存（默认）：行数据暂存内存，主表保存时由 persistSubTableFields 统一持久化
 * - 单独保存且关联主表：行弹窗点「确定」即写入 biz_data 并回填 id 引用，列表即时显示
 */
/** 子表明细弹窗中的自定义按钮：REF_ASSIGN 打开关联表单数据列表选中后按映射写入当前行草稿 */
function SubTableButtonField({ field, rowDraft, setRowDraft }: {
  field: FormField;
  rowDraft: Record<string, unknown>;
  setRowDraft: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  const [refAssignOpen, setRefAssignOpen] = useState(false);
  const b = field.button;
  const isRefAssign = b?.actionType === 'REF_ASSIGN';

  const handleClick = () => {
    if (!b) return toast.error('该按钮未配置动作');
    if (isRefAssign) {
      if (!b.refAssign?.formId) return toast.error('该按钮未配置关联表单');
      if ((b.refAssign.mappings ?? []).length === 0) return toast.error('该按钮未配置字段赋值映射');
      setRefAssignOpen(true);
      return;
    }
    toast.info('该按钮类型暂不支持子表内执行');
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="h-9 w-fit rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {field.label}
      </button>
      {isRefAssign && b.refAssign && (
        <RefAssignDialog
          open={refAssignOpen}
          onClose={() => setRefAssignOpen(false)}
          refAssign={b.refAssign}
          onPick={(payload) => {
            const maps = b.refAssign!.mappings ?? [];
            const patch: Record<string, unknown> = {};
            for (const m of maps) {
              if (!m.fromKey || !m.toKey) continue;
              const v = payload[m.fromKey];
              if (v !== undefined && v !== null) patch[m.toKey] = v;
            }
            if (Object.keys(patch).length === 0) return toast.error('所选数据无映射字段值可赋值');
            setRowDraft((d) => ({ ...d, ...patch }));
            toast.success(`已按映射赋值 ${Object.keys(patch).length} 个字段`);
          }}
        />
      )}
    </>
  );
}

export function SubTableEditor({ field, value, onChange, readOnly, scopeCtx, mainBizId, onMainRecalced }: {
  field: FormField;
  value: unknown;
  onChange: (v: SubTableDraftValue | string[]) => void;
  readOnly?: boolean;
  /** 数据范围上下文：用于只读展示/编辑时过滤子表行 */
  scopeCtx?: ScopeContext;
  /** 主表单据 id：单独保存模式下行即时入库后原子回写主表 payload 的 id 引用（主表未保存时为空，仅暂存内存） */
  mainBizId?: string | null;
  /** 主表因明细保存自动重算后回传变更字段，供调用方立即更新回显草稿 */
  onMainRecalced?: (patch: Record<string, unknown>) => void;
}) {
  const cfg = field.subTable;
  // 单独保存且关联主表：行弹窗确定即入库
  const standalone = cfg?.saveMode === 'standalone';
  // 单独保存模式下的当前行 id 引用（主表 payload 存的值；新建时初始值为空草稿，视为空引用）
  const curIds = Array.isArray(value) ? (value as string[]).filter((x) => typeof x === 'string') : [];
  // 即时入库适用条件：值为 id 数组，或新建场景的空草稿（无行）
  const standaloneLive = standalone && (Array.isArray(value) || (isSubTableDraftValue(value) && value.rows.length === 0));

  // 行入库/删除后原子回写主表 payload 的 id 引用，并立即重算主表上的统计(如打款总额)与公式(如剩余还款金额)并持久化
  const persistAndRecalcMain = async (nextIds: string[], nextRows: SubTableRowDraft[]) => {
    if (!mainBizId) return;
    try {
      // 1. 原子回写子表 id 引用
      await supabase.rpc('merge_biz_payload_field', {
        p_biz_id: mainBizId,
        p_field_key: field.key,
        p_value: JSON.parse(JSON.stringify(nextIds)) as unknown as never,
      });

      // 2. 查询主表元数据与最新 payload，自动重算汇总统计与公式字段
      const { data: mainBiz } = await supabase.from('biz_data').select('*').eq('id', mainBizId).maybeSingle();
      if (!mainBiz) return;
      const { data: mainForm } = await supabase.from('meta_forms').select('schema_json').eq('id', mainBiz.form_id).maybeSingle();
      const mainFields = (mainForm?.schema_json?.fields ?? []) as FormField[];
      if (mainFields.length === 0) return;

      // 3. 构建主表「全部」子表字段的行数据上下文：
      //    当前子表用刚保存的最新行；其余子表按主表 payload 的 id 引用从数据库拉取，
      //    保证引用其他子表的汇总（如保存还款记录时重算打款总额）不因缺上下文算成 null 而误覆盖
      const subRowsMap: Record<string, Array<{ id?: string; payload?: Record<string, unknown>; created_at?: string | null }>> = {
        [field.key]: nextRows.map((r) => ({ id: r.rowId, payload: r.payload })),
      };
      const otherSubFields = mainFields.filter((f) => f.type === 'sub-table' && f.subTable?.targetFormId && f.key !== field.key);
      await Promise.all(otherSubFields.map(async (f) => {
        const v = (mainBiz.payload as Record<string, unknown> | null)?.[f.key];
        const ids = Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
        if (ids.length === 0) { subRowsMap[f.key] = []; return; }
        const { data: rows } = await supabase.from('biz_data').select('id, payload, created_at').in('id', ids).eq('is_deleted', false);
        subRowsMap[f.key] = (rows as Array<{ id: string; payload: Record<string, unknown>; created_at: string | null }>) ?? [];
      }));

      const calced = computeFormCalculations({
        fields: mainFields,
        vals: { ...(mainBiz.payload as Record<string, unknown> | null ?? {}), [field.key]: nextIds },
        subRowsMap,
        scopeCtx,
      });

      // 仅回写非 null 计算结果：无法在本地复算的字段（如引用其他表单的关联取值/公式）保留数据库原值，避免被 null 覆盖
      const calcedPatch = Object.fromEntries(Object.entries(calced).filter(([, v]) => v !== null && v !== undefined));
      const patch: Record<string, unknown> = {
        [field.key]: nextIds,
        ...calcedPatch,
      };

      // 4. 立即持久化写回主表 biz_data.payload
      const nextPayload = { ...((mainBiz.payload as Record<string, unknown> | null) ?? {}), ...patch };
      await supabase.from('biz_data').update({
        payload: nextPayload,
        updated_at: new Date().toISOString(),
      }).eq('id', mainBizId);

      // 5. 通知父级草稿立即更新回显
      onMainRecalced?.(patch);
    } catch (err) {
      console.warn('子表保存后重算并回写主表失败：', err);
    }
  };

  const persistMainRef = async (ids: string[]) => {
    if (!mainBizId) return;
    const { error } = await supabase.rpc('merge_biz_payload_field', { p_biz_id: mainBizId, p_field_key: field.key, p_value: JSON.parse(JSON.stringify(ids)) as unknown as never });
    if (error) console.warn('主表子表引用回写失败：', error.message);
  };
  const [childForm, setChildForm] = useState<MetaForm | null>(null);
  const [loading, setLoading] = useState(false);
  // value 为已保存的 id 数组时拉取行数据归一化（草稿值直接使用）
  const [rowsFromIds, setRowsFromIds] = useState<SubTableRowDraft[]>([]);
  const [rowDialog, setRowDialog] = useState(false);
  const [rowDraft, setRowDraft] = useState<Record<string, unknown>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [rowSaving, setRowSaving] = useState(false);
  const normalizedRef = useRef('');

  useEffect(() => {
    if (!cfg?.targetFormId) { setChildForm(null); return; }
    let alive = true;
    setLoading(true);
    void supabase.from('meta_forms').select('*').eq('id', cfg.targetFormId).maybeSingle().then(({ data }) => {
      if (!alive) return;
      setChildForm((data as MetaForm | null) ?? null);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [cfg?.targetFormId]);

  useEffect(() => {
    if (isSubTableDraftValue(value) || isInlineRefValue(value)) { normalizedRef.current = ''; return; }
    const ids = Array.isArray(value) ? (value as string[]) : [];
    const sig = ids.join(',');
    if (normalizedRef.current === sig) return;
    normalizedRef.current = sig;
    if (ids.length === 0) { setRowsFromIds([]); return; }
    let alive = true;
    setLoading(true);
    void supabase.from('biz_data').select('*').in('id', ids).eq('is_deleted', false).then(({ data }) => {
      if (!alive) return;
      setLoading(false);
      let list = (data as BizData[]) ?? [];
      // 按数据范围过滤子表行（无上下文或全部数据时不限制）
      const scope = cfg?.dataRange;
      if (scope && scope !== 'all' && scopeCtx) {
        const allowed = buildCreatorScope({ ...scopeCtx, dataRange: scope });
        if (allowed) {
          const set = new Set(allowed);
          list = list.filter((r) => set.has(r.created_by ?? ''));
        }
      }
      const byId = new Map(list.map((r) => [r.id, r]));
      setRowsFromIds(ids.filter((id) => byId.has(id)).map((id) => {
        const r = byId.get(id)!;
        return {
          key: `r_${id}`, rowId: id, payload: { ...(r.payload ?? {}) },
          sys: { status: r.status, created_by: r.created_by, created_at: r.created_at, updated_by: r.updated_by, updated_at: r.updated_at },
        };
      }));
    });
    return () => { alive = false; };
  }, [value]);

  // 草稿值直接使用；随主表保存的内嵌值还原为草稿（行快照转行草稿）；id 数组用拉取结果
  const cur: SubTableDraftValue = isSubTableDraftValue(value)
    ? value
    : isInlineRefValue(value)
      ? { rows: value.rows.map((r, i) => ({ key: r.id ?? `r_inline_${i}_${Math.random().toString(36).slice(2, 6)}`, rowId: r.id, payload: { ...(r.payload ?? {}) }, sys: r.sys })), removedIds: [] }
      : { rows: rowsFromIds, removedIds: [] };
  const childFields = useMemo(() => childFillFields(childForm), [childForm]);
  // 显示列候选含系统默认字段；可填写字段（弹窗编辑）仍不含系统字段
  const displayFields = useMemo(() => childDisplayFields(childForm), [childForm]);
  // 显示列：过滤失效字段；未配置时默认前 3 个业务字段
  const displayCols = useMemo(() => {
    const cols = (cfg?.displayColumns ?? []).filter((k) => displayFields.some((f) => f.key === k));
    return cols.length > 0 ? cols : displayFields.filter((f) => !f.system).slice(0, 3).map((f) => f.key);
  }, [cfg?.displayColumns, displayFields]);
  const colLabel = (key: string) => displayFields.find((f) => f.key === key)?.label ?? key;
  // 显示列含数据源下拉字段时拉取源表单记录（id → 显示文本解析，如所属项目显示项目名称而非项目 id）
  const optSrcRows = useOptionSrcRows(displayFields);
  // 勾选创建人/更新人列时批量拉取姓名（uuid → 姓名）
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const needUsers = displayCols.includes('created_by') || displayCols.includes('updated_by');
  const rowsUserKey = cur.rows.map((r) => [r.payload?.created_by, r.sys?.created_by, r.payload?.updated_by, r.sys?.updated_by].filter(Boolean).join(',')).join('|');
  useEffect(() => {
    if (!needUsers) { setUserNames(new Map()); return; }
    const ids = [...new Set(cur.rows.flatMap((r) => [r.payload?.created_by, r.sys?.created_by, r.payload?.updated_by, r.sys?.updated_by]).filter((v): v is string => !!v))];
    if (ids.length === 0) { setUserNames(new Map()); return; }
    let alive = true;
    void supabase.from('profiles').select('id, name').in('id', ids).then(({ data }) => {
      if (alive) setUserNames(new Map(((data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])));
    });
    return () => { alive = false; };
  }, [needUsers, rowsUserKey]);

  const openAdd = () => {
    const init: Record<string, unknown> = {};
    childFields.forEach((f) => {
      init[f.key] = f.defaultValue !== undefined && f.defaultValue !== '' ? f.defaultValue : fieldInitialValue(f);
    });
    setRowDraft(init);
    setEditingKey(null);
    setRowDialog(true);
  };
  const openEdit = (row: SubTableRowDraft) => {
    setRowDraft({ ...row.payload });
    setEditingKey(row.key);
    setRowDialog(true);
  };
  /** 保存行时：实时计算公式/大写金额并并入 rowDraft，保证子表列表显示总价 */
  const rowDraftWithCalc = (draft: Record<string, unknown>): Record<string, unknown> => {
    const calced = computeFormCalculations({ fields: childFields, vals: draft, scopeCtx });
    return { ...draft, ...Object.fromEntries(Object.entries(calced).filter(([, v]) => v !== null && v !== undefined)) };
  };

  const saveRow = async () => {
    // 子表明细行必填校验
    for (const f of childFields) {
      if (!f.required) continue;
      const err = validateField(f, rowDraft[f.key]);
      if (err) return toast.error(`${f.label}：${err}`);
    }
    const mergedRow = rowDraftWithCalc(rowDraft);
    // 单独保存且关联主表：行弹窗点确定即写库（新增插入/已有行更新），主表仅保存行 id 引用，列表即时显示
    if (standaloneLive) {
      if (!childForm || !cfg?.targetFormId) return;
      setRowSaving(true);
      try {
        const { userId, tenantId } = await getActorCtx();
        const editingRow = editingKey ? cur.rows.find((r) => r.key === editingKey) : undefined;
        if (editingKey && editingRow?.rowId) {
          // 编辑已有行：立即更新 biz_data（id 引用不变，本地行数据同步刷新并重算主表统计与公式）
          const { error } = await supabase.from('biz_data').update({ payload: { ...mergedRow }, updated_at: new Date().toISOString() }).eq('id', editingRow.rowId);
          if (error) throw new Error(error.message);
          const updatedRows = cur.rows.map((r) => (r.key === editingKey ? { ...r, payload: { ...mergedRow } } : r));
          setRowsFromIds(updatedRows);
          void persistAndRecalcMain(curIds, updatedRows);
        } else {
          // 新增行（或异常无 id 行兜底）：立即插入 biz_data 并追加 id 引用，自动重算主表统计与公式并持久化
          const { data: inserted, error } = await supabase.from('biz_data').insert({
            tenant_id: tenantId || null,
            form_id: cfg.targetFormId,
            status: childForm.form_mode === 'normal' ? 'approved' : 'draft',
            title: firstTextValue(mergedRow) ?? field.label,
            amount: null,
            payload: { ...mergedRow },
            created_by: userId || null,
          }).select('id').single();
          if (error) throw new Error(error.message);
          const insertedId = (inserted as { id: string }).id;
          const newRow: SubTableRowDraft = {
            key: `r_${insertedId}`,
            rowId: insertedId,
            payload: { ...mergedRow },
            sys: { status: childForm.form_mode === 'normal' ? 'approved' : 'draft', created_by: userId || null, created_at: new Date().toISOString(), updated_by: null, updated_at: new Date().toISOString() },
          };
          const updatedRows = [...cur.rows, newRow];
          setRowsFromIds(updatedRows);
          const nextIds = [...curIds, insertedId];
          onChange(nextIds);
          void persistAndRecalcMain(nextIds, updatedRows);
        }
        setRowDialog(false);
      } catch (e) {
        toast.error(e instanceof Error ? `保存明细失败：${e.message}` : '保存明细失败');
      } finally {
        setRowSaving(false);
      }
      return;
    }
    // 随主表统一保存（默认）：行数据暂存内存，主表保存时统一持久化
    const rows = editingKey
      ? cur.rows.map((r) => (r.key === editingKey ? { ...r, payload: { ...mergedRow } } : r))
      : [...cur.rows, { key: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, payload: { ...mergedRow } }];
    onChange({ rows, removedIds: cur.removedIds });
    setRowDialog(false);
  };
  const delRow = async (row: SubTableRowDraft) => {
    // 单独保存且关联主表：立即软删行记录并从 id 引用中移除，同时重算主表统计与公式并持久化
    if (standaloneLive) {
      try {
        if (row.rowId) {
          const { error } = await supabase.from('biz_data').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', row.rowId);
          if (error) throw new Error(error.message);
        }
        const nextIds = curIds.filter((id) => id !== row.rowId);
        const updatedRows = cur.rows.filter((r) => r.key !== row.key);
        setRowsFromIds(updatedRows);
        onChange(nextIds);
        void persistAndRecalcMain(nextIds, updatedRows);
      } catch (e) {
        toast.error(e instanceof Error ? `删除明细失败：${e.message}` : '删除明细失败');
      }
      return;
    }
    onChange({ rows: cur.rows.filter((r) => r.key !== row.key), removedIds: row.rowId ? [...cur.removedIds, row.rowId] : cur.removedIds });
  };

  if (!cfg?.targetFormId) {
    return <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">未配置目标子表单（请到表单设计器中选择）</div>;
  }
  if (!childForm) {
    return loading
      ? <div className="flex items-center justify-center py-5 text-xs text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />加载子表配置…</div>
      : <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">关联子表应用不存在或已删除</div>;
  }
  const atMax = (cfg.maxRows ?? 0) > 0 && cur.rows.length >= (cfg.maxRows ?? 0);

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="rounded-md border border-border overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-muted/40 border-b border-border">
          <p className="text-xs font-medium text-muted-foreground truncate">{childForm.name}（{cur.rows.length} 行）</p>
          {!readOnly && (
            <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={openAdd} disabled={atMax}>
              <Plus className="h-3.5 w-3.5" />新增
            </Button>
          )}
        </div>
        <div className="max-h-60 overflow-y-auto">
          {cur.rows.length === 0 ? (
            <p className="px-3 py-5 text-xs text-muted-foreground text-center">{readOnly ? '暂无明细' : '点击「新增」添加明细行'}</p>
          ) : (
            <table className={cn('w-full', readOnly ? 'text-sm' : 'text-xs')}>
              <thead className={cn('border-b border-border text-left text-xs text-muted-foreground', !readOnly && 'bg-muted/50')}>
                <tr>
                  <th className="w-10 px-3 py-2.5 font-medium">#</th>
                  {displayCols.map((k) => <th key={k} className="px-4 py-2.5 font-medium whitespace-nowrap">{colLabel(k)}</th>)}
                  {!readOnly && <th className="w-20 px-2 py-2.5 text-right font-medium">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cur.rows.map((row, i) => (
                  <tr key={row.key} className="hover:bg-muted/50">
                    <td className="px-3 py-3 text-muted-foreground">{i + 1}</td>
                    {displayCols.map((k) => <td key={k} className="px-4 py-3 whitespace-nowrap text-foreground">{SYS_COL_KEYS.includes(k) ? sysCellText(row.payload, row.sys ?? {}, k, userNames) : optCellText(row.payload, k, displayFields, optSrcRows, userNames)}</td>)}
                    {!readOnly && (
                      <td className="px-2 py-3 text-right whitespace-nowrap">
                        <button type="button" className="text-primary hover:underline mr-2" onClick={() => openEdit(row)}>编辑</button>
                        <button type="button" className="text-destructive hover:underline" onClick={() => delRow(row)}>删除</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {(cfg.minRows ?? 0) > 0 && <p className="text-[11px] text-muted-foreground">至少 {cfg.minRows} 行{(cfg.maxRows ?? 0) > 0 ? `，最多 ${cfg.maxRows} 行` : ''}</p>}

      {/* 子表明细行编辑弹窗（复用子表单字段渲染） */}
      <Dialog open={rowDialog} onOpenChange={setRowDialog}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingKey ? '编辑' : '新增'}{childForm.name}明细</DialogTitle></DialogHeader>
          {(() => {
            // 子表明细行实时公式计算：按行草稿实时求值公式/大写金额等自动计算字段（与主表一致）
            const rowCalc = computeFormCalculations({ fields: childFields, vals: rowDraft, scopeCtx });
            return (
              <div className="grid gap-x-4 gap-y-3" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                {childFields.map((f) => {
                  // 自定义按钮：直接渲染按钮 + REF_ASSIGN 关联赋值弹窗，跳过 Label 与 FillFieldEditor
                  if (f.type === 'action-button') {
                    return (
                      <div key={f.key} className="min-w-0 flex flex-col justify-end" style={{ gridColumn: `span ${Math.min(f.span ?? 12, 24)} / span ${Math.min(f.span ?? 12, 24)}` }}>
                        <SubTableButtonField field={f} rowDraft={rowDraft} setRowDraft={setRowDraft} />
                      </div>
                    );
                  }
                  return (
                  <div key={f.key} className="min-w-0 space-y-1.5 flex flex-col" style={{ gridColumn: `span ${Math.min(f.span ?? 12, 24)} / span ${Math.min(f.span ?? 12, 24)}` }}>
                    <Label className="text-sm">
                      {f.label}
                      {f.required && <span className="text-destructive ml-0.5">*</span>}
                    </Label>
                    <div>
                      <FillFieldEditor
                        field={f}
                        value={rowDraft[f.key]}
                        calcValue={rowCalc[f.key]}
                        onChange={(v) => setRowDraft((d) => ({ ...d, [f.key]: v }))}
                        onAssign={(assigned) => setRowDraft((d) => ({ ...d, ...assigned }))}
                        currentFormId={cfg?.targetFormId}
                      />
                    </div>
                  </div>
                  );
                })}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRowDialog(false)} disabled={rowSaving}>取消</Button>
            <Button onClick={() => void saveRow()} disabled={rowSaving}>{rowSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 关联子表只读回显：随主表保存的内嵌值直接渲染行快照；单独保存模式按行 id 数组拉取子表明细并按配置列展示 */
export function SubTableViewer({ field, value }: { field: FormField; value: unknown }) {
  const cfg = field.subTable;
  const inline = isInlineRefValue(value) ? value : null;
  const ids = inline ? [] : Array.isArray(value) ? (value as string[]).filter((x) => typeof x === 'string') : [];
  const idsKey = ids.join(',');
  const [childForm, setChildForm] = useState<MetaForm | null>(null);
  const [rows, setRows] = useState<BizData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!cfg?.targetFormId) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const formRes = await supabase.from('meta_forms').select('*').eq('id', cfg.targetFormId!).maybeSingle();
      const list = idsKey ? idsKey.split(',') : [];
      const rowsRes = list.length > 0 ? await supabase.from('biz_data').select('*').in('id', list).eq('is_deleted', false) : { data: [] as BizData[] | null, error: null };
      if (!alive) return;
      setChildForm((formRes.data as MetaForm | null) ?? null);
      const byId = new Map(((rowsRes.data as BizData[]) ?? []).map((r) => [r.id, r]));
      setRows(list.map((id) => byId.get(id)).filter(Boolean) as BizData[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [cfg?.targetFormId, idsKey]);

  // 内嵌行快照 → BizData 形状（系统列从 sys 还原，渲染逻辑与独立记录一致）
  const inlineRows: BizData[] = useMemo(() => (inline
    ? inline.rows.map((r, i) => ({ id: r.id ?? `inline_${i}`, form_id: cfg?.targetFormId ?? '', payload: r.payload ?? {}, status: (r.sys?.status as string) ?? 'approved', created_by: (r.sys?.created_by as string) ?? null, created_at: (r.sys?.created_at as string) ?? null, updated_by: (r.sys?.updated_by as string) ?? null, updated_at: (r.sys?.updated_at as string) ?? null } as BizData))
    : []), [inline, cfg?.targetFormId]);
  const showRows = inline ? inlineRows : rows;

  const childFields = useMemo(() => childFillFields(childForm), [childForm]);
  // 显示列候选含系统默认字段（状态/创建人/创建时间等）；未配置时默认前 3 个业务字段
  const displayFields = useMemo(() => childDisplayFields(childForm), [childForm]);
  const displayCols = useMemo(() => {
    const cols = (cfg?.displayColumns ?? []).filter((k) => displayFields.some((f) => f.key === k));
    return cols.length > 0 ? cols : displayFields.filter((f) => !f.system).slice(0, 3).map((f) => f.key);
  }, [cfg?.displayColumns, displayFields]);
  const colLabel = (key: string) => displayFields.find((f) => f.key === key)?.label ?? key;
  // 显示列含数据源下拉字段时拉取源表单记录（id → 显示文本解析，如所属项目显示项目名称而非项目 id）
  const optSrcRows = useOptionSrcRows(displayFields);
  // 勾选创建人/更新人列时批量拉取姓名（uuid → 姓名）
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const needUsers = displayCols.includes('created_by') || displayCols.includes('updated_by');
  const rowsUserKey = showRows.map((r) => [r.payload?.created_by, r.created_by, r.payload?.updated_by, r.updated_by].filter(Boolean).join(',')).join('|');
  useEffect(() => {
    if (!needUsers) { setUserNames(new Map()); return; }
    const ids = [...new Set(showRows.flatMap((r) => [r.payload?.created_by, r.created_by, r.payload?.updated_by, r.updated_by]).filter((v): v is string => !!v))];
    if (ids.length === 0) { setUserNames(new Map()); return; }
    let alive = true;
    void supabase.from('profiles').select('id, name').in('id', ids).then(({ data }) => {
      if (alive) setUserNames(new Map(((data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])));
    });
    return () => { alive = false; };
  }, [needUsers, rowsUserKey]);

  if (loading) return <div className="flex items-center justify-center py-4 text-xs text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />加载明细…</div>;
  if (!childForm) return <p className="text-xs text-muted-foreground">关联子表应用不存在或已删除</p>;
  if (showRows.length === 0) return <p className="text-xs text-muted-foreground">暂无明细</p>;
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-2.5 font-medium">#</th>
            {displayCols.map((k) => <th key={k} className="px-4 py-2.5 font-medium whitespace-nowrap">{colLabel(k)}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {showRows.map((r, i) => (
            <tr key={r.id} className="hover:bg-muted/50">
              <td className="px-3 py-3 text-muted-foreground">{i + 1}</td>
              {displayCols.map((k) => <td key={k} className="px-4 py-3 whitespace-nowrap text-foreground">{SYS_COL_KEYS.includes(k) ? sysCellText((r.payload ?? {}) as Record<string, unknown>, r as unknown as Record<string, unknown>, k, userNames) : optCellText((r.payload ?? {}) as Record<string, unknown>, k, displayFields, optSrcRows, userNames)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
