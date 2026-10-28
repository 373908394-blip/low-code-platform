import { useMemo, useState } from 'react';
import type { ActionConfig, ActionDef, ActionPosition, ActionVariant, ActionType, MetaForm, FormField, SmTransition, PrintExportTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, ArrowUp, ArrowDown, MousePointerClick, Pencil, Lightbulb, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AiRuleMatcher } from '@/components/design/AiRuleMatcher';
import { toast } from 'sonner';

/** 动作类型目录（9 类） */
export const ACTION_TYPES: { value: ActionType; label: string; group: string }[] = [
  { value: 'CREATE', label: '新增（打开新建）', group: '内置 CRUD' },
  { value: 'VIEW', label: '查看（打开详情）', group: '内置 CRUD' },
  { value: 'EDIT', label: '编辑（打开编辑）', group: '内置 CRUD' },
  { value: 'DELETE', label: '删除（含批量）', group: '内置 CRUD' },
  { value: 'COPY', label: '复制为新草稿', group: '内置 CRUD' },
  { value: 'SELECT_RELATED', label: '选择关联（弹窗选目标记录）', group: '关联表' },
  { value: 'VIEW_RELATED', label: '查看关联列表', group: '关联表' },
  { value: 'NEW_RELATED', label: '新增关联数据', group: '关联表' },
  { value: 'UNLINK_RELATED', label: '解除关联', group: '关联表' },
  { value: 'GOTO_RELATED', label: '跳转关联详情', group: '关联表' },
  { value: 'CHANGE_STATUS', label: '状态变更（触发状态机）', group: '状态变更' },
  { value: 'SM_TRANSITION', label: '状态流转（绑定状态机转换）', group: '状态变更' },
  { value: 'START_WORKFLOW', label: '发起流程', group: '流程动作' },
  { value: 'APPROVE', label: '审批通过', group: '流程动作' },
  { value: 'REJECT', label: '审批驳回', group: '流程动作' },
  { value: 'WITHDRAW', label: '撤回申请', group: '流程动作' },
  { value: 'FILL_NODE', label: '填写节点确认（如销假）', group: '流程动作' },
  { value: 'TRANSFER_OWNER', label: '转移给他人（移交单据）', group: '人员移交' },
  { value: 'ASSIGN_OWNER', label: '分配（指派负责人）', group: '人员移交' },
  { value: 'REMARK', label: '新增备注（填写备注存日志）', group: '人员移交' },
  { value: 'NAVIGATE', label: '跳转（路由/链接）', group: '跳转动作' },
  { value: 'UPDATE_DATA', label: '数据更新（字段赋值）', group: '数据更新' },
  { value: 'EXPORT', label: '导出', group: '文件动作' },
  { value: 'IMPORT', label: '导入', group: '文件动作' },
  { value: 'PRINT', label: '打印', group: '文件动作' },
  { value: 'CALL_API', label: '调用接口（Webhook）', group: '接口动作' },
  { value: 'COMPOSITE', label: '组合动作（顺序执行）', group: '组合动作' },
];

/** 按表单模式过滤可用动作类型：流程动作组仅审批表单、状态变更组仅状态机表单可见，其余为通用动作 */
export function filterActionTypes(mode: string | undefined): typeof ACTION_TYPES {
  return ACTION_TYPES.filter((t) => {
    if (t.group === '流程动作') return mode === 'approval';
    if (t.group === '状态变更') return mode === 'state';
    return true;
  });
}

export const POSITION_LABEL: Record<ActionPosition, string> = {
  toolbar: '列表工具栏',
  row: '行操作',
  batch: '批量操作',
  'form-top': '表单顶部',
  'form-bottom': '表单底部',
  field: '字段旁',
};

/** 条件示例库：覆盖中文状态、and/or 嵌套、用户/权限/字段比较等常用写法，供用户查看与一键填入
 *  状态类示例按当前表单状态机的真实状态名称实时生成（无状态机时回退内置状态） */
