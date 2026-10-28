// ============ 数据库实体类型（Supabase 表结构映射） ============

export interface Tenant {
  id: string;
  name: string;
  subdomain: string | null;
  plan: string;
  created_at: string;
}

export interface Profile {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  employee_no: string | null;
  email: string | null;
  department_id: string | null;
  position: string | null;
  gender: string;
  education: string | null;
  id_card: string | null;
  hire_date: string | null;
  social_security_transfer_date: string | null;
  housing_fund_transfer_date: string | null;
  emergency_contact: string | null;
  emergency_contact_phone: string | null;
  avatar_url: string | null;
  status: 'active' | 'disabled';
  is_superadmin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  tenant_id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  leader_id: string | null;
  created_at: string;
}

/** 数据范围：全部数据 / 本部门及下级 / 本部门 / 仅本人 */
export type DataRange = 'permission' | 'all' | 'dept_sub' | 'dept' | 'mine';

/** 数据范围中文标签 */
export const DATA_RANGE_LABELS: Record<DataRange, string> = {
  permission: '跟随权限',
  all: '全部数据',
  dept_sub: '本部门及下级',
  dept: '本部门',
  mine: '仅本人',
};

export interface Role {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: 'enabled' | 'disabled';
  data_scope: 'all' | 'dept_and_below' | 'dept' | 'self' | 'custom';
  menu_perms: string[];
  button_perms: string[];
  row_rules: RuleItem[] | RowRuleGroup[];
  col_rules: ColRule[];
  created_at: string;
}

/** 行级权限：普通模式条件项 */
export interface RuleItem {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'ncontains' | 'in' | 'between';
  value: string;
  /** 右值类型：设定值（value，默认）或当前表字段（field）——字段模式下 value 存右字段 key */
  value_type?: 'value' | 'field';
}

/** 行级权限：高级模式组合（AND/OR/括号嵌套） */
export interface RowRuleGroup {
  logic: 'and' | 'or';
  children: Array<RuleItem | RowRuleGroup>;
}

/** 列级权限：隐藏/可见字段 */
export interface ColRule {
  form_id: string;
  hidden_fields: string[];
}

export interface UserRole {
  id: string;
  tenant_id: string;
  user_id: string;
  role_id: string;
}

// ============ 低代码元数据 ============

/** 表单字段定义（表单设计器产物） */
export interface SerialRule {
  id: string;
  type: 'counter' | 'date' | 'fixed' | 'field';
  /** 计数位数 */
  digits?: number;
  /** 位数固定（不足补零） */
  pad?: boolean;
  /** 重置周期 */
  resetCycle?: 'never' | 'year' | 'month' | 'day';
  /** 初始值 */
  start?: number;
  /** 日期格式（如 yyyyMMdd） */
  format?: string;
  /** 固定字符内容 / 表单字段 key */
  value?: string;
}

export interface FormField {
  id: string;
  type: string;
  label: string;
  key: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  /** 栅格宽度 1-24 */
  span?: number;
  /** 所属容器字段 id（向导步骤 wizard-step 内的字段） */
  parentId?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** 系统内置字段（创建人/创建时间/更新人/更新时间），不可删除，运行时只读自动填充 */
  system?: boolean;
  /** 值唯一（单行文本/手机号）：新增/编辑保存时校验同表单是否已存在同值，存在则拒绝保存 */
  unique?: boolean;
  /** 图片上传/附件上传：最大上传数量（默认 1） */
  maxCount?: number;
  /** 校验规则 */
  validation?: {
    pattern?: string;
    message?: string;
    min?: number;
    max?: number;
    maxLength?: number;
  };
  /** 关联字段配置 */
  relation?: {
    formId: string;
    /** 子列表展示的目标表单字段 key 列表 */
    displayFields?: string[];
    searchable?: boolean;
    filter?: RuleItem[];
    /** 数据范围：全部数据 / 本部门及下级 / 本部门 / 仅本人 */
    dataRange?: DataRange;
    /** 数据保存方式：with-main 随主表统一保存（默认，选中记录快照内嵌存入主表）/ standalone 单独保存且关联主表（主表仅存选中记录 ID） */
    saveMode?: 'with-main' | 'standalone';
    /** 详情页是否隐藏该关联字段的子列表（默认 false；新增关联表单自动创建的回填字段默认 true） */
    hideInDetail?: boolean;
    /** 显示条件：对数据源进行多条件 AND/OR 过滤 */
    conditions?: DisplayCondition[];
    /** 显示条件之间的逻辑关系 */
    conditionsLogic?: 'and' | 'or';
    /** 手动筛选字段：运行时在关联弹窗上方渲染筛选区 */
    manualFilters?: ManualFilter[];
    /** 手动筛选项之间的逻辑关系 */
    manualFiltersLogic?: 'and' | 'or';
  };
  /** 下拉单选/多选的选项类型：custom 自定义静态选项 / data 从已有表单字段拉取 */
  optionType?: 'custom' | 'data';
  /** 下拉单选/多选的动态数据源：从已有业务表的某字段拉取选项 */
  optionSource?: {
    formId: string;
    fieldKey: string;
    /** 多字段拼接显示：目标表单记录的多个字段按分隔符拼接为选项文本；配置后选项以记录 id 为值，各字段值以引用前缀分字段存储 */
    fieldKeys?: string[];
    /** 组合分隔符（多字段拼接显示用，默认 '-'） */
    separator?: string;
    /** 数据范围：限制可拉取选项的数据来源 */
    dataRange?: DataRange;
  };
  /** 公式计算配置：{key} 引用当前表单字段，{关联字段key.目标字段key} 引用关联表单选中记录（第一条）的字段，支持 + - * / 与括号 */
  formula?: {
    expression: string;
  };

