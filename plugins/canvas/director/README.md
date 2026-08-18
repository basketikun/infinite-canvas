# Director 导演台插件

Director 节点插件：

- 节点只展示项目摘要，不加载 Three.js；
- 双击节点或点击「打开导演台」进入全屏 Workspace；
- Workspace 当前无额外的宿主顶栏，Blockout Web 直接融入全屏区域，并通过自身顶栏返回画布；
- Workspace 通过 `infinite-canvas-director-v1` 发送 `INIT` 和接收 `CLOSE`；
- 每个节点通过独立的 `blockoutProjectId` 绑定一个 Blockout 项目；正式保存、自动保存和加载均走当前节点的插件存储；
- Director 通过 `ctx.getUpstreamResources()` 读取上游图片、视频、音频和文本，并在 Blockout Web 的 Reference Dock 中展示；
- Blockout Web 端通过 `window.blockout` 浏览器适配器与 Embed Bridge 通信，文件导入和导出仍保留给后续阶段。
