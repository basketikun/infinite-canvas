# 无限画布桌面版

从仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm dev:desktop
```

桌面版通过 Electron 窗口打开 CLI 工作台，源码开发直接使用 CLI 的 Vite 热更新。默认使用与 CLI 相同的 `~/.infinite-canvas/workspace` 和端口 17371。使用其他工作区可运行 `pnpm dev:desktop --data-dir /绝对路径 --port 17372`。同一工作区只能由一个服务打开；先退出 CLI 或桌面版，再切换入口。

项目、素材、模型渠道、插件和 MCP 连接都由同一个本地服务处理。窗口关闭且允许离开后，桌面版等待服务退出并释放目录。关闭窗口时，如果画布或设置仍在保存，可以返回工作台等待，或选择放弃修改。

启动受插件影响时，退出原进程后使用 `pnpm dev:desktop --skip-plugins` 打开原工作区，本次跳过第三方插件并保留数据和启用选择。进入插件设置后逐个重新启用；相关视频任务保持暂停，确认插件可用后再继续。

运行 `pnpm build:desktop` 会先构建 CLI，再为当前系统和架构打包桌面应用到 `apps/desktop/dist/`。应用包含 CLI 的正式界面、服务及其运行依赖。首次开发启动或打包需要下载对应平台的 Electron。签名、安装程序和自动更新尚待发行阶段处理。