  /** 大写金额配置：关联当前表单金额/数字类字段，自动转换为中文大写金额并随单据保存 */
  uppercaseAmount?: {
    fieldKey: string;
  };
  /** 汇总统计配置：对当前表单、子表单或关联表单记录做聚合 */
  summary?: {
    /** 统计来源：current 当前表单全部记录 / subtable 当前记录关联的子表明细行 / ref 关联表单（按关联字段数据范围） */
    source: 'current' | 'subtable' | 'ref';
    /** source=subtable 时：子表字段 key */
    subFieldKey?: string;
    /** source=ref 时：关联表单字段 key */
    refFieldKey?: string;
    /** 聚合目标字段 key（aggregate=count 时可为空） */
    fieldKey?: string;
    /** 聚合方式：count 记录数 / sum 求和 / avg 平均 */
    aggregate: 'count' | 'sum' | 'avg';
  };
  /** 关联取值配置：从当前记录的子表明细行或指定表单全部数据中按排序取一条的字段值 */
  fetchValue?: {
    /** 取值来源：subtable 子表单 / form 指定表单 */
    source: 'subtable' | 'form';
    /** source=subtable 时：子表字段 key */
    subFieldKey?: string;
    /** source=form 时：目标表单 id */
    formId?: string;
    /** 取值字段 key */
    fieldKey: string;
    /** 取值排序：按字段值大小（数值/日期/时间）或记录时间，正序 / 倒序取第一条 */
    sortBy: 'value-asc' | 'value-desc' | 'time-asc' | 'time-desc';
    /** source=form 时：数据范围限制（全部数据 / 本部门及下级 / 本部门 / 仅本人 / 跟随权限） */
    dataRange?: DataRange;
  };
  /** 布局组件参数（分组标题/分栏/说明文字等） */
  layout?: {
    text?: string;
    columns?: number;
    description?: string;
  };
  /** 分栏布局每栏配置（type='grid' 时使用，支持 1-6 栏，每栏可配置独立标题与文本属性） */
  gridColumns?: TextColumnConfig[];
  /** 选项字段参数 */
  options?: string[];
  /**
   * 选项联动赋值：当本字段取某选项值时，将指定值写入当前表单的其他字段（文本框等）。
   * 仅对 radio / checkbox / select / multi-select 生效。
   */
  valueAssign?: ValueAssignRule[];
  /** 操作按钮配置（type='action-button' 字段） */
  button?: FormButton;
  /** 流水号规则配置 */
  serialRules?: SerialRule[];
  /** 请假时间设置组件（type='leave-time'）的每日工作时间（整点） */
  workHours?: WorkHours;
  /** 请假时间组件绑定：保存后业务层面拆分为独立的开始/结束时间字段，并自动计算小时/天数写入独立字段 */
  leaveTime?: {
    /** 请假小时字段 key */
    hoursKey?: string;
    /** 请假天数字段 key */
    daysKey?: string;
    /** 开始时间字段 key（存储 YYYY-MM-DD HH:mm，如 2026-09-21 09:00） */
    startKey?: string;
    /** 结束时间字段 key（存储 YYYY-MM-DD HH:mm，如 2026-09-21 18:00） */
    endKey?: string;
  };
  /** 人员选择/部门选择是否多选 */
  /** 表单赋值组件配置：关联表单选择、显示字段（可多选组合）、字段映射及搜索字段配置 */
  assignment?: {
    /** 取值来源模式：current 当前表单 / ref 关联表单 */
    sourceMode?: 'current' | 'ref';
    /** 关联表单 ID（支持系统内已有表单，包含当前表单） */
    formId: string;
    /** 数据范围：全部数据 / 本部门及下级 / 本部门 / 仅本人 / 跟随权限 */
    dataRange?: DataRange;
    /** 文本框显示的字段 key 列表（按顺序组合拼接显示，如 [name, code]） */
    displayFieldKeys: string[];
    /** 字段显示组合分隔符（默认空格） */
    displaySeparator?: string;
    /** 字段赋值映射规则：关联表单字段 -> 当前表单字段 */
    mappings: Array<{
      sourceFieldKey: string;
      targetFieldKey: string;
    }>;
    /** 选择弹窗中的搜索条件字段 key 列表（从关联表单中选取） */
    searchFieldKeys?: string[];
    /** 选择弹窗数据列表展示列字段 key 列表（未配置时按显示字段+搜索字段并集兜底） */
    listFieldKeys?: string[];
    /** 搜索条件控件类型配置（fieldKey → 控件类型，未配置的旧配置默认按输入框处理） */
    searchControls?: Record<string, 'input' | 'date-range' | 'select' | 'cascader'>;
  };
  multi?: boolean;
  /** 查询表单组件配置（type='query'）：自动查询关联表单数据只读展示 */
  query?: {
    formId: string;
    /** 展示的目标表单字段 key 列表 */
    displayFields?: string[];
    /** 数据范围：全部数据 / 本部门及下级 / 本部门 / 仅本人 / 跟随权限；旧 filterByApplicant=true 等价于 mine */
    dataRange?: DataRange;
    /** 按当前表单申请人过滤（查询我创建的记录） */
    filterByApplicant?: boolean;
    /** 显示条件：对数据源进行多条件 AND/OR 过滤 */
    conditions?: DisplayCondition[];
    /** 显示条件之间的逻辑关系 */
    conditionsLogic?: 'and' | 'or';
    /** 手动筛选字段：运行时在表头上方渲染筛选区 */
    manualFilters?: ManualFilter[];
    /** 手动筛选项之间的逻辑关系 */
    manualFiltersLogic?: 'and' | 'or';
  };
  /** 关联子表组件配置（type='sub-table'）：主表填写时内嵌录入子表明细行 */
  subTable?: {
    /** 目标子表单 id */
    targetFormId: string;
    /** 子表列表展示的目标表单字段 key 列表 */
    displayColumns: string[];
    /** 数据范围：全部数据 / 本部门及下级 / 本部门 / 仅本人 / 跟随权限 */
    dataRange?: DataRange;
    /** 最少明细行数（0 不限制；必填时至少 1 行） */
    minRows?: number;
    /** 最多明细行数（0 不限制） */
    maxRows?: number;
    /** 数据保存方式：with-main 随主表统一保存（默认，明细以 JSON 内嵌存入主表）/ standalone 单独保存且关联主表（行弹窗确定即入库，主表存行 ID 数组） */
    saveMode?: 'with-main' | 'standalone';
  };
}

