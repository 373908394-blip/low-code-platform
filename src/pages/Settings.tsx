import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import type { ActionLog, ApiKey, AuditLog, SysSettings, AnnualLeaveRule, AiModelConfig } from '@/types';
import { fmtDate } from '@/lib/field-catalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataPagination } from '@/components/ui/data-pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { uploadImage, type UploadStage } from '@/lib/image-upload';
import { applyTheme } from '@/lib/theme';
import {
  Loader2, Save, Upload, Palette, Bell, DatabaseBackup, ScrollText, KeyRound,
  Plus, Trash2, Copy, MousePointerClick, Bot, Sparkles, CheckCircle2, AlertCircle, Eye, EyeOff, Radio
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProviderPreset {
  provider: AiModelConfig['provider'];
  name: string;
  tag: string;
  desc: string;
  defaultBaseUrl: string;
  defaultModel: string;
  recommendedModels: string[];
}

const AI_PROVIDERS: ProviderPreset[] = [
  {
    provider: 'qwen',
    name: '通义千问 (Qwen)',
    tag: '阿里云百炼',
    desc: '阿里千问大模型，完全兼容 OpenAI 协议，适合表单规则理解与结构化匹配',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    recommendedModels: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-flash'],
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek (深度求索)',
    tag: 'DeepSeek',
    desc: '超高性价比逻辑推理与代码生成模型，标准 OpenAI 兼容接口',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    recommendedModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    provider: 'zhipu',
    name: '智谱 GLM (清言)',
    tag: '智谱 AI',
    desc: '智谱新一代多模态与认知大模型，中文语义理解及工具适配优秀',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    recommendedModels: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
  },
  {
    provider: 'minimax',
    name: 'MiniMax (稀宇科技)',
    tag: 'MiniMax',
    desc: '自研 MoE 架构通用大模型，支持精准上下文及 JSON 结构化输出',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-Text-01',
    recommendedModels: ['MiniMax-Text-01', 'abab6.5s-chat'],
  },
  {
    provider: 'moonshot',
    name: '月之暗面 (Kimi)',
    tag: 'Moonshot AI',
    desc: '长上下文窗口大模型，精准解析多字段上下文与规则',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    recommendedModels: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  {
    provider: 'baichuan',
    name: '百川智能 (Baichuan)',
    tag: '百川智能',
    desc: '百川医疗及政企级知识大模型，支持结构化知识推理',
    defaultBaseUrl: 'https://api.baichuan-ai.com/v1',
    defaultModel: 'Baichuan4',
    recommendedModels: ['Baichuan4', 'Baichuan3-Turbo'],
  },
  {
    provider: 'doubao',
    name: '火山引擎豆包 (Doubao)',
    tag: '字节跳动',
    desc: '字节自研大模型，超低延迟高并发，适合敏捷业务交互',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-pro-32k',
    recommendedModels: ['doubao-pro-32k', 'doubao-lite-32k'],
  },
  {
    provider: 'custom',
    name: '自定义服务 (OpenAI 协议)',
    tag: '私有化 / 中转',
    desc: '支持各类私有部署模型（如 vLLM/Ollama）或第三方 OpenAI 兼容网关',
    defaultBaseUrl: 'https://api.example.com/v1',
    defaultModel: 'gpt-3.5-turbo',
    recommendedModels: ['gpt-3.5-turbo', 'qwen-custom'],
  },
];

const THEMES = [
  { key: '#165DFF', name: '天蓝' },
  { key: '#4A58D4', name: '云际靛蓝' },
  { key: '#293F73', name: '藏青' },
  { key: '#0F766E', name: '松石绿' },
  { key: '#7C3AED', name: '紫藤' },
  { key: '#B91C1C', name: '绯红' },
  { key: '#334155', name: '石墨' },
];

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

/** 校验年假规则：参数合法 + 区间不重叠 */
function validateLeaveRules(rules: AnnualLeaveRule[]): string | null {
  for (const r of rules) {
    if (r.min_years < 0) return '工龄不能为负数';
    if (r.max_years <= r.min_years) return '起始工龄必须小于截止工龄';
    if (r.days < 0) return '年假天数不能为负数';
  }
  const sorted = [...rules].sort((a, b) => a.min_years - b.min_years);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min_years < sorted[i - 1].max_years) {
      return '年假规则区间存在冲突（重叠），请检查工龄范围';
    }
  }
  return null;
}

