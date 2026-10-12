# 让 AI 安装并连接 Blender MCP

把本文件发给有本机终端能力的 AI，并附上：

> 请按这份说明检查我的 Blender 和 AI 客户端，帮我安装并连接 Blender MCP。修改配置前说明影响，只配置我正在使用的客户端，最后读取真实场景验证连接，不要修改场景或启动渲染。

上游仓库：https://github.com/ahujasid/mcp-for-blender

以下步骤依据上游 README；执行前重新查看上游说明及命令帮助，以实际版本为准。本项目不捆绑该第三方插件，也未验证它在所有系统和 Blender 版本上的安装效果。

## 给 AI 的执行规则

- 必须有用户电脑的 shell 权限。远程容器的 localhost 不是用户电脑；纯聊天 AI 只能指导操作，不得声称已安装。
- 先检测 Blender、`uv` / `uvx`、当前 AI 客户端及已有 MCP 配置。只在无法确定客户端或 Blender 版本时询问用户。
- 安装第三方包、启用可执行 Python 的插件、修改客户端配置前说明影响并取得授权。保留现有配置，不覆盖其他 MCP 服务；修改前备份，不静默替换同名 `blender` 服务。
- 不关闭用户正在使用的 Blender、浏览器或 AI 客户端。需重启时提示用户先保存工作并自行确认。
- 不把安装完成、端口可连接或 MCP 名称出现在列表中当成场景连接成功。

## 1. 检查前置环境

上游列出的最低要求为 Blender 3.0+、Python 3.10+、uv。实际安装前以当前上游版本要求为准。

```sh
uv --version
uvx --version
```

没有 uv 时参考官方安装文档：https://docs.astral.sh/uv/getting-started/installation/

选择适合当前系统的安装方式并取得用户授权；不要擅自绕过执行策略或直接执行尚未查看的远程脚本。安装后确认 AI 客户端进程也能找到 `uvx`；GUI 客户端 PATH 不同时使用检测到的绝对路径，不猜用户目录。

## 2. 推荐：使用上游自动配置

```sh
uvx mcp-for-blender setup
```

按上游说明，该命令检测支持的客户端，提供选择，安装并启用 Blender 插件，并备份被修改的配置文件。支持的客户端包括 Claude Desktop、Claude Code、Codex、Cursor、VS Code 等。

**这是交互式配置。** AI 的终端支持交互时按用户授权选择客户端；不支持交互时不要猜答案、管道输入固定选择或编造 `--yes` 参数。可以让用户在本机终端运行这一条命令，或采用下面的分步方式。不要把其他命令的 `--dry-run` 标志套用到 setup。

自动配置完成后不要再次运行下面的注册命令造成重复配置；直接检查实际结果。

## 3. 分步安装方式

### 安装 Blender 插件

```sh
uvx mcp-for-blender addon-paths
uvx mcp-for-blender install-addon
```

先检查检测到的 Blender 插件路径。多个版本并存时确定目标，不批量修改所有安装；上游支持通过 `BLENDERMCP_ADDONS_DIR` 指定插件目录，设置语法依操作系统而定。

单独执行 `install-addon` 后，在 Blender 的 Preferences → Add-ons 中查找并启用 **Interface: MCP for Blender**。如果未出现，按上游说明重新加载或在保存工作后重启 Blender；也可以从仓库取得 `addon.py`，经查看和授权后通过 Blender 的插件安装入口安装。

上游说明插件在 Blender 启动时自动启动 socket 服务。把鼠标放在 3D 视口，按 **N** 打开侧栏，查看 MCP 面板状态，必要时点击 **Start MCP Server**。以实际插件 UI 为准。

### 注册到当前 AI 客户端

先查看当前客户端的 MCP 列表和命令帮助。以下来自上游示例；已存在同名服务时检查而不是覆盖。

Claude Code：

```sh
claude mcp add blender uvx mcp-for-blender
```

Codex：

```sh
codex mcp add blender -- uvx mcp-for-blender
codex mcp list
```

Claude Desktop 等 JSON 配置客户端：把下面的服务项合并进原来的 `mcpServers`，不是替换整个文件：

```json
{
  "mcpServers": {
    "blender": {
      "command": "uvx",
      "args": ["mcp-for-blender"],
      "env": { "DISABLE_TELEMETRY": "true" }
    }
  }
}
```

Codex 手动配置的对应结构为：

```toml
[mcp_servers.blender]
command = "uvx"
args = ["mcp-for-blender"]
env = { DISABLE_TELEMETRY = "true" }
```

Codex 使用 `~/.codex/config.toml` 或 `$CODEX_HOME/config.toml`，以当前客户端为准。CLI 注册时也应通过客户端支持的环境变量选项设置 `DISABLE_TELEMETRY=true`；先检查帮助确认语法。自动 setup 后同样检查该设置，不假设它默认关闭遥测。

新版包名为 `mcp-for-blender`；上游说旧的 `blender-mcp` 命令仍可用。不要因此重复安装两个 MCP 服务。

## 4. 连接与验收

```text
AI 客户端
  → stdio MCP（客户端自动启动 uvx mcp-for-blender）
  → Blender 插件 TCP socket（默认 localhost:9876）
  → 当前 Blender 场景
```

