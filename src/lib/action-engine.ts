import type { ActionConfig, ActionDef, BizData, FormField, MetaRelation, Profile } from '@/types';
import { supabase } from '@/db/supabase';
import { BIZ_STATUS_LABELS } from '@/lib/field-catalog';

// ============ 1. JSONLogic 简化求值 ============

type LogicVal = unknown;

/** 按点路径取值：user.role / a.b.c */
function getVar(path: string, scope: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), scope);
}

/** 状态中文标签 → 状态键（用户在显示/启用条件中常填界面展示的中文标签，运行时状态为英文键） */
const STATUS_KEY_BY_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(BIZ_STATUS_LABELS).map(([k, v]) => [v, k])),
  已取消: 'cancelled',
  已跳过: 'skipped',
};

/** 判断表达式是否为 {"var":"status"} 形式 */
function isStatusVar(a: LogicVal): boolean {
  return a !== null && typeof a === 'object' && !Array.isArray(a)
    && Object.keys(a as Record<string, unknown>).length === 1
    && (a as Record<string, unknown>).var === 'status';
}

/** 状态比较归一化：status 变量与字面量比较时，字面量若为中文状态标签则映射为状态键（含状态机自定义状态名称）；其余比较不受影响。
 *  比较双方与状态名称均做 trim 容错，避免界面 label 带尾随空格或用户输入首尾空格导致不匹配。 */
function cmpStatus(a: LogicVal, b: LogicVal, val: (x: LogicVal) => unknown, statusLabels?: Record<string, string>): boolean {
  const aStatus = isStatusVar(a);
  const bStatus = isStatusVar(b);
  // 字面量 → 状态键：优先内置标签映射，其次当前表单状态机自定义状态名称；键与字面量均 trim 容错
  const keyOf = (lit: LogicVal): LogicVal => {
    const s = String(lit).trim();
    return STATUS_KEY_BY_LABEL[s] ?? statusLabels?.[s] ?? lit;
  };
  const lv = bStatus && !aStatus ? keyOf(a) : val(a);
  const rv = aStatus && !bStatus ? keyOf(b) : val(b);
  return String(lv).trim() === String(rv).trim();
}

/** 递归求值 JSONLogic 表达式（支持 and/or/!/==/!=/>/>=/</<=/in + var 字面量）
 *  statusLabels：状态名称 → 状态键（当前表单状态机自定义状态），status 比较时中文名称/英文标识均可命中 */
export function evalLogic(expr: unknown, scope: Record<string, unknown>, statusLabels?: Record<string, string>): unknown {
  if (expr === null || expr === undefined) return true;
  if (typeof expr !== 'object' || Array.isArray(expr)) return !!expr;
  const entries = Object.entries(expr as Record<string, LogicVal>);
  if (entries.length === 0) return true;
  const [op, rawArgs] = entries[0];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
  const val = (a: LogicVal): unknown => {
    if (a !== null && typeof a === 'object' && !Array.isArray(a)) {
      const e = Object.entries(a as Record<string, LogicVal>);
      if (e.length === 1 && e[0][0] === 'var') return getVar(String(e[0][1]), scope);
    }
    return a;
  };
  switch (op) {
    case 'and': return args.every((a) => !!evalLogic(a, scope, statusLabels));
    case 'or': return args.some((a) => !!evalLogic(a, scope, statusLabels));
    case '!': return !evalLogic(args[0], scope, statusLabels);
    case '==': return args.length >= 2 ? cmpStatus(args[0], args[1], val, statusLabels) : String(val(args[0])) === '';
    case '!=': return args.length >= 2 ? !cmpStatus(args[0], args[1], val, statusLabels) : String(val(args[0])) !== '';
    case '>': return Number(val(args[0])) > Number(val(args[1]));
    case '>=': return Number(val(args[0])) >= Number(val(args[1]));
    case '<': return Number(val(args[0])) < Number(val(args[1]));
    case '<=': return Number(val(args[0])) <= Number(val(args[1]));
    case 'in': {
      const list = val(args[1]);
      const item = val(args[0]);
      if (Array.isArray(list)) {
        // status 变量 in 列表：列表项按状态名称归一化为状态键后（trim 容错）再比较
        const norm = isStatusVar(args[0])
          ? list.map((x) => {
              const s = String(x).trim();
              return STATUS_KEY_BY_LABEL[s] ?? statusLabels?.[s] ?? x;
            })
          : list;
        return norm.map(String).includes(String(item).trim());
      }
      if (typeof list === 'string') return list.includes(String(item));
      return false;
    }
    default: return !!expr;
  }
}