/** 显示条件：对查询/关联表单的数据源进行过滤 */
export interface DisplayCondition {
  id: string;
  /** 目标表单字段 key */
  fieldKey: string;
  /** 比较运算符 */
  op: 'eq' | 'ne' | 'contains' | 'gt' | 'lt';
  /** 比较值 */
  value: string;
}

/** 手动筛选字段配置：运行时在查询表单表头/关联弹窗上方渲染筛选控件 */
export interface ManualFilter {
  id: string;
  /** 目标表单字段 key */
  fieldKey: string;
  /** 筛选控件类型 */
  control: 'input' | 'select' | 'date' | 'date-range';
  /** 筛选项 label */
  label?: string;
  /** 下拉选项（control='select' 时） */
  options?: string[];
  /** 输入框默认提示文字（运行时显示在组件内） */
  placeholder?: string;
}

/** 单页设计组件类型 */
export type PageFieldType =
  | 'page-year'
  | 'page-date'
  | 'page-date-range'
  | 'page-time'
  | 'page-text-display'
  | 'page-query'
  | 'page-leave-info'
  | 'page-chart-bar'
  | 'page-chart-line'
  | 'page-chart-area'
  | 'page-chart-hbar'
  | 'page-chart-pie'
  | 'page-chart-radar'
  | 'page-chart-funnel'
  | 'page-group-title'
  | 'page-divider'
  | 'page-description'
  | 'page-grid'
  | 'page-layout'
  | 'page-summary'
  | 'page-formula'
  | 'page-action-button';

/** 文本显示组件：关联数据源配置（文本显示组件与分栏容器每栏共用） */
export interface TextSourceConfig {
  formId: string;
  fieldKey: string;
  /** 聚合方式：取首条/求和/计数 */
  aggregate?: 'first' | 'sum' | 'count';
  /** 数据范围：全部数据 / 本部门及下级 / 本部门 / 仅本人 / 跟随权限 */
  dataRange?: DataRange;
  /** 未关联表单时的默认显示值 */
  defaultValue?: string;
  /** 显示条件：对数据源进行多条件 AND/OR 过滤 */
  conditions?: DisplayCondition[];
  /** 显示条件之间的逻辑关系 */
  conditionsLogic?: 'and' | 'or';
  /** 图标键名（lucide 图标，见 icon-registry） */
  icon?: string;
  /** 自定义单位文本（如：条/个/元；count 聚合时默认「条」） */
  unit?: string;
  /** 数值颜色 */
  color?: string;
}

/** 分栏容器的单栏配置：完全复用文本显示组件的数据源配置 */
export interface TextColumnConfig extends TextSourceConfig {
  /** 栏目标题 */
  title?: string;
}

/** 单页设计组件定义 */
/** 漏斗图单层配置 */
export interface FormLayer {
  /** 关联表单 id */
  formId: string;
  /** 自定义层标签（默认取表单名） */
  label?: string;
  /** 分组字段（按每个值统计） */
  categoryField?: string;
  /** 统计方式 */
  valueAgg?: 'sum' | 'count' | 'avg';
  /** 数值字段（sum/avg 时使用） */
  valueField?: string;
  /** 显示条件（对该层数据源自动过滤） */
  conditions?: DisplayCondition[];
  conditionsLogic?: 'and' | 'or';
}

