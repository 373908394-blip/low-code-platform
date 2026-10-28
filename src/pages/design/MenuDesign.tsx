import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GuideButton } from '@/components/common/GuideButton';
import { MENU_GUIDE } from '@/lib/page-guides';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { MetaForm, MetaMenu, Role } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { LayoutGrid, Plus, Pencil, Trash2, GripVertical, Eye, EyeOff, Rocket, Loader2, Layers, Boxes } from 'lucide-react';
import { ICON_NAMES, getIcon } from '@/lib/icon-registry';
import { routes } from '@/routes';


interface MenuNode extends MetaMenu {
  children: MenuNode[];
}

function buildTree(list: MetaMenu[]): MenuNode[] {
  const map = new Map<string, MenuNode>();
  list.forEach((m) => map.set(m.id, { ...m, children: [] }));
  const roots: MenuNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) map.get(node.parent_id)!.children.push(node);
    else roots.push(node);
  });
  return roots.sort((a, b) => a.sort_order - b.sort_order);
}

export default function MenuDesign() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [loading, setLoading] = useState(true);
  const [menus, setMenus] = useState<MetaMenu[]>([]);
  const [forms, setForms] = useState<MetaForm[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [dialog, setDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [editing, setEditing] = useState<MetaMenu | null>(null);
  const [parentSel, setParentSel] = useState<'root' | string>('root');
  const [mForm, setMForm] = useState({ name: '', icon: 'boxes', sort: 10, menu_type: 'list', form_id: '', sys_path: '' });
  const [visibleRoles, setVisibleRoles] = useState<string[]>(['all']);

  const load = useCallback(async () => {
    setLoading(true);
    const [menuRes, formRes, roleRes] = await Promise.all([
      supabase.from('meta_menu').select('*').order('sort_order'),
      supabase.from('meta_forms').select('*').order('updated_at', { ascending: false }),
      supabase.from('roles').select('*').order('created_at'),
    ]);
    setMenus((menuRes.data as MetaMenu[]) ?? []);
    setForms((formRes.data as MetaForm[]) ?? []);
    setRoles((roleRes.data as Role[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tree = useMemo(() => buildTree(menus), [menus]);
  const rootMenus = menus.filter((m) => !m.parent_id);
  const groupMenus = menus.filter((m) => m.parent_id && rootMenus.some((r) => r.id === m.parent_id));
  /** 当前选中父级下的层级：root→一级、一级下→二级、二级下→三级 */
  const parentLevel = (pid: 'root' | string) => {
    if (pid === 'root') return 1;
    const p = menus.find((m) => m.id === pid);
    if (!p) return 1;
    return p.parent_id ? 3 : 2;
  };
  /** 三级可选：已发布表单 或 系统内置页面 */
  const SYS_PATHS = routes
    .filter((r) => r.visible !== false && r.public !== true && !r.path.includes(':') && r.path !== '*')
    .map((r) => ({ path: r.path, label: r.name }));

  /** 根据所选父级计算展示文案（编辑态禁用 Select 时用于显式展示真实父级） */
  const parentLabel = (pid: 'root' | string) => {
    if (pid === 'root') return '一级菜单（顶级分组）';
    const p = menus.find((m) => m.id === pid);
    if (!p) return '一级菜单（顶级分组）';
    if (!p.parent_id) return `二级 · 挂在「${p.name}」下`;
    const root = rootMenus.find((r) => r.id === p.parent_id);
    return `三级 · 挂在「${root?.name ?? ''} / ${p.name}」下`;
  };

  const openCreate = (parent?: MetaMenu) => {
    setEditing(null);
    setParentSel(parent?.id ?? 'root');
    setMForm({ name: '', icon: 'boxes', sort: menus.filter((x) => x.parent_id === (parent?.id ?? null)).length + 1, menu_type: 'list', form_id: '', sys_path: '' });
    setVisibleRoles(['all']);
    setDialog(true);
  };

  const openEdit = (m: MetaMenu) => {
    setEditing(m);
    setParentSel(m.parent_id ?? 'root');
    const isSys = !m.form_id && !!m.path;
    setMForm({ name: m.name, icon: m.icon, sort: m.sort_order, menu_type: m.menu_type, form_id: m.form_id ?? '', sys_path: isSys ? (m.path ?? '') : '' });
    setVisibleRoles(m.visible_roles?.length ? m.visible_roles : ['all']);
    setDialog(true);
  };

  const save = async () => {
    if (!mForm.name.trim()) return toast.error('请填写菜单名称');
    const level = parentLevel(parentSel);
    if (level === 3 && !mForm.form_id && !mForm.sys_path) return toast.error('三级菜单必须关联一个已发布表单或选择系统页面');
    const linkedForm = mForm.form_id ? forms.find((f) => f.id === mForm.form_id) : undefined;
    const payload = {
      tenant_id: tenantId,
      parent_id: parentSel === 'root' ? null : parentSel,
      name: mForm.name.trim(),
      icon: mForm.icon,
      sort_order: mForm.sort,
      menu_type: level === 3 && mForm.form_id ? mForm.menu_type : 'custom',
      form_id: level === 3 && mForm.form_id ? mForm.form_id : null,
      visible_roles: visibleRoles.includes('all') ? ['all'] : visibleRoles,
      // 单页类表单走 /page/:formId，其余走 /app/:formId，保证路由与菜单高亮一致
      path: level === 3 ? (mForm.form_id ? (linkedForm?.app_type === 'page' ? `/page/${mForm.form_id}` : `/app/${mForm.form_id}`) : mForm.sys_path) : null,
      status: 'published' as const,
    };
    setSaving(true);
    const { error } = editing
      ? await supabase.from('meta_menu').update(payload).eq('id', editing.id)
      : await supabase.from('meta_menu').insert(payload);
    setSaving(false);
    if (error) return toast.error('保存失败：' + error.message);
    toast.success(editing ? '菜单已更新' : '菜单已创建并发布');
    window.dispatchEvent(new CustomEvent('menu-updated'));
    setDialog(false);
    load();
  };

  const remove = async (m: MetaMenu) => {
    if (m.is_system) return toast.error('系统默认菜单不可删除');
    const hasChildren = menus.some((x) => x.parent_id === m.id);
    if (hasChildren) return toast.error('请先删除该菜单下的子菜单');
    const { error } = await supabase.from('meta_menu').delete().eq('id', m.id);
    if (error) return toast.error('删除失败：' + error.message);
    toast.success('菜单已删除');
    window.dispatchEvent(new CustomEvent('menu-updated'));
    load();
  };

  const publishAll = async () => {
    await supabase.from('meta_menu').update({ status: 'published' }).eq('tenant_id', tenantId);
    toast.success('全部菜单已发布');
    window.dispatchEvent(new CustomEvent('menu-updated'));
    load();
  };

  const renderMenu = (node: MenuNode, depth = 0) => {
    const isOpen = expanded.has(node.id) || depth === 0;
    const levelLabel = depth === 0 ? '一级' : depth === 1 ? '二级' : '三级';
    return (
      <div key={node.id} className="min-w-0">
        <div
          className={`group flex items-center gap-2 h-11 px-3 rounded-md transition-colors hover:bg-muted/60 ${depth === 0 ? 'bg-muted/40' : ''}`}
          style={{ marginLeft: depth * 20 }}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0 cursor-grab" />
          {depth === 0 ? (
            <button type="button" className="h-5 w-5 shrink-0 flex items-center justify-center" onClick={() => setExpanded((s) => { const n = new Set(s); n.has(node.id) ? n.delete(node.id) : n.add(node.id); return n; })}>
              {isOpen ? <Boxes className="h-4 w-4 text-primary" /> : <Boxes className="h-4 w-4 text-muted-foreground" />}
            </button>
          ) : (
            <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className={`text-sm truncate ${depth === 0 ? 'font-medium' : 'text-muted-foreground'}`}>{node.name}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">{levelLabel}</Badge>
          {node.form_id && forms.find((f) => f.id === node.form_id) && (
            <Badge variant="outline" className="text-[10px] shrink-0 text-primary border-primary/40">{forms.find((f) => f.id === node.form_id)?.name}</Badge>
          )}
          {node.path && !node.form_id && (
            <Badge variant="outline" className="text-[10px] shrink-0">系统页面</Badge>
          )}
          {node.is_system && (
            <Badge variant="outline" className="text-[10px] shrink-0 text-primary border-primary/40">系统默认</Badge>
          )}
          <span className="flex-1" />
          <Badge variant="outline" className="text-[10px] shrink-0 hidden sm:inline-flex">{node.menu_type === 'list' ? '列表页' : node.menu_type === 'form' ? '表单页' : node.menu_type === 'dashboard' ? '仪表盘' : '分组'}</Badge>
          {node.status === 'published' ? (
            <Badge className="bg-primary/10 text-primary hover:bg-primary/10 shrink-0 text-[10px]">已发布</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] shrink-0">草稿</Badge>
          )}
          <span className="sig-row-actions inline-flex gap-1.5 shrink-0">
            {depth < 2 && (
              <button type="button" className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors" onClick={() => openCreate(node)}>加子菜单</button>
            )}
            <button type="button" className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors" onClick={() => openEdit(node)}>编辑</button>
            {!node.is_system && (
              <button type="button" className="h-7 px-2.5 rounded border border-border text-xs text-destructive hover:bg-destructive/10 transition-colors" onClick={() => remove(node)}>删除</button>
            )}
          </span>
        </div>
        {node.children
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((c) => renderMenu(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">菜单管理</h1>
          <p className="text-sm text-muted-foreground mt-1">统一三级菜单：一级分组 → 二级分类 → 三级页面（关联已发布应用或系统页面）</p>
        </div>
        <div className="flex gap-2.5">
          <GuideButton label="菜单管理" guide={MENU_GUIDE} />
          <Button variant="outline" onClick={publishAll}><Rocket className="mr-1.5 h-4 w-4" />全部发布</Button>
          <Button onClick={() => openCreate()}><Plus className="mr-1.5 h-4 w-4" />新增菜单</Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-3 space-y-1">
        {loading && <div className="py-12 text-center text-muted-foreground text-sm"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />加载中…</div>}
        {!loading && tree.length === 0 && (
          <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <LayoutGrid className="h-8 w-8" />
            <span className="text-sm">还没有业务菜单</span>
            <Button variant="outline" size="sm" onClick={() => openCreate()}>创建第一个菜单</Button>
          </div>
        )}
        {tree.map((n) => renderMenu(n))}
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-muted/40 border border-border rounded-lg p-4 text-xs text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-1.5">菜单结构说明</p>
          <p>· 三级结构：一级（顶级分组，如「我的应用」）→ 二级（业务分类，如「采购管理」）→ 三级（叶子菜单）</p>
          <p>· 三级菜单可关联一个<b>已发布表单</b>（路由 <span className="font-mono">/app/&lt;form_id&gt;</span>），也可指向系统内置页面（工作台/用户管理等）</p>
          <p>· 所有菜单名称均可修改，保存后侧栏即时生效；「可见性」控制哪些角色可见，超管始终可见</p>
        </div>
        <div className="bg-muted/40 border border-border rounded-lg p-4 text-xs text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-1.5">下一步</p>
          <p>还没有业务表单？先到 <Link to="/design/apps" className="text-primary hover:underline">应用列表</Link> 创建表单并设计字段、列表与流程，再回到这里挂载菜单。</p>
        </div>
      </div>

      {/* 菜单编辑弹窗 */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? '编辑菜单' : '新增菜单'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>层级</Label>
              {editing ? (
                <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                  {parentLabel(parentSel)}
                </div>
              ) : (
                <Select value={parentSel} onValueChange={setParentSel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">一级菜单（顶级分组）</SelectItem>
                    {rootMenus.map((r) => <SelectItem key={r.id} value={r.id}>二级 · 挂在「{r.name}」下</SelectItem>)}
                    {groupMenus.map((g) => <SelectItem key={g.id} value={g.id}>三级 · 挂在「{rootMenus.find((r) => r.id === g.parent_id)?.name} / {g.name}」下</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label>菜单名称 *</Label>
              <Input value={mForm.name} onChange={(e) => setMForm({ ...mForm, name: e.target.value })} placeholder={parentLevel(parentSel) === 1 ? '如：我的应用' : parentLevel(parentSel) === 2 ? '如：采购管理' : '如：采购申请'} />
            </div>
            {parentLevel(parentSel) === 3 && (
              <>
                <div className="space-y-2">
                  <Label>关联已发布表单</Label>
                  <Select value={mForm.form_id} onValueChange={(v) => setMForm({ ...mForm, form_id: v === 'none' ? '' : v, sys_path: '' })}>
                    <SelectTrigger><SelectValue placeholder="选择业务表单（可选）" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不关联表单（选系统页面）</SelectItem>
                      {forms.filter((f) => f.status === 'published').map((f) => <SelectItem key={f.id} value={f.id}>{f.name}（{f.code}）</SelectItem>)}
                      {forms.filter((f) => f.status === 'published').length === 0 && <SelectItem value="none" disabled>暂无已发布表单</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                {!mForm.form_id && (
                  <div className="space-y-2">
                    <Label>系统页面 *</Label>
                    <Select value={mForm.sys_path || 'none'} onValueChange={(v) => setMForm({ ...mForm, sys_path: v === 'none' ? '' : v, form_id: '' })}>
                      <SelectTrigger><SelectValue placeholder="选择系统内置页面" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">请选择</SelectItem>
                        {SYS_PATHS.map((s) => <SelectItem key={s.path} value={s.path}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {mForm.form_id && (
                  <div className="space-y-2">
                    <Label>菜单类型</Label>
                    <Select value={mForm.menu_type} onValueChange={(v) => setMForm({ ...mForm, menu_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="list">列表页面</SelectItem>
                        <SelectItem value="form">表单页面</SelectItem>
                        <SelectItem value="dashboard">仪表盘页面</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
            <div className="space-y-2">
              <Label>图标</Label>
              <div className="grid grid-cols-9 gap-1.5">
                {ICON_NAMES.map((ic) => {
                  const Ico = getIcon(ic);
                  return (
                    <button
                      key={ic}
                      type="button"
                      title={ic}
                      onClick={() => setMForm({ ...mForm, icon: ic })}
                      className={`h-8 w-8 rounded-md border flex items-center justify-center transition-colors ${mForm.icon === ic ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60'}`}
                    >
                      <Ico className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label>显示排序</Label>
              <Input type="number" className="w-32" value={mForm.sort} onChange={(e) => setMForm({ ...mForm, sort: Number(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label>可见性（哪些角色可见）</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 rounded-md border border-border p-3">
                <label className="flex min-h-8 items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={visibleRoles.includes('all')}
                    onCheckedChange={(v) => setVisibleRoles(v ? ['all'] : visibleRoles.filter((x) => x !== 'all'))}
                  />
                  全部角色
                </label>
                {roles.filter((r) => r.status === 'enabled').map((r) => (
                  <label key={r.id} className="flex min-h-8 items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={visibleRoles.includes(r.id)}
                      disabled={visibleRoles.includes('all')}
                      onCheckedChange={(v) => setVisibleRoles((s) => (v ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? '保存' : '创建并发布'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
