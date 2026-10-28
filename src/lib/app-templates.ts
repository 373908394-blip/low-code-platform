/**
 * 应用市场组件元信息（仅展示用）
 * 实际安装数据由 install_app_template Edge Function 从蓝本租户（演示企业）实时深拷贝，
 * 此处仅维护市场卡片与安装向导所需的展示信息，两处 id 必须与 Edge Function 内组件定义一致。
 */

export interface TemplateFormMeta {
  name: string;
  icon: string;
  /** approval=含审批流 state=含状态机 normal=普通表单 page=页面应用 */
  mode: 'approval' | 'state' | 'normal' | 'page';
  fields: number;
}

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  forms: TemplateFormMeta[];
}

export const TEMPLATE_CATEGORIES = ['全部', '客户管理', '协同办公'];

export const APP_TEMPLATES: AppTemplate[] = [
  {
    id: 'crm_customer',
    name: 'CRM客户管理',
    category: '客户管理',
    icon: 'building-2',
    description: '客户全生命周期管理：仪表盘、客户档案、销售线索、销售机会、合同、产品与销售明细',
    forms: [
      { name: '仪表盘', icon: 'layout-dashboard', mode: 'page', fields: 8 },
      { name: '客户管理', icon: 'boxes', mode: 'normal', fields: 17 },
      { name: '销售线索', icon: 'boxes', mode: 'state', fields: 19 },
      { name: '销售机会', icon: 'boxes', mode: 'state', fields: 18 },
      { name: '合同管理', icon: 'boxes', mode: 'state', fields: 25 },
      { name: '产品管理', icon: 'boxes', mode: 'normal', fields: 16 },
      { name: '销售产品明细', icon: 'boxes', mode: 'normal', fields: 17 },
    ],
  },
  {
    id: 'cooperative_oa',
    name: '协同办公',
    category: '协同办公',
    icon: 'briefcase',
    description: '假勤、周报、报销、借款、出差五大审批闭环，含周报/报销子表与打款、还款联动表单，开箱即用',
    forms: [
      { name: '假勤管理', icon: 'boxes', mode: 'approval', fields: 17 },
      { name: '我的年假', icon: 'boxes', mode: 'page', fields: 8 },
      { name: '周报管理', icon: 'boxes', mode: 'approval', fields: 15 },
      { name: '本周总结', icon: 'boxes', mode: 'normal', fields: 13 },
      { name: '下周计划', icon: 'boxes', mode: 'normal', fields: 13 },
      { name: '出差管理', icon: 'boxes', mode: 'approval', fields: 21 },
      { name: '借款管理', icon: 'boxes', mode: 'approval', fields: 22 },
      { name: '报销管理', icon: 'boxes', mode: 'approval', fields: 18 },
      { name: '报销明细单', icon: 'boxes', mode: 'normal', fields: 12 },
      { name: '打款记录', icon: 'boxes', mode: 'normal', fields: 10 },
      { name: '还款记录', icon: 'boxes', mode: 'normal', fields: 11 },
    ],
  },
];
