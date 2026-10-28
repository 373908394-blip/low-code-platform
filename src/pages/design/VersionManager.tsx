import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { MetaForm, MetaVersion } from '@/types';
import { fmtDate } from '@/lib/field-catalog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataPagination } from '@/components/ui/data-pagination';
import { toast } from 'sonner';
import { ChevronLeft, History, RotateCcw, Eye, Loader2, Rocket } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function VersionManager() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [form, setForm] = useState<MetaForm | null>(null);
  const [versions, setVersions] = useState<MetaVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<MetaVersion | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<MetaVersion | null>(null);
  const [rolling, setRolling] = useState(false);

  // 客户端分页
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const verTotalPages = Math.max(1, Math.ceil(versions.length / pageSize));
  const verSafePage = Math.min(page, verTotalPages);
  const pagedVersions = versions.slice((verSafePage - 1) * pageSize, verSafePage * pageSize);

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    const [fRes, vRes] = await Promise.all([
      supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle(),
      supabase.from('meta_version').select('*').eq('form_id', formId).order('version', { ascending: false }),
    ]);
    setForm(fRes.data as MetaForm | null);
    setVersions((vRes.data as MetaVersion[]) ?? []);
    setLoading(false);
  }, [formId]);

  useEffect(() => {
    load();
  }, [load]);

  const rollback = async () => {
    if (!rollbackTarget || !form) return;
    setRolling(true);
    const fields = (rollbackTarget.snapshot as { fields?: unknown })?.fields;
    const { error } = await supabase.from('meta_forms').update({
      schema_json: fields ? { fields } : form.schema_json,
      version: rollbackTarget.version + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', formId!);
    if (error) {
      setRolling(false);
      return toast.error('回滚失败：' + error.message);
    }
    await supabase.from('meta_version').insert({
      tenant_id: tenantId,
      form_id: formId!,
      version: rollbackTarget.version + 1,
      snapshot: rollbackTarget.snapshot,
      changelog: `回滚至 v${rollbackTarget.version}`,
      created_by: profile?.id ?? null,
    });
    setRolling(false);
    setRollbackTarget(null);
    toast.success(`已回滚到 v${rollbackTarget.version}，生成新版本 v${rollbackTarget.version + 1}`);
    load();
  };

  const republish = async (v: MetaVersion) => {
    const { error } = await supabase.from('meta_forms').update({ published_version: v.version, status: 'published' }).eq('id', formId!);
    if (error) return toast.error('发布失败：' + error.message);
    toast.success(`已将 v${v.version} 发布到运行环境`);
    load();
  };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!form) return <div className="p-8 text-center text-muted-foreground">表单不存在</div>;

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-2 mb-6 min-w-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/design/apps')}><ChevronLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{form.name} · 版本管理</h1>
          <p className="text-sm text-muted-foreground mt-1">当前 v{form.version} · 运行环境 v{form.published_version}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-2.5 font-medium whitespace-nowrap">版本</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">变更说明</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">操作人</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">时间</th>
              <th className="px-5 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pagedVersions.map((v) => (
              <tr key={v.id} className={`hover:bg-muted/50 ${v.version === form.published_version ? 'bg-primary/[0.04]' : ''}`}>
                <td className="px-5 py-3 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold sig-num">v{v.version}</span>
                    {v.version === form.published_version && <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-[10px]">线上</Badge>}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{v.changelog ?? '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">{v.created_by ? '我' : '系统'}</td>
                <td className="px-4 py-3 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(v.created_at, true)}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <span className="sig-row-actions inline-flex gap-1.5">
                    <button type="button" className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors inline-flex items-center gap-1" onClick={() => setPreview(v)}>
                      <Eye className="h-3 w-3" />预览
                    </button>
                    {v.version !== form.published_version && (
                      <>
                        <button type="button" className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors inline-flex items-center gap-1" onClick={() => republish(v)}>
                          <Rocket className="h-3 w-3" />发布此版
                        </button>
                        <button type="button" className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors inline-flex items-center gap-1" onClick={() => setRollbackTarget(v)}>
                          <RotateCcw className="h-3 w-3" />回滚
                        </button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {versions.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground flex items-center justify-center gap-2"><History className="h-4 w-4" />还没有历史版本，发布一次表单即可生成</td></tr>
            )}
          </tbody>
        </table>
        <DataPagination total={versions.length} page={verSafePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
      </div>

      {/* 预览弹窗 */}
      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader><DialogTitle>v{preview?.version} 元数据快照（沙箱预览）</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-72 rounded-md bg-muted/50 p-3">
            <pre className="text-[11px] leading-relaxed break-all whitespace-pre-wrap font-mono">
              {preview ? JSON.stringify(preview.snapshot, null, 2).slice(0, 4000) : ''}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 回滚确认 */}
      <Dialog open={!!rollbackTarget} onOpenChange={(v) => !v && setRollbackTarget(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>回滚到 v{rollbackTarget?.version}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            将表单结构恢复为 v{rollbackTarget?.version} 的定义，并生成新版本 v{(rollbackTarget?.version ?? 0) + 1}。历史业务数据不受影响，按各自创建时的版本解析展示。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackTarget(null)}>取消</Button>
            <Button onClick={rollback} disabled={rolling}>{rolling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认回滚</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
