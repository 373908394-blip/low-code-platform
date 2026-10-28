import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { ActionDef, Announcement, BizApproval, BizData, Department, FormField, MetaForm, SmTransition } from '@/types';
import { fmtDate, isLeaveCancelStatus } from '@/lib/field-catalog';
import { loadFormSm, resolveStatusLabel, resolveStatusColor, type FormSmMap } from '@/lib/status-machine';
import { resolveBizCode } from '@/lib/biz-code';
import { executeAction, passCond } from '@/lib/action-engine';
import { evalSmGuards } from '@/lib/status-machine';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DataPagination } from '@/components/ui/data-pagination';
import { BizDetailDialog, type SysProfile } from '@/components/biz/BizDetailDialog';
import { BizEditDialog } from '@/components/biz/BizEditDialog';
import { SmTransDialog } from '@/components/biz/SmTransDialogs';
import { currentTurnOf } from '@/lib/workflow';
import { Plus, ArrowRight, FilePlus2, Download, Users, ShieldCheck, Workflow, Info, Loader2, PencilLine } from 'lucide-react';

/** 状态 → sig-status 双编码值 */
function statusKey(s: string): 'running' | 'passed' | 'rejected' | 'draft' {
  if (s === 'approved') return 'passed';
  if (s === 'rejected') return 'rejected';
  if (s === 'pending' || isLeaveCancelStatus(s)) return 'running';
  return 'draft';
}

interface TodoRow {
  approval: BizApproval;
  biz: BizData;
  applicant: string;
  dept: string | null;
  position: string | null;
  formName: string;
}

export default function Workbench() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [myApps, setMyApps] = useState<(BizData & { meta_forms?: { name: string } | null; dept: string | null; position: string | null })[]>([]);
  const [todoPage, setTodoPage] = useState(1);
  const [todoPageSize, setTodoPageSize] = useState(10);
  const [myAppPage, setMyAppPage] = useState(1);
  const [myAppPageSize, setMyAppPageSize] = useState(10);
  const [statusMaps, setStatusMaps] = useState<FormSmMap>(new Map());
  const [allBiz, setAllBiz] = useState<BizData[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  // 各表单的行操作项配置（form_id → row actions），用于列表按钮与列表设计-操作项配置一致
  const [formActions, setFormActions] = useState<Map<string, ActionDef[]>>(new Map());
  // 状态机流转交互弹窗（SM_TRANSITION 动作：人员分配/内容提交/内容确定）
  const [smDlg, setSmDlg] = useState<{ transition: SmTransition; row: BizData; def: ActionDef } | null>(null);
  // 详情/编辑弹窗渲染所需的档案与部门映射（系统字段取值）
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [profileMap, setProfileMap] = useState<Map<string, SysProfile>>(new Map());
  const [deptMap, setDeptMap] = useState<Map<string, string>>(new Map());
  // 表单缓存（form_id → 完整定义），详情/编辑弹窗按需读取
  const formCache = useRef(new Map<string, MetaForm>());
  // 弹窗状态：详情（内含审批/填写操作）/ 编辑
  const [detail, setDetail] = useState<{ biz: BizData; form: MetaForm | null; approvals: BizApproval[] } | null>(null);
  const [editBiz, setEditBiz] = useState<BizData | null>(null);
  const [editForm, setEditForm] = useState<MetaForm | null>(null);

  // 我的申请等区块的审批上下文缓存：biz_id → 待处理审批节点（condVars canApprove/canFill 判定用）
  const pendingByBizRef = useRef(new Map<string, BizApproval>());
  /** 更新我的申请区块审批上下文缓存（load 后调用；由 bizCondExtra 读取） */
  const syncPendingByBiz = (myPending: Array<{ approval: BizApproval; biz: BizData }>) => {
    pendingByBizRef.current = new Map(myPending.map((t) => [t.biz.id, t.approval]));
  };

  /** 我的申请区块的行动作附加变量：与待办行同口径（canApprove/canFill = 当前用户是否为该单据待处理节点的审批人/填写人） */
  const bizCondExtra = (biz: BizData): Record<string, unknown> => {
    const a = pendingByBizRef.current.get(biz.id);
    const uid = user?.id ?? '';
    const isFill = a?.node_type === 'fill';
    return {
      canApprove: !!a && !isFill && a.approvers.includes(uid) && !a.acts.some((act) => act.user_id === uid),
      canFill: !!a && isFill && a.approvers.includes(uid) && !a.acts.some((act) => act.user_id === uid),
      // 我负责的：单据当前处理人（转移给我的/分配给我的）
      assignee_id: biz.assignee_id ?? '',
      assigneeName: biz.assignee_name ?? '',
    };
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [approvalRes, bizRes, annRes, deptRes] = await Promise.all([
      supabase.from('biz_approval').select('*, biz_data!inner(*)').eq('state', 'pending').eq('current', true).order('created_at', { ascending: false }),
      // 工作台总览仅统计审批表单（form_mode='approval'）的数据，其他模式（普通/状态机/向导）一律过滤
      supabase.from('biz_data').select('*, meta_forms!inner(name)').eq('is_deleted', false).eq('meta_forms.form_mode', 'approval').order('created_at', { ascending: false }),
      supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('departments').select('*').order('sort_order'),
    ]);

    // 我的待办：仅显示需要当前用户审批的数据（approvers 已解析为具体用户 id）
    const myPending = ((approvalRes.data as (BizApproval & { biz_data: BizData })[]) ?? [])
      // 依次审批：仅当前轮到的人进入待办，避免后位审批人提前收到任务
      .filter((a) => (a.approvers ?? []).includes(user.id) && (a.mode !== 'sequential' || currentTurnOf(a) === user.id))
      .map((a) => ({ approval: a, biz: a.biz_data }));
    // 同步我的申请区块审批上下文缓存（canApprove/canFill 判定用）
    syncPendingByBiz(myPending);

    const bizList = (bizRes.data as (BizData & { meta_forms: { name: string } | null })[]) ?? [];
    const userIds = [...new Set(myPending.map((t) => t.biz.created_by).concat(bizList.map((b) => b.created_by)))];
    const { data: profilesData } = await supabase.from('profiles').select('id, name, position, department_id').in('id', userIds);
    const nm = new Map<string, string>();
    const pm = new Map<string, SysProfile>();
    ((profilesData ?? []) as (SysProfile & { id: string })[]).forEach((p) => {
      nm.set(p.id, p.name);
      pm.set(p.id, p);
    });
    setNameMap(nm);
    setProfileMap(pm);
    const dm = new Map(((deptRes.data as Department[]) ?? []).map((d) => [d.id, d.name]));
    setDeptMap(dm);

    // 加载相关表单定义与行操作项配置，用于列表按钮与「列表设计-操作项配置」保持一致
    const allFormIds = [...new Set(myPending.map((t) => t.biz.form_id).concat(bizList.filter((b) => b.created_by === user.id).map((b) => b.form_id)))];
    const [formsRes, actionsRes] = await Promise.all([
      supabase.from('meta_forms').select('*').in('id', allFormIds),
      supabase.from('meta_actions').select('*').in('form_id', allFormIds).eq('position', 'row').order('sort'),
    ]);
    const formMap = new Map(((formsRes.data ?? []) as MetaForm[]).map((f) => [f.id, f.name]));
    ((formsRes.data ?? []) as MetaForm[]).forEach((f) => formCache.current.set(f.id, f));
    const actionsMap = new Map<string, ActionDef[]>();
    ((actionsRes.data ?? []) as ActionDef[]).forEach((a) => {
      const list = actionsMap.get(a.form_id) ?? [];
      list.push(a);
      actionsMap.set(a.form_id, list);
    });
    setFormActions(actionsMap);

    setTodos(
      myPending.map((t) => {
        const p = pm.get(t.biz.created_by);
        return {
          approval: t.approval,
          biz: t.biz,
          applicant: nm.get(t.biz.created_by) ?? '未知',
          dept: p?.department_id ? (dm.get(p.department_id) ?? null) : null,
          position: p?.position ?? null,
          formName: formMap.get(t.biz.form_id) ?? '',
        };
      }),
    );
    setMyApps(
      bizList.filter((b) => b.created_by === user.id).map((b) => {
        const p = pm.get(b.created_by);
        return { ...b, dept: p?.department_id ? (dm.get(p.department_id) ?? null) : null, position: p?.position ?? null };
      }),
    );
    setAllBiz(bizList);
    setAnnouncements((annRes.data as Announcement[]) ?? []);
    setStatusMaps(await loadFormSm(bizList.map((b) => b.form_id)));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // KPI 统计
  const kpi = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthNew = allBiz.filter((b) => new Date(b.created_at).getTime() >= monthStart).length;
    const running = allBiz.filter((b) => b.status === 'pending').length;
    const approved = allBiz.filter((b) => b.status === 'approved').length;
    const rejected = allBiz.filter((b) => b.status === 'rejected').length;
    const doneTotal = approved + rejected;
    return {
      pending: todos.length,
      monthNew,
      running,
      total: allBiz.length,
      approved,
      rejected,
      rate: doneTotal > 0 ? ((approved / doneTotal) * 100).toFixed(1) : '100.0',
    };
  }, [todos, allBiz]);

  // 近 7 天提交量
  const week = useMemo(() => {
    const days: { label: string; count: number; isToday: boolean }[] = [];
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = d.getTime() + 86400000;
      const count = allBiz.filter((b) => {
        const t = new Date(b.created_at).getTime();
        return t >= d.getTime() && t < next;
      }).length;
      days.push({ label: i === 0 ? '今天' : names[d.getDay()], count, isToday: i === 0 });
    }
    const max = Math.max(...days.map((d) => d.count), 1);
    return { days, max };
  }, [allBiz]);

  const barColors = ['bg-primary/25', 'bg-primary/25', 'bg-primary/50', 'bg-primary/50', 'bg-primary/50', 'bg-primary/75', 'bg-primary'];

  const hour = new Date().getHours();
  const greet = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 星期${'日一二三四五六'[now.getDay()]}`;

  const ringTotal = kpi.approved + kpi.running + kpi.rejected || 1;
  const C = 2 * Math.PI * 48;
  const seg = (n: number) => `${(n / ringTotal) * C} ${C}`;

  // 待办行附加条件变量：canApprove/canFill（当前用户是否为该单据当前待处理节点的审批人/填写人）
  const todoExtra = (t: TodoRow) => {
    const a = t.approval;
    const uid = user?.id ?? '';
    const isFill = a.node_type === 'fill';
    const canApprove = a.current && a.state === 'pending' && !isFill && a.approvers.includes(uid) && !a.acts.some((act) => act.user_id === uid);
    const canFill = a.current && a.state === 'pending' && isFill && a.approvers.includes(uid) && !a.acts.some((act) => act.user_id === uid);
    return { canApprove, canFill };
  };

  /** 打开单据详情弹窗：按需加载该单据全部审批节点（内含审批操作与填写确认） */
  const openDetail = (biz: BizData) => {
    // 应用表单详情统一页面化：跳转业务应用独立详情页（弃弹窗）
    navigate(`/app/${biz.form_id}/${biz.id}`);
  };

  /** 打开单据编辑：跳转业务应用独立编辑页（弃弹窗） */
  const openEdit = (biz: BizData) => {
    navigate(`/app/${biz.form_id}/${biz.id}/edit`);
  };

  /** 行操作分发：查看/通过/驳回 → 当前页详情弹窗；编辑 → 当前页编辑弹窗；其余动作（提交审核等）走动作引擎 */
  const runRowAction = (a: ActionDef | null, biz: BizData) => {
    if (!a) return void openDetail(biz);
    switch (a.action_type) {
      case 'VIEW':
      case 'APPROVE':
      case 'REJECT':
      case 'FILL_NODE':
        return void openDetail(biz);
      case 'EDIT':
        return openEdit(biz);
      default:
        return void executeAction(a, {
          user: profile,
          row: biz,
          fields: ((formCache.current.get(biz.form_id)?.schema_json?.fields ?? []) as FormField[]),
          smStates: statusMaps.get(biz.form_id)?.states,
          condVars: bizCondExtra(biz),
          hooks: {
            refresh: () => void load(),
            closeDialog: () => { setDetail(null); setEditBiz(null); },
            navigate: (p, w) => (w ? window.open(p, '_blank') : navigate(p)),
            openCreate: () => {},
            openEdit: (r) => openEdit(r),
            openView: (r) => void openDetail(r),
            openRelated: () => {},
            openFill: (r) => void openDetail(r),
            openSmTrans: (d, r) => {
              // 状态机流转：无交互直接流转，有交互打开对应弹窗
              if (!r) return;
              const tr = statusMaps.get(r.form_id)?.transitions.find((x) => x.id === d.config.transitionId);
              if (!tr) return toast.error('该流转动作已下线：对应状态机转换已被删除');
              const inter = tr.interaction;
              if (!inter || inter.type === 'none') {
                void (async () => {
                  const { data, error } = await supabase.rpc('change_biz_status', { p_biz_id: r.id, p_event: tr.event, p_mappings: {} });
                  if (error) return toast.error('流转失败：' + error.message);
                  toast.success(d.success_text ?? ((data as { message?: string })?.message ?? '状态已流转'));
                  void load();
                })();
                return;
              }
              setSmDlg({ transition: tr as SmTransition, row: r, def: d });
            },
            // 转移给他人/分配：跳转到对应表单详情页处理（工作台内嵌精简实现，完整交互在应用页）
            openTransfer: (d, r) => {
              if (!r) return toast.error('请先选择要移交的数据行');
              navigate(`/app/${r.form_id}/${r.id}`);
              toast.info(`请在应用详情页使用「${d.action_type === 'TRANSFER_OWNER' ? '转移给他人' : '分配'}」完成移交`);
            },
            // 新增备注：跳转到对应表单详情页处理（工作台内嵌精简实现，完整交互在应用页）
            openRemark: (d, r) => {
              if (!r) return toast.error('请先选择要备注的数据行');
              navigate(`/app/${r.form_id}/${r.id}`);
              toast.info('请在应用详情页使用「新增备注」填写备注');
            },
            print: () => {},
            exportCsv: () => {},
          },
        });
    }
  };

  // 渲染某条单据所属表单配置的行操作按钮（按列表设计-操作项配置中的显示/启用条件判断）
  const renderRowActions = (biz: BizData, extra?: Record<string, unknown>) => {
    const actions = formActions.get(biz.form_id) ?? [];
    // 状态机状态（当前表单自定义状态名称参与 status 比较）
    const smStates = statusMaps.get(biz.form_id)?.states;
    if (actions.length === 0) {
      return (
        <button type="button" onClick={() => runRowAction(null, biz)} className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors inline-flex items-center">查看详情</button>
      );
    }
    return actions
      .filter((a) => passCond(a.show_condition, biz, profile, extra, smStates))
      .map((a) => {
        // 状态机流转动作叠加守卫条件评估（字段-字段/字段-设定值比较）
        const fm = statusMaps.get(biz.form_id);
        const tr = a.action_type === 'SM_TRANSITION' ? fm?.transitions.find((x) => x.id === a.config.transitionId) : undefined;
        const guardsPass = !tr || !tr.guards || tr.guards.length === 0 || (fm && evalSmGuards(tr.guards, biz, biz.form_id, new Map([[biz.form_id, fm]]))) === true;
        const enabled = passCond(a.enable_condition, biz, profile, extra, smStates) && guardsPass;
        return (
          <button
            key={a.id}
            type="button"
            disabled={!enabled}
            onClick={() => enabled && runRowAction(a, biz)}
            className={cn(
              'h-7 px-2.5 rounded border border-border text-xs inline-flex items-center transition-colors',
              enabled ? 'hover:bg-muted text-foreground' : 'text-muted-foreground bg-muted cursor-not-allowed',
            )}
          >
            {a.name}
          </button>
        );
      });
  };

  const statusLabel = (formId: string | undefined, status: string | undefined | null) => resolveStatusLabel(formId, status, statusMaps);
  const statusStyle = (formId: string | undefined, status: string | undefined | null) => {
    const c = resolveStatusColor(formId, status, statusMaps);
    return c ? { color: c, borderColor: `${c}40`, backgroundColor: `${c}15` } : undefined;
  };
  const todoTotalPages = Math.max(1, Math.ceil(todos.length / todoPageSize));
  const safeTodoPage = Math.min(todoPage, todoTotalPages);
  const pagedTodos = todos.slice((safeTodoPage - 1) * todoPageSize, safeTodoPage * todoPageSize);
  const myAppTotalPages = Math.max(1, Math.ceil(myApps.length / myAppPageSize));
  const safeMyAppPage = Math.min(myAppPage, myAppTotalPages);
  const pagedMyApps = myApps.slice((safeMyAppPage - 1) * myAppPageSize, safeMyAppPage * myAppPageSize);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      {/* ===== 问候区 ===== */}
      <section id="workbench" className="px-4 md:px-8 pt-6 pb-5 border-b border-border">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground mb-2 sig-num">{dateStr} · Low-code platform</p>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-balance">{greet}，{profile?.name || '用户'}</h1>
            <p className="text-sm text-muted-foreground mt-2">
              今天有 <span className="text-primary font-semibold">{kpi.pending} 件审批</span>待处理
              {todos.length > 0 && <>，最久的一件已等待 {Math.max(...todos.map((t) => Math.floor((Date.now() - new Date(t.biz.created_at).getTime()) / 86400000)))} 天</>}。
            </p>
          </div>
          <div className="flex gap-2.5 shrink-0">
            <Button variant="outline" className="h-9" onClick={() => navigate('/design/apps')}>
              <Plus className="mr-1.5 h-4 w-4" />新建表单
            </Button>
            <Button className="h-9" onClick={() => navigate('/design/apps')}>
              发起审批<ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ===== KPI 数据带 ===== */}
      <section id="kpi-band" className="px-4 md:px-8 py-6 border-b border-border">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border rounded-lg overflow-hidden">
          {[
            { label: '待我审批', num: kpi.pending, unit: '件', sub: '来自全部业务表单', hot: true },
            { label: '本月新增单据', num: kpi.monthNew, unit: '单', sub: `全租户累计 ${kpi.total} 条` },
            { label: '进行中流程', num: kpi.running, unit: '个', sub: `待审批节点 ${kpi.running} 处` },
            { label: '累计已通过', num: kpi.approved, unit: '条', sub: `通过率 ${kpi.rate}%` },
          ].map((item) => (
            <div key={item.label} className="bg-card px-4 py-4">
              <p className="text-xs text-muted-foreground mb-2">{item.label}</p>
              <p className={`sig-kpi sig-num font-black ${item.hot ? 'text-primary' : ''}`}>
                {item.num.toLocaleString()}<span className="text-base font-semibold text-muted-foreground ml-1.5">{item.unit}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-2 sig-num">{item.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== 中部：图表 + 待办表 + 环形图 + 公告 ===== */}
      <section id="overview" className="px-4 md:px-8 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6 min-w-0">
          {/* 近 7 天柱状图 */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold">近 7 天单据提交量</h2>
                <p className="text-xs text-muted-foreground mt-1">全部业务表单按日汇总</p>
              </div>
              <div className="flex bg-muted rounded-md p-0.5 text-xs">
                <span className="h-7 px-3 rounded bg-card border border-border font-medium text-primary flex items-center">按日</span>
                <span className="h-7 px-3 rounded text-muted-foreground flex items-center">按周</span>
              </div>
            </div>
            <div className="flex items-end gap-2.5 md:gap-4 h-40" role="img" aria-label={`近7天单据提交量柱状图，共 ${kpi.total} 条`}>
              {week.days.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2 min-w-0 h-full justify-end">
                  <span className="text-xs text-muted-foreground sig-num">{d.count}</span>
                  <div
                    className={`w-full max-w-10 rounded-t-sm ${d.isToday ? 'bg-primary' : barColors[i]}`}
                    style={{ height: `${Math.max((d.count / week.max) * 100, 4)}%` }}
                    title={`${d.label}：${d.count} 条`}
                  />
                  <span className="text-xs text-muted-foreground">{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 待我审批表 */}
          <div className="bg-card border border-border rounded-lg min-w-0">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold">待我审批<span className="text-xs font-normal text-muted-foreground ml-2">按提交时间排序 · 共 {todos.length} 件</span></h2>
              <Link to="/notifications" className="text-sm text-primary hover:underline">查看全部</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium whitespace-nowrap">事项编码</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">申请人</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">所属部门</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">所属职位</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">状态</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">创建时间</th>
                    <th className="px-5 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {todos.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground text-sm">暂无待审批任务</td>
                    </tr>
                  )}
                  {pagedTodos.map((t) => {
                    const form = formCache.current.get(t.biz.form_id) ?? null;
                    const code = resolveBizCode(form, t.biz.payload, t.biz.title || undefined);
                    return (
                      <tr key={t.approval.id} className="hover:bg-muted/50">
                        <td className="px-5 py-3 whitespace-nowrap">
                          <p className="font-medium text-foreground truncate max-w-[16rem]">{code}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[16rem]">{t.formName || '业务表单'}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{t.applicant}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{t.dept ?? '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{t.position ?? '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="sig-status" data-status="running">{t.approval.mode === 'countersign' ? `会签中 ${t.approval.acts.length}/${t.approval.approvers.length}` : '待我审批'}</span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(t.biz.created_at, true)}</td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <span className="sig-row-actions inline-flex gap-1.5">
                            {renderRowActions(t.biz, todoExtra(t))}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DataPagination total={todos.length} page={safeTodoPage} pageSize={todoPageSize} onPageChange={setTodoPage} onPageSizeChange={(s) => { setTodoPageSize(s); setTodoPage(1); }} />
          </div>
        </div>

        {/* 右列 */}
        <div className="space-y-6 min-w-0">
          {/* 审批状态环形图 */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-base font-semibold">本月审批状态</h2>
            <div className="flex items-center gap-5 mt-4">
              <div className="relative shrink-0">
                <svg viewBox="0 0 120 120" className="w-28 h-28" role="img" aria-label={`本月审批状态：已通过${kpi.approved}、审批中${kpi.running}、已驳回${kpi.rejected}`}>
                  <circle className="sig-ring sig-ring-track" cx="60" cy="60" r="48" />
                  <circle className="sig-ring sig-ring-passed" cx="60" cy="60" r="48" strokeDasharray={seg(kpi.approved)} transform="rotate(-90 60 60)" />
                  <circle className="sig-ring sig-ring-running" cx="60" cy="60" r="48" strokeDasharray={seg(kpi.running)} strokeDashoffset={-(kpi.approved / ringTotal) * C} transform="rotate(-90 60 60)" />
                  <circle className="sig-ring sig-ring-rejected" cx="60" cy="60" r="48" strokeDasharray={seg(kpi.rejected)} strokeDashoffset={-((kpi.approved + kpi.running) / ringTotal) * C} transform="rotate(-90 60 60)" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold sig-num">{kpi.approved + kpi.running + kpi.rejected}</span>
                  <span className="text-xs text-muted-foreground">审批总量</span>
                </div>
              </div>
              <ul className="flex-1 space-y-2.5 text-sm min-w-0">
                <li className="flex items-center justify-between gap-2"><span className="sig-status" data-status="passed">已通过</span><span className="sig-num font-medium">{kpi.approved}</span></li>
                <li className="flex items-center justify-between gap-2"><span className="sig-status" data-status="running">审批中</span><span className="sig-num font-medium">{kpi.running}</span></li>
                <li className="flex items-center justify-between gap-2"><span className="sig-status" data-status="rejected">已驳回</span><span className="sig-num font-medium">{kpi.rejected}</span></li>
              </ul>
            </div>
            <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">通过率 {kpi.rate}%</p>
          </div>

          {/* 通知公告 */}
          <div className="bg-card border border-border rounded-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold">通知公告</h2>
              <span className="text-xs text-muted-foreground">{announcements.length} 条</span>
            </div>
            <ul className="divide-y divide-border">
              {announcements.map((a) => (
                <li key={a.id} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${a.category === 'notice' ? 'text-primary bg-primary/10' : a.category === 'update' ? 'text-accent bg-accent/10' : 'text-muted-foreground bg-muted'}`}>
                      {a.category === 'notice' ? '系统公告' : a.category === 'update' ? '产品更新' : '操作指引'}
                    </span>
                    <span className="text-xs text-muted-foreground sig-num">{fmtDate(a.created_at)}</span>
                  </div>
                  <p className="text-sm font-medium leading-snug">{a.title}</p>
                </li>
              ))}
              {announcements.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">暂无公告</li>}
            </ul>
          </div>
        </div>
      </section>

      {/* ===== 底部：我的申请 + 快捷入口 ===== */}
      <section id="my-applications" className="px-4 md:px-8 pb-10 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-card border border-border rounded-lg min-w-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold">我的申请</h2>
            <span className="text-sm text-muted-foreground">共 {myApps.length} 条</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">事项编码</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">申请人</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">所属部门</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">所属职位</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">状态</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">创建时间</th>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedMyApps.map((b) => {
                  const form = formCache.current.get(b.form_id) ?? null;
                  const code = resolveBizCode(form, b.payload, b.title || undefined);
                  return (
                  <tr key={b.id} className="hover:bg-muted/50">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="font-medium text-foreground truncate max-w-[16rem]">{code}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[16rem]">{b.meta_forms?.name || '业务表单'}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{profile?.name ?? '我'}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{b.dept ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{b.position ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="sig-status" style={statusStyle(b.form_id, b.status)} data-status={statusKey(b.status)}>{statusLabel(b.form_id, b.status)}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(b.created_at, true)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <span className="sig-row-actions inline-flex gap-1.5">
                        {renderRowActions(b)}
                      </span>
                    </td>
                  </tr>
                )})}
                {myApps.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">还没有发起过申请，从快捷入口开始</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DataPagination total={myApps.length} page={safeMyAppPage} pageSize={myAppPageSize} onPageChange={setMyAppPage} onPageSizeChange={(s) => { setMyAppPageSize(s); setMyAppPage(1); }} />
        </div>

        <div className="bg-card border border-border rounded-lg min-w-0">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold">快捷入口</h2>
          </div>
          <div className="grid grid-cols-3 gap-px bg-border m-4 rounded-md overflow-hidden border border-border">
            {[
              { icon: FilePlus2, label: '新建表单', to: '/design/apps' },
              { icon: ArrowRight, label: '发起审批', to: '/design/apps' },
              { icon: Download, label: '数据导出', to: '/settings' },
              { icon: Users, label: '员工管理', to: '/users' },
              { icon: ShieldCheck, label: '角色权限', to: '/roles' },
              { icon: Workflow, label: '流程设计', to: '/design/apps' },
            ].map((e) => (
              <Link key={e.label} to={e.to} className="bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/60 transition-colors">
                <e.icon className="h-4.5 w-4.5 text-primary" />
                <span className="text-xs">{e.label}</span>
              </Link>
            ))}
          </div>
          <p className="px-5 pb-4 text-xs text-muted-foreground flex items-center gap-1.5"><Info className="h-3.5 w-3.5" />业务菜单发布后自动出现在左侧导航</p>
        </div>
      </section>

      {/* 单据详情弹窗（内含审批操作与填写节点确认，不跳转业务页） */}
      <BizDetailDialog
        open={!!detail}
        biz={detail?.biz ?? null}
        form={detail?.form ?? null}
        approvals={detail?.approvals ?? []}
        maps={{ nameMap, profileMap, deptMap }}
        userId={user?.id ?? ''}
        onClose={() => setDetail(null)}
        onActed={() => { setDetail(null); void load(); }}
      />

      {/* 单据编辑弹窗：当前页编辑，保存/提交后刷新列表 */}
      <BizEditDialog
        open={!!editBiz}
        biz={editBiz}
        form={editForm}
        onClose={() => setEditBiz(null)}
        onSaved={() => { setEditBiz(null); void load(); }}
      />

      {/* 状态机流转交互弹窗：人员分配（部门/角色→模糊搜索多选）/内容提交/内容确定 */}
      <SmTransDialog
        open={!!smDlg}
        transition={smDlg?.transition ?? null}
        row={smDlg?.row ?? null}
        successText={smDlg?.def.success_text}
        onClose={() => setSmDlg(null)}
        onDone={() => void load()}
      />
    </div>
  );
}
