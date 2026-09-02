import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape, type ZodTypeAny } from "zod";

import { RuntimeDatabase } from "../runtime/database.js";
import { createBackendClient, proxyComfyUi, type ComfyUiClient } from "../runtime/comfy-client.js";
import { ComfyUiBridge } from "../runtime/comfyui.js";
import { loadConfig, type CanvasAgentConfig } from "../config.js";
import { logger } from "../utils/logger.js";

// 画布节点在 Agent 侧的轻量形态(避免与 web 类型耦合)
export type AgentCanvasNode = {
    id: string;
    type: string;
    title: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    metadata?: Record<string, unknown>;
};

// ---- 浏览器 -> Agent 的声明线类型 ----
export type PluginMcpToolWire = {
    id: string;
    version: string;
    name: string;
    description: string;
    inputJsonSchema: Record<string, unknown>;
    annotations?: Record<string, unknown>;
};

export type PluginMcpDeclaration = {
    id: string;
    name: string;
    version: string;
    mcp: { tools: PluginMcpToolWire[]; enabled: boolean };
};

// ---- Agent 侧注入给插件 handler 的上下文 ----
export type PluginMcpContext = {
    endpoint: string;
    token: string;
    runtimeDb: RuntimeDatabase;
    /** 画布/素材/媒体/日志的唯一业务数据源。 */
    backend: BackendClient;
    /** ComfyUI 能力（backend 权威 + 本地兜底；见 comfy-client.ts）。 */
    comfyUi: ComfyUiClient;
    getCanvasNodes: () => Promise<AgentCanvasNode[]>;
    getCanvasNode: (id: string) => Promise<AgentCanvasNode | null>;
    updateCanvasNode: (id: string, patch: Partial<AgentCanvasNode>, metadataPatch?: Record<string, unknown>) => Promise<void>;
};

export type McpToolHandler = (input: Record<string, unknown>, context: PluginMcpContext) => Promise<unknown>;

// 插件 MCP 模块(Agent 侧打包,经 allowlist 加载)
export type PluginMcpModule = {
    id: string;
    version: string;
    tools: PluginMcpToolWire[];
    createHandler: (context: PluginMcpContext) => Record<string, McpToolHandler>;
};

// ---- 官方/本地插件白名单:其 MCP 模块由 Agent 直接打包,走本地 import ----
type FirstPartyEntry = { version: string; load: () => Promise<PluginMcpModule> };
export const KNOWN_FIRST_PARTY: Record<string, FirstPartyEntry> = {
    "minimax-h3": {
        version: "1.2.0",
        load: async () => (await import("../plugins/minimax-h3/mcp.js")).pluginMcp,
    },
};

const SETTING_KEY = "plugins.mcp.declarations";

export function loadPluginMcpDeclarations(db: RuntimeDatabase): PluginMcpDeclaration[] {
    const value = db.getSetting(SETTING_KEY);
    return Array.isArray(value) ? (value as PluginMcpDeclaration[]) : [];
}

export function savePluginMcpDeclarations(db: RuntimeDatabase, declarations: PluginMcpDeclaration[]) {
    db.setSetting(SETTING_KEY, declarations);
}

// 构造插件 MCP 运行上下文(Agent 侧)
export function buildPluginMcpContext(config: CanvasAgentConfig, runtimeDb: RuntimeDatabase, backend: BackendClient, comfyUi: ComfyUiClient): PluginMcpContext {
    const readNodes = async (): Promise<AgentCanvasNode[]> => {
        const projects = await backend.listCanvasProjects() as Array<{ nodes?: AgentCanvasNode[] }>;
        return projects.flatMap((project) => (Array.isArray(project.nodes) ? project.nodes : []) as AgentCanvasNode[]);
    };
    return {
        endpoint: config.url,
        token: config.token,
        runtimeDb,
        comfyUi,
        getCanvasNodes: readNodes,
        getCanvasNode: async (id) => (await readNodes()).find((node) => node.id === id) ?? null,
        updateCanvasNode: async (id, patch, metadataPatch) => {
            const projects = await backend.listCanvasProjects() as Array<{ id?: string; nodes?: AgentCanvasNode[] }>;
            const target = projects.find((project) => Array.isArray(project.nodes) && project.nodes.some((node) => node.id === id));
            if (!target) throw new Error(`找不到画布节点：${id}`);
            const nextNodes = (target.nodes || []).map((node) => {
                if (node.id !== id) return node;
                const merged: AgentCanvasNode = { ...node, ...patch };
                if (metadataPatch) merged.metadata = { ...(node.metadata || {}), ...metadataPatch };
                return merged;
            });
            const nextProjects = projects.map((project) => (project === target ? { ...project, nodes: nextNodes } : project));
            await backend.replaceCanvasProjects(nextProjects);
        },
    };
}

