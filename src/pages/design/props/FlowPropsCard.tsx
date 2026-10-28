import type { Department, FlowSettings, Profile, Role } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Workflow, Tag, Clock, Bell, FileCode2, Users, User, Building2, Briefcase } from 'lucide-react';
import PrincipalSelector from '@/components/form/PrincipalSelector';

const CATEGORIES = ['人事行政', '财务报销', '业务审批', 'IT技术', '综合管理'];

const TIMEOUT_ACTIONS: { value: NonNullable<FlowSettings['timeoutAction']>; label: string }[] = [
  { value: 'remind', label: '自动催办' },
  { value: 'escalate', label: '自动升级上级' },
  { value: 'autoApprove', label: '自动通过' },
];

/** 允许发起人类型：先选类型，再选对应名单 */
const INITIATOR_TYPES: { value: 'user' | 'dept' | 'role'; label: string }[] = [
  { value: 'user', label: '按人员' },
  { value: 'dept', label: '按部门' },
  { value: 'role', label: '按角色' },
];

interface Props {
  settings: FlowSettings;
  onChange: (patch: Partial<FlowSettings>) => void;
  members: Profile[];
  departments: Department[];
  roles: Role[];
}

/** 流程属性卡片：配置流程分类、说明、发起人范围、超时处理与实例命名规则等全局规则 */
export default function FlowPropsCard({ settings, onChange, members, departments, roles }: Props) {
  const initCfg = settings.initiatorConfig ?? { type: 'user' as const, value: [] };
  const hasInitiator = initCfg.value.length > 0;
  // 切换类型时清空名单，避免类型与名单错位
  const updInitiator = (patch: Partial<typeof initCfg>) => onChange({ initiatorConfig: { ...initCfg, ...patch } });

  return (
    <div className="space-y-5 p-4">
      {/* 基础信息 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Workflow className="h-3.5 w-3.5" />基础信息
        </p>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1 text-xs">
            <Tag className="h-3 w-3" />流程分类
          </Label>
          <Select
            value={settings.category || '综合管理'}
            onValueChange={(v) => onChange({ category: v })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">流程说明</Label>
          <Textarea
            className="min-h-16 text-xs"
            placeholder="说明该审批流程的适用业务场景与审批规则"
            value={settings.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
      </section>

      {/* 权限范围 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Users className="h-3.5 w-3.5" />允许发起人
        </p>
        <div className="space-y-2">
          <Select value={INITIATOR_TYPES.some((t) => t.value === initCfg.type) ? initCfg.type : 'user'} onValueChange={(v) => updInitiator({ type: v as 'user' | 'dept' | 'role', value: [] })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INITIATOR_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{hasInitiator ? `仅所选${initCfg.type === 'user' ? '人员' : initCfg.type === 'dept' ? '部门成员' : '角色成员'}可发起该流程` : '未选择表示所有租户成员均可发起'}</p>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
            {initCfg.type === 'user' && members.map((p) => (
              <label key={p.id} className="flex min-h-9 items-center gap-2 rounded px-1.5 text-sm hover:bg-muted/50">
                <input type="checkbox" className="accent-primary" checked={initCfg.value.includes(p.id)} onChange={(e) => updInitiator({ value: e.target.checked ? [...initCfg.value, p.id] : initCfg.value.filter((x) => x !== p.id) })} />
                <User className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{p.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.position}</span>
              </label>
            ))}
            {initCfg.type === 'dept' && departments.map((d) => (
              <label key={d.id} className="flex min-h-9 items-center gap-2 rounded px-1.5 text-sm hover:bg-muted/50">
                <input type="checkbox" className="accent-primary" checked={initCfg.value.includes(d.id)} onChange={(e) => updInitiator({ value: e.target.checked ? [...initCfg.value, d.id] : initCfg.value.filter((x) => x !== d.id) })} />
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{d.name}</span>
              </label>
            ))}
            {initCfg.type === 'role' && roles.map((r) => (
              <label key={r.id} className="flex min-h-9 items-center gap-2 rounded px-1.5 text-sm hover:bg-muted/50">
                <input type="checkbox" className="accent-primary" checked={initCfg.value.includes(r.id)} onChange={(e) => updInitiator({ value: e.target.checked ? [...initCfg.value, r.id] : initCfg.value.filter((x) => x !== r.id) })} />
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{r.name}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* 超时处理 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />超时处理
        </p>

        <div className="space-y-1.5">
          <Label className="text-xs">审批时限（小时）</Label>
          <Input
            type="number"
            className="h-8 text-xs"
            placeholder="默认 48"
            value={settings.timeoutHours ?? 48}
            onChange={(e) => onChange({ timeoutHours: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">超时处理动作</Label>
          <div className="flex flex-col gap-1.5">
            {TIMEOUT_ACTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => onChange({ timeoutAction: a.value })}
                className={cn('h-8 rounded-md border px-3 text-xs transition-colors text-left', (settings.timeoutAction ?? 'remind') === a.value ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 抄送与通知规则 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Bell className="h-3.5 w-3.5" />归档抄送规则
        </p>
        <p className="text-[11px] text-muted-foreground">流程办结归档后，自动抄送给所选人员/部门/角色</p>
        <PrincipalSelector
          value={settings.archiveCc}
          onChange={(v) => onChange({ archiveCc: v })}
          members={members}
          departments={departments}
          roles={roles}
        />
      </section>

      {/* 实例命名规则 */}
      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FileCode2 className="h-3.5 w-3.5" />流程实例命名规则
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs">实例名模板</Label>
          <Input
            className="h-8 font-mono text-xs"
            placeholder="${initiator}_${title}_${date}"
            value={settings.instanceNameRule ?? ''}
            onChange={(e) => onChange({ instanceNameRule: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">支持动态变量：{'${initiator}'}、{'${title}'}、{'${date}'}</p>
        </div>
      </section>
    </div>
  );
}