# 360° 全景图插件

插件名称、说明与贡献都在 [src/plugin.ts](./src/plugin.ts) 登记，节点实现在 [src/nodes/viewer.tsx](./src/nodes/viewer.tsx)。构建生成 `dist/client.js`，通过 npm 包安装。

```bash
pnpm --dir plugins/panorama dev
```

在 Web 或 CLI 的开发页面打开插件管理器启用，修改代码后刷新页面。发布前构建并运行 `pnpm pack`；尚未发布的包不能直接从公共源安装。

完整 API、主题及安装说明见 [插件开发文档](../../apps/docs/content/docs/development/plugin-development.mdx)。
