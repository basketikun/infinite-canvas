# 多格式渲染器

启用后在画布创建菜单中添加一个「内容渲染」节点，在编辑态顶部切换 HTML、Markdown 或 SVG 格式。

| 格式 | 用途 |
| --- | --- |
| [HTML](./src/nodes/html.tsx) | 在隔离的页面中预览 HTML，用 `{{input}}` 引用上游文本 |
| [Markdown](./src/nodes/markdown.tsx) | 切换源码编辑与排版预览，向下游提供原始文本 |
| [SVG](./src/nodes/svg.tsx) | 编辑 SVG 源码，在画布中展示矢量图形 |

从仓库根目录运行 `pnpm --dir plugins/multi-format-renderer dev`，然后在「设置 → 插件」启用「多格式渲染器」。通过 npm 软件源安装时使用包名 `canvas-plugin-multi-format-renderer`。

节点注册入口见 [src/plugin.ts](./src/plugin.ts)，节点类型为 `multi-format-renderer:document`，格式保存在节点的 `format` 字段。
