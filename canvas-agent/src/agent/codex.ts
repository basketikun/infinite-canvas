import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import type { CanvasSnapshot } from "../canvas/types.js";
import { logger } from "../utils/logger.js";
import { errorMessage, field, type JsonRecord } from "../utils/value.js";
import { CodexAppClient, CodexReportedError } from "./codex-client.js";
import { codexEventHistory } from "./codex-event-history.js";
import { settledTurnIds, summarizeCodexThread, threadMessages } from "./codex-history.js";
import { messageMetadataStore } from "./message-metadata.js";
import type { CodexReasoningEffort, CodexSkillMetadata, CodexSkillSelector, CodexSkillsListEntry } from "./codex-protocol.js";
import type { AgentAttachment, AgentEmit, AgentPermissionMode } from "./types.js";

type CodexRunOptions = { threadId?: string; cwd?: string; permissionMode?: AgentPermissionMode; model?: string; effort?: CodexReasoningEffort; skill?: CodexSkillSelector; messageText?: string; appEmit?: AgentEmit; onStart?: () => void; onThread?: (threadId: string) => void; onTurn?: (turnId: string) => void; onFinish?: () => void };
type CodexSkillDraftInput = { model?: string; effort?: CodexReasoningEffort } & ({ source: "conversation"; threadId: string } | { source: "canvas"; snapshot: CanvasSnapshot });

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const skillDraftSchema = z.object({
    name: z.string().trim().min(1).max(64).regex(skillNamePattern),
    displayName: z.string().trim().max(64),
    description: z.string().trim().min(1).max(1024).refine((value) => !/[<>]/.test(value)),
    instructions: z.string().trim().min(1).max(20000),
    shortDescription: z.string().trim().max(64).refine((value) => !value || value.length >= 25),
    defaultPrompt: z.string().trim().max(1024),
}).strict().superRefine((draft, context) => {
    if (draft.defaultPrompt && !mentionsSkill(draft.defaultPrompt, draft.name)) context.addIssue({ code: "custom", path: ["defaultPrompt"], message: `默认提示词必须包含 $${draft.name}` });
});

const SKILL_DRAFT_OUTPUT_SCHEMA: JsonRecord = {
    type: "object",
    additionalProperties: false,
    required: ["name", "displayName", "description", "instructions", "shortDescription", "defaultPrompt"],
    properties: {
        name: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", minLength: 1, maxLength: 64 },
        displayName: { type: "string", maxLength: 64 },
        description: { type: "string", pattern: "^[^<>]+$", minLength: 1, maxLength: 1024 },
        instructions: { type: "string", minLength: 1, maxLength: 20000 },
        shortDescription: { anyOf: [{ type: "string", maxLength: 0 }, { type: "string", minLength: 25, maxLength: 64 }] },
        defaultPrompt: { type: "string", maxLength: 1024 },
    },
};

export type AgentSkillDraft = z.infer<typeof skillDraftSchema>;

export class CodexSkillLookupError extends Error {
    override name = "CodexSkillLookupError";
    constructor(message: string, readonly statusCode: 400 | 404 | 409) {
        super(message);
    }
}

let codexQueue: Promise<unknown> = Promise.resolve();
let codexApp: CodexAppClient | null = null;
let codexAppStart: Promise<CodexAppClient> | null = null;
/** 仅表示最近主动加载/选择的线程；运行中的 turn 身份由 CodexAppClient 自己维护。 */
let loadedThreadId = "";

export { summarizeCodexThread } from "./codex-history.js";

/** 将 Codex turn 加入串行队列并等待执行完成。 */
export async function runCodexTurn(prompt: string, lifecycleEmit: AgentEmit, attachments: AgentAttachment[] = [], options: CodexRunOptions = {}) {
    if (!prompt.trim()) return;
    codexQueue = codexQueue.catch(() => undefined).then(() => runCodexTurnNow(prompt, lifecycleEmit, attachments, options));
    await codexQueue;
}

/** 从当前对话或指定网页画布生成可编辑草稿，不写入 Skill 文件。 */
export async function generateCodexSkillDraft(emit: AgentEmit, cwd: string, input: CodexSkillDraftInput): Promise<AgentSkillDraft> {
    const queued = codexQueue.catch(() => undefined).then(() => generateCodexSkillDraftNow(emit, cwd, input));
    codexQueue = queued;
    return await queued;
}