export interface PageField {
  id: string;
  type: PageFieldType;
  label: string;
  key: string;
  span?: number;
  /** 自由布局坐标（像素，相对画布） */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** 文本显示组件：关联数据源配置 */
  dataSource?: TextSourceConfig;
  /** 查询组件配置（复用 query 配置） */
  query?: {
    formId: string;
    displayFields?: string[];
    /** 数据范围：mine 仅我创建的数据 / all 全部数据记录 */
    dataRange?: DataRange;
    conditions?: DisplayCondition[];
    conditionsLogic?: 'and' | 'or';
    manualFilters?: ManualFilter[];
    manualFiltersLogic?: 'and' | 'or';
  };
  /** 图表组件配置 */
  chart?: {
    formId: string;
    /** 漏斗图多层配置：每层关联一个表单，可独立配置分组字段、统计方式等 */
    formLayers?: FormLayer[];
    /** 兼容旧配置：formIds + formLabels */
    formIds?: string[];
    formLabels?: string[];
    /** 数据范围：全部数据 / 本部门及下级 / 本部门 / 仅本人 */
    dataRange?: DataRange;
    /** 统计方式：按字段分组 / 按时间分组 */
    groupBy?: 'field' | 'time';
    /** 分类（维度）字段 —— groupBy='field' 时使用 */
    categoryField?: string;
    /** 时间维度字段 —— groupBy='time' 时使用 */
    timeField?: string;
    /** 分组字段（可多选）：按时间统计时，每个分组字段的取值拆分为独立曲线/系列 */
    seriesFields?: string[];
    /** 多系列每字段独立配置：非下拉/状态机的分组字段每个字段一条曲线，各自配置统计方式和数值字段 */
    seriesConfigs?: Array<{ fieldKey: string; valueField?: string; valueAgg?: 'sum' | 'count' | 'avg' }>;
    /** 默认时间粒度（兼容旧配置） */
    timeGranularity?: 'day' | 'week' | 'month' | 'year' | 'range';
    /** 启用的时间粒度（多选），运行时可点击切换 */
    timeGranularities?: ('day' | 'week' | 'month' | 'year' | 'range')[];
    /** 数值（度量）字段 */
    valueField?: string;
    /** 数值聚合方式：count=统计记录数；sum=对数值字段求和；avg=对数值字段求平均 */
    valueAgg?: 'sum' | 'count' | 'avg';
    conditions?: DisplayCondition[];
    conditionsLogic?: 'and' | 'or';
    manualFilters?: ManualFilter[];
    manualFiltersLogic?: 'and' | 'or';
  };
  /** 「我的年假信息」组件内置「我的请假信息-年假」列表配置 */
  leaveList?: {
    /** 关联的请假表单 */
    formId: string;
    /** 列表显示字段（key）；特殊值：__no=请假编号、status=状态 */
    displayFields?: string[];
    /** 列表信息过滤条件 */
    conditions?: DisplayCondition[];
    conditionsLogic?: 'and' | 'or';
  };
  /** 布局组件参数（分组标题/分割线/说明文字/分栏容器） */
  layout?: {
    /** 标题/说明文字内容 */
    text?: string;
    /** 分栏列数（page-grid 使用） */
    columns?: number;
    /** 文字大小：normal/h2/h3 */
    size?: 'normal' | 'h2' | 'h3';
  };
  /** 分栏容器：每栏的文本显示配置（page-grid 使用，功能同文本显示组件） */
  gridColumns?: TextColumnConfig[];
  /** 页面布局容器（page-layout）：竖分列数，每栏可拖入组件，纯排版 */
  layoutColumns?: {
    /** 列数：1 / 2 / 3 / 4 */
    count?: 1 | 2 | 3 | 4;
    /** 每栏包含的子组件 */
    children: PageField[][];
  };
  /** 汇总统计组件：对某表单字段做聚合统计 */
  summary?: {
    formId: string;
    fieldKey: string;
    /** 聚合方式：count 记录数 / sum 求和 / avg 平均 */
    aggregate: 'count' | 'sum' | 'avg';
  };
  /** 公式计算组件：基于其他页面字段值计算表达式 */
  formula?: {
    /** 表达式，引用其他字段用 {fieldKey} */
    expression: string;
  };
  /** 自定义按钮组件 */
  action?: {
    /** 按钮文字 */
    label: string;
    /** 动作类型 */
    type: 'navigate' | 'print' | 'refresh';
    /** 跳转目标路径（navigate 时使用） */
    targetPath?: string;
  };
}

/** 单页设计配置（存储于 list_config 或独立字段） */
export interface PageConfig {
  fields: PageField[];
}

/** 每日工作时间（整点，24 小时制），用于请假时长计算 */
export interface WorkHours {
  /** 上午上班整点，默认 9 */
  amStart?: number;
  /** 上午下班整点，默认 12 */
  amEnd?: number;
  /** 下午上班整点，默认 13 */
  pmStart?: number;
  /** 下午下班整点，默认 18 */
  pmEnd?: number;
}

/** 请假时间设置组件的存储值 */
export interface LeaveTimeValue {
  start_date?: string;
  /** 开始时间点（整点 0-23） */
  start_time?: number;
  end_date?: string;
  /** 结束时间点（整点 0-23） */
  end_time?: number;
  /** 自动计算：请假总小时数 */
  hours?: number;
  /** 自动计算：折算天数（hours / 每日工时） */
  days?: number;
}

