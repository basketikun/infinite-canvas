import { field } from "../utils/value.js";
import type { CodexPlanUpdate } from "./codex-protocol.js";

type AgentHistoryMessage = { id: string; itemId: string; threadId: string; turnId: string; role: "user" | "assistant" | "tool" | "error"; title?: string; text: string; detail?: unknown; activityItems?: Record<string, string> };
export type CodexSupplementalHistoryItem = { threadId: string; turnId: string; itemId: string; sequence?: number; item: Record<string, unknown> };
export type CodexSupplementalHistoryTurn = { threadId: string; turnId: string; turn: Record<string, unknown> };
export type CodexSupplementalHistory = { items: CodexSupplementalHistoryItem[]; turns: CodexSupplementalHistoryTurn[] };

const emptySupplementalHistory: CodexSupplementalHistory = { items: [], turns: [] };

/** 将 Codex 线程转换为列表展示所需的摘要。 */
export function summarizeCodexThread(thread: unknown) {
    const status = field(thread, "status");
    return {
        id: String(field(thread, "id") || ""),
        sessionId: String(field(thread, "sessionId") || ""),
        preview: displayUserText(String(field(thread, "preview") || "")),
        name: stringOrNull(field(thread, "name")),
        cwd: String(field(thread, "cwd") || ""),
        status: typeof status === "string" ? status : String(field(status, "type") || ""),
        source: field(thread, "source"),
        threadSource: field(thread, "threadSource"),
        createdAt: Number(field(thread, "createdAt") || 0),
        updatedAt: Number(field(thread, "updatedAt") || 0),
    };
}

/** 返回已经终结、可由持久化历史作为权威内容的 turn。 */
export function settledTurnIds(thread: unknown, supplementalHistory: CodexSupplementalHistory = emptySupplementalHistory) {
    return mergeHistoryTurns(thread, supplementalHistory).flatMap((turn) => {
        const id = String(field(turn, "id") || "");
        return id && isSettledTurn(turn) ? [id] : [];
    });
}

