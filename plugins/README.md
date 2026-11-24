# 工作台插件

每个目录对应一个工作台插件。创建自己的插件从 [最小模板](./template/) 复制。插件身份由目录约定和代码中的名称说明决定，所有贡献统一在 `src/plugin.ts` 登记，具体实现按能力放入对应目录。详见 [插件开发文档](../apps/docs/content/docs/development/plugin-development.mdx)。

| 插件 | 用途 |
| --- | --- |
| [api-stats](./api-stats/) | 模型调用统计与调用详情 |
| [themes](./themes/) | 工作台与画布主题、侧栏布局、自定义配色与导航入口 |
| [multi-format-renderer](./multi-format-renderer/) | 多格式渲染器：HTML、Markdown、SVG 编辑与预览 |
| [panorama](./panorama/) | 3D 全景图节点 |
| [director-desk](./director-desk/GUIDE.md) | 三维摆位、机位取景、环绕镜头布局与分镜回传 |
| [webdav-sync](./webdav-sync/GUIDE.md) | WebDAV 连接与工作区数据同步 |

开发单个工作台插件可运行其目录的 `pnpm dev`。在仓库根目录运行 `pnpm build:node-plugins` 可以一起构建多格式渲染器和全景两个节点插件。[手动打包工作流](../.github/workflows/publish-plugins.yml) 分别提供各个正式 npm 包和最小插件模板。

在本地预览导演台和 WebDAV 同步，运行 `pnpm --filter canvas-plugin-director-desk --filter canvas-plugin-webdav-sync run build`，刷新开发工作台，再到「设置 → 插件」分别启用。
