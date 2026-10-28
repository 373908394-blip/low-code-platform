import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/db/supabase';
import type { User } from '@supabase/supabase-js';
import type { Profile, DataRange } from '@/types';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** 当前用户聚合权限码集合（来自所拥有角色的 menu_perms + button_perms），超管为 null 表示全权 */
  permissions: Set<string> | null;
  isSuperadmin: boolean;
  /** 当前账号的数据权限范围（取所拥有角色中最宽松的一项），超管为 'all' */
  dataScope: DataRange;
  /** 注册/初始化等全局耗时操作进行中：此时应禁止一切交互并展示加载遮罩 */
  globalBusy: boolean;
  beginGlobalBusy: () => void;
  endGlobalBusy: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (company: string, name: string, email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** 校验当前用户是否拥有某权限码（超管始终通过） */
  hasPermission: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** 将角色 data_scope 映射为组件数据范围 */
function mapRoleScope(scope: string | undefined): DataRange {
  switch (scope) {
    case 'self': return 'mine';
    case 'dept': return 'dept';
    case 'dept_and_below': return 'dept_sub';
    default: return 'all'; // all / custom / 未知 → 全部
  }
}

/** 多角色取最宽松的数据范围（范围越大约宽松） */
function broadestScope(scopes: DataRange[]): DataRange {
  const order: DataRange[] = ['mine', 'dept', 'dept_sub', 'all'];
  let best: DataRange = 'mine';
  for (const s of scopes) {
    if (order.indexOf(s) > order.indexOf(best)) best = s;
  }
  return best;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<Set<string> | null>(null);
  const [dataScope, setDataScope] = useState<DataRange>('all');
  const [loading, setLoading] = useState(true);
  /** 全局耗时操作（注册初始化等）进行中，用于展示遮罩并禁止交互 */
  const [globalBusy, setGlobalBusy] = useState(false);
  const beginGlobalBusy = () => setGlobalBusy(true);
  const endGlobalBusy = () => setGlobalBusy(false);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) console.error('获取用户信息失败:', error);
    const p = data as Profile | null;
    setProfile(p);
    // 超管拥有全部权限，无需加载角色权限码
    if (p?.is_superadmin) {
      setPermissions(null);
      setDataScope('all');
      return;
    }
    // 加载用户所属角色的菜单/按钮权限码并聚合去重，同时取最宽松的数据权限范围
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('roles!inner(menu_perms, button_perms, data_scope)')
      .eq('user_id', userId);
    const codes = new Set<string>();
    const scopes: DataRange[] = [];
    ((roleData as unknown as { roles: { menu_perms?: string[]; button_perms?: string[]; data_scope?: string } }[] | null) ?? []).forEach((x) => {
      const r = x.roles;
      (r?.menu_perms ?? []).forEach((c) => codes.add(c));
      (r?.button_perms ?? []).forEach((c) => codes.add(c));
      scopes.push(mapRoleScope(r?.data_scope));
    });
    setPermissions(codes);
    setDataScope(broadestScope(scopes));
  };

  const refreshProfile = async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    await fetchProfile(user.id);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: '邮箱或密码错误' };
    return { error: null };
  };

  const signUp = async (company: string, name: string, email: string, password: string) => {
    beginGlobalBusy();
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) {
        if (error.message.includes('already registered')) return { error: '该邮箱已被注册' };
        return { error: error.message };
      }
      if (!data.user) return { error: '注册失败，请重试' };
      // 调用 SECURITY DEFINER RPC 初始化租户
      const { error: rpcError } = await supabase.rpc('signup_tenant', {
        p_company: company,
        p_name: name,
        p_phone: '',
      });
      if (rpcError) {
        console.error('租户初始化失败:', rpcError);
        return { error: rpcError.message };
      }
      // 注册成功：拉取超级管理员资料并刷新菜单，保证跳转后菜单立即可见（无需手动刷新）
      await fetchProfile(data.user.id);
      window.dispatchEvent(new Event('menu-updated'));
      return { error: null };
    } finally {
      endGlobalBusy();
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isSuperadmin = !!profile?.is_superadmin;
  const hasPermission = (code: string) => {
    if (!code) return true;
    if (isSuperadmin) return true;
    return !!permissions && permissions.has(code);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, permissions, isSuperadmin, dataScope, globalBusy, beginGlobalBusy, endGlobalBusy, hasPermission, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
