import {
  Boxes, LayoutDashboard, Home, LayoutGrid, Menu, BarChart3, PieChart, Activity,
  ShoppingCart, ClipboardList, ClipboardCheck, Briefcase, Banknote, Receipt,
  Calendar, CalendarDays, Clock, Users, User, UserCog, ShieldCheck, Settings2,
  Wrench, SlidersHorizontal, Truck, Package, Building2, FileText, Folder, Tag,
  Star, Heart, Zap, Globe, Mail, Bell, Database, Layers, Search, Send, Inbox,
  Archive, Bookmark, Award, Printer, Link2, Phone, Factory, Smartphone,
  type LucideIcon,
} from 'lucide-react';

/** 菜单图标注册表：菜单管理选择器与侧栏/顶栏渲染共用 */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  boxes: Boxes,
  layout: LayoutDashboard,
  home: Home,
  grid: LayoutGrid,
  menu: Menu,
  chart: BarChart3,
  pie: PieChart,
  activity: Activity,
  'shopping-cart': ShoppingCart,
  clipboard: ClipboardList,
  'clipboard-check': ClipboardCheck,
  briefcase: Briefcase,
  banknote: Banknote,
  receipt: Receipt,
  calendar: Calendar,
  'calendar-days': CalendarDays,
  clock: Clock,
  users: Users,
  user: User,
  'user-cog': UserCog,
  shield: ShieldCheck,
  settings: Settings2,
  wrench: Wrench,
  sliders: SlidersHorizontal,
  truck: Truck,
  package: Package,
  'building-2': Building2,
  'file-text': FileText,
  folder: Folder,
  tag: Tag,
  star: Star,
  heart: Heart,
  zap: Zap,
  globe: Globe,
  mail: Mail,
  bell: Bell,
  database: Database,
  layers: Layers,
  search: Search,
  send: Send,
  inbox: Inbox,
  archive: Archive,
  bookmark: Bookmark,
  award: Award,
  printer: Printer,
  link: Link2,
  phone: Phone,
  factory: Factory,
  smartphone: Smartphone,
};

/** 按图标键名取组件，未注册回退为网格图标 */
export function getIcon(name?: string | null): LucideIcon {
  return (name && ICON_REGISTRY[name]) || LayoutGrid;
}

/** 可选图标键名列表（菜单管理选择器用，常用在前） */
export const ICON_NAMES = [
  'layout', 'home', 'boxes', 'grid', 'menu', 'chart', 'pie', 'activity',
  'shopping-cart', 'clipboard', 'clipboard-check', 'briefcase', 'banknote', 'receipt',
  'calendar', 'calendar-days', 'clock', 'users', 'user', 'user-cog', 'shield',
  'settings', 'wrench', 'sliders', 'truck', 'package', 'building-2',
  'file-text', 'folder', 'tag', 'star', 'heart', 'zap', 'globe', 'mail',
  'bell', 'database', 'layers', 'search', 'send', 'inbox', 'archive',
  'bookmark', 'award', 'printer', 'link', 'phone', 'factory', 'smartphone',
];