/** 显示/启用条件求值快捷入口（条件为空视为通过）
 *  extra 注入行上下文附加变量：如 canApprove/canFill（当前用户是否为该单据当前待处理节点的审批人/填写人）
 *  smStates 当前表单状态机状态（key → 名称）：条件中状态可直接写界面展示的中文状态名称 */
export const passCond = (cond: unknown, row: BizData | null, user: Profile | null, extra?: Record<string, unknown>, smStates?: Map<string, { label: string }>): boolean => {
  if (cond === null || cond === undefined) return true;
  const statusLabels: Record<string, string> = {};
  smStates?.forEach((info, key) => { if (info?.label) statusLabels[info.label.trim()] = key; });
  return !!evalLogic(cond, { row: row?.payload ?? {}, status: row?.status ?? '', created_by: row?.created_by ?? '', user: { id: user?.id, role: user?.is_superadmin ? 'admin' : 'member', name: user?.name }, ...(extra ?? {}) }, statusLabels);
};

// ============ 2. 参数映射（{{row.x}} / {{currentUser.id}} / {{now}} / {{row.id}}）============

export function mapValue(template: string, ctx: ActionContext): unknown {
  if (typeof template !== 'string') return template;
  const m = template.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
  if (!m) return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => String(mapPath(p, ctx)));
  return mapPath(m[1], ctx);
}

function mapPath(path: string, ctx: ActionContext): unknown {
  if (path === 'now') return new Date().toISOString();
  if (path === 'currentUser.id') return ctx.user?.id ?? '';
  if (path === 'currentUser.name') return ctx.user?.name ?? '';
  if (path === 'currentUser.isSuperadmin') return ctx.user?.is_superadmin ?? false;
  if (path === 'row.id') return ctx.row?.id ?? '';
  if (path === 'row.status') return ctx.row?.status ?? '';
  if (path.startsWith('row.')) return (ctx.row?.payload as Record<string, unknown> | undefined)?.[path.slice(4)] ?? '';
  return '';
}

export function mapRecord(map: Record<string, string> | undefined, ctx: ActionContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) out[k] = mapValue(v, ctx);
  return out;
}

// ============ 3. 动作执行 ============

export interface ActionContext {
  /** 当前用户 */
  user: Profile | null;
  /** 当前行数据（行操作/表单按钮） */
  row?: BizData | null;
  /** 批量操作选中的多行 */
  rows?: BizData[];
  /** 当前表单字段定义（重算初始值用） */
  fields: FormField[];
  /** 当前表单状态机状态（key → 名称）：引擎兜底校验显示/启用条件时，状态中文名称归一化用 */
  smStates?: Map<string, { label: string }>;
  /** 条件附加变量（canApprove/canFill 等，与列表渲染口径一致）：引擎兜底校验显示/启用条件时使用 */
  condVars?: Record<string, unknown>;
  /** 跳转/刷新/关闭等 UI 副作用回调 */
  hooks: {
    refresh: () => void;
    closeDialog: () => void;
    navigate: (path: string, newWindow?: boolean) => void;
    openCreate: () => void;
    openEdit: (r: BizData) => void;
    openView: (r: BizData) => void;
    /** 填写节点确认（如销假）：打开填写弹窗（BizApp 内部定位当前待处理填写节点） */
    openFill: (r: BizData) => void;
    /** 新增备注：弹出备注填写框，填写内容存入操作日志（BizApp/Workbench 内部实现） */
    openRemark: (def: ActionDef, row: BizData | null) => void;
    /** 状态机流转交互（人员分配/内容提交/内容确定）：打开对应交互弹窗或直接流转（BizApp/Workbench 内部实现） */
    openSmTrans: (def: ActionDef, row: BizData | null) => void;
    /** 转移给他人/分配：打开人员选择弹窗，把单据移交给所选人员（BizApp 内部实现） */
    openTransfer: (def: ActionDef, row: BizData | null) => void;
    openRelated: (relation: MetaRelation, row: BizData, mode: 'select' | 'view' | 'unlink') => void;
    print: (templateId?: string) => void;
    exportCsv: (templateId?: string) => void | Promise<void>;
    /** 普通表单操作日志补写（如删除动作）：由宿主组件实现并落 audit_logs */
    writeLog?: (row: BizData | null, action: string) => void;
  };
}

