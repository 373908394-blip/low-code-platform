import type { FormField, PrintExportTemplate, TemplateFieldMapping, TemplateKind, MetaForm } from '@/types';
import { optionDisplayKeys } from '@/lib/field-catalog';
import { supabase } from '@/db/supabase';

/**
 * 预设模版定义：
 * 1. excel列表
 * 2. 报销单模板
 * 3. 借款单模板
 * 4. 物流单模板
 */
export const PRESET_TEMPLATES: Record<TemplateKind, Omit<PrintExportTemplate, 'id'>> = {
  excel_list: {
    name: 'Excel 列表导出模版',
    kind: 'excel_list',
    title: '数据列表明细表',
    subtitle: '系统导出数据',
    description: '适用于表格批量导出的通用列表模版，按列自适应输出',
    orientation: 'landscape',
    showFooter: true,
    fields: [
      { id: 'f_id', label: '序号/单号', formFieldKey: 'id', align: 'left' },
      { id: 'f_created_at', label: '创建时间', formFieldKey: 'created_at', align: 'center' },
      { id: 'f_applicant', label: '申请人/经办人', formFieldKey: 'created_by', align: 'center' },
      { id: 'f_status', label: '状态', formFieldKey: 'status', align: 'center' },
      { id: 'f_remark', label: '备注说明', formFieldKey: '__empty__', defaultValue: '', align: 'left' },
    ],
  },
  expense: {
    name: '费用报销单模版',
    kind: 'expense',
    title: '费用报销单',
    subtitle: '××科技有限公司',
    description: '经典中式报销单版式：表头信息 + 费用明细表（固定行数）+ 签字栏，适用于差旅、招待、办公等报销场景',
    orientation: 'portrait',
    showFooter: false,
    fixedItemRows: 0,
    fields: [
      // ---- 表头信息区（标签|值 四列栅格）----
      { id: 'exp_m1', label: '借款单号', formFieldKey: '__empty__', defaultValue: '', align: 'center', section: 'meta' },
      { id: 'exp_m2', label: '附单据张数', formFieldKey: '__empty__', defaultValue: '', align: 'center', section: 'meta' },
      { id: 'exp_m3', label: '报销单号', formFieldKey: 'id', align: 'center', section: 'meta' },
      { id: 'exp_m4', label: '报销人', formFieldKey: 'created_by', align: 'center', section: 'meta' },
      { id: 'exp_m5', label: '报销时间', formFieldKey: 'created_at', align: 'center', section: 'meta' },
      { id: 'exp_m6', label: '所属部门', formFieldKey: '__empty__', defaultValue: '', align: 'center', section: 'meta' },
      { id: 'exp_m7', label: '报销金额（元）', formFieldKey: '__empty__', defaultValue: '', align: 'center', section: 'meta', money: true },
      { id: 'exp_m8', label: '人民币（大写）', formFieldKey: '__empty__', defaultValue: '', align: 'center', section: 'meta', upperCase: true },
      // ---- 费用明细表列（固定 6 行，不足补空白供手写）----
      { id: 'exp_i1', label: '项目名称及编码', formFieldKey: '__empty__', defaultValue: '', align: 'left', section: 'items' },
      { id: 'exp_i2', label: '费用类别', formFieldKey: '__empty__', defaultValue: '', align: 'center', section: 'items', width: '18%' },
      { id: 'exp_i3', label: '报销项目说明', formFieldKey: '__empty__', defaultValue: '', align: 'left', section: 'items' },
      { id: 'exp_i4', label: '金额（元）', formFieldKey: '__empty__', defaultValue: '', align: 'right', section: 'items', width: '14%', money: true },
      // ---- 底部签字栏 ----
      { id: 'exp_s1', label: '报销人签字：', formFieldKey: '__empty__', defaultValue: '', align: 'left', section: 'sign' },
      { id: 'exp_s2', label: '项目经理审核签字：', formFieldKey: '__empty__', defaultValue: '', align: 'left', section: 'sign' },
      { id: 'exp_s3', label: '部门经理审核签字：', formFieldKey: '__empty__', defaultValue: '', align: 'left', section: 'sign' },
      { id: 'exp_s4', label: '财务审核人签字：', formFieldKey: '__empty__', defaultValue: '', align: 'left', section: 'sign' },
      { id: 'exp_s5', label: '总经理室签字：', formFieldKey: '__empty__', defaultValue: '', align: 'left', section: 'sign' },
    ],
  },
  loan: {
    name: '借款申请单模版',
    kind: 'loan',
    title: '员工借款申请单',
    subtitle: '财务备用金/业务借款专用单据',
    description: '适用于备用金、业务预支款的标准借款审批单',
    orientation: 'portrait',
    showFooter: true,
    fields: [
      { id: 'loan_1', label: '借款单号', formFieldKey: 'id', align: 'left' },
      { id: 'loan_2', label: '借款人', formFieldKey: 'created_by', align: 'left' },
      { id: 'loan_3', label: '申请日期', formFieldKey: 'created_at', align: 'center' },
      { id: 'loan_4', label: '借款金额(大写)', formFieldKey: '__empty__', defaultValue: '', align: 'left' },
      { id: 'loan_5', label: '借款金额(小写)', formFieldKey: '__empty__', defaultValue: '0.00', align: 'right' },
      { id: 'loan_6', label: '借款事由', formFieldKey: '__empty__', defaultValue: '', align: 'left' },
      { id: 'loan_7', label: '预计还款/冲账日期', formFieldKey: '__empty__', defaultValue: '', align: 'center' },
      { id: 'loan_8', label: '领款人签名', formFieldKey: '__empty__', defaultValue: '', align: 'center' },
      { id: 'loan_9', label: '部门审批', formFieldKey: '__empty__', defaultValue: '', align: 'center' },
      { id: 'loan_10', label: '总经理审批', formFieldKey: '__empty__', defaultValue: '', align: 'center' },
    ],
  },
  logistics: {
    name: '物流发货单模版',
    kind: 'logistics',
    title: '仓储物流发运单',
    subtitle: '出库配送与收货凭证',
    description: '适用于仓库发货、收件确认的物流凭单',
    orientation: 'portrait',
    showFooter: true,
    fields: [
      { id: 'log_1', label: '运单号/配送单号', formFieldKey: 'id', align: 'left' },
      { id: 'log_2', label: '发运日期', formFieldKey: 'created_at', align: 'center' },
      { id: 'log_3', label: '收货人姓名', formFieldKey: '__empty__', defaultValue: '', align: 'left' },
      { id: 'log_4', label: '联系电话', formFieldKey: '__empty__', defaultValue: '', align: 'left' },
      { id: 'log_5', label: '收货地址', formFieldKey: '__empty__', defaultValue: '', align: 'left' },
      { id: 'log_6', label: '货物名称/规格', formFieldKey: '__empty__', defaultValue: '', align: 'left' },
      { id: 'log_7', label: '件数/重量', formFieldKey: '__empty__', defaultValue: '1 件', align: 'center' },
      { id: 'log_8', label: '承运物流公司', formFieldKey: '__empty__', defaultValue: '顺丰速运', align: 'left' },
      { id: 'log_9', label: '发货人/仓管员', formFieldKey: '__empty__', defaultValue: '', align: 'center' },
      { id: 'log_10', label: '收货人签字/签收日期', formFieldKey: '__empty__', defaultValue: '', align: 'center' },
    ],
  },
  custom: {
    name: '自定义单据模版',
    kind: 'custom',
    title: '业务单据凭证',
    subtitle: '',
    description: '自由配置表头和字段映射的空白单据模版',
    orientation: 'portrait',
    showFooter: true,
    fields: [
      { id: 'cus_1', label: '单号', formFieldKey: 'id', align: 'left' },
      { id: 'cus_2', label: '日期', formFieldKey: 'created_at', align: 'center' },
      { id: 'cus_3', label: '经办人', formFieldKey: 'created_by', align: 'left' },
    ],
  },
};