/** 中断当前线程正在执行的 Codex turn。 */
export async function interruptCodexTurn(threadId?: string) {
    if (!codexApp) return false;
    return await codexApp.interruptCurrentTurn(threadId);
}

/** 回复当前 app-server 的待处理权限请求。 */
export async function resolveCodexApproval(requestId: string, decision: string) {
    return Boolean(codexApp?.resolveApproval(requestId, decision));
}

/** 创建新的 Codex 线程并记录当前线程 ID。 */
export async function startCodexThread(emit: AgentEmit, cwd?: string, permissionMode: AgentPermissionMode = "request", preheat = false) {
    const app = await getCodexApp(emit);
    const thread = await app.startThread(cwd, permissionMode, preheat);
    loadedThreadId = String(field(thread, "id") || "");
    return thread;
}

/** 恢复指定 Codex 线程并返回聊天历史。 */
export async function resumeCodexThread(emit: AgentEmit, threadId: string, cwd?: string, permissionMode: AgentPermissionMode = "request", preheat = false) {
    const app = await getCodexApp(emit);
    const thread = await resumeLoadedThread(app, threadId, cwd, permissionMode, true, preheat);
    const history = await loadCodexHistory(emit, threadId, cwd);
    const supplementalItems = await codexEventHistory.readThread(threadId);
    const messages = await mergeMessageMetadata(threadId, threadMessages(history.thread, app.planUpdates(threadId), supplementalItems));
    return { thread, messages, settledTurnIds: settledTurnIds(history.thread, supplementalItems), historyReady: history.historyReady };
}

/** 查询当前工作空间中的 Codex 线程。 */
export async function listCodexThreads(emit: AgentEmit, options: { cwd: string; searchTerm?: string; limit?: number }) {
    const app = await getCodexApp(emit);
    const result = await app.listThreads({
        limit: options.limit || 40,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: ["cli", "vscode", "appServer", "exec"],
        cwd: options.cwd,
        ...(options.searchTerm ? { searchTerm: options.searchTerm } : {}),
    });
    const data = Array.isArray(field(result, "data")) ? (field(result, "data") as unknown[]).map(summarizeCodexThread).filter((thread) => threadInWorkspace(thread, options.cwd)) : [];
    return { data, nextCursor: field(result, "nextCursor") || null, backwardsCursor: field(result, "backwardsCursor") || null };
}

/** 查询当前账号可用于新任务的 Codex 模型。 */
export async function listCodexModels(emit: AgentEmit) {
    return await (await getCodexApp(emit)).listModels();
}

/** 查询当前工作空间的原生 Skill 列表。 */
export async function listCodexSkills(emit: AgentEmit, cwd: string, forceReload = false): Promise<CodexSkillsListEntry> {
    const result = await (await getCodexApp(emit)).listSkills(cwd, forceReload);
    return result.data.find((entry) => samePath(entry.cwd, cwd)) || { cwd, skills: [], errors: [] };
}

/** 从原生 Skill 列表中解析并校验浏览器提交的选择器。 */
export async function resolveCodexSkill(emit: AgentEmit, cwd: string, selector: CodexSkillSelector, requireEnabled = false): Promise<CodexSkillMetadata> {
    const name = String(selector?.name || "");
    const requestedPath = String(selector?.path || "");
    if (!name || !requestedPath || !path.isAbsolute(requestedPath)) throw new CodexSkillLookupError("Skill 选择无效", 400);
    const { skills } = await listCodexSkills(emit, cwd, true);
    const skill = skills.find((item) => item.name === name && samePath(item.path, requestedPath));
    if (!skill) throw new CodexSkillLookupError("找不到指定 Skill，请刷新列表后重试", 404);
    if (requireEnabled && !skill.enabled) throw new CodexSkillLookupError("该 Skill 已停用，请先启用后再使用", 409);
    return skill;
}

/** 修改经过原生列表校验的 Skill 启用状态。 */
export async function configureCodexSkill(emit: AgentEmit, cwd: string, selector: CodexSkillSelector, enabled: boolean) {
    const skill = await resolveCodexSkill(emit, cwd, selector);
    const result = await (await getCodexApp(emit)).setSkillEnabled(skill.path, enabled);
    return { ...result, skill: { ...skill, enabled: result.effectiveEnabled } };
}

