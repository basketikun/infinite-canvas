import { useEffect } from "react";

import { isSiteTool, readViewImage, runSiteTool } from "@workbench/lib/agent/agent-site-tools";
import { executeCanvasTool } from "@workbench/lib/agent/canvas-tools";
import { callDiscoveredAgentTool, discoverAgentTools } from "@workbench/lib/agent/plugin-tools";
import { agentCatalogRequest } from "@infinite-canvas/shared/canvas/tools/plugin-tools";
import { isToolName, parseToolInput } from "@infinite-canvas/shared/canvas/tools/tools";
import { canvasToolError } from "@infinite-canvas/shared/canvas/tools/errors";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import { openLocalSocket } from "@workbench/lib/local-socket";
import { canvasMcpClientId, useCanvasMcpStore } from "@workbench/stores/use-canvas-mcp-store";

export function CanvasMcpBridge() {
    const enabled = useCanvasMcpStore((state) => state.enabled);

    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        const calls = new Map<string, AbortController>();
        let ready = false;
        let stateQueue = Promise.resolve();
        let publishTimer: ReturnType<typeof setTimeout>;
        const reportError = () => {
            if (controller.signal.aborted) return;
            useCanvasMcpStore.getState().setState({ connected: false, error: "画布连接已断开，请确认连接程序正在运行后重试。" });
        };
        const publish = () => {
            if (!ready) return stateQueue;
            const context = useAgentStore.getState().canvasContext;
            const snapshot = context ? { projectId: context.snapshot.projectId, title: context.snapshot.title } : null;
            stateQueue = stateQueue.catch(() => undefined).then(() => canvasBridgeRequest("/canvas/state", { snapshot, pluginTools: true }, controller.signal));
            return stateQueue;
        };
        const activate = () => {
            if (ready && document.visibilityState === "visible" && document.hasFocus()) void canvasBridgeRequest("/canvas/activate", {}, controller.signal).catch(reportError);
        };
        const hello = (data: { protocolVersion: number }) => {
            void (async () => {
                if (data.protocolVersion !== 12) {
                    closeSocket();
                    useCanvasMcpStore.getState().disconnect();
                    useCanvasMcpStore.getState().setState({ error: "请更新画布连接程序后重新连接。" });
                    return;
                }
                ready = true;
                await publish();
                if (controller.signal.aborted) return;
                useCanvasMcpStore.getState().setState({ connected: true, error: "" });
                activate();
            })().catch(reportError);
        };
        const toolCall = (request: { requestId: string; name: string; projectId?: string; input: Record<string, unknown> }) => {
            const operation = new AbortController();
            calls.set(request.requestId, operation);
            const signal = AbortSignal.any([controller.signal, operation.signal]);
            void (async () => {
                let result: unknown;
                try {
                    const context = useAgentStore.getState().canvasContext;
                    if (request.projectId && context?.snapshot.projectId !== request.projectId) throw new Error("CANVAS_CHANGED");
                    if (request.name === agentCatalogRequest) {
                        result = (await discoverAgentTools(context?.snapshot.projectId, signal)).map(row => row.descriptor);
                    } else if (request.name.startsWith("plugin_")) {
                        result = await callDiscoveredAgentTool(request.name, request.input, context?.snapshot.projectId, signal);
                    } else if (!isToolName(request.name)) {
                        throw new Error("UNKNOWN_TOOL");
                    } else if (isSiteTool(request.name)) {
                        const input = parseToolInput(request.name, request.input);
                        result = await runSiteTool(request.name, input as Record<string, unknown>, { canvasSnapshot: context?.snapshot, signal });
                        if (request.name === "canvas_view_image") result = { ...result as { storageKey: string }, image: await readViewImage((result as { storageKey: string }).storageKey, signal) };
                    } else {
                        if (!context) throw new Error("CANVAS_NOT_OPEN");
                        result = await executeCanvasTool(request.name, request.input, context.snapshot.projectId, signal);
                    }
                    signal.throwIfAborted();
                    await canvasBridgeRequest("/canvas/result", { requestId: request.requestId, result }, signal);
                } catch (error) {
                    console.error("Canvas tool failed", request.name, error);
                    if (!signal.aborted) await canvasBridgeRequest("/canvas/result", { requestId: request.requestId, error: canvasToolError(error) }, controller.signal);
                } finally { calls.delete(request.requestId); }
            })().catch(reportError);
        };
        const closeSocket = openLocalSocket(`/events?clientId=${canvasMcpClientId}`, (type, data) => {
            if (type === "hello") hello(data);
            else if (type === "tool_cancel") calls.get(data.requestId)?.abort();
            else if (type === "tool_call") toolCall(data);
        }, () => { ready = false; for (const call of calls.values()) call.abort(); reportError(); });
        const unsubscribe = useAgentStore.subscribe((state, previous) => {
            if (state.canvasContext?.snapshot.projectId !== previous.canvasContext?.snapshot.projectId || state.canvasContext?.snapshot.title !== previous.canvasContext?.snapshot.title) {
                clearTimeout(publishTimer);
                publishTimer = setTimeout(() => void publish().catch(reportError), 300);
            }
        });
        window.addEventListener("focus", activate);
        document.addEventListener("visibilitychange", activate);
        return () => {
            ready = false;
            clearTimeout(publishTimer);
            closeSocket();
            controller.abort();
            unsubscribe();
            window.removeEventListener("focus", activate);
            document.removeEventListener("visibilitychange", activate);
            useCanvasMcpStore.getState().setState({ connected: false });
        };
    }, [enabled]);

    return null;
}

async function canvasBridgeRequest(path: string, body: unknown, signal?: AbortSignal) {
    const response = await fetch(`${path}?clientId=${canvasMcpClientId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error("CANVAS_CONNECTION_FAILED");
}
