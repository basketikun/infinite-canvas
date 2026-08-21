<p align="center">
  <img src="web/public/logo.svg" width="96" alt="DSH FreeCanvas logo">
</p>

<h1 align="center">DSH FreeCanvas</h1>

<p align="center">直接运行在 DSH 内的 AI 无限画布插件</p>

<p align="center">
  <a href="https://github.com/JustinQiuck/dsh-freecanvas"><img src="https://img.shields.io/github/stars/JustinQiuck/dsh-freecanvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/JustinQiuck/dsh-freecanvas/tags"><img src="https://img.shields.io/github/v/tag/JustinQiuck/dsh-freecanvas?style=flat-square&label=version" alt="Version"></a>
  <a href="LICENSING.md"><img src="https://img.shields.io/badge/license-Mixed-f97316?style=flat-square" alt="Mixed licenses"></a>
  <img src="https://img.shields.io/badge/DSH-plugin-2563eb?style=flat-square" alt="DSH plugin">
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.zh-CN.mdx">快速开始</a> · <a href="docs/content/docs/overview/features.zh-CN.mdx">功能介绍</a> · <a href="docs/content/docs/canvas/canvas-node-manual.zh-CN.mdx">操作手册</a> · <a href="plugins/dsh-freecanvas/README.md">插件说明</a> · <a href="https://github.com/JustinQiuck/dsh-freecanvas/issues">问题反馈</a> · <a href="CHANGELOG.md">更新日志</a>
</p>

DSH FreeCanvas 为 DeepSeek Harness 提供画布编排、AI 图片与视频生成、参考图编辑、对话助手、提示词库和素材管理。插件随包携带画布前端，并由 DSH 托管本地 Canvas Agent；安装后直接从 DSH 侧边栏使用，无需单独启动 Vite、Docker 或 Web 服务。

## 项目信息

- **产品形态**：安装到 DSH 的自包含画布插件。
- **运行入口**：从 DSH 侧边栏打开，支持会话、分屏和全画布布局。
- **Agent 能力**：由插件管理本地 Canvas Agent，并通过 MCP 操作当前画布。
- **数据边界**：画布、素材、生成记录和 API Key 默认保存在浏览器本地。
- **接口方式**：浏览器直接请求用户配置的 OpenAI 兼容接口。
- **维护状态**：DSH 集成已经完成，本仓库继续维护兼容、功能和发布记录。

> [!CAUTION]
> 项目仍在持续迭代，不保证历史数据格式长期兼容。升级前请备份重要画布数据。

## 在 DSH 中使用

1. 打开 DSH 插件市场。
2. 搜索并安装 **DSH FreeCanvas**。
3. 从 DSH 侧边栏打开 FreeCanvas。
4. 在画布设置中填写自己的 `Base URL`、`API Key` 和模型。

插件已包含运行所需的画布资源和 Agent 连接。普通用户不需要克隆本仓库，也不需要部署独立站点。

从源码调试插件或参与开发，请阅读 [插件源码说明](plugins/dsh-freecanvas/README.md) 和 [本地开发文档](docs/content/docs/development/local-development.zh-CN.mdx)。

## 核心功能

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做和导入导出。
- AI 创作：支持文生图、图生图、参考图编辑、文本问答、音频和视频生成。
- 画布助手：围绕选中节点与上游节点对话，并把结果插回画布。
- DSH Agent：通过 Canvas Agent 和 MCP 读取、创建与修改当前画布内容。
- DSH 布局：支持会话、分屏和全画布模式，并保存布局偏好。
- 节点插件：支持安装远程节点插件，并提供 TypeScript SDK。
- 提示词与素材：集中管理提示词、生成记录和浏览器本地素材。

完整能力见 [功能介绍](docs/content/docs/overview/features.zh-CN.mdx)。

## 项目入口

- [DSH 插件说明](plugins/dsh-freecanvas/README.md)
- [项目文档](docs/index.zh-CN.md)
- [问题反馈](https://github.com/JustinQiuck/dsh-freecanvas/issues)
- [更新日志](CHANGELOG.md)
- [安全策略](SECURITY.md)

## 致谢

本项目基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 进行集成与适配。感谢原作者 [@basketikun](https://github.com/basketikun) 及所有源项目贡献者。

## 许可证

本仓库采用分组件授权。上游衍生画布代码与未单独声明的组件继续使用根目录 [MIT License](LICENSE)；`plugins/dsh-freecanvas` 从 `v0.2.0` 起使用 [Elastic License 2.0](plugins/dsh-freecanvas/LICENSE)，并保留上游 MIT 声明。详见 [LICENSING.md](LICENSING.md)。