/** 读取指定 Codex 线程及其聊天历史。 */
export async function readCodexThread(emit: AgentEmit, threadId: string, cwd?: string) {
    const app = await getCodexApp(emit);
    const history = await loadCodexHistory(emit, threadId, cwd);
    const supplementalItems = await codexEventHistory.readThread(threadId);
    const messages = await mergeMessageMetadata(threadId, threadMessages(history.thread, app.planUpdates(threadId), supplementalItems));
    return { thread: summarizeCodexThread(history.thread), messages, settledTurnIds: settledTurnIds(history.thread, supplementalItems), historyReady: history.historyReady };
}

/** 归档指定 Codex 线程。 */
export async function archiveCodexThread(emit: AgentEmit, threadId: string, cwd?: string) {
    const app = await getCodexApp(emit);
    try {
        await loadCodexThread(emit, threadId, cwd, false);
    } catch (error) {
        if (!isRecoverableThreadError(error)) throw error;
        await resumeLoadedThread(app, threadId, cwd, "request", false);
    }
    await app.archiveThread(threadId);
    app.clearPlanUpdates(threadId);
    await codexEventHistory.removeThread(threadId);
    await messageMetadataStore.removeThread(threadId).catch((error) => logger.warn("Failed to remove archived thread message metadata", { threadId, error }));
    if (loadedThreadId === threadId) loadedThreadId = "";
}

async function mergeMessageMetadata<T extends { role: string; threadId: string; turnId: string }>(threadId: string, messages: T[]) {
    try {
        return await messageMetadataStore.mergeThread(threadId, messages);
    } catch (error) {
        logger.warn("Failed to read thread message metadata", { threadId, error });
        return messages;
    }
}

/** 判断线程异常是否允许自动新建线程后重试。 */
export function isRecoverableThreadError(error: unknown) {
    return /thread not loaded|no rollout found/i.test(errorMessage(error));
}

/** 执行一次 Codex turn，并负责附件临时文件和线程恢复。 */
async function runCodexTurnNow(prompt: string, lifecycleEmit: AgentEmit, attachments: AgentAttachment[], options: CodexRunOptions) {
    let files: string[] = [];
    try {
        options.onStart?.();
        files = await writeAttachmentFiles(attachments);
        const app = await getCodexApp(options.appEmit || lifecycleEmit);
        let threadId = await ensureCodexThread(app, options, lifecycleEmit);
        options.onThread?.(threadId);
        try {
            await app.startTurn(threadId, prompt, files, options.permissionMode || "request", options.model, options.effort, options.onTurn, options.skill, options.messageText);
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            lifecycleEmit("agent_log", { text: `Codex thread unavailable, starting a new thread: ${errorMessage(error)}` });
            loadedThreadId = "";
            threadId = await ensureCodexThread(app, { cwd: options.cwd }, lifecycleEmit);
            options.onThread?.(threadId);
            await app.startTurn(threadId, prompt, files, options.permissionMode || "request", options.model, options.effort, options.onTurn, options.skill, options.messageText);
        }
    } catch (error) {
        logger.error("Codex turn failed", error);
        if (!(error instanceof CodexReportedError)) lifecycleEmit("agent_error", { message: errorMessage(error) });
    } finally {
        options.onFinish?.();
        await Promise.all(files.map((file) => fs.unlink(file).catch(() => undefined)));
    }
}

/** 恢复请求线程或创建新的 Codex 线程。 */
async function ensureCodexThread(app: CodexAppClient, options: CodexRunOptions, emit: AgentEmit) {
    if (options.threadId) {
        if (options.threadId === loadedThreadId) return loadedThreadId;
        try {
            await resumeLoadedThread(app, options.threadId, options.cwd, options.permissionMode || "request", true);
            return loadedThreadId;
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            emit("agent_log", { text: `Codex thread unavailable, starting a new thread: ${errorMessage(error)}` });
            loadedThreadId = "";
        }
    }
    if (!loadedThreadId) {
        const thread = await app.startThread(options.cwd, options.permissionMode || "request");
        loadedThreadId = String(field(thread, "id") || "");
    }
    return loadedThreadId;
}

