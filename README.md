<p align="center">
  <img src="web/public/logo.svg" width="96" alt="infinite-canvas logo">
</p>

<h1 align="center">无限画布 (infinite-canvas)</h1>

无限画布是一款面向图片创作的开源工作台。它把画布编排、AI 图片生成、参考图编辑、对话助手、提示词库和素材沉淀放在同一个界面里，适合用来探索视觉方案并连续迭代图片结果。

> [!CAUTION]
> 项目目前处于开发阶段，不保证历史数据兼容。各种数据库结构和存储格式都可能直接调整，欢迎关注后续更新，当前更适合个人/本地部署，不建议直接公网多人共用。
>
> 如果你需要稳定维护自己的分支，建议自行 fork 后独立开发。二次开发与 PR 请保留原作者信息和前端页面标识。

## 核心功能

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- AI 创作：支持 OpenAI 兼容接口的文生图、图生图、参考图编辑和文本问答。
- 画布助手：围绕选中节点和上游节点对话、生图，并把结果插回画布。
- 提示词库：抓取多个 GitHub 开源项目，按案例整理数百个图片提示词。

完整功能说明见 [docs/features.md](docs/features.md)。

如果你在为担心没有合适的生图API来发愁，可以查看该免费生图项目：[chatgpt2api](https://github.com/basketikun/chatgpt2api)

## 技术栈

- 前端：Next.js、React、TypeScript、Tailwind CSS、Ant Design、Zustand、TanStack Query。
- 后端：Go、Gin、GORM。
- 部署：Docker。

## 快速开始

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/basketikun/infinite-canvas)

```bash
git clone git@github.com:basketikun/infinite-canvas.git
cd infinite-canvas
cp .env.example .env
# 修改默认账号密码等信息
docker-compose up -d
```

本地源码构建运行：

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up -d --build
```

运行后默认端口3000，可访问 `http://localhost:3000`。

如需要拉取提示词，可前往:`http://localhost:3000/admin/prompts`

## New API 自动配置

如果使用 New API，可在 `系统设置 -> 聊天方式 -> 添加聊天设置` 中填入：

```text
https://infinite-canvas-cpco.onrender.com?apiKey={key}&baseUrl={address}
```

跳转后会自动打开配置弹窗并填入 API Key 和 Base URL。
如果自己部署了，可以把 `https://infinite-canvas-cpco.onrender.com` 替换成你部署的地址。

## 效果展示

<table width="100%">
  <tr>
    <td width="50%"><img src="https://i.ibb.co/TDFvGWDT/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/zVwJq3YS/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/PvY3qhhK/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/7D04LwN/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/bj30FtS5/5.png" alt="5" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/hxRvjw51/image.png" alt="image" border="0"></td>
  </tr>
</table>

## 文档

- [功能介绍](docs/features.md)
- [部署说明](docs/deployment.md)
- [画布节点操作手册](docs/canvas-node-manual.md)
- [画布快捷键](docs/canvas-shortcuts.md)
- [待办事项](docs/todo.md)
- [后端数据库说明](docs/backend-database.md)
- [系统配置数据结构](docs/system-settings.md)
- [接口响应约定](docs/api-response.md)

## 社区支持

学 AI，上 L 站：[LinuxDO](https://linux.do/)

点击链接加入群聊【AI开源交流】：https://qm.qq.com/q/DFnKzZ807u

## 开源协议

本项目使用 GNU Affero General Public License v3.0，见 [LICENSE](LICENSE)。

## Star History

<a href="https://www.star-history.com/?repos=basketikun%2Finfinite-canvas&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&legend=top-left" />
 </picture>
</a>
