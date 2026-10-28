# 数据库表结构说明

> 本文档描述「云枢低代码管理系统」Supabase 数据库 `public` schema 下全部业务表的结构，包含字段定义、主外键、索引与设计说明。所有业务表均以 `id`（uuid）为主键，并统一携带 `tenant_id`（uuid）用于多租户隔离。

---

## 目录

| 分类 | 表名 | 说明 |
| --- | --- | --- |
| 租户与系统 | [tenants](#tenants) | 租户 |
| | [sys_settings](#sys_settings) | 系统设置 |
| | [announcements](#announcements) | 公告 |
| 用户与权限 | [profiles](#profiles) | 用户档案 |
| | [roles](#roles) | 角色 |
| | [user_roles](#user_roles) | 用户-角色关联 |
| | [departments](#departments) | 部门 |
| | [api_keys](#api_keys) | API 密钥 |
| | [audit_logs](#audit_logs) | 审计日志 |
| | [notifications](#notifications) | 通知 |
| 表单元数据 | [meta_forms](#meta_forms) | 表单定义 |
| | [meta_version](#meta_version) | 表单版本快照 |
| | [meta_menu](#meta_menu) | 菜单 |
| | [meta_actions](#meta_actions) | 表单按钮动作 |
| | [meta_action_logs](#meta_action_logs) | 动作执行日志 |
| | [meta_relations](#meta_relations) | 表单关联关系 |
| | [meta_workflow](#meta_workflow) | 工作流 |
| | [meta_state_machine](#meta_state_machine) | 状态机 |
| | [serial_number_counters](#serial_number_counters) | 自动编号计数器 |
| 业务数据 | [biz_data](#biz_data) | 业务数据 |
| | [biz_approval](#biz_approval) | 审批记录 |

---

## 通用约定

- **主键**：除 `sys_settings` 外，所有表均以 `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` 为主键。
- **租户隔离**：除 `sys_settings` 外，所有表均包含 `tenant_id uuid NOT NULL`，用于多租户数据隔离。
- **时间字段**：`created_at` / `updated_at` 均为 `timestamptz`，默认 `now()`。
- **JSONB 字段**：用于存储灵活的结构化配置（表单 schema、权限规则、工作流节点等），默认值通常为 `'{}'::jsonb` 或 `'[]'::jsonb`。
- **审计字段**：业务数据表（如 `biz_data`）包含 `created_by` / `updated_by`（uuid，默认 `uid()` 即当前登录用户）。

---

## 租户与系统

### tenants

租户表，多租户体系的顶层组织。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| name | text | NO | - | 租户名称（唯一） |
| subdomain | text | YES | - | 子域名（唯一） |
| plan | text | NO | 'free' | 套餐：free / pro / enterprise |
| created_at | timestamptz | NO | now() | 创建时间 |

**约束**：`name` 唯一；`subdomain` 唯一。

---

### sys_settings

系统设置表，按租户维度存储全局配置。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| tenant_id | uuid | NO | - | **主键**，关联 tenants |
| system_name | text | NO | '云枢低代码' | 系统名称 |
| logo_url | text | YES | - | Logo 地址 |
| login_bg_url | text | YES | - | 登录页背景图 |
| login_welcome | text | YES | '欢迎使用低代码管理系统' | 登录欢迎语 |
| theme_color | text | NO | '#D54200' | 主题色 |
| notify_config | jsonb | NO | {"sms": false, "email": false, "inapp": true} | 通知开关配置 |
| backup_config | jsonb | NO | {"auto": false, "frequency": "weekly"} | 备份配置 |
| updated_at | timestamptz | NO | now() | 更新时间 |

**约束**：`tenant_id` 为主键（一租户一行设置）。

---

### announcements

公告表。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| title | text | NO | - | 标题 |
| content | text | NO | - | 正文 |
| category | text | NO | 'notice' | 分类：notice / system / activity |
| publisher | text | YES | - | 发布人 |
| created_at | timestamptz | NO | now() | 创建时间 |

---

## 用户与权限

### profiles

用户档案表，`id` 与 Supabase Auth 的 `auth.users.id` 对应。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | uid() | 主键，对应 auth.users |
| tenant_id | uuid | NO | - | 租户 |
| name | text | NO | - | 姓名 |
| phone | text | YES | - | 手机号 |
| employee_no | text | YES | - | 工号 |
| email | text | YES | - | 邮箱 |
| department_id | uuid | YES | - | 所属部门，关联 departments |
| position | text | YES | - | 职位 |
| status | text | NO | 'active' | 状态：active / disabled |
| is_superadmin | boolean | NO | false | 是否超管 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |

---

### roles

角色表，承载菜单权限、按钮权限、行列级数据权限规则。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| name | text | NO | - | 角色名称 |
| description | text | YES | - | 描述 |
| status | text | NO | 'enabled' | 状态：enabled / disabled |
| data_scope | text | NO | 'self' | 数据范围：self / department / all |
| menu_perms | jsonb | NO | [] | 菜单权限码列表 |
| button_perms | jsonb | NO | [] | 按钮权限码列表 |
| row_rules | jsonb | NO | [] | 行级数据权限规则 |
| col_rules | jsonb | NO | [] | 列级数据权限规则 |
| created_at | timestamptz | NO | now() | 创建时间 |

---

### user_roles

用户-角色关联表（多对多）。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| user_id | uuid | NO | - | 关联 profiles |
| role_id | uuid | NO | - | 关联 roles |
| created_at | timestamptz | NO | now() | 创建时间 |

**约束**：`user_id` 唯一；`role_id` 唯一（即一个用户仅绑定一个角色）。

---

### departments

部门表，支持树形层级。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| name | text | NO | - | 部门名称 |
| parent_id | uuid | YES | - | 父部门，关联自身 |
| sort_order | integer | NO | 0 | 排序 |
| leader_id | uuid | YES | - | 部门负责人，关联 profiles |
| created_at | timestamptz | NO | now() | 创建时间 |

---

### api_keys

API 密钥表，存储对外接口的密钥（仅存哈希与预览）。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| name | text | NO | - | 密钥名称 |
| key_preview | text | NO | - | 密钥预览（前缀） |
| key_hash | text | NO | - | 密钥哈希 |
| last_used_at | timestamptz | YES | - | 最后使用时间 |
| created_at | timestamptz | NO | now() | 创建时间 |

---

### audit_logs

审计日志表，记录关键操作。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| user_id | uuid | YES | - | 操作人 |
| user_name | text | YES | - | 操作人姓名 |
| action | text | NO | - | 操作类型 |
| target | text | YES | - | 操作对象 |
| detail | jsonb | NO | {} | 操作详情 |
| created_at | timestamptz | NO | now() | 创建时间 |

---

### notifications

站内通知表。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| user_id | uuid | NO | - | 接收人 |
| title | text | NO | - | 标题 |
| body | text | YES | - | 正文 |
| type | text | NO | 'todo' | 类型：todo / system / approval |
| read | boolean | NO | false | 是否已读 |
| biz_id | uuid | YES | - | 关联业务数据 |
| created_at | timestamptz | NO | now() | 创建时间 |

---

## 表单元数据

### meta_forms

表单定义表，是低代码引擎的核心元数据。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| name | text | NO | - | 表单名称 |
| code | text | NO | - | 表单编码（唯一） |
| icon | text | YES | - | 图标 |
| version | integer | NO | 1 | 当前版本号 |
| published_version | integer | NO | 0 | 已发布版本号 |
| status | text | NO | 'draft' | 状态：draft / published |
| schema_json | jsonb | NO | {} | 表单 schema（字段定义、布局、校验等） |
| list_config | jsonb | NO | {} | 列表配置（列、筛选项、分页等） |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |

**约束**：`code` 唯一；`tenant_id` 唯一（一租户一表单行，通过 version 区分版本）。

---

### meta_version

表单版本快照表，保存每次发布的历史版本。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| form_id | uuid | NO | - | 关联 meta_forms |
| version | integer | NO | - | 版本号 |
| snapshot | jsonb | NO | {} | 该版本的完整 schema 快照 |
| changelog | text | YES | - | 变更说明 |
| created_by | uuid | YES | - | 发布人 |
| created_at | timestamptz | NO | now() | 创建时间 |

---

### meta_menu

菜单表，支持树形层级与角色可见性。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| parent_id | uuid | YES | - | 父菜单 |
| name | text | NO | - | 菜单名称 |
| path | text | YES | - | 路由路径 |
| icon | text | NO | 'layout' | 图标 |
| sort_order | integer | NO | 0 | 排序 |
| menu_type | text | NO | 'form' | 类型：form / group / link |
| form_id | uuid | YES | - | 关联 meta_forms |
| visible_roles | jsonb | NO | [] | 可见角色 id 列表 |
| status | text | NO | 'draft' | 状态：draft / published |
| created_at | timestamptz | NO | now() | 创建时间 |

---

### meta_actions

表单按钮动作表，定义列表/详情页的自定义按钮。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| form_id | uuid | NO | - | 关联 meta_forms |
| position | text | NO | - | 位置：list / detail |
| name | text | NO | - | 按钮名称 |
| icon | text | NO | 'mouse-pointer-click' | 图标 |
| variant | text | NO | 'secondary' | 样式：primary / secondary / destructive |
| action_type | text | NO | - | 动作类型 |
| config | jsonb | NO | {} | 动作配置 |
| show_condition | jsonb | YES | - | 显示条件 |
| enable_condition | jsonb | YES | - | 启用条件 |
| permission_code | text | YES | - | 权限码 |
| confirm_text | text | YES | - | 确认提示 |
| success_text | text | YES | - | 成功提示 |
| after_behavior | text | NO | 'refresh' | 执行后行为：refresh / close / navigate |
| sort | integer | NO | 0 | 排序 |
| version | integer | NO | 1 | 版本 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |

---

### meta_action_logs

动作执行日志表。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| user_id | uuid | YES | - | 执行人 |
| user_name | text | YES | - | 执行人姓名 |
| form_id | uuid | YES | - | 关联 meta_forms |
| biz_id | uuid | YES | - | 关联 biz_data |
| action_name | text | NO | - | 动作名称 |
| action_type | text | NO | - | 动作类型 |
| params | jsonb | NO | {} | 执行参数 |
| result | jsonb | YES | - | 执行结果 |
| error | text | YES | - | 错误信息 |
| duration_ms | integer | YES | - | 耗时（毫秒） |
| created_at | timestamptz | NO | now() | 创建时间 |

---

### meta_relations

表单关联关系表，定义表单间的多对多/一对多关系。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| source_form_id | uuid | NO | - | 源表单，关联 meta_forms |
| target_form_id | uuid | NO | - | 目标表单，关联 meta_forms |
| name | text | NO | - | 关系名称 |
| relation_type | text | NO | 'many_to_many' | 关系类型：one_to_many / many_to_many |
| backfill_field | text | NO | - | 回填字段 |
| display_fields | jsonb | NO | [] | 关联展示字段列表 |
| multiple | boolean | NO | true | 是否多选 |
| created_at | timestamptz | NO | now() | 创建时间 |

---

### meta_workflow

工作流表，存储审批/流程节点与流转规则。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| form_id | uuid | NO | - | 关联 meta_forms |
| name | text | NO | - | 工作流名称 |
| nodes | jsonb | NO | [] | 节点列表 |
| transitions | jsonb | NO | [] | 流转规则列表 |
| version | integer | NO | 1 | 版本 |
| updated_at | timestamptz | NO | now() | 更新时间 |

---

### meta_state_machine

状态机表，定义表单数据的状态与流转。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| form_id | uuid | NO | - | 关联 meta_forms |
| states | jsonb | NO | [] | 状态列表 |
| transitions | jsonb | NO | [] | 状态流转列表 |
| updated_at | timestamptz | NO | now() | 更新时间 |

---

### serial_number_counters

自动编号计数器表，为表单字段生成流水号。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| form_id | uuid | NO | - | 关联 meta_forms |
| field_key | text | NO | - | 字段标识 |
| cycle_key | text | NO | '' | 周期键（如按年/月重置） |
| current_value | bigint | NO | 0 | 当前计数值 |
| updated_at | timestamptz | NO | now() | 更新时间 |

**约束**：`tenant_id` + `form_id` + `field_key` + `cycle_key` 组合唯一（计数器按周期隔离）。

---

## 业务数据

### biz_data

业务数据表，存储所有表单提交的实际数据。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| form_id | uuid | NO | - | 关联 meta_forms |
| status | text | NO | 'draft' | 状态：draft / submitted / approved / rejected |
| title | text | YES | - | 标题 |
| amount | numeric | YES | - | 金额（用于统计） |
| created_by | uuid | NO | uid() | 创建人 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |
| payload | jsonb | NO | {} | **业务字段数据**（动态表单字段键值对） |
| meta_version | integer | NO | 1 | 创建时的表单元数据版本 |
| updated_by | uuid | YES | uid() | 最后更新人 |

**说明**：`payload` 是核心字段，以 JSONB 存储动态表单的所有自定义字段值；`meta_version` 记录数据创建时对应的表单 schema 版本，用于版本兼容。

---

### biz_approval

审批记录表，记录每条业务数据的审批节点与状态。

| 字段 | 类型 | 可空 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() | 主键 |
| tenant_id | uuid | NO | - | 租户 |
| biz_id | uuid | NO | - | 关联 biz_data |
| form_id | uuid | NO | - | 关联 meta_forms |
| node_name | text | NO | - | 审批节点名称 |
| approver_type | text | NO | 'user' | 审批人类型：user / role / dept |
| approvers | jsonb | NO | [] | 审批人列表 |
| mode | text | NO | 'or' | 审批模式：or（或签）/ and（会签） |
| state | text | NO | 'pending' | 状态：pending / approved / rejected |
| acts | jsonb | NO | [] | 审批操作记录 |
| current | boolean | NO | false | 是否当前待办节点 |
| created_at | timestamptz | NO | now() | 创建时间 |

---

## 关键关系说明

```
tenants (1) ──── (N) profiles
tenants (1) ──── (N) roles
tenants (1) ──── (N) departments
tenants (1) ──── (N) meta_forms

profiles (N) ──── (N) roles          [通过 user_roles]
profiles (N) ──── (1) departments    [department_id]
departments ──── departments         [parent_id 自关联，树形]

meta_forms (1) ──── (N) biz_data     [form_id]
meta_forms (1) ──── (N) meta_version [form_id]
meta_forms (1) ──── (N) meta_actions [form_id]
meta_forms (1) ──── (N) meta_workflow
meta_forms (1) ──── (N) meta_state_machine
meta_forms (1) ──── (N) serial_number_counters

meta_forms (N) ──── (N) meta_forms   [通过 meta_relations: source/target]

biz_data (1) ──── (N) biz_approval   [biz_id]
biz_data (1) ──── (N) notifications  [biz_id]
```

## 安全策略（RLS）

所有表均启用行级安全（Row Level Security），通过 `tenant_id` 与当前用户的租户上下文进行数据隔离；业务数据表额外结合角色的 `data_scope`（self/department/all）与 `row_rules` 实现行级权限控制。写操作通过 `SECURITY DEFINER` 的辅助函数在服务端安全执行。