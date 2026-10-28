import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { Department, Profile, Role } from '@/types';
import { fmtDate, PHONE_RE } from '@/lib/field-catalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { DataPagination } from '@/components/ui/data-pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Plus, Search, Building2, ChevronRight, ChevronDown, Pencil, KeyRound, Trash2,
  Download, Upload, Loader2, UserPlus, FolderPlus, Phone, Mail,
} from 'lucide-react';

interface EmpRow extends Profile {
  departments?: { name: string; leader_id: string | null } | null;
  user_roles?: { role_id: string; roles: Pick<Role, 'id' | 'name' | 'status'> }[];
}

interface DeptNode extends Department {
  children: DeptNode[];
}

function buildTree(list: Department[]): DeptNode[] {
  const map = new Map<string, DeptNode>();
  list.forEach((d) => map.set(d.id, { ...d, children: [] }));
  const roots: DeptNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) map.get(node.parent_id)!.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export default function Users() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [loading, setLoading] = useState(true);
  const [emps, setEmps] = useState<EmpRow[]>([]);
  const [depts, setDepts] = useState<DeptNode[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [empDialog, setEmpDialog] = useState(false);
  const [editing, setEditing] = useState<EmpRow | null>(null);
  const [empForm, setEmpForm] = useState({
    name: '', gender: '男', phone: '', email: '', position: '', department_id: '', password: '',
    education: '', id_card: '', hire_date: '',
    social_security_transfer_date: '', housing_fund_transfer_date: '',
    emergency_contact: '', emergency_contact_phone: '',
  });
  const [empRoles, setEmpRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [deptDialog, setDeptDialog] = useState(false);
  const [deptEditing, setDeptEditing] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState({ name: '', parent_id: '', leader_id: '' });

  const [resetTarget, setResetTarget] = useState<EmpRow | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EmpRow | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, deptRes, roleRes] = await Promise.all([
        supabase.from('profiles').select('*, departments!profiles_department_id_fkey(name, leader_id), user_roles(role_id, roles(id, name, status))').order('created_at'),
        supabase.from('departments').select('*').order('sort_order'),
        supabase.from('roles').select('*').order('created_at'),
      ]);
      if (empRes.error) toast.error('加载员工失败：' + empRes.error.message);
      if (deptRes.error) toast.error('加载部门失败：' + deptRes.error.message);
      if (roleRes.error) toast.error('加载角色失败：' + roleRes.error.message);
      setEmps((empRes.data as EmpRow[]) ?? []);
      const deptList = (deptRes.data as Department[]) ?? [];
      setDepts(buildTree(deptList));
      setRoles((roleRes.data as Role[]) ?? []);
    } catch (e) {
      toast.error('加载失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const deptName = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (nodes: DeptNode[]) => nodes.forEach((n) => { m.set(n.id, n.name); walk(n.children); });
    walk(depts);
    return m;
  }, [depts]);

  const filtered = emps.filter((e) => {
    if (selectedDept && e.department_id !== selectedDept) return false;
    if (!search) return true;
    const kw = search.toLowerCase();
    return e.name.toLowerCase().includes(kw) || (e.phone ?? '').includes(kw) || (e.email ?? '').toLowerCase().includes(kw);
  });

  // 客户端分页；筛选或切换部门后回到第一页
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [search, selectedDept]);

  // ===== 员工 CRUD =====
  const openCreate = () => {
    setEditing(null);
    setEmpForm({
      name: '', gender: '男', phone: '', email: '', position: '', department_id: selectedDept || '', password: '',
      education: '', id_card: '', hire_date: '',
      social_security_transfer_date: '', housing_fund_transfer_date: '',
      emergency_contact: '', emergency_contact_phone: '',
    });
    setEmpRoles([]);
    setEmpDialog(true);
  };

  const openEdit = (e: EmpRow) => {
    setEditing(e);
    setEmpForm({
      name: e.name, gender: e.gender ?? '男', phone: e.phone ?? '', email: e.email ?? '', position: e.position ?? '', department_id: e.department_id ?? '', password: '',
      education: e.education ?? '', id_card: e.id_card ?? '', hire_date: e.hire_date ?? '',
      social_security_transfer_date: e.social_security_transfer_date ?? '', housing_fund_transfer_date: e.housing_fund_transfer_date ?? '',
      emergency_contact: e.emergency_contact ?? '', emergency_contact_phone: e.emergency_contact_phone ?? '',
    });
    setEmpRoles((e.user_roles ?? []).map((ur) => ur.role_id));
    setEmpDialog(true);
  };

  const saveEmp = async () => {
    if (!empForm.name.trim()) return toast.error('请填写姓名');
    if (!editing && !empForm.email.trim()) return toast.error('请填写登录邮箱');
    if (!editing && empForm.password.length < 6) return toast.error('初始密码至少 6 位');
    if (!empForm.phone.trim()) return toast.error('请填写手机号');
    if (!PHONE_RE.test(empForm.phone.trim())) return toast.error('手机号格式不正确（应为 1 开头的 11 位数字）');
    if (!empForm.department_id) return toast.error('请选择所属部门');
    if (!empForm.position.trim()) return toast.error('请填写所属职位');
    if (!empForm.hire_date) return toast.error('请选择入职日期');
    setSaving(true);
    try {
      let userId = editing?.id;
      if (!editing) {
        // 通过 Edge Function 创建登录账号（超管校验）
        const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-user-ops', {
          body: { action: 'create-user', email: empForm.email.trim(), password: empForm.password, name: empForm.name.trim() },
        });
        if (fnError || (fnData as { error?: string })?.error) {
          toast.error((fnData as { error?: string })?.error || fnError?.message || '创建登录账号失败');
          return;
        }
        userId = (fnData as { user_id: string }).user_id;
        const { error: pErr } = await supabase.from('profiles').insert({
          id: userId,
          tenant_id: tenantId,
          name: empForm.name.trim(),
          gender: empForm.gender || '男',
          phone: empForm.phone || null,
          email: empForm.email.trim(),
          position: empForm.position || null,
          department_id: empForm.department_id || null,
          education: empForm.education || null,
          id_card: empForm.id_card || null,
          hire_date: empForm.hire_date || null,
          social_security_transfer_date: empForm.social_security_transfer_date || null,
          housing_fund_transfer_date: empForm.housing_fund_transfer_date || null,
          emergency_contact: empForm.emergency_contact || null,
          emergency_contact_phone: empForm.emergency_contact_phone || null,
        });
        if (pErr) {
          toast.error('档案写入失败：' + pErr.message);
          return;
        }
      } else {
        const { error } = await supabase.from('profiles').update({
          name: empForm.name.trim(),
          gender: empForm.gender || '男',
          phone: empForm.phone || null,
          position: empForm.position || null,
          department_id: empForm.department_id || null,
          education: empForm.education || null,
          id_card: empForm.id_card || null,
          hire_date: empForm.hire_date || null,
          social_security_transfer_date: empForm.social_security_transfer_date || null,
          housing_fund_transfer_date: empForm.housing_fund_transfer_date || null,
          emergency_contact: empForm.emergency_contact || null,
          emergency_contact_phone: empForm.emergency_contact_phone || null,
        }).eq('id', editing.id);
        if (error) return toast.error('保存失败：' + error.message);
      }

      // 角色多对多
      if (userId) {
        await supabase.from('user_roles').delete().eq('user_id', userId);
        if (empRoles.length > 0) {
          await supabase.from('user_roles').insert(empRoles.map((rid) => ({ tenant_id: tenantId, user_id: userId, role_id: rid })));
        }
      }
      toast.success(editing ? '员工信息已更新' : '员工添加成功');
      setEmpDialog(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (e: EmpRow) => {
    const next = e.status === 'active' ? 'disabled' : 'active';
    const { error } = await supabase.from('profiles').update({ status: next }).eq('id', e.id);
    if (error) return toast.error('操作失败：' + error.message);
    toast.success(next === 'active' ? '已启用' : '已禁用');
    load();
  };

  const doReset = async () => {
    if (!resetTarget || newPwd.length < 6) return toast.error('新密码至少 6 位');
    const { data, error } = await supabase.functions.invoke('admin-user-ops', {
      body: { action: 'reset-password', user_id: resetTarget.id, password: newPwd },
    });
    if (error || (data as { error?: string })?.error) {
      return toast.error((data as { error?: string })?.error || error?.message || '重置失败');
    }
    toast.success(`已重置 ${resetTarget.name} 的密码`);
    setResetTarget(null);
    setNewPwd('');
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.is_superadmin) return toast.error('超级管理员不可删除');
    const { error } = await supabase.from('profiles').delete().eq('id', deleteTarget.id);
    if (error) return toast.error('删除失败：' + error.message);
    toast.success('员工已删除');
    setDeleteTarget(null);
    load();
  };

  // ===== 部门 CRUD =====
  const saveDept = async () => {
    if (!deptForm.name.trim()) return toast.error('请填写部门名称');
    if (deptEditing) {
      const { error } = await supabase.from('departments').update({
        name: deptForm.name.trim(),
        parent_id: deptForm.parent_id || null,
        leader_id: deptForm.leader_id || null,
      }).eq('id', deptEditing.id);
      if (error) return toast.error('保存失败：' + error.message);
    } else {
      const { error } = await supabase.from('departments').insert({
        tenant_id: tenantId,
        name: deptForm.name.trim(),
        parent_id: deptForm.parent_id || (selectedDept ?? null),
      });
      if (error) return toast.error('创建失败：' + error.message);
    }
    toast.success(deptEditing ? '部门已更新' : '部门已创建');
    setDeptDialog(false);
    load();
  };

  const setLeader = async (e: EmpRow) => {
    if (!e.department_id) return toast.error('该员工未分配部门');
    const { error } = await supabase.from('departments').update({ leader_id: e.id }).eq('id', e.department_id);
    if (error) return toast.error('设置失败：' + error.message);
    toast.success(`已将 ${e.name} 设为部门主管`);
    load();
  };

  const unsetLeader = async (e: EmpRow) => {
    if (!e.department_id) return;
    const { error } = await supabase.from('departments').update({ leader_id: null }).eq('id', e.department_id);
    if (error) return toast.error('操作失败：' + error.message);
    toast.success('已取消部门主管');
    load();
  };

  const deleteDept = async (d: Department) => {
    const hasChildren = depts.some((n) => walkHas(n, d.id));
    const hasEmp = emps.some((e) => e.department_id === d.id);
    if (hasChildren || hasEmp) return toast.error('请先移除该部门下的子部门与员工');
    const { error } = await supabase.from('departments').delete().eq('id', d.id);
    if (error) return toast.error('删除失败：' + error.message);
    toast.success('部门已删除');
    if (selectedDept === d.id) setSelectedDept(null);
    load();
  };

  const walkHas = (node: DeptNode, id: string): boolean => node.children.some((c) => c.id === id || walkHas(c, id));

  // ===== 批量导入 =====
  const downloadTemplate = () => {
    const csv = '姓名,手机号,邮箱,初始密码,职位,部门\n张三,13800000001,zhangsan@demo.cn,Abc@1234,销售专员,市场部\n李四,13800000002,lisi@demo.cn,Abc@1234,行政专员,总公司';
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '员工导入模板.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async () => {
    const lines = importText.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return toast.error('请至少粘贴一行员工数据（含表头）');
    const header = lines[0].split(',').map((h) => h.trim());
    const need = ['姓名', '邮箱', '初始密码'];
    for (const k of need) if (!header.includes(k)) return toast.error(`模板缺少必填列：${k}`);

    setImporting(true);
    let ok = 0;
    const errors: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim());
      const row: Record<string, string> = {};
      header.forEach((h, idx) => (row[h] = cells[idx] ?? ''));
      if (!row['姓名'] || !row['邮箱'] || !row['初始密码']) {
        errors.push(`第 ${i + 1} 行：必填字段缺失`);
        continue;
      }
      if (row['手机号'] && !PHONE_RE.test(row['手机号'])) {
        errors.push(`第 ${i + 1} 行：手机号格式不正确`);
        continue;
      }
      const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-user-ops', {
        body: { action: 'create-user', email: row['邮箱'], password: row['初始密码'], name: row['姓名'] },
      });
      if (fnError || (fnData as { error?: string })?.error) {
        errors.push(`第 ${i + 1} 行：${(fnData as { error?: string })?.error || '创建失败'}`);
        continue;
      }
      const uid = (fnData as { user_id: string }).user_id;
      const deptNameToFind = row['部门'] || '';
      const deptId = [...deptName.entries()].find(([, n]) => n === deptNameToFind)?.[0] ?? null;
      const { error: pErr } = await supabase.from('profiles').insert({
        id: uid, tenant_id: tenantId, name: row['姓名'], phone: row['手机号'] || null,
        email: row['邮箱'], position: row['职位'] || null, department_id: deptId,
      });
      if (pErr) errors.push(`第 ${i + 1} 行：${pErr.message}`);
      else ok++;
    }
    setImporting(false);
    if (errors.length > 0) {
      toast.error(`导入完成：成功 ${ok} 条，失败 ${errors.length} 条`, { description: errors.slice(0, 3).join('；') });
    } else {
      toast.success(`成功导入 ${ok} 名员工`);
    }
    setImportOpen(false);
    setImportText('');
    load();
  };

  // ===== 部门树渲染 =====
  const renderDept = (node: DeptNode, depth = 0) => {
    const isOpen = expanded.has(node.id);
    const active = selectedDept === node.id;
    const leader = emps.find((e) => e.id === node.leader_id);
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 h-9 pr-2 rounded-md text-sm cursor-pointer transition-colors ${active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => { setSelectedDept(active ? null : node.id); if (node.children.length) setExpanded((s) => new Set(s).add(node.id)); }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              className="h-5 w-5 shrink-0 flex items-center justify-center rounded hover:bg-muted"
              onClick={(ev) => { ev.stopPropagation(); setExpanded((s) => { const n = new Set(s); n.has(node.id) ? n.delete(node.id) : n.add(node.id); return n; }); }}
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-5 shrink-0" />}
          <span className="flex-1 truncate">{node.name}{leader ? <span className="ml-1 text-xs text-primary">· {leader.name}</span> : null}</span>
          <span className="flex items-center gap-0.5">
            <button type="button" title="编辑" className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted" onClick={(ev) => { ev.stopPropagation(); setDeptEditing(node); setDeptForm({ name: node.name, parent_id: node.parent_id ?? '', leader_id: node.leader_id ?? '' }); setDeptDialog(true); }}>
              <Pencil className="h-3 w-3" />
            </button>
            <button type="button" title="删除" className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-destructive" onClick={(ev) => { ev.stopPropagation(); deleteDept(node); }}>
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        </div>
        {isOpen && node.children.map((c) => renderDept(c, depth + 1))}
      </div>
    );
  };

  const flatDepts = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (nodes: DeptNode[], depth: number) => nodes.forEach((n) => { out.push({ id: n.id, name: n.name, depth }); walk(n.children, depth + 1); });
    walk(depts, 0);
    return out;
  }, [depts]);

  return (
    <div className="flex min-h-full">
      {/* 左：组织架构 */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">组织架构</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setDeptEditing(null); setDeptForm({ name: '', parent_id: selectedDept ?? '', leader_id: '' }); setDeptDialog(true); }}>
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {depts.map((d) => renderDept(d))}
          {depts.length === 0 && <p className="px-2 py-6 text-xs text-muted-foreground text-center">暂无部门，点击右上角新建</p>}
        </div>
      </aside>

      {/* 右：员工列表 */}
      <div className="flex-1 min-w-0 p-4 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">用户管理</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {selectedDept ? `部门「${deptName.get(selectedDept)}」· ` : ''}共 {filtered.length} 名员工
            </p>
          </div>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={downloadTemplate}><Download className="mr-1.5 h-4 w-4" />模板</Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-1.5 h-4 w-4" />批量导入</Button>
            <Button onClick={openCreate}><UserPlus className="mr-1.5 h-4 w-4" />新增员工</Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg min-w-0">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="搜索姓名 / 手机号 / 邮箱" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">姓名</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">联系方式</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">部门</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">职位</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">角色</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">状态</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">加入时间</th>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && (
                  <tr><td colSpan={8} className="px-5 py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />加载中…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">暂无员工</td></tr>
                )}
                {paged.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/50">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-2.5">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${e.is_superadmin ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'}`}>{e.name.slice(0, 1)}</span>
                        <span className="font-medium">{e.name}</span>
                        {e.departments?.leader_id === e.id && <Badge className="bg-primary/10 text-primary text-[10px]">主管</Badge>}
                        {e.is_superadmin && <Badge className="bg-accent text-accent-foreground text-[10px]">超管</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-xs flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{e.phone || '—'}</span>
                        <span className="text-xs flex items-center gap-1 text-muted-foreground"><Mail className="h-3 w-3" />{e.email || '—'}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{e.departments?.name || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{e.position || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex flex-wrap gap-1">
                        {(e.user_roles ?? []).map((ur) => (
                          <Badge key={ur.role_id} variant="outline" className="text-[10px] font-normal">{ur.roles?.name}</Badge>
                        ))}
                        {(e.user_roles ?? []).length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="sig-status" data-status={e.status === 'active' ? 'passed' : 'draft'}>{e.status === 'active' ? '启用' : '禁用'}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(e.created_at)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <span className="sig-row-actions inline-flex gap-1.5">
                        <button type="button" onClick={() => openEdit(e)} className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors">编辑</button>
                        <button type="button" onClick={() => toggleStatus(e)} className="h-7 px-2.5 rounded border border-border text-xs text-muted-foreground hover:bg-muted transition-colors">{e.status === 'active' ? '禁用' : '启用'}</button>
                        <button type="button" onClick={() => { setResetTarget(e); setNewPwd(''); }} className="h-7 px-2.5 rounded border border-border text-xs text-muted-foreground hover:bg-muted transition-colors">重置密码</button>
                        {!e.is_superadmin && e.department_id && (
                          <button type="button" onClick={() => (e.departments?.leader_id === e.id ? unsetLeader(e) : setLeader(e))} className="h-7 px-2.5 rounded border border-border text-xs text-primary hover:bg-primary/10 transition-colors">
                            {e.departments?.leader_id === e.id ? '取消主管' : '设为主管'}
                          </button>
                        )}
                        {!e.is_superadmin && (
                          <button type="button" onClick={() => setDeleteTarget(e)} className="h-7 px-2.5 rounded border border-border text-xs text-destructive hover:bg-destructive/10 transition-colors">删除</button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DataPagination total={filtered.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
        </div>
      </div>

      {/* ===== 员工新增/编辑弹窗 ===== */}
      <Dialog open={empDialog} onOpenChange={setEmpDialog}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑员工' : '新增员工'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>姓名 *</Label>
              <Input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} placeholder="员工姓名" />
            </div>
            <div className="space-y-2">
              <Label>性别 *</Label>
              <Select value={empForm.gender || '男'} onValueChange={(v) => setEmpForm({ ...empForm, gender: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="男">男</SelectItem>
                  <SelectItem value="女">女</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>手机号 *</Label>
              <Input value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} placeholder="13800000000" />
            </div>
            <div className="space-y-2">
              <Label>登录邮箱 {editing ? '' : '*'}</Label>
              <Input type="email" disabled={!!editing} value={empForm.email} onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })} placeholder="name@company.com" />
            </div>
            <div className="space-y-2">
              <Label>初始密码 {editing ? '（不可改）' : '*'}</Label>
              <Input type="text" disabled={!!editing} value={empForm.password} onChange={(e) => setEmpForm({ ...empForm, password: e.target.value })} placeholder="至少 6 位" />
            </div>
            <div className="space-y-2">
              <Label>所属部门 *</Label>
              <Select value={empForm.department_id || 'none'} onValueChange={(v) => setEmpForm({ ...empForm, department_id: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="选择部门" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未分配</SelectItem>
                  {flatDepts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{'　'.repeat(d.depth)}{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>所属职位 *</Label>
              <Input value={empForm.position} onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })} placeholder="如：销售专员" />
            </div>
            <div className="space-y-2">
              <Label>入职日期 *</Label>
              <DateTimePicker mode="date" value={empForm.hire_date} onChange={(v) => setEmpForm({ ...empForm, hire_date: v })} placeholder="选择入职日期" />
            </div>
            <div className="space-y-2">
              <Label>教育程度</Label>
              <Select value={empForm.education || 'none'} onValueChange={(v) => setEmpForm({ ...empForm, education: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="选择教育程度" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未选择</SelectItem>
                  {['专科', '本科', '硕士', '博士', '博士后', '高中及以下'].map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>身份证号</Label>
              <Input value={empForm.id_card} onChange={(e) => setEmpForm({ ...empForm, id_card: e.target.value })} placeholder="选填" />
            </div>
            <div className="space-y-2">
              <Label>社保转入日期</Label>
              <DateTimePicker mode="date" value={empForm.social_security_transfer_date} onChange={(v) => setEmpForm({ ...empForm, social_security_transfer_date: v })} placeholder="选填" />
            </div>
            <div className="space-y-2">
              <Label>公积金转入日期</Label>
              <DateTimePicker mode="date" value={empForm.housing_fund_transfer_date} onChange={(v) => setEmpForm({ ...empForm, housing_fund_transfer_date: v })} placeholder="选填" />
            </div>
            <div className="space-y-2">
              <Label>紧急联络人</Label>
              <Input value={empForm.emergency_contact} onChange={(e) => setEmpForm({ ...empForm, emergency_contact: e.target.value })} placeholder="选填" />
            </div>
            <div className="space-y-2">
              <Label>联络人电话</Label>
              <Input value={empForm.emergency_contact_phone} onChange={(e) => setEmpForm({ ...empForm, emergency_contact_phone: e.target.value })} placeholder="选填" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>分配角色（可多选）</Label>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
                {roles.map((r) => (
                  <label key={r.id} className="flex min-h-10 items-center gap-2 text-sm">
                    <Checkbox
                      checked={empRoles.includes(r.id)}
                      onCheckedChange={(c) => setEmpRoles((s) => (c ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                    />
                    {r.name}
                  </label>
                ))}
                {roles.length === 0 && <p className="text-xs text-muted-foreground col-span-2">暂无角色，请先到角色管理创建</p>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmpDialog(false)}>取消</Button>
            <Button onClick={saveEmp} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? '保存' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 部门弹窗 ===== */}
      <Dialog open={deptDialog} onOpenChange={setDeptDialog}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>{deptEditing ? '编辑部门' : '新建部门'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>部门名称 *</Label>
              <Input value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} placeholder="如：市场部" />
            </div>
            <div className="space-y-2">
              <Label>上级部门</Label>
              <Select value={deptForm.parent_id || 'none'} onValueChange={(v) => setDeptForm({ ...deptForm, parent_id: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无（作为一级部门）</SelectItem>
                  {flatDepts.filter((d) => d.id !== deptEditing?.id).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{'　'.repeat(d.depth)}{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {deptEditing && (
              <div className="space-y-2">
                <Label>部门主管</Label>
                <Select value={deptForm.leader_id || 'none'} onValueChange={(v) => setDeptForm({ ...deptForm, leader_id: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="未设置" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未设置</SelectItem>
                    {emps.filter((e) => e.department_id === deptEditing.id).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">主管将作为审批流程「部门主管」审批人</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeptDialog(false)}>取消</Button>
            <Button onClick={saveDept}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 重置密码 ===== */}
      <Dialog open={!!resetTarget} onOpenChange={(v) => !v && setResetTarget(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>重置密码</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">为 <span className="font-medium text-foreground">{resetTarget?.name}</span> 设置新登录密码</p>
          <Input type="text" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="至少 6 位" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>取消</Button>
            <Button onClick={doReset}>确认重置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 删除确认 ===== */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除员工</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除员工「{deleteTarget?.name}」？其角色绑定将一并解除，该操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== 批量导入 ===== */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle>批量导入员工</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            下载 <button type="button" className="text-primary hover:underline" onClick={downloadTemplate}>导入模板</button>，按列填写后粘贴到下方。必填列：姓名、邮箱、初始密码。
          </p>
          <Textarea
            className="font-mono text-xs min-h-40"
            placeholder={'姓名,手机号,邮箱,初始密码,职位,部门\n张三,13800000001,zhangsan@demo.cn,Abc@1234,销售专员,市场部'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={doImport} disabled={importing}>{importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}开始导入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