/** 生成新的模板实例（forms 用于解析子表字段，绑定格式为 subKey.childKey） */
export function createTemplateFromPreset(kind: TemplateKind, availableFields: FormField[] = [], forms: MetaForm[] = []): PrintExportTemplate {
  const base = PRESET_TEMPLATES[kind];
  const tplId = 'tpl_' + Math.random().toString(36).slice(2, 10);

  // 候选匹配源：主表字段 + 各关联子表字段（key 形如 子表key.子字段key）
  const candidates: { key: string; label: string }[] = availableFields.map((af) => ({ key: af.key, label: af.label }));
  for (const sf of availableFields.filter((f) => f.type === 'sub-table' && !!f.subTable?.targetFormId)) {
    const target = forms.find((g) => g.id === sf.subTable?.targetFormId);
    for (const cf of target?.schema_json?.fields ?? []) {
      if (['section', 'row', 'sub-table', 'form-ref', 'query', 'wizard-step', 'action-button'].includes(cf.type)) continue;
      candidates.push({ key: `${sf.key}.${cf.key}`, label: cf.label });
    }
  }

  // 尝试根据表单字段名称智能推断匹配
  const matchedFields: TemplateFieldMapping[] = base.fields.map((f) => {
    let matchedKey: string | undefined = f.formFieldKey;
    if (matchedKey === '__empty__' && candidates.length > 0) {
      const candidate = candidates.find((af) =>
        af.label.includes(f.label) || f.label.includes(af.label) ||
        (f.label.includes('人') && (af.key.includes('user') || af.key.includes('name') || af.key.includes('person'))) ||
        (f.label.includes('金额') && (af.key.includes('amount') || af.key.includes('money') || af.key.includes('price') || af.key.includes('total'))) ||
        (f.label.includes('事由') && (af.key.includes('reason') || af.key.includes('remark') || af.key.includes('desc'))) ||
        (f.label.includes('说明') && (af.key.includes('remark') || af.key.includes('desc') || af.key.includes('note'))) ||
        (f.label.includes('类别') && (af.key.includes('category') || af.key.includes('type'))) ||
        (f.label.includes('项目') && (af.key.includes('project') || af.key.includes('item'))) ||
        (f.label.includes('部门') && (af.key.includes('dept') || af.key.includes('department'))) ||
        (f.label.includes('电话') && (af.key.includes('phone') || af.key.includes('tel') || af.key.includes('mobile')))
      );
      if (candidate) {
        matchedKey = candidate.key;
      }
    }
    return {
      ...f,
      id: 'f_' + Math.random().toString(36).slice(2, 8),
      formFieldKey: matchedKey,
    };
  });

  // 大写金额字段与「报销金额（元）」绑定同一表单字段，保证大小写联动一致
  const moneyField = matchedFields.find((f) => f.money && f.formFieldKey && f.formFieldKey !== '__empty__');
  if (moneyField) {
    matchedFields.forEach((f) => {
      if (f.upperCase && (!f.formFieldKey || f.formFieldKey === '__empty__')) {
        f.formFieldKey = moneyField.formFieldKey;
      }
    });
  }

  return {
    ...base,
    id: tplId,
    fields: matchedFields,
  };
}

/** 子表行（物化后的统一结构） */
export interface SubTableLine {
  id?: string;
  payload: Record<string, unknown>;
  sys?: Record<string, unknown>;
}

