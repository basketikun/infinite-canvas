# Director 导演台插件

Phase 2 的 Director 节点壳：

- 节点只展示项目摘要，不加载 Three.js；
- 双击节点或点击「打开导演台」进入全屏 Workspace；
- Workspace 当前使用内嵌 iframe 测试页面，并展示当前 `nodeId` / `projectId`；
- 下一阶段再接入 Blockout Web 和 `postMessage` Bridge。
