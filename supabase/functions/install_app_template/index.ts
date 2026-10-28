// 应用市场：安装/卸载业务应用组件
// 入参：{ component_id: string, action?: 'install' | 'uninstall' }
// 安装逻辑：从蓝本租户（demo 演示企业）按 ID 清单实时深拷贝表单/状态机/审批流/动作/菜单到当前租户；
//          跨表单引用（optionSource.formId）自动重映射；按人指定的审批人降级为部门主管；
//          审批类表单自动挂载工作台待办双菜单；同名表单跨组件复用（避免重复创建）。
// 卸载逻辑：仅删除组件菜单树与待办菜单，表单与业务数据全部保留。仅超管可用。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** 蓝本租户（沐沐演示科技，demo@yunshu.cn） */
const BLUEPRINT_TENANT = '00000000-0000-0000-0000-000000000001';

/** 蓝本表单 ID 清单 */
const F = {
  // CRM 客户管理
  crmDashboard: '2c46e23a-0fc6-492c-acfe-6c868ab4f834', // 仪表盘（页面）
  crmCustomer: 'befda400-2eb0-4d77-85ea-810652486469', // 客户管理
  crmLead: 'da21aad8-240c-420c-9895-79d7880a443e', // 销售线索
  crmOpportunity: 'a5039f9b-e102-45d6-9687-9a8bbbd1b97e', // 销售机会
  crmContract: '7c8cfb4a-9ac0-4d6c-a56c-c5a9c7c36efe', // 合同管理
  crmProduct: '2c81806d-1d6b-4837-9366-4ace3877e27d', // 产品管理
  crmSaleDetail: '29ca51cd-30a4-4d4f-aa07-0ca4a99f972c', // 销售产品明细
  // 协同办公
  attendance: '71229a1d-1ffa-4c25-b7fd-f1ea953f579d', // 假勤管理
  leavePage: '6ec0c864-82d4-4918-bd71-67c3c8fda3fc', // 我的年假（页面）
  weekly: '709464fa-f6ab-461c-a7f9-bac7f9b827f5', // 周报管理
  weekSummary: '3aaf449c-bc9e-497e-a485-4d2d6cb3c26f', // 本周总结（周报子表）
  weekPlan: '010b8b3a-7799-424e-b69e-ce989645d02f', // 下周计划（周报子表）
  travel: '604a7de9-22b6-4016-8b1e-36503c9480a3', // 出差管理
  loan: '5c23e706-f7ab-431b-bbc6-74f692201dd9', // 借款管理
  payment: 'fda6aed7-4082-49f7-bf2b-a82280f9bf1e', // 打款记录（借款联动）
  repay: 'af5e9f58-dfa6-431d-8a69-35736f3ed613', // 还款记录（借款联动）
  expense: 'b17e89de-5031-49e3-9be3-9285adeedaa3', // 报销管理
  expenseDetail: 'abf970f3-01be-45e9-8122-98ec855ae738', // 报销明细单（报销子表）
  project: 'f7326acd-2709-4f94-9199-3893c0ff0215', // 项目管理（借款/出差的引用闭包）
} as const;

type FormKey = keyof typeof F;

interface MenuLeaf { name: string; icon: string; formKey: FormKey; page?: boolean }
interface MenuGroup { name: string; icon: string; children: MenuLeaf[] }
interface ComponentDef { id: string; name: string; icon: string; forms: string[]; menu: MenuGroup[] }

