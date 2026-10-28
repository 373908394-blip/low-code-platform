import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import type { MetaForm } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, Loader2, FileText, Workflow, ListChecks, GitBranch, Rocket, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import FormDesigner from './FormDesigner';
import FlowDesigner from './FlowDesigner';
import ListDesigner from './ListDesigner';
import StateDesigner from './StateDesigner';
import PageDesigner from './PageDesigner';

const TABS = [
  { value: 'form', label: '表单设计', icon: FileText },
  { value: 'flow', label: '流程设计', icon: Workflow },
  { value: 'list', label: '列表设计', icon: ListChecks },
  { value: 'state', label: '状态机', icon: GitBranch },
] as const;

/** 按表单模式裁剪选项卡：流程设计仅审批表单可见，状态机=状态机表单+审批表单可见；普通/向导表单仅表单+列表 */
const visibleTabsOf = (mode: string | undefined) =>
  TABS.filter((t) => {
    if (t.value === 'flow') return mode === 'approval';
    if (t.value === 'state') return mode === 'state' || mode === 'approval';
    return true;
  });

/** 统一设计器：顶部选项卡按表单模式动态裁剪（表单/流程/列表/状态机），默认表单设计 */
export default function Designer() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'form';
  const [form, setForm] = useState<MetaForm | null>(null);
  const [loading, setLoading] = useState(true);
  // 发布中状态：由 FormDesigner 通过 designer-publishing 事件同步（发布按钮已上移至选项卡行）
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    const h = (e: Event) => setPublishing((e as CustomEvent<boolean>).detail === true);
    window.addEventListener('designer-publishing', h);
    return () => window.removeEventListener('designer-publishing', h);
  }, []);

  const load = useCallback(async () => {
    if (!formId) return;
    const { data } = await supabase.from('meta_forms').select('*').eq('id', formId).maybeSingle();
    setForm((data as MetaForm) ?? null);
    setLoading(false);
  }, [formId]);

  useEffect(() => {
    load();
  }, [load]);

  const onTabChange = (v: string) => setSearchParams({ tab: v }, { replace: true });

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // 设计权限拦截：表单/流程/列表/状态机等设计数据仅超级管理员可修改（与数据库 RLS 策略一致），避免配置后才保存失败
  if (!profile?.is_superadmin) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium">仅超级管理员可设计表单</p>
        <p className="text-xs text-muted-foreground">表单结构、流程、列表与操作项等设计配置由超级管理员统一维护，如需调整请联系管理员</p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>返回</Button>
      </div>
    );
  }
  if (!form) {
    return <div className="p-8 text-center text-muted-foreground">表单不存在</div>;
  }

  // 单页设计类型：仅渲染单页设计器（无流程/列表/状态机）
  if (form.app_type === 'page') {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        <div className="shrink-0 border-b border-border bg-white">
          <div className="flex items-center gap-2 px-4 pt-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/design/apps')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold truncate">{form.name}</span>
            <Badge className="shrink-0 bg-muted text-muted-foreground hover:bg-muted">
              v{form.version}
              {form.status === 'published' ? ` · 已发布 v${form.published_version}` : ' · 草稿'}
            </Badge>
          </div>
          <div className="flex items-center justify-end px-4 pb-2">
            <Button size="sm" className="h-8 shrink-0" onClick={() => window.dispatchEvent(new Event('designer-publish'))} disabled={publishing}>
              {publishing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
              {publishing ? '发布中…' : '发布'}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <PageDesigner embedded />
        </div>
      </div>
    );
  }

  const visibleTabs = visibleTabsOf(form.form_mode);
  // URL 携带当前模式不支持的设计页（如普通表单 ?tab=flow）时兜底回表单设计
  const tab = visibleTabs.some((t) => t.value === rawTab) ? rawTab : 'form';

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* 顶部：返回 + 表单名 + 选项卡（纯白背景） */}
      <div className="shrink-0 border-b border-border bg-white">
        <div className="flex items-center gap-2 px-4 pt-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/design/apps')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold truncate">{form.name}</span>
          {form.app_type === 'form' && (
            <Badge className="shrink-0 bg-accent/10 text-accent hover:bg-accent/10">
              {form.form_mode === 'state' ? '状态机表单' : form.form_mode === 'approval' ? '审批表单' : form.form_mode === 'wizard' ? '表单（向导步骤组件）' : '普通表单'}
            </Badge>
          )}
          <Badge className="shrink-0 bg-muted text-muted-foreground hover:bg-muted">
            v{form.version}
            {form.status === 'published' ? ` · 已发布 v${form.published_version}` : ' · 草稿'}
          </Badge>
        </div>
        {/* 选项卡行 + 右侧发布按钮 */}
        <div className="flex items-center justify-between gap-2 px-4">
          <Tabs value={tab} onValueChange={onTabChange}>
            <TabsList className="h-10 gap-1 bg-transparent p-0">
              {visibleTabs.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.value}
                    value={t.value}
                    className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          <Button size="sm" className="h-8 shrink-0" onClick={() => window.dispatchEvent(new Event('designer-publish'))} disabled={publishing}>
            {publishing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
            {publishing ? '发布中…' : '发布'}
          </Button>
        </div>
      </div>

      {/* 内容区：表单设计常挂载（发布逻辑位于其中），切走时隐藏以保证发布事件始终可响应 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={cn('h-full', tab !== 'form' && 'hidden')}>
          <FormDesigner embedded />
        </div>
        {tab === 'flow' && <FlowDesigner embedded />}
        {tab === 'list' && <ListDesigner embedded />}
        {tab === 'state' && <StateDesigner embedded />}
      </div>
    </div>
  );
}