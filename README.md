<p align="center">
  <img src="web/public/logo.svg" width="96" alt="CoResearch logo">
</p>

<h1 align="center">CoResearch</h1>

<p align="center">
  <a href="https://render.com/deploy?repo=https://github.com/Zhanghoks/Research-canvas"><img src="https://img.shields.io/badge/Render-Deploy-46e3b7?style=flat-square&logo=render&logoColor=111111" alt="Deploy to Render"></a>
  <a href="https://github.com/Zhanghoks/Research-canvas"><img src="https://img.shields.io/github/stars/Zhanghoks/Research-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/Zhanghoks/Research-canvas/tags"><img src="https://img.shields.io/github/v/tag/Zhanghoks/Research-canvas?style=flat-square&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f97316?style=flat-square" alt="License"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://reactrouter.com/"><img src="https://img.shields.io/badge/React_Router-7-ca4245?style=flat-square&logo=reactrouter&logoColor=white" alt="React Router"></a>
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> · <a href="docs/content/docs/overview/features.mdx">功能介绍</a> · <a href="docs/content/docs/overview/render.mdx">Render 部署</a> · <a href="docs/content/docs/overview/docker.mdx">Docker 部署</a> · <a href="docs/content/docs/canvas/canvas-node-manual.mdx">画布节点操作手册</a> · <a href="docs/content/docs/canvas/canvas-shortcuts.mdx">画布快捷键</a> · <a href="SECURITY.md">漏洞提交</a> · <a href="docs/content/docs/progress/todo.mdx">待办事项</a> · <a href="canvas-agent/README.md">本地 Canvas Agent</a>
</p>

CoResearch 是一款面向研究工作流的开源画布工具。它把研究实体、框架、问题、笔记、PDF 与网页素材放在同一张可无限缩放的画布上，配合内置的 AI Agent 面板，帮助你从零散的研究线索逐步梳理出结构化的分析成果。

> [!CAUTION]
> 项目目前处于开发阶段，不保证历史数据兼容。各种本地存储格式都可能直接调整，欢迎关注后续更新。

## 核心功能

- 无限画布：多项目管理、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- 研究节点：研究实体、框架、问题、便签、PDF、网页等多种节点类型，围绕研究线索自由编排。
- AI Agent 面板：与选中节点及上游节点对话，辅助梳理、总结、拓展研究内容，并把结果写回画布。
- 本地 Agent：通过本机 Canvas Agent 连接 Codex / Claude Code，让 Agent 通过 MCP 直接操作当前画布。
- 插件系统：支持通过 URL 动态安装 / 启用 / 更新 / 卸载远程节点插件，并提供 TypeScript SDK 自行开发画布节点插件。
- 自定义接口调用：可自定义 AI 接口的调用方式，灵活适配各类中转站与自建服务。

完整功能说明见 [功能介绍](docs/content/docs/overview/features.mdx)。

## 快速开始

AI API Key、Base URL、画布与项目数据默认保存在浏览器本地。

### 本地开发

```bash
git clone git@github.com:Zhanghoks/Research-canvas.git
cd Research-canvas
cd web
bun install
bun run dev
```

### Docker 运行

```bash
git clone git@github.com:Zhanghoks/Research-canvas.git
cd Research-canvas
docker compose up -d
```

运行后默认端口 3000，可访问 `http://localhost:3000`。

首次打开后进入右上角配置，填入自己的 OpenAI 兼容 `Base URL` 和 `API Key`。

## 开源协议

本项目使用 [MIT License](LICENSE)。任何人都可以免费使用、复制、修改、分发、再授权和商业使用本项目，也可以用于闭源产品。

## Star History

<a href="https://www.star-history.com/?repos=Zhanghoks%2FResearch-canvas&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Zhanghoks/Research-canvas&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Zhanghoks/Research-canvas&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Zhanghoks/Research-canvas&type=date&legend=top-left" />
 </picture>
</a>