/** 内置组件定义（forms 为蓝本表单闭包，含被引用的依赖表单；menu 为菜单结构） */
const COMPONENTS: ComponentDef[] = [
  {
    id: 'crm_customer',
    name: 'CRM客户管理',
    icon: 'building-2',
    forms: [
      F.crmDashboard, F.crmCustomer, F.crmLead, F.crmOpportunity,
      F.crmContract, F.crmProduct, F.crmSaleDetail,
    ],
    menu: [
      { name: '客户管理', icon: 'boxes', children: [
        { name: '仪表盘', icon: 'layout-dashboard', formKey: 'crmDashboard', page: true },
        { name: '客户管理', icon: 'boxes', formKey: 'crmCustomer' },
        { name: '销售线索', icon: 'boxes', formKey: 'crmLead' },
        { name: '销售机会', icon: 'boxes', formKey: 'crmOpportunity' },
        { name: '合同管理', icon: 'boxes', formKey: 'crmContract' },
        { name: '产品管理', icon: 'boxes', formKey: 'crmProduct' },
        { name: '销售产品明细', icon: 'boxes', formKey: 'crmSaleDetail' },
      ] },
    ],
  },
  {
    id: 'cooperative_oa',
    name: '协同办公',
    icon: 'briefcase',
    forms: [
      F.attendance, F.leavePage, F.weekly, F.weekSummary, F.weekPlan,
      F.travel, F.loan, F.payment, F.repay, F.expense, F.expenseDetail,
      F.project, // 借款/出差表单引用的依赖闭包
    ],
    menu: [
      { name: '假期管理', icon: 'boxes', children: [
        { name: '我的假期', icon: 'boxes', formKey: 'attendance' },
        { name: '我的年假', icon: 'boxes', formKey: 'leavePage', page: true },
      ] },
      { name: '周报管理', icon: 'boxes', children: [
        { name: '我的周报', icon: 'boxes', formKey: 'weekly' },
      ] },
      { name: '费用管理', icon: 'boxes', children: [
        { name: '我的报销', icon: 'boxes', formKey: 'expense' },
        { name: '我的借款', icon: 'boxes', formKey: 'loan' },
      ] },
      { name: '考勤管理', icon: 'boxes', children: [] },
      { name: '出差管理', icon: 'calendar-days', children: [
        { name: '出差管理', icon: 'boxes', formKey: 'travel' },
      ] },
    ],
  },
];

type Sb = ReturnType<typeof createClient>;

/** 将菜单 path 追加到租户所有角色的 menu_perms（菜单可见性按角色权限码过滤，不追加则非超管看不到新菜单） */
async function appendRolePerms(service: Sb, tenantId: string, paths: string[]) {
  if (paths.length === 0) return;
  const { data: tenantRoles } = await service.from('roles')
    .select('id, menu_perms').eq('tenant_id', tenantId);
  for (const r of tenantRoles ?? []) {
    const cur = Array.isArray(r.menu_perms) ? (r.menu_perms as string[]) : [];
    const merged = Array.from(new Set([...cur, ...paths]));
    if (merged.length !== cur.length) {
      await service.from('roles').update({ menu_perms: merged }).eq('id', r.id);
    }
  }
}

/** 深度遍历替换元数据中的跨表单引用，覆盖三种形态：
 *  1. key 为 formId/targetFormId 的字符串值（schema_json 的 relation.formId 等）
 *  2. key 为 targetFormIds 的数组值（状态机 newRelated.targetFormIds）
 *  3. key 为 backfillFields/displayFieldsMap 的对象 key（key 即蓝本表单 ID） */
function remapFormRefs(node: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(node)) return node.map((n) => remapFormRefs(n, idMap));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((k === 'formId' || k === 'targetFormId') && typeof v === 'string' && idMap.has(v)) out[k] = idMap.get(v);
      else if (k === 'targetFormIds' && Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' && idMap.has(x) ? idMap.get(x) : x));
      else if ((k === 'backfillFields' || k === 'displayFieldsMap') && v && typeof v === 'object' && !Array.isArray(v)) {
        const remapped: Record<string, unknown> = {};
        for (const [bk, bv] of Object.entries(v as Record<string, unknown>)) {
          const nk = idMap.has(bk) ? idMap.get(bk)! : bk;
          remapped[nk] = remapFormRefs(bv, idMap);
        }
        out[k] = remapped;
      }
      else out[k] = remapFormRefs(v, idMap);
    }
    return out;
  }
  return node;
}

/** 递归降级按人指定的审批节点（demo 用户在新租户不存在 → 改为部门主管审批） */
function demoteUserApprovers(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(demoteUserApprovers);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (obj['approver_type'] === 'user' && Array.isArray(obj['approver_value']) && (obj['approver_value'] as unknown[]).length > 0) {
      out['approver_type'] = 'dept_leader';
      out['approver_value'] = [];
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k in out) continue;
      out[k] = demoteUserApprovers(v);
    }
    return out;
  }
  return node;
}

