# 最小插件模板

一个笔记节点（`nodes`）和一个设置标签（`settings`），名称、说明、版本和作者写在 `plugin.json`，所有贡献在 `src/plugin.ts` 登记。其他扩展点见 [插件开发文档](../../apps/docs/content/docs/development/plugin-development.mdx)。

## 本地开发

复制本目录到仓库外，使用 Node.js 22 或更高版本和 pnpm 12。在仓库根目录生成 SDK 与 shared 的压缩包，或从 Package Plugins 工作流下载：

```sh
mkdir -p /tmp/canvas-sdk
pnpm --dir packages/shared pack --pack-destination /tmp/canvas-sdk
pnpm --dir packages/plugin-sdk pack --pack-destination /tmp/canvas-sdk
```

把压缩包放进复制出的目录的 `packages/`，并在 `pnpm-workspace.yaml` 中写入：

```yaml
packages: ["."]
overrides:
  '@infinite-canvas/plugin-sdk': file:./packages/infinite-canvas-plugin-sdk-1.0.0.tgz
  '@infinite-canvas/shared': file:./packages/infinite-canvas-shared-1.0.0.tgz
```

然后执行 `pnpm install`、`pnpm build`、`pnpm pack`，把生成的插件包放入软件源或在「设置 → 插件」上传安装。
