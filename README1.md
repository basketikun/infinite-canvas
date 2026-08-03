<p align="center">
  <img src="web/public/logo.svg" width="96" alt="infinite-canvas logo">
</p>

<h1 align="center">🎨 无限画布 (infinite-canvas)</h1>

<p align="center">
  <a href="https://github.com/basketikun/infinite-canvas/tags"><img src="https://img.shields.io/github/v/tag/basketikun/infinite-canvas?style=flat-square&label=version" alt="Version"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7.3.0-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19.2.5-61dafb?style=flat-square&logo=react" alt="React"></a>
  <a href="https://reactrouter.com/"><img src="https://img.shields.io/badge/React_Router-7.12.0-ca4245?style=flat-square&logo=reactrouter" alt="React Router"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-blue?style=flat-square&logo=typescript" alt="TypeScript"></a>
  <a href="https://ant.design/"><img src="https://img.shields.io/badge/Ant%20Design-6.4.2-0170fe?style=flat-square&logo=ant-design" alt="Ant Design"></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind%20CSS-4.0-06b6d4?style=flat-square&logo=tailwindcss" alt="Tailwind CSS"></a>
  <a href="https://zustand-demo.pmnd.rs/"><img src="https://img.shields.io/badge/Zustand-5.0.12-red?style=flat-square" alt="Zustand"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Supported-orange?style=flat-square" alt="MCP"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
</p>

## 📋 项目简介

**无限画布 (infinite-canvas)** 是一款面向 AI 视觉与多模态创作的开源交互式工作台。它将**无限画布底座、工作流节点编排、多模态 AI 生成 (文本/生图/视频/音频)、局部蒙版编辑、自定义调用脚本、节点插件系统、画布侧边 AI 助手、提示词库管理、我的素材库**以及**本地 IDE Agent (通过 MCP 协议桥接)** 无缝融合在统一的画布空间中，旨在为创作者与开发者提供无边界、可撤销重做、支持多方案对比与迭代的视觉方案探索工具。

> [!CAUTION]
> 本项目所有 API Key、Base URL、画布项目与素材资源默认全量保存在浏览器本地（IndexedDB/localforage），**不包含项目后端与云端数据同步服务**。项目当前处于敏捷迭代阶段，本地数据结构可能随版本调整。

---

## 🛠️ 技术栈

本项目采用**纯前端静态应用 (Vite + React Router + Nginx) + 浏览器直连 AI API + 本地 Agent (MCP 协议) 桥接**的现代化轻量架构。

### 1. 前端技术栈 (Frontend)
| 核心组件/工具 | 版本 | 主要用途 | 关键作用与技术特点 |
| :--- | :--- | :--- | :--- |
| **Vite** | `7.3.0` | 极速前端构建与开发服务器 | 替代传统的服务器渲染框架，提供轻量高效率的静态打包与 HMR |
| **React Router** | `7.12.0` | 单页应用路由管理 | 组织画布、素材中心、配置偏好及管理后台等页面路由 |
| **React** | `19.2.5` | UI 构建库 | 纯函数组件结合并发模式与最新的 React Hooks |
| **Ant Design** | `6.4.2` | UI 组件库 | 控制台、侧边栏、弹窗与参数配置的高级交互组件 |
| **Tailwind CSS** | `4.0` | 原子化 CSS 样式 | Tailwind 4.0 样式引擎，支持极简响应式与深浅主题自适应 |
| **Zustand** | `5.0.12` | 全局状态管理 | 驱动画布节点拓扑、连线关系、撤销/重做 (Undo/Redo) 与全站偏好设置 |
| **TanStack Query** | `5.100.9` | 异步数据获取 | 处理远程提示词源解析与数据异步缓存 |
| **localforage** | `1.10.0` | 本地离线持久化 | 基于 IndexedDB 缓存画布多项目、素材资产、生成历史与高分辨率图片 Blob |
| **Motion** | `12.38.0` | 微交互动画 | 负责面板平滑展开/收起、节点高亮及 UI 微交互过渡 |
| **streamdown** | `2.5.0` | 流式 Markdown 渲染 | Agent 对话面板中 AI 消息的实时 Markdown 与代码块渲染 |
| **CodeMirror** | `4.25.9` | 代码编辑器组件 | 用于自定义生图/视频 API 脚本的编辑与语法高亮 |

