import path from "node:path";

import { getModel } from "@earendil-works/pi-ai/compat";
import {
    createAgentSession,
    createExtensionRuntime,
    defineTool,
    type FileEntry,
    ModelRuntime,
    type ResourceLoader,
    SessionManager,
    SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { CanvasBridge } from "./canvas-bridge.js";
import type { RuntimeAdapter, RuntimeExecutionInput } from "./runtime.js";
import type { JsonObject } from "./types.js";

export type PiRuntimeConfig = {
    provider: string;
    model: string;
    apiKey: string;
    agentDir: string;
};

export class PiRuntimeAdapter implements RuntimeAdapter {
    private modelRuntime?: ModelRuntime;

    constructor(private readonly canvas: CanvasBridge, private readonly config: PiRuntimeConfig) {}

    async execute(input: RuntimeExecutionInput) {
        const runtime = await this.runtime();
        const model = getModel(this.config.provider as never, this.config.model as never);
        if (!model) throw new Error(`找不到 Pi 模型：${this.config.provider}/${this.config.model}`);

        const persisted = await input.store.loadConversationSession(input.ctx, input.conversationId);
        const skills = (await input.store.listSkills(input.ctx)).filter((skill) => skill.enabled);
        const cwd = process.cwd();
        const entries = persisted.header ? [persisted.header, ...persisted.entries] as FileEntry[] : undefined;
        const sessionManager = SessionManager.inMemory(cwd, { id: input.conversationId }, entries);
        const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
        const prompt = systemPrompt(skills.map((skill) => ({ name: skill.name, definition: skill.definition })));
        const resourceLoader: ResourceLoader = {
            getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
            getSkills: () => ({ skills: [], diagnostics: [] }),
            getPrompts: () => ({ prompts: [], diagnostics: [] }),
            getThemes: () => ({ themes: [], diagnostics: [] }),
            getAgentsFiles: () => ({ agentsFiles: [] }),
            getSystemPrompt: () => prompt,
            getSystemPromptSource: () => undefined,
            getAppendSystemPrompt: () => [],
            getAppendSystemPromptSources: () => [],
            extendResources: () => {},
            reload: async () => {},
        };

        const readCanvas = defineTool({
            name: "canvas_read_snapshot",
            label: "读取当前画布",
            description: "读取当前 Project 唯一 Canvas Workspace 的浏览器快照。",
            parameters: Type.Object({}),
            execute: async () => {
                const snapshot = this.canvas.readSnapshot(input.ctx);
                return textResult(snapshot, { revision: snapshot.revision });
            },
        });
        const applyCanvasOperations = defineTool({
            name: "canvas_apply_operations",
            label: "请求修改画布",
            description: "向当前 Project 的浏览器发送画布操作；必须等待用户在浏览器确认并返回结果。",
            parameters: Type.Object({
                operations: Type.Array(Type.Record(Type.String(), Type.Unknown()), { description: "要执行的画布操作" }),
                summary: Type.String({ description: "供用户确认的简短中文说明" }),
            }),
            execute: async (_toolCallId, params, toolSignal) => {
                const mutation = this.canvas.requestMutation(input.ctx, toolSignal);
                await input.emit({
                    type: "canvas.tool.requested",
                    itemId: mutation.callId,
                    payload: { callId: mutation.callId, summary: params.summary, operations: params.operations },
                });
                const result = await mutation.result;
                return textResult(result, result);
            },
        });

        const { session } = await createAgentSession({
            cwd,
            agentDir: path.resolve(this.config.agentDir),
            model,
            modelRuntime: runtime,
            sessionManager,
            settingsManager,
            resourceLoader,
            noTools: "builtin",
            customTools: [readCanvas, applyCanvasOperations],
        });
        const onAbort = () => void session.abort();
        input.signal.addEventListener("abort", onAbort, { once: true });
        const unsubscribe = session.subscribe(async (event) => {
            if (input.signal.aborted) return;
            if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
                await input.emit({ type: "assistant.delta", itemId: messageId(event.message, input.runId), payload: { delta: event.assistantMessageEvent.delta } });
            } else if (event.type === "message_end" && event.message.role === "assistant") {
                await input.emit({ type: "assistant.completed", itemId: messageId(event.message, input.runId), payload: { text: messageText(event.message) } });
            } else if (event.type === "tool_execution_start") {
                await input.emit({ type: "tool.started", itemId: event.toolCallId, payload: { toolName: event.toolName, arguments: jsonValue(event.args) } });
            } else if (event.type === "tool_execution_update") {
                await input.emit({ type: "tool.updated", itemId: event.toolCallId, payload: { toolName: event.toolName, update: jsonValue(event.partialResult) } });
            } else if (event.type === "tool_execution_end") {
                await input.emit({ type: "tool.completed", itemId: event.toolCallId, payload: { toolName: event.toolName, isError: event.isError, result: jsonValue(event.result) } });
            }
        });

        try {
            await session.prompt(input.prompt);
        } finally {
            unsubscribe();
            input.signal.removeEventListener("abort", onAbort);
            try {
                await input.store.saveConversationSession(input.ctx, input.conversationId, {
                    storageVersion: persisted.storageVersion,
                    revision: persisted.revision,
                    header: sessionManager.getHeader() as unknown as JsonObject,
                    entries: sessionManager.getEntries() as unknown as JsonObject[],
                });
            } finally {
                session.dispose();
            }
        }
    }

    private async runtime() {
        if (!this.modelRuntime) {
            const agentDir = path.resolve(this.config.agentDir);
            this.modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json") });
            await this.modelRuntime.setRuntimeApiKey(this.config.provider, this.config.apiKey);
        }
        return this.modelRuntime;
    }
}

function systemPrompt(skills: Array<{ name: string; definition: string }>) {
    const projectSkills = skills.length ? skills.map((skill) => `## ${skill.name}\n${skill.definition}`).join("\n\n") : "（当前 Project 没有启用的 Skill）";
    return `你是 Research Canvas 中当前研究项目的 Agent。你只能使用系统为本次请求绑定的 Project 和 Canvas Workspace，不得请求、猜测或切换 userId、projectId、canvasWorkspaceId。不要声称具有 shell、文件系统或本地命令权限。读取画布使用 canvas_read_snapshot；修改画布使用 canvas_apply_operations，且必须等待浏览器用户确认。Memory 作用域仅定义为 user_project_private，本版本没有可读写 Memory。\n\n以下 Skill 仅属于当前 Project：\n\n${projectSkills}`;
}

function textResult(value: unknown, details: JsonObject) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details };
}

function messageId(message: unknown, runId: string) {
    if (message && typeof message === "object" && "id" in message && typeof message.id === "string") return message.id;
    return `${runId}:assistant`;
}

function messageText(message: unknown) {
    if (!message || typeof message !== "object" || !("content" in message)) return "";
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((part) => part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? part.text : "").join("");
}

function jsonValue(value: unknown): unknown {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value)) as unknown;
}