export default function Settings() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? '';
  const [loading, setLoading] = useState(true);
  const [saving, setLoadingSave] = useState(false);
  const [s, setS] = useState<SysSettings | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoStage, setLogoStage] = useState<UploadStage | null>(null);

  // 操作日志 / 动作日志 / API 密钥三张列表的客户端分页
  const [logPage, setLogPage] = useState(1);
  const [logSize, setLogSize] = useState(10);
  const [actionLogPage, setActionLogPage] = useState(1);
  const [actionLogSize, setActionLogSize] = useState(10);
  const [keyPage, setKeyPage] = useState(1);
  const [keySize, setKeySize] = useState(10);
  const logSafePage = Math.min(logPage, Math.max(1, Math.ceil(logs.length / logSize)));
  const pagedLogs = logs.slice((logSafePage - 1) * logSize, logSafePage * logSize);
  const actionLogSafePage = Math.min(actionLogPage, Math.max(1, Math.ceil(actionLogs.length / actionLogSize)));
  const pagedActionLogs = actionLogs.slice((actionLogSafePage - 1) * actionLogSize, actionLogSafePage * actionLogSize);
  const keySafePage = Math.min(keyPage, Math.max(1, Math.ceil(keys.length / keySize)));
  const pagedKeys = keys.slice((keySafePage - 1) * keySize, keySafePage * keySize);

  // AI 模型配置相关状态
  const [testingAi, setTestingAi] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const STAGE_TEXT: Record<UploadStage, string> = { checking: '检查中…', compressing: '压缩中…', uploading: '上传中…' };

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !s) return;
    setLogoUploading(true);
    setLogoStage('checking');
    try {
      const { url, compressed, sizeKb } = await uploadImage(file, 'logos', setLogoStage);
      setS({ ...s, logo_url: url });
      toast.success(
        compressed
          ? `Logo 已上传（自动压缩至 ${sizeKb}KB），记得保存设置`
          : `Logo 已上传（${sizeKb}KB），记得保存设置`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLogoUploading(false);
      setLogoStage(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, logRes, keyRes, actLogRes] = await Promise.all([
      supabase.from('sys_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('api_keys').select('*').order('created_at', { ascending: false }),
      supabase.from('meta_action_logs').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    setS((sRes.data as SysSettings) ?? null);
    setLogs((logRes.data as AuditLog[]) ?? []);
    setKeys((keyRes.data as ApiKey[]) ?? []);
    setActionLogs((actLogRes.data as ActionLog[]) ?? []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) load();
  }, [tenantId, load]);

  const save = async () => {
    if (!s) return;
    const ruleErr = validateLeaveRules(s.annual_leave_rules ?? []);
    if (ruleErr) return toast.error(ruleErr);
    setLoadingSave(true);
    const { error } = await supabase.from('sys_settings').update({
      system_name: s.system_name,
      logo_url: s.logo_url,
      login_bg_url: s.login_bg_url,
      login_welcome: s.login_welcome,
      theme_color: s.theme_color,
      notify_config: s.notify_config,
      backup_config: s.backup_config,
      annual_leave_rules: s.annual_leave_rules,
      annual_leave_expire: s.annual_leave_expire,
      ai_model_config: s.ai_model_config ?? {
        enabled: true,
        provider: 'qwen',
        api_key: '',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus',
      },
    }).eq('tenant_id', tenantId);
    setLoadingSave(false);
    if (error) return toast.error('保存失败：' + error.message);
    applyTheme(s.theme_color);
    document.title = s.system_name;
    toast.success('设置已保存');
    load();
  };

  const testAiConnection = async () => {
    const cfg = s?.ai_model_config;
    if (!cfg?.api_key?.trim()) {
      return toast.error('请先填写 API Key');
    }
    if (!cfg?.base_url?.trim()) {
      return toast.error('请填写接口地址 (Base URL)');
    }
    if (!cfg?.model?.trim()) {
      return toast.error('请填写或选择模型名称');
    }
    setTestingAi(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('ai-rule-match', {
        body: {
          action: 'test',
          config: cfg,
          tenant_id: tenantId,
        },
      });
      if (error) {
        let detail = error.message;
        try {
          const errText = await error.context?.text?.();
          if (errText) {
            try {
              const parsed = JSON.parse(errText);
              if (parsed.error) detail = parsed.error;
            } catch {
              detail = errText;
            }
          }
        } catch {}
        setTestResult({ success: false, message: detail || '测试失败' });
        toast.error('连通性测试失败：' + detail);
        return;
      }
      if (data?.error) {
        setTestResult({ success: false, message: data.error });
        toast.error('连通性测试失败：' + data.error);
      } else {
        setTestResult({ success: true, message: `连接成功！响应：${data?.reply || 'pong'}` });
        toast.success('模型连接成功！');
      }
    } catch (err) {
      const msg = (err as Error).message || '连接失败';
      setTestResult({ success: false, message: msg });
      toast.error('测试异常：' + msg);
    } finally {
      setTestingAi(false);
    }
  };

  const handleSelectAiProvider = (providerKey: AiModelConfig['provider']) => {
    if (!s) return;
    const preset = AI_PROVIDERS.find((p) => p.provider === providerKey);
    if (!preset) return;
    const currentCfg = s.ai_model_config ?? {
      enabled: true,
      provider: 'qwen',
      api_key: '',
      base_url: '',
      model: '',
    };
    setS({
      ...s,
      ai_model_config: {
        ...currentCfg,
        provider: preset.provider,
        provider_name: preset.name,
        base_url: preset.defaultBaseUrl,
        model: preset.defaultModel,
      },
    });
    setTestResult(null);
  };

  const addRule = () => {
    if (!s) return;
    const rules = s.annual_leave_rules ?? [];
    setS({ ...s, annual_leave_rules: [...rules, { min_years: 0, max_years: 1, days: 0 }] });
  };

  const updateRule = (idx: number, field: keyof AnnualLeaveRule, value: number) => {
    if (!s) return;
    const rules = [...(s.annual_leave_rules ?? [])];
    rules[idx] = { ...rules[idx], [field]: value };
    setS({ ...s, annual_leave_rules: rules });
  };

  const removeRule = (idx: number) => {
    if (!s) return;
    const rules = (s.annual_leave_rules ?? []).filter((_, i) => i !== idx);
    setS({ ...s, annual_leave_rules: rules });
  };

  const createKey = async () => {
    if (!newKeyName.trim()) return toast.error('请填写密钥名称');
    const raw = 'ys_' + Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const { error } = await supabase.from('api_keys').insert({
      tenant_id: tenantId,
      name: newKeyName.trim(),
      key_preview: raw.slice(0, 8) + '…' + raw.slice(-4),
      key_hash: btoa(raw),
    });
    if (error) return toast.error('创建失败：' + error.message);
    toast.success('API 密钥已创建', { description: '完整密钥仅本次展示：' + raw, duration: 15000 });
    setNewKeyName('');
    load();
  };

  if (loading || !s) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">系统设置</h1>
          <p className="text-sm text-muted-foreground mt-1">品牌、通知、备份、审计与开放 API</p>
        </div>
      </div>

      <Tabs defaultValue="brand" className="space-y-6">
        <TabsList className="flex w-full max-w-2xl overflow-x-auto whitespace-nowrap">
          <TabsTrigger value="brand" className="text-xs">品牌与外观</TabsTrigger>
          <TabsTrigger value="ai" className="text-xs flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" />模型配置</TabsTrigger>
          <TabsTrigger value="notify" className="text-xs">消息通知</TabsTrigger>
          <TabsTrigger value="backup" className="text-xs">数据备份</TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">操作日志</TabsTrigger>
          <TabsTrigger value="actions" className="text-xs">动作日志</TabsTrigger>
          <TabsTrigger value="api" className="text-xs">开放 API</TabsTrigger>
          <TabsTrigger value="leave" className="text-xs">年假规则</TabsTrigger>
        </TabsList>

        {/* 品牌与外观 */}
        <TabsContent value="brand" className="space-y-6">
          <div className="bg-card border border-border rounded-lg p-5 space-y-5">
            <div className="space-y-2">
              <Label>系统名称</Label>
              <Input className="max-w-md" value={s.system_name} onChange={(e) => setS({ ...s, system_name: e.target.value })} />
              <p className="text-xs text-muted-foreground">显示在侧栏顶部与浏览器标签页</p>
            </div>
            <div className="space-y-2">
              <Label>登录页欢迎语</Label>
              <Input className="max-w-md" value={s.login_welcome} onChange={(e) => setS({ ...s, login_welcome: e.target.value })} placeholder="如：欢迎回来" />
            </div>
            <div className="space-y-2">
              <Label>系统 Logo</Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
                  {s.logo_url ? (
                    <img src={s.logo_url} alt="Logo 预览" className="h-full w-full object-contain" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <label>
                      <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" className="hidden" onChange={uploadLogo} disabled={logoUploading} />
                      <span className={`inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3.5 text-sm font-medium transition-colors cursor-pointer hover:bg-muted ${logoUploading ? 'pointer-events-none opacity-60' : ''}`}>
                        {logoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {logoStage ? STAGE_TEXT[logoStage] : '上传 Logo'}
                      </span>
                    </label>
                    {s.logo_url && (
                      <Button variant="outline" onClick={() => setS({ ...s, logo_url: null })}>移除</Button>
                    )}
                  </div>
                  <Input placeholder="或直接粘贴图片 URL（https://…）" className="max-w-md" value={s.logo_url ?? ''} onChange={(e) => setS({ ...s, logo_url: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">支持 JPEG / PNG / GIF / WEBP / AVIF，超过 1MB 自动压缩为 WEBP；左上角即时生效（保存后）</p>
            </div>
            <div className="space-y-2">
              <Label>登录页背景图地址</Label>
              <Input className="max-w-md" placeholder="https://…（登录背景 URL）" value={s.login_bg_url ?? ''} onChange={(e) => setS({ ...s, login_bg_url: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>主题色</Label>
              <div className="flex flex-wrap gap-2.5">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => { setS({ ...s, theme_color: t.key }); applyTheme(t.key); }}
                    className={`flex items-center gap-2 rounded-none px-3 h-9 text-sm transition-colors ${s.theme_color === t.key ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/60'}`}
                  >
                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: t.key }} />
                    {t.name}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Palette className="h-3 w-3" />当前主题：{THEMES.find((t) => t.key === s.theme_color)?.name ?? s.theme_color}，保存后立即全局生效</p>
            </div>
            <div className="flex justify-end border-t border-border pt-4">
              <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Save className="mr-1.5 h-4 w-4" />保存设置</Button>
            </div>
          </div>
        </TabsContent>

        {/* 消息通知 */}
        <TabsContent value="notify">
          <div className="bg-card border border-border rounded-lg p-5 space-y-1">
            {[
              { key: 'sms' as const, label: '短信通知', desc: '审批待办、流程结束通过短信推送' },
              { key: 'email' as const, label: '邮件通知', desc: '审批结果与公告通过邮件推送' },
              { key: 'inapp' as const, label: '站内信', desc: '站内通知中心实时提醒（默认开启）' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between py-3.5 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5"><Bell className="h-3.5 w-3.5 text-muted-foreground" />{item.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
                <Switch
                  checked={s.notify_config?.[item.key] ?? false}
                  onCheckedChange={(v) => setS({ ...s, notify_config: { ...s.notify_config, [item.key]: v } })}
                />
              </div>
            ))}
            <div className="flex justify-end pt-4">
              <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存配置</Button>
            </div>
          </div>
        </TabsContent>

        {/* 数据备份 */}
        <TabsContent value="backup">
          <div className="bg-card border border-border rounded-lg p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5"><DatabaseBackup className="h-4 w-4 text-muted-foreground" />自动备份策略</p>
                <p className="text-xs text-muted-foreground mt-0.5">按策略将元数据与业务数据快照至备份空间</p>
              </div>
              <Switch checked={s.backup_config?.auto ?? false} onCheckedChange={(v) => setS({ ...s, backup_config: { ...s.backup_config, auto: v } })} />
            </div>
            {s.backup_config?.auto && (
              <div className="space-y-2 max-w-xs">
                <Label>备份频率</Label>
                <div className="flex gap-2">
                  {(['daily', 'weekly', 'monthly'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setS({ ...s, backup_config: { ...s.backup_config, frequency: f } })}
                      className={`h-9 px-4 rounded-md border text-sm transition-colors ${s.backup_config.frequency === f ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border hover:bg-muted/60'}`}
                    >
                      {f === 'daily' ? '每日' : f === 'weekly' ? '每周' : '每月'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium">手动备份</p>
                <p className="text-xs text-muted-foreground mt-0.5">立即创建当前时刻的完整备份快照</p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
                  supabase.from('audit_logs').insert({ tenant_id: tenantId, user_id: profile?.id, user_name: profile?.name, action: '手动备份', target: `备份快照 ${ts}`, detail: { manual: true } });
                  toast.success('备份任务已创建', { description: `快照时间：${ts}` });
                  load();
                }}
              >
                立即备份
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存策略</Button>
            </div>
          </div>
        </TabsContent>

        {/* 操作日志 */}
        <TabsContent value="logs">
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">时间</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">操作人</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">操作</th>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">对象</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-muted/50">
                    <td className="px-5 py-2.5 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(l.created_at, true)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{l.user_name || '系统'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><span className="sig-status" data-status="running">{l.action}</span></td>
                    <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap">{l.target || '—'}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-12 text-center text-muted-foreground flex items-center justify-center gap-2"><ScrollText className="h-4 w-4" />暂无操作日志</td></tr>
                )}
              </tbody>
            </table>
            <DataPagination total={logs.length} page={logSafePage} pageSize={logSize} onPageChange={setLogPage} onPageSizeChange={(s) => { setLogSize(s); setLogPage(1); }} />
          </div>
        </TabsContent>

        {/* 动作日志（动作引擎执行记录） */}
        <TabsContent value="actions">
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">时间</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">操作人</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">操作项</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">类型</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">结果</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">耗时</th>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">错误信息</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedActionLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-muted/50">
                    <td className="px-5 py-2.5 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(l.created_at, true)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{l.user_name || '系统'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{l.action_name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><span className="sig-status" data-status="draft">{l.action_type}</span></td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={cn('sig-status', l.error ? 'text-destructive' : 'text-primary')} data-status={l.error ? 'failed' : 'passed'}>{l.error ? '失败' : '成功'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground sig-num whitespace-nowrap">{l.duration_ms != null ? `${l.duration_ms}ms` : '—'}</td>
                    <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap max-w-48 truncate" title={l.error ?? ''}>{l.error ?? '—'}</td>
                  </tr>
                ))}
                {actionLogs.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground flex items-center justify-center gap-2"><MousePointerClick className="h-4 w-4" />暂无动作执行日志</td></tr>
                )}
              </tbody>
            </table>
            <DataPagination total={actionLogs.length} page={actionLogSafePage} pageSize={actionLogSize} onPageChange={setActionLogPage} onPageSizeChange={(s) => { setActionLogSize(s); setActionLogPage(1); }} />
          </div>
        </TabsContent>

        {/* 开放 API */}
        <TabsContent value="api" className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5">
            <p className="text-sm font-medium flex items-center gap-1.5 mb-1"><KeyRound className="h-4 w-4 text-muted-foreground" />API 密钥</p>
            <p className="text-xs text-muted-foreground mb-4">用于外部系统调用开放接口（读写业务数据、查询元数据）</p>
            <div className="flex flex-col md:flex-row gap-2.5 max-w-lg">
              <Input placeholder="密钥名称，如：ERP 集成" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
              <Button onClick={createKey} className="shrink-0"><Plus className="mr-1.5 h-4 w-4" />生成密钥</Button>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">名称</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">密钥预览</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">最近使用</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">创建时间</th>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedKeys.map((k) => (
                  <tr key={k.id} className="hover:bg-muted/50">
                    <td className="px-5 py-2.5 whitespace-nowrap font-medium">{k.name}</td>
                    <td className="px-4 py-2.5 sig-num text-muted-foreground whitespace-nowrap">{k.key_preview}</td>
                    <td className="px-4 py-2.5 text-muted-foreground sig-num whitespace-nowrap">{k.last_used_at ? fmtDate(k.last_used_at, true) : '从未使用'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground sig-num whitespace-nowrap">{fmtDate(k.created_at)}</td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <span className="sig-row-actions inline-flex gap-1.5">
                        <button type="button" className="h-7 px-2.5 rounded border border-border text-xs hover:bg-muted transition-colors inline-flex items-center gap-1" onClick={() => { navigator.clipboard?.writeText(k.key_preview); toast.success('已复制预览（完整密钥仅创建时可见）'); }}>
                          <Copy className="h-3 w-3" />复制
                        </button>
                        <button type="button" className="h-7 px-2.5 rounded border border-border text-xs text-destructive hover:bg-destructive/10 transition-colors inline-flex items-center gap-1" onClick={async () => { await supabase.from('api_keys').delete().eq('id', k.id); toast.success('密钥已删除'); load(); }}>
                          <Trash2 className="h-3 w-3" />删除
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
                {keys.length === 0 && <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">暂无 API 密钥</td></tr>}
              </tbody>
            </table>
            <DataPagination total={keys.length} page={keySafePage} pageSize={keySize} onPageChange={setKeyPage} onPageSizeChange={(s) => { setKeySize(s); setKeyPage(1); }} />
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-4 text-xs text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1.5">接口文档（示例）</p>
            <p className="font-mono break-words">POST /api/v1/biz-data?form=purchase — 创建业务数据（Header: Authorization: Bearer &lt;API_KEY&gt;）</p>
            <p className="font-mono break-words mt-1">GET /api/v1/meta/forms — 查询表单元数据</p>
          </div>
        </TabsContent>

        {/* 年假规则 */}
        <TabsContent value="leave" className="space-y-6">
          <div className="bg-card border border-border rounded-lg p-5 space-y-5">
            <div className="space-y-2">
              <Label>年假规则阶梯</Label>
              <p className="text-xs text-muted-foreground">按「工作满 X 年、不满 Y 年」对应年假天数配置，多条规则的工龄区间须互不重叠。</p>
            </div>
            <div className="space-y-3">
              {(s.annual_leave_rules ?? []).map((r, idx) => (
                <div key={idx} className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted/30 p-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">工作满（年）</Label>
                    <Input type="number" min={0} className="w-28 h-9" value={r.min_years}
                      onChange={(e) => updateRule(idx, 'min_years', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">不满（年）</Label>
                    <Input type="number" min={0} className="w-28 h-9" value={r.max_years}
                      onChange={(e) => updateRule(idx, 'max_years', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">年假天数</Label>
                    <Input type="number" min={0} className="w-28 h-9" value={r.days}
                      onChange={(e) => updateRule(idx, 'days', Number(e.target.value))} />
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => removeRule(idx)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {(s.annual_leave_rules ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">暂无年假规则，点击下方按钮添加。</p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={addRule}><Plus className="mr-1.5 h-4 w-4" />添加规则</Button>
          </div>

          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="space-y-2">
              <Label>年假过期时间</Label>
              <p className="text-xs text-muted-foreground">上一年度剩余年假须在该日期前使用完毕，逾期自动失效。</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">月</Label>
                <Select value={(s.annual_leave_expire ?? '03-31').slice(0, 2)} onValueChange={(v) => setS({ ...s, annual_leave_expire: `${v}-${(s.annual_leave_expire ?? '03-31').slice(3, 5)}` })}>
                  <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => <SelectItem key={m} value={m}>{Number(m)}月</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">日</Label>
                <Select value={(s.annual_leave_expire ?? '03-31').slice(3, 5)} onValueChange={(v) => setS({ ...s, annual_leave_expire: `${(s.annual_leave_expire ?? '03-31').slice(0, 2)}-${v}` })}>
                  <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => <SelectItem key={d} value={d}>{Number(d)}日</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Save className="mr-1.5 h-4 w-4" />保存规则</Button>
          </div>
        </TabsContent>

        {/* AI 模型配置 */}
        <TabsContent value="ai" className="space-y-6">
          {/* 状态与说明 */}
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    全局 AI 模型配置
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    多模型接入
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  系统内所有业务模块的 AI 规则匹配、智能条件生成统一使用此处配置的国内大语言模型。支持 OpenAI-compatible 标准接口。
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Label htmlFor="ai-enabled" className="text-xs text-muted-foreground">启用 AI 能力</Label>
                <Switch
                  id="ai-enabled"
                  checked={s.ai_model_config?.enabled ?? true}
                  onCheckedChange={(val) =>
                    setS({
                      ...s,
                      ai_model_config: {
                        ...(s.ai_model_config ?? {
                          provider: 'qwen',
                          api_key: '',
                          base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                          model: 'qwen-plus',
                        }),
                        enabled: val,
                      },
                    })
                  }
                />
              </div>
            </div>
          </div>

          {/* 国内主流服务商预设切换 */}
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div>
              <Label className="text-sm font-medium">选择模型服务商</Label>
              <p className="text-xs text-muted-foreground mt-1">
                点击切换服务商可自动带出官方兼容 Base URL 和常用推荐模型，也可自由修改
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {AI_PROVIDERS.map((p) => {
                const isSelected = (s.ai_model_config?.provider || 'qwen') === p.provider;
                return (
                  <button
                    key={p.provider}
                    type="button"
                    onClick={() => handleSelectAiProvider(p.provider)}
                    className={cn(
                      'text-left p-3.5 rounded-lg border transition-all relative flex flex-col justify-between gap-2',
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-muted/50 hover:border-border'
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-semibold text-foreground">{p.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{p.tag}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {p.desc}
                    </p>
                    <div className="text-[10px] text-primary font-mono truncate w-full pt-1 border-t border-border/40">
                      默认: {p.defaultModel}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 详细参数配置表单 */}
          <div className="bg-card border border-border rounded-lg p-5 space-y-5">
            <h4 className="text-sm font-semibold text-foreground">参数设置</h4>

            <div className="space-y-4 max-w-2xl">
              {/* API Key */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">API Key <span className="text-destructive">*</span></Label>
                  <span className="text-[11px] text-muted-foreground">调用大模型服务的鉴权密钥</span>
                </div>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="输入该服务商的 API Key，如 sk-..."
                    className="pr-10 text-xs font-mono"
                    value={s.ai_model_config?.api_key ?? ''}
                    onChange={(e) => {
                      setS({
                        ...s,
                        ai_model_config: {
                          ...(s.ai_model_config ?? {
                            provider: 'qwen',
                            base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                            model: 'qwen-plus',
                          }),
                          api_key: e.target.value,
                        },
                      });
                      setTestResult(null);
                    }}
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Base URL */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">接口地址 (Base URL) <span className="text-destructive">*</span></Label>
                  <span className="text-[11px] text-muted-foreground">兼容 OpenAI 的端点地址</span>
                </div>
                <Input
                  type="text"
                  placeholder="https://..."
                  className="text-xs font-mono"
                  value={s.ai_model_config?.base_url ?? ''}
                  onChange={(e) => {
                    setS({
                      ...s,
                      ai_model_config: {
                        ...(s.ai_model_config ?? {
                          provider: 'qwen',
                          api_key: '',
                          model: 'qwen-plus',
                        }),
                        base_url: e.target.value,
                      },
                    });
                    setTestResult(null);
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  如使用兼容模式，系统会自动调用该地址下的 /chat/completions 接口。
                </p>
              </div>

              {/* 模型名称 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">模型名称 (Model) <span className="text-destructive">*</span></Label>
                  <span className="text-[11px] text-muted-foreground">输入或选择推荐模型</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="text"
                    placeholder="输入模型名称，如 qwen-plus, deepseek-chat"
                    className="text-xs font-mono flex-1"
                    value={s.ai_model_config?.model ?? ''}
                    onChange={(e) => {
                      setS({
                        ...s,
                        ai_model_config: {
                          ...(s.ai_model_config ?? {
                            provider: 'qwen',
                            api_key: '',
                            base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                          }),
                          model: e.target.value,
                        },
                      });
                      setTestResult(null);
                    }}
                  />
                  {(() => {
                    const preset = AI_PROVIDERS.find((p) => p.provider === (s.ai_model_config?.provider || 'qwen'));
                    if (!preset || preset.recommendedModels.length === 0) return null;
                    return (
                      <Select
                        value={preset.recommendedModels.includes(s.ai_model_config?.model ?? '') ? s.ai_model_config?.model : undefined}
                        onValueChange={(val) => {
                          setS({
                            ...s,
                            ai_model_config: {
                              ...(s.ai_model_config ?? {
                                provider: 'qwen',
                                api_key: '',
                                base_url: preset.defaultBaseUrl,
                              }),
                              model: val,
                            },
                          });
                          setTestResult(null);
                        }}
                      >
                        <SelectTrigger className="w-full sm:w-44 text-xs">
                          <SelectValue placeholder="推荐模型快速填充" />
                        </SelectTrigger>
                        <SelectContent>
                          {preset.recommendedModels.map((m) => (
                            <SelectItem key={m} value={m} className="text-xs font-mono">
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
              </div>

              {/* Temperature */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">多样性 (Temperature)</Label>
                  <span className="text-xs font-mono text-muted-foreground">
                    {s.ai_model_config?.temperature ?? 0.2}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    className="w-24 text-xs font-mono h-8"
                    value={s.ai_model_config?.temperature ?? 0.2}
                    onChange={(e) =>
                      setS({
                        ...s,
                        ai_model_config: {
                          ...(s.ai_model_config ?? {
                            provider: 'qwen',
                            api_key: '',
                            base_url: '',
                            model: '',
                          }),
                          temperature: Number(e.target.value),
                        },
                      })
                    }
                  />
                  <span className="text-[11px] text-muted-foreground">建议 0.1 ~ 0.3，数值越低规则匹配结果越精确稳定</span>
                </div>
              </div>
            </div>

            {/* 连通性测试反馈展示 */}
            {testResult && (
              <div
                className={cn(
                  'p-3.5 rounded-lg border text-xs flex items-start gap-2.5 max-w-2xl',
                  testResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                    : 'bg-destructive/10 border-destructive/30 text-destructive'
                )}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5 flex-1 break-words">
                  <div className="font-semibold">{testResult.success ? '连通性测试通过' : '连通性测试未通过'}</div>
                  <div className="text-[11px] leading-relaxed">{testResult.message}</div>
                </div>
              </div>
            )}

            {/* 按钮操作栏 */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={testAiConnection}
                disabled={testingAi}
                className="text-xs h-9"
              >
                {testingAi ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    正在测试连接…
                  </>
                ) : (
                  <>
                    <Radio className="mr-1.5 h-3.5 w-3.5 text-primary" />
                    测试模型连通性
                  </>
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={saving}
                className="text-xs h-9"
              >
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                <Save className="mr-1.5 h-3.5 w-3.5" />
                保存模型配置
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