function condExamples(smStates?: { key: string; label: string }[]): { title: string; json: string }[] {
  const st = (smStates ?? []).map((s) => s.label).filter(Boolean);
  const s1 = st[0] ?? '草稿';
  const s2 = st[1] ?? '审批中';
  const s3 = st[2] ?? '已驳回';
  const fill = st.find((x) => x.includes('填写') || x.includes('待处理')) ?? s2;
  return [
    { title: `状态为「${s1}」时显示`, json: `{"==":[{"var":"status"},"${s1}"]}` },
    { title: `状态为「${s1}」或「${s2}」时显示（or 多状态）`, json: `{"or":[{"==":[{"var":"status"},"${s1}"]},{"==":[{"var":"status"},"${s2}"]}]}` },
    { title: `状态为「${s1}」或「${s3}」时可编辑（or 多状态）`, json: `{"or":[{"==":[{"var":"status"},"${s1}"]},{"==":[{"var":"status"},"${s3}"]}]}` },
    { title: `管理员且状态为「${s2}」时显示（and 组合）`, json: `{"and":[{"==":[{"var":"user.role"},"admin"]},{"==":[{"var":"status"},"${s2}"]}]}` },
    { title: '仅显示当前用户创建的信息', json: '{"==":[{"var":"created_by"},{"var":"user.id"}]}' },
    { title: '仅显示我负责的（单据当前处理人：转移给我的/分配给我的）', json: '{"==":[{"var":"assignee_id"},{"var":"user.id"}]}' },
    { title: '仅显示我创建或我负责的（创建人或当前处理人，or 任一满足）', json: '{"or":[{"==":[{"var":"created_by"},{"var":"user.id"}]},{"==":[{"var":"assignee_id"},{"var":"user.id"}]}]}' },
    { title: '当前用户可审核时显示', json: '{"==":[{"var":"canApprove"},true]}' },
    { title: '当前节点指定填写人填写时才显示', json: '{"==":[{"var":"canFill"},true]}' },
    { title: `状态为「${fill}」且当前用户为填写人时显示`, json: `{"and":[{"==":[{"var":"status"},"${fill}"]},{"==":[{"var":"canFill"},true]}]}` },
    { title: '当前用户为管理员时启用', json: '{"==":[{"var":"user.role"},"admin"]}' },
    { title: '金额大于 10000 时启用', json: '{">":[{"var":"row.amount"},10000]}' },
    { title: `非「${s1}」状态时启用（取反）`, json: `{"!":{"==":[{"var":"status"},"${s1}"]}}` },
    { title: `当前用户创建且可审核时启用（and 嵌套 or）`, json: `{"and":[{"==":[{"var":"created_by"},{"var":"user.id"}]},{"or":[{"==":[{"var":"status"},"${s2}"]},{"==":[{"var":"status"},"${fill}"]}]}]}` },
  ];
}

