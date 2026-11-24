import crypto from "node:crypto";
import type { WebSocket } from "ws";

import { isToolName, parseToolInput } from "@infinite-canvas/shared/canvas/tools/tools";
import type { CanvasPresence } from "@infinite-canvas/shared/canvas/tools/types";
import { agentCatalogRequest, agentToolCallSchema, agentToolDescriptorSchema, agentToolNameSchema } from "@infinite-canvas/shared/canvas/tools/plugin-tools";

export const AGENT_PROTOCOL_VERSION = 12;
type PendingRequest = { clientId: string; resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * 只负责网页定位和 MCP 工具请求转发，不运行任何 Agent。
 */
export class CanvasSession {
    private clients = new Map<string, WebSocket>();
    private states = new Map<string, CanvasPresence>();
    private focusOrder = new Map<string, number>();
    private pending = new Map<string, PendingRequest>();
    private pluginClients = new Set<string>();
    private activeClientId = "";
    private focusSequence = 0;

    health() {
        return { ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, clients: this.clients.size, hasCanvas: this.states.has(this.activeClientId) };
    }

    openEvents(clientId: string, socket: WebSocket) {
        for (const [id, request] of this.pending) if (request.clientId === clientId) {
            this.pending.delete(id);
            request.reject(new Error("CANVAS_DISCONNECTED"));
        }
        this.pluginClients.delete(clientId);
        this.clients.get(clientId)?.close();
        this.clients.set(clientId, socket);
        if (!this.activeClientId) this.activateClient(clientId);
        sendEvent(socket, "hello", { protocolVersion: AGENT_PROTOCOL_VERSION, clientId });
        socket.on("close", () => {
            if (this.clients.get(clientId) !== socket) return;
            this.clients.delete(clientId);
            this.pluginClients.delete(clientId);
            this.states.delete(clientId);
            this.focusOrder.delete(clientId);
            this.pending.forEach((request, id) => {
                if (request.clientId !== clientId) return;
                this.pending.delete(id);
                request.reject(new Error("CANVAS_DISCONNECTED"));
            });
            if (this.activeClientId === clientId) {
                this.activeClientId = [...this.clients.keys()].sort((a, b) => (this.focusOrder.get(b) ?? 0) - (this.focusOrder.get(a) ?? 0))[0] ?? "";
            }
        });
    }

    updateState(clientId: string, state: CanvasPresence | null, pluginTools = false) {
        if (!this.clients.has(clientId)) throw new Error("CANVAS_DISCONNECTED");
        if (state) this.states.set(clientId, { projectId: state.projectId, title: state.title });
        else this.states.delete(clientId);
        if (pluginTools) this.pluginClients.add(clientId);
        else this.pluginClients.delete(clientId);
    }

    activateClient(clientId: string) {
        if (!this.clients.has(clientId)) throw new Error("CANVAS_DISCONNECTED");
        this.activeClientId = clientId;
        this.focusOrder.set(clientId, ++this.focusSequence);
    }

    resolveResult(clientId: string, body: { requestId: string; result?: unknown; error?: { code: string; message: string } }) {
        const request = this.pending.get(body.requestId);
        if (!request || request.clientId !== clientId) return false;
        this.pending.delete(body.requestId);
        if (body.error) request.reject(new Error(body.error.code));
        else request.resolve(body.result);
        return true;
    }

    async listPluginTools(clientId = this.activeClientId, projectId?: string, signal?: AbortSignal) {
        if (!this.pluginClients.has(clientId)) return [];
        const result = await this.requestTool(clientId, agentCatalogRequest, {}, projectId ?? this.states.get(clientId)?.projectId, signal);
        return agentToolDescriptorSchema.array().parse(result);
    }

    async callTool(name: string, rawInput: unknown, clientId = this.activeClientId, projectId?: string, signal?: AbortSignal) {
        if (agentToolNameSchema.safeParse(name).success) {
            if (!this.pluginClients.has(clientId)) throw new Error("UNKNOWN_TOOL");
            return this.requestTool(clientId, name, agentToolCallSchema.parse(rawInput), projectId ?? this.states.get(clientId)?.projectId, signal);
        }
        if (!isToolName(name)) throw new Error("UNKNOWN_TOOL");
        const input = parseToolInput(name, rawInput) as Record<string, unknown>;
        if (!this.clients.has(clientId)) throw new Error("CANVAS_DISCONNECTED");
        return this.requestTool(clientId, name, input, projectId, signal);
    }

    private requestTool(clientId: string, name: string, input: Record<string, unknown>, projectId?: string, signal?: AbortSignal) {
        signal?.throwIfAborted();
        const client = this.clients.get(clientId)!;
        const requestId = crypto.randomUUID();
        return new Promise<unknown>((resolve, reject) => {
            const cancel = (reason: Error) => {
                this.pending.delete(requestId);
                clearTimeout(timer);
                signal?.removeEventListener("abort", abort);
                sendEvent(client, "tool_cancel", { requestId });
                reject(reason);
            };
            const abort = () => cancel(new Error("TOOL_CANCELLED"));
            const timer = setTimeout(() => cancel(new Error("CANVAS_TIMEOUT")), 30000);
            signal?.addEventListener("abort", abort, { once: true });
            this.pending.set(requestId, {
                clientId,
                resolve: (value) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(value); },
                reject: (error) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); },
            });
            sendEvent(client, "tool_call", { requestId, name, input, projectId });
        });
    }
}

function sendEvent(socket: WebSocket, type: string, data: unknown) {
    socket.send(JSON.stringify({ type, data }));
}
