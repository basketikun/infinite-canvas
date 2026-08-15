# Director 导演台插件

Phase 2 的 Director 节点壳：

- 节点只展示项目摘要，不加载 Three.js；
- 双击节点或点击「打开导演台」进入全屏 Workspace；
- Workspace 当前无额外的宿主顶栏，Blockout Web 直接融入全屏区域，并通过自身顶栏返回画布；
- Workspace 通过 `infinite-canvas-director-v1` 发送 `INIT` 和接收 `CLOSE`；
- Blockout Web 端已创建 `window.blockout` 浏览器适配器，文件与导出请求暂由 Embed Bridge 转发。
