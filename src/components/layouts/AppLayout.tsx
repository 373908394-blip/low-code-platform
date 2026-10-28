import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Menu as MenuIcon, ChevronDown, LogOut, Boxes, Plus, Bell, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/db/supabase';
import { getIcon } from '@/lib/icon-registry';
import { applyTheme } from '@/lib/theme';
import type { MetaMenu } from '@/types';

/** 统一三级菜单树：一级（顶栏切换）→ 二级（侧栏折叠组）→ 三级（叶子页面） */
interface MenuLeaf { id: string; name: string; path: string; icon: string }
interface MenuGroup { id: string; name: string; icon: string; leaves: MenuLeaf[] }
interface MenuRoot { id: string; name: string; icon: string; groups: MenuGroup[] }

export function useMenuTree(): { menuTree: MenuRoot[]; menuLoading: boolean } {
  const [nav, setNav] = useState<MenuRoot[]>([]);
  /** 菜单首次加载完成前为 true，用于展示加载态并避免空菜单闪烁 */
  const [menuLoading, setMenuLoading] = useState(true);
  const { permissions, isSuperadmin } = useAuth();
  const load = useCallback(() => {
    supabase.from('meta_menu').select('*').order('sort_order').then(({ data }) => {
      if (!data) return;
      const all = (data as MetaMenu[]).filter((m) => m.status === 'published');
      const byParent = (pid: string | null) => all.filter((m) => m.parent_id === pid);
      // 菜单权限：叶子 path 即权限码。超管全放行；非超管仅保留其拥有权限的叶子，并据此裁剪空分组/空一级
      const leafVisible = (path: string) => isSuperadmin || !permissions || permissions.has(path);
      setNav(
        byParent(null)
          .map((r) => ({
            id: r.id,
            name: r.name,
            icon: r.icon,
            groups: byParent(r.id)
              .map((g) => ({
                id: g.id,
                name: g.name,
                icon: g.icon,
                leaves: byParent(g.id)
                  .filter((l) => l.path && leafVisible(l.path!))
                  .map((l) => ({ id: l.id, name: l.name, path: l.path!, icon: l.icon })),
              }))
              .filter((g) => g.leaves.length > 0),
          }))
          .filter((r) => r.groups.length > 0),
      );
      setMenuLoading(false);
    });
  }, [permissions, isSuperadmin]);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('menu-updated', handler);
    return () => window.removeEventListener('menu-updated', handler);
  }, [load]);

  return { menuTree: nav, menuLoading };
}

/**
 * 将 /app/<id> 与 /page/<id> 视为等价（单页类表单可能经任一路径访问），
 * 返回归一化路径用于高亮比较。
 */
function normalizePath(p: string): string {
  if (p.startsWith('/app/')) return `/page/${p.slice(5)}`;
  return p;
}

/** 精确匹配：'/' 仅匹配根路径；其余路径相等或以「路径/」开头（同一菜单页面） */
function exactMatch(leafPath: string, pathname: string): boolean {
  if (leafPath === '/') return pathname === '/';
  const lp = normalizePath(leafPath);
  const pn = normalizePath(pathname);
  return pn === lp || pn.startsWith(`${lp}/`);
}

/**
 * 目录前缀匹配：仅用于设计器等动态路由页面的归属推断
 * （如 /design/form/xxx 与菜单叶子 /design/menus 共享 /design 前缀）。
 * 仅两段及以上路径参与；一段路径（/users）不回退。
 * 注意：/app/<uuid> 类叶子前缀同为 /app，故本匹配只能作为「全局无精确命中」时的回退，
 * 绝不能先于精确匹配使用（否则任何 /app 页面都会误归属到排序靠前的应用）。
 */