### 2. Agent 与插件扩展架构 (Agent & Plugin Ecosystem)
| 组件模块 | 主要技术 | 主要用途 | 关键作用与特点 |
| :--- | :--- | :--- | :--- |
| **Canvas Agent** | Node.js + TypeScript | 本地守护进程 | 监听 `127.0.0.1:17371`，连接画布前端与 IDE 终端能力 |
| **MCP SDK** | `@modelcontextprotocol/sdk` | 桥接 Codex / Claude Code | 遵循 Model Context Protocol 标准，向 IDE 暴露画布增删改查 Tools |
| **Codex App 插件** | JSON Schema / Node.js | Codex 市场应用插件 | 提供配置并自动拉起本地 Agent，实现与 Codex IDE 交互 |
| **节点插件 SDK** | TypeScript SDK | 动态扩展画布节点 | 支持通过 URL 动态安装、更新与卸载节点插件 (如 Markdown, SVG, 3D全景, 便利贴, HTML) |

### 3. AI 服务接入 (AI Services Integration)
| 接入渠道 | 对应接口/API 规范 | 模态与服务支持 | 特点描述 |
| :--- | :--- | :--- | :--- |
| **OpenAI 兼容生图** | `POST /v1/images/generations` | 基础文本/提示词生图 | 浏览器前端直连 Base URL，支持自定义模型名称与生成参数 |
| **OpenAI 兼容图生图** | `POST /v1/images/edits` | 参考图编辑与蒙版重绘 | 支持上传参考图、遮罩编辑、切图与透明背景生成 |
| **OpenAI 兼容对话/推理** | `POST /v1/chat/completions` / MCP | 画布助手对话与推理 | 支持文本生成推理强度档位选择及画布节点上下文引用 |
| **OpenAI 兼容视频** | `POST /v1/videos` | 视频异步生成 | 支持设定分辨率、比例、时长，基于任务 ID 异步轮询生成进度 |
| **OpenAI 兼容音频** | `POST /v1/audio/speech` | 音频 TTS 生成 | 声音人设与语速调节，生成音频 Blob 写入本地数据库 |
| **Gemini 官方原生** | `POST /v1beta/models/{model}:generateContent` | Gemini 多模态对话/生图 | 适配 Gemini 原生 JSON 交互契约 |
| **火山方舟协议** | `POST /contents/generations/tasks` | 火山方舟 / Seedance 视频 | 支持火山方舟 Agent Plan 任务提交与异步拉取 |
| **自定义调用脚本** | JS 自定义脚本执行引擎 | 灵活对接中转站或自建服务 | 允许用户自定义请求头、Body 及响应解析代码 |

---

## 📁 目录结构

```
infinite-canvas/
├── web/                      # 前端 Vite + React Router 应用主目录
│   ├── public/               # 公共静态资源 (Logo, 静态图标等)
│   └── src/
│       ├── components/       # 公共与画布业务组件
│       │   └── canvas/       # 画布核心、节点、控制工具栏与节点面板
│       ├── hooks/            # 全局 Hooks (动作提纯、防抖、系统快捷键)
│       ├── lib/              # 工具库 (主题定义、裁剪变换算法、画布工具)
│       ├── pages/            # React Router 路由页面 (canvas, assets, settings 等)
│       ├── services/         # 本地存储 (localforage) 与 AI 接口调用服务
│       │   └── api/          # 直连生图/图生图/视频/音频与自定义脚本接口
│       ├── stores/           # Zustand 全局 Store (画布状态、主题偏好、AI 设置)
│       └── types/            # TypeScript 全局类型契约
├── canvas-agent/             # 本地 Agent 守护进程 (MCP 协议 + IDE 终端桥接)
│   ├── src/                  # Agent TypeScript 源代码
│   └── dist/                 # 编译后的构建可执行文件
├── plugins/                  # 扩展插件目录
│   ├── infinite-canvas/      # Codex App 市场插件配置
│   └── node-plugins/         # 画布节点插件示例与 SDK
├── docs/                     # 官方文档主目录 (Fumadocs 站点)
├── assets/                   # README 效果图与赞助商资源
├── Dockerfile                # 多阶段 Docker 镜像构建 (Bun 构建 + Nginx 静态托管)
├── docker-compose.yml        # Docker Compose 服务编排
├── nginx.conf                # Nginx 静态路由与代理配置
├── VERSION                   # 版本号标识 (如 v0.11.0)
├── CHANGELOG.md              # 版本演进与更新日志
└── AGENTS.md                 # AI 辅助开发规约与项目编码约束
```