/** 安装组件：蓝本深拷贝 */
async function install(service: Sb, tenantId: string, comp: ComponentDef) {
  // 0. 重复安装拦截（按一级菜单名）
  const { data: existing } = await service.from('meta_menu')
    .select('id').eq('tenant_id', tenantId).is('parent_id', null).eq('name', comp.name).limit(1);
  if (existing && existing.length > 0) {
    return json({ error: '该组件已安装，请先卸载后再安装', code: 'ALREADY_INSTALLED' }, 409);
  }

  // 1. 拉取蓝本表单元数据
  const { data: blueprintForms, error: bpErr } = await service.from('meta_forms')
    .select('id, name, code, icon, status, schema_json, list_config, settings, app_type, form_mode, steps')
    .eq('tenant_id', BLUEPRINT_TENANT).in('id', comp.forms);
  if (bpErr || !blueprintForms || blueprintForms.length !== comp.forms.length) {
    return json({ error: '蓝本数据不完整，请联系管理员检查演示租户配置' }, 500);
  }

  // 2. 目标租户同名表单复用（跨组件共享，避免重复创建）
  const names = blueprintForms.map((f) => f.name);
  const { data: existingForms } = await service.from('meta_forms')
    .select('id, name').eq('tenant_id', tenantId).in('name', names);
  const existingByName = new Map<string, string>((existingForms ?? []).map((f) => [f.name, f.id as string]));

  // 3. 复制缺失表单
  const stamp = Date.now().toString(36);
  const toCreate = blueprintForms.filter((f) => !existingByName.has(f.name));
  const idMap = new Map<string, string>(); // 蓝本表单 ID -> 目标租户表单 ID
  if (toCreate.length > 0) {
    const rows = toCreate.map((f) => ({
      tenant_id: tenantId,
      name: f.name,
      code: `${comp.id}_${f.code || f.id}_${stamp}`,
      icon: f.icon,
      version: 1,
      published_version: 1,
      status: 'published',
      schema_json: f.schema_json,
      list_config: f.list_config,
      settings: f.settings,
      app_type: f.app_type,
      form_mode: f.form_mode,
      steps: f.steps,
    }));
    const { data: created, error: insErr } = await service.from('meta_forms').insert(rows).select('id, name');
    if (insErr || !created) return json({ error: '创建表单失败：' + (insErr?.message ?? '') }, 500);
    const nameToNew = new Map(created.map((c) => [c.name, c.id as string]));
    for (const f of toCreate) idMap.set(f.id, nameToNew.get(f.name)!);
  }
  for (const f of blueprintForms) {
    if (!idMap.has(f.id)) idMap.set(f.id, existingByName.get(f.name)!);
  }

  // 4. 重映射新表单 schema_json 中的跨表单引用（表单全部就位后统一替换，覆盖单方向引用链）
  for (const f of toCreate) {
    const newId = idMap.get(f.id)!;
    const remapped = remapFormRefs(f.schema_json, idMap);
    if (JSON.stringify(remapped) !== JSON.stringify(f.schema_json)) {
      const { error: updErr } = await service.from('meta_forms').update({ schema_json: remapped }).eq('id', newId);
      if (updErr) return json({ error: '重映射表单引用失败：' + updErr.message }, 500);
    }
  }

  // 5. 复制状态机 / 审批流 / 动作引擎（仅新创建的表单；状态机与动作中的跨表单引用同样重映射）
  for (const f of toCreate) {
    const newId = idMap.get(f.id)!;
    const { data: sm } = await service.from('meta_state_machine')
      .select('states, transitions').eq('form_id', f.id).maybeSingle();
    if (sm) {
      await service.from('meta_state_machine').insert({
        tenant_id: tenantId, form_id: newId,
        states: remapFormRefs(sm.states, idMap),
        transitions: remapFormRefs(sm.transitions, idMap),
      });
    }
    const { data: wf } = await service.from('meta_workflow')
      .select('name, nodes, transitions, version, settings').eq('form_id', f.id).maybeSingle();
    if (wf) {
      await service.from('meta_workflow').insert({
        tenant_id: tenantId, form_id: newId, name: wf.name,
        nodes: demoteUserApprovers(wf.nodes), transitions: wf.transitions,
        version: wf.version, settings: wf.settings,
      });
    }
    const { data: actions } = await service.from('meta_actions')
      .select('position, name, icon, variant, action_type, config, show_condition, enable_condition, permission_code, confirm_text, success_text, after_behavior, sort, version')
      .eq('form_id', f.id).order('sort');
    if (actions && actions.length > 0) {
      await service.from('meta_actions').insert(actions.map((a) => ({
        ...a,
        tenant_id: tenantId, form_id: newId,
        config: remapFormRefs(a.config, idMap),
      })));
    }
  }

  // 6. 创建菜单树（一级菜单排在系统菜单之前：取现有业务菜单最大 sort + 1）
  const { data: roots } = await service.from('meta_menu')
    .select('sort_order, is_system').eq('tenant_id', tenantId).is('parent_id', null);
  const maxBiz = Math.max(0, ...(roots ?? []).filter((r) => !r.is_system).map((r) => r.sort_order as number));
  const { data: rootMenu, error: rootErr } = await service.from('meta_menu').insert({
    tenant_id: tenantId, parent_id: null, name: comp.name, icon: comp.icon,
    sort_order: maxBiz + 1, menu_type: 'custom', form_id: null,
    visible_roles: ['all'], status: 'published',
  }).select('id').single();
  if (rootErr || !rootMenu) return json({ error: '创建菜单失败：' + (rootErr?.message ?? '') }, 500);
  const rootId = rootMenu.id as string;

  let sortCounter = 0;
  const nextSort = () => ++sortCounter;
  const leafPaths: string[] = []; // 收集新建叶子菜单 path，用于同步角色权限码
  for (const group of comp.menu) {
    const { data: groupMenu } = await service.from('meta_menu').insert({
      tenant_id: tenantId, parent_id: rootId, name: group.name, icon: group.icon,
      sort_order: nextSort(), menu_type: 'custom', form_id: null,
      visible_roles: ['all'], status: 'published',
    }).select('id').single();
    if (!groupMenu) continue;
    for (const leaf of group.children) {
      const formId = idMap.get(F[leaf.formKey]) ?? null;
      const path = formId ? (leaf.page ? `/page/${formId}` : `/app/${formId}`) : null;
      if (path) leafPaths.push(path);
      await service.from('meta_menu').insert({
        tenant_id: tenantId, parent_id: groupMenu.id, name: leaf.name, icon: leaf.icon,
        sort_order: nextSort(), menu_type: 'list', form_id: formId,
        path,
        visible_roles: ['all'], status: 'published',
      });
    }
  }

  // 6.5 将新菜单 path 追加到租户所有角色的 menu_perms：
  //     新表单 ID 重映射后的 path 不在任何角色的权限码中，
  //     不追加会导致非超管账号刷新后看不到新装的组件菜单。
  await appendRolePerms(service, tenantId, leafPaths);

  // 7. 审批类表单挂载工作台待办菜单（仅一条「组件名」，页面内用选项卡区分 待我处理/我申请的）。
  //    按「应用组件」去重：一个组件即便含多个审批表单，也只生成一条待办菜单。
  //    目标租户缺失「工作台」根菜单或「待办事项」分组时自动补建（is_system 菜单），
  //    否则待办三级菜单无处挂载会被静默跳过。
  let wbRootId: string | null = null;
  {
    const { data: wb } = await service.from('meta_menu')
      .select('id').eq('tenant_id', tenantId).is('parent_id', null).eq('name', '工作台').maybeSingle();
    wbRootId = (wb?.id as string) ?? null;
    if (!wbRootId) {
      const { data: createdWb, error: wbErr } = await service.from('meta_menu').insert({
        tenant_id: tenantId, parent_id: null, name: '工作台', icon: 'layout',
        sort_order: 0, menu_type: 'custom', is_system: true, form_id: null,
        visible_roles: ['all'], status: 'published',
      }).select('id').single();
      if (wbErr || !createdWb) return json({ error: '创建工作台菜单失败：' + (wbErr?.message ?? '') }, 500);
      wbRootId = createdWb.id as string;
      // 工作台首页叶子（path=/，与蓝本结构一致）
      await service.from('meta_menu').insert({
        tenant_id: tenantId, parent_id: wbRootId, name: '工作台', icon: 'home',
        sort_order: 1, menu_type: 'custom', is_system: true, form_id: null,
        path: '/', visible_roles: ['all'], status: 'published',
      });
    }
  }
  let todoGroupId: string | null = null;
  {
    const { data: tg } = await service.from('meta_menu')
      .select('id').eq('tenant_id', tenantId).eq('parent_id', wbRootId).eq('name', '待办事项').maybeSingle();
    todoGroupId = (tg?.id as string) ?? null;
    if (!todoGroupId) {
      const { data: createdTg, error: tgErr } = await service.from('meta_menu').insert({
        tenant_id: tenantId, parent_id: wbRootId, name: '待办事项', icon: 'boxes',
        sort_order: 2, menu_type: 'custom', is_system: true, form_id: null,
        visible_roles: ['all'], status: 'published',
      }).select('id').single();
      if (tgErr || !createdTg) return json({ error: '创建待办事项分组失败：' + (tgErr?.message ?? '') }, 500);
      todoGroupId = createdTg.id as string;
    }
  }
  {
    // 组件闭包内全部审批表单（含同名复用的既有表单），逐个挂待办菜单（名称=表单名，按 path 去重）
    const approvalForms = blueprintForms.filter((x) => x.form_mode === 'approval');
    const todoPaths: string[] = [];
    let sortSeed = 0;
    for (const af of approvalForms) {
      const afId = idMap.get(af.id)!;
      const { data: dup } = await service.from('meta_menu')
        .select('id').eq('tenant_id', tenantId).like('path', `/todo/${afId}%`).limit(1);
      if (dup && dup.length > 0) continue;
      const { data: cnt } = await service.from('meta_menu')
        .select('id', { count: 'exact', head: true }).eq('parent_id', todoGroupId);
      const baseSort = (cnt?.length ?? 0) + 1 + sortSeed;
      sortSeed += 1;
      await service.from('meta_menu').insert({
        tenant_id: tenantId, parent_id: todoGroupId, name: af.name, icon: 'clipboard',
        sort_order: baseSort, menu_type: 'custom', form_id: afId,
        path: `/todo/${afId}`, visible_roles: ['all'], status: 'published',
      });
      todoPaths.push(`/todo/${afId}`);
    }
    // 待办菜单 path 同样为新权限码，追加到租户所有角色
    await appendRolePerms(service, tenantId, todoPaths);
  }

  // 8. 返回（首个叶子表单用于安装后跳转）
  let firstFormId: string | null = null;
  for (const group of comp.menu) {
    const leaf = group.children.find((c) => idMap.get(F[c.formKey]));
    if (leaf) { firstFormId = idMap.get(F[leaf.formKey])!; break; }
  }
  return json({ success: true, root_menu_id: rootId, form_count: toCreate.length, first_form_id: firstFormId });
}

