# Hermes Web UI 架构开发指南

> 面向开发者的完整架构文档，涵盖项目结构、实现方式、核心引擎、扩展点。

---

## 目录

1. [项目总览](#1-项目总览)
2. [技术栈](#2-技术栈)
3. [目录结构](#3-目录结构)
4. [请求链路](#4-请求链路)
5. [前端架构](#5-前端架构)
6. [后端架构](#6-后端架构)
7. [核心引擎深度解析](#7-核心引擎深度解析)
8. [数据库设计](#8-数据库设计)
9. [桌面应用架构](#9-桌面应用架构)
10. [构建系统](#10-构建系统)
11. [扩展开发指南](#11-扩展开发指南)

---

## 1. 项目总览

Hermes Web UI 是一个 TypeScript Monorepo，提供三大交付形态：

| 形态 | 说明 |
|------|------|
| **Web 控制台** | Vue 3 SPA + Koa BFF 服务器，浏览器访问 |
| **Electron 桌面应用** | 内嵌 Web UI + 捆绑 Python/Node 运行时 |
| **npm CLI 包** | `npm install -g hermes-web-ui && hermes-web-ui start` |

核心功能：AI 对话、多模型管理、平台渠道接入、群聊、Coding Agent、文件管理、Web 终端、语音等。

---

## 2. 技术栈

| 层 | 技术 |
|----|------|
| **前端** | Vue 3 (Composition API) + TypeScript + Vite + Pinia + Vue Router + Naive UI + SCSS |
| **后端** | Koa 2 + TypeScript + Socket.IO + node-pty |
| **数据库** | SQLite（Node 22+ `node:sqlite`），WAL 模式 |
| **实时通信** | Socket.IO（聊天流式推送）、WebSocket（终端、Kanban） |
| **桌面** | Electron 42 + electron-builder + electron-updater |
| **测试** | Vitest（单元）、Playwright（E2E） |
| **国际化** | vue-i18n（10 种语言） |

---

## 3. 目录结构

```
hermes-web-ui/
├── packages/
│   ├── client/src/           # Vue 3 前端源码
│   │   ├── api/              #   HTTP + Socket.IO 客户端封装
│   │   │   └── hermes/       #   Hermes 业务 API（chat/files/group-chat...）
│   │   ├── assets/           #   静态资源（图片/GIF/字体）
│   │   ├── components/       #   可复用组件
│   │   │   ├── auth/         #   认证组件
│   │   │   ├── common/       #   通用组件
│   │   │   ├── hermes/       #   Hermes 业务组件
│   │   │   │   ├── chat/     #   聊天组件（MessageItem, ChatInput...）
│   │   │   │   ├── files/    #   文件管理组件
│   │   │   │   ├── group-chat/
│   │   │   │   ├── kanban/   #   看板组件
│   │   │   │   ├── settings/ #   设置面板组件
│   │   │   │   └── ...       #   models/profiles/skills/mcp/jobs
│   │   │   └── layout/       #   布局组件（侧边栏、标题栏、选择器）
│   │   ├── composables/      #   Vue Composables（主题/键盘/语音）
│   │   ├── constants/        #   常量定义
│   │   ├── i18n/             #   国际化（10 种语言）
│   │   │   └── locales/      #   各语言翻译文件
│   │   ├── router/           #   Vue Router 路由配置
│   │   ├── shared/           #   共享工具
│   │   ├── stores/           #   Pinia 状态管理
│   │   │   └── hermes/       #   业务 Store（chat/settings/group-chat...）
│   │   ├── styles/           #   全局样式
│   │   ├── types/            #   TypeScript 类型
│   │   ├── utils/            #   工具函数
│   │   └── views/            #   路由级页面组件
│   │       └── hermes/       #   23 个业务页面
│   │
│   ├── server/src/           # Koa 后端源码
│   │   ├── controllers/      #   控制器（请求处理）
│   │   │   └── hermes/       #   Hermes 业务控制器
│   │   ├── db/               #   SQLite 数据库层
│   │   │   └── hermes/       #   表 schema + Store 类
│   │   ├── middleware/        #   中间件（认证/CORS/压缩）
│   │   ├── routes/           #   路由注册
│   │   │   └── hermes/       #   Hermes 业务路由
│   │   ├── services/         #   服务层（核心业务逻辑）
│   │   │   ├── hermes/       #   Hermes 核心服务
│   │   │   │   ├── agent-bridge/      # Agent Bridge（Node ↔ Python）
│   │   │   │   │   └── python/        # Python bridge 脚本
│   │   │   │   ├── context-engine/    # 上下文压缩引擎
│   │   │   │   ├── group-chat/        # 群聊服务
│   │   │   │   ├── run-chat/          # 聊天运行引擎 ★
│   │   │   │   ├── stt-providers/     # 语音识别
│   │   │   │   └── tts-providers/     # 语音合成
│   │   │   └── agent-runner/          # Coding Agent 运行器
│   │   │       ├── adapters/          # LLM 适配器
│   │   │       └── proxies/           # Claude Code / Codex 代理
│   │   └── shared/           #   共享常量（Provider 预设）
│   │
│   ├── desktop/              # Electron 桌面应用
│   │   ├── src/main/         #   主进程
│   │   ├── src/preload/      #   预加载脚本
│   │   ├── build/            #   打包资源（图标/安装脚本）
│   │   └── scripts/          #   运行时准备脚本
│   │
│   ├── skills/               # 内置技能（5个）
│   └── website/              # 产品官网
│
├── tests/                    # 测试
│   ├── client/               #   前端单元测试（70+）
│   ├── server/               #   后端单元测试（11）
│   ├── desktop/              #   桌面测试（5）
│   └── e2e/                  #   E2E 测试（10）
│
├── scripts/                  # 构建脚本
├── bin/                      # CLI 入口
├── docs/                     # 文档
├── dist/                     # 构建产物
│   ├── client/               #   Vite 构建的前端
│   ├── server/               #   esbuild 构建的后端
│   └── skills/               #   复制的内置技能
│
├── vite.config.ts            # Vite 配置
├── package.json              # Monorepo 根配置
└── ARCHITECTURE.md           # 英文架构文档
```

---

## 4. 请求链路

```
┌─────────────────────────────────────────────────────────────────────┐
│                        浏览器 (localhost:8649)                        │
│  开发模式：Vite Dev Server (8649) → 代理 API → 后端 (8647)           │
│  生产模式：Koa Server (8648) 直接 Serve dist/client + API             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP / Socket.IO / WebSocket
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Koa BFF 服务器 (8647/8648)                         │
│                                                                      │
│  1. securityHeaders → CORS → bodyParser                              │
│  2. public routes（/health, /api/auth/login, /webhook）              │
│  3. requireUserJwt 中间件                                             │
│  4. protected routes（/api/hermes/*）                                │
│  5. SPA fallback（dist/client/index.html）                           │
│                                                                      │
│  WebSocket 端点：                                                     │
│  - /chat-run (Socket.IO) — 聊天流式推送                               │
│  - /group-chat (Socket.IO) — 群聊                                    │
│  - /api/hermes/terminal (ws) — Web 终端                              │
│  - /api/hermes/kanban/events (ws) — 看板实时更新                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Agent Bridge │ │ Hermes CLI   │ │ Coding Agent │
│  (Python 进程)│ │ (网关/配置)   │ │ Runner       │
│  tcp://       │ │ execFile/    │ │ (node-pty)   │
│  127.0.0.1:   │ │ spawn        │ │              │
│  18765        │ │              │ │              │
└──────┬───────┘ └──────┬───────┘ └──────────────┘
       │                │
       ▼                ▼
┌─────────────────────────────────┐
│        Hermes Agent Runtime     │
│  ~/.hermes/  (数据目录)          │
│  hermes CLI + run_agent.py      │
│  Python site-packages           │
└─────────────────────────────────┘
```

**关键路由注册顺序：**
1. 本地 API 路由（`/api/hermes/*`）
2. 认证中间件
3. 受保护路由
4. 代理 catch-all（转发到 Hermes Gateway）
5. SPA fallback（`dist/client/index.html`）

---

## 5. 前端架构

### 5.1 路由系统

使用 `vue-router` + Hash History。共 25 条路由：

| 路径 | 视图 | 权限 |
|------|------|------|
| `/` | [LoginView](packages/client/src/views/LoginView.vue) | 公开 |
| `/hermes/chat` | [ChatView](packages/client/src/views/hermes/ChatView.vue) | 登录 |
| `/hermes/session/:sessionId` | [ChatView](packages/client/src/views/hermes/ChatView.vue) | 登录 |
| `/hermes/history` | [HistoryView](packages/client/src/views/hermes/HistoryView.vue) | 登录 |
| `/hermes/jobs` | [JobsView](packages/client/src/views/hermes/JobsView.vue) | 登录 |
| `/hermes/kanban` | [KanbanView](packages/client/src/views/hermes/KanbanView.vue) | 登录 |
| `/hermes/models` | [ModelsView](packages/client/src/views/hermes/ModelsView.vue) | 登录 |
| `/hermes/profiles` | [ProfilesView](packages/client/src/views/hermes/ProfilesView.vue) | 超级管理员 |
| `/hermes/logs` | [LogsView](packages/client/src/views/hermes/LogsView.vue) | 登录 |
| `/hermes/usage` | [UsageView](packages/client/src/views/hermes/UsageView.vue) | 登录 |
| `/hermes/settings` | [SettingsView](packages/client/src/views/hermes/SettingsView.vue) | 登录 |
| `/hermes/terminal` | [TerminalView](packages/client/src/views/hermes/TerminalView.vue) | 登录 |
| `/hermes/files` | [FilesView](packages/client/src/views/hermes/FilesView.vue) | 登录 |
| `/hermes/group-chat` | [GroupChatView](packages/client/src/views/hermes/GroupChatView.vue) | 登录 |
| `/hermes/coding-agents` | [CodingAgentsView](packages/client/src/views/hermes/CodingAgentsView.vue) | 登录 |
| `/hermes/mcp` | [McpManagerView](packages/client/src/views/hermes/McpManagerView.vue) | 超级管理员 |
| 等 9 条 | ... | ... |

**路由守卫逻辑：**
- 未登录 → 重定向到 `/`
- 已登录访问 `/` → 重定向到 `/hermes/chat`
- `meta.requiresSuperAdmin` → 检查 JWT 中的 `role=super_admin`

### 5.2 状态管理（Pinia）

共 11 个 Store，全部采用 Setup Store 语法：

| Store | 核心职责 | 关键状态 |
|-------|---------|----------|
| **[chat.ts](packages/client/src/stores/hermes/chat.ts)** | ★ 聊天引擎 | sessions, messages, streamStates, queue, approvals, compression |
| **[group-chat.ts](packages/client/src/stores/hermes/group-chat.ts)** | 群聊引擎 | rooms, messages, members, agents, typing |
| **[app.ts](packages/client/src/stores/hermes/app.ts)** | 应用全局 | sidebar, models, connection, update |
| **[settings.ts](packages/client/src/stores/hermes/settings.ts)** | 设置 | 所有配置段（display/agent/memory/platform...） |
| **[profiles.ts](packages/client/src/stores/hermes/profiles.ts)** | Profile 管理 | profiles, activeProfile, switching |
| **[models.ts](packages/client/src/stores/hermes/models.ts)** | 模型管理 | providers, defaultModel, customProviders |
| **[files.ts](packages/client/src/stores/hermes/files.ts)** | 文件浏览 | currentPath, entries, editingFile |
| **[kanban.ts](packages/client/src/stores/hermes/kanban.ts)** | 看板 | tasks, boards, stats, WebSocket stream |
| **[jobs.ts](packages/client/src/stores/hermes/jobs.ts)** | 定时任务 | jobs, loading |
| **[usage.ts](packages/client/src/stores/hermes/usage.ts)** | 用量统计 | stats, dailyUsage, modelUsage |
| **[session-browser-prefs.ts](packages/client/src/stores/hermes/session-browser-prefs.ts)** | 会话偏好 | pinnedIds, humanOnly |

**chat.ts 核心流程（最重要的 Store）：**
```
sendMessage(content)
  ├─ 上传附件 → uploadFiles()
  ├─ 建立 Socket.IO 连接到 /chat-run
  ├─ 发送 run 事件（model, messages, tools, files...）
  ├─ 处理流式事件：
  │   ├─ reasoning.delta   → 更新思考内容
  │   ├─ message.delta     → 追加 assistant 文本
  │   ├─ tool.started      → 记录工具调用
  │   ├─ tool.completed    → 记录工具结果
  │   ├─ compression       → 触发上下文压缩
  │   ├─ approval.required → 暂停等待用户审批
  │   └─ run.completed     → 结束，刷新用量
  └─ 错误处理 + 队列管理
```

### 5.3 API 层

**核心 HTTP 客户端：** [client.ts](packages/client/src/api/client.ts)
- 自动注入 `Authorization: Bearer <JWT>`
- 自动注入 `X-Hermes-Profile` header
- 全局 401/403 处理 → 清除 token → 重定向登录
- JWT 解码获取 username/role

**业务 API 模块（30+ 文件）：**

| API 模块 | 端点前缀 | 主要功能 |
|----------|----------|----------|
| `hermes/chat.ts` | Socket.IO `/chat-run` | 流式聊天运行 |
| `hermes/sessions.ts` | `/api/hermes/sessions` | 会话 CRUD、搜索、用量 |
| `hermes/files.ts` | `/api/hermes/files` | 文件浏览、读写、上传下载 |
| `hermes/group-chat.ts` | Socket.IO `/group-chat` | 群聊房间、消息、Agent |
| `hermes/kanban.ts` | `/api/hermes/kanban` | 看板任务、WebSocket |
| `hermes/jobs.ts` | `/api/hermes/jobs` | Cron 任务管理 |
| `hermes/profiles.ts` | `/api/hermes/profiles` | Profile CRUD |
| `hermes/skills.ts` | `/api/hermes/skills` | 技能/记忆管理 |
| `hermes/mcp.ts` | `/api/hermes/mcp` | MCP Server 管理 |
| `hermes/config.ts` | `/api/hermes/config` | 应用配置 |
| `auth.ts` | `/api/auth` | 登录/用户管理 |
| `coding-agents.ts` | `/api/coding-agents` | Coding Agent 安装/启动 |
| `hermes/tts.ts` | `/api/hermes/tts` | 语音合成 |
| `hermes/stt.ts` | `/api/hermes/stt` | 语音识别 |
| `hermes/logs.ts` | `/api/hermes/logs` | 日志查看 |
| `hermes/download.ts` | `/api/hermes/download` | 安全下载 |

### 5.4 组件体系

```
组件层级：
App.vue
├── NConfigProvider (Naive UI 主题)
├── NMessageProvider (Toast)
├── NDialogProvider (对话框)
├── NNotificationProvider (通知)
├── DesktopTitleBar (桌面壳模式)
├── AppSidebar (侧边栏导航)
│   ├── ModelSelector
│   ├── ProfileSelector
│   ├── LanguageSwitch
│   ├── ThemeSwitch
│   └── RouteLinkItem[]
└── <router-view>
    └── 23 个视图页面
```

**关键可复用组件：**
- `MessageItem.vue` — 单条消息气泡（user/assistant/tool/command 多种角色）
- `MarkdownRenderer.vue` — Markdown 渲染（含代码高亮、Mermaid 图表）
- `VirtualMessageList.vue` — 虚拟滚动消息列表
- `ChatInput.vue` — 聊天输入框（文本 + 附件 + @提及）
- `FileTree.vue` / `FileEditor.vue` — 文件浏览编辑
- `GroupMessageItem.vue` — 群聊消息（含 Agent 标识）

### 5.5 国际化

- **框架：** vue-i18n (Composition API 模式)
- **语言：** en, zh, zh-TW, ja, ko, de, fr, es, pt, ru
- **回退策略：** 所有语言以英语为 fallback，未翻译 key 自动降级到英语
- **语言检测：** localStorage → navigator.languages → 默认 en

---

## 6. 后端架构

### 6.1 启动流程

```
bootstrap()
├─ 1. 打印版本，创建数据目录
├─ 2. 初始化登录限流器
├─ 3. 注入内置技能（HermesSkillInjector）
├─ 4. 注入托管 MCP Server
├─ 5. 启动 Agent Bridge Manager ★
├─ 6. 确保 Profile 网关运行
├─ 7. 创建 Koa App
├─ 8. 初始化 SQLite（initAllStores）
├─ 9. 注册中间件：securityHeaders → CORS → bodyParser
├─ 10. 注册路由：public → requireUserJwt → protected → proxy → SPA fallback
├─ 11. 启动 HTTP Server
├─ 12. 设置 WebSocket/Socket.IO 端点
├─ 13. 启动会话删除器、LAN 发现、后台任务
├─ 14. 绑定优雅关闭
└─ 15. 非桌面模式：自动打开浏览器
```

### 6.2 认证体系

```
认证方式：
├─ JWT Token (HMAC-SHA256) — 用户登录
├─ Server Token — 服务内部/Agent 端点
├─ 密码认证 — admin/123456 默认
└─ 无密码模式 — Bearer Token 直接验证

角色：
├─ super_admin — 全部权限
└─ admin — 受限权限（Profile 绑定）

限流：
├─ 每 IP：10 次失败/小时 → 封禁
└─ 全局：50 次总失败 → 30 分钟封禁
```

### 6.3 路由-控制器-服务三层架构

```
Route (路由注册)
  └─ Controller (请求验证、参数提取)
       └─ Service (业务逻辑、副作用)

规则：
- Route 不包含业务逻辑
- Controller 只处理请求层面的事
- Service 拥有副作用（文件、数据库、外部进程）
```

**主要路由文件（30+）：**

| 路由文件 | 主要端点 |
|----------|----------|
| `auth.ts` | 登录/用户管理/IP锁 |
| `hermes/chat-run.ts` | Socket.IO 聊天运行 |
| `hermes/sessions.ts` | 会话 CRUD + 搜索 + 用量 |
| `hermes/files.ts` | 文件浏览/读写 |
| `hermes/group-chat.ts` | 群聊 REST API |
| `hermes/jobs.ts` | Cron 任务 |
| `hermes/kanban.ts` | 看板 |
| `hermes/models.ts` | 模型管理 |
| `hermes/profiles.ts` | Profile 管理 |
| `hermes/providers.ts` | Provider 管理 |
| `hermes/config.ts` | 全量配置 |
| `hermes/skills.ts` | 技能管理 |
| `hermes/mcp.ts` | MCP Server |
| `hermes/memory.ts` | 记忆管理 |
| `hermes/tts.ts` | 语音合成 |
| `hermes/stt.ts` | 语音识别 |
| `hermes/logs.ts` | 日志查看 |
| `hermes/write-gate.ts` | 写操作审批 |
| `hermes/proxy.ts` | 代理到 Hermes Gateway |
| `coding-agents.ts` | Coding Agent 管理 |
| `devices.ts` | LAN 设备配对 |
| `terminal.ts` | Web 终端 WebSocket |
| `upload.ts` | 文件上传 |
| `webhook.ts` | Webhook 接收 |
| `update.ts` | 自更新/版本预览 |

---

## 7. 核心引擎深度解析

### 7.1 Agent Bridge（Node ↔ Python 通信桥梁）

**目的：** Node.js 后端通过 TCP/IPC 与 Python Hermes Agent 进程通信。

```
┌──────────────────┐         TCP/IPC          ┌──────────────────────┐
│  Node.js 后端     │ ◄──────────────────────► │  Python Agent Bridge │
│  AgentBridgeClient│    JSON-line 协议          │  hermes_bridge.py   │
│  (client.ts)     │                           │  bridge_runtime.py  │
└──────────────────┘                           └──────────┬───────────┘
                                                          │
                                                          ▼
                                              ┌──────────────────────┐
                                              │  Hermes Agent        │
                                              │  run_agent.py        │
                                              └──────────────────────┘
```

**关键类：**

- **`AgentBridgeClient`** ([client.ts](packages/server/src/services/hermes/agent-bridge/client.ts))
  - 连接方式：Unix Socket (`ipc://`) 或 TCP (`tcp://`)
  - Windows 默认 TCP (`tcp://127.0.0.1:18765`)
  - 核心方法：`chat()`, `ping()`, `interrupt()`, `approvalRespond()`, `contextEstimate()`
  - 流式输出：`streamOutput()` 返回 AsyncGenerator

- **`AgentBridgeManager`** ([manager.ts](packages/server/src/services/hermes/agent-bridge/manager.ts))
  - 管理 Python bridge 进程的生命周期
  - 自动重启（崩溃后指数退避重试）
  - 就绪检查（ping 探测）
  - 附加到已有 bridge（复用运行中的进程）

**启动命令解析优先级：**
1. `HERMES_AGENT_BRIDGE_PYTHON` 环境变量
2. venv 中的 Python（从 `run_agent.py` 所在目录查找）
3. `hermes` shebang 中的 Python
4. `uv run python`（如果 uv 可用）
5. 系统 `python3` / `python`

**环境变量：**
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HERMES_AGENT_BRIDGE_ENDPOINT` | `tcp://127.0.0.1:18765` (Win) / `ipc:///tmp/hermes-agent-bridge.sock` | Bridge 通信端点 |
| `HERMES_AGENT_BRIDGE_TIMEOUT_MS` | `120000` | 响应超时 |
| `HERMES_AGENT_BRIDGE_STARTUP_TIMEOUT_MS` | `120000` | 启动就绪超时 |
| `HERMES_AGENT_BRIDGE_AUTO_RESTART` | 开启 | 崩溃自动重启 |
| `HERMES_AGENT_BRIDGE_RESTART_DELAY_MS` | `1000` | 重启基础延迟 |

### 7.2 Chat Run Engine（聊天运行引擎）

**目的：** Socket.IO 驱动的实时流式聊天。处理用户消息 → Agent 响应 → 流式推送。

**文件：** [run-chat/](packages/server/src/services/hermes/run-chat/)

```
ChatRunSocket (index.ts)
├─ 注册事件处理：
│   ├─ run              → 启动新聊天运行
│   ├─ resume           → 恢复进行中的运行
│   ├─ abort            → 中止运行
│   ├─ approval.respond → 响应用户审批
│   └─ clarify.respond  → 响应澄清请求
│
├─ 根据 source 分发到三个处理器：
│   ├─ CLI source  → handle-bridge-run.ts  → Agent Bridge
│   ├─ API source  → handle-api-run.ts     → /v1/responses 端点
│   └─ Coding Agent → handle-coding-agent-run.ts → CodingAgentRunManager
│
└─ 流式事件类型：
    ├─ reasoning.delta          → 模型思考过程
    ├─ message.delta            → Assistant 文本增量
    ├─ tool.started/completed   → 工具调用轨迹
    ├─ compression.requested    → 上下文压缩请求
    ├─ approval.required        → 需要用户审批
    ├─ clarify.required         → 需要用户澄清
    ├─ goal.evaluation          → 目标评估
    └─ run.completed/error      → 运行结束
```

**handle-bridge-run.ts 核心流程：**
```
1. 构建压缩历史（compression.ts）
2. 通过 Agent Bridge 发送 chat 请求
3. 处理流式响应：
   ├─ reasoning 增量 → 写入 DB + 推送客户端
   ├─ text 增量     → 防重复（bridge-delta.ts 过滤）→ 推送
   ├─ tool.started  → 记录 DB + 推送
   ├─ tool.completed → 解析参数/结果 → 记录 DB + 推送
   └─ 审批/澄清     → 暂停 → 等待用户响应 → 继续
4. 自动继续（goal.evaluation 通过后自动发下一轮）
5. 错误处理 + 压缩触发
```

### 7.3 Context Engine（上下文压缩引擎）

**目的：** 群聊和 1:1 对话的历史消息过长时，自动摘要压缩。

**文件：** [context-engine/](packages/server/src/services/hermes/context-engine/)

```
ContextEngine (compressor.ts)
├─ 快照路径 (A)：已有压缩快照
│   ├─ 收集新消息 → 估算 Token
│   ├─ 未超阈值 → 全部发送
│   └─ 超阈值 → 增量摘要 + 保留尾部原文
│
└─ 全量路径 (B)：无快照
    ├─ 估算全部消息 Token
    ├─ 未超阈值 → 原文发送
    └─ 超阈值 → 全量摘要 + 尾部原文保留
```

**相关配置：**
- `triggerTokens` — 触发压缩的 Token 阈值
- `maxHistoryTokens` — 最大历史 Token 数
- `tailMessageCount` — 保留的尾部原文消息数

### 7.4 Group Chat Engine（群聊引擎）

**文件：** [group-chat/](packages/server/src/services/hermes/group-chat/)

```
GroupChatServer (index.ts)
├─ Socket.IO /group-chat 命名空间
├─ 房间管理：create/join/leave/delete/clone
├─ 消息流：send → @mention 路由 → Agent 回复 → stream delta
├─ 压缩：ContextEngine 自动摘要
└─ Agent 管理：add/remove Agent（独立 Profile）

AgentClients (agent-clients.ts)
├─ 管理 Agent 的 Socket.IO 连接
├─ @mention 解析 → 路由到对应 Agent
└─ 上下文注入 → 调用 ContextEngine

mention-routing.ts
├─ 解析消息中的 @agent-name
└─ 决定哪些 Agent 应该回复
```

**数据模型：**
- `gc_rooms` — 房间（名称、邀请码、压缩配置）
- `gc_messages` — 消息（发送者、内容、时间戳）
- `gc_room_agents` — 房间中的 Agent（Profile、名称）
- `gc_room_members` — 人类成员
- `gc_context_snapshots` — 压缩快照

### 7.5 Agent Runner（Coding Agent 运行器）

**目的：** 在 Web UI 中启动和管理 Claude Code / Codex 等 Coding Agent。

**文件：** [agent-runner/](packages/server/src/services/agent-runner/)

```
CodingAgentRunManager (coding-agent-run-manager.ts)
├─ 通过 node-pty 创建隐藏终端会话
├─ 支持 Claude Code 和 Codex 两种 Agent
├─ 流式事件映射（coding-agent-event-mapper.ts）
└─ 空闲超时自动清理

代理端点：
├─ /api/claude-code-proxy/:key/v1/messages → Anthropic 兼容代理
├─ /api/claude-code-proxy/:key/v1/models
├─ /api/codex-proxy/:key/v1/responses → OpenAI Responses 代理
└─ /api/codex-proxy/:key/v1/models
```

---

## 8. 数据库设计

**存储后端：** SQLite（Node 22+ `node:sqlite`），WAL 模式

**数据库文件：** `~/.hermes-web-ui/hermes-web-ui.db`

### 核心表

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `sessions` | 聊天会话元数据 | id, profile, model, title, message_count, token counts, workspace |
| `messages` | 聊天消息 | id, session_id, role, content, tool_calls, reasoning |
| `session_usage` | Token 用量 | session_id, input/output/cache/reasoning_tokens, model |
| `chat_compression_snapshots` | 1:1 压缩快照 | session_id, summary, last_message_index |
| `users` | 用户账号 | username, password_hash, role, avatar |
| `user_profiles` | 用户-Profile 绑定 | user_id, profile_name |
| `gc_rooms` | 群聊房间 | name, inviteCode, triggerTokens, maxHistoryTokens |
| `gc_messages` | 群聊消息 | roomId, senderId, content, role |
| `gc_room_agents` | 群聊 Agent | roomId, agentId, profile |
| `gc_context_snapshots` | 群聊压缩快照 | roomId, summary, lastMessageId |
| `gc_room_members` | 群聊成员 | roomId, userId, userName |
| `devices` | LAN 设备 | status, computer_name, ip, public_key |
| `stt_provider_settings` | STT 配置 | user_id, provider, settings_json, secrets_json |
| `tts_provider_settings` | TTS 配置 | user_id, provider, settings_json, secrets_json |
| `model_context` | 模型上下文限制 | provider, model, context_limit |

### Store 类

每个 Store 类封装对一张或多张表的操作，负责迁移、CRUD、查询：

| Store | 文件 |
|-------|------|
| `SessionStore` | [session-store.ts](packages/server/src/db/hermes/session-store.ts) |
| `UsageStore` | [usage-store.ts](packages/server/src/db/hermes/usage-store.ts) |
| `UsersStore` | [users-store.ts](packages/server/src/db/hermes/users-store.ts) |
| `DevicesStore` | [devices-store.ts](packages/server/src/db/hermes/devices-store.ts) |
| `CompressionSnapshotStore` | [compression-snapshot.ts](packages/server/src/db/hermes/compression-snapshot.ts) |
| `ConversationsDB` | [conversations-db.ts](packages/server/src/db/hermes/conversations-db.ts) |
| `MessageContent` | [message-content.ts](packages/server/src/db/hermes/message-content.ts) |

---

## 9. 桌面应用架构

### 9.1 Electron 生命周期

```
启动 → app.requestSingleInstanceLock()
├─ CLI 模式（参数包含 Hermes CLI 命令）→ runBundledHermesCli() → 退出
└─ 桌面模式 → app.whenReady()
    ├─ 移除默认菜单（Win/Linux）
    ├─ 安装 CLI Shim（hermes-studio / hermes-studio-mcp）
    ├─ 创建系统托盘（图标 + 上下文菜单）
    ├─ 创建 BrowserWindow（1280x820）
    ├─ 显示启动 Splash 页面
    ├─ bootstrap()
    │   ├─ 迁移旧版运行时
    │   ├─ 检查/下载 Hermes 运行时（Python + Node + Git + Hermes Agent）
    │   └─ 启动内嵌 Web UI 服务器
    ├─ initAutoUpdater（6 小时周期检查）
    └─ 事件循环
```

### 9.2 内嵌 Web UI 服务器

桌面版将 Web UI 作为子进程启动（`ELECTRON_RUN_AS_NODE` 模式）：

- **端口：** 默认 8748
- **环境注入：** 捆绑的 Python/Node/Git 路径、Agent Bridge TCP 配置
- **健康检查：** 最多等待 120s 直到 `/api/health` 返回 200/401
- **关闭：** SIGTERM → 3s 超时 → taskkill /T /F (Win)

### 9.3 自动更新

双源策略：
1. **主源：** Cloudflare (`https://download.ekkolearnai.com/latest`)
2. **回退：** GitHub Releases (`https://github.com/EKKOLearnAI/hermes-web-ui/releases/latest/download`)

### 9.4 运行时管理

桌面版捆绑完整的 Hermes 运行时：
- Python 3 + hermes-agent
- Node.js（用于 server）
- Git（Windows）
- 从 Cloudflare/GitHub 下载 `.tar.gz` 归档 → 校验 SHA256 → 解压

### 9.5 Preload 脚本

暴露 `window.hermesDesktop` API：
- `getToken()` — 获取 AUTH_TOKEN
- `windowControl(action)` — 最小化/最大化/关闭
- `notifyCompletion(payload)` — 系统通知
- `retryBootstrap(source)` — 重试运行时下载
- **自动登录：** 注入 admin/123456 → 获取 JWT → 存入 localStorage

---

## 10. 构建系统

### 10.1 前端构建（Vite）

```
vite.config.ts
├─ @vitejs/plugin-vue
├─ 别名：@ → packages/client/src
├─ 输出：dist/client/
├─ 手动分块：
│   ├─ monaco-editor (4.3MB)
│   ├─ mermaid (3.2MB)
│   ├─ ui-vendor (naive-ui, 921KB)
│   ├─ vue-vendor (vue/pinia/router, 100KB)
│   └─ vendor (其他)
└─ Dev Server：8649 → 代理 API 到 8647
```

### 10.2 后端构建（esbuild）

[build-server.mjs](scripts/build-server.mjs)：
- esbuild 打包 TypeScript → CJS
- 外部化：`node-pty`, `node:sqlite`, `socket.io`
- 复制 Python bridge 脚本到 `dist/server/agent-bridge/python/`
- 复制内置技能到 `dist/skills/`

### 10.3 桌面打包（electron-builder）

[electron-builder.yml](packages/desktop/electron-builder.yml)：
- **macOS：** DMG + ZIP（arm64 + x64），公证
- **Windows：** NSIS 安装器（x64）
- **Linux：** AppImage（x64/arm64）+ deb（x64）

### 10.4 测试体系

| 类型 | 框架 | 位置 | 数量 |
|------|------|------|------|
| 前端单元测试 | Vitest | `tests/client/` | 70+ |
| 后端单元测试 | Vitest | `tests/server/` | 11 |
| 桌面测试 | Vitest | `tests/desktop/` | 5 |
| E2E 测试 | Playwright | `tests/e2e/` | 10 |

---

## 11. 扩展开发指南

### 11.1 添加新页面

1. **创建视图：** `packages/client/src/views/hermes/NewFeatureView.vue`
2. **添加路由：** 在 `packages/client/src/router/index.ts` 中注册
3. **创建 Store：** `packages/client/src/stores/hermes/new-feature.ts`
4. **创建 API 模块：** `packages/client/src/api/hermes/new-feature.ts`
5. **添加路由端点：** `packages/server/src/routes/hermes/new-feature.ts`
6. **添加控制器：** `packages/server/src/controllers/hermes/new-feature.ts`
7. **添加服务：** `packages/server/src/services/hermes/new-feature.ts`
8. **国际化：** 在所有 locale 文件中添加文本

### 11.2 添加新平台渠道

参考 [ChannelsView](packages/client/src/views/hermes/ChannelsView.vue) 和 [PlatformSettings](packages/client/src/components/hermes/settings/PlatformSettings.vue)：

1. 在 `settings.ts` Store 中添加新的配置段类型
2. 在 `config.ts` API 中添加凭证保存方法
3. 在 `PlatformCard.vue` 中添加平台卡片
4. 在 `hermes-cli.ts` 中添加平台特定的凭证写入逻辑

### 11.3 添加新的 TTS/STT Provider

1. **TTS：** 在 `tts-providers/` 中创建新 provider 文件，实现 `TtsProvider` 接口
2. **STT：** 在 `stt-providers/` 中创建新 provider 文件，实现 `SttProvider` 接口
3. 在 Settings → Voice 面板中自动注册

### 11.4 添加新的 Coding Agent

参考 [CodingAgentsView](packages/client/src/views/hermes/CodingAgentsView.vue)：

1. 在 `coding-agents.ts` 控制器中添加新的 Agent 类型
2. 在 `agent-runner/` 中添加新的代理处理器
3. 在 `coding-agent-event-mapper.ts` 中添加事件映射

### 11.5 添加新的内置技能

在 `packages/skills/` 中创建新目录，包含 `SKILL.md` 文件。技能会在启动时自动注入到 Hermes 配置中。

### 11.6 关键环境变量速查

| 变量 | 说明 |
|------|------|
| `PORT` | 监听端口（默认 8648） |
| `HERMES_WEB_UI_HOME` | Web UI 数据目录 |
| `HERMES_HOME` | Hermes 数据目录 |
| `HERMES_BIN` | 自定义 Hermes CLI 路径 |
| `HERMES_AGENT_ROOT` | 包含 run_agent.py 的目录 |
| `HERMES_AGENT_BRIDGE_PYTHON` | Bridge Python 解释器 |
| `HERMES_AGENT_BRIDGE_ENDPOINT` | Bridge 通信端点 |
| `HERMES_WEB_UI_DISABLE_GATEWAY_AUTOSTART` | 跳过网关自动启动 |
| `AUTH_TOKEN` | 显式指定 Bearer Token |
| `LOG_LEVEL` | 日志级别 |
| `CORS_ORIGINS` | CORS 允许列表 |

### 11.7 常用开发命令

```bash
npm run dev              # 开发模式（Vite 8649 + 后端 8647）
npm run start            # 生产模式（8648）
npm run build            # 构建生产包
npm run test             # 单元测试
npm run test:e2e         # E2E 测试
npm run test:coverage    # 测试覆盖率
npm run harness:check    # 项目完整性检查
npm run build:desktop:win  # 构建 Windows 桌面版
```

---

## 附录

### A. 数据流完整示例：用户发送一条聊天消息

```
浏览器                                   Node.js 后端                          Python
───────                                  ───────────                          ──────
1. 用户输入文本 + 点击发送
2. ChatInput emit 'send'
3. chatStore.sendMessage()
   ├─ uploadFiles() → POST /upload
   └─ startRunViaSocket()
4. Socket.IO emit 'run' ──────────────► 5. ChatRunSocket 接收
                                          ├─ 鉴权 + 解析参数
                                          ├─ 存入 DB（sessions/messages）
                                          ├─ 构建压缩历史
                                          └─ AgentBridgeClient.chat() ──────► 6. Python Bridge
                                                                                 ├─ run_agent
                                                                                 ├─ LLM API 调用
                                                                                 └─ stream output
                                          7. 流式处理 ◄──────────────────────────
                                          ├─ reasoning.delta → emit ──────► 8. 更新思考面板
                                          ├─ message.delta → emit ─────────► 9. 追加文本
                                          ├─ tool.started → emit ──────────► 10. 显示工具调用
                                          ├─ tool.completed → emit ────────► 11. 显示工具结果
                                          └─ run.completed → emit ─────────► 12. 结束、刷新用量
```

### B. Socket.IO 事件参考

**客户端 → 服务端：**
- `run` — 启动新的聊天运行
- `resume` — 恢复进行中的运行
- `abort` — 中止运行
- `approval.respond` — 响应用户审批
- `clarify.respond` — 响应澄清请求
- `cancel_queued_run` — 取消队列中的运行

**服务端 → 客户端：**
- `reasoning.delta` — 模型思考过程
- `message.delta` — 文本增量
- `message.completed` — 消息完成
- `tool.started` — 工具调用开始
- `tool.completed` — 工具调用完成
- `compression.requested` — 压缩请求
- `approval.required` — 需要审批
- `clarify.required` — 需要澄清
- `run.completed` — 运行完成
- `run.error` — 运行错误