/** 从 app-server 读取线程并校验工作空间。 */
async function loadCodexThread(emit: AgentEmit, threadId: string, cwd: string | undefined, includeTurns: boolean) {
    const app = await getCodexApp(emit);
    const result = await app.readThread(threadId, includeTurns);
    const thread = field(result, "thread") || {};
    assertThreadWorkspace(thread, cwd);
    return thread;
}

async function generateCodexSkillDraftNow(emit: AgentEmit, cwd: string, input: CodexSkillDraftInput) {
    const app = await getCodexApp(emit);
    let threadId = "";
    try {
        const thread = input.source === "conversation" ? await app.forkSkillDraftThread(input.threadId, cwd) : await app.startSkillDraftThread(cwd);
        threadId = String(field(thread, "id") || "");
        const raw = await app.generateSkillDraft(threadId, skillDraftPrompt(input), SKILL_DRAFT_OUTPUT_SCHEMA, input.model, input.effort);
        let value: unknown;
        try {
            value = JSON.parse(raw);
        } catch {
            throw new Error("Codex 返回的 Skill 草稿不是有效 JSON");
        }
        const parsed = skillDraftSchema.safeParse(value);
        if (!parsed.success) throw new Error("Codex 返回的 Skill 草稿格式不正确");
        assertDraftHasNoSensitiveValues(parsed.data, input.source === "canvas" ? canvasPrivateValues(input.snapshot) : []);
        return parsed.data;
    } finally {
        if (threadId) await app.closeSkillDraftThread(threadId).catch((error) => logger.warn("Failed to release Skill draft thread", { threadId, error }));
    }
}

function skillDraftPrompt(input: CodexSkillDraftInput) {
    const source = input.source === "conversation"
        ? "从这个临时分支继承的完整对话中，识别已经实际完成且值得复用的稳定流程。不要总结本条提炼请求，也不要保留一次性的结论、错误排查过程或工具日志。"
        : `从下面经过清理的画布快照中，识别节点、连线和生成步骤所表达的可复用流程。不要把画布节点 ID 写进执行说明。\n\n画布快照：\n${JSON.stringify(canvasSkillSource(input.snapshot))}`;
    return [
        "请生成一个可编辑的 Codex Skill 草稿。",
        source,
        "要求：",
        "- name 使用不超过 64 个字符的小写字母、数字和连字符，优先使用简短的动词短语。",
        "- description 同时说明能力和触发场景；所有何时使用的信息都写在这里。",
        "- instructions 只写另一个 Codex 真正需要的、可复用的命令式步骤、约束和输出要求，不写 YAML frontmatter。",
        "- shortDescription 写 25–64 个字符的人类可读短说明；没有合适内容时返回空字符串。",
        "- defaultPrompt 必须包含与 name 完全一致的 $skill-name 调用标记；没有合适内容时返回空字符串。",
        "- displayName 使用简洁的人类可读名称。",
        "- 不得输出 Token、API Key、密码、凭证、本地路径、媒体 URL、敏感 URL、临时错误、调试日志或一次性结果。",
        "只按 outputSchema 返回对象。",
    ].join("\n");
}

const MAX_CANVAS_SKILL_NODES = 300;
const MAX_CANVAS_SKILL_CONNECTIONS = 600;
const MAX_CANVAS_SKILL_NODE_CHARS = 100_000;
const MAX_CANVAS_SKILL_SOURCE_CHARS = 120_000;