/**
 * 从记录中读取子表行数组：支持 with-main 内嵌快照（{__inline, rows}）、草稿值（{rows}）；
 * standalone 模式 payload 中为行 id 数组，需先经 materializeSubTables 物化
 */
export function getSubTableRows(row: Record<string, unknown>, subKey: string): SubTableLine[] {
  const holder = (row.payload && typeof row.payload === 'object' ? row.payload : row) as Record<string, unknown>;
  const v = holder[subKey];
  if (!v) return [];
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    if (typeof v[0] === 'string') return []; // standalone 行 id 数组（未物化）
    return v as SubTableLine[];
  }
  if (typeof v === 'object') {
    const rows = (v as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as SubTableLine[];
  }
  return [];
}

/** 物化 standalone 子表：将 payload 中的行 id 数组批量查询替换为内嵌快照，供打印/导出按子表行展开 */
export async function materializeSubTables(rows: Record<string, unknown>[], formFields: FormField[]): Promise<Record<string, unknown>[]> {
  const subFields = formFields.filter((f) => f.type === 'sub-table' && !!f.subTable?.targetFormId);
  if (subFields.length === 0 || rows.length === 0) return rows;
  const result = rows.map((r) =>
    r.payload && typeof r.payload === 'object'
      ? { ...r, payload: { ...(r.payload as Record<string, unknown>) } }
      : { ...r }
  );
  for (const row of result) {
    const holder = (row.payload && typeof row.payload === 'object' ? row.payload : row) as Record<string, unknown>;
    for (const sf of subFields) {
      const v = holder[sf.key];
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') {
        const { data } = await supabase
          .from('biz_data')
          .select('id, payload, status, created_by, created_at')
          .in('id', v)
          .eq('is_deleted', false);
        holder[sf.key] = {
          __inline: true,
          rows: (data ?? []).map((d) => ({
            id: d.id as string,
            payload: (d.payload ?? {}) as Record<string, unknown>,
            sys: d as Record<string, unknown>,
          })),
        };
      }
    }
  }
  return result;
}

