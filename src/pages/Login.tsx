import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Boxes, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const { signIn, signUp, globalBusy } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ company: '', name: '', email: '', password: '' });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await signIn(form.email, form.password);
        if (error) {
          toast.error(error);
          return;
        }
        toast.success('登录成功');
        navigate((location.state as { from?: string })?.from || '/', { replace: true });
      } else {
        if (!form.company.trim()) return toast.error('请填写企业名称');
        if (!form.name.trim()) return toast.error('请填写管理员姓名');
        const { error } = await signUp(form.company.trim(), form.name.trim(), form.email, form.password);
        if (error) {
          toast.error(error);
          return;
        }
        toast.success('注册成功，已为你创建企业空间');
        navigate('/', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* 左侧品牌区 */}
      <div className="relative hidden md:flex md:w-[42%] flex-col justify-between overflow-hidden bg-accent p-10 text-accent-foreground">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
            <Boxes className="h-4 w-4" />
          </div>
          <span className="text-base font-bold tracking-tight">Low-code platform</span>
        </div>
        <div className="max-w-md space-y-5">
          <h1 className="text-3xl font-black leading-tight">
            拖拽搭建<br />属于你的管理系统
          </h1>
          <p className="text-sm leading-relaxed text-accent-foreground/70">
            表单引擎 · 流程引擎 · 权限引擎，三大能力开箱即用。
            注册即开通独立企业空间，无需编码，10 分钟上线一个业务应用。
          </p>
          <div className="grid grid-cols-3 gap-4 pt-2">
            {[
              { num: '37+', label: '字段组件' },
              { num: '7', label: '流程节点' },
              { num: '4', label: '权限维度' },
            ].map((s) => (
              <div key={s.label} className="border-l border-accent-foreground/20 pl-3">
                <p className="sig-num text-2xl font-black">{s.num}</p>
                <p className="mt-1 text-xs text-accent-foreground/60">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-accent-foreground/40">© 2026 面向中小企业的低代码平台</p>
      </div>

      {/* 右侧表单区 */}
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
                <Boxes className="h-4 w-4" />
              </div>
              <span className="text-base font-bold">Low-code platform</span>
            </div>
          </div>

          <h2 className="text-2xl font-bold">{mode === 'login' ? '登录' : '注册企业空间'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === 'login' ? '使用企业账号进入你的管理系统' : '注册即成为超级管理员，自动初始化企业空间'}
          </p>

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'register')} className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">登录</TabsTrigger>
              <TabsTrigger value="register">注册</TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="company">企业名称</Label>
                  <Input id="company" placeholder="如：杭州星河科技有限公司" value={form.company} onChange={set('company')} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">管理员姓名</Label>
                  <Input id="name" placeholder="你的姓名" value={form.name} onChange={set('name')} required />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" placeholder="name@company.com" value={form.email} onChange={set('email')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input id="password" type="password" placeholder="至少 6 位" minLength={6} value={form.password} onChange={set('password')} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'login' ? '登 录' : '创建企业空间'}
            </Button>
          </form>

          {mode === 'login' && (
            <div className="mt-6 rounded-md border border-border bg-muted/40 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">演示账号</p>
              <p className="mt-1 text-xs sig-num">demo@yunshu.cn / Demo@2026（超级管理员）</p>
              <p className="text-xs sig-num">liuyun@yunshu.cn / Demo@2026（部门审批员）</p>
            </div>
          )}

          <p className="mt-8 text-center text-xs text-muted-foreground">
            {mode === 'login' ? (
              <>还没有企业空间？<Link to="/login" onClick={() => setMode('register')} className="text-primary hover:underline">立即注册</Link></>
            ) : (
              <>已有账号？<Link to="/login" onClick={() => setMode('login')} className="text-primary hover:underline">返回登录</Link></>
            )}
          </p>
        </div>
      </div>

      {/* 全局加载遮罩：注册初始化进行中，禁止一切交互 */}
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
