import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/layouts/AppLayout';
import Login from '@/pages/Login';
import Workbench from '@/pages/Workbench';
import Notifications from '@/pages/Notifications';
import Users from '@/pages/Users';
import Roles from '@/pages/Roles';
import Settings from '@/pages/Settings';
import MenuDesign from '@/pages/design/MenuDesign';
import AppList from '@/pages/design/AppList';
import AppMarket from '@/pages/design/AppMarket';
import FormDesigner from '@/pages/design/FormDesigner';
import ListDesigner from '@/pages/design/ListDesigner';
import FlowDesigner from '@/pages/design/FlowDesigner';
import StateDesigner from '@/pages/design/StateDesigner';
import Designer from '@/pages/design/Designer';
import VersionManager from '@/pages/design/VersionManager';
import BizApp from '@/pages/BizApp';
import PageApp from '@/pages/PageApp';
import TodoApp from '@/pages/TodoApp';
import MyLeave from '@/pages/MyLeave';
import MyProfile from '@/pages/MyProfile';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. Has no effect when RouteGuard is not in use. */
  public?: boolean;
}

/** 获取可作为菜单绑定的系统页面选项（排除登录页、404、动态参数路由及隐藏路由） */
export function getSystemPages(): Pick<RouteConfig, 'name' | 'path'>[] {
  return routes
    .filter((r) => r.visible !== false && r.public !== true && !r.path.includes(':') && r.path !== '*')
    .map((r) => ({ name: r.name, path: r.path }));
}

/** 需要登录 + 应用布局（侧栏/顶栏）的页面包装 */
function withLayout(el: ReactNode) {
  return <AppLayout>{el}</AppLayout>;
}

export const routes: RouteConfig[] = [
  { name: '登录', path: '/login', element: <Login />, public: true },
  { name: '工作台', path: '/', element: withLayout(<Workbench />) },
  { name: '通知中心', path: '/notifications', element: withLayout(<Notifications />) },
  { name: '用户管理', path: '/users', element: withLayout(<Users />) },
  { name: '角色管理', path: '/roles', element: withLayout(<Roles />) },
  { name: '系统设置', path: '/settings', element: withLayout(<Settings />) },
  { name: '我的年假', path: '/my-leave', element: withLayout(<MyLeave />) },
  { name: '我的信息', path: '/my-profile', element: withLayout(<MyProfile />) },
  { name: '菜单管理', path: '/design/menus', element: withLayout(<MenuDesign />) },
  { name: '应用列表', path: '/design/apps', element: withLayout(<AppList />) },
  { name: '应用市场', path: '/design/market', element: withLayout(<AppMarket />) },
  { name: '设计器', path: '/design/:formId', element: withLayout(<Designer />) },
  { name: '版本管理', path: '/design/versions/:formId', element: withLayout(<VersionManager />) },
  { name: '业务应用', path: '/app/:formId/*', element: withLayout(<BizApp />) },
  { name: '单页应用', path: '/page/:formId', element: withLayout(<PageApp />) },
  { name: '审批待办', path: '/todo/:formId/:scope?', element: withLayout(<TodoApp />) },
  { name: '404', path: '*', element: <Navigate to="/" replace />, visible: false },
];