/** 卸载组件：删除菜单树与待办菜单，表单与业务数据保留 */
async function uninstall(service: Sb, tenantId: string, comp: ComponentDef) {
  const { data: root } = await service.from('meta_menu')
    .select('id').eq('tenant_id', tenantId).is('parent_id', null).eq('name', comp.name).maybeSingle();
  if (!root) return json({ error: '该组件未安装', code: 'NOT_INSTALLED' }, 404);

  // 收集子树全部菜单 ID 与 form_id
  const subtreeIds: string[] = [root.id as string];
  const formIds = new Set<string>();
  let frontier: string[] = [root.id as string];
  while (frontier.length > 0) {
    const { data: children } = await service.from('meta_menu')
      .select('id, form_id').eq('tenant_id', tenantId).in('parent_id', frontier);
    if (!children || children.length === 0) break;
    for (const c of children) {
      subtreeIds.push(c.id as string);
      if (c.form_id) formIds.add(c.form_id as string);
    }
    frontier = children.map((c) => c.id as string);
  }

  // 删除菜单树（ON DELETE CASCADE 递归删除）
  const { error: delErr } = await service.from('meta_menu').delete().eq('id', root.id);
  if (delErr) return json({ error: '卸载失败：' + delErr.message }, 500);

  // 无其他菜单引用的表单 → 一并清理待办菜单（表单本体与业务数据保留）
  for (const fid of formIds) {
    const { data: refs } = await service.from('meta_menu')
      .select('id').eq('tenant_id', tenantId).eq('form_id', fid).limit(1);
    if (!refs || refs.length === 0) {
      await service.from('meta_menu').delete().eq('tenant_id', tenantId).like('path', `/todo/${fid}%`);
    }
  }
  return json({ success: true, removed_menu_ids: subtreeIds });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await anon.auth.getUser();
  if (userErr || !user) return json({ error: '未登录' }, 401);

  const { data: prof } = await anon.from('profiles').select('is_superadmin, tenant_id').eq('id', user.id).maybeSingle();
  if (!prof?.is_superadmin) return json({ error: '仅超级管理员可操作' }, 403);
  const tenantId = prof.tenant_id as string;

  let body: { component_id?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: '请求体格式错误' }, 400); }
  const comp = COMPONENTS.find((c) => c.id === body.component_id);
  if (!comp) return json({ error: '应用组件不存在' }, 400);

  const service = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const action = body.action ?? 'install';
  if (action === 'uninstall') return await uninstall(service, tenantId, comp);
  if (action === 'install') return await install(service, tenantId, comp);
  return json({ error: '不支持的操作：' + action }, 400);
});