/** 打印/导出显示值解析上下文（BizApp 传入现成的成员/部门映射，测试打印可省略自动查询） */
export interface PrintResolveCtx {
  userMap?: Map<string, string>;
  deptMap?: Map<string, string>;
  profileMap?: Map<string, { name: string; position?: string | null; department_id?: string | null }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isIdLike = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** 按显示字段配置把目标记录序列化为可读文本（created_by 解析为成员姓名） */
function recordDisplayText(rec: { payload?: Record<string, unknown>; created_by?: string; updated_by?: string; created_at?: string; updated_at?: string }, keys: string[], userMap: Map<string, string>): string {
  const parts = keys.map((k) => {
    if (k === 'created_by' || k === 'updated_by') return userMap.get(String(rec[k] ?? '')) || '';
    if (k === 'created_at' || k === 'updated_at') {
      const d = new Date(String(rec[k] ?? ''));
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN');
    }
    const v = rec.payload?.[k];
    return v === undefined || v === null ? '' : String(v);
  }).filter(Boolean);
  return parts.join('-');
}

/**
 * 打印/导出前预解析显示值（在副本上替换，不改原数据）：
 * - created_by/updated_by、user-select → 成员姓名；dept-select → 部门名称
 * - 关联选项字段（select/form-ref 等带 optionSource 的字段，含子表子字段）→ 目标记录按显示字段拼接的文本
 */
export async function resolveDisplayRows(
  rows: Record<string, unknown>[],
  formFields: FormField[],
  forms: MetaForm[],
  ctx: PrintResolveCtx = {},
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;

  // 全部待解析字段：主表字段 + 各子表子字段
  const resolvable: { key: string; def: FormField }[] = [];
  for (const f of formFields) {
    if (f.type === 'sub-table' && f.subTable?.targetFormId) {
      let target = forms.find((g) => g.id === f.subTable?.targetFormId);
      if (!target) {
        const { data } = await supabase.from('meta_forms').select('id, schema_json').eq('id', f.subTable.targetFormId).maybeSingle();
        target = data as MetaForm | undefined;
      }
      for (const cf of target?.schema_json?.fields ?? []) {
        if (['section', 'row', 'sub-table', 'form-ref', 'query', 'wizard-step', 'action-button'].includes(cf.type)) continue;
        resolvable.push({ key: `${f.key}.${cf.key}`, def: cf });
      }
    } else {
      resolvable.push({ key: f.key, def: f });
    }
  }
  const optionFields = resolvable.filter(({ def }) => !!def.optionSource?.formId && optionDisplayKeys(def).length > 0);

  const readVal = (row: Record<string, unknown>, key: string): unknown[] => {
    if (key.includes('.')) {
      const sk = key.slice(0, key.indexOf('.'));
      const ck = key.slice(key.indexOf('.') + 1);
      return getSubTableRows(row, sk).map((sr) => sr.payload?.[ck]);
    }
    const holder = (row.payload && typeof row.payload === 'object' ? row.payload : row) as Record<string, unknown>;
    return [holder[key], row[key]];
  };

  const userMap = new Map(ctx.userMap ?? []);
  const deptMap = new Map(ctx.deptMap ?? []);
  const profileMap = new Map(ctx.profileMap ?? []);
  const userIds = new Set<string>();
  const deptIds = new Set<string>();
  const optIdsByForm = new Map<string, Set<string>>();
  for (const row of rows) {
    if (isIdLike(row.created_by)) userIds.add(row.created_by as string);
    if (isIdLike(row.updated_by)) userIds.add(row.updated_by as string);
    for (const { key, def } of resolvable) {
      const vals = readVal(row, key);
      (Array.isArray(vals) ? vals : [vals]).forEach((v) => {
        const list = Array.isArray(v) ? v : [v];
        if (def.type === 'user-select' || key === 'created_by' || key === 'updated_by') {
          list.forEach((x) => isIdLike(x) && userIds.add(x));
        } else if (def.type === 'dept-select') {
          list.forEach((x) => isIdLike(x) && deptIds.add(x));
        }
      });
    }
    for (const { key, def } of optionFields) {
      const fid = def.optionSource!.formId;
      const vals = readVal(row, key);
      (Array.isArray(vals) ? vals : [vals]).forEach((v) => {
        (Array.isArray(v) ? v : [v]).forEach((x) => {
          if (isIdLike(x)) {
            if (!optIdsByForm.has(fid)) optIdsByForm.set(fid, new Set());
            optIdsByForm.get(fid)!.add(x);
          }
        });
      });
    }
  }

  // 查询人员及所在部门信息
  if (userIds.size > 0) {
    const { data } = await supabase.from('profiles').select('id, name, department_id, position').in('id', [...userIds]);
    (data ?? []).forEach((p: { id: string; name: string; department_id?: string | null; position?: string | null }) => {
      userMap.set(p.id, p.name);
      profileMap.set(p.id, { name: p.name, department_id: p.department_id, position: p.position });
      if (p.department_id && isIdLike(p.department_id)) deptIds.add(p.department_id);
    });
  }
  if (deptIds.size > 0) {
    const { data } = await supabase.from('departments').select('id, name').in('id', [...deptIds]);
    (data ?? []).forEach((d: { id: string; name: string }) => deptMap.set(d.id, d.name));
  }
  const optTextByForm = new Map<string, Map<string, string>>();
  for (const [fid, ids] of optIdsByForm) {
    const { data } = await supabase.from('biz_data').select('id, payload, created_by').eq('form_id', fid).eq('is_deleted', false).in('id', [...ids]);
    const sample = optionFields.find(({ def }) => def.optionSource?.formId === fid);
    const dispKeys = sample ? optionDisplayKeys(sample.def) : [];
    const m = new Map<string, string>();
    (data ?? []).forEach((r: { id: string; payload?: Record<string, unknown>; created_by?: string }) => {
      m.set(r.id, recordDisplayText(r, dispKeys, userMap) || r.id);
    });
    optTextByForm.set(fid, m);
  }

  const resolveOne = (def: FormField, key: string, v: unknown): unknown => {
    if (v === undefined || v === null || v === '') return v;
    if (def.type === 'user-select' || key === 'created_by' || key === 'updated_by') {
      const map = (x: unknown) => (isIdLike(x) ? userMap.get(x) ?? x : x);
      return Array.isArray(v) ? v.map(map).join('、') : map(v);
    }
    if (def.type === 'dept-select') {
      const map = (x: unknown) => (isIdLike(x) ? deptMap.get(x) ?? x : x);
      return Array.isArray(v) ? v.map(map).join('、') : map(v);
    }
    if (def.optionSource?.formId) {
      const m = optTextByForm.get(def.optionSource.formId);
      if (!m) return v;
      const map = (x: unknown) => (isIdLike(x) ? m.get(x) ?? x : x);
      return Array.isArray(v) ? v.map(map).join('、') : map(v);
    }
    return v;
  };

  return rows.map((r) => {
    const row = r.payload && typeof r.payload === 'object' ? { ...r, payload: { ...(r.payload as Record<string, unknown>) } } : { ...r };
    const holder = (row.payload && typeof row.payload === 'object' ? row.payload : row) as Record<string, unknown>;
    const rowRec = row as Record<string, unknown>;
    const creatorId = String(rowRec.created_by || holder.created_by || '');
    const prof = creatorId ? profileMap.get(creatorId) : undefined;
    const derivedDeptName = prof?.department_id ? deptMap.get(prof.department_id) : undefined;
    const derivedUserName = prof?.name || (creatorId ? userMap.get(creatorId) : undefined);
    const derivedPosition = prof?.position;

    // 自动派生系统虚拟字段
    if (!holder.dept_name && derivedDeptName) holder.dept_name = derivedDeptName;
    if (!(row as Record<string, unknown>).dept_name && derivedDeptName) (row as Record<string, unknown>).dept_name = derivedDeptName;
    if (!holder.user_name && derivedUserName) holder.user_name = derivedUserName;
    if (!(row as Record<string, unknown>).user_name && derivedUserName) (row as Record<string, unknown>).user_name = derivedUserName;
    if (!holder.position && derivedPosition) holder.position = derivedPosition;
    if (!(row as Record<string, unknown>).position && derivedPosition) (row as Record<string, unknown>).position = derivedPosition;

    for (const { key, def } of resolvable) {
      if (key.includes('.')) {
        const sk = key.slice(0, key.indexOf('.'));
        const ck = key.slice(key.indexOf('.') + 1);
        const subVal = holder[sk];
        const rowsArr = subVal && typeof subVal === 'object' ? (subVal as { rows?: { payload?: Record<string, unknown> }[] }).rows : null;
        if (Array.isArray(rowsArr)) {
          const isInline = (subVal as { __inline?: boolean }).__inline === true;
          holder[sk] = {
            ...(isInline ? { __inline: true } : {}),
            rows: rowsArr.map((sr) => ({ ...sr, payload: { ...(sr.payload ?? {}), [ck]: resolveOne(def, ck, sr.payload?.[ck]) } })),
          };
        }
      } else {
        const rec = row as Record<string, unknown>;
        if (holder[key] !== undefined) holder[key] = resolveOne(def, key, holder[key]);
        if (rec[key] !== undefined) rec[key] = resolveOne(def, key, rec[key]);
      }
    }
    return row;
  });
}

/** 人民币金额转中文大写（如 666.2 → 陆佰陆拾陆元贰角零分） */
export function toChineseUpper(input: number | string): string {
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(/[¥,\s]/g, ''));
  if (isNaN(n) || n < 0) return '';
  const digits = '零壹贰叁肆伍陆柒捌玖';
  const intUnits = ['', '拾', '佰', '仟'];
  const groupUnits = ['', '万', '亿', '万亿'];

