# AGENTS.md

本文档用于约束本项目中的 AI / 自动化开发行为。开发时优先遵循本文件，其次遵循用户当前消息。

## 基本原则

- 先读现有代码，再动手修改，优先沿用项目已有结构和写法。
- 写代码保持最少行数，能简单实现就不要引入复杂抽象。
- 标准格式、协议、解析、压缩、加密、日期等通用能力优先使用成熟稳定的库，不要手写底层实现，除非用户明确要求或项目已有实现必须沿用。
- 不要为了“兼容更多场景”写大量分支，只实现当前明确需要的功能。
- 项目尚未上线，不需要兼容旧数据；本地存储结构调整时直接按新设计修改，不写旧字段兼容或数据迁移兜底，除非用户明确要求。
- 每次写完代码，不需要检查语法，不需要执行构建，用户会自己做。
- 不要改无关文件，不要顺手重构。
- 如果工作区已有用户改动，不要回滚，不要覆盖；只在必要范围内追加修改。

## 反复提醒沉淀

- 如果开发过程中总是遇到某个问题，或者用户反复提醒同一个注意事项，需要把该注意事项补充到本文件。
- 补充时写成明确、可执行的规则，避免只写模糊描述。
- 新规则应放到最相关的章节；找不到合适章节时放到“项目注意事项”。

## 前端规范

- 前端使用 Vite、React、React Router、TypeScript、Ant Design、Tailwind、Zustand。
- 编写 Ant Design 相关代码时，参考 https://ant.design/llms-full.txt 理解组件 API、示例和设计规范，并优先结合项目当前 antd 版本与既有写法。
- 外部服务请求统一放在 `web/src/services/api/`，由浏览器前端直连，不假设存在项目后端。
- 全局或跨页面状态优先放在 `web/src/stores/`。
- 已经放在全局 store 或全局 hook 中的状态/动作，组件需要时直接使用对应 store/hook，不要为了“纯组件”层层透传 props；避免一个组件传递过多参数。
- 全局组件、全局常量、全局配置等全局性质的内容不要作为 props 或参数层层传递；哪里需要就在哪里直接从对应全局入口获取。
- 多个页面重复出现的 UI 副作用动作，例如复制文本并提示、下载并提示、统一确认弹窗，优先抽成 `web/src/hooks/` 下的全局 hook；不要放进 store，除非它确实是需要共享/订阅的状态。
- 路由页面放在 `web/src/pages/`，页面布局放在 `web/src/layouts/`，路由配置放在 `web/src/router.tsx`。
- 画布页面放在 `web/src/pages/canvas/`，画布组件放在 `web/src/components/canvas/`，画布状态放在 `web/src/stores/canvas/`，画布工具函数放在 `web/src/lib/canvas/`。
- 页面按目录组织，例如 `web/src/pages/image/index.tsx`；页面里只有一个主业务组件时直接写在对应页面入口中，不要单独拆 `Manager` 组件再传一堆 props。
- 不要新增只做简单转发的组件，例如只 `return <X>{children}</X>` 或只换个名字透传 props；直接在使用处使用真实组件或把逻辑写进当前文件。
- 页面私有 hook 放在对应页面目录下，例如 `admin/assets/use-admin-assets.ts`；只有多个页面真实复用的 hook 才放到外层 `hooks/`。
- 管理后台页面私有组件放到各自页面目录的 `components/` 下，例如 `admin/assets/components/`、`admin/prompts/components/`；不要为了单页面使用放到 `admin/components/` 共享目录。
- 管理后台主题、背景、卡片阴影、表格配色等统一在 `web/src/lib/app-theme.ts`、`AppProviders` 或必要的全局 CSS 作用域中配置；页面私有组件不要自己写 `dark ? ...` 主题分支。
- 组件优先使用函数组件和现有 hooks，不新增大型状态管理方案。
- UI 图标优先使用 `lucide-react` 或项目已经使用的 Ant Design 图标。
- 页面文案保持中文。
- 不要在组件里堆太多无关逻辑；复杂逻辑优先抽成同目录工具函数或小组件。
- 样式优先由组件自己管理；组件私有样式优先使用 Tailwind className 或少量内联 style，不要为单个组件新增大量全局 CSS。
- 全局 CSS 只放基础变量、全局重置、跨页面通用样式和少量第三方组件必要覆盖；不要在 `globals.css` 堆页面私有样式。
- 代码尽量短小直接，少拆不必要组件，少做多层 props 传递，避免为了抽象堆出更多代码。
- 前端业务数据需要浏览器本地持久化时，默认使用 `localforage`；`localStorage` 只用于极小的简单配置，不要用来保存业务列表、生成记录、图片、base64 或大 JSON。

