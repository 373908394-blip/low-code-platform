import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { ColRule, MetaForm, MetaMenu, Role, RuleItem, RowRuleGroup } from '@/types';
import { fmtDate } from '@/lib/field-catalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DataPagination } from '@/components/ui/data-pagination';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Pencil, Trash2, Loader2, Menu as MenuIcon, MousePointerClick,
  Rows3, Columns3, ChevronRight, ChevronDown, Braces, PlusCircle, Trash,
  CheckSquare, RefreshCw, Square, ChevronsDown, ChevronsUp,
} from 'lucide-react';

const SCOPE_LABEL: Record<Role['data_scope'], string> = {
  all: '全部数据',
  dept_and_below: '本部门及下级',
  dept: '本部门',
  self: '仅本人',
  custom: '自定义',
};

/** 演示内置菜单权限树（菜单权限作用于真实路由） */
/** 系统页面静态按钮权限清单（按 path 合并进动态菜单树） */
const STATIC_PATH_BUTTONS: Record<string, string[]> = {
  '/': ['新建表单', '发起审批'],
  '/users': ['新增员工', '编辑员工', '禁用/启用', '重置密码', '删除员工', '批量导入'],
  '/roles': ['新增角色', '编辑角色', '删除角色', '分配权限'],
  '/settings': ['修改设置', '数据备份', '生成API密钥'],
  '/design/menus': ['新增菜单', '编辑菜单', '删除菜单', '发布'],
  '/design/apps': ['新建表单', '表单设计', '列表设计', '流程设计', '状态机', '发布', '版本回滚'],
  '/notifications': ['查看'],
};

