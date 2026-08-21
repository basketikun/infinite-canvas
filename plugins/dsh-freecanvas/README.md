# dsh-plugin-freecanvas

DSH FreeCanvas 是直接运行在 DeepSeek Harness 内的自包含画布插件，提供侧边栏入口、会话/分屏/画布三种布局，以及本地 Canvas Agent 自动连接。

## 功能

- 在 DSH 侧边栏增加「DSH FreeCanvas」入口。
- 画布前端随插件包发布，由 DSH 同源提供，安装后不需要另行启动 Web 服务。
- 支持会话、分屏和全画布模式，并保存分屏比例。
- 使用随包安装的 `@basketikun/canvas-agent` 自动启动本地 Agent HTTP 服务，不在运行时临时下载脚本。
- 可选配置外部画布地址，仅用于开发调试。
- 可配合 `@deepseek-ai/dsh-mcp-client` 将画布 MCP 工具注册给 DSH agent。

## 在 DSH 中使用

在 DSH 插件市场搜索并安装 **DSH FreeCanvas**，然后从侧边栏打开。插件已经包含构建后的画布，普通用户不需要克隆仓库、启动 Docker 或开放本地 3000 端口。

## 源码开发

调试插件时，从仓库源码目录安装依赖并生成插件内置资源：

```bash
npm --prefix web install --legacy-peer-deps
npm --prefix plugins/dsh-freecanvas install --no-package-lock --legacy-peer-deps
npm --prefix plugins/dsh-freecanvas run build:web
dsh plugin --profile desktop add ./plugins/dsh-freecanvas
```

执行 `npm pack` 或发布插件时会通过 `prepack` 自动运行同一构建流程，并把生成的 `web/` 静态资源加入包内。

本包通过 `dsh.bundle.patch` 自动插入 `ui-dsh-freecanvas`，不要在 profile 的 `cordis.patch.yml` 中重复声明同一个 id。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `canvasUrl` | 空 | 留空使用插件内置画布；填写后改为代理指定的外部画布服务 |
| `autoStartAgent` | `true` | 随 DSH 自动启动本地 Canvas Agent HTTP 服务 |

可以在 DSH 设置的插件配置中修改，也可以在 profile 补丁中配置：

```yaml
- id: ui-dsh-freecanvas
  name: dsh-plugin-freecanvas
  config:
    autoStartAgent: true
```

普通用户保持 `canvasUrl` 为空。只有调试外部画布时才填写地址，例如 `canvasUrl: http://127.0.0.1:3000`。浏览器仍通过 DSH 同源路由加载，不会直接导航到跨域 iframe。

## Agent 操作画布

若需要让 DSH agent 直接读取和修改画布，请在同一 profile 中配置 `@deepseek-ai/dsh-mcp-client`，连接 Canvas Agent 的 MCP 入口：

```yaml
- id: mcp-dsh-freecanvas
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: freecanvas
    transport: stdio
    command: npx
    args: ['-y', '@basketikun/canvas-agent@0.6.0', 'mcp']
```

DSH FreeCanvas 基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 集成与适配，感谢原作者及所有贡献者。

## License

`dsh-plugin-freecanvas` 从 `v0.2.0` 起采用 [Elastic License 2.0](./LICENSE)。该协议允许在协议范围内使用、复制、修改和分发插件，但不允许将其作为托管服务提供给第三方，也不允许规避或移除许可证密钥功能。

历史 `v0.1.0` 的已有授权不因后续版本更改而被追溯撤回。上游 MIT 组件仍按其原协议授权，详见 [LICENSING.md](./LICENSING.md) 与 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。未来的 Pro 功能不属于当前公开 bundle，将在发布时使用独立商业 EULA。