export interface FormSettings {
  /** 表单描述 */
  description?: string;
  /** 标签对齐方式 */
  labelAlign?: 'left' | 'right' | 'top';
  /** 标题宽度（px） */
  labelWidth?: number;
  /** 栅格间隔（px） */
  gutter?: number;
  /** 表单尺寸 */
  size?: 'small' | 'medium' | 'large';
  /** 弹窗类型 */
  dialogType?: 'center' | 'right' | 'fullscreen';
  /** 唯一性校验字段 key 列表 */
  uniqueFields?: string[];
  /** 字段显隐规则 */
  visibilityRules?: VisibilityRule[];
}

/** 显隐规则比较运算符 */
export type VisibilityOp = 'eq' | 'neq' | 'contains' | 'empty' | 'notempty';

/** 显隐规则单个条件 */
export interface VisibilityCondition {
  fieldKey: string;
  op: VisibilityOp;
  value: string;
}

/** 字段显隐规则：满足条件时对目标字段执行显示/隐藏 */
export interface VisibilityRule {
  id: string;
  /** 目标字段 key */
  targetKey: string;
  /** 满足条件时的动作 */
  action: 'show' | 'hide';
  /** 条件之间的逻辑关系 */
  logic: 'and' | 'or';
  conditions: VisibilityCondition[];
}

/** 主体范围（人员/部门/角色），用于发起人、抄送等选择器 */
export interface PrincipalGroup {
  users: string[];
  depts: string[];
  roles: string[];
}

/** 允许发起人：类型 + 对应名单（按人员/按部门/按角色） */
export interface InitiatorConfig {
  type: 'user' | 'dept' | 'role';
  value: string[];
}

/** 节点字段权限类型 */
export type FieldPermission = 'visible' | 'editable' | 'hidden';

export interface MetaForm {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  icon: string | null;
  /** 应用类型：表单设计 / 单页设计 */
  app_type: 'form' | 'page';
  /** 表单模式：normal 普通表单 / state 状态机表单 / approval 审批表单 / wizard 向导分步表单（app_type=form 时有效） */
  form_mode?: 'normal' | 'state' | 'approval' | 'wizard';
  /** 向导表单步骤配置（form_mode='wizard' 时有效）：未分配字段默认归入最后一步 */
  steps?: WizardStep[];
  version: number;
  published_version: number;
  status: 'draft' | 'published';
  schema_json: { fields: FormField[] };
  list_config: ListConfig;
  settings: FormSettings;
  created_at: string;
  updated_at: string;
}

/** 向导表单步骤容器（MetaForm.steps 元素）：每个步骤是一个字段容器 */
export interface WizardStep {
  id: string;
  title: string;
  /** 步骤说明（可选） */
  description?: string;
  /** 该步骤包含的字段 key 列表；未分配字段默认归入最后一步 */
  fieldKeys: string[];
}

/** 列表页配置（列表页设计器产物） */
export interface ListConfig {
  /** 列显示配置 */
  columns?: ColumnConfig[];
  /** 搜索筛选配置 */
  search?: SearchConfig[];
  /** 行操作按钮 */
  actions?: string[];
  /** 默认排序字段 */
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** 行操作超出该数量后折叠进「更多」菜单 */
  row_visible_limit?: number;
  /** 打印与导出模板列表 */
  templates?: PrintExportTemplate[];
}

/** 模板类型枚举：excel 列表、报销单、借款单、物流单、自定义单据 */
export type TemplateKind = 'excel_list' | 'expense' | 'loan' | 'logistics' | 'custom';

/** 模板中的字段映射项：可对应表单字段，也可置空/填固定文本 */
export interface TemplateFieldMapping {
  id: string;
  /** 模板内部展示的字段名/表头名称（如：报销人、报销金额、事由、物流单号） */
  label: string;
  /** 对应的表单字段 key；若为 '__empty__' 或留空表示置空 */
  formFieldKey?: string;
  /** 当表单字段置空时，可指定的默认固定文本（可选） */
  defaultValue?: string;
  /** 字段对齐方式 */
  align?: 'left' | 'center' | 'right';
  /** 字段宽度权重或百分比（可选） */
  width?: string;
  /**
   * 字段所属区域（仅单据类模板有效，默认 'meta'）：
   * - meta：单据表头信息区（标签|值 四列栅格）
   * - items：费用/货物明细表列（配合 fixedItemRows 输出固定行数表格）
   * - sign：底部签字栏（标签后留白供手写签字）
   */
  section?: 'meta' | 'items' | 'sign';
  /** 金额格式：数值按 ¥1,234.56 千分位输出（金额类字段推荐开启） */
  money?: boolean;
  /** 人民币大写：将绑定的数值金额转换为中文大写（如 陆佰陆拾陆元贰角零分），需与金额字段绑定同一表单字段 */
  upperCase?: boolean;
}