/** 将 Codex turn items 转换为网页聊天历史。 */
export function threadMessages(thread: unknown, planUpdates: CodexPlanUpdate[] = [], supplementalHistory: CodexSupplementalHistory = emptySupplementalHistory): AgentHistoryMessage[] {
    const threadId = String(field(thread, "id") || "");
    if (!threadId) return [];
    const turns = mergeHistoryTurns(thread, supplementalHistory);
    const plansByTurn = new Map(planUpdates.map((item) => [item.turnId, item]));
    const supplementalByTurn = new Map<string, CodexSupplementalHistoryItem[]>();
    supplementalHistory.items.filter((item) => item.threadId === threadId).forEach((item) => supplementalByTurn.set(item.turnId, [...(supplementalByTurn.get(item.turnId) || []), item]));
    const messages: AgentHistoryMessage[] = [];
    turns.forEach((turn) => {
        const turnId = String(field(turn, "id") || "");
        if (!turnId || !isSettledTurn(turn)) return;
        const turnError = String(field(field(turn, "error"), "message") || "").trim();
        const items = mergeHistoryItems(arrayValue(field(turn, "items")), supplementalByTurn.get(turnId) || []);
        const push = (message: Omit<AgentHistoryMessage, "itemId" | "threadId" | "turnId">) => messages.push({ ...message, id: historyMessageId(threadId, turnId, message.id), itemId: message.id, threadId, turnId });
        const planMessage = structuredPlanMessage(plansByTurn.get(turnId) || { threadId, turnId, explanation: stringOrNull(field(turn, "explanation")), plan: arrayValue(field(turn, "plan")) as CodexPlanUpdate["plan"], turnStatus: String(field(turn, "status") || "") }, threadId);
        const reasoningItems = items.flatMap((item) => {
            if (field(item, "type") !== "reasoning") return [];
            const id = String(field(item, "id") || "");
            const text = readableText(field(item, "summary"));
            return id && text ? [{ id, text, status: itemStatus(item, itemErrorMessage(item)) }] : [];
        });
        const reasoningText = reasoningItems.map((item) => item.text).join("\n\n");
        const reasoningStatus = aggregateItemStatus(reasoningItems.map((item) => item.status));
        const itemErrors = items.flatMap((item) => field(item, "type") === "error" ? [readableText(field(item, "message"))] : []).filter(Boolean);
        const itemError = itemErrors[itemErrors.length - 1] || "";
        let userAdded = false;
        let planAdded = false;
        let reasoningAdded = false;
        const explicitUserText = displayUserText(String(field(turn, "messageText") || ""));
        const fallbackUserText = explicitUserText || displayUserText(String(field(turn, "input") || ""));
        if (fallbackUserText && (explicitUserText || !items.some((item) => field(item, "type") === "userMessage"))) {
            push({ id: "synthetic:user", role: "user", text: fallbackUserText });
            userAdded = true;
            if (planMessage) {
                messages.push(planMessage);
                planAdded = true;
            }
        }
        items.forEach((item) => {
            const type = String(field(item, "type") || "");
            const id = String(field(item, "id") || "");
            if (!id) return;
            if (type === "userMessage") {
                const text = displayUserText(userInputText(field(item, "content")));
                if (text && !userAdded) {
                    push({ id: "synthetic:user", role: "user", text });
                    userAdded = true;
                }
                if (planMessage && !planAdded) {
                    messages.push(planMessage);
                    planAdded = true;
                }
            }
            if (type === "agentMessage") {
                const text = String(field(item, "text") || "").trim();
                if (text) push({ id, role: "assistant", title: "Codex", text });
            }
            if (type === "mcpToolCall") {
                const tool = String(field(item, "tool") || "工具调用");
                const error = String(field(field(item, "error"), "message") || "");
                const input = toolArguments(field(item, "arguments"));
                push({ id, role: "tool", title: toolName(tool), text: error || toolHistorySummary(tool, item, input), detail: toolHistoryDetail(tool, item, input, error) });
            }
            if (type === "commandExecution") {
                const command = String(field(item, "command") || "").trim();
                const detail = commandDetail(item);
                push({ id, role: "tool", title: "执行命令", text: command || (detail.status === "failed" ? "命令执行失败" : "命令已完成"), detail });
            }
            if (type === "fileChange") {
                const changes = arrayValue(field(item, "changes"));
                const error = itemErrorMessage(item);
                push({ id, role: "tool", title: "修改文件", text: error || fileChangeSummary(changes), detail: { kind: "file", status: itemStatus(item, error), files: changes.map((change) => ({ path: String(field(change, "path") || "未知文件"), action: changeKind(field(change, "kind")) })), ...(error ? { output: error } : {}) } });
            }
            if (type === "reasoning" && reasoningText && !reasoningAdded) {
                const sourceItemIds = reasoningItems.map((item) => item.id);
                push({ id: "synthetic:reasoning", role: "tool", title: "思考摘要", text: reasoningText, activityItems: Object.fromEntries(reasoningItems.map((item) => [item.id, item.text])), detail: { kind: "reasoning", status: reasoningStatus, sourceItemIds } });
                reasoningAdded = true;
            }
            if (type === "plan") {
                const text = String(field(item, "text") || "").trim();
                const error = itemErrorMessage(item);
                if (text || error) push({ id, role: "tool", title: "执行计划", text: error || text, detail: { kind: "plan", status: itemStatus(item, error), ...(error ? { output: error } : {}) } });
            }
            if (type === "webSearch") {
                const error = itemErrorMessage(item);
                push({ id, role: "tool", title: "搜索资料", text: error || webSearchSummary(item), detail: { kind: "search", status: itemStatus(item, error), rows: webSearchRows(item), ...(error ? { output: error } : {}) } });
            }
            if (type === "imageView") {
                const error = itemErrorMessage(item);
                push({ id, role: "tool", title: "查看图片", text: error || String(field(item, "path") || "已查看图片"), detail: { kind: "image", status: itemStatus(item, error), ...(error ? { output: error } : {}) } });
            }
            if (type === "imageGeneration") {
                const error = String(field(field(item, "error"), "message") || "");
                const normalizedStatus = itemStatus(item, error);
                push({ id, role: "tool", title: "内置生图", text: error || (normalizedStatus === "failed" ? "图片生成失败" : "图片生成完成"), detail: { kind: "image", status: normalizedStatus, savedPath: field(item, "savedPath"), ...(error ? { output: error } : {}) } });
            }
            if (type === "contextCompaction") {
                const error = itemErrorMessage(item);
                push({ id, role: "tool", title: "整理上下文", text: error || "已整理当前对话，继续处理任务", detail: { kind: "context", status: itemStatus(item, error), ...(error ? { output: error } : {}) } });
            }
            if (type === "dynamicToolCall") {
                const tool = String(field(item, "tool") || "");
                const title = toolName(tool);
                const error = itemErrorMessage(item);
                push({ id, role: "tool", title, text: error || readableText(field(item, "contentItems")), detail: toolHistoryDetail(tool, item, toolArguments(field(item, "arguments")), error) });
            }
            if (type === "collabToolCall" || type === "collabAgentToolCall") {
                const error = String(field(field(item, "error"), "message") || "");
                const normalizedStatus = itemStatus(item, error);
                push({ id, role: "tool", title: "协作处理", text: error || (normalizedStatus === "failed" ? "协作任务失败" : "已完成协作任务"), detail: { kind: "tool", status: normalizedStatus, ...(error ? { output: error } : {}) } });
            }
        });
        if (planMessage && !planAdded) messages.push(planMessage);
        if (itemError || turnError) {
            const error = userFacingCodexError(turnError || itemError);
            push({ id: "synthetic:error", role: "error", title: error.title, text: error.text });
        }
    });
    return latestCompleteTurns(messages.filter((item) => item.text || item.role === "tool"), 120);
}