export default function Roles() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>([]);
  const [menus, setMenus] = useState<MetaMenu[]>([]);
  const [forms, setForms] = useState<MetaForm[]>([]);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [tab, setTab] = useState<'base' | 'perm' | 'row' | 'col'>('base');
  const [saving, setSaving] = useState(false);
  const [expandedPerm, setExpandedPerm] = useState<Set<string>>(new Set());

  // 客户端分页
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const roleTotalPages = Math.max(1, Math.ceil(roles.length / pageSize));
  const roleSafePage = Math.min(page, roleTotalPages);
  const pagedRoles = roles.slice((roleSafePage - 1) * pageSize, roleSafePage * pageSize);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [scope, setScope] = useState<Role['data_scope']>('all');
  const [menuPerms, setMenuPerms] = useState<string[]>([]);
  const [buttonPerms, setButtonPerms] = useState<string[]>([]);
  const [formActions, setFormActions] = useState<{ name: string; permission_code: string; form_id: string }[]>([]);
  const [rowMode, setRowMode] = useState<'normal' | 'advanced'>('normal');
  const [rowRules, setRowRules] = useState<RuleItem[]>([]);
  const [rowGroup, setRowGroup] = useState<RowRuleGroup>({ logic: 'and', children: [] });
  const [colRules, setColRules] = useState<ColRule[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [roleRes, menuRes, formRes, actRes] = await Promise.all([
      supabase.from('roles').select('*').order('created_at'),
      supabase.from('meta_menu').select('*').order('sort_order'),
      supabase.from('meta_forms').select('*').order('updated_at', { ascending: false }),
      supabase.from('meta_actions').select('name, permission_code, form_id').not('permission_code', 'is', null),
    ]);
    setRoles((roleRes.data as Role[]) ?? []);
    setMenus((menuRes.data as MetaMenu[]) ?? []);
    setForms((formRes.data as MetaForm[]) ?? []);
    setFormActions((actRes.data as { name: string; permission_code: string; form_id: string }[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 动态菜单权限树（以 DB 三级菜单为主干，系统页面按钮按 path 合并静态清单）+ 动作按钮权限码
  const permTree = useMemo(() => {
    const menuPerms = menus.map((root) => {
      const groups = menus.filter((m) => m.parent_id === root.id);
      const leaves = groups.flatMap((g) =>
        menus
          .filter((m) => m.parent_id === g.id)
          .map((leaf) => {
            const acts = formActions.filter((a) => a.form_id === (leaf.form_id ?? ''));
            return {
              name: `${g.name} / ${leaf.name}`,
              path: leaf.path ?? '',
              buttons: leaf.form_id
                ? ['查看', '新增', '编辑', '删除', '导出', ...acts.map((a) => `${a.name}(${a.permission_code})`)]
                : STATIC_PATH_BUTTONS[leaf.path ?? ''] ?? ['查看'],
            };
          }),
      );
      return { name: root.name, children: leaves };
    }).filter((g) => g.children.length > 0);
    return menuPerms;
  }, [menus, formActions]);

  const openCreate = () => {
    setEditing(null);
    setName(''); setDescription(''); setEnabled(true); setScope('all');
    setMenuPerms([]); setButtonPerms([]);
    setRowMode('normal'); setRowRules([]); setRowGroup({ logic: 'and', children: [] }); setColRules([]);
    setTab('base');
    setDialog(true);
  };

  const openEdit = (r: Role) => {
    setEditing(r);
    setName(r.name); setDescription(r.description ?? ''); setEnabled(r.status === 'enabled'); setScope(r.data_scope);
    setMenuPerms(r.menu_perms ?? []); setButtonPerms(r.button_perms ?? []);
    // 行级规则：数组=普通模式，带 logic=高级模式
    if (Array.isArray(r.row_rules) && (r.row_rules as RowRuleGroup[]).length > 0 && (r.row_rules as RowRuleGroup[])[0]?.logic) {
      setRowMode('advanced'); setRowGroup((r.row_rules as RowRuleGroup[])[0]);
      setRowRules([]);
    } else {
      setRowMode('normal'); setRowRules((r.row_rules as RuleItem[]) ?? []);
      setRowGroup({ logic: 'and', children: [] });
    }
    setColRules(r.col_rules ?? []);
    setTab('base');
    setDialog(true);
  };

  const save = async () => {
    if (!name.trim()) return toast.error('请填写角色名称');
    setSaving(true);
    const payload = {
      tenant_id: tenantId,
      name: name.trim(),
      description: description || null,
      status: enabled ? 'enabled' : 'disabled',
      data_scope: scope,
      menu_perms: menuPerms,
      button_perms: buttonPerms,
      row_rules: rowMode === 'normal' ? rowRules : [rowGroup],
      col_rules: colRules,
    };
    const { error } = editing
      ? await supabase.from('roles').update(payload).eq('id', editing.id)
      : await supabase.from('roles').insert(payload);
    setSaving(false);
    if (error) return toast.error('保存失败：' + error.message);
    toast.success(editing ? '角色已更新' : '角色已创建');
    setDialog(false);
    load();
  };

  const doDelete = async (r: Role) => {
    const { count } = await supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role_id', r.id);
    if ((count ?? 0) > 0) return toast.error(`该角色已绑定 ${count} 名员工，请先解除绑定`);
    const { error } = await supabase.from('roles').delete().eq('id', r.id);
    if (error) return toast.error('删除失败：' + error.message);
    toast.success('角色已删除');
    load();
  };

  const toggleMenu = (path: string, checked: boolean) => {
    setMenuPerms((s) => (checked ? [...s, path] : s.filter((p) => p !== path)));
  };
  const toggleButton = (label: string, checked: boolean) => {
    setButtonPerms((s) => (checked ? [...s, label] : s.filter((p) => p !== label)));
  };

  // 全部菜单路径与全部按钮标签（用于全选/反选）
  const allMenuPaths = useMemo(() => permTree.flatMap((g) => g.children.map((c) => c.path)).filter(Boolean), [permTree]);
  const allButtonLabels = useMemo(() => permTree.flatMap((g) => g.children.flatMap((c) => c.buttons)), [permTree]);

  const selectAllPerm = () => {
    setMenuPerms([...allMenuPaths]);
    setButtonPerms([...allButtonLabels]);
    setExpandedPerm(new Set(permTree.map((g) => g.name)));
  };
  const invertPerm = () => {
    setMenuPerms(allMenuPaths.filter((p) => !menuPerms.includes(p)));
    setButtonPerms(allButtonLabels.filter((b) => !buttonPerms.includes(b)));
    setExpandedPerm(new Set(permTree.map((g) => g.name)));
  };
  const clearPerm = () => {
    setMenuPerms([]);
    setButtonPerms([]);
  };
  const expandAllPerm = () => setExpandedPerm(new Set(permTree.map((g) => g.name)));
  const collapseAllPerm = () => setExpandedPerm(new Set());

  // ===== 行级权限普通模式 =====
  const addRowRule = () => setRowRules((s) => [...s, { field: '', op: 'eq', value: '' }]);
  const updRowRule = (i: number, patch: Partial<RuleItem>) => setRowRules((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const delRowRule = (i: number) => setRowRules((s) => s.filter((_, idx) => idx !== i));

  // ===== 高级模式（单层嵌套编辑，双击内置 and/or 与括号组） =====
  const addGroupItem = () => setRowGroup((g) => ({ ...g, children: [...g.children, { field: '', op: 'eq', value: '' }] }));
  const addNested = () => setRowGroup((g) => ({ ...g, children: [...g.children, { logic: 'or', children: [{ field: '', op: 'eq', value: '' }] }] }));
  const updGroupChild = (ci: number, patch: Partial<RuleItem>) => setRowGroup((g) => ({ ...g, children: g.children.map((c, i) => (i === ci && 'field' in c ? { ...c, ...patch } : c)) }));
  const delGroupChild = (ci: number) => setRowGroup((g) => ({ ...g, children: g.children.filter((_, i) => i !== ci) }));
  const updGroupChild2 = (ci: number, ri: number, patch: Partial<RuleItem>) =>
    setRowGroup((g) => ({
      ...g,
      children: g.children.map((c, i) => {
        if (i !== ci || !('logic' in c)) return c;
        return { ...c, children: c.children.map((r, j) => (j === ri && 'field' in r ? { ...r, ...patch } : r)) };
      }),
    }));
  const delGroupChild2 = (ci: number, ri: number) =>
    setRowGroup((g) => ({
      ...g,
      children: g.children.map((c, i) => {
        if (i !== ci || !('logic' in c)) return c;
        return { ...c, children: c.children.filter((_, j) => j !== ri) };
      }),
    }));

  const ruleEditor = (item: RuleItem, onChange: (p: Partial<RuleItem>) => void, onDelete: () => void) => (
    <div className="flex flex-wrap items-center gap-2">
      <Input className="w-32 h-8" placeholder="字段 key" value={item.field} onChange={(e) => onChange({ field: e.target.value })} />
      <Select value={item.op} onValueChange={(v) => onChange({ op: v as RuleItem['op'] })}>
        <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="eq">等于</SelectItem>
          <SelectItem value="ne">不等于</SelectItem>
          <SelectItem value="contains">包含</SelectItem>
          <SelectItem value="gt">大于</SelectItem>
          <SelectItem value="lt">小于</SelectItem>
          <SelectItem value="in">属于</SelectItem>
        </SelectContent>
      </Select>
      <Input className="w-32 h-8 flex-1 min-w-24" placeholder="值" value={item.value} onChange={(e) => onChange({ value: e.target.value })} />
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>
  );

  // ===== 列级权限 =====
  const addColRule = () => setColRules((s) => (s.length > 0 ? s : [...s, { form_id: forms[0]?.id ?? '', hidden_fields: [] }]));
  const updColRule = (i: number, patch: Partial<ColRule>) => setColRules((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">角色管理</h1>
          <p className="text-sm text-muted-foreground mt-1">RBAC 角色与四维权限：菜单 / 按钮 / 行级 / 列级</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" />新增角色</Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-2.5 font-medium whitespace-nowrap">角色名称</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">数据范围</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">菜单权限</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">按钮权限</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">状态</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">创建时间</th>
              <th className="px-5 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />加载中…</td></tr>}
            {pagedRoles.map((r) => (
              <tr key={r.id} className="hover:bg-muted/50">
                <td className="px-5 py-3 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-accent" />
                    <span className="font-medium">{r.name}</span>
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{SCOPE_LABEL[r.data_scope]}</td>
                <td className="px-4 py-3 sig-num whitespace-nowrap">{r.menu_perms?.length ?? 0} 项</td>
                <td className="px-4 py-3 sig-num whitespace-nowrap">{r.button_perms?.length ?? 0} 项</td>
                <td className="px-4 py-3 whitespace-nowrap"><span className="sig-status" data-status={r.status === 'enabled' ? 'passed' : 'draft'}>{r.status === 'enabled' ? '启用' : '禁用'}</span></td>
                <td className="px-4 py-3 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(r.created_at)}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <span className="sig-row-actions inline-flex gap-1.5">
                    <button type="button" onClick={() => openEdit(r)} className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors">编辑</button>
                    <button type="button" onClick={() => doDelete(r)} className="h-7 px-2.5 rounded border border-border text-xs text-destructive hover:bg-destructive/10 transition-colors">删除</button>
                  </span>
                </td>
              </tr>
            ))}
            {!loading && roles.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">暂无角色</td></tr>}
          </tbody>
        </table>
        <DataPagination total={roles.length} page={roleSafePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
      </div>

      {/* ===== 角色编辑弹窗（四维权限） ===== */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑角色' : '新增角色'}</DialogTitle>
          </DialogHeader>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="base" className="text-xs">基础</TabsTrigger>
              <TabsTrigger value="perm" className="text-xs">权限设置</TabsTrigger>
              <TabsTrigger value="row" className="text-xs">行级数据</TabsTrigger>
              <TabsTrigger value="col" className="text-xs">列级字段</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'base' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>角色名称 *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：部门审批员" />
              </div>
              <div className="space-y-2">
                <Label>角色描述</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="角色的职责说明" className="min-h-16" />
              </div>
              <div className="space-y-2">
                <Label>数据范围</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as Role['data_scope'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部数据</SelectItem>
                    <SelectItem value="dept_and_below">本部门及下级</SelectItem>
                    <SelectItem value="dept">本部门</SelectItem>
                    <SelectItem value="self">仅本人</SelectItem>
                    <SelectItem value="custom">自定义（在行级数据中配置）</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">控制角色可见的业务数据行范围，多角色取并集</p>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">启用状态</p>
                  <p className="text-xs text-muted-foreground mt-0.5">禁用后绑定该角色的员工失去对应权限</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>
          )}

          {tab === 'perm' && (
            <div className="space-y-3">
              {/* 工具栏：全选 / 反选 / 清空 / 展开 / 收起 */}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={selectAllPerm}><CheckSquare className="mr-1 h-3.5 w-3.5" />全选</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={invertPerm}><RefreshCw className="mr-1 h-3.5 w-3.5" />反选</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearPerm}><Square className="mr-1 h-3.5 w-3.5" />清空</Button>
                <div className="mx-1 h-4 w-px bg-border" />
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={expandAllPerm}><ChevronsDown className="mr-1 h-3.5 w-3.5" />展开全部</Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={collapseAllPerm}><ChevronsUp className="mr-1 h-3.5 w-3.5" />收起全部</Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  菜单 <span className="text-foreground font-medium">{menuPerms.length}</span>/{allMenuPaths.length} · 按钮 <span className="text-foreground font-medium">{buttonPerms.length}</span>/{allButtonLabels.length}
                </span>
              </div>

              <div className="max-h-[28rem] overflow-y-auto space-y-2">
                {permTree.map((g) => {
                  const key = g.name;
                  const open = expandedPerm.has(key);
                  const allPaths = g.children.map((c) => c.path).filter(Boolean);
                  const allBtns = g.children.flatMap((c) => c.buttons);
                  const menuChecked = allPaths.length > 0 && allPaths.every((p) => menuPerms.includes(p));
                  const menuIndeterminate = !menuChecked && allPaths.some((p) => menuPerms.includes(p));
                  const btnChecked = allBtns.length > 0 && allBtns.every((b) => buttonPerms.includes(b));
                  const btnIndeterminate = !btnChecked && allBtns.some((b) => buttonPerms.includes(b));
                  return (
                    <div key={key} className="rounded-md border border-border">
                      <div className="flex items-center gap-2 px-3 h-10">
                        <button type="button" className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors flex-1 min-w-0" onClick={() => setExpandedPerm((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; })}>
                          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                          <MenuIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{g.name}</span>
                        </button>
                        <Checkbox
                          className="shrink-0"
                          checked={menuChecked}
                          {...(menuIndeterminate ? { 'data-state': 'indeterminate' as const } : {})}
                          onCheckedChange={(v) => allPaths.forEach((p) => toggleMenu(p, v === true))}
                        />
                        <Checkbox
                          className="shrink-0"
                          checked={btnChecked}
                          {...(btnIndeterminate ? { 'data-state': 'indeterminate' as const } : {})}
                          onCheckedChange={(v) => allBtns.forEach((b) => toggleButton(b, v === true))}
                        />
                      </div>
                      {open && (
                        <div className="border-t border-border">
                          {g.children.map((c) => {
                            const btns = c.buttons;
                            const btnAllChecked = btns.length > 0 && btns.every((b) => buttonPerms.includes(b));
                            const btnSomeChecked = btns.some((b) => buttonPerms.includes(b));
                            return (
                              <div key={c.path + c.name} className="px-3 py-2.5 border-b border-border last:border-b-0">
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={menuPerms.includes(c.path)}
                                    onCheckedChange={(v) => toggleMenu(c.path, v === true)}
                                  />
                                  <span className="text-sm flex-1 min-w-0 truncate">{c.name}</span>
                                  {c.path && <span className="text-xs text-muted-foreground font-mono shrink-0">{c.path}</span>}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground" />
                                    <Checkbox
                                      checked={btnAllChecked}
                                      {...(!btnAllChecked && btnSomeChecked ? { 'data-state': 'indeterminate' as const } : {})}
                                      onCheckedChange={(v) => btns.forEach((b) => toggleButton(b, v === true))}
                                    />
                                  </div>
                                </div>
                                <div className="mt-1.5 pl-6 flex flex-wrap gap-x-4 gap-y-1">
                                  {btns.map((b) => (
                                    <label key={b} className="flex min-h-7 items-center gap-1.5 text-xs text-muted-foreground">
                                      <Checkbox checked={buttonPerms.includes(b)} onCheckedChange={(v) => toggleButton(b, v === true)} />
                                      {b}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <MenuIcon className="h-3.5 w-3.5" />菜单权限控制侧栏可见性；按钮权限控制页面操作按钮；超管始终拥有全部权限
              </p>
            </div>
          )}

          {tab === 'row' && (
            <div className="space-y-4">
              <Tabs value={rowMode} onValueChange={(v) => setRowMode(v as 'normal' | 'advanced')}>
                <TabsList>
                  <TabsTrigger value="normal" className="text-xs">普通模式（AND）</TabsTrigger>
                  <TabsTrigger value="advanced" className="text-xs">高级模式（OR/括号）</TabsTrigger>
                </TabsList>
              </Tabs>

              {rowMode === 'normal' ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">多条件之间以 AND 连接，全部满足才可见</p>
                  {rowRules.map((r, i) => (
                    <div key={i}>{ruleEditor(r, (p) => updRowRule(i, p), () => delRowRule(i))}</div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addRowRule}><PlusCircle className="mr-1.5 h-3.5 w-3.5" />添加条件</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">组逻辑</span>
                    <Select value={rowGroup.logic} onValueChange={(v) => setRowGroup((g) => ({ ...g, logic: v as 'and' | 'or' }))}>
                      <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="and">AND</SelectItem><SelectItem value="or">OR</SelectItem></SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={addNested}><Braces className="mr-1.5 h-3.5 w-3.5" />加括号组</Button>
                  </div>
                  {rowGroup.children.map((c, ci) => (
                    'field' in c ? (
                      <div key={ci} className="pl-4">{ruleEditor(c, (p) => updGroupChild(ci, p), () => delGroupChild(ci))}</div>
                    ) : (
                      <div key={ci} className="pl-4 border-l-2 border-primary/40 ml-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium text-primary">( {c.logic.toUpperCase()} 组</span>
                          <button type="button" className="text-xs text-destructive hover:underline" onClick={() => delGroupChild(ci)}>删除组 )</button>
                        </div>
                        {c.children.map((r, ri) => 'field' in r ? ruleEditor(r, (p) => updGroupChild2(ci, ri, p), () => delGroupChild2(ci, ri)) : null)}
                      </div>
                    )
                  ))}
                  <Button variant="outline" size="sm" onClick={addGroupItem}><PlusCircle className="mr-1.5 h-3.5 w-3.5" />添加条件</Button>
                </div>
              )}
            </div>
          )}

          {tab === 'col' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">按表单配置字段隐藏，被隐藏字段在列表与详情中对本角色不可见</p>
              {colRules.map((rule, i) => {
                const form = forms.find((f) => f.id === rule.form_id);
                const fields = form?.schema_json?.fields ?? [];
                return (
                  <div key={i} className="rounded-md border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Select value={rule.form_id} onValueChange={(v) => updColRule(i, { form_id: v, hidden_fields: [] })}>
                        <SelectTrigger className="w-48 h-8"><SelectValue placeholder="选择表单" /></SelectTrigger>
                        <SelectContent>{forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setColRules((s) => s.filter((_, idx) => idx !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {fields.filter((f) => !['group-title', 'grid', 'divider', 'description'].includes(f.type)).map((f) => (
                        <label key={f.id} className="flex min-h-8 items-center gap-1.5 text-xs">
                          <Checkbox
                            checked={rule.hidden_fields.includes(f.key)}
                            onCheckedChange={(v) => updColRule(i, {
                              hidden_fields: v ? [...rule.hidden_fields, f.key] : rule.hidden_fields.filter((k) => k !== f.key),
                            })}
                          />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={addColRule}><PlusCircle className="mr-1.5 h-3.5 w-3.5" />添加表单字段规则</Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存角色</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