---

## ⚡ 核心功能模块与工作流程

### 1. 核心功能模块
*   🎨 **无限画布空间 (Infinite Canvas)**：原生 DOM + SVG 高性能矢量连接线，支持多画布项目、小地图、框选、节点组 (Group Nodes)、层级拖拽与全量撤销/重做 (Undo/Redo)。
*   🚀 **多模态 AI 生成 (Multimodal Generation)**：包含文生图、图生图、参考图编辑、推理强度档位控制、视频生成与音频 TTS。生成配置节点可整合上游多节点输入一键批量生成。
*   🧩 **画布节点插件系统 (Plugin Architecture)**：支持通过在线 URL 安装、启用与管理扩展节点插件 (如 Markdown、SVG、HTML、3D 全景、便利贴等)，提供完整 TypeScript SDK。
*   📜 **自定义调用脚本 (Custom Execution Script)**：针对非标准 OpenAI / 视频中转接口，支持在线编写 JavaScript 脚本来自定义 Header、Body 组装与结果数据提取。
*   💬 **画布 AI 助手 (Canvas Assistant)**：全站常驻 AI 助手。支持通过 `@` 直接引用选中节点或上游依赖，利用 streamdown 流式渲染回复，并将结果快速插回画布。
*   🔌 **本地 Agent 与 MCP 协议**：基于 `canvas-agent` 本地进程向 Codex 或 Claude Code 暴露 MCP 接口，让 IDE 直接读取、编辑画布结构及建立生成链条。
*   📁 **提示词库与素材管理**：直连并本地缓存多个 GitHub 开源提示词库；“我的素材”支持批量导入导出、媒体拖拽上传与全屏放大预览。

### 2. 架构与工作流程图

```mermaid
graph TD
    User([用户浏览器交互]) -->|拖拽/缩放/连线/节点| Canvas[🎨 无限画布核心]
    
    subgraph BrowserFront [纯前端运行域 (Vite SPA + LocalStorage)]
        Canvas <-->|读写数据| LocalForage[(💾 localforage IndexedDB 存储)]
        Canvas -->|节点上下文引用| Assistant[💬 全站 Agent 助手]
        Canvas -->|组装输入/推理强度| GenNode[⚙️ 生成配置节点 / 脚本引擎]
        Assistant -->|浏览器直连| MultiModel[🤖 多模态 AI 服务 (OpenAI/Gemini/火山/自定义)]
        GenNode -->|批量请求| MultiModel
        Plugins[🧩 节点插件系统] -->|加载扩展节点| Canvas
    end

    subgraph ServiceSources [外部服务与扩展源]
        PromptLibrary[📂 提示词库] -->|前端直连获取/本地缓存| GitHubRepos[🐙 GitHub 开源提示词源]
    end

    subgraph LocalSystem [用户本地系统运行域]
        CanvasAgent[🔌 本地 Canvas Agent (17371)] <-->|WebSocket/HTTP| Canvas
        CanvasAgent <-->|MCP 协议 stdio/http| IDE[💻 IDE 助手 Codex / Claude Code]
        IDE -->|自动化读取/更新画布| CanvasAgent
        CanvasAgent -->|canvas_apply_ops| Canvas
    end
    
    MultiModel -->|生图/视频/音频/文本| Canvas
```

---

## ⚙️ 部署指南

### 1. 本地开发运行模式
推荐环境：Node.js (>=18) 或 Bun 包管理器。
```bash
# 1. 克隆仓库代码
git clone https://github.com/basketikun/infinite-canvas.git
cd infinite-canvas

# 2. 进入前端目录并安装依赖 (推荐使用 Bun)
cd web
bun install

# 3. 启动开发服务器
bun run dev
```
启动成功后，访问 `http://localhost:3000` (或控制台提示的端口) 即可进入画布。

### 2. Docker 部署
项目提供高效多阶段构建 Dockerfile，使用 Bun 编译 Vite 静态资源并经由 Nginx 高性能托管：
```bash
# 1. 启动容器编排
docker compose up -d
```
启动后访问 `http://localhost:3000`。首次使用可在页面右上角「配置」中填入个人 AI API Key 与 Base URL。

