# Infinite Canvas Plugin

让 Codex / ZCode 可以打开并操作 Infinite Canvas。

## 安装

### Codex

```bash
codex plugin marketplace add basketikun/infinite-canvas --sparse .agents/plugins --sparse agent-plugins/infinite-canvas
codex plugin add infinite-canvas@infinite-canvas-local
```

更新插件运行 `codex plugin marketplace upgrade infinite-canvas-local`。

### ZCode

- 打开 **Settings → Plugin Management → Discover**，点击右上角 **`+`** 添加 marketplace。
- 选择仓库中的 `agent-plugins/infinite-canvas/` 目录（包含 `marketplace.json`），找到 `infinite-canvas` 后安装。
- 或在 ZCode 界面直接以本地目录方式加载该插件目录。

安装后新建一个任务，然后输入：

```text
帮我打开并连接到 Infinite Canvas
```
