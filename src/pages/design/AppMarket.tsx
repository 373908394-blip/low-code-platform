import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GuideButton } from '@/components/common/GuideButton';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { APP_TEMPLATES, TEMPLATE_CATEGORIES, type AppTemplate } from '@/lib/app-templates';
import { getIcon } from '@/lib/icon-registry';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Store, CheckCircle2, Loader2, FileText, Layers, Workflow, GitBranch, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 市场指南 */
const MARKET_GUIDE = {
  intro: '应用市场提供内置业务应用插件，一键安装即可在导航中出现对应菜单与表单。',
  sections: [
    {
      title: '安装应用',
      items: [
        '点击组件卡片上的「安装」，进入安装向导',
        '向导两步：确认组件内容 → 确认安装',
        '安装后顶部导航与侧栏会自动出现该组件的一级菜单与子菜单',
      ],
    },
    {
      title: '安装后',
      items: [
        '已安装的组件会标记「已安装」，可在「我的应用」中直接使用',
        '如需卸载，点击卡片上的「卸载」，菜单入口将被移除，业务数据完整保留',
        '安装的应用可在应用列表中继续编辑字段、列表、流程与状态机',
      ],
    },
  ],
};

export default function AppMarket() {
  const { profile } = useAuth();
  const [category, setCategory] = useState('全部');
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState<AppTemplate | null>(null);
  const [step, setStep] = useState(1);
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState<AppTemplate | null>(null);

  const loadInstalled = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('meta_menu').select('name').is('parent_id', null);
    const names = new Set(((data ?? []) as { name: string }[]).map((m) => m.name));
    setInstalledNames(names);
    setLoading(false);
  }, []);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  const filtered = useMemo(
    () => (category === '全部' ? APP_TEMPLATES : APP_TEMPLATES.filter((t) => t.category === category)),
    [category],
  );

  const openWizard = (t: AppTemplate) => { setWizard(t); setStep(1); };
  const closeWizard = () => { if (!installing) { setWizard(null); setStep(1); } };

  const install = async () => {
    if (!wizard) return;
    setInstalling(true);
    const { data, error } = await supabase.functions.invoke('install_app_template', {
      body: { component_id: wizard.id },
    });
    setInstalling(false);
    if (error) {
      let msg = '安装失败';
      try {
        const body = await error.context?.json?.();
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
      toast.error(msg);
      return;
    }
    if (data?.error) { toast.error(data.error); return; }
    toast.success(`「${wizard.name}」安装成功，正在刷新页面…`);
    setWizard(null);
    setStep(1);
    // 触发全局菜单重新加载事件，随后整页刷新，确保新增菜单完全就位后再可操作
    window.dispatchEvent(new CustomEvent('menu-updated'));
    setTimeout(() => {
      window.location.href = data?.first_form_id ? `/app/${data.first_form_id}` : '/market';
    }, 600);
  };

  const uninstall = async (t: AppTemplate) => {
    setUninstalling(true);
    const { data, error } = await supabase.functions.invoke('install_app_template', {
      body: { component_id: t.id, action: 'uninstall' },
    });
    setUninstalling(false);
    setConfirmUninstall(null);
    if (error) {
      let msg = '卸载失败';
      try {
        const body = await error.context?.json?.();
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
      toast.error(msg);
      return;
    }
    if (data?.error) { toast.error(data.error); return; }
    toast.success(`「${t.name}」已卸载，菜单入口已移除，业务数据已保留`);
    window.dispatchEvent(new CustomEvent('menu-updated'));
    loadInstalled();
  };

  const isInstalled = (t: AppTemplate) => installedNames.has(t.name);

  return (
    <div className="p-4 md:p-8">
      {/* 安装/卸载中的全屏加载遮罩：锁定页面，操作完成（含菜单就位刷新）后自动解除 */}
      {(installing || uninstalling) && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">
            {installing ? '正在安装插件，请稍候…' : '正在卸载插件，请稍候…'}
          </p>
          <p className="text-xs text-muted-foreground">安装完成后将自动刷新页面并进入应用</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">应用市场</h1>
          <p className="text-sm text-muted-foreground mt-1">一键安装开箱即用的业务应用插件，安装后自动出现在导航中</p>
        </div>
        <div className="flex gap-2.5">
          <GuideButton label="应用市场" guide={MARKET_GUIDE} />
          <Button variant="outline" asChild>
            <Link to="/design/apps"><FileText className="mr-1.5 h-4 w-4" />我的应用</Link>
          </Button>
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TEMPLATE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              'h-8 px-3 rounded-md text-xs font-medium transition-colors border',
              category === c ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/60',
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {loading && <div className="py-20 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin inline mr-2" />加载中…</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((t) => {
          const Icon = getIcon(t.icon);
          const installed = isInstalled(t);
          return (
            <div key={t.id} className="bg-card border border-border rounded-lg p-4 h-full flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">{t.name}</p>
                    {installed && (
                      <Badge className="bg-primary/10 text-primary hover:bg-primary/10 shrink-0 text-[10px]">
                        <CheckCircle2 className="mr-1 h-3 w-3" />已安装
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.category}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-4">{t.description}</p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {t.forms.map((f) => (
                  <span key={f.name} className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                    <Layers className="h-3 w-3" />{f.name}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex items-center gap-2">
                {installed ? (
                  <>
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link to="/design/apps">进入使用</Link>
                    </Button>
                    <Button variant="outline" size="sm" className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/5" onClick={() => setConfirmUninstall(t)} disabled={uninstalling}>
                      卸载
                    </Button>
                  </>
                ) : (
                  <Button size="sm" className="flex-1" onClick={() => openWizard(t)}>
                    <Store className="mr-1.5 h-3.5 w-3.5" />安装应用
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 安装向导 */}
      <Dialog open={!!wizard} onOpenChange={(o) => { if (!o) closeWizard(); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {wizard && (() => { const I = getIcon(wizard.icon); return <I className="h-5 w-5 text-primary" />; })()}
              安装「{wizard?.name}」
            </DialogTitle>
          </DialogHeader>

          {/* 步骤指示 */}
          <div className="flex items-center gap-2 mb-4">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={cn('h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-medium border', step >= s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border')}>
                  {s}
                </div>
                {s < 2 && <div className={cn('h-0.5 flex-1 rounded', step > s ? 'bg-primary' : 'bg-border')} />}
              </div>
            ))}
          </div>

          {step === 1 && wizard && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{wizard.description}</p>
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">包含表单</p>
                {wizard.forms.map((f) => (
                  <div key={f.name} className="flex items-center gap-2 rounded-md border border-border p-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted/60 text-muted-foreground">
                      {(() => { const I = getIcon(f.icon); return <I className="h-3.5 w-3.5" />; })()}
                    </span>
                    <span className="text-sm flex-1 min-w-0 truncate">{f.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {f.mode === 'state' && <GitBranch className="h-3 w-3 text-muted-foreground" />}
                      {f.mode === 'approval' && <Workflow className="h-3 w-3 text-muted-foreground" />}
                      <span className="text-[10px] text-muted-foreground">{f.fields} 字段</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">安装后将创建上述表单与菜单，并自动挂载到顶部导航与侧栏。</p>
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p>· 审批类表单会自动生成工作台待办入口（待我审批 / 我申请的）</p>
                <p>· 跨表单引用（如报销关联明细单、项目关联客户）会自动重映射到当前企业</p>
                <p>· 跨组件共享的表单不会重复创建，多个组件可复用同一份数据结构</p>
              </div>
            </div>
          )}

          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button variant="outline" onClick={closeWizard} disabled={installing}>取消</Button>
            <div className="flex gap-2">
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={installing}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" />上一步
                </Button>
              )}
              {step < 2 ? (
                <Button onClick={() => setStep((s) => s + 1)}>
                  下一步<ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={install} disabled={installing}>
                  {installing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {installing ? '安装中…' : '确认安装'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 卸载确认 */}
      <Dialog open={!!confirmUninstall} onOpenChange={(o) => { if (!o && !uninstalling) setConfirmUninstall(null); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader>
            <DialogTitle>卸载「{confirmUninstall?.name}」</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            卸载后左侧菜单中的该组件入口将被移除，但已提交的业务数据会完整保留，重新安装后仍可在应用列表中查看历史数据。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUninstall(null)} disabled={uninstalling}>取消</Button>
            <Button variant="destructive" onClick={() => confirmUninstall && uninstall(confirmUninstall)} disabled={uninstalling}>
              {uninstalling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {uninstalling ? '卸载中…' : '确认卸载'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}