/** 打印与导出模板完整定义 */
export interface PrintExportTemplate {
  id: string;
  /** 模板名称，如：标准报销单打印模版、全量Excel导出模板 */
  name: string;
  /** 模板类别 */
  kind: TemplateKind;
  /** 模板说明/备注 */
  description?: string;
  /** 单据主标题（打印时顶部展示，如：费用报销审批单） */
  title: string;
  /** 单据副标题/公司名称/落款信息 */
  subtitle?: string;
  /** 字段映射清单（可对应表单字段，也可置空） */
  fields: TemplateFieldMapping[];
  /** 打印纸张方向：portrait(纵向) / landscape(横向) */
  orientation?: 'portrait' | 'landscape';
  /** 是否显示打印时间与落款 */
  showFooter?: boolean;
  /** 是否为默认模板 */
  isDefault?: boolean;
  /** 明细表固定行数：数据行不足时补空白行供手写（仅含 items 区字段时生效，如报销单 6 行） */
  fixedItemRows?: number;
}

export interface ColumnConfig {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  format?: 'none' | 'date' | 'datetime' | 'money' | 'percent';
}

export interface SearchConfig {
  key: string;
  label: string;
  /** 筛选控件类型 */
  control: 'input' | 'select' | 'date-range' | 'cascader';
  /** 动态数据源（绑定关联表数据） */
  dynamic?: boolean;
  options?: string[];
}

export interface MetaMenu {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  name: string;
  path: string | null;
  icon: string;
  sort_order: number;
  menu_type: 'form' | 'list' | 'dashboard' | 'custom';
  form_id: string | null;
  visible_roles: string[];
  status: 'draft' | 'published';
  /** 是否系统默认菜单（工作台/系统设置及其下级），不可删除 */
  is_system: boolean;
  created_at: string;
}

/** 流程条件分支：单条比较规则 */
export interface WfCondRule {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains' | 'empty' | 'not_empty';
  value: string;
}

/** 流程条件分支：条件组（组内 AND/OR 组合） */
export interface WfCondGroup {
  logic: 'and' | 'or';
  rules: WfCondRule[];
}

/** 流程条件分支：多分支结构（首个条件全满足的分支生效，均不满足走第一分支） */
export interface WfBranch {
  id: string;
  name: string;
  /** 分支条件组（组间全部满足才走该分支） */
  conditions: WfCondGroup[];
  /** 分支内节点（审批/填写/抄送） */
  nodes: WfNode[];
}

/** 流程节点 */
export interface WfNode {
  id: string;
  type: 'start' | 'approval' | 'fill' | 'condition' | 'parallel' | 'cc' | 'end';
  name: string;
  /** 审批人类型（approval 节点） */
  approver_type?: 'user' | 'role' | 'dept_leader' | 'initiator_choice' | 'multi_level_leader' | 'initiator';
  /** 审批人/角色 ID 列表 */
  approver_value?: string[];
  /** 审批模式 */
  mode?: 'countersign' | 'or' | 'sequential';
  /** 条件分支（新版多分支结构） */
  branches?: WfBranch[];
  /** 旧版条件规则（读取时迁移为 branches[0]） */
  conditions?: { logic: 'and' | 'or'; rules: RuleItem[] }[];
  /** 填写节点：确认内容（可编辑字段 key 列表） */
  confirmFields?: string[];
  /** 填写节点：守卫条件（与状态机守卫一致，提交时逐条评估，AND 关系，全部满足才能流转下一节点） */
  guards?: RuleItem[];
  /** 抄送人 */
  cc_users?: string[];
  /** 字段权限：字段 key -> 权限 */
  fieldPermissions?: Record<string, FieldPermission>;
  /** 节点操作配置 */
  operations?: {
    approve: boolean;
    reject: boolean;
    /** 驳回目标：发起人 / 上一节点 */
    rejectTo?: 'initiator' | 'prev';
  };
}

export interface FlowSettings {
  /** 流程分类 */
  category?: string;
  /** 流程说明 */
  description?: string;
  /** 发起人范围（旧文本字段，保留兼容） */
  initiatorScope?: string;
  /** 允许发起人：先选类型（按人员/按部门/按角色）再选名单，为空表示全员 */
  initiatorConfig?: InitiatorConfig;
  /** 旧版发起人（人员/部门/角色并列，读取时迁移为 initiatorConfig） */
  initiators?: PrincipalGroup;
  /** 节点超时时限（小时） */
  timeoutHours?: number;
  /** 超时处理策略 */
  timeoutAction?: 'remind' | 'escalate' | 'autoApprove';
  /** 抄送规则（旧文本字段，保留兼容） */
  ccRule?: string;
  /** 归档抄送（人员/部门/角色） */
  archiveCc?: PrincipalGroup;
  /** 流程实例名规则 */
  instanceNameRule?: string;
}

export interface MetaWorkflow {
  id: string;
  tenant_id: string;
  form_id: string;
  name: string;
  nodes: WfNode[];
  transitions: unknown[];
  version: number;
  settings: FlowSettings;
  updated_at: string;
}

/** 状态机 */
export interface SmState {
  id: string;
  key: string;
  label: string;
  color?: string;
  initial?: boolean;
}

export interface SmTransition {
  id: string;
  from: string;
  to: string;
  event: string;
  label?: string;
  /** 守卫条件（如金额>10000） */
  guards?: RuleItem[];
  /** 转换动作 */
  actions?: string[];
  /** 人员分配动作：转换成功后自动写入 assignee 并生成待办通知 */
  assignAction?: { type: 'manual' | 'rule' | 'role_pool'; userId?: string; value?: string };
  /** 流转交互方式：列表按钮触发该转换时的运行时交互（未配置视为无交互直接流转） */
  interaction?: SmInteraction;
}

