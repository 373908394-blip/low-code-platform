import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GuideButton } from '@/components/common/GuideButton';
import { APPS_GUIDE } from '@/lib/page-guides';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { ensureTodoMenu } from '@/services/publish';
import type { MetaForm } from '@/types';
import { fmtDate, SYSTEM_FIELDS } from '@/lib/field-catalog';
import { slugFromName, nextAutoSlug } from '@/lib/slug';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Boxes, Plus, Loader2, Settings2, ListChecks, Workflow, GitBranch, Rocket, History, Trash2, FileText, Store, ExternalLink, ShieldAlert, Search, X, SlidersHorizontal, PencilLine, LayoutTemplate, ListOrdered } from 'lucide-react';
import { SearchFilterBar, FilterField } from '@/components/common/SearchFilterBar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { DataPagination } from '@/components/ui/data-pagination';

export default function AppList() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<MetaForm[]>([]);
  const [dialog, setDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  // 应用名称变更时自动生成拼音标识：标识为空或等于旧名称生成值（未被人工定制）时跟随
  const updName = (v: string) => {
    const nextCode = nextAutoSlug(v, name, code);
    setName(v);
    if (nextCode !== null) setCode(nextCode);
  };
  const [appType, setAppType] = useState<'form' | 'page'>('form');
  const [formMode, setFormMode] = useState<'normal' | 'state' | 'approval'>('normal');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published'>('all');
  // 编辑应用信息弹窗
  const [editTarget, setEditTarget] = useState<MetaForm | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'form' | 'page'>('form');
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('meta_forms').select('*').order('updated_at', { ascending: false });
    setForms((data as MetaForm[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return toast.error('请填写应用名称');
    // 标识为空时以名称拼音兜底生成（中文名直接清洗会得到空串）
    const base = (code.trim() || slugFromName(name)).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    // 查询当前租户已存在的应用编码，避免唯一约束冲突
    const { data: existing } = await supabase.from('meta_forms').select('code').eq('tenant_id', tenantId);
    const exists = new Set(((existing as { code: string }[]) ?? []).map((r) => r.code));
    // 用户显式输入编码且已存在 → 阻断提示
    if (code.trim() && exists.has(base)) {
      return toast.error('应用编码已存在，请重新输入');
    }
    // 自动生成时若冲突则追加数字后缀
    let finalCode = base;
    let i = 2;
    while (exists.has(finalCode)) {
      finalCode = `${base}_${i}`;
      i += 1;
    }
    const { data, error } = await supabase.from('meta_forms').insert({
      tenant_id: tenantId,
      name: name.trim(),
      code: finalCode,
      icon: 'boxes',
      app_type: appType,
      form_mode: appType === 'form' ? formMode : 'normal',
      version: 1,
      published_version: 0,
      status: 'draft',
      schema_json: { fields: SYSTEM_FIELDS.map((f) => ({ ...f })) },
      list_config: { columns: [], search: [], actions: ['view', 'edit', 'delete'] },
    }).select().single();
    if (error) {
      if (error.code === '23505') return toast.error('应用编码已存在，请更换应用名称或编码后重试');
      return toast.error('创建失败：' + error.message);
    }
    toast.success('应用已创建，开始设计吧');
    setDialog(false);
    setName('');
    setCode('');
    setAppType('form');
    setFormMode('normal');
    navigate(`/design/${data.id}`);
  };

  const openEdit = (f: MetaForm) => {
    setEditTarget(f);
    setEditName(f.name);
    setEditType(f.app_type ?? 'form');
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    if (!editName.trim()) return toast.error('请填写应用名称');
    setEditSaving(true);
    const { error } = await supabase.from('meta_forms').update({
      name: editName.trim(),
      app_type: editType,
      updated_at: new Date().toISOString(),
    }).eq('id', editTarget.id);
    setEditSaving(false);
    if (error) return toast.error('保存失败：' + error.message);
    toast.success('应用信息已更新');
    setEditTarget(null);
    load();
  };

  const remove = async (f: MetaForm) => {
    const { count } = await supabase.from('biz_data').select('id', { count: 'exact', head: true }).eq('form_id', f.id).eq('is_deleted', false);
    if ((count ?? 0) > 0) return toast.error(`该表单已有 ${count} 条业务数据，为保护数据不可删除`);
    const { error } = await supabase.from('meta_forms').delete().eq('id', f.id);
    if (error) return toast.error('删除失败：' + error.message);
    toast.success('应用已删除');
    load();
  };

  const publish = async (f: MetaForm) => {
    if (publishing) return;
    setPublishing(f.id);
    try {
      const newVer = (f.version ?? 0) + 1;
      const { error, count } = await supabase.from('meta_forms').update(
        { published_version: newVer, status: 'published' },
        { count: 'exact' },
      ).eq('id', f.id);
      if (error) throw new Error(error.message);
      if ((count ?? 0) === 0) throw new Error('无权限或表单不存在');
      await supabase.from('meta_version').insert({
        tenant_id: tenantId,
        form_id: f.id,
        version: newVer,
        snapshot: {} as Record<string, unknown>,
        changelog: `发布 v${newVer}`,
        created_by: profile?.id ?? null,
      });
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId,
        user_id: profile?.id,
        user_name: profile?.name,
        action: '发布表单',
        target: `${f.name} v${newVer}`,
        detail: { version: newVer },
      });
      await ensureTodoMenu(f.id);
      toast.success(`已发布 v${newVer}`);
      load();
    } catch (e) {
      toast.error((e as Error).message || '发布失败');
    } finally {
      setPublishing(null);
    }
  };

  // 设计权限拦截：新建/发布应用等写操作仅超级管理员可用（与数据库 RLS 策略一致），非超管仅浏览
  const canDesign = !!profile?.is_superadmin;

  const filteredForms = forms.filter((f) => {
    const kw = keyword.trim();
    const matchKeyword = !kw || f.name.toLowerCase().includes(kw.toLowerCase()) || f.code.toLowerCase().includes(kw.toLowerCase());
    const matchStatus = statusFilter === 'all' || f.status === statusFilter;
    return matchKeyword && matchStatus;
  });

  // 卡片网格客户端分页；筛选条件变化后回到第一页
  const totalPages = Math.max(1, Math.ceil(filteredForms.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedForms = filteredForms.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [keyword, statusFilter]);

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">应用列表</h1>
          <p className="text-sm text-muted-foreground mt-1">每个应用 = 一张业务表单（字段 + 列表 + 流程 + 状态机）</p>
        </div>
        <div className="flex gap-2.5">
          <GuideButton label="应用列表" guide={APPS_GUIDE} />
          <Button variant="outline" asChild>
            <Link to="/design/market"><Store className="mr-1.5 h-4 w-4" />应用市场</Link>
          </Button>
          {canDesign ? (
            <Button onClick={() => setDialog(true)}><Plus className="mr-1.5 h-4 w-4" />新建应用</Button>
          ) : (
            <Button variant="outline" disabled title="仅超级管理员可新建应用" onClick={() => toast.error('仅超级管理员可新建应用')}>
              <ShieldAlert className="mr-1.5 h-4 w-4" />仅超管可新建
            </Button>
          )}
        </div>
      </div>

      {loading && <div className="py-20 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin inline mr-2" />加载中…</div>}

      {!loading && (
        <SearchFilterBar className="mb-5" actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => { setKeyword(''); setStatusFilter('all'); }}>
              <X className="mr-1.5 h-4 w-4" />重置
            </Button>
            <Button size="sm" variant="secondary" onClick={load}>
              <Search className="mr-1.5 h-4 w-4" />查询
            </Button>
          </>
        )}>
          <FilterField label="应用名称/编码">
            <div className="relative h-full">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input className="h-9 pl-8 px-2" placeholder="请输入关键字" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
          </FilterField>
          <FilterField label="发布状态">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'draft' | 'published')}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </SearchFilterBar>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {pagedForms.map((f) => {
          const fieldCount = f.schema_json?.fields?.filter((x) => !['group-title', 'grid', 'divider', 'description'].includes(x.type) && !x.system).length ?? 0;
          const isPage = f.app_type === 'page';
          return (
            <div key={f.id} className="bg-card border border-border rounded-lg p-5 h-full flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {isPage ? <LayoutTemplate className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{f.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{f.code}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={isPage ? 'border-accent/50 text-accent' : 'border-border text-muted-foreground'}>{isPage ? '单页设计' : '表单设计'}</Badge>
                  {f.status === 'published' ? (
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/10">已发布 v{f.published_version}</Badge>
                  ) : (
                    <Badge variant="outline">草稿</Badge>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center py-3 border-y border-border mb-4">
                <div><p className="text-lg font-bold sig-num">{fieldCount}</p><p className="text-xs text-muted-foreground">字段</p></div>
                <div><p className="text-lg font-bold sig-num">v{f.version}</p><p className="text-xs text-muted-foreground">当前版本</p></div>
                <div><p className="text-lg font-bold sig-num">{fmtDate(f.updated_at)}</p><p className="text-xs text-muted-foreground">更新</p></div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs mb-4">
                {isPage ? (
                  <Link to={`/design/${f.id}`} className="col-span-2 flex h-8 items-center justify-center gap-1.5 px-2.5 rounded-md border border-border hover:bg-muted/60 transition-colors"><LayoutTemplate className="h-3.5 w-3.5" />单页设计</Link>
                ) : (
                  <>
                    <Link to={`/design/${f.id}`} className="flex h-8 items-center gap-1.5 px-2.5 rounded-md border border-border hover:bg-muted/60 transition-colors"><Settings2 className="h-3.5 w-3.5" />表单设计</Link>
                    <Link to={`/design/${f.id}?tab=list`} className="flex h-8 items-center gap-1.5 px-2.5 rounded-md border border-border hover:bg-muted/60 transition-colors"><ListChecks className="h-3.5 w-3.5" />列表设计</Link>
                    {/* 模块入口按表单模式裁剪（与设计器 tab 一致）：普通表单无流程/状态机；状态机入口=状态机表单+审批表单；流程入口=仅审批表单 */}
                    {(f.form_mode === 'state' || f.form_mode === 'approval') && (
                      <Link to={`/design/${f.id}?tab=state`} className="flex h-8 items-center gap-1.5 px-2.5 rounded-md border border-border hover:bg-muted/60 transition-colors"><GitBranch className="h-3.5 w-3.5" />状态机</Link>
                    )}
                    {f.form_mode === 'approval' && (
                      <Link to={`/design/${f.id}?tab=flow`} className="flex h-8 items-center gap-1.5 px-2.5 rounded-md border border-border hover:bg-muted/60 transition-colors"><Workflow className="h-3.5 w-3.5" />流程设计</Link>
                    )}
                  </>
                )}
              </div>
              <div className="mt-auto space-y-2">
                {canDesign ? (
                  <Button size="sm" className="w-full" disabled={publishing === f.id} onClick={() => publish(f)}>
                    {publishing === f.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
                    发布
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" disabled title="仅超级管理员可发布" onClick={() => toast.error('仅超级管理员可发布')}>
                    <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />仅超管可发布
                  </Button>
                )}
                <div className="flex items-center gap-2">
                  <Link to={isPage ? `/page/${f.id}` : `/app/${f.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />打开应用</Button>
                  </Link>
                  {canDesign && (
                    <Button variant="ghost" size="sm" className="px-2.5" onClick={() => openEdit(f)} title="编辑应用信息">
                      <PencilLine className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="px-2.5" asChild>
                    <Link to={`/design/versions/${f.id}`}><History className="h-3.5 w-3.5" /></Link>
                  </Button>
                  {canDesign && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => remove(f)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!loading && forms.length === 0 && (
          <button type="button" onClick={() => setDialog(true)} className="border border-dashed border-border rounded-none py-16 flex flex-col items-center gap-3 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors col-span-full">
            <Boxes className="h-8 w-8" />
            <span className="text-sm">创建第一个业务应用</span>
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-[5px]">
        <DataPagination total={filteredForms.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
      </div>

      <Dialog open={dialog} onOpenChange={(v) => { setDialog(v); if (!v) { setAppType('form'); setFormMode('normal'); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>新建应用</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>应用类型</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAppType('form')}
                  className={cn('flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs transition-colors', appType === 'form' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                >
                  <FileText className="h-5 w-5" />
                  <span className="font-medium">表单设计</span>
                  <span className="text-[10px]">含增删改与审批流程</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAppType('page')}
                  className={cn('flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs transition-colors', appType === 'page' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                >
                  <LayoutTemplate className="h-5 w-5" />
                  <span className="font-medium">单页设计</span>
                  <span className="text-[10px]">只读查询展示页</span>
                </button>
              </div>
            </div>
            {appType === 'form' && (
              <div className="space-y-2">
                <Label>表单模式</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormMode('normal')}
                    className={cn('flex flex-col items-center gap-1 rounded-md border p-2.5 text-xs transition-colors', formMode === 'normal' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                  >
                    <FileText className="h-4 w-4" />
                    <span className="font-medium">普通表单</span>
                    <span className="text-[10px] text-center">增删改与列表</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormMode('state')}
                    className={cn('flex flex-col items-center gap-1 rounded-md border p-2.5 text-xs transition-colors', formMode === 'state' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                  >
                    <GitBranch className="h-4 w-4" />
                    <span className="font-medium">状态机表单</span>
                    <span className="text-[10px] text-center">状态流转驱动</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormMode('approval')}
                    className={cn('flex flex-col items-center gap-1 rounded-md border p-2.5 text-xs transition-colors', formMode === 'approval' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
                  >
                    <Workflow className="h-4 w-4" />
                    <span className="font-medium">审批表单</span>
                    <span className="text-[10px] text-center">多节点审批流</span>
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">向导分步填写已内置为表单组件：新建任意表单后，在表单设计的布局组件中添加「向导步骤」即可</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>应用名称 *</Label>
              <Input
                value={name}
                onCompositionEnd={(e) => { updName((e.target as HTMLInputElement).value); }}
                onChange={(e) => { if ((e.nativeEvent as InputEvent).isComposing) return; updName(e.target.value); }}
                placeholder="如：采购申请"
              />
            </div>
            <div className="space-y-2">
              <Label>标识（英文，用于 API）</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如：purchase（可留空自动生成）" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>取消</Button>
            <Button onClick={create} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}创建并进入设计</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v) setEditTarget(null); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>编辑应用信息</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>应用名称 *</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="应用名称" />
            </div>
            <div className="space-y-2">
              <Label>应用类型</Label>
              <Select value={editType} onValueChange={(v) => setEditType(v as 'form' | 'page')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="form">表单设计</SelectItem>
                  <SelectItem value="page">单页设计</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editType === 'form' && editTarget && (
              <div className="space-y-2">
                <Label>表单模式</Label>
                <div
                  className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/60 px-3 text-sm"
                  aria-readonly="true"
                >
                  {editTarget.form_mode === 'approval' ? (
                    <><Workflow className="h-4 w-4 text-primary" /><span>审批表单</span><span className="text-[10px] text-muted-foreground">多节点审批流</span></>
                  ) : editTarget.form_mode === 'wizard' ? (
                    <><ListOrdered className="h-4 w-4 text-primary" /><span>表单（向导步骤组件）</span><span className="text-[10px] text-muted-foreground">分步填写已组件化</span></>
                  ) : editTarget.form_mode === 'state' ? (
                    <><GitBranch className="h-4 w-4 text-primary" /><span>状态机表单</span><span className="text-[10px] text-muted-foreground">状态流转驱动</span></>
                  ) : (
                    <><FileText className="h-4 w-4 text-primary" /><span>普通表单</span><span className="text-[10px] text-muted-foreground">增删改与列表</span></>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">创建后不可修改</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>取消</Button>
            <Button onClick={saveEdit} disabled={editSaving}>{editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