/** 只保留理解画布流程所需的信息，避免把媒体、外部地址、坐标和本地凭证送入草稿线程。 */
export function canvasSkillSource(snapshot: CanvasSnapshot): JsonRecord {
    const allNodes = prioritizedCanvasNodes(snapshot);
    const nodes = allNodes.slice(0, MAX_CANVAS_SKILL_NODES);
    const nodeRefs = new Map(allNodes.map((node, index) => [node.id, `node-${index + 1}`]));
    const title = cleanCanvasString(snapshot.title, nodeRefs);
    const source: JsonRecord & { nodes: JsonRecord[]; connections: Array<{ from: string; to: string }> } = {
        ...(title ? { title } : {}),
        nodes: [],
        connections: [],
    };
    let truncated = nodes.length < allNodes.length;
    nodes.forEach((node, index) => {
        const metadata = { ...(node.metadata || {}) };
        if (node.type !== "text") delete metadata.content;
        const cleanMetadata = sanitizeCanvasValue(metadata, nodeRefs);
        const nodeTitle = cleanCanvasString(node.title, nodeRefs);
        const summary = { ref: `node-${index + 1}`, type: node.type, ...(nodeTitle ? { title: nodeTitle } : {}) };
        const candidate = { ...summary, ...(cleanMetadata && Object.keys(cleanMetadata as JsonRecord).length ? { metadata: cleanMetadata } : {}) };
        if (canvasSourceFits({ ...source, nodes: [...source.nodes, candidate] }, MAX_CANVAS_SKILL_NODE_CHARS)) source.nodes.push(candidate);
        else if (canvasSourceFits({ ...source, nodes: [...source.nodes, summary] }, MAX_CANVAS_SKILL_NODE_CHARS)) (source.nodes.push(summary), truncated = true);
        else truncated = true;
    });
    const includedRefs = new Set(source.nodes.map((node) => String(node.ref || "")));
    const selectedNodeRefs = (snapshot.selectedNodeIds || []).flatMap((id) => nodeRefs.get(id) || []).filter((ref) => includedRefs.has(ref));
    if (selectedNodeRefs.length) source.selectedNodeRefs = selectedNodeRefs;
    const connections = (snapshot.connections || []).flatMap(({ fromNodeId, toNodeId }) => {
        const from = nodeRefs.get(fromNodeId);
        const to = nodeRefs.get(toNodeId);
        return from && to && includedRefs.has(from) && includedRefs.has(to) ? [{ from, to }] : [];
    });
    if (connections.length > MAX_CANVAS_SKILL_CONNECTIONS) truncated = true;
    connections.slice(0, MAX_CANVAS_SKILL_CONNECTIONS).forEach((connection) => {
        if (canvasSourceFits({ ...source, connections: [...source.connections, connection] }, MAX_CANVAS_SKILL_SOURCE_CHARS - 32)) source.connections.push(connection);
        else truncated = true;
    });
    if (truncated) source.truncated = true;
    return source;
}

