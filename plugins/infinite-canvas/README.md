# DSH FreeCanvas Codex Plugin

让 Codex 可以打开并操作 DSH FreeCanvas。

## 安装

macOS / Linux：

```bash
git clone https://github.com/JustinQiuck/dsh-freecanvas.git
cd dsh-freecanvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@dsh-freecanvas-local
```

Windows PowerShell：

```powershell
git clone https://github.com/JustinQiuck/dsh-freecanvas.git
cd dsh-freecanvas
codex plugin marketplace add "$PWD"
codex plugin add infinite-canvas@dsh-freecanvas-local
```

Windows CMD 将 `$PWD` 替换为 `%cd%`。

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 DSH FreeCanvas
```