/** 流转交互方式类型：无交互 / 人员分配 / 内容提交 / 内容确定 / 新增关联表单 */
export type SmInteractionType = 'none' | 'assign' | 'submit' | 'confirm' | 'new_related_form';

/** 流转交互配置 */
export interface SmInteraction {
  /** none：无交互直接流转（可配二次确认 confirm + 提示内容 message） */
  type: SmInteractionType;
  /** 人员分配维度（type=assign 时必填） */
  assignBy?: 'dept' | 'role';
  /** 无交互/内容确定：是否开启二次确认弹窗（默认 false，无交互时直接流转） */
  confirm?: boolean;
  /** 二次确认提示内容（为空时按默认文案展示） */
  message?: string;
  /** 内容提交/内容确定需填写或核验的表单字段 key 列表 */
  fields?: string[];
  /** 新增关联表单（type=new_related_form）：点击按钮弹出目标表单新建框，创建后回填关联 ID 并按映射赋值主表字段，随后流转
   *  支持关联多个表单：一次弹窗内依次填写多张目标表单，全部创建成功后统一回填/赋值并流转 */
  newRelated?: {
    /** 单表单模式（历史数据）：单个目标表单 */
    targetFormId?: string;
    /** 多表单模式：目标表单 id 列表 */
    targetFormIds?: string[];
    backfillField?: string;
    /** 回填字段集合：formId → 回填字段 key（多表单时每个表单独立回填） */
    backfillFields?: Record<string, string>;
    /** 显示字段集合：formId → 详情页关联子列表列 key 列表（用于回填 form-ref 字段的关联展示） */
    displayFieldsMap?: Record<string, string[]>;
    displayFields?: string[];
    fieldMappings?: Array<{ mainKey: string; targetKey: string }>;
  };
}

export interface MetaStateMachine {
  id: string;
  tenant_id: string;
  form_id: string;
  states: SmState[];
  transitions: SmTransition[];
  updated_at: string;
}

export interface MetaVersion {
  id: string;
  tenant_id: string;
  form_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  changelog: string | null;
  created_by: string | null;
  created_at: string;
}

// ============ 动作引擎 ============

/** 操作项位置：列表工具栏 / 行操作 / 批量操作 / 表单顶部 / 表单底部 / 字段旁 */
export type ActionPosition = 'toolbar' | 'row' | 'batch' | 'form-top' | 'form-bottom' | 'field';

/** 按钮样式 */
export type ActionVariant = 'primary' | 'secondary' | 'danger' | 'link';

/** 动作类型（9 类） */
export type ActionType =
  | 'CREATE' | 'VIEW' | 'EDIT' | 'DELETE' | 'COPY'
  | 'SELECT_RELATED' | 'VIEW_RELATED' | 'UNLINK_RELATED' | 'NEW_RELATED' | 'GOTO_RELATED'
  | 'CHANGE_STATUS' | 'SM_TRANSITION'
  | 'START_WORKFLOW' | 'APPROVE' | 'REJECT' | 'WITHDRAW' | 'TRANSFER' | 'ADD_SIGNER' | 'FILL_NODE'
  | 'TRANSFER_OWNER' | 'ASSIGN_OWNER' | 'REMARK'
  | 'NAVIGATE'
  | 'UPDATE_DATA'
  | 'EXPORT' | 'IMPORT' | 'PRINT'
  | 'CALL_API'
  | 'COMPOSITE'
  | 'REF_ASSIGN';

/** JSONLogic 简化条件表达式 */
export type LogicExpr = Record<string, unknown>;

/** 动作配置（按 action_type 取用不同字段） */
export interface ActionConfig {
  /** 目标表单（关联/跳转） */
  targetFormId?: string;
  /** 关联定义 ID */
  relationId?: string;
  /** 状态机事件与目标状态 */
  stateMachineEvent?: string;
  targetStatus?: string;
  /** 状态流转动作（SM_TRANSITION）绑定的状态机转换 ID */
  transitionId?: string;
  /** 字段映射（状态变更后置写入） */
  fieldMappings?: Record<string, string>;
  /** 跳转配置 */
  targetType?: 'form-list' | 'form-detail' | 'url' | 'form-create';
  url?: string;
  openMode?: 'current' | 'new-window';
  paramMapping?: Record<string, string>;
  /** 数据更新：字段 -> 值表达式 */
  updates?: Record<string, string>;
  /** 接口调用 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  bodyMapping?: Record<string, string>;
  /** 组合动作 */
  steps?: ActionDef[];
  onFailure?: 'abort' | 'continue';
  /** 复制模板 */
  copyTitleSuffix?: string;
  /** 绑定的打印与导出模板 ID（PRINT/EXPORT 动作生效） */
  templateId?: string;
}

/** 操作项/按钮定义（meta_actions 表） */
export interface ActionDef {
  id: string;
  tenant_id: string;
  form_id: string;
  position: ActionPosition;
  name: string;
  icon: string;
  variant: ActionVariant;
  action_type: ActionType;
  config: ActionConfig;
  show_condition?: LogicExpr | null;
  enable_condition?: LogicExpr | null;
  permission_code?: string | null;
  confirm_text?: string | null;
  success_text?: string | null;
  after_behavior: 'refresh' | 'close' | 'navigate' | 'back' | 'none';
  sort: number;
  version: number;
  created_at: string;
  updated_at: string;
}