const sensitiveCanvasKey = /api.?key|token|secret|password|authorization|credential|storage.?key|(?:local|file).?path/i;
const transientCanvasKey = /^(?:status|progress|errorDetails|taskId|createdAt|updatedAt|startedAt|completedAt)$/i;
const canvasNodeReferenceKey = /^.*(?:Node|Group|Parent|Child|Root|Source|Target|PrimaryImage)Ids?$/i;
const directLocalPath = /^(?:file:(?:\/\/)?|[a-z]:[\\/]|\\\\|\/(?!\/)(?=[^\s`'"“”<>]+\/))/i;
const fileUrl = /\bfile:(?:\/\/)?[^\s`'"“”<>]+/gi;
const inlineLocalPath = /(?<![A-Za-z0-9/:])(?:[a-z]:[\\/]|\\\\)[^\s`'"“”<>]+|(?<![\p{L}\p{N}/:])\/(?!\/)(?=[^\s`'"“”<>]+\/)[^\s`'"“”<>]+/giu;
const credentialAssignment = /(?:api[_ -]?key|access[_ -]?(?:key|token)|connect[_ -]?token|token|secret|password|authorization|credential)\s*(?:[:=：]|为|是)\s*(?:bearer\s+)?[`'"“]?[A-Za-z0-9_./+\-=]{8,}/gi;
const bearerToken = /\bbearer\s+[A-Za-z0-9._~+/=\-]{8,}/gi;
const jwtToken = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const knownApiToken = /\b(?:sk-[A-Za-z0-9_-]{12,}|(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g;
const transientIdentifier = /\b(?:task|job|request|generation|node)[_-](?:\d{4,}|[A-Fa-f0-9]{8,}|(?=[A-Za-z0-9_-]{12,}\b)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+)\b/gi;
const webUrl = /\bhttps?:\/\/[^\s<>{}\[\]`'"“”]+/gi;

function sanitizeCanvasValue(value: unknown, nodeRefs: Map<string, string>, depth = 0): unknown {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return cleanCanvasString(value, nodeRefs);
    if (depth >= 6) return undefined;
    if (Array.isArray(value)) return value.slice(0, 300).map((item) => sanitizeCanvasValue(item, nodeRefs, depth + 1)).filter((item) => item !== undefined);
    if (!value || typeof value !== "object") return undefined;
    const result: JsonRecord = {};
    Object.entries(value as JsonRecord).forEach(([key, item]) => {
        if (sensitiveCanvasKey.test(key) || transientCanvasKey.test(key)) return;
        if (canvasNodeReferenceKey.test(key)) {
            const refs = (Array.isArray(item) ? item : [item]).flatMap((id) => typeof id === "string" ? nodeRefs.get(id) || [] : []);
            if (refs.length) result[key.replace(/Ids$/i, "Refs").replace(/Id$/i, "Ref")] = Array.isArray(item) ? [...new Set(refs)] : refs[0];
            return;
        }
        const clean = sanitizeCanvasValue(item, nodeRefs, depth + 1);
        if (clean !== undefined) result[replaceCanvasNodeRefs(key, nodeRefs)] = clean;
    });
    return result;
}

function cleanCanvasString(value: unknown, nodeRefs: Map<string, string>) {
    const valueText = typeof value === "string" ? value.trim() : "";
    if (!valueText || /^(?:data:|blob:|https?:\/\/|file:)/i.test(valueText) || directLocalPath.test(valueText)) return undefined;
    const text = replaceCanvasNodeRefs(valueText, nodeRefs)
        .replace(/\b(?:data:|blob:)[^\s`'"“”<>]+/gi, "[媒体地址已移除]")
        .replace(fileUrl, "[本地路径已移除]")
        .replace(webUrl, "[外部地址已移除]")
        .replace(inlineLocalPath, "[本地路径已移除]")
        .replace(credentialAssignment, "[敏感凭证已移除]")
        .replace(bearerToken, "[敏感凭证已移除]")
        .replace(jwtToken, "[敏感凭证已移除]")
        .replace(knownApiToken, "[敏感凭证已移除]")
        .trim();
    return text.length > 12000 ? `${text.slice(0, 12000)}\n[内容已截断]` : text || undefined;
}

function replaceCanvasNodeRefs(value: string, nodeRefs: Map<string, string>) {
    const nodeIds = [...nodeRefs.keys()].filter(Boolean).sort((left, right) => right.length - left.length);
    const nodeIdPattern = nodeIds.length ? new RegExp(nodeIds.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : undefined;
    return nodeIdPattern ? value.replace(nodeIdPattern, (id) => nodeRefs.get(id) || id) : value;
}

function prioritizedCanvasNodes(snapshot: CanvasSnapshot) {
    const nodes = snapshot.nodes || [];
    const selectedIds = new Set(snapshot.selectedNodeIds || []);
    const relatedIds = new Set<string>();
    (snapshot.connections || []).forEach(({ fromNodeId, toNodeId }) => {
        if (selectedIds.has(fromNodeId)) relatedIds.add(toNodeId);
        if (selectedIds.has(toNodeId)) relatedIds.add(fromNodeId);
    });
    return [
        ...nodes.filter((node) => selectedIds.has(node.id)),
        ...nodes.filter((node) => !selectedIds.has(node.id) && relatedIds.has(node.id)),
        ...nodes.filter((node) => !selectedIds.has(node.id) && !relatedIds.has(node.id)),
    ];
}

function canvasSourceFits(source: JsonRecord, limit: number) {
    return JSON.stringify(source).length <= limit;
}

function canvasPrivateValues(snapshot: CanvasSnapshot) {
    return [snapshot.projectId, snapshot.clientId, ...(snapshot.nodes || []).map((node) => node.id), ...(snapshot.connections || []).map((connection) => connection.id)]
        .filter((value): value is string => typeof value === "string" && value.length >= 6);
}

function patternMatches(pattern: RegExp, text: string) {
    pattern.lastIndex = 0;
    return pattern.test(text);
}

function mentionsSkill(prompt: string, name: string) {
    return new RegExp(`\\$${name}(?![A-Za-z0-9_-]|:[A-Za-z0-9_-])`).test(prompt);
}

export function assertDraftHasNoSensitiveValues(draft: AgentSkillDraft, privateValues: string[]) {
    const text = Object.values(draft).join("\n");
    const localPath = /(?:^|[\s`'"“”（(\[{,:;：])(?:file:(?:\/\/)?|[a-z]:[\\/]|\\\\|\/(?!\/))/im;
    const externalUrl = (text.match(webUrl) || []).length > 0;
    const hasPrivateValue = privateValues.some((value) => text.includes(value));
    if (localPath.test(text) || /\b(?:data:|blob:)/i.test(text) || patternMatches(credentialAssignment, text) || patternMatches(bearerToken, text) || patternMatches(jwtToken, text) || patternMatches(knownApiToken, text) || patternMatches(transientIdentifier, text) || externalUrl || hasPrivateValue) {
        throw new Error("生成的 Skill 草稿包含外部地址、本地路径、敏感凭证或一次性标识，已拒绝返回");
    }
}

/** 读取线程历史，并显式标记 Codex 是否已经物化 turns。 */
async function loadCodexHistory(emit: AgentEmit, threadId: string, cwd?: string) {
    try {
        return { thread: await loadCodexThread(emit, threadId, cwd, true), historyReady: true };
    } catch (error) {
        if (/not materialized yet.*includeTurns/i.test(errorMessage(error))) return { thread: await loadCodexThread(emit, threadId, cwd, false), historyReady: false };
        if (!isRecoverableThreadError(error)) throw error;
        const app = await getCodexApp(emit);
        const thread = await resumeLoadedThread(app, threadId, cwd, "request", false);
        try {
            return { thread: await loadCodexThread(emit, threadId, cwd, true), historyReady: true };
        } catch (historyError) {
            if (/not materialized yet.*includeTurns/i.test(errorMessage(historyError))) return { thread, historyReady: false };
            throw historyError;
        }
    }
}

/** 恢复线程并统一校验工作空间与进程内活动线程。 */
async function resumeLoadedThread(app: CodexAppClient, threadId: string, cwd?: string, permissionMode: AgentPermissionMode = "request", updateLoaded = true, preheat = false) {
    const thread = await app.resumeThread(threadId, cwd, permissionMode, preheat);
    assertThreadWorkspace(thread, cwd);
    if (updateLoaded) loadedThreadId = String(field(thread, "id") || threadId);
    return thread;
}

/** 获取已启动的 Codex app-server 客户端。 */
async function getCodexApp(emit: AgentEmit) {
    if (codexApp) return codexApp;
    codexAppStart ||= CodexAppClient.start(emit, () => {
        codexApp = null;
        loadedThreadId = "";
    });
    try {
        codexApp = await codexAppStart;
        return codexApp;
    } finally {
        codexAppStart = null;
    }
}

/** 校验线程是否属于指定工作空间。 */
function assertThreadWorkspace(thread: unknown, cwd?: string) {
    if (!cwd || threadInWorkspace(thread, cwd)) return;
    throw new Error("该 Codex 会话不属于当前画布工作空间");
}

/** 判断线程工作目录是否与当前工作空间一致。 */
function threadInWorkspace(thread: unknown, cwd: string) {
    const threadCwd = String(field(thread, "cwd") || "");
    return Boolean(threadCwd && samePath(threadCwd, cwd));
}

/** 比较跨平台绝对路径；Windows 路径不区分大小写。 */
function samePath(left: string, right: string) {
    const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    return normalize(left) === normalize(right);
}

/** 将图片附件写入临时文件供 Codex 读取。 */
async function writeAttachmentFiles(attachments: AgentAttachment[]) {
    return await Promise.all(attachments.filter((item) => item.dataUrl?.startsWith("data:image/")).map(writeAttachmentFile));
}

/** 将单个 Data URL 图片附件写入临时文件。 */
async function writeAttachmentFile(item: AgentAttachment) {
    const [, meta = "", data = ""] = item.dataUrl?.match(/^data:([^;]+);base64,(.+)$/) || [];
    if (!data) throw new Error(`图片附件无效：${item.name || "未命名图片"}`);
    const file = path.join(os.tmpdir(), `infinite-canvas-${Date.now()}-${Math.random().toString(16).slice(2)}.${imageExt(meta || item.type)}`);
    await fs.writeFile(file, Buffer.from(data, "base64"));
    return file;
}

/** 根据图片 MIME 类型返回临时文件扩展名。 */
function imageExt(type = "") {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    return "jpg";
}