### 3. 静态平台部署 (Render / Vercel / GitHub Pages)
由于前端为纯静态 SPA 架构：
1. 可以在 Render / Vercel 导入仓库，将 Build Command 设为 `cd web && bun install && bun run build`，Output Directory 设为 `web/dist`。
2. 也可使用仓库内置的 GitHub Actions 工作流直接发布至 GitHub Pages。

---

## 📦 API 接口与 MCP 工具清单

### 1. 前端直连 AI 模型接口规范
| 接口类型 | API 路径 | 核心参数/数据契约 | 功能说明 |
| :--- | :--- | :--- | :--- |
| **OpenAI (生图)** | `POST /v1/images/generations` | `model`, `prompt`, `n`, `size`, `quality` | 发起文生图任务并接收结果图片 |
| **OpenAI (图生图)**| `POST /v1/images/edits` | `model`, `prompt`, `image` (FormData), `mask` | 图生图、局部重绘与遮罩裁剪 |
| **OpenAI (对话)** | `POST /v1/chat/completions` | `model`, `messages[]`, `reasoning_effort` | 基础文本问答与推理强度配置 |
| **OpenAI (视频)** | `POST /v1/videos` | `model`, `prompt`, `seconds`, `input_reference[]` | 异步提交视频生成任务并轮询任务状态 |
| **OpenAI (音频)** | `POST /v1/audio/speech` | `model`, `input`, `voice`, `speed` | 生成音频 Blob 写入本地数据库 |
| **Gemini 原生** | `POST /v1beta/models/{model}:generateContent` | `contents`, `generationConfig` | 直连 Google Gemini 渠道进行对话与生图 |
| **火山方舟协议**| `POST /contents/generations/tasks` | `model`, `content[]`, `ratio`, `duration` | 火山引擎 Agent Plan 视频生成规范 |
| **自定义脚本** | 自定义 JavaScript 提取器 | 自定义 `headers`, `body`, `parseResult(res)` | 用户可手写 JS 逻辑灵活对接各类非标中转 API |

### 2. 本地 Canvas Agent MCP Tool 暴露列表
在本地启动 `canvas-agent` 并注册到 Codex / Claude Code 后，IDE 助手可通过以下 MCP Tool 操控画布：
| Tool 名称 | 参数类型 | 返回数据结构 | 功能描述 |
| :--- | :--- | :--- | :--- |
| `canvas_get_state` | 无 | Canvas 所有的 nodes 和 connections JSON | 读取当前画布所有的节点拓扑关系与参数配置 |
| `canvas_get_selection` | 无 | 当前选中 node 的 ID 列表与详细数据 | 获知用户当前在界面中选择的节点 |
| `canvas_export_snapshot`| 无 | 画布 JSON 快照及元数据 | 导出当前画布完整快照 |
| `canvas_apply_ops` | `{ ops: CanvasOp[] }` | 变更是否成功的布尔状态 | 批量增加、删除、移动节点或操作连线 |
| `canvas_create_text_node`| `{ title, content, x, y }` | 新建文本节点详情 | 在指定坐标快速创建文本/提示词节点 |
| `canvas_create_image_prompt_flow` | `{ prompt, x, y, references? }` | 生图工作流节点拓扑 | 一键生成包含 Prompt、参考图输入、配置器与输出的连线组 |

---

## 💡 总结与展望

### 项目核心价值
**无限画布 (infinite-canvas)** 赋予 AI 创作更具**空间感 (Spatial)** 与**结构化 (Structured)** 的体验：
1. **链路追溯与分支探索**：每一次修改、重绘或衍生变体均保留在画布空间中，可随时基于任何中间节点分化出新的探索分支。
2. **完全本地与隐私保护**：API Key 及所有素材记录仅保留在浏览器本地 IndexedDB 中，安全无忧。
3. **AI Code + Vision 融合**：通过 MCP 协议让终端 IDE 成为画布共同操作者，真正实现“代码描述”与“视觉排版”的无缝同步。

### 社区与协议
*   **交流社区**：[Linux.do 社区](https://linux.do/)
*   **交流群聊**：[点击加入 AI 开源交流群](https://qm.qq.com/q/DFnKzZ807u)
*   **开源协议**：[GNU Affero General Public License v3.0](LICENSE)