/** 合并标准 turn 与本地终态事件，标准历史已有字段保持优先。 */
function mergeHistoryTurns(thread: unknown, supplementalHistory: CodexSupplementalHistory) {
    const threadId = String(field(thread, "id") || "");
    const standardTurns = arrayValue(field(thread, "turns"));
    const supplementalTurns = supplementalHistory.turns.filter((entry) => entry.threadId === threadId && entry.turnId);
    const supplementalById = new Map(supplementalTurns.map((entry) => [entry.turnId, entry.turn]));
    const standardIds = new Set(standardTurns.map((turn) => String(field(turn, "id") || "")).filter(Boolean));
    return [
        ...standardTurns.map((turn) => {
            const turnId = String(field(turn, "id") || "");
            const supplemental = supplementalById.get(turnId);
            return supplemental ? mergeHistoryTurn(turn, supplemental) : turn;
        }),
        ...supplementalTurns.filter((entry) => !standardIds.has(entry.turnId)).map((entry) => entry.turn),
    ];
}

/** 终态不可被标准历史中尚未物化完成的临时状态降级。 */
function mergeHistoryTurn(standard: unknown, supplemental: Record<string, unknown>) {
    const merged = mergeHistoryItem(standard, supplemental);
    const standardStatus = String(field(standard, "status") || "");
    const supplementalStatus = String(field(supplemental, "status") || "");
    if (!isSettledStatus(standardStatus) && isSettledStatus(supplementalStatus)) merged.status = supplementalStatus;
    return merged;
}

/** 以 Codex 标准历史为准，只补入同一 turn 中被持久线程投影省略的实时条目。 */
function mergeHistoryItems(items: unknown[], supplementalItems: CodexSupplementalHistoryItem[]) {
    const supplemental = supplementalItems
        .filter((entry) => entry.itemId)
        .map((entry, index) => ({ ...entry, item: normalizeSupplementalItem(entry.item), fallbackIndex: index }))
        .sort(compareSupplementalEntries);
    items = removeCorruptedHistoryDuplicates(items, supplemental);
    items = reconcileHistoryItemIds(items, supplemental);
    const standardIds = new Set(items.map((item) => String(field(item, "id") || "")).filter(Boolean));
    const supplementalById = new Map(supplemental.map((entry) => [entry.itemId, entry]));
    const mergedStandard = items.map((item) => {
        const id = String(field(item, "id") || "");
        const supplementalEntry = id ? supplementalById.get(id) : undefined;
        return supplementalEntry ? mergeHistoryItem(item, supplementalEntry.item) : item;
    });
    const sequenced = supplemental.filter((entry) => entry.sequence !== undefined);
    let merged = sequenced.length ? mergeSequencedItems(mergedStandard, sequenced) : mergedStandard;
    supplemental.forEach((entry, index) => {
        if (standardIds.has(entry.itemId) || entry.sequence !== undefined) return;
        const nextStandardId = supplemental.slice(index + 1).find((candidate) => standardIds.has(candidate.itemId))?.itemId;
        const insertAt = nextStandardId ? merged.findIndex((candidate) => String(field(candidate, "id") || "") === nextStandardId) : -1;
        if (insertAt >= 0) merged.splice(insertAt, 0, entry.item);
        else merged.push(entry.item);
    });
    return merged;
}