## 画布 UI 规范

- 做 canvas 前端 UI 时必须遵循当前画布主题。
- 优先使用 `canvasThemes`、`useThemeStore` 或 Ant Design `ConfigProvider` token。
- 不要硬编码黑白、stone、slate 等颜色导致浅色/深色主题不一致。
- 新增画布按钮、弹窗、浮层时，尽量复用已有工具栏、节点面板、Modal 的视觉风格。
- 画布顶部工具栏和状态信息优先采用极简扁平风格：无边框、无阴影、无胶囊背景，融入整体背景，弱化按钮感，仅保留轻微 hover 反馈，保持简洁现代、低视觉重量。
- 图片节点尺寸逻辑要尊重原始比例，除非功能明确要求自由变形。
- 批量生成、多图展示、助手面板等画布交互要尽量简洁，不要占用过多画布空间。

## 文档规范

- README 保持简洁，只放项目介绍、核心功能、快速开始和文档入口。
- `docs/index.md` 放给 AI 使用的文档索引，不要再放到 `docs/content/docs/` 内容目录里。
- 详细功能介绍写到 `docs/content/docs/overview/features.mdx`。
- 后续待办写到 `docs/content/docs/progress/todo.mdx`。
- 已实现但还需要用户测试确认的事项写到 `docs/content/docs/progress/pending-test.mdx`。
- `docs/content/docs/progress/pending-test.mdx` 用来记录这个版本实际做了哪些可测试变更；`CHANGELOG.md` 的 `Unreleased` 只保留对这些变更的版本级归纳，避免逐条照搬实现细节。
- 每次重大改动（新增/调整/删除功能、接口或工具，影响用户可感知行为）完成后，都要在 `CHANGELOG.md` 的 `Unreleased` 追加一条记录，按 `[新增]` / `[调整]` / `[修复]` / `[优化]` 前缀分类，用一句中文归纳；纯内部重构、格式化、无用户可感知影响的小改动可不记。
- 每次 todo 事项完成后，先从 `docs/content/docs/progress/todo.mdx` 移到 `docs/content/docs/progress/pending-test.mdx`，不要直接写进正式功能说明；用户确认测试通过后再更新 `docs/content/docs/overview/features.mdx`。
- 每次任务完成前，都要根据实际变更检查并更新 `docs/content/docs/progress/todo.mdx` 和 `docs/content/docs/progress/pending-test.mdx`；如果功能或待办没有变化，也要确认无需修改。
- 文档不要写过期日期；除非用户明确要求记录具体时间。

## 发版本流程

- 发版本时，先把 `CHANGELOG.md` 的 `Unreleased` 变更整理成新的版本记录，并保留空的 `Unreleased` 标题。
- 按当前版本号提升一个版本，更新根目录 `VERSION`。
- 将当前未提交的代码全部提交到 Git。
- 提交完成后，给当前提交打最新版本号对应的 tag，例如 `v0.0.5`。
- 发版本流程中不要执行编译、测试或构建，除非用户明确要求。

## 项目注意事项

- 当前画布项目和“我的素材”主要保存在浏览器本地，不要在文档中误写成已支持云同步。
- 当前 AI API Key 存在浏览器本地，并由前端直接请求 OpenAI 兼容接口；涉及安全说明时要写清楚。
- Docker 静态资源路径目前仍是待办项，文档中不要过度承诺生产部署已经完全验证。