export interface ExecResult {
  ok: boolean;
  message?: string;
  skipAfter?: boolean;
  /** 静默成功：UI 打开型动作（新增/查看/编辑/跳转/打印等）不弹成功提示 */
  silent?: boolean;
}

/** 写动作执行日志 */
async function logAction(def: { name: string; action_type: string; form_id?: string }, ctx: ActionContext, params: Record<string, unknown>, result: ExecResult, durationMs: number) {
  await supabase.from('meta_action_logs').insert({
    tenant_id: ctx.user?.tenant_id ?? '',
    user_id: ctx.user?.id ?? null,
    user_name: ctx.user?.name ?? null,
    form_id: def.form_id ?? null,
    biz_id: ctx.row?.id ?? ctx.rows?.[0]?.id ?? null,
    action_name: def.name,
    action_type: def.action_type,
    params,
    result: result.ok ? { ok: true, message: result.message } : { ok: false },
    error: result.ok ? null : (result.message ?? '未知错误'),
    duration_ms: durationMs,
  });
}

/** 执行单个动作（不带确认/后置行为） */
export async function runAction(def: ActionDef, ctx: ActionContext): Promise<ExecResult> {
  const start = performance.now();
  let res: ExecResult;
  try {
    res = await dispatch(def, ctx);
  } catch (e) {
    res = { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const duration = Math.round(performance.now() - start);
  void logAction(def, ctx, { type: def.action_type, ids: ctx.rows?.map((r) => r.id) ?? ctx.row?.id ?? null }, res, duration);
  return res;
}

async function dispatch(def: ActionDef, ctx: ActionContext): Promise<ExecResult> {
  const cfg = def.config ?? {};
  switch (def.action_type) {
    // ---- 内置 CRUD ----
    case 'CREATE':
      if (cfg.targetFormId && cfg.targetFormId !== def.form_id) return await gotoForm(ctx, cfg.targetFormId);
      ctx.hooks.openCreate();
      return { ok: true, skipAfter: true, silent: true };
    case 'VIEW':
      if (ctx.row) ctx.hooks.openView(ctx.row);
      return { ok: true, skipAfter: true, silent: true };
    case 'EDIT':
      if (ctx.row) ctx.hooks.openEdit(ctx.row);
      return { ok: true, skipAfter: true, silent: true };
    // ---- 填写节点确认（如销假）：由列表设计配置触发，不再自动渲染 ----
    case 'FILL_NODE': {
      if (!ctx.row) return { ok: false, message: '未选择数据行' };
      ctx.hooks.openFill(ctx.row);
      return { ok: true, skipAfter: true, silent: true };
    }
    // ---- 新增备注：弹窗填写 → 存操作日志 ----
    case 'REMARK': {
      if (!ctx.row) return { ok: false, message: '请先选择要备注的数据行' };
      ctx.hooks.openRemark(def, ctx.row);
      return { ok: true, skipAfter: true, silent: true };
    }
    // ---- 人员移交 ----
    case 'TRANSFER_OWNER':
    case 'ASSIGN_OWNER': {
      if (!ctx.row) return { ok: false, message: '请先选择要移交的数据行' };
      ctx.hooks.openTransfer(def, ctx.row);
      return { ok: true, skipAfter: true, silent: true };
    }
    case 'DELETE': {
      const targets = ctx.rows?.length ? ctx.rows : ctx.row ? [ctx.row] : [];
      let done = 0;
      for (const r of targets) {
        const { count } = await supabase.from('biz_approval').select('id', { count: 'exact', head: true }).eq('biz_id', r.id).neq('state', 'skipped');
        if ((count ?? 0) > 0 && r.status === 'pending') continue;
        const { error } = await supabase.from('biz_data').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', r.id);
        if (!error) {
          done += 1;
          // 操作日志补写（普通表单详情页底部操作日志展示）
          ctx.hooks.writeLog?.(r, '删除数据');
        }
      }
      if (done === 0) return { ok: false, message: '无可删除单据（审批中的单据不可删除）' };
      return { ok: true, message: targets.length > 1 ? `已删除 ${done}/${targets.length} 条` : '已删除' };
    }
    case 'COPY': {
      if (!ctx.row) return { ok: false, message: '未选择数据行' };
      const payload = { ...ctx.row.payload, ...(cfg.targetFormId ? {} : {}) };
      const { error } = await supabase.rpc('submit_biz', {
        p_form_id: ctx.row.form_id,
        p_payload: payload,
        p_title: `${ctx.row.title ?? '副本'}${cfg.copyTitleSuffix ?? '-副本'}`,
        p_amount: ctx.row.amount,
        p_submit: false,
      });
      if (error) return { ok: false, message: '复制失败：' + error.message };
      return { ok: true, message: '已复制为草稿' };
    }

    // ---- 关联表 ----
    case 'SELECT_RELATED':
    case 'VIEW_RELATED': {
      if (!ctx.row) return { ok: false, message: '未选择数据行' };
      const rel = await loadRelation(cfg.relationId);
      if (!rel) return { ok: false, message: '关联关系不存在或已删除' };
      ctx.hooks.openRelated(rel, ctx.row, def.action_type === 'SELECT_RELATED' ? 'select' : 'view');
      return { ok: true, skipAfter: true, silent: true };
    }
    case 'NEW_RELATED': {
      const rel = await loadRelation(cfg.relationId);
      if (!rel || !ctx.row) return { ok: false, message: '关联关系不存在' };
      // 跳转目标表单新建页并携带回链参数：新建保存成功后自动把新记录 ID 回填到源单据 backfill_field
      const linkback = encodeURIComponent(JSON.stringify({ s: ctx.row.id, f: def.form_id, k: rel.backfill_field, m: rel.multiple, r: rel.id }));
      ctx.hooks.navigate(`/app/${rel.target_form_id}/new?linkback=${linkback}`);
      return { ok: true, skipAfter: true, silent: true };
    }
    case 'UNLINK_RELATED': {
      const rel = await loadRelation(cfg.relationId);
      if (!rel || !ctx.row) return { ok: false, message: '关联关系不存在' };
      // 打开解除关联弹窗：列出已关联记录，逐条解除（目标记录保留）
      ctx.hooks.openRelated(rel, ctx.row, 'unlink');
      return { ok: true, skipAfter: true, silent: true };
    }
    case 'GOTO_RELATED': {
      const rel = await loadRelation(cfg.relationId);
      if (!rel || !ctx.row) return { ok: false, message: '关联关系不存在' };
      const linked = (ctx.row.payload?.[rel.backfill_field] as string[]) ?? [];
      if (linked.length === 0) return { ok: false, message: '当前单据暂无关联数据' };
      // 跳转第一条已关联记录的详情页
      ctx.hooks.navigate(`/app/${rel.target_form_id}/${linked[0]}`);
      return { ok: true, skipAfter: true, silent: true };
    }

    // ---- 状态变更：按状态机事件驱动，服务端校验当前状态+事件+守卫并转换 ----
    case 'CHANGE_STATUS': {
      const targets = ctx.rows?.length ? ctx.rows : ctx.row ? [ctx.row] : [];
      if (targets.length === 0) return { ok: false, message: '未选择数据行' };
      let done = 0;
      let lastMsg = '';
      for (const r of targets) {
        const mappings = mapRecord(cfg.fieldMappings, { ...ctx, row: r });
        const { data, error } = await supabase.rpc('change_biz_status', {
          p_biz_id: r.id,
          p_event: cfg.stateMachineEvent ?? '',
          p_mappings: mappings,
        });
        if (error) { lastMsg = error.message; continue; }
        done += 1;
        lastMsg = ((data as { message?: string })?.message) ?? '状态已更新';
      }
      return done > 0 ? { ok: true, message: targets.length > 1 ? `已处理 ${done}/${targets.length} 条` : lastMsg } : { ok: false, message: lastMsg || '状态更新失败' };
    }

    // ---- 状态变更：绑定状态机转换（人员分配/内容提交/内容确定交互由外层弹窗承载） ----
    case 'SM_TRANSITION': {
      if (!ctx.row) return { ok: false, message: '请在单条数据上执行该操作' };
      // 二次确认已由引擎统一处理；有交互的转换打开弹窗，无交互的直接由外层执行流转
      ctx.hooks.openSmTrans(def, ctx.row);
      return { ok: true, skipAfter: true, silent: true };
    }

    // ---- 流程 ----
    case 'START_WORKFLOW': {
      const targets = ctx.rows?.length ? ctx.rows : ctx.row ? [ctx.row] : [];
      let done = 0;
      let lastMsg = '';
      for (const r of targets) {
        const { data, error } = await supabase.rpc('start_biz_workflow', { p_biz_id: r.id });
        if (error) { lastMsg = error.message; continue; }
        done += 1;
        lastMsg = ((data as { message?: string })?.message) ?? '已发起审批';
      }
      return done > 0 ? { ok: true, message: targets.length > 1 ? `已发起 ${done} 条审批` : lastMsg } : { ok: false, message: lastMsg || '发起失败' };
    }
    case 'APPROVE':
    case 'REJECT': {
      if (!ctx.row) return { ok: false, message: '未选择数据行' };
      const { data: cur } = await supabase.from('biz_approval').select('*').eq('biz_id', ctx.row.id).eq('current', true).eq('state', 'pending').maybeSingle();
      if (!cur) return { ok: false, message: '该单据没有待我处理的审批节点' };
      const { error } = await supabase.rpc('approve_biz', { p_biz_id: ctx.row.id, p_action: def.action_type === 'APPROVE' ? 'approve' : 'reject', p_comment: '' });
      if (error) return { ok: false, message: '操作失败：' + error.message };
      return { ok: true, message: def.action_type === 'APPROVE' ? '已同意' : '已驳回' };
    }
    case 'WITHDRAW': {
      if (!ctx.row) return { ok: false, message: '未选择数据行' };
      const { data: cur } = await supabase.from('biz_approval').select('id').eq('biz_id', ctx.row.id).eq('state', 'pending').limit(1);
      if ((cur ?? []).length === 0) return { ok: false, message: '该单据不在审批中' };
      const { error: e1 } = await supabase.from('biz_approval').delete().eq('biz_id', ctx.row.id);
      if (e1) return { ok: false, message: '撤回失败：' + e1.message };
      const { error: e2 } = await supabase.from('biz_data').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', ctx.row.id);
      if (e2) return { ok: false, message: '撤回失败：' + e2.message };
      return { ok: true, message: '已撤回为草稿' };
    }

    // ---- 跳转 ----
    case 'NAVIGATE': {
      if (cfg.targetType === 'url' && cfg.url) {
        window.open(cfg.url, cfg.openMode === 'new-window' ? '_blank' : '_self');
        return { ok: true, skipAfter: true, silent: true };
      }
      if (cfg.targetFormId) {
        const params = mapRecord(cfg.paramMapping, ctx);
        const detailId = params.id ? String(params.id) : '';
        if (cfg.targetType === 'form-detail' && detailId) {
          ctx.hooks.navigate(`/app/${cfg.targetFormId}?focus=${detailId}`, cfg.openMode === 'new-window');
          return { ok: true, skipAfter: true, silent: true };
        }
        return await gotoForm(ctx, cfg.targetFormId, cfg.openMode === 'new-window');
      }
      return { ok: false, message: '未配置跳转目标' };
    }

    // ---- 数据更新 ----
    case 'UPDATE_DATA': {
      const targets = ctx.rows?.length ? ctx.rows : ctx.row ? [ctx.row] : [];
      if (targets.length === 0) return { ok: false, message: '未选择数据行' };
      let done = 0;
      for (const r of targets) {
        const updates = mapRecord(cfg.updates, { ...ctx, row: r });
        const { error } = await supabase.from('biz_data').update({ payload: { ...r.payload, ...updates }, updated_at: new Date().toISOString() }).eq('id', r.id);
        if (!error) done += 1;
      }
      return { ok: done > 0, message: done > 0 ? (targets.length > 1 ? `已更新 ${done}/${targets.length} 条` : '已更新') : '更新失败' };
    }

    // ---- 文件 ----
    case 'EXPORT':
      // exportCsv hook 内部已弹「已导出」提示，此处静默避免重复提示
      void ctx.hooks.exportCsv(cfg.templateId);
      return { ok: true, skipAfter: true, silent: true };
    case 'IMPORT':
      return { ok: false, message: '批量导入请前往「用户管理」或后续版本开放' };
    case 'PRINT':
      ctx.hooks.print(cfg.templateId);
      return { ok: true, skipAfter: true, silent: true };

    // ---- 接口 ----
    case 'CALL_API': {
      if (!cfg.url) return { ok: false, message: '未配置接口地址' };
      const body = mapRecord(cfg.bodyMapping, ctx);
      const { data, error } = await supabase.functions.invoke('action-proxy', { body: { url: cfg.url, method: cfg.method ?? 'POST', headers: cfg.headers ?? {}, body } });
      if (error) return { ok: false, message: '接口调用失败：' + error.message };
      const d = data as { ok?: boolean; status?: number; message?: string };
      if (!d?.ok) return { ok: false, message: d?.message ?? `接口返回异常（HTTP ${d?.status ?? '?'}）` };
      return { ok: true, message: '接口调用成功' };
    }

    // ---- 组合动作 ----
    case 'COMPOSITE': {
      const steps = cfg.steps ?? [];
      for (const sub of steps) {
        const r = await dispatch(sub, ctx);
        if (!r.ok && (cfg.onFailure ?? 'abort') === 'abort') return { ok: false, message: `「${sub.name}」失败：${r.message ?? ''}，已中断后续动作` };
      }
      return { ok: true, message: `已按序执行 ${steps.length} 个动作` };
    }

    default:
      return { ok: false, message: `暂不支持的动作类型：${def.action_type}` };
  }
}

async function gotoForm(ctx: ActionContext, formId: string, newWindow = false): Promise<ExecResult> {
  ctx.hooks.navigate(`/app/${formId}`, newWindow);
  return { ok: true, skipAfter: true, silent: true };
}

async function loadRelation(relationId?: string): Promise<MetaRelation | null> {
  if (!relationId) return null;
  const { data } = await supabase.from('meta_relations').select('*').eq('id', relationId).maybeSingle();
  return (data as MetaRelation) ?? null;
}

// ============ 4. 前端执行入口：校验 → 确认 → 执行 → 后置 ============

/** 前端可用的确认对话框桥接（由 BizApp 注入，避免引擎依赖 UI 组件） */
let confirmBridge: ((text: string) => Promise<boolean>) | null = null;
export function setConfirmBridge(fn: (text: string) => Promise<boolean>) {
  confirmBridge = fn;
}

export async function executeAction(def: ActionDef, ctx: ActionContext): Promise<void> {
  // 显示条件 + 启用条件（引擎层面兜底校验；与列表渲染同口径：含 canApprove/canFill/assignee_id 等附加变量与状态机自定义状态名称）
  if (!passCond(def.show_condition, ctx.row ?? null, ctx.user, ctx.condVars, ctx.smStates)) return;
  if (!passCond(def.enable_condition, ctx.row ?? null, ctx.user, ctx.condVars, ctx.smStates)) {
    import('sonner').then(({ toast }) => toast.error('当前数据状态不满足执行条件'));
    return;
  }
  // 权限码校验
  if (def.permission_code && ctx.user && !ctx.user.is_superadmin) {
    const { data } = await supabase.from('user_roles').select('roles!inner(button_perms)').eq('user_id', ctx.user.id);
    const codes = ((data as unknown as { roles: { button_perms: string[] } }[] | null) ?? []).flatMap((x) => (x.roles as { button_perms?: string[] })?.button_perms ?? []);
    if (!codes.includes(def.permission_code)) {
      import('sonner').then(({ toast }) => toast.error('无操作权限'));
      return;
    }
  }
  // 二次确认
  if (def.confirm_text && confirmBridge) {
    const ok = await confirmBridge(def.confirm_text);
    if (!ok) return;
  }
  const res = await runAction(def, ctx);
  if (res.ok) {
    // UI 打开型动作（新增/查看/编辑/跳转/打印等）静默成功，不弹提示
    if (!res.silent) {
      import('sonner').then(({ toast }) => toast.success(res.message ?? def.success_text ?? '操作成功'));
    }
  } else {
    import('sonner').then(({ toast }) => toast.error(res.message ?? '操作失败'));
    return;
  }
  if (res.skipAfter) return;
  // 后置行为
  switch (def.after_behavior) {
    case 'refresh': ctx.hooks.refresh(); break;
    case 'close': ctx.hooks.closeDialog(); ctx.hooks.refresh(); break;
    case 'back': ctx.hooks.closeDialog(); break;
    case 'navigate':
    case 'none':
    default: break;
  }
}
