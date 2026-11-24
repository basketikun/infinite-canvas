import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { useMatch } from "react-router-dom";

import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { History, MessageSquare, PanelRightClose, Plug, Plus } from "lucide-react";
import { AgentChat } from "./agent-chat";
import { AgentHistoryView } from "./agent-history-view";
import { ConfigExternalAgent } from "@workbench/components/layout/config-external-agent";
import { AgentPanelTabs } from "./agent-panel-tabs";
import { useAgentChatStore } from "@workbench/stores/use-agent-chat-store";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@workbench/stores/use-agent-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import "./agent-panel.css";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel() {
    const projectId = useMatch("/canvas/:id")?.params.id;
    const activeTab = useAgentStore((state) => state.activeTab);
    const busy = useAgentStore((state) => Boolean(state.runningThreadId));
    const historyReady = useAgentChatStore((state) => state.ready && !state.storageError);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const [resizing, setResizing] = useState(false);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    // 进入或切换画布时收起助手面板，不在打开画布后自动占住右侧空间。
    useEffect(() => {
        if (useAgentStore.getState().panelOpen) useAgentStore.getState().closePanel();
    }, [projectId]);
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        const onMove = (moveEvent: PointerEvent) => {
            setAgentState({ width: Math.min(760, Math.max(360, startWidth + startX - moveEvent.clientX)) });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!projectId) return null;
    return (
        <motion.div
            className="relative z-[70] flex h-full max-w-full shrink-0"
            inert={!panelOpen || panelClosing}
            aria-hidden={!panelOpen || panelClosing}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen && !panelClosing ? undefined : "none" }}
        >
            <motion.aside
                className="relative flex h-full max-w-[100dvw] shrink-0 flex-col border-l"
                data-canvas-shortcuts-ignore
                initial={{ x: 48 }}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整右侧面板宽度" />
                <AgentPanelTabs value={activeTab} theme={theme} items={[{ value: "chat", label: "聊天", icon: <MessageSquare className="size-4" /> }, { value: "history", label: "历史", icon: <History className="size-4" /> }, { value: "mcp", label: "MCP", icon: <Plug className="size-4" /> }]} onChange={(activeTab) => setAgentState({ activeTab })}
                    right={<>
                        <PanelHeaderAction label="新对话" disabled={busy || !historyReady} onClick={() => { useAgentChatStore.getState().createThread(projectId); setAgentState({ activeTab: "chat" }); }}><Plus className="size-4" /></PanelHeaderAction>
                        <PanelHeaderAction label="收起面板" onClick={() => useAgentStore.getState().closePanel()}><PanelRightClose className="size-4" /></PanelHeaderAction>
                    </>}
                />
                {activeTab === "chat" ? <AgentChat key={projectId} /> : activeTab === "history" ? <AgentHistoryView /> : <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"><p className="text-center text-sm font-medium">让 Codex、Claude Code 等 Agent 连接并操作这张画布</p><ConfigExternalAgent /></div>}
            </motion.aside>
        </motion.div>
    );
}

function PanelHeaderAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
    const open = useAgentStore((state) => state.panelOpen);
    return <TooltipProvider delayDuration={100}>
        <Tooltip>
            <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="agent-panel-action" disabled={disabled} aria-label={label} onClick={onClick}>{children}</Button>
            </TooltipTrigger>
            {open && <TooltipContent className="agent-panel-tip" sideOffset={2}>{label}</TooltipContent>}
        </Tooltip>
    </TooltipProvider>;
}