/** 条件示例面板：默认收起，点击展开全部示例；状态示例实时取状态机状态名称 */
function ConditionExamples({ smStates }: { smStates?: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const examples = condExamples(smStates);
  const stNames = (smStates ?? []).map((s) => s.label).filter(Boolean);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
      >
        <Lightbulb className="h-3 w-3" />
        {open ? '收起示例' : '查看全部示例'}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/60 p-2">
          {examples.map((ex) => (
            <div key={ex.title} className="rounded border border-border bg-background px-2 py-1.5">
              <p className="text-[11px] font-medium">{ex.title}</p>
              <p className="mt-0.5 text-[10px] font-mono text-muted-foreground break-all">{ex.json}</p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">变量：status（状态名称，{stNames.length > 0 ? `本表单状态机状态：${stNames.join('、')}，` : ''}支持中文状态名称或英文标识，实时取状态机配置）、row.xxx（字段）、user.id/user.role（当前用户）、created_by（创建人）、canApprove（当前节点审批人）、canFill（当前节点指定填写人）、assignee_id/assigneeName（单据当前处理人 id/姓名）</p>
        </div>
      )}
    </div>
  );
}

const EMPTY_DEF = (position: ActionPosition, sort: number): ActionDef => ({
  id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  tenant_id: '', form_id: '', position, name: '', icon: 'mouse-pointer-click',
  variant: position === 'row' ? 'link' : 'secondary',
  action_type: 'VIEW', config: {},
  show_condition: null, enable_condition: null, permission_code: null,
  confirm_text: null, success_text: null,
  after_behavior: 'refresh', sort, version: 1,
  created_at: '', updated_at: '',
});

/** 操作项配置面板：增删改排序 + 动作绑定 + 条件/权限/确认/后置 */
export default function ActionPanel({
  position, actions, onChange, forms, relations, fields, formMode, smTransitions, smStates, templates = [],
}: {
  position: ActionPosition;
  actions: ActionDef[];
  onChange: (list: ActionDef[]) => void;
  forms: MetaForm[];
  relations: { id: string; name: string; target_form_id: string }[];
  fields: FormField[];
  formMode?: string;
  /** 当前表单状态机的转换规则（SM_TRANSITION 动作类型的动态选项来源） */
  smTransitions?: SmTransition[];
  /** 状态机状态列表（key→label 展示） */
  smStates?: { key: string; label: string }[];
  /** 列表页已配置的打印与导出模板 */
  templates?: PrintExportTemplate[];
}) {
  const [editing, setEditing] = useState<ActionDef | null>(null);

  const upd = (i: number, patch: Partial<ActionDef>) => onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const move = (i: number, dir: -1 | 1) => {
    const n = [...actions];
    const j = i + dir;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n.map((a, idx) => ({ ...a, sort: idx + 1 })));
  };

  return (
    <div className="space-y-2">
      {actions.map((a, i) => (
        <div key={a.id} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-2">
          <div className="flex flex-col shrink-0">
            <button type="button" className="h-4 w-4 flex items-center justify-center hover:text-primary" onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></button>
            <button type="button" className="h-4 w-4 flex items-center justify-center hover:text-primary" onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></button>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{a.name || '未命名按钮'}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {a.action_type === 'SM_TRANSITION'
                ? `状态流转 · ${smTransitions?.find((x) => x.id === a.config.transitionId)?.event ?? '未绑定转换'}`
                : (ACTION_TYPES.find((t) => t.value === a.action_type)?.label ?? a.action_type)}
              {a.permission_code ? ` · ${a.permission_code}` : ''}
              {a.confirm_text ? ' · 二次确认' : ''}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditing({ ...a })}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => onChange(actions.filter((_, idx) => idx !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      {actions.length === 0 && (
        <p className="text-xs text-muted-foreground py-3 text-center">暂无{POSITION_LABEL[position]}操作项</p>
      )}
      <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => setEditing(EMPTY_DEF(position, actions.length + 1))}>
        <Plus className="mr-1 h-3.5 w-3.5" />添加操作项
      </Button>

      <ActionEditDialog
        key={editing?.id ?? 'none'}
        def={editing}
        onClose={() => setEditing(null)}
        onSave={(d) => {
          const exists = actions.some((a) => a.id === d.id);
          onChange(exists ? actions.map((a) => (a.id === d.id ? d : a)) : [...actions, { ...d, sort: actions.length + 1 }]);
          setEditing(null);
        }}
        forms={forms}
        relations={relations}
        fields={fields}
        formMode={formMode}
        smTransitions={smTransitions}
        smStates={smStates}
        templates={templates}
      />
    </div>
  );
}

/** 动作编辑弹窗（父组件以 key={def.id} 挂载，每次打开重新初始化草稿，避免上次编辑残留） */
export function ActionEditDialog({ def, onClose, onSave, forms, relations, fields, formMode, smTransitions, smStates, templates = [] }: {
  def: ActionDef | null;
  onClose: () => void;
  onSave: (d: ActionDef) => void;
  forms: MetaForm[];
  relations: { id: string; name: string; target_form_id: string }[];
  fields: FormField[];
  formMode?: string;
  smTransitions?: SmTransition[];
  smStates?: { key: string; label: string }[];
  templates?: PrintExportTemplate[];
}) {
  const [draft, setDraft] = useState<ActionDef | null>(def);
  // 条件以本地字符串承载编辑（避免边输入边 JSON.parse 导致已填写内容无法修改）
  const [showCondText, setShowCondText] = useState<string>(def?.show_condition ? JSON.stringify(def.show_condition) : '');
  const [enableCondText, setEnableCondText] = useState<string>(def?.enable_condition ? JSON.stringify(def.enable_condition) : '');

  const groups = useMemo(() => {
    // 按表单模式过滤动作类型（普通/向导隐藏流程与状态变更组，审批含流程动作，状态机含状态变更）；未传模式保持全量
    const visible = formMode ? filterActionTypes(formMode) : [...ACTION_TYPES];
    // SM_TRANSITION 的实际选项由状态机转换动态生成（见下方 smOpts），静态条目不进入下拉
    const filtered = visible.filter((x) => x.value !== 'SM_TRANSITION');
    // 存量动作可能属于当前模式已裁剪的类型，编辑时保留原选项避免下拉显示空白
    if (draft?.action_type === 'SM_TRANSITION') {
      filtered.push(ACTION_TYPES.find((x) => x.value === 'SM_TRANSITION')!);
    } else if (draft?.action_type && !filtered.some((t) => t.value === draft.action_type)) {
      const legacy = ACTION_TYPES.find((t) => t.value === draft.action_type);
      if (legacy) filtered.push(legacy);
    }
    // 状态机转换动态注入为「状态变更」组选项：value 带 SM_TRANS: 前缀（选中时解析为 action_type + transitionId）
    const smOpts = (smTransitions ?? []).map((tr) => ({
      value: `SM_TRANS:${tr.id}`,
      label: `${tr.event}（${smStates?.find((s) => s.key === tr.from)?.label ?? tr.from} → ${smStates?.find((s) => s.key === tr.to)?.label ?? tr.to}）`,
    }));
    const m = new Map<string, { value: string; label: string }[]>();
    filtered.forEach((t) => m.set(t.group, [...(m.get(t.group) ?? []), t]));
    if (smOpts.length > 0) m.set('状态变更', [...(m.get('状态变更') ?? []), ...smOpts]);
    return [...m.entries()];
  }, [formMode, draft?.action_type, smTransitions, smStates]);

  // 构建字段上下文，供 AI 生成 JSONLogic 条件时参考（须在条件 return 之前调用 hook）
  const fieldContext = useMemo(
    () => fields.map((f) => `- ${f.label}（字段 ${f.key}，类型 ${f.type}）`).join('\n'),
    [fields],
  );

  if (!def || !draft) return null;

  const set = (patch: Partial<ActionDef>) => setDraft({ ...draft, ...patch });
  const setCfg = (patch: Partial<ActionConfig>) => setDraft({ ...draft, config: { ...draft.config, ...patch } });

  // 保存时统一解析条件文本：空或非法返回 null（留空恒显示），合法则解析为 JSONLogic
  const parseCond = (text: string): ActionDef['show_condition'] => {
    const v = text.trim();
    if (!v) return null;
    try { return JSON.parse(v); } catch { return null; }
  };

  const applyAiCondition = (key: 'show_condition' | 'enable_condition') => (text: string) => {
    try {
      const parsed = JSON.parse(text);
      set({ [key]: parsed });
      if (key === 'show_condition') setShowCondText(JSON.stringify(parsed));
      else setEnableCondText(JSON.stringify(parsed));
    } catch {
      toast.error('AI 返回的内容不是合法 JSON，请重试或手动调整');
    }
  };

  const t = draft.action_type;
  const needTargetForm = ['CREATE', 'NAVIGATE', 'SELECT_RELATED', 'VIEW_RELATED', 'NEW_RELATED', 'UNLINK_RELATED', 'GOTO_RELATED'].includes(t);
  const needRelation = ['SELECT_RELATED', 'VIEW_RELATED', 'NEW_RELATED', 'UNLINK_RELATED', 'GOTO_RELATED'].includes(t);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>配置操作项 · {POSITION_LABEL[def.position]}</DialogTitle></DialogHeader>

        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">按钮名称</Label>
              <Input className="h-9" placeholder="如：派单" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">按钮样式</Label>
              <Select value={draft.variant} onValueChange={(v) => set({ variant: v as ActionVariant })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">主按钮</SelectItem>
                  <SelectItem value="secondary">次按钮</SelectItem>
                  <SelectItem value="danger">危险按钮</SelectItem>
                  <SelectItem value="link">文字链接</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">动作类型</Label>
            <Select
              value={draft.action_type === 'SM_TRANSITION' ? (draft.config.transitionId ? `SM_TRANS:${draft.config.transitionId}` : 'SM_TRANSITION') : draft.action_type}
              onValueChange={(v) => {
                if (v.startsWith('SM_TRANS:')) set({ action_type: 'SM_TRANSITION', config: { transitionId: v.slice('SM_TRANS:'.length) } });
                else set({ action_type: v as ActionType, config: {} });
              }}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {groups.map(([g, items]) => (
                  <div key={g}>
                    <p className="px-2 py-1 text-[10px] text-muted-foreground">{g}</p>
                    {items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
                  </div>
                ))}
              </SelectContent>
            </Select>
            {(smTransitions?.length ?? 0) > 0 && (
              <p className="text-[11px] text-muted-foreground">「状态变更」组下方为状态机设计中配置的转换事件，选中即绑定该流转</p>
            )}
          </div>

          {needRelation && (
            <div className="space-y-1.5">
              <Label className="text-xs">关联关系</Label>
              <Select value={draft.config.relationId ?? 'none'} onValueChange={(v) => setCfg({ relationId: v === 'none' ? undefined : v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未选择</SelectItem>
                  {relations.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">在「应用列表 → 关联设计」中维护关联定义</p>
            </div>
          )}

          {needTargetForm && !needRelation && (
            <div className="space-y-1.5">
              <Label className="text-xs">目标表单</Label>
              <Select value={draft.config.targetFormId ?? 'none'} onValueChange={(v) => setCfg({ targetFormId: v === 'none' ? undefined : v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">当前表单</SelectItem>
                  {forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {t === 'FILL_NODE' && (
            <div className="rounded-md border border-border p-3 space-y-1.5">
              <p className="text-xs text-muted-foreground">填写节点确认（如销假）：点击后打开该单据当前待处理填写节点的填写弹窗（与流程设计中「提交节点」的填写事件对应）。</p>
              <p className="text-[11px] text-muted-foreground">仅当前节点指定填写人可见可点（引擎执行时兜底校验）；显示条件配置为 <span className="font-mono">{'{"==":[{"var":"canFill"},true]}'}</span> 即实现「当前节点指定由谁填写，按钮仅对填写人显示」，如待销假状态可再加 <span className="font-mono">status == '待销假'</span>（状态标签）</p>
            </div>
          )}

          {t === 'CHANGE_STATUS' && (
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 space-y-0">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">状态机事件</Label>
                <Input className="h-8 text-xs font-mono" placeholder="如 dispatch / complete" value={draft.config.stateMachineEvent ?? ''} onChange={(e) => setCfg({ stateMachineEvent: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">目标状态</Label>
                <Input className="h-8 text-xs font-mono" placeholder="如 dispatched" value={draft.config.targetStatus ?? ''} onChange={(e) => setCfg({ targetStatus: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">守卫提示（可选）</Label>
                <Input className="h-8 text-xs" placeholder="状态机守卫条件的说明" value={draft.success_text ?? ''} onChange={(e) => set({ success_text: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">字段映射（状态变更后写入，JSON）</Label>
                <Textarea className="min-h-16 text-xs font-mono" placeholder={'{\n  "assignee": "{{currentUser.id}}",\n  "dispatchTime": "{{now}}"\n}'} value={mappingsToString(draft.config.fieldMappings)} onChange={(e) => setCfg({ fieldMappings: parseMappings(e.target.value) })} />
              </div>
            </div>
          )}

          {t === 'SM_TRANSITION' && (
            <div className="rounded-md border border-border p-3 space-y-1.5">
              {(() => {
                const tr = smTransitions?.find((x) => x.id === draft.config.transitionId);
                const slabel = (k: string) => smStates?.find((s) => s.key === k)?.label ?? k;
                if (!tr) return <p className="text-xs text-destructive">未绑定转换：该转换可能已被删除，请重新在上方「动作类型」中选择状态机转换。</p>;
                const inter = tr.interaction;
                return (
                  <>
                    <p className="text-xs font-medium">绑定转换：{slabel(tr.from)} → {slabel(tr.to)}（事件「{tr.event}」）</p>
                    <p className="text-[11px] text-muted-foreground">
                      交互方式：{!inter || inter.type === 'none'
                        ? '无交互，点击按钮（二次确认后）直接流转'
                        : inter.type === 'assign'
                          ? `人员分配：点击后按${inter.assignBy === 'role' ? '角色' : '部门'}选择并模糊搜索多选人员，确定后写入负责人并通知、完成流转`
                          : inter.type === 'submit'
                            ? `内容提交：点击后填写 ${inter.fields?.length ?? 0} 个所选字段，提交后更新单据并流转`
                            : `内容确定：点击后只读查看 ${inter.fields?.length ?? 0} 个所选字段，确认后流转`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">转换规则与交互方式在「状态机设计」的转换编辑中维护，此处仅绑定引用</p>
                  </>
                );
              })()}
            </div>
          )}

          {t === 'NAVIGATE' && (
            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">目标类型</Label>
                  <Select value={draft.config.targetType ?? 'form-list'} onValueChange={(v) => setCfg({ targetType: v as ActionConfig['targetType'] })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="form-list">表单列表页</SelectItem>
                      <SelectItem value="form-detail">表单详情</SelectItem>
                      <SelectItem value="form-create">表单新建页</SelectItem>
                      <SelectItem value="url">外部链接</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">打开方式</Label>
                  <Select value={draft.config.openMode ?? 'current'} onValueChange={(v) => setCfg({ openMode: v as ActionConfig['openMode'] })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">当前窗口</SelectItem>
                      <SelectItem value="new-window">新窗口</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {draft.config.targetType === 'url' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">链接地址</Label>
                  <Input className="h-8 text-xs font-mono" placeholder="https://…" value={draft.config.url ?? ''} onChange={(e) => setCfg({ url: e.target.value })} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">目标表单</Label>
                  <Select value={draft.config.targetFormId ?? 'none'} onValueChange={(v) => setCfg({ targetFormId: v === 'none' ? undefined : v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未选择</SelectItem>
                      {forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {draft.config.targetType === 'form-detail' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">参数映射（JSON，值支持 {'{{row.x}}'}）</Label>
                  <Textarea className="min-h-14 text-xs font-mono" placeholder={'{ "id": "{{row.customerId}}" }'} value={mappingsToString(draft.config.paramMapping)} onChange={(e) => setCfg({ paramMapping: parseMappings(e.target.value) })} />
                </div>
              )}
            </div>
          )}

          {t === 'UPDATE_DATA' && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <Label className="text-xs">更新字段（JSON，值支持 {'{{now}}'} / {'{{currentUser.id}}'}）</Label>
              <Textarea className="min-h-16 text-xs font-mono" placeholder={'{ "archivedAt": "{{now}}" }'} value={mappingsToString(draft.config.updates)} onChange={(e) => setCfg({ updates: parseMappings(e.target.value) })} />
            </div>
          )}

          {t === 'CALL_API' && (
            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">请求方法</Label>
                  <Select value={draft.config.method ?? 'POST'} onValueChange={(v) => setCfg({ method: v as ActionConfig['method'] })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{['GET', 'POST', 'PUT', 'DELETE'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">接口地址</Label>
                  <Input className="h-8 text-xs font-mono" placeholder="https://api.example.com/hook" value={draft.config.url ?? ''} onChange={(e) => setCfg({ url: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Body 映射（JSON，值支持变量）</Label>
                <Textarea className="min-h-14 text-xs font-mono" placeholder={'{ "orderId": "{{row.id}}" }'} value={mappingsToString(draft.config.bodyMapping)} onChange={(e) => setCfg({ bodyMapping: parseMappings(e.target.value) })} />
              </div>
              <p className="text-[11px] text-muted-foreground">经服务端代理转发，内网/localhost 地址将被拒绝</p>
            </div>
          )}

          {t === 'COMPOSITE' && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <Label className="text-xs">失败策略</Label>
              <Select value={draft.config.onFailure ?? 'abort'} onValueChange={(v) => setCfg({ onFailure: v as 'abort' | 'continue' })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="abort">中断后续动作</SelectItem><SelectItem value="continue">继续执行</SelectItem></SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">子动作在保存后通过「编辑子步骤」继续配置（当前版本支持顺序执行）</p>
            </div>
          )}

          {(t === 'PRINT' || t === 'EXPORT') && (
            <div className="space-y-2 rounded-md border border-border p-3 bg-muted/20">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  绑定模版（{t === 'PRINT' ? '打印模版' : 'Excel 导出模版'}）
                </Label>
                <Select
                  value={draft.config.templateId || 'default'}
                  onValueChange={(v) => setCfg({ templateId: v === 'default' ? undefined : v })}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue placeholder="选择打印与导出模板" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">默认系统表格（根据列表显示字段）</SelectItem>
                    {templates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.title})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-[11px] text-muted-foreground leading-relaxed">
                {t === 'PRINT' ? (
                  <>
                    <p>• 点击触发浏览器标准打印，自动根据所选模板渲染排版并呼出打印机设置。</p>
                    <p>• 可选用「报销单模板」、「借款单模板」、「物流单模板」或自定义格式。</p>
                  </>
                ) : (
                  <>
                    <p>• 点击直接将设计好的模板导出为 Excel (.xlsx) 文件，无需手工排版。</p>
                    <p>• 调用 Edge Function 服务端生成，支持字段映射对应与留白占位。</p>
                  </>
                )}
                {templates.length === 0 && (
                  <p className="text-amber-600 mt-1">
                    提示：当前表单尚未在「打印与导出设计」面板中创建模板，若需特定单据版式请先在上方进行设计。
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5 rounded-md border border-border divide-y divide-border">
            <label className="flex items-center justify-between px-3 min-h-10 text-sm gap-3">
              <span className="shrink-0">二次确认</span>
              <Input className="h-8 w-56 text-xs" placeholder="确认文案，如：确认派单？" value={draft.confirm_text ?? ''} onChange={(e) => set({ confirm_text: e.target.value || null })} disabled={!draft.confirm_text && draft.position !== 'batch'} />
              <Switch checked={!!draft.confirm_text} onCheckedChange={(v) => set({ confirm_text: v ? '确认执行该操作？' : null })} />
            </label>
            <div className="px-3 py-2.5 flex items-center gap-3">
              <Label className="text-xs shrink-0">权限码</Label>
              <Input className="h-8 flex-1 text-xs font-mono" placeholder="如 purchase:dispatch（留空则不校验）" value={draft.permission_code ?? ''} onChange={(e) => set({ permission_code: e.target.value || null })} />
            </div>
            <div className="px-3 py-2.5 flex items-center gap-3">
              <Label className="text-xs shrink-0">成功提示</Label>
              <Input className="h-8 flex-1 text-xs" placeholder="执行成功后的提示文案" value={draft.success_text ?? ''} onChange={(e) => set({ success_text: e.target.value || null })} />
            </div>
            <div className="px-3 py-2.5 flex items-center gap-3">
              <Label className="text-xs shrink-0">后置行为</Label>
              <Select value={draft.after_behavior} onValueChange={(v) => set({ after_behavior: v as ActionDef['after_behavior'] })}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="refresh">刷新列表</SelectItem>
                  <SelectItem value="close">关闭弹窗并刷新</SelectItem>
                  <SelectItem value="back">关闭弹窗</SelectItem>
                  <SelectItem value="none">无</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5 rounded-md border border-border p-3">
              <Label className="text-xs">显示条件（JSONLogic，基于当前行与用户；留空恒显示）</Label>
            <p className="text-[11px] text-muted-foreground">
              {(smStates ?? []).length > 0
                ? `status 实时取本表单状态机状态：${smStates!.map((s) => s.label).join('、')}（中文名或英文标识均可），支持 and/or 嵌套多条件`
                : 'status 取值可用中文标签（草稿/审批中/已通过/已驳回/已完成）或英文（draft/pending/approved/rejected/completed），支持 and/or 嵌套多条件'}
              ；canApprove=当前用户是待处理审批节点审批人时显示，canFill=当前节点指定由当前用户填写时才显示
            </p>
            <ConditionExamples smStates={smStates} />
            <Textarea className="min-h-16 text-xs font-mono" placeholder={'{"==":[{"var":"status"},"审批中"]}'}
              value={showCondText}
              onChange={(e) => { setShowCondText(e.target.value); }}
            />
            <AiRuleMatcher
              context={`当前表单字段：\n${fieldContext}\n可用变量：status（状态名称，${(smStates ?? []).length > 0 ? `本表单状态机状态实时取值：${smStates!.map((s) => s.label).join('/')}` : '支持中文标签或英文标识，取值如 草稿/审批中/已通过/已驳回/已完成'}）、row.字段key（字段值）、user.id（当前用户id）、user.role（admin/member）、created_by（创建人id）、canApprove（当前节点由当前用户审批时为true，否则false）、canFill（当前节点指定由当前用户填写时为true，否则false）、assignee_id（单据当前处理人id，转移/分配给我时等于 user.id）、assigneeName（单据当前处理人姓名）。\n请生成 JSONLogic 表达式。${(smStates ?? []).length > 0 ? `示例：状态为${smStates![0].label}时显示 {"==":[{"var":"status"},"${smStates![0].label}"]}；多状态显示 ${smStates!.slice(0, 2).map((s) => `"${s.label}"`).join(' 或 ')} {"or":[${smStates!.slice(0, 2).map((s) => `{"==":[{"var":"status"},"${s.label}"]}`).join(',')}]}` : '示例：状态为审批中时显示 {"==":[{"var":"status"},"审批中"]}；状态为审批中或销假中时显示 {"or":[{"==":[{"var":"status"},"审批中"]},{"==":[{"var":"status"},"销假中"]}]}'}；当前节点由当前用户审批时显示 {"==":[{"var":"canApprove"},true]}；仅显示当前用户创建的信息 {"==":[{"var":"created_by"},{"var":"user.id"}]}。`}
              placeholder="如：状态为审批中时显示"
              onResult={applyAiCondition('show_condition')}
            />
            <Label className="text-xs">启用条件（不满足则按钮置灰禁用）</Label>
            <Textarea className="min-h-14 text-xs font-mono" placeholder={'{">":[{"var":"row.amount"},10000]}'}
              value={enableCondText}
              onChange={(e) => { setEnableCondText(e.target.value); }}
            />
            <AiRuleMatcher
              context={`当前表单字段：\n${fieldContext}\n可用变量：status（状态名称，${(smStates ?? []).length > 0 ? `本表单状态机状态实时取值：${smStates!.map((s) => s.label).join('/')}` : '支持中文标签或英文标识，取值如 草稿/审批中/已通过/已驳回/已完成'}）、row.字段key（字段值）、user.id（当前用户id）、user.role（admin/member）、created_by（创建人id）、canApprove（当前用户是否有审核权限，true/false）、canFill（当前用户是否可填写，true/false）、assignee_id（单据当前处理人id，转移/分配给我时等于 user.id）、assigneeName（单据当前处理人姓名）。\n请生成 JSONLogic 表达式。示例：金额大于10000时启用 {">":[{"var":"row.amount"},10000]}；当前用户为管理员时启用 {"==":[{"var":"user.role"},"admin"]}；${(smStates ?? []).length > 0 ? `状态为${smStates![0].label}时启用 {"==":[{"var":"status"},"${smStates![0].label}"]}` : '仅当前用户创建的信息可操作 {"==":[{"var":"created_by"},{"var":"user.id"}]}'}。`}
              placeholder="如：金额大于10000时才启用"
              onResult={applyAiCondition('enable_condition')}
            />
            <p className="text-[11px] text-muted-foreground">变量域：status（状态名称，{(smStates ?? []).length > 0 ? `实时取本表单状态机状态：${smStates!.map((s) => s.label).join('、')}` : '支持中文标签或英文标识'}）、row.xxx（字段）、user.id（当前用户id）、user.role（admin/member）、created_by（创建人id）、canApprove/canFill（当前节点审批人/指定填写人判断）</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => onSave({ ...draft, name: draft.name.trim() || '未命名按钮', show_condition: parseCond(showCondText), enable_condition: parseCond(enableCondText) })} disabled={!draft.name.trim()}>保存操作项</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- 映射 JSON 辅助 ----
function mappingsToString(m: Record<string, string> | undefined): string {
  return m && Object.keys(m).length > 0 ? JSON.stringify(m, null, 0) : '';
}
function parseMappings(v: string): Record<string, string> | undefined {
  const s = v.trim();
  if (!s) return undefined;
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, string>;
  } catch { return undefined; }
  return undefined;
}

/** 供预览区使用：按钮样式 → CSS 类 */
export function variantClass(v: ActionVariant): string {
  switch (v) {
    case 'primary': return 'bg-primary text-primary-foreground hover:bg-primary/90 border-transparent';
    case 'danger': return 'bg-destructive text-destructive-foreground hover:bg-destructive/90 border-transparent';
    case 'link': return 'text-primary hover:underline border-transparent bg-transparent';
    default: return 'bg-background border-border hover:bg-muted';
  }
}

export { cn };