function prefixMatch(leafPath: string, pathname: string): boolean {
  if (leafPath === '/' || !leafPath.startsWith('/')) return false;
  const idx = leafPath.lastIndexOf('/');
  if (idx <= 0) return false;
  const prefix = leafPath.slice(0, idx);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** root 内是否存在精确命中的叶子 */
function rootHasExact(root: MenuRoot, pathname: string): boolean {
  return root.groups.some((g) => g.leaves.some((l) => exactMatch(l.path, pathname)));
}

/** root 内是否存在前缀命中的叶子 */
function rootHasPrefix(root: MenuRoot, pathname: string): boolean {
  return root.groups.some((g) => g.leaves.some((l) => prefixMatch(l.path, pathname)));
}

/** 由当前路由反推所属一级菜单：先在全部一级菜单中找精确命中，找不到再按目录前缀回退 */
function findRootByPath(menuTree: MenuRoot[], pathname: string): MenuRoot | undefined {
  return menuTree.find((r) => rootHasExact(r, pathname)) ?? menuTree.find((r) => rootHasPrefix(r, pathname));
}

/** 由叶子 id 反查其所属一级菜单（同一表单可挂在不同一级菜单下，需按点击的真实归属判定） */
function findRootByLeafId(menuTree: MenuRoot[], leafId: string): MenuRoot | undefined {
  return menuTree.find((r) => r.groups.some((g) => g.leaves.some((l) => l.id === leafId)));
}

/** 一级菜单的第一个可跳转叶子 */
function firstLeafPath(root: MenuRoot): string {
  return root.groups[0]?.leaves[0]?.path ?? '/';
}

/** 侧栏：渲染当前一级菜单下的二三级（showRootTabs 供移动端抽屉顶部切换一级） */
function SidebarContent({ menuTree, activeRootId, onNavigate, onLeafNavigate, showRootTabs, branding, menuLoading }: {
  menuTree: MenuRoot[];
  activeRootId: string;
  onNavigate?: () => void;
  onLeafNavigate?: (leafId: string) => void;
  showRootTabs?: boolean;
  branding: { system_name: string; logo_url: string | null };
  menuLoading?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const activeRoot = menuTree.find((r) => r.id === activeRootId);
  /** 当前 root 内是否存在精确命中的叶子：有则分组/叶子一律用精确匹配，避免 /app 前缀误高亮其他分组 */
  const rootHasExactHit = activeRoot?.groups.some((g) => g.leaves.some((l) => exactMatch(l.path, location.pathname))) ?? false;
  /** 命中当前路由的叶子所属分组（用于自动展开，确保活动叶子可见） */
  const activeGroupId = activeRoot?.groups.find((g) => g.leaves.some((l) => exactMatch(l.path, location.pathname)))?.id;

  const toggle = (id: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
        {branding.logo_url ? (
          <img src={branding.logo_url} alt="系统 Logo" className="h-7 w-7 shrink-0 rounded object-contain" />
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground">
            <Boxes className="h-4 w-4" />
          </div>
        )}
        <span className="text-sm font-bold tracking-tight">{branding.system_name}</span>
      </div>

      {showRootTabs && (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {menuTree.map((r) => {
            const Icon = getIcon(r.icon);
            const active = r.id === activeRootId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => { navigate(firstLeafPath(r)); onNavigate?.(); }}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs font-medium transition-colors',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {r.name}
              </button>
            );
          })}
        </div>
      )}

      {activeRoot && (
        <div className="px-3 pt-4">
          <p className="px-2 text-xs font-medium text-muted-foreground">{activeRoot.name}</p>
        </div>
      )}

      <div className="px-3 py-3">
        <Link to="/design/menus" onClick={onNavigate} className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm text-primary transition-colors hover:bg-primary/5">
          <Plus className="h-4 w-4" />
          管理应用菜单
        </Link>
      </div>

      <ScrollArea className="flex-1 px-3 pb-4">
        <nav className="space-y-3">
          {activeRoot?.groups.map((group) => {
            const open = !collapsed.has(group.id) || group.id === activeGroupId;
            const groupActive = group.leaves.some((l) => exactMatch(l.path, location.pathname))
              || (!rootHasExactHit && group.leaves.some((l) => prefixMatch(l.path, location.pathname)));
            const GroupIcon = getIcon(group.icon);
            return (
              <div key={group.id}>
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 h-9 px-2 rounded-md text-sm transition-colors',
                    groupActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                  )}
                >
                  <GroupIcon className="h-4 w-4 shrink-0" />
                  {group.name}
                  <ChevronDown className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')} />
                </button>
                {open && (
                  <div className="mt-0.5 space-y-0.5">
                    {group.leaves.map((leaf) => {
                      const active = exactMatch(leaf.path, location.pathname);
                      return (
                        <Link
                          key={leaf.id}
                          to={leaf.path}
                          onClick={() => { onLeafNavigate?.(leaf.id); onNavigate?.(); }}
                          className={cn(
                            'flex items-center gap-2.5 h-9 pl-8 pr-2 rounded-md text-sm transition-colors',
                            active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                          )}
                        >
                          {leaf.name}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {menuTree.length === 0 && (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {menuLoading ? '菜单加载中…' : '暂无可用菜单'}
            </p>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut, user, globalBusy } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const { menuTree, menuLoading } = useMenuTree();
  /** 品牌信息：系统设置中的系统名称 + Logo（左上角显示） */
  const [branding, setBranding] = useState<{ system_name: string; logo_url: string | null }>({
    system_name: 'Low-code platform',
    logo_url: null,
  });

  useEffect(() => {
    supabase
      .from('sys_settings')
      .select('system_name, logo_url, theme_color')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.system_name) {
          setBranding({ system_name: data.system_name, logo_url: data.logo_url ?? null });
          document.title = data.system_name;
        }
        if (data?.theme_color) applyTheme(data.theme_color);
      });
  }, []);

  /** 记录最近点击的叶子所属一级菜单：用于同一表单挂在不同一级菜单下时动态判定高亮 */
  const [lastRootId, setLastRootId] = useState<string>(() => {
    try { return sessionStorage.getItem('miaoda_last_root') ?? ''; } catch { return ''; }
  });
  const persistRoot = useCallback((id: string) => {
    setLastRootId(id);
    try { sessionStorage.setItem('miaoda_last_root', id); } catch { /* ignore */ }
  }, []);

  /**
   * 由当前路由反推所属一级菜单。
   * 优先使用「最近点击叶子的真实归属」——只要当前路由仍命中该一级菜单下的某个叶子，
   * 即认定该一级菜单为活动项（解决同一表单挂在不同一级菜单下、纯路径匹配误选「系统设置」的问题）；
   * 否则回退到路径精确/前缀匹配，最后回退到「系统设置」或第一个一级菜单。
   */
  const activeRootId = useMemo(() => {
    // 优先：最近点击的一级菜单（点击叶子/一级按钮时记录），只要当前路由仍落在该一级菜单下即认定
    const clicked = lastRootId ? menuTree.find((r) => r.id === lastRootId) : undefined;
    if (clicked && rootHasExact(clicked, location.pathname)) return clicked.id;
    // 其次：由当前路由反推所属一级菜单（精确匹配优先，前缀匹配兜底）
    const hit = findRootByPath(menuTree, location.pathname);
    if (hit) return hit.id;
    // 无归属时（如通知中心等独立页）：保持上次的一级菜单，避免误跳到「系统设置/工作台」
    if (lastRootId && menuTree.some((r) => r.id === lastRootId)) return lastRootId;
    return menuTree[0]?.id ?? '';
  }, [menuTree, location.pathname, lastRootId]);

  /** 叶子点击：记录其所属一级菜单，供活动高亮动态判定 */
  const handleLeafNavigate = useCallback((leafId: string) => {
    const root = findRootByLeafId(menuTree, leafId);
    if (root) persistRoot(root.id);
  }, [menuTree, persistRoot]);

  /** 未读通知数：仅统计当前用户未读通知，与通知列表联动（标记已读/删除后实时刷新） */
  const loadUnread = useCallback(() => {
    if (!user) return;
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false).then(({ count }) => setUnread(count ?? 0));
  }, [user]);

  useEffect(() => {
    loadUnread();
    const handler = () => loadUnread();
    // 通知列表标记已读/删除后派发该事件，触发角标即时刷新
    window.addEventListener('notifications-updated', handler);
    // 切回标签页/窗口获焦时同步（处理在其他标签页操作的情况）
    window.addEventListener('focus', handler);
    document.addEventListener('visibilitychange', handler);
    return () => {
      window.removeEventListener('notifications-updated', handler);
      window.removeEventListener('focus', handler);
      document.removeEventListener('visibilitychange', handler);
    };
  }, [loadUnread]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* 桌面侧栏：二三级菜单（背景为白色，与右侧顶栏模块间不显示竖线分隔）；固定不随内容滚动 */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 bg-white overflow-y-auto">
        <SidebarContent menuTree={menuTree} activeRootId={activeRootId} onLeafNavigate={handleLeafNavigate} branding={branding} menuLoading={menuLoading} />
      </aside>

      <div className="flex flex-1 min-w-0 flex-col">
        {/* 顶栏：背景为白色，下方不显示边框线；固定于顶部不随内容滚动 */}
        <header className="flex h-14 shrink-0 items-center gap-3 bg-white px-4 md:px-6">
          {isMobile && (
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden h-9 w-9">
                  <MenuIcon className="h-5 w-5" />
                  <span className="sr-only">打开菜单</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 bg-white border-0">
                <SidebarContent menuTree={menuTree} activeRootId={activeRootId} showRootTabs branding={branding} onLeafNavigate={handleLeafNavigate} onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
          )}

          <div className="flex-1 min-w-0" />

          {/* 一级菜单（顶部右侧） */}
          <div className="hidden md:flex items-center gap-1">
            {menuTree.map((r) => {
              const Icon = getIcon(r.icon);
              const active = r.id === activeRootId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { persistRoot(r.id); navigate(firstLeafPath(r)); }}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-none px-3.5 text-sm font-medium transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {r.name}
                </button>
              );
            })}
          </div>

          <Button variant="ghost" size="icon" className="h-9 w-9 relative" asChild>
            <Link to="/notifications">
              <Bell className="h-4 w-4 text-muted-foreground" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              <span className="sr-only">通知</span>
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2 hover:bg-muted/60">
                <Avatar className="h-7 w-7">
                  {profile?.avatar_url && (
                    <AvatarImage src={profile.avatar_url} alt={profile.name || '头像'} className="object-cover" />
                  )}
                  <AvatarFallback className="bg-accent/10 text-xs font-semibold text-accent">
                    {profile?.name?.slice(0, 1) || 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline text-sm font-medium">{profile?.name || '未登录'}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{profile?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/my-profile" className="flex items-center cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  我的信息
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto bg-background">{children}</main>
      </div>

      {/* 全局加载遮罩：注册初始化等耗时操作进行中，禁止一切交互 */}
      {globalBusy && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
            <p className="text-sm font-medium text-foreground">正在初始化企业空间，请稍候…</p>
          </div>
        </div>
      )}
    </div>
  );
}