  const fixed = Math.round(n * 100) / 100;
  const intPart = Math.floor(fixed);
  const jiao = Math.floor((fixed - intPart) * 10);
  const fen = Math.round((fixed - intPart) * 100) % 10;

  // 整数部分转大写
  let intStr = '';
  if (intPart === 0) {
    intStr = '零';
  } else {
    let num = intPart;
    let groupIdx = 0;
    let pendingZero = false;
    while (num > 0) {
      const seg = num % 10000;
      if (seg === 0) {
        if (intStr.length > 0) pendingZero = true;
      } else {
        let segStr = '';
        let zeroFlag = false;
        const segDigits: number[] = [];
        let tmp = seg;
        while (tmp > 0) { segDigits.push(tmp % 10); tmp = Math.floor(tmp / 10); }
        for (let i = segDigits.length - 1; i >= 0; i--) {
          const d = segDigits[i];
          if (d === 0) { zeroFlag = true; } else {
            if (zeroFlag) { segStr += '零'; zeroFlag = false; }
            segStr += digits[d] + intUnits[i];
          }
        }
        if (pendingZero || (intStr.length > 0 && seg < 1000)) segStr = '零' + segStr;
        pendingZero = false;
        intStr = segStr + groupUnits[groupIdx] + intStr;
      }
      num = Math.floor(num / 10000);
      groupIdx++;
    }
  }

  // 小数部分：角/分（参照标准报销单样式，无小数补「整」，有分补零分）
  let decStr = '';
  if (jiao === 0 && fen === 0) {
    decStr = '整';
  } else {
    if (jiao > 0) decStr += digits[jiao] + '角';
    else if (fen > 0) decStr += '零';
    if (fen > 0) decStr += digits[fen] + '分';
    else decStr += '零分';
  }
  return intStr + '元' + decStr;
}

/** 金额千分位格式化：1234567.8 → ¥1,234,567.80 */
export function formatMoney(input: unknown): string {
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(/[¥,\s]/g, ''));
  if (isNaN(n)) return String(input ?? '');
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 格式化单元格值 */
export function resolveCellValue(
  mapping: TemplateFieldMapping,
  row: Record<string, unknown> | null | undefined,
  fieldDefMap: Map<string, FormField>
): string {
  if (!row) return mapping.defaultValue || '-';
  const label = (mapping.label || '').trim();
  const key = mapping.formFieldKey;
  const payload = (row.payload && typeof row.payload === 'object' ? row.payload : undefined) as Record<string, unknown> | undefined;

  // 子表字段绑定（形如 subKey.childKey）：金额/大写字段对全部子行求和（总金额联动），其余拼接子行取值
  if (key && key.includes('.')) {
    const dotIdx = key.indexOf('.');
    const subKey = key.slice(0, dotIdx);
    const childKey = key.slice(dotIdx + 1);
    const vals = getSubTableRows(row, subKey)
      .map((sr) => sr.payload?.[childKey])
      .filter((v) => v !== undefined && v !== null && v !== '');
    if (vals.length > 0) {
      if (mapping.money || mapping.upperCase) {
        const nums = vals.map((v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[¥,\s]/g, '')))).filter((n) => !isNaN(n));
        if (nums.length > 0) {
          const total = Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
          return mapping.upperCase ? toChineseUpper(total) : formatMoney(total);
        }
      }
      const joined = vals.length === 1 ? vals[0] : vals.map((v) => String(v)).join('、');
      return resolveCellValue({ ...mapping, formFieldKey: childKey }, { [childKey]: joined }, fieldDefMap);
    }
  }

  // 1. 常规取值：优先 top-level，其次 payload
  let raw: unknown = undefined;
  if (key && key !== '__empty__') {
    raw = row[key] !== undefined ? row[key] : payload?.[key];
  }

  // 2. 语义与常见单据标签智能兜底（针对报销单等特定业务场景，当映射为空或未匹配到有效值时自动补齐）
  if (raw === undefined || raw === null || raw === '') {
    if (label.includes('报销单号') || label.includes('单据编号') || label.includes('单号')) {
      raw = payload?.bao_xiao_dan_bian_hao ?? row.bao_xiao_dan_bian_hao ?? payload?.apply_no ?? payload?.bill_no ?? row.id;
    } else if (label.includes('报销人') || label.includes('申请人') || label.includes('经办人')) {
      raw = row.user_name ?? payload?.user_name ?? row.created_by ?? payload?.created_by;
    } else if (label.includes('报销时间') || label.includes('报销日期') || label.includes('申请日期') || label.includes('申请时间')) {
      raw = payload?.bao_xiao_ri_qi ?? row.bao_xiao_ri_qi ?? payload?.apply_date ?? row.created_at;
    } else if (label.includes('部门') || label.includes('所属部门')) {
      raw = row.dept_name ?? payload?.dept_name ?? payload?.department;
    } else if (label.includes('单据张数') || label.includes('附单据') || label.includes('发票张数')) {
      raw = payload?.dan_ju_zhang_shu ?? row.dan_ju_zhang_shu ?? payload?.invoice_count;
    } else if (label.includes('报销金额') || label.includes('总金额') || (mapping.money && label.includes('金额'))) {
      raw = payload?.zong_jin_e ?? row.zong_jin_e ?? payload?.total_amount ?? payload?.amount;
      // 若无总金额，自动对全部子表的金额字段求和兜底
      if (raw === undefined || raw === null || raw === '') {
        const subObj = Object.values(payload ?? {}).find((v) => v && typeof v === 'object' && Array.isArray((v as { rows?: unknown[] }).rows));
        if (subObj) {
          const subRows = (subObj as { rows: { payload?: Record<string, unknown> }[] }).rows;
          const subSums = subRows
            .map((sr) => sr.payload?.bao_xiao_jin_e ?? sr.payload?.amount ?? sr.payload?.jin_e)
            .filter((v) => v !== undefined && v !== null && v !== '')
            .map((v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[¥,\s]/g, ''))))
            .filter((n) => !isNaN(n));
          if (subSums.length > 0) {
            raw = Math.round(subSums.reduce((a, b) => a + b, 0) * 100) / 100;
          }
        }
      }
    } else if (label.includes('大写') || mapping.upperCase) {
      raw = payload?.da_xie_jin_e ?? row.da_xie_jin_e;
      if (!raw) {
        // 大写金额自动联动报销金额
        const numVal = payload?.zong_jin_e ?? row.zong_jin_e ?? payload?.total_amount ?? payload?.amount;
        if (numVal !== undefined && numVal !== null && numVal !== '') {
          raw = toChineseUpper(typeof numVal === 'number' ? numVal : String(numVal));
        } else {
          // 尝试子表求和转换
          const subObj = Object.values(payload ?? {}).find((v) => v && typeof v === 'object' && Array.isArray((v as { rows?: unknown[] }).rows));
          if (subObj) {
            const subRows = (subObj as { rows: { payload?: Record<string, unknown> }[] }).rows;
            const subSums = subRows
              .map((sr) => sr.payload?.bao_xiao_jin_e ?? sr.payload?.amount ?? sr.payload?.jin_e)
              .filter((v) => v !== undefined && v !== null && v !== '')
              .map((v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[¥,\s]/g, ''))))
              .filter((n) => !isNaN(n));
            if (subSums.length > 0) {
              const sum = Math.round(subSums.reduce((a, b) => a + b, 0) * 100) / 100;
              raw = toChineseUpper(sum);
            }
          }
        }
      }
    }
  }

  if (raw === undefined || raw === null || raw === '') {
    return mapping.defaultValue || '';
  }
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  // 日期格式优化（仅在包含 ISO 时间字符串时格式化，标准 YYYY-MM-DD 原样返回）
  if (typeof raw === 'string' && (raw.includes('T') || raw.includes(':')) && (key?.includes('created_at') || key?.includes('updated_at') || key?.includes('date') || key?.includes('time') || label.includes('时间') || label.includes('日期'))) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    }
  }
  // 人民币大写金额（若当前值本身不是汉字大写，则转换）
  if (mapping.upperCase) {
    return typeof raw === 'string' && /[元整拾佰仟万]/.test(raw) ? raw : toChineseUpper(typeof raw === 'number' ? raw : String(raw));
  }
  // 金额千分位格式化
  if (mapping.money) {
    return formatMoney(raw);
  }
  return String(raw);
}

