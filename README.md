# Low-code platform

可视化低代码开发平台 —— 通过拖拽配置表单、列表、流程与状态机，快速搭建企业级业务应用。

## 技术栈

- **前端框架**：React 18 + TypeScript + Vite
- **UI**：Tailwind CSS + shadcn/ui（Radix）+ Arco Design
- **路由**：React Router 7
- **后端 / 数据库**：Supabase（Postgres + Auth + Storage + RLS）
- **图表**：ECharts / Recharts
- **测试**：Vitest

## 功能概览

- 多租户：企业空间隔离，基于 `tenant_id` 的行级安全（RLS）
- 权限体系：角色、菜单权限、按钮权限、数据范围
- 表单设计器 / 列表设计器 / 流程设计器 / 状态机设计器
- 业务数据流转：提交、审批（会签/或签）、驳回、抄送、待办
- 动态菜单、通知中心、审计日志、API Key
- 文件存储：`logos`、`avatars`、`biz-media` 三个 Storage 桶

## 目录结构

```
├── src
│   ├── components       # 通用组件 / 布局 / shadcn-ui
│   ├── contexts         # Auth 等全局上下文
│   ├── db               # Supabase 客户端
│   ├── pages            # 页面（含 design 设计器）
│   ├── services         # 业务服务
│   ├── lib / hooks / types
│   ├── App.tsx / main.tsx / routes.tsx
├── supabase/migrations  # 数据库迁移（表结构、RPC、RLS、桶）
├── public               # 静态资源
└── .github/workflows    # CI：自动构建 + 发布
```

## 快速开始

### 1. 环境变量

复制 `.env.example` 为 `.env`，填入你的 Supabase 项目信息：

```bash
cp .env.example .env
```

```dotenv
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-publishable-or-anon-key>
VITE_APP_ID=low-code-platform
```

> `VITE_` 变量会打包进前端产物，属于公开信息，请勿放置 service_role 等敏感密钥。

### 2. 安装与运行

```bash
pnpm install      # 或 npm install
pnpm dev          # 本地开发 http://localhost:5173
pnpm build        # 生产构建到 dist/
pnpm preview      # 预览构建产物
```

## 数据库

项目使用 Supabase。表结构、RPC 函数、RLS 策略与存储桶定义见 `supabase/migrations`。

> **注意**：数据备份仅包含 `public` schema（表结构与业务数据），不包含 `auth.users`。
> 迁移后如需登录，请在 Supabase 控制台 **Authentication** 中创建用户，或通过注册页新注册管理员；
> 原 `profiles` 数据中的用户可用于对账，但需与 `auth.users` 中的账号 ID 对应。

## 自动构建与发布（GitHub Actions）

- **`.github/workflows/deploy.yml`**：推送到 `main` 自动构建并发布到 **GitHub Pages**。
  - 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
  - 如需自定义 Supabase 连接，在 **Settings → Secrets and variables → Actions → Variables** 配置
    `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（未配置时使用仓库内默认值）。
- **`.github/workflows/release.yml`**：推送 `v*` 标签自动构建并创建 **GitHub Release**（附带构建产物）。

## License

Private / Internal.
