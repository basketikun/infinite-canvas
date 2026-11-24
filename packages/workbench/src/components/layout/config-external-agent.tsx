import { useEffect, useState } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Copy } from "lucide-react";

import { AgentBeam } from "@workbench/components/agent/agent-beam";
import { storage } from "@workbench/services/storage/runtime";
import { useCopyText } from "@workbench/hooks/use-copy-text";
import { useCanvasMcpStore } from "@workbench/stores/use-canvas-mcp-store";
import "./config-network.css";

const agentCommand = "npx -y @basketikun/infinite-canvas@latest serve";
const npxMcp = { command: "npx", args: ["-y", "@basketikun/infinite-canvas@latest", "mcp"] };

export function ConfigExternalAgent() {
    const copyText = useCopyText();
    const connected = useCanvasMcpStore((state) => state.connected);
    const enabled = useCanvasMcpStore((state) => state.enabled);
    const error = useCanvasMcpStore((state) => state.error);
    const [mcp, setMcp] = useState(npxMcp);
    useEffect(() => { if (storage.kind === "server") void fetch("/config").then((response) => response.json()).then((config) => { if (config.mcp) setMcp(config.mcp); }); }, []);
    const mcpConfig = JSON.stringify({ mcpServers: { "infinite-canvas": mcp } }, null, 2);
    const status = connected ? "Agent 连接已就绪" : enabled && !error ? "正在连接…" : "尚未连接";

    if (storage.kind !== "server") return (
        <div className="agent-connection settings-network generation-workspace-controls flex flex-col gap-4">
            <AgentBeam />
            <p className="text-muted-foreground">Codex、Claude Code 等 AI 助手只能操作本地版画布。在本机终端运行以下命令，打开它显示的地址，再到该页面的「设置 → Agent配置」完成配置。</p>
            <div className="flex min-w-0 items-start gap-1">
                <span className="min-w-0"><code className="break-all">{agentCommand}</code></span>
                <Button type="button" variant="ghost" size="xs" className="settings-command-copy" title="复制启动命令" aria-label="复制启动命令" onClick={() => void copyText(agentCommand, "启动命令已复制")}><Copy aria-hidden className="size-3.5" /></Button>
            </div>
            <p className="text-muted-foreground">需要本机安装 Node.js 22 或更高版本。本地版的作品保存在本机目录，与当前浏览器里的作品分开。</p>
        </div>
    );
    return (
        <div className="agent-connection settings-network generation-workspace-controls flex flex-col gap-4">
            <AgentBeam />
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="status" className={`flex items-center gap-2 font-medium ${connected ? "text-emerald-600 dark:text-emerald-400" : enabled && !error ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                    <span className={`size-2 rounded-full ${connected ? "bg-emerald-500" : enabled && !error ? "animate-pulse bg-amber-500" : "bg-muted-foreground/50"}`} />
                    {status}
                </p>
                <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => copyText(`请帮我连接当前本地画布的 MCP。画布地址：${window.location.origin}。本地程序已经启动，请复用它，不再启动第二个服务。使用以下 mcpServers 配置，保留已有 MCP 配置：\n${mcpConfig}\n完成后读取 canvas_get_state 确认目标网页，后续持续传入 clientId 和 projectId。`, "配置说明已复制，粘贴发送给你的 AI")}><Copy aria-hidden className="size-4" />复制配置说明</Button>
                    <Button type="button" variant="ghost" size="sm" aria-label={connected ? "断开连接" : "连接"} onClick={() => connected ? useCanvasMcpStore.getState().disconnect() : useCanvasMcpStore.getState().connect()}>{connected ? "断开连接" : "连 接"}</Button>
                </div>
            </div>
            {error && <div role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</div>}
            <p className="text-muted-foreground">在 AI 助手中添加以下 MCP 配置，添加后重新加载 AI 助手，并保持当前画布打开。</p>
            <section className="flex min-w-0 flex-col gap-2" aria-labelledby="local-agent-manual-setup">
                <div className="flex items-center justify-between gap-2">
                    <h3 id="local-agent-manual-setup" className="text-sm font-semibold">手动配置</h3>
                    <Button type="button" variant="ghost" size="xs" onClick={() => void copyText(mcpConfig, "MCP 配置已复制")}><Copy aria-hidden className="size-3.5" />复制 JSON</Button>
                </div>
                <pre className="whitespace-pre-wrap break-all text-xs leading-5">{mcpConfig}</pre>
                <p className="text-muted-foreground">需要本机安装 Node.js 22 或更高版本。源码开发时，也可使用启动终端输出的配置。</p>
            </section>
        </div>
    );
}