// 已注册插件记录
type RegisteredPlugin = {
    id: string;
    version: string;
    enabled: boolean;
    firstParty: boolean;
    tools: PluginMcpToolWire[];
    handlers: Record<string, McpToolHandler>;
};

/**
 * 插件 MCP 动态注册表。
 *
 * 设计要点:
 * - 官方/本地插件(minimax-h3)经 KNOWN_FIRST_PARTY 白名单加载本地打包的 MCP 模块;
 *   其工具在 enable 时注册,disable 时通过 enabled 标志隐藏(MCP SDK 无 removeTool)。
 * - 第三方远程插件仅加载前端节点,MCP 执行需显式授权;当前未授权时只记录、不注册工具,
 *   满足「远程插件 MCP 需用户显式安装 + Agent 授权」的安全边界。
 * - 声明持久化到 SQLite:浏览器(HTTP 进程)启用/禁用写入,stdio MCP 进程冷启动/轮询读取,
 *   从而跨进程、跨重启保持工具可见性。
 */
export class PluginMcpRegistry {
    private plugins = new Map<string, RegisteredPlugin>();

    constructor(private readonly server: McpServer, private readonly context: PluginMcpContext) {}

    /** 浏览器启用/禁用时调用:持久化声明并在当前进程立即应用。 */
    async syncFromBrowser(declarations: PluginMcpDeclaration[]) {
        savePluginMcpDeclarations(this.context.runtimeDb, declarations);
        await this.apply(declarations);
    }

    /** 应用一组声明:启用则注册,禁用/缺失则注销。幂等。 */
    async apply(declarations: PluginMcpDeclaration[]) {
        const byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));
        for (const id of [...this.plugins.keys()]) {
            if (!byId.has(id)) this.unregister(id);
        }
        for (const declaration of declarations) {
            if (declaration.mcp?.enabled) await this.enable(declaration);
            else this.unregister(declaration.id);
        }
    }

    private async enable(declaration: PluginMcpDeclaration) {
        const existing = this.plugins.get(declaration.id);
        if (existing?.enabled && existing.version === declaration.version && existing.tools.length === declaration.mcp.tools.length) {
            return; // 已注册且未变,跳过(避免重复注册抛错)
        }
        const firstParty = KNOWN_FIRST_PARTY[declaration.id];
        if (!firstParty) {
            // 第三方远程插件:MCP 执行需显式授权,未授权仅记录、不注册工具
            logger.warn(`插件 ${declaration.id} 的 MCP 执行未获授权(非官方/本地白名单),仅注册前端节点`);
            this.plugins.set(declaration.id, { id: declaration.id, version: declaration.version, enabled: false, firstParty: false, tools: declaration.mcp.tools, handlers: {} });
            return;
        }
        if (firstParty.version !== declaration.version) {
            logger.warn(`插件 ${declaration.id} MCP 模块版本(${firstParty.version}) 与声明(${declaration.version})不一致,以本地模块为准`);
        }
        const mod = await firstParty.load();
        if (mod.id !== declaration.id) throw new Error(`MCP 模块 id 不匹配: ${mod.id} != ${declaration.id}`);
        const handlers = mod.createHandler(this.context);
        const plugin: RegisteredPlugin = { id: declaration.id, version: mod.version, enabled: true, firstParty: true, tools: mod.tools, handlers };
        this.plugins.set(declaration.id, plugin);
        this.registerTools(plugin);
    }

    private registerTools(plugin: RegisteredPlugin) {
        for (const tool of plugin.tools) {
            const handler = plugin.handlers[tool.id];
            if (!handler) continue;
            const entry = (this.server as unknown as { _registeredTools?: Record<string, { enabled: boolean }> })._registeredTools?.[tool.id];
            if (entry) {
                entry.enabled = true; // 已存在(曾注册后隐藏),直接重新启用
                continue;
            }
            const shape = jsonSchemaToZodShape(tool.inputJsonSchema);
            this.server.registerTool(tool.id, {
                title: tool.name,
                description: tool.description,
                inputSchema: shape,
                ...(tool.annotations ? { annotations: tool.annotations as never } : {}),
            }, async (input: Record<string, unknown>) => {
                const result = await handler(input, this.context);
                return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
            });
        }
        this.server.sendToolListChanged();
    }

    private unregister(id: string) {
        const plugin = this.plugins.get(id);
        if (!plugin) return;
        plugin.enabled = false;
        // MCP SDK 无 removeTool:通过 enabled 标志隐藏工具
        const registered = (this.server as unknown as { _registeredTools?: Record<string, { enabled: boolean }> })._registeredTools;
        if (registered) {
            for (const tool of plugin.tools) {
                const entry = registered[tool.id];
                if (entry) entry.enabled = false;
            }
        }
        this.server.sendToolListChanged();
    }

    /** 当前已注册插件与工具清单(供调试/状态查询)。 */
    listTools() {
        return [...this.plugins.values()].map((plugin) => ({
            id: plugin.id,
            version: plugin.version,
            enabled: plugin.enabled,
            firstParty: plugin.firstParty,
            tools: plugin.tools.map((tool) => {
                const registered = (this.server as unknown as { _registeredTools?: Record<string, { enabled: boolean }> })._registeredTools?.[tool.id];
                return { id: tool.id, name: tool.name, registered: Boolean(registered), enabled: Boolean(registered?.enabled) };
            }),
        }));
    }
}

