---
# ── 以下 3 项模型手写 ──
name: 瑞士数据白
source_draft: 1
fonts:
  heading: "HarmonyOSSans"
  body: "IBMPlexSans"

# ── 以下整块 = apply_design_tokens.py --emit-designmd-tokens 的 stdout，原样粘贴，禁手抄 ──
tokens:
  radius: "0.5rem"
  background: "45 100% 99%"
  foreground: "0 21% 10%"
  card: "0 0% 100%"
  card-foreground: "0 21% 10%"
  primary: "19 100% 42%"
  primary-foreground: "0 0% 0%"
  secondary: "15 100% 46%"
  secondary-foreground: "45 100% 99%"
  muted: "45 33% 96%"
  muted-foreground: "215 16% 40%"
  accent: "222 47% 31%"
  accent-foreground: "45 100% 99%"
  destructive: "0 72% 45%"
  destructive-foreground: "45 100% 99%"
  border: "45 12% 88%"
  input: "45 12% 88%"
  ring: "19 100% 50%"
  popover: "45 100% 99%"
  popover-foreground: "0 21% 10%"
custom_tokens:
  font-ui: '"IBMPlexSans", "HarmonyOSSans", "PingFang SC", "Microsoft YaHei", sans-serif'
  sig-running: "19 100% 42%"
  sig-passed: "222 47% 31%"
  sig-rejected: "0 72% 42%"
  sig-draft: "215 12% 60%"
section_blueprint:
  workbench: "px-4 md:px-8 pt-7 pb-6 border-b border-border"
  kpi-band: "px-4 md:px-8 py-8 border-b border-border"
  overview: "px-4 md:px-8 py-6 grid grid-cols-1 md:grid-cols-3 gap-6"
  my-applications: "px-4 md:px-8 pb-10 grid grid-cols-1 md:grid-cols-3 gap-6"
---

## Overview
瑞士极简数据工作台：面向低代码管理平台的高密度清单骨架（dense-index）。视觉重心是 4 联超大等宽 KPI 数字带（clamp 3rem–4.5rem、tabular-nums），配发丝线 1px 网格分区。记忆点三件套：KPI 等宽数字带、发丝线网格、状态色点双编码（色点 + 文字，不单靠颜色传达状态）。整体气质是"油墨级饱和的赭橙打在纸感暖白上"——像瑞士报表的秩序感，而非 SaaS 后台的灰蓝套路。主色 #D54200 赭橙（hsl 19 100% 42%）承担全部行动与强调；藏青 #293F73（accent）承担图表与次级信息，形成橙蓝互补的数据叙事。

## Colors
- 60% 表面：background（暖白纸感）/ card（纯白）/ muted（暖灰白）——大面积铺底，克制。
- 30% 内容：foreground（暖黑）/ muted-foreground（中灰蓝）/ border（暖灰发丝线）。
- 10% 强调：primary 赭橙（CTA、激活态、链接、KPI 首数字）+ accent 藏青（图表、头像、次级数据）。每屏仅一处 bg-primary 主按钮。
- 状态色双编码（sig-* 自定义 token）：running=主橙 19 100% 42%、passed=藏青 222 47% 31%、rejected=红 0 72% 42%、draft=灰 215 12% 60%。状态一律"色点+文字"双通道，禁纯色区分。
- primary-foreground 为黑（0 0% 0%），因 AA 对比度锁定；主橙底上配黑字。
- 暗色策略：本期不启用暗色模式（Dashboard 场景锁定纸感白）。

## Typography
- 字体栈：IBMPlexSans（西文/数字，400/600/700）+ HarmonyOSSans（中文，400/500/700/900）+ 系统兜底，@font-face 全部走 BOS CDN（resource-static.bj.bcebos.com/fonts-skill/）。
- 等宽数字系统：`.sig-num`（font-variant-numeric: tabular-nums slashed-zero）用于 KPI、表格编号、金额、日期——数字对齐是本设计的工艺基石。
- 字阶（5 级内）：KPI 超大字 clamp(3rem,4.5vw,4.5rem)/900、页面标题 2xl–3xl/700、区块标题 base/600、正文 sm–base、注释 xs。
- 行高：标题 tracking-tight，正文 1.5×。

## Layout
- 结构：顶栏（h-14，logo+全局搜索+通知+用户）+ 左侧栏（w-56，分组导航：基础模块/低代码设计/业务应用）+ 主区。
- 断点只用 md（≥768px）。移动端侧栏折叠为汉堡菜单 + Sheet。
- 主区节奏（自上而下）：问候行（pb-6 border-b）→ KPI 带（py-8，4 联 grid gap-px bg-border 发丝线网格）→ 中部 2/3 图表+表格 + 1/3 状态环+公告 → 底部我的申请 + 快捷入口。
- 间距节奏：区块间以 border-b 发丝线分隔，内边距 px-4 md:px-8，垂直 py-6–8。
- 表格规范：`overflow-x-auto` 包裹，`whitespace-nowrap` 单行单元格，hover 行揭示操作（`.sig-row-actions`），触屏常显。

## Components
- button-primary：bg-primary text-primary-foreground（黑字）rounded-md h-9 px-4 text-sm font-medium，hover:bg-secondary。
- button-outline：border border-border bg-card hover:bg-muted——次级操作。
- card：bg-card border border-border rounded-lg——所有信息容器，无阴影（发丝线就是层级）。
- kpi-cell：bg-card px-5 py-5，标签 text-xs muted-foreground + `.sig-kpi` `.sig-num` font-black 数字 + 尾注 text-xs；grid gap-px bg-border 形成共享发丝线。
- status-dot：`.sig-status`（data-status 属性驱动色点），审批/工单状态统一入口。
- table-row：hover:bg-muted/40 + `.sig-row-actions` opacity-0→1 揭示操作按钮。
- bar-chart：flex items-end 容器内 bg-primary/25 柱体（今日/峰值 bg-primary），SVG 环形图用 sig-ring-* 描边色。
- input：bg-muted rounded-md h-9 pl-9（带搜索图标）/ focus:ring-2 ring-ring/50 focus:bg-card。

## Do's and Don'ts
- 禁渐变文字、禁阴影卡片堆叠——层级靠 border 发丝线与留白。
- 禁纯色状态区分（无障碍）：状态必须色点+文字双编码。
- 禁页面级入场动效（Dashboard 场景锁定，动效强度 2/10）；只允许 hover/active 微过渡（150ms ease）。
- 每屏一处 bg-primary 主按钮；图表主色允许 bg-primary/25 透明度分层。
- 数字一律 `.sig-num` 等宽；禁用 emoji 于标题/导航/按钮。
- 移动端禁横向滚动（表格 overflow-x-auto 例外）；列级布局 col-span-full md:col-span-N。