/** 表单设计器内按钮组件的轻量配置（存在 schema_json.fields[].button） */
export interface FormButton {
  /** 动作类型 */
  actionType: ActionType;
  /** 跳转/接口等配置（与 ActionConfig 同构，按需取用） */
  targetUrl?: string;
  targetFormId?: string;
  stateMachineEvent?: string;
  targetStatus?: string;
  updates?: Record<string, string>;
  /** 提交类按钮：提交 / 暂存 / 提交并审批 / 保存并新建 */
  submitMode?: 'submit' | 'draft' | 'submit-and-approve' | 'save-and-new';
  /** 系统提交按钮（不可删除的默认按钮） */
  builtin?: boolean;
  /** 关联表单赋值（actionType='REF_ASSIGN'）：点击弹出目标表单数据列表，选中后按映射把目标字段值写入当前表单字段 */
  refAssign?: {
    formId: string;
    mappings: Array<{ fromKey: string; toKey: string }>;
  };
}

/**
 * 选项联动赋值规则：当选项字段取某值时，将 value 写入目标字段。
 * - whenValue：触发值（radio/select 单值；checkbox/multi-select 为数组包含判断）
 * - targetKey：被赋值的目标字段 key
 * - value：写入目标字段的值
 */
export interface ValueAssignRule {
  id: string;
  whenValue: string;
  targetKey: string;
  value: string;
}

/** 关联表定义（meta_relations 表） */
export interface MetaRelation {
  id: string;
  tenant_id: string;
  source_form_id: string;
  target_form_id: string;
  name: string;
  relation_type: 'one_to_many' | 'many_to_many' | 'belong';
  /** 选择关联后回填到源记录 payload 的字段名 */
  backfill_field: string;
  display_fields: string[];
  multiple: boolean;
  /** 主表字段赋值映射：关联/新增关联后，取首条关联记录的 targetKey 字段值写入主表 mainKey 字段（被赋值字段在编辑页只读） */
  field_mappings?: Array<{ mainKey: string; targetKey: string }>;
  created_at: string;
}

/** 动作执行日志（meta_action_logs 表） */
export interface ActionLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  user_name: string | null;
  form_id: string | null;
  biz_id: string | null;
  action_name: string;
  action_type: string;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

// ============ 业务运行时 ============

export interface BizData {
  id: string;
  tenant_id: string;
  form_id: string;
  status: string;
  title: string | null;
  amount: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by?: string | null;
  /** 当前处理人（状态机人员分配动作写入） */
  assignee_id?: string | null;
  assignee_name?: string | null;
  payload: Record<string, unknown>;
  meta_version: number;
  /** 软删除标记：false 正常，true 已删除 */
  is_deleted: boolean;
}

export interface ApprovalAct {
  user_id: string;
  user_name: string;
  action: 'approve' | 'reject' | 'fill';
  comment: string;
  at: string;
  /** 审批通过时修改的可编辑字段变更记录（label/from/to） */
  changes?: { label: string; from: string; to: string }[];
}

export interface BizApproval {
  id: string;
  tenant_id: string;
  biz_id: string;
  form_id: string;
  node_name: string;
  approver_type: string;
  approvers: string[];
  mode: 'countersign' | 'or' | 'sequential';
  state: 'pending' | 'approved' | 'rejected' | 'skipped';
  acts: ApprovalAct[];
  current: boolean;
  /** 对应流程节点 id（旧数据可能为空） */
  node_id?: string | null;
  /** 节点类型：approval 审批 / fill 填写 */
  node_type?: 'approval' | 'fill' | string | null;
  /** 填写节点：确认内容字段 key 列表 */
  confirm_fields?: string[] | null;
  /** 节点字段权限：字段 key → visible/editable/hidden，用于填写弹框按只读/可编辑渲染需确定内容 */
  field_perms?: Record<string, string> | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  category: 'notice' | 'update' | 'guide';
  publisher: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  body: string | null;
  type: 'todo' | 'info' | 'system';
  read: boolean;
  biz_id: string | null;
  createad_at?: string;
  created_at?: string;
}

export interface AnnualLeaveRule {
  min_years: number;
  max_years: number;
  days: number;
}

export interface AiModelConfig {
  enabled?: boolean;
  provider: 'qwen' | 'deepseek' | 'zhipu' | 'minimax' | 'moonshot' | 'baichuan' | 'doubao' | 'wenxin' | 'custom';
  provider_name?: string;
  api_key: string;
  base_url: string;
  model: string;
  temperature?: number;
}

export interface SysSettings {
  tenant_id: string;
  system_name: string;
  logo_url: string | null;
  login_bg_url: string | null;
  login_welcome: string;
  theme_color: string;
  notify_config: { sms: boolean; email: boolean; inapp: boolean };
  backup_config: { auto: boolean; frequency: 'daily' | 'weekly' | 'monthly' };
  annual_leave_rules: AnnualLeaveRule[];
  annual_leave_expire: string;
  ai_model_config?: AiModelConfig;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_preview: string;
  key_hash: string;
  last_used_at: string | null;
  created_at: string;
}
