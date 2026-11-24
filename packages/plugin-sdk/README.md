# 插件 SDK

无限画布工作台插件的开发包，提供 `definePlugin`、扩展点、命令、类型定义、界面控件与构建脚本。

完整的开发、调试与发布说明见 [插件开发文档](../../apps/docs/content/docs/development/plugin-development.mdx)，最小示例见 [plugins/template](../../plugins/template/)，更多实现见 [plugins/](../../plugins/)。

## 导入路径

| 路径 | 内容 |
| --- | --- |
| `@infinite-canvas/plugin-sdk` | `definePlugin`、`contribute`、`defineCommand`、`defineExtensionPoint`、`defineCapability` 与全部类型 |
| `@infinite-canvas/plugin-sdk/builtin` | 内置扩展点、公开命令与宿主能力 |
| `@infinite-canvas/plugin-sdk/ui/<组件名>` | 与工作台一致的 shadcn/ui 控件 |
| `@infinite-canvas/plugin-sdk/build` | `buildPlugin(import.meta.url)` 构建脚本 |
