# Infinite Canvas Codex Plugin

这个插件把 Infinite Canvas 的本地 Canvas Agent MCP 打包给 Codex app 使用，让 Codex 能打开本地画布、读取当前节点、创建内容并触发生成流程。

## 安装

### AI 自动安装

把下面这段发给 Codex：

```text
请从 https://github.com/basketikun/infinite-canvas.git 安装 Infinite Canvas Codex 插件。
请 clone 仓库到 ~/plugins/infinite-canvas，确认 plugins/infinite-canvas/.codex-plugin/plugin.json 存在，
把 plugins/infinite-canvas 加入 personal marketplace，先运行 codex plugin marketplace add ~，
再运行 codex plugin add infinite-canvas@personal。
安装后请校验插件，并告诉我是否需要开启一个新对话来加载新技能和 MCP 工具。
```

### 手动安装

推荐把仓库 clone 到 Codex personal marketplace 默认会引用的位置：

```bash
mkdir -p ~/plugins
git clone https://github.com/basketikun/infinite-canvas.git ~/plugins/infinite-canvas
```

确保 `~/.agents/plugins/marketplace.json` 中有 Infinite Canvas 条目，注意 `path` 指向仓库里的插件子目录：

```json
{
  "name": "personal",
  "interface": {
    "displayName": "Personal"
  },
  "plugins": [
    {
      "name": "infinite-canvas",
      "source": {
        "source": "local",
        "path": "./plugins/infinite-canvas/plugins/infinite-canvas"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

然后注册 personal marketplace 并安装插件：

```bash
codex plugin marketplace add ~
codex plugin add infinite-canvas@personal
```

安装后建议开启一个新的 Codex 对话，让新的 skill 和 MCP 工具完整加载。

安装 Codex 插件后会加载 `infinite-canvas` MCP。这个 MCP 内置工具较多，会增加 Codex 上下文和 token 消耗；不使用插件时建议移除插件：

```bash
codex plugin remove infinite-canvas
```

如果你另外手动执行过 `codex mcp add`，再移除手动添加的 MCP：

```bash
codex mcp remove infinite-canvas
```

### 本仓库开发调试

如果你就在 Infinite Canvas 仓库中调试插件，可以直接添加仓库自带 marketplace。建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

## 使用

1. 新建 Codex 线程后说“打开 Infinite Canvas”。
2. 插件会确认当前仓库的本地画布服务是否已运行；端口被占用时会检查进程归属，不会把其他项目的 `3000` 当作 Infinite Canvas。
3. 确认或启动后，插件会直接打开新建画布 URL，并自动尝试连接本地 Agent。
4. 画布打开后，让 Codex 读取或操作当前画布。

常用提示：

```text
打开 Infinite Canvas
读取当前画布并总结节点结构
根据选中节点创建一组生图提示词
```

## 工作机制

插件默认通过以下命令启动 MCP；这个命令只提供 MCP 工具，不会把 MCP 写入全局配置，也不会在退出时自动卸载。需要打开画布时，`open-canvas` 技能会另外启动本地 Agent：

```bash
npx -y @basketikun/canvas-agent mcp
```

## 手动排查

优先本地启动画布：

```bash
cd web
bun install
bun run dev
```

然后启动本地 Agent。端口不是 `3000` 时，把 `CANVAS_URL` 换成真实本地画布地址：

```bash
CANVAS_URL=http://localhost:3000 npx -y @basketikun/canvas-agent
```

手动排查时先从 Agent 输出或 `http://127.0.0.1:17371/config` 读取本地地址和 token，然后直接打开 `<画布网页地址>/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>`。不要通过页面点击来新建画布；`mode=new` 会让网页自动创建具体画布并连接本地 Agent。
