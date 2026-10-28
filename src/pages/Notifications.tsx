import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { BizApproval, BizData, MetaForm, Notification } from '@/types';
import { fmtDate } from '@/lib/field-catalog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataPagination } from '@/components/ui/data-pagination';
import { BizDetailDialog, type SysMaps, type SysProfile } from '@/components/biz/BizDetailDialog';
import { Bell, CheckCheck, Inbox, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

/** 通知对应单据详情（含表单定义/审批节点/档案映射） */
interface NotifyDetail {
  biz: BizData;
  form: MetaForm | null;
  approvals: BizApproval[];
  maps: SysMaps;
}

export default function Notifications() {
  const { user } = useAuth();
  const [list, setList] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<NotifyDetail | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = list.slice((safePage - 1) * pageSize, safePage * pageSize);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setList((data as Notification[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const markAll = async () => {
    const ids = list.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    await supabase.from('notifications').update({ read: true }).in('id', ids);
    toast.success('已全部标记为已读');
    window.dispatchEvent(new Event('notifications-updated'));
    load();
  };

  /** 点击通知：标记已读；关联单据时在当前页弹出单据详情（不跳转页面） */
  const open = async (n: Notification) => {
    if (!n.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', n.id);
    }
    if (!n.biz_id) return load();
    const { data: biz } = await supabase.from('biz_data').select('*').eq('id', n.biz_id).maybeSingle();
    if (!biz) {
      toast.error('单据不存在或已被删除');
      return load();
    }
    // 按需加载表单定义/审批节点/创建人档案与部门（系统字段取值）
    const [formRes, apprRes, deptRes, profRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', (biz as BizData).form_id).maybeSingle(),
      supabase.from('biz_approval').select('*').eq('biz_id', n.biz_id).order('created_at'),
      supabase.from('departments').select('id, name'),
      supabase.from('profiles').select('id, name, position, department_id').eq('id', (biz as BizData).created_by).maybeSingle(),
    ]);
    const nameMap = new Map<string, string>();
    const profileMap = new Map<string, SysProfile>();
    if (profRes.data) {
      const p = profRes.data as SysProfile & { id: string };
      nameMap.set(p.id, p.name);
      profileMap.set(p.id, p);
    }
    setDetail({
      biz: biz as BizData,
      form: (formRes.data as MetaForm | null) ?? null,
      approvals: (apprRes.data as BizApproval[]) ?? [],
      maps: { nameMap, profileMap, deptMap: new Map(((deptRes.data as { id: string; name: string }[]) ?? []).map((d) => [d.id, d.name])) },
    });
    window.dispatchEvent(new Event('notifications-updated'));
    load();
  };

  /** 删除通知：从列表移除并同步未读角标 */
  const del = async (n: Notification) => {
    await supabase.from('notifications').delete().eq('id', n.id);
    toast.success('已删除');
    window.dispatchEvent(new Event('notifications-updated'));
    load();
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">通知中心</h1>
          <p className="text-sm text-muted-foreground mt-1">待办任务与系统消息</p>
        </div>
        <Button variant="outline" onClick={markAll} disabled={list.every((n) => n.read)}>
          <CheckCheck className="mr-1.5 h-4 w-4" />全部已读
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg">
        <ul className="divide-y divide-border">
          {loading && <li className="px-5 py-12 text-center text-sm text-muted-foreground">加载中…</li>}
          {!loading && list.length === 0 && (
            <li className="px-5 py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <span className="text-sm">暂无通知</span>
            </li>
          )}
          {paged.map((n) => (
            <li key={n.id} className="flex items-start gap-1 px-5 py-4 hover:bg-muted/50 transition-colors">
              <button type="button" onClick={() => open(n)} className="flex flex-1 min-w-0 items-start gap-3.5 text-left">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${n.type === 'todo' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <Bell className="h-4 w-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{n.title}</span>
                    {!n.read && <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5">未读</Badge>}
                    {n.type === 'todo' && <Badge variant="outline" className="text-[10px] px-1.5">待办</Badge>}
                  </span>
                  {n.body && <span className="mt-0.5 block text-xs text-muted-foreground truncate">{n.body}</span>}
                </span>
                <span className="text-xs text-muted-foreground sig-num shrink-0">{fmtDate(n.created_at ?? '', true)}</span>
              </button>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => del(n)}>
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">删除</span>
              </Button>
            </li>
          ))}
        </ul>
        <DataPagination total={list.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
      </div>

      {/* 单据详情弹窗：通知关联单据当前页查看（内含审批操作与填写节点确认） */}
      <BizDetailDialog
        open={!!detail}
        biz={detail?.biz ?? null}
        form={detail?.form ?? null}
        approvals={detail?.approvals ?? []}
        maps={detail?.maps}
        userId={user?.id ?? ''}
        onClose={() => setDetail(null)}
        onActed={() => { setDetail(null); load(); }}
      />
    </div>
  );
}
