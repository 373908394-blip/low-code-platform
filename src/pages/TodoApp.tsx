import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { ActionDef, BizApproval, BizData, Department, MetaForm } from '@/types';
import { fmtDate, isLeaveCancelStatus } from '@/lib/field-catalog';
import { resolveBizCode } from '@/lib/biz-code';
import { loadFormSm, resolveStatusLabel, type FormSmMap } from '@/lib/status-machine';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataPagination } from '@/components/ui/data-pagination';
import { passCond } from '@/lib/action-engine';
import { BizDetailDialog, StatusBadge, type SysProfile } from '@/components/biz/BizDetailDialog';
import { BizEditDialog } from '@/components/biz/BizEditDialog';
import { currentTurnOf } from '@/lib/workflow';
import {
  ArrowLeft, Loader2, Clock, ClipboardList, Pencil, Eye, PencilLine,
} from 'lucide-react';

type Row = BizData & { applicant: string; dept?: string | null; position?: string | null; pendingMine: boolean };

/** 应用维度的审批待办：选项卡切换「待我处理」与「我申请的」，支持查看单据详情、审批、销假填写 */
export default function TodoApp() {
  const { formId, scope } = useParams<{ formId: string; scope?: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<MetaForm | null>(null);
  const [pendingRows, setPendingRows] = useState<Row[]>([]);
  const [rejectedRows, setRejectedRows] = useState<Row[]>([]);
  const [xiaojiaRows, setXiaojiaRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [rowActions, setRowActions] = useState<ActionDef[]>([]);
  const [approvalByBiz, setApprovalByBiz] = useState<Map<string, BizApproval[]>>(new Map());
  // 系统字段取值映射（员工姓名/所属部门/职位等依赖创建人档案）
  const [profileMap, setProfileMap] = useState<Map<string, SysProfile>>(new Map());
  const [deptMap, setDeptMap] = useState<Map<string, string>>(new Map());
  const [statusMaps, setStatusMaps] = useState<FormSmMap>(new Map());

  // 详情/编辑弹窗状态（审批与填写确认操作内置于共享详情弹窗）
  const [detailBiz, setDetailBiz] = useState<BizData | null>(null);
  const [detailApprs, setDetailApprs] = useState<BizApproval[]>([]);
  const [editBiz, setEditBiz] = useState<BizData | null>(null);

  const activeTab = scope === 'applied' ? 'applied' : 'pending';

  const load = useCallback(async () => {
    if (!formId || !user) return;
    setLoading(true);
    const [formRes, bizRes, apprRes, deptRes, actionsRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle(),
      supabase.from('biz_data').select('*').eq('form_id', formId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(200),
      supabase.from('biz_approval').select('*').eq('form_id', formId).order('created_at', { ascending: false }),
      supabase.from('departments').select('*').order('sort_order'),
      supabase.from('meta_actions').select('*').eq('form_id', formId).eq('position', 'row').order('sort'),
    ]);
    setRowActions((actionsRes.data ?? []) as ActionDef[]);
    setForm((formRes.data as MetaForm) ?? null);

    const bizList = (bizRes.data as BizData[]) ?? [];
    const approvals = (apprRes.data as BizApproval[]) ?? [];
    const byBiz = new Map<string, BizApproval[]>();
    approvals.forEach((a) => {
      const arr = byBiz.get(a.biz_id) ?? [];
      arr.push(a);
      byBiz.set(a.biz_id, arr);
    });
    setApprovalByBiz(byBiz);

    const nm = new Map<string, string>();
    const pm = new Map<string, SysProfile>();
    const dm = new Map<string, string>(((deptRes.data as Department[]) ?? []).map((d) => [d.id, d.name]));
    setDeptMap(dm);
    const userIds = [...new Set(bizList.map((b) => b.created_by))];
    if (userIds.length > 0) {
      const { data: profData } = await supabase.from('profiles').select('id, name, position, department_id').in('id', userIds);
      ((profData ?? []) as { id: string; name: string; position?: string | null; department_id?: string | null }[]).forEach((p) => {
        nm.set(p.id, p.name);
        pm.set(p.id, { name: p.name, position: p.position, department_id: p.department_id });
      });
    }
    setNameMap(nm);
    setProfileMap(pm);

    const enrich = (b: BizData, pendingMine = false): Row => {
      const p = pm.get(b.created_by);
      return {
        ...b,
        applicant: nm.get(b.created_by) ?? '未知',
        dept: p?.department_id ? (dm.get(p.department_id) ?? null) : null,
        position: p?.position ?? null,
        pendingMine,
      };
    };

    const pending = bizList
      .filter((b) => b.status === 'pending')
      .map((b) => {
        const aps = byBiz.get(b.id) ?? [];
        const pendingMine = aps.some((a) => a.state === 'pending' && a.current && (a.approvers ?? []).includes(user.id) && (a.mode !== 'sequential' || currentTurnOf(a) === user.id));
        return enrich(b, pendingMine);
      });
    setPendingRows(pending);

    const rejected = bizList
      .filter((b) => b.status === 'rejected')
      .map((b) => enrich(b));
    setRejectedRows(rejected);

    const xiaojia = bizList
      .filter((b) => isLeaveCancelStatus(b.status))
      .map((b) => enrich(b));
    setXiaojiaRows(xiaojia);
    setStatusMaps(await loadFormSm([formId]));
    setLoading(false);
  }, [formId, user]);

  useEffect(() => {
    load();
  }, [load]);

  // 切换选项卡时回到第一页
  useEffect(() => {
    setPage(1);
  }, [activeTab]);

  const openDetail = (biz: BizData) => {
    // 应用表单详情统一页面化：跳转业务应用独立详情页（弃弹窗）
    navigate(`/app/${biz.form_id}/${biz.id}`);
  };

  /** 编辑单据：跳转业务应用独立编辑页（弃弹窗） */
  const openEdit = (biz: BizData) => navigate(`/app/${biz.form_id}/${biz.id}/edit`);

  const myAction = useMemo(() => pendingRows.filter((r) => r.pendingMine), [pendingRows]);
  const mySubmitted = useMemo(() => pendingRows.filter((r) => r.created_by === user?.id), [pendingRows, user]);
  const myRejected = useMemo(() => rejectedRows.filter((r) => r.created_by === user?.id), [rejectedRows, user]);
  const myXiaojia = useMemo(() => xiaojiaRows.filter((r) => r.created_by === user?.id), [xiaojiaRows, user]);
  const myApplied = useMemo(
    () => [...mySubmitted, ...myRejected, ...myXiaojia].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [mySubmitted, myRejected, myXiaojia],
  );

  const list = activeTab === 'pending' ? myAction : myApplied;
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = list.slice((safePage - 1) * pageSize, safePage * pageSize);

  const columns = (
    <tr className="border-b border-border text-left text-xs text-muted-foreground">
      <th className="px-4 py-2.5 font-medium whitespace-nowrap">事项编码</th>
      <th className="px-4 py-2.5 font-medium whitespace-nowrap">申请人</th>
      <th className="px-4 py-2.5 font-medium whitespace-nowrap">所属部门</th>
      <th className="px-4 py-2.5 font-medium whitespace-nowrap">所属职位</th>
      <th className="px-4 py-2.5 font-medium whitespace-nowrap">状态</th>
      <th className="px-4 py-2.5 font-medium whitespace-nowrap">创建时间</th>
      <th className="px-4 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
    </tr>
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" asChild>
          <Link to="/"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight truncate">{form?.name ?? '审批待办'}</h1>
          <p className="text-sm text-muted-foreground mt-1">处理需要您审批的任务，查看您发起的申请进度与审核记录</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { navigate(`/todo/${formId}/${v}`); }} className="flex flex-col">
        <TabsList className="mb-4 w-fit">
          <TabsTrigger value="pending" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />待我处理
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground transition-colors group-data-[state=active]/trigger:bg-white group-data-[state=active]/trigger:text-primary">
              {myAction.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="applied" className="gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />我申请的
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground transition-colors group-data-[state=active]/trigger:bg-white group-data-[state=active]/trigger:text-primary">
              {myApplied.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="!mt-0">
          {myAction.length === 0 ? (
            <EmptyCard text="暂无需要您处理的任务" />
          ) : (
            <div className="bg-card border border-border rounded-lg overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>{columns}</thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => (
                    <BizRow key={r.id} row={r} formName={form?.name ?? ''} form={form} rowActions={rowActions} profile={profile} approvals={approvalByBiz.get(r.id) ?? []} statusMaps={statusMaps} onOpen={() => openDetail(r)} onEdit={() => openEdit(r)} />
                  ))}
                </tbody>
              </table>
              <DataPagination total={myAction.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="applied" className="!mt-0">
          {myApplied.length === 0 ? (
            <EmptyCard text="暂无您发起的申请" />
          ) : (
            <div className="bg-card border border-border rounded-lg overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>{columns}</thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => (
                    <BizRow key={r.id} row={r} formName={form?.name ?? ''} form={form} rowActions={rowActions} profile={profile} approvals={approvalByBiz.get(r.id) ?? []} statusMaps={statusMaps} onOpen={() => openDetail(r)} onEdit={() => openEdit(r)} />
                  ))}
                </tbody>
              </table>
              <DataPagination total={myApplied.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 单据详情弹窗（内含审批操作与填写节点确认，销假弹窗亦走此弹窗） */}
      <BizDetailDialog
        open={!!detailBiz}
        biz={detailBiz}
        form={form}
        approvals={detailApprs}
        maps={{ nameMap, profileMap, deptMap }}
        userId={user?.id ?? ''}
        onClose={() => setDetailBiz(null)}
        onActed={() => { setDetailBiz(null); load(); }}
      />

      {/* 单据编辑弹窗：当前页编辑，保存/提交后刷新列表 */}
      <BizEditDialog
        open={!!editBiz}
        biz={editBiz}
        form={form}
        onClose={() => setEditBiz(null)}
        onSaved={() => { setEditBiz(null); load(); }}
      />
    </div>
  );
}

/** 单据表格行：事项类型/申请人/部门/职位/状态/创建时间/操作 */
function BizRow({ row, formName, form, onOpen, onEdit, rowActions, profile, approvals, statusMaps }: {
  row: Row;
  formName: string;
  form: MetaForm | null;
  onOpen: () => void;
  onEdit: () => void;
  rowActions?: ActionDef[];
  profile: ReturnType<typeof useAuth>['profile'];
  approvals?: BizApproval[];
  statusMaps: FormSmMap;
}) {
  const actions = rowActions && rowActions.length > 0 ? rowActions : [
    { id: 'view', name: '查看详情', action_type: 'VIEW' },
  ] as ActionDef[];
  // 附加条件变量：canApprove/canFill（当前用户是否为该单据当前待处理节点的审批人/填写人），与列表设计-操作项显示条件一致
  const uid = profile?.id ?? '';
  const has = (fill: boolean) => (approvals ?? []).some((a) => a.current && a.state === 'pending' && (fill ? a.node_type === 'fill' : a.node_type !== 'fill') && (a.approvers ?? []).includes(uid) && !a.acts.some((act) => act.user_id === uid) && (a.mode !== 'sequential' || currentTurnOf(a) === uid));
  const extra = { canApprove: has(false), canFill: has(true) };
  // 状态机状态（当前表单自定义状态名称参与 status 比较）
  const smStates = statusMaps.get(row.form_id)?.states;
  const visible = actions.filter((a) => passCond(a.show_condition, row, profile, extra, smStates));
  const statusLabel = resolveStatusLabel(row.form_id, row.status, statusMaps);
  const code = resolveBizCode(form, row.payload, row.title || undefined);
  return (
    <tr className="hover:bg-muted/50">
      <td className="px-4 py-3 whitespace-nowrap">
        <p className="font-medium text-foreground truncate max-w-[14rem]">{code}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[14rem]">{formName || '业务表单'}</p>
      </td>
      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{row.applicant}</td>
      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{row.dept ?? '—'}</td>
      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{row.position ?? '—'}</td>
      <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={row.status} label={statusLabel} /></td>
      <td className="px-4 py-3 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(row.created_at, true)}</td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <span className="sig-row-actions inline-flex gap-1.5">
          {visible.map((a) => {
            const enabled = passCond(a.enable_condition, row, profile, extra, smStates);
            return (
              <Button key={a.id} size="sm" variant="outline" className="h-7 text-xs" disabled={!enabled} onClick={() => {
                if (!enabled) return;
                // 编辑类操作：当前页弹出编辑弹窗；填写节点（如销假）/其余打开详情弹窗（详情内含填写确认）
                if (a.action_type === 'EDIT') onEdit();
                else onOpen();
              }}>
                {a.action_type === 'EDIT' ? <Pencil className="mr-1 h-3.5 w-3.5" /> : a.action_type === 'FILL_NODE' ? <PencilLine className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
                {a.name}
              </Button>
            );
          })}
        </span>
      </td>
    </tr>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="bg-card border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
      <ClipboardList className="h-5 w-5" />
      {text}
    </div>
  );
}