/** thread/read 会重写部分 item id；按类型、内容和出现顺序恢复实时事件的稳定身份。 */
function reconcileHistoryItemIds(items: unknown[], supplementalItems: CodexSupplementalHistoryItem[]) {
    const supplementalById = new Map(supplementalItems.map((entry) => [entry.itemId, entry]));
    const reservedIds = new Set(items.map((item) => String(field(item, "id") || "")).filter((id) => supplementalById.has(id)));
    const candidates = new Map<string, CodexSupplementalHistoryItem[]>();
    supplementalItems.forEach((entry) => {
        if (reservedIds.has(entry.itemId)) return;
        const identity = historyItemIdentity(entry.item);
        if (identity) candidates.set(identity, [...(candidates.get(identity) || []), entry]);
    });
    const replacements = new Map<number, string>();
    const usedSupplementalIds = new Set(reservedIds);
    items.forEach((item, index) => {
        const id = String(field(item, "id") || "");
        if (!id || supplementalById.has(id)) return;
        const identity = historyItemIdentity(item);
        const candidate = identity ? candidates.get(identity)?.shift() : undefined;
        if (!candidate || usedSupplementalIds.has(candidate.itemId)) return;
        replacements.set(index, candidate.itemId);
        usedSupplementalIds.add(candidate.itemId);
    });
    const remainingStandard = new Map<string, number[]>();
    items.forEach((item, index) => {
        const id = String(field(item, "id") || "");
        if (!id || supplementalById.has(id) || replacements.has(index)) return;
        const type = historyItemType(item);
        if (type) remainingStandard.set(type, [...(remainingStandard.get(type) || []), index]);
    });
    const remainingSupplemental = new Map<string, CodexSupplementalHistoryItem[]>();
    supplementalItems.forEach((entry) => {
        if (usedSupplementalIds.has(entry.itemId)) return;
        const type = historyItemType(entry.item);
        if (type) remainingSupplemental.set(type, [...(remainingSupplemental.get(type) || []), entry]);
    });
    remainingStandard.forEach((standardIndexes, type) => {
        const supplemental = remainingSupplemental.get(type) || [];
        if (standardIndexes.length === supplemental.length) {
            standardIndexes.forEach((index, position) => {
                const entry = supplemental[position];
                replacements.set(index, entry.itemId);
                usedSupplementalIds.add(entry.itemId);
            });
            return;
        }
        if (supplemental.length !== 1) return;
        const corrupted = standardIndexes.filter((index) => hasReplacementCharacter(items[index]));
        if (corrupted.length === 1) {
            replacements.set(corrupted[0], supplemental[0].itemId);
            usedSupplementalIds.add(supplemental[0].itemId);
        }
    });
    return items.map((item, index) => {
        const itemId = replacements.get(index);
        if (!itemId || !item || typeof item !== "object" || Array.isArray(item)) return item;
        return { ...(item as Record<string, unknown>), id: itemId };
    });
}

function historyItemType(item: unknown) {
    const type = String(field(normalizeSupplementalItem(item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {}), "type") || "");
    return type;
}

function hasReplacementCharacter(item: unknown) {
    const value = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return [value.text, value.summary, value.message, value.aggregatedOutput].some((fieldValue) => readableText(fieldValue).includes("\uFFFD"));
}

/** thread/read 偶尔同时返回损坏临时条目和已物化条目，只保留补充历史已确认的稳定副本。 */
function removeCorruptedHistoryDuplicates(items: unknown[], supplementalItems: CodexSupplementalHistoryItem[]) {
    const standardIds = new Set(items.map((item) => String(field(item, "id") || "")).filter(Boolean));
    const stableItems = supplementalItems.filter((entry) => standardIds.has(entry.itemId) && !hasReplacementCharacter(entry.item));
    return items.filter((item) => {
        if (!hasReplacementCharacter(item)) return true;
        const identity = comparableHistoryText(item);
        if (identity.length < 8) return true;
        return !stableItems.some((entry) => historyItemType(entry.item) === historyItemType(item) && comparableHistoryText(entry.item) === identity);
    });
}

function comparableHistoryText(item: unknown) {
    const value = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const type = historyItemType(value);
    const text = type === "agentMessage" ? value.text : type === "reasoning" ? value.summary : type === "plan" ? value.text : "";
    return readableText(text).normalize("NFKC").toLocaleLowerCase().replace(/[\uFFFD\p{P}\p{S}\p{Z}]+/gu, "");
}

/** 只使用消息本身的稳定语义字段，不使用状态、结果或临时投影 id。 */
function historyItemIdentity(item: unknown) {
    const normalized = normalizeSupplementalItem(item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {});
    const type = String(field(normalized, "type") || "");
    let value: unknown;
    if (type === "agentMessage") value = String(field(normalized, "text") || "").trim();
    else if (type === "reasoning") value = readableText(field(normalized, "summary"));
    else if (type === "plan") value = String(field(normalized, "text") || "").trim();
    else if (type === "mcpToolCall" || type === "dynamicToolCall") value = [field(normalized, "tool"), toolArguments(field(normalized, "arguments"))];
    else if (type === "commandExecution") value = String(field(normalized, "command") || "").trim();
    else if (type === "fileChange") value = arrayValue(field(normalized, "changes")).map((change) => [field(change, "path"), field(change, "kind")]);
    else if (type === "collabToolCall" || type === "collabAgentToolCall") value = [field(normalized, "tool"), field(normalized, "prompt"), field(normalized, "receiverThreadId"), field(normalized, "receiverAgentId")];
    else if (type === "webSearch") value = [field(normalized, "query"), field(field(normalized, "action"), "type"), field(field(normalized, "action"), "query"), field(field(normalized, "action"), "url"), field(field(normalized, "action"), "pattern")];
    else if (type === "imageView") value = field(normalized, "path");
    else if (type === "imageGeneration") value = field(normalized, "prompt") || field(normalized, "savedPath");
    else if (type === "contextCompaction") value = true;
    else return "";
    return `${type}\0${JSON.stringify(stableHistoryValue(value))}`;
}

function stableHistoryValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableHistoryValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableHistoryValue(item)]));
    return value;
}

function mergeSequencedItems(standardItems: unknown[], supplementalItems: CodexSupplementalHistoryItem[]) {
    const byId = new Map(supplementalItems.map((entry) => [entry.itemId, entry]));
    const emitted = new Set<string>();
    const merged: unknown[] = [];
    standardItems.forEach((item) => {
        const id = String(field(item, "id") || "");
        const sequence = id ? byId.get(id)?.sequence : undefined;
        if (sequence !== undefined) {
            supplementalItems.forEach((entry) => {
                if (entry.sequence !== undefined && entry.sequence < sequence && !emitted.has(entry.itemId)) {
                    merged.push(findStandardItem(standardItems, entry.itemId) || entry.item);
                    emitted.add(entry.itemId);
                }
            });
            if (emitted.has(id)) return;
            if (id) emitted.add(id);
            merged.push(item);
            return;
        }
        merged.push(item);
    });
    supplementalItems.forEach((entry) => {
        if (!emitted.has(entry.itemId)) merged.push(entry.item);
    });
    return merged;
}

function findStandardItem(items: unknown[], itemId: string) {
    return items.find((item) => String(field(item, "id") || "") === itemId);
}

function compareSupplementalEntries(left: CodexSupplementalHistoryItem & { fallbackIndex: number }, right: CodexSupplementalHistoryItem & { fallbackIndex: number }) {
    if (left.sequence !== undefined && right.sequence !== undefined && left.sequence !== right.sequence) return left.sequence - right.sequence;
    if (left.sequence !== undefined) return -1;
    if (right.sequence !== undefined) return 1;
    return left.fallbackIndex - right.fallbackIndex;
}

/** 标准历史字段优先，补充事件只填充标准历史没有返回的字段。 */
function mergeHistoryItem(standard: unknown, supplemental: Record<string, unknown>) {
    if (!standard || typeof standard !== "object" || Array.isArray(standard)) return supplemental;
    const merged = { ...supplemental };
    Object.entries(standard as Record<string, unknown>).forEach(([key, value]) => {
        const supplementalValue = merged[key];
        if (typeof value === "string" && typeof supplementalValue === "string" && value.includes("\uFFFD") && !supplementalValue.includes("\uFFFD")) return;
        if (value !== undefined) merged[key] = value;
    });
    return merged;
}

/** 将实时事件的 snake_case 类型还原为 thread/read 使用的 camelCase 类型。 */
function normalizeSupplementalItem(item: Record<string, unknown>) {
    const type = String(field(item, "type") || "");
    const normalizedType = supplementalItemTypes[type] || type;
    return normalizedType === type ? item : { ...item, type: normalizedType };
}

const supplementalItemTypes: Record<string, string> = {
    agent_message: "agentMessage",
    mcp_tool_call: "mcpToolCall",
    command_execution: "commandExecution",
    file_change: "fileChange",
    dynamic_tool_call: "dynamicToolCall",
    collab_tool_call: "collabToolCall",
    web_search: "webSearch",
    image_view: "imageView",
    image_generation: "imageGeneration",
    context_compaction: "contextCompaction",
};

/** 只按完整 turn 截取最近历史，避免列表从某轮中间开始。 */
function latestCompleteTurns(messages: AgentHistoryMessage[], limit: number) {
    const turns: AgentHistoryMessage[][] = [];
    messages.forEach((message) => {
        const current = turns.at(-1);
        if (!current || current[0].turnId !== message.turnId) turns.push([message]);
        else current.push(message);
    });
    const selected: AgentHistoryMessage[][] = [];
    let count = 0;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        const turn = turns[index];
        if (selected.length && count + turn.length > limit) break;
        selected.unshift(turn);
        count += turn.length;
    }
    return selected.flat();
}

function isSettledTurn(turn: unknown) {
    return isSettledStatus(String(field(turn, "status") || ""));
}

function isSettledStatus(status: string) {
    return ["completed", "failed", "interrupted", "cancelled", "canceled"].includes(status);
}

/** 将结构化任务计划转换为聊天进度卡片。 */
function structuredPlanMessage(update: CodexPlanUpdate, threadId: string): AgentHistoryMessage | null {
    const tasks = arrayValue(update.plan).flatMap((item) => {
        const step = String(field(item, "step") || "").trim();
        return step ? [{ step, status: String(field(item, "status") || "pending") }] : [];
    });
    if (!tasks.length) return null;
    const completed = tasks.filter((item) => item.status === "completed").length;
    return {
        id: historyMessageId(threadId, update.turnId, "synthetic:plan"),
        itemId: "synthetic:plan",
        threadId,
        turnId: update.turnId,
        role: "tool",
        title: "任务进度",
        text: `已完成 ${completed}/${tasks.length} 项`,
        detail: { kind: "todo", status: planStatus(tasks, update.turnStatus), tasks, explanation: update.explanation || "" },
    };
}

/** 生成跨线程和 turn 唯一的聊天消息 ID。 */
function historyMessageId(threadId: string, turnId: string, itemId: string) {
    return `${threadId}:${turnId}:${itemId}`;
}

/** 根据步骤和 turn 状态生成任务卡片状态。 */
function planStatus(tasks: Array<{ status: string }>, turnStatus?: string) {
    if (turnStatus === "failed") return "failed";
    if (turnStatus === "interrupted") return "interrupted";
    if (tasks.every((item) => item.status === "completed")) return "completed";
    return turnStatus === "completed" ? "finished" : "inProgress";
}

/** 将常见 Codex 错误转换为普通用户可理解的提示。 */
function userFacingCodexError(message: string) {
    if (/selected model is at capacity/i.test(message)) return { title: "模型暂时繁忙", text: "当前选择的模型请求量过大，暂时无法处理。请稍后重试，或切换其他模型后再试。" };
    return { title: "任务失败", text: message || "Codex 未能完成本次任务，请稍后重试。" };
}

/** 提取用户输入条目中的文本与附件占位信息。 */
function userInputText(content: unknown) {
    const items = arrayValue(content);
    const text = items
        .map((item) => {
            const type = String(field(item, "type") || "");
            if (type === "text") return String(field(item, "text") || "");
            if (type === "image" || type === "localImage") return "图片附件";
            if (type === "mention") return `@${String(field(item, "name") || "文件")}`;
            return "";
        })
        .filter(Boolean)
        .join("\n");
    return text.trim();
}

/** 移除用户消息中由旧流程拼接的 Agent 前置提示词。 */
function displayUserText(text: string) {
    const value = text.trim();
    const marker = "用户请求：";
    const index = value.lastIndexOf(marker);
    const prompt = index >= 0 ? value.slice(index + marker.length) : value;
    return prompt.split("\n\n本轮可用图片附件（顺序与图片输入一致）：", 1)[0].trim();
}

/** 将未知值转换为数组。 */
function arrayValue(value: unknown) {
    return Array.isArray(value) ? value : [];
}

/** 将非空字符串保留为字符串，否则返回 null。 */
function stringOrNull(value: unknown) {
    return typeof value === "string" && value.trim() ? value : null;
}

/** 生成命令执行的用户可读详情。 */
function commandDetail(item: unknown) {
    const error = String(field(field(item, "error"), "message") || "");
    const status = String(field(item, "status") || "completed");
    const exitCode = field(item, "exitCode");
    const failed = Boolean(error) || field(item, "success") === false || status === "failed" || status === "error" || (typeof exitCode === "number" && exitCode !== 0);
    const rows = [
        textRow("工作目录", field(item, "cwd")),
        textRow("退出状态", exitCode),
        durationRow(field(item, "durationMs")),
    ].filter(Boolean);
    return { kind: "command", status: failed ? "failed" : status, rows, output: error || String(field(item, "aggregatedOutput") || "").trim() };
}

/** 生成 MCP 工具的用户可读详情。 */
function toolHistoryDetail(tool: string, item: unknown, input: unknown, error: string) {
    return { kind: "tool", status: itemStatus(item, error), rows: toolInputRows(tool, input), ...(error ? { output: error } : {}) };
}

function itemErrorMessage(item: unknown) {
    return String(field(field(item, "error"), "message") || "");
}

function itemStatus(item: unknown, error = "") {
    const status = String(field(item, "status") || "completed");
    return error || field(item, "success") === false || status === "failed" || status === "error" ? "failed" : status;
}

function aggregateItemStatus(statuses: string[]) {
    if (statuses.includes("failed")) return "failed";
    if (statuses.includes("interrupted")) return "interrupted";
    if (statuses.some((status) => ["inProgress", "in_progress", "running", "started", "pending"].includes(status))) return "inProgress";
    return "completed";
}

/** 生成 MCP 工具在对话中的结果摘要。 */
function toolHistorySummary(tool: string, item: unknown, input: unknown) {
    const result = parseToolResult(field(item, "result"));
    if (tool === "site_navigate") return `已打开${routeName(String(field(input, "path") || "/"))}`;
    if (tool === "canvas_list_projects") return `共 ${numberValue(field(result, "total"))} 个画布`;
    if (tool === "canvas_get_state") {
        const nodes = arrayValue(field(result, "nodes"));
        const connections = arrayValue(field(result, "connections"));
        return Array.isArray(field(result, "nodes")) || Array.isArray(field(result, "connections")) ? canvasContentSummary(nodes, connections.length) : "已读取当前画布内容";
    }
    if (tool === "canvas_get_selection") return "已读取当前选中内容";
    if (tool === "prompts_search") return `找到 ${numberValue(field(result, "total"))} 条提示词`;
    if (tool === "assets_list") return `共 ${numberValue(field(result, "total"))} 个资产`;
    if (tool === "assets_add") return "已加入我的素材";
    if (tool === "generation_get_status") {
        const summary = field(result, "summary");
        return `共 ${numberValue(field(result, "total"))} 个任务，排队 ${numberValue(field(summary, "queued"))}，运行中 ${numberValue(field(summary, "running"))}，成功 ${numberValue(field(summary, "succeeded"))}，失败 ${numberValue(field(summary, "failed"))}`;
    }
    if (tool === "workbench_image_generate" || tool === "workbench_video_generate") return String(field(result, "note") || "已在工作台执行");
    if (tool === "workbench_image_get_config" || tool === "workbench_video_get_config") return "已读取工作台配置";
    return "";
}

/** 按节点类型生成人类可读的画布内容概览。 */
function canvasContentSummary(nodes: unknown[], connections: number) {
    const counts = nodes.reduce<Record<string, number>>((result, node) => {
        const type = String(field(node, "type") || "other");
        result[type] = (result[type] || 0) + 1;
        return result;
    }, {});
    const known = new Set(["text", "image", "config", "video", "audio", "group"]);
    const other = Object.entries(counts).reduce((total, [type, count]) => total + (known.has(type) ? 0 : count), 0);
    const parts = [
        counts.text ? `${counts.text} 个文本` : "",
        counts.image ? `${counts.image} 张图片` : "",
        counts.config ? `${counts.config} 个配置` : "",
        counts.video ? `${counts.video} 个视频` : "",
        counts.audio ? `${counts.audio} 个音频` : "",
        counts.group ? `${counts.group} 个分组` : "",
        other ? `${other} 个其他节点` : "",
        connections ? `${connections} 条连线` : "",
    ].filter(Boolean);
    return parts.length ? parts.join("、") : "当前画布为空";
}

/** 从 MCP 历史结果中还原工具返回的数据。 */
function parseToolResult(result: unknown) {
    const content = field(result, "content");
    const text = arrayValue(content)
        .map((item) => field(item, "text"))
        .filter((item): item is string => typeof item === "string")
        .join("\n");
    try {
        return text ? JSON.parse(text) : result;
    } catch {
        return text || result;
    }
}

/** 提取工具参数中适合普通用户查看的信息。 */
function toolInputRows(tool: string, input: unknown) {
    if (tool === "site_navigate") return [textRow("目标页面", routeName(String(field(input, "path") || "/")))].filter(Boolean);
    if (tool === "prompts_search") return [textRow("搜索内容", field(input, "query"))].filter(Boolean);
    if (tool === "canvas_create_text_node") return [textRow("文本内容", field(input, "text"))].filter(Boolean);
    if (tool === "canvas_apply_ops") return [textRow("操作内容", summarizeCanvasOps(arrayValue(field(input, "ops"))))].filter(Boolean);
    if (tool === "canvas_create_attachment_nodes") return [textRow("图片数量", arrayValue(field(input, "attachmentIds")).length)].filter(Boolean);
    return [];
}

function summarizeCanvasOps(ops: unknown[]) {
    const counts = ops.reduce<Record<string, number>>((result, op) => {
        const type = String(field(op, "type") || "");
        if (type) result[type] = (result[type] || 0) + 1;
        return result;
    }, {});
    return Object.entries(counts).map(([type, count]) => `${canvasOpLabel(type)} ${count}`).join("，");
}

function canvasOpLabel(type: string) {
    if (type === "add_node") return "新增节点";
    if (type === "update_node") return "更新节点";
    if (type === "delete_node") return "删除节点";
    if (type === "delete_connections") return "删除连线";
    if (type === "connect_nodes") return "连接";
    if (type === "set_viewport") return "调整视图";
    if (type === "select_nodes") return "选择节点";
    if (type === "run_generation") return "触发生成";
    return type;
}

/** 生成人类可读的文件变更摘要。 */
function fileChangeSummary(changes: unknown[]) {
    if (!changes.length) return "已完成文件修改";
    const names = changes.slice(0, 3).map((change) => String(field(change, "path") || "未知文件"));
    if (changes.length === 1) return `已${changeKind(field(changes[0], "kind"))} ${names[0]}`;
    return `已修改 ${changes.length} 个文件：${names.join("、")}${changes.length > names.length ? " 等" : ""}`;
}

/** 生成网页搜索摘要。 */
function webSearchSummary(item: unknown) {
    const action = field(item, "action");
    const type = String(field(action, "type") || "");
    if (type === "openPage") return `打开网页：${String(field(action, "url") || "")}`;
    if (type === "findInPage") return `在网页中查找“${String(field(action, "pattern") || "内容")}”`;
    return `搜索：${String(field(item, "query") || field(action, "query") || "相关资料")}`;
}

/** 生成网页搜索详情行。 */
function webSearchRows(item: unknown) {
    const action = field(item, "action");
    return [textRow("关键词", field(item, "query") || field(action, "query")), textRow("网页", field(action, "url"))].filter(Boolean);
}

/** 从 reasoning 结构中提取可读文本。 */
function readableText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(readableText).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    return readableText(field(value, "text"));
}

/** 将历史工具参数解析为对象。 */
function toolArguments(value: unknown) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return {};
    }
}

/** 创建非空详情行。 */
function textRow(label: string, value: unknown) {
    return value === undefined || value === null || value === "" ? null : { label, value: String(value) };
}

/** 创建命令耗时详情行。 */
function durationRow(value: unknown) {
    const duration = Number(value || 0);
    return duration > 0 ? { label: "耗时", value: `${(duration / 1000).toFixed(1)} 秒` } : null;
}

/** 将未知数值转换为有限数字。 */
function numberValue(value: unknown) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
}

/** 将文件变更类型转换为中文。 */
function changeKind(value: unknown) {
    if (value === "add") return "新增";
    if (value === "delete") return "删除";
    return "修改";
}

/** 将站点路由转换为中文页面名称。 */
function routeName(path: string) {
    if (path === "/") return "首页";
    if (path === "/canvas") return "画布页面";
    if (path.startsWith("/canvas/")) return "指定画布";
    if (path.startsWith("/image")) return "生图工作台";
    if (path.startsWith("/video")) return "视频工作台";
    if (path.startsWith("/prompts")) return "提示词中心";
    if (path.startsWith("/assets")) return "我的素材";
    if (path.startsWith("/config")) return "配置页面";
    return path;
}

/** 将 MCP 工具名称转换为聊天记录中的中文标题。 */
function toolName(name: string) {
    if (name === "imagegen" || name.endsWith("__imagegen")) return "生成图片";
    if (name === "view_image" || name.endsWith("__view_image")) return "查看图片";
    if (name === "exec" || name === "exec_command" || name.endsWith("__exec_command")) return "执行命令";
    if (name === "apply_patch" || name.endsWith("__apply_patch")) return "修改文件";
    if (name === "web__run" || name.endsWith("__web__run")) return "搜索资料";
    if (name === "site_navigate") return "打开页面";
    if (name === "canvas_list_projects") return "画布列表";
    if (name === "canvas_apply_ops") return "画布操作";
    if (name === "canvas_get_state") return "读取画布";
    if (name === "canvas_get_selection") return "读取选区";
    if (name === "canvas_export_snapshot") return "导出快照";
    if (name === "canvas_create_node") return "创建节点";
    if (name === "canvas_create_attachment_nodes") return "添加附件图片";
    if (name === "canvas_create_text_node") return "创建文本";
    if (name === "canvas_create_text_nodes") return "批量创建文本";
    if (name === "canvas_create_config_node") return "创建生成配置";
    if (name === "canvas_create_image_prompt_flow") return "创建生图流程";
    if (name === "canvas_create_generation_flow") return "创建生成流程";
    if (name === "canvas_generate_text") return "生成文本";
    if (name === "canvas_generate_image") return "生成图片";
    if (name === "canvas_generate_video") return "生成视频";
    if (name === "canvas_generate_audio") return "生成音频";
    if (name === "canvas_update_node") return "更新节点";
    if (name === "canvas_update_node_text") return "更新文本";
    if (name === "canvas_move_nodes") return "移动节点";
    if (name === "canvas_resize_node") return "调整节点尺寸";
    if (name === "canvas_delete_nodes") return "删除节点";
    if (name === "canvas_connect_nodes") return "连接节点";
    if (name === "canvas_select_nodes") return "选择节点";
    if (name === "canvas_set_viewport") return "调整视口";
    if (name === "canvas_run_generation") return "触发生成";
    if (name === "workbench_image_get_config") return "生图配置";
    if (name === "workbench_image_generate") return "生图工作台生成";
    if (name === "workbench_video_get_config") return "视频配置";
    if (name === "workbench_video_generate") return "视频创作台生成";
    if (name === "prompts_search") return "搜索提示词";
    if (name === "assets_list") return "资产列表";
    if (name === "assets_add") return "添加资产";
    if (name === "generation_get_status") return "生成任务状态";
    return name ? `调用工具：${name}` : "工具操作";
}