/** 构建用于浏览器打印的独立 HTML 窗口内容 */
export function buildPrintHtml(
  template: PrintExportTemplate,
  rows: Record<string, unknown>[],
  formFields: FormField[]
): string {
  const fieldDefMap = new Map(formFields.map((f) => [f.key, f]));
  const isLandscape = template.orientation === 'landscape';

  // 针对 excel_list 采用表格排版；其他单据模式针对单条或多条记录采用表单卡片排版
  const renderContent = () => {
    if (template.kind === 'excel_list') {
      return `
        <table class="grid-table">
          <thead>
            <tr>
              ${template.fields.map((f) => `<th style="text-align: ${f.align || 'left'}">${escapeHtml(f.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${template.fields.map((f) => `<td style="text-align: ${f.align || 'left'}">${escapeHtml(resolveCellValue(f, row, fieldDefMap))}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    // ---- 单据版式：按 section 分区渲染（meta 表头 / items 明细表 / sign 签字栏）----
    const metaFields = template.fields.filter((f) => (f.section ?? 'meta') === 'meta');
    const itemFields = template.fields.filter((f) => f.section === 'items');
    const signFields = template.fields.filter((f) => f.section === 'sign');

    // 渲染表头信息区：标签|值|标签|值 四列栅格
    const renderMetaTable = (row: Record<string, unknown>) => {
      if (metaFields.length === 0) return '';
      return `
        <table class="meta-table">
          <tbody>
            ${chunkFields(metaFields, 2).map((pair) => `
              <tr>
                <td class="lbl">${escapeHtml(pair[0].label)}</td>
                <td class="val" style="text-align: ${pair[0].align || 'center'}">${escapeHtml(resolveCellValue(pair[0], row, fieldDefMap))}</td>
                ${pair[1] ? `
                  <td class="lbl">${escapeHtml(pair[1].label)}</td>
                  <td class="val" style="text-align: ${pair[1].align || 'center'}">${escapeHtml(resolveCellValue(pair[1], row, fieldDefMap))}</td>
                ` : `
                  <td class="lbl"></td>
                  <td class="val"></td>
                `}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };

    // 渲染费用/货物明细表：序号 + 明细列；绑定子表字段（subKey.childKey）时按子表行逐行展开；
    // 有几条明细显示几条，不补空白行（打印所见即单据实际内容）
    const renderItemsTable = (row: Record<string, unknown>) => {
      if (itemFields.length === 0) return '';
      const subBound = itemFields.find((f) => (f.formFieldKey || '').includes('.'));
      let dataRows: Record<string, unknown>[];
      let lineFields = itemFields;
      if (subBound?.formFieldKey) {
        const subKey = subBound.formFieldKey.slice(0, subBound.formFieldKey.indexOf('.'));
        dataRows = getSubTableRows(row, subKey).map((sr) => ({ ...(sr.payload ?? {}) }));
        // 同一子表的绑定降级为子字段 key，直接在子行 payload 上取值
        lineFields = itemFields.map((f) => {
          const k = f.formFieldKey || '';
          return k.startsWith(subKey + '.') ? { ...f, formFieldKey: k.slice(subKey.length + 1) } : f;
        });
      } else {
        dataRows = [row];
      }
      return `
        <table class="items-table">
          <thead>
            <tr>
              <th class="idx-col">序号</th>
              ${lineFields.map((f) => `<th style="text-align: ${f.align || 'left'}; ${f.width ? `width: ${f.width};` : ''}">${escapeHtml(f.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${dataRows.map((r, i) => `
              <tr>
                <td class="idx-col">${i + 1}</td>
                ${lineFields.map((f) => `<td style="text-align: ${f.align || 'left'}">${escapeHtml(resolveCellValue(f, r, fieldDefMap))}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };

    // 渲染底部签字栏：每行 3 格（参照经典报销单样式），不足时末格合并留白供手写签字
    const renderSignTable = () => {
      if (signFields.length === 0) return '';
      return `
        <table class="sign-table">
          <tbody>
            ${chunkFields(signFields, 3).map((group) => `
              <tr>
                ${group.map((f, i) => `<td${group.length === 1 ? ' colspan="3"' : group.length === 2 && i === 1 ? ' colspan="2"' : ''}>${escapeHtml(f.label)}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };

    // 每行记录一张单据；无分区信息的老模板回退为两列表单卡片
    const hasSections = itemFields.length > 0 || signFields.length > 0;
    if (!hasSections) {
      return rows.map((row, idx) => `
        <div class="sheet-container ${idx > 0 ? 'page-break' : ''}">
          <div class="sheet-header">
            <h1 class="sheet-title">${escapeHtml(template.title)}</h1>
            ${template.subtitle ? `<p class="sheet-subtitle">${escapeHtml(template.subtitle)}</p>` : ''}
            <div class="sheet-meta">
              <span>打印时间：${new Date().toLocaleString('zh-CN')}</span>
              <span>单据编号：#${idx + 1}</span>
            </div>
          </div>
          <table class="form-sheet-table">
            <tbody>
              ${chunkFields(template.fields, 2).map((pair) => `
                <tr>
                  <td class="lbl">${escapeHtml(pair[0].label)}</td>
                  <td class="val" ${pair.length === 1 ? 'colspan="3"' : ''}>${escapeHtml(resolveCellValue(pair[0], row, fieldDefMap))}</td>
                  ${pair.length > 1 ? `
                    <td class="lbl">${escapeHtml(pair[1].label)}</td>
                    <td class="val">${escapeHtml(resolveCellValue(pair[1], row, fieldDefMap))}</td>
                  ` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${template.showFooter ? `
            <div class="sheet-footer">
              <div class="sign-box">经手人：____________</div>
              <div class="sign-box">审核人：____________</div>
              <div class="sign-box">审批人：____________</div>
              <div class="sign-box">盖章：____________</div>
            </div>
          ` : ''}
        </div>
      `).join('');
    }

    // 经典单据版式（报销单样式）：公司名+标题一行居中 → 表头信息区 → 明细表 → 签字栏
    return rows.map((row, idx) => `
      <div class="sheet-container ${idx > 0 ? 'page-break' : ''}">
        <h1 class="doc-title">${escapeHtml((template.subtitle || '') + template.title)}</h1>
        ${renderMetaTable(row)}
        ${renderItemsTable(row)}
        ${renderSignTable()}
      </div>
    `).join('');
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(template.name)} - 打印预览</title>
  <style>
    @page {
      size: A5 landscape;
      margin: 14mm 8mm 8mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      color: #111827;
      background: #fff;
      margin: 0;
      padding: 34px 12px 12px;
      font-size: 13px;
      line-height: 1.4;
    }
    .page-break { page-break-before: always; }
    .sheet-container {
      width: 100%;
      max-width: 194mm;
      margin: 0 auto 20px auto;
      padding: 0;
      box-sizing: border-box;
    }
    .sheet-header { text-align: center; margin-bottom: 12px; border-bottom: 2px solid #111827; padding-bottom: 6px; }
    .sheet-title { font-size: 20px; font-weight: bold; margin: 0 0 4px 0; letter-spacing: 2px; }
    .sheet-subtitle { font-size: 12px; color: #4b5563; margin: 0 0 4px 0; }
    .sheet-meta { display: flex; justify-content: space-between; font-size: 11px; color: #6b7280; padding: 0 4px; }
    
    .grid-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .grid-table th { background: #f3f4f6; border: 1px solid #d1d5db; padding: 8px 10px; font-weight: 600; font-size: 12px; }
    .grid-table td { border: 1px solid #d1d5db; padding: 7px 10px; font-size: 12px; }
    .grid-table tr:nth-child(even) { background: #fafafa; }

    .form-sheet-table { width: 100%; border-collapse: collapse; margin-top: 8px; border: 1.5px solid #111827; }
    .form-sheet-table td { border: 1px solid #9ca3af; padding: 8px 10px; min-height: 32px; }
    .form-sheet-table td.lbl { background: #f9fafb; font-weight: 600; width: 18%; color: #374151; }
    .form-sheet-table td.val { width: 32%; word-break: break-all; }

    /* ---- 经典单据版式（报销单样式：A4纸张一半 / A5，四周边框严密封口）---- */
    .doc-title {
      text-align: center;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 3px;
      margin: 0 0 10px 0;
      color: #111;
    }
    .meta-table, .items-table, .sign-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      box-sizing: border-box;
      border-left: 1.5px solid #111;
      border-right: 1.5px solid #111;
    }
    .meta-table { border-top: 1.5px solid #111; }
    .meta-table td {
      border: 1px solid #111;
      padding: 6px 10px;
      font-size: 13px;
      height: 30px;
      box-sizing: border-box;
    }
    .meta-table td.lbl { width: 15%; font-weight: 600; text-align: center; color: #111; background: #fff; white-space: nowrap; }
    .meta-table td.val { width: 35%; color: #111; }

    .items-table { margin-top: 0; }
    .items-table th, .items-table td {
      border: 1px solid #111;
      padding: 6px 8px;
      font-size: 12.5px;
      color: #111;
      box-sizing: border-box;
    }
    .items-table th { background: #fff; font-weight: 600; white-space: nowrap; height: 32px; }
    .items-table td { height: 34px; }
    .items-table .idx-col, .items-table th.idx-col { width: 50px; text-align: center; white-space: nowrap; }

    .sign-table { margin-top: 0; border-bottom: 1.5px solid #111; }
    .sign-table td {
      border: 1px solid #111;
      padding: 8px 10px;
      font-size: 12.5px;
      color: #111;
      height: 60px;
      vertical-align: top;
      width: 33.33%;
      box-sizing: border-box;
    }

    .sheet-footer { display: flex; justify-content: space-between; margin-top: 16px; padding: 0 8px; font-size: 12px; }
    .sign-box { min-width: 120px; }
    @media print {
      body { padding: 0; margin: 0; }
      .sheet-container {
        width: 194mm;
        margin: 0 auto;
        page-break-after: always;
      }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  ${renderContent()}
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 250);
    };
  </script>
</body>
</html>
  `;
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function chunkFields<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

/** 执行浏览器原生打印预览弹窗 */
export function triggerBrowserPrint(template: PrintExportTemplate, rows: Record<string, unknown>[], fields: FormField[]): void {
  const html = buildPrintHtml(template, rows, fields);
  const win = window.open('', '_blank');
  if (!win) {
    alert('无法打开打印窗口，请检查是否被浏览器拦截弹窗');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/** 调用 Edge Function 生成并下载 Excel 文件 */
export async function downloadExcelViaEdgeFunction(params: {
  template: PrintExportTemplate;
  rows: Record<string, unknown>[];
  fields: FormField[];
  fileName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { template, rows, fields, fileName } = params;
    const fieldDefMap = new Map(fields.map((f) => [f.key, f]));

    // 格式化导出的表头与每行数据（签字栏为打印专用，Excel 导出自动跳过）
    const exportFields = template.fields.filter((f) => (f.section ?? 'meta') !== 'sign');
    const columns = exportFields.map((f) => ({
      key: f.id,
      label: f.label,
      align: f.align || 'left',
    }));

    // 明细列绑定子表字段时，每个主记录按子表行展开为多条 Excel 行
    const subBoundField = exportFields.find((f) => (f.formFieldKey || '').includes('.'));
    let data: Record<string, string>[];
    if (subBoundField?.formFieldKey) {
      const subKey = subBoundField.formFieldKey.slice(0, subBoundField.formFieldKey.indexOf('.'));
      const metaFields = exportFields.filter((f) => !(f.formFieldKey || '').includes('.'));
      const subItemFields = exportFields.filter((f) => (f.formFieldKey || '').includes('.'));
      data = [];
      for (const row of rows) {
        const metaVals: Record<string, string> = {};
        metaFields.forEach((f) => { metaVals[f.id] = resolveCellValue(f, row, fieldDefMap); });
        const subRows = getSubTableRows(row, subKey);
        const lines = subRows.length > 0 ? subRows : [null];
        for (const sr of lines) {
          const item: Record<string, string> = { ...metaVals };
          subItemFields.forEach((f) => {
            const childKey = (f.formFieldKey || '').split('.')[1] ?? '';
            item[f.id] = sr
              ? resolveCellValue({ ...f, formFieldKey: childKey }, (sr.payload ?? {}) as Record<string, unknown>, fieldDefMap)
              : '';
          });
          data.push(item);
        }
      }
    } else {
      data = rows.map((row) => {
        const item: Record<string, string> = {};
        exportFields.forEach((f) => {
          item[f.id] = resolveCellValue(f, row, fieldDefMap);
        });
        return item;
      });
    }

    const payload = {
      templateName: template.name,
      title: template.title,
      subtitle: template.subtitle,
      columns,
      data,
      kind: template.kind,
      fileName: fileName || `${template.name}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    };

    const { data: resData, error } = await supabase.functions.invoke('export_excel', {
      body: payload,
    });

    if (error) {
      console.error('调用 export_excel 失败:', error);
      return { ok: false, error: error.message };
    }

    // 后端返回 base64 或直接提供下载，如果返回 base64
    let blob: Blob;
    if (resData instanceof Blob) {
      blob = resData;
    } else if (resData?.base64) {
      const byteChars = atob(resData.base64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    } else if (typeof resData === 'string' && resData.startsWith('data:')) {
      const res = await fetch(resData);
      blob = await res.blob();
    } else {
      // 降级兜底：若 Edge Function 返回纯数据或 JSON，生成 CSV/Excel 格式 Blob
      const csvContent = '\uFEFF' + [
        template.fields.map((f) => `"${f.label.replace(/"/g, '""')}"`).join(','),
        ...data.map((d) => template.fields.map((f) => `"${(d[f.id] || '').replace(/"/g, '""')}"`).join(',')),
      ].join('\n');
      blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('下载 Excel 异常:', err);
    return { ok: false, error: msg };
  }
}