// ---- JSON Schema -> Zod raw shape 转换(支持常见子集) ----
function jsonSchemaToZodShape(schema: Record<string, unknown>): ZodRawShape {
    const props = (schema.properties as Record<string, unknown> | undefined) || {};
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    const shape: ZodRawShape = {};
    for (const [key, value] of Object.entries(props)) {
        const zodType = jsonTypeToZod(value);
        shape[key] = required.includes(key) ? zodType : zodType.optional();
    }
    return shape;
}

function jsonTypeToZod(node: unknown): ZodTypeAny {
    if (!node || typeof node !== "object") return z.any();
    const spec = node as Record<string, unknown>;
    if (Array.isArray(spec.enum) && spec.enum.length) return z.enum(spec.enum.map(String) as [string, ...string[]]);
    if (Array.isArray(spec.oneOf)) {
        const options = (spec.oneOf as unknown[]).map(jsonTypeToZod);
        return options.length >= 2 ? z.union(options as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]) : (options[0] ?? z.any());
    }
    switch (spec.type) {
        case "string":
            return z.string();
        case "number":
        case "integer":
            return z.coerce.number();
        case "boolean":
            return z.boolean();
        case "array": {
            const item = spec.items ? jsonTypeToZod(spec.items) : z.any();
            return z.array(item);
        }
        case "object":
            // JSON Schema 默认 additionalProperties=true,故对象需 passthrough,
            // 否则 Zod 默认 strip 会丢弃 patch/params 等开放字段。
            return z.object(jsonSchemaToZodShape(spec)).passthrough();
        default:
            return z.any();
    }
}

/** 构造并接入插件 MCP 注册表(供 startMcpServer 调用)。 */
export async function startPluginMcp(server: McpServer): Promise<PluginMcpRegistry> {
    const config = loadConfig(true);
    const runtimeDb = new RuntimeDatabase();
    const backend = createBackendClient(config.backendUrl || `http://127.0.0.1:17370`);
    /** ComfyUI 走 backend(总后台权威),MCP 侧不再直连本地 ComfyUI 实例。 */
    const comfyUi = proxyComfyUi(backend, new ComfyUiBridge(runtimeDb));
    const context = buildPluginMcpContext(config, runtimeDb, backend, comfyUi);
    const registry = new PluginMcpRegistry(server, context);
    // 冷启动:从 SQLite 读取已启用插件
    await registry.apply(loadPluginMcpDeclarations(runtimeDb));
    // 轮询:捕获浏览器(HTTP 进程)对插件启用态的变更(两个进程共享同一 SQLite)
    const timer = setInterval(() => {
        registry.apply(loadPluginMcpDeclarations(runtimeDb)).catch((error) => logger.warn("plugin mcp sync failed", error));
    }, 3000);
    process.on("beforeExit", () => clearInterval(timer));
    return registry;
}