1. Blender 插件服务处于运行状态。
2. 让 AI 客户端重新加载 MCP；若需要完整重启，先让用户保存会话并确认。配置文件已写入不代表当前 AI 会话已加载工具。
3. 客户端管理 MCP 子进程，不额外在终端启动一份相同服务。
4. 查看当前实际加载的 Blender 工具清单，调用只读的场景信息工具，读取场景名、对象名或对象数量。不要猜工具名，不用删除默认立方体、生成物体或渲染来测试连接。
5. 报告插件状态、客户端注册状态、真实场景读取结果和未完成步骤。遇到错误先检查插件、进程 PATH、端口与客户端日志，不无条件重装或重复启动。

默认连接主机与端口可由 `BLENDER_HOST`、`BLENDER_PORT` 调整，但先核对 Blender 插件实际监听配置；不要为了排错擅自对外开放端口。

## 5. 安全与隐私

- 这是社区项目，不是 Blender 官方集成。它可在 Blender 内执行 Python，可能修改场景及本机文件；使用可信任务并先保存工作。
- 上游描述 socket 没有认证和加密，只应保持本机访问，不将 9876 暴露到公网。
- 上游提供 `BLENDER_MCP_SAFE_MODE=1` 进行脚本检查，但不能当作完整沙箱；启用前说明可能限制脚本功能。
- 上游默认收集匿名使用元数据，内容采集需另行同意。建议在 MCP 进程环境设置 `DISABLE_TELEMETRY=true` 关闭遥测，并检查插件隐私设置。

## 6. 与 Infinite Canvas 的区别

- **9876：Blender MCP 插件**，用于 AI 查询场景、摆放模型、调整材质和灯光等。
- **60600：Tripo Bridge WebSocket 插件**，用于 Infinite Canvas 的 `canvas_import_to_blender` 把模型文件传入 Blender。

安装本教程的 MCP **不会自动安装或启动 60600 导入桥接**，也不会替你连接 Canvas Agent、配置 Tripo API Key。使用完整画布到 Blender 工作流时，两套连接分别检查。

## 7. 安装 Tripo DCC Bridge（画布模型导入）

如果用户需要从 Infinite Canvas 导入模型，把这部分与 MCP 一起配置，但分别验收。仅需要 AI 控制 Blender 时不必额外安装。

### 下载与要求

- 官方入口：https://www.tripo3d.ai/integrations/blender
- 官方插件 ZIP：https://tripo-public.tripo3d.ai/plugins/blender-bridge/Tripo3d_Blender_Bridge-latest.zip
- 官方列出的环境是 Blender 4.1.0+、Windows/macOS；下载前重新核对当前要求。Linux 不在该页支持列表中，不承诺可用。
- 下载的是 **DCC Bridge**，不是在 Blender 内调用 API 生成模型的 Tripo API 插件，也不是 Blender MCP 的 `addon.py`。
- 官方说明从 Tripo Studio 传输需登录并拥有 Pro、Max 或 Team 订阅。这是官方 Studio 工作流要求；该页没有明确第三方画布的使用授权范围，不宣称 Infinite Canvas 可免订阅或绕过许可。有账户或许可提示时按官方要求处理。

### 给 AI 的安装步骤

1. 检查当前 Blender 版本、已安装的 Tripo 插件及监听状态，优先复用已有安装。说明将安装第三方插件并取得用户授权。
2. 从官方入口核对下载链接，将 ZIP 保存到用户指定或确认的目录，不覆盖已有文件，不从猜测的 GitHub 仓库下载。
3. 保持 ZIP 不解压，在 Blender 的 **Edit → Preferences → Add-ons → Install from Disk** 中选择 ZIP，安装后启用 Tripo 插件。菜单位置随版本变化，以实际界面为准。
4. AI 有经授权的 Blender 自动化能力时可以协助安装，但先核对插件包结构及当前 Blender API；不要编造模块名、注册函数或启动命令。无法可靠自动化时，只让用户完成这一段 UI 操作。
5. 在 3D 视口按 **N** 打开 Tripo 侧栏，检查插件日志中的服务启动状态和实际监听地址。若插件要求重启，先提示用户保存工作；多个 Blender 实例冲突时让用户选择目标实例，不自动关闭其他实例。

### 与画布连接并验收

本项目 `web/src/services/api/blender-bridge.ts` 当前连接 **`ws://127.0.0.1:60600`**。这是本项目的实现值；官方安装页未公开数字端口，不将它当作所有插件版本的保证。如果实际插件监听不同端口，先报告不匹配，不擅自改项目代码或关闭其他服务。

1. 按 [画布启动说明](setup-canvas.md) 启动本地画布，用 **`http://localhost:3000`**（以实际端口为准）打开；当前画布桥接会拒绝 HTTPS 页面连接本机 ws。
2. 先确认 Tripo 插件服务已启动。当前实现还要求握手、文件分块确认和导入完成消息；端口可连接不代表协议兼容。
3. 经用户同意，选一个**已生成的 GLB 或 FBX 节点**，点击「导入 Blender」，或让 Agent 调用 `canvas_import_to_blender` 并传该节点 ID。不为安装验收额外生成或转换模型，不产生额外 Tripo 生成费用。
4. 工具返回 `importing: true` 仅表示启动。等待实际导入结果，并检查 Blender 是否出现对应对象；若 Blender MCP 已连接，可通过只读场景查询对比导入前后的对象清单。
5. 不把 3MF 送入该桥接，不重复导入测试对象。失败时区分插件未运行、60600 不匹配、HTTPS 限制、文件缺失及协议错误，保留可读错误信息。

最终分别报告：**Canvas Agent 已连接 / Blender MCP 场景可读 / Tripo Bridge 文件导入成功**。未实际执行的项明确标记待验收，不能合并成一句“全部安装成功”。

画布安装连接说明：[setup-canvas.md](setup-canvas.md)。

