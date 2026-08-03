import { isSiteTool, SITE_TOOL_LABELS } from "@/lib/agent/agent-site-tools";
import { summarizeCanvasAgentOps, type CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { randomId } from "@/lib/utils";
import { useAgentStore, type AgentAttachment, type AgentChatItem, type AgentEventLog, type AgentTokenUsage } from "@/stores/use-agent-store";
import type { AgentChatAttachment } from "./agent-chat-message";
export const REASONING_PLACEHOLDER = "正在分析任务…";

export type AgentEventPayload = {
    agent?: string;
    type?: string;
    threadId?: string;
    thread_id?: string;
    turnId?: string;
    turn_id?: string;
    sourceClientId?: string;
    replayed?: boolean;
    item?: AgentEventItem;
    error?: { message?: string };
    message?: string;
    status?: string;
    explanation?: unknown;
    plan?: unknown;
    usage?: Record<string, unknown>;
    duration_ms?: number;
};
export type AgentEventItem = {
    id?: string;
    type?: string;
    text?: unknown;
    delta?: unknown;
    message?: unknown;
    server?: string;
    tool?: string;
    status?: string;
    arguments?: unknown;
    result?: unknown;
    error?: { message?: string };
    command?: unknown;
    cwd?: unknown;
    aggregatedOutput?: unknown;
    exitCode?: unknown;
    durationMs?: unknown;
    contentItems?: unknown;
    success?: unknown;
    changes?: unknown;
    summary?: unknown;
    query?: unknown;
    action?: unknown;
    path?: unknown;
    savedPath?: unknown;
    revisedPrompt?: unknown;
};
export type AgentUserDetail = { kind: string; status: string; rows?: Array<{ label: string; value: string }>; output?: string; files?: Array<{ path: string; action?: string }>; tasks?: Array<{ step: string; status: string }>; explanation?: string };

export type AgentLogContext = { endpoint: string; connected: boolean; enabled: boolean; activity: string; waiting: boolean; sending: boolean; messages: number; pendingTool?: string };

export function agentMessageToChatMessage(item: AgentChatItem) {
    return { ...item, meta: item.role === "user" || item.role === "assistant" ? undefined : item.meta, attachments: item.attachments?.map(agentAttachmentToChatAttachment) };
}

export function agentAttachmentToChatAttachment(item: AgentAttachment): AgentChatAttachment {
    return { id: item.id, name: item.name, url: item.dataUrl || item.url };
}

export function formatAgentEvent(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "agent_message") return { role: "assistant", title: "Codex", text: stringText(item.text) };
    return null;
}

export function formatAgentActivity(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (!item || (event.type !== "item.started" && event.type !== "item.completed")) return null;
    const completed = event.type === "item.completed";
    const status = String(item.status || (completed ? "completed" : "inProgress"));
    const failed = Boolean(item.error?.message) || item.success === false || ["failed", "error"].includes(status);
    const itemStatus = failed ? "failed" : status;
    if (item.type === "reasoning") {
        const text = readableText(item.summary);
        if (completed && !text) return null;
        return { role: "tool", title: "思考摘要", text: text || activityPlaceholder(item.type), detail: { kind: "reasoning", status: itemStatus } };
    }
    if (item.type === "plan") {
        const text = stringText(item.text);
        if (completed && !text && !item.error?.message) return null;
        return { role: "tool", title: "执行计划", text: item.error?.message || text || activityPlaceholder(item.type), detail: { kind: "plan", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "command_execution") {
        const command = stringText(item.command);
        const text = command || (completed ? failed ? "命令执行失败" : "命令已完成" : activityPlaceholder(item.type));
        return { role: "tool", title: "执行命令", text, detail: commandActivityDetail(item, itemStatus) };
    }
    if (item.type === "file_change") {
        const files = activityFiles(item.changes);
        return { role: "tool", title: "修改文件", text: item.error?.message || fileActivitySummary(files, completed), detail: { kind: "file", status: itemStatus, files, ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "web_search") {
        return { role: "tool", title: "搜索资料", text: item.error?.message || webSearchSummary(item), detail: { kind: "search", status: itemStatus, rows: webSearchDetailRows(item), ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "image_view") return { role: "tool", title: "查看图片", text: item.error?.message || stringText(item.path) || (completed ? "已查看图片" : "正在查看图片"), detail: { kind: "image", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    if (item.type === "image_generation") {
        return { role: "tool", title: "内置生图", text: item.error?.message || (completed ? failed ? "图片生成失败" : "图片生成完成" : "正在生成图片…"), detail: { kind: "image", status: itemStatus, savedPath: item.savedPath, ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "context_compaction") return { role: "tool", title: "整理上下文", text: item.error?.message || (completed ? "已整理当前对话，继续处理任务" : "正在整理当前对话…"), detail: { kind: "context", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    if (isMcpToolItem(item)) {
        const name = String(item.tool || "");
        return { role: "tool", title: toolName(name), text: completed ? item.error?.message || toolSummary(item) : `正在${toolAction(name)}…`, detail: toolDetail(item, itemStatus) };
    }
    if (item.type === "dynamic_tool_call") {
        const name = String(item.tool || "");
        const title = toolName(name);
        return {
            role: "tool",
            title,
            text: completed ? item.error?.message || readableText(item.contentItems) : `正在${toolAction(name)}…`,
            detail: toolDetail(item, itemStatus),
        };
    }
    if (item.type === "collab_tool_call") return { role: "tool", title: "协作处理", text: item.error?.message || (completed ? failed ? "协作任务失败" : "已完成协作任务" : "正在协作处理任务…"), detail: { kind: "tool", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    return null;
}

export function formatAgentPlan(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const tasks = planTasks(event.plan);
    if (!tasks.length) return null;
    const completed = tasks.filter((item) => item.status === "completed").length;
    return {
        role: "tool",
        title: "任务进度",
        text: `已完成 ${completed}/${tasks.length} 项`,
        detail: { kind: "todo", status: completed === tasks.length ? "completed" : "inProgress", tasks, explanation: stringText(event.explanation) },
    };
}

function planTasks(value: unknown) {
    return (Array.isArray(value) ? value : []).flatMap((item) => {
        const step = stringText(objectField(item, "step")).trim();
        return step ? [{ step, status: stringText(objectField(item, "status")) || "pending" }] : [];
    });
}

export function turnPlanStatus(detail: unknown, turnStatus?: string) {
    const tasks = planTasks(objectField(detail, "tasks"));
    if (turnStatus === "failed") return "failed";
    if (turnStatus === "interrupted") return "interrupted";
    if (tasks.length && tasks.every((item) => item.status === "completed")) return "completed";
    return turnStatus === "completed" ? "finished" : "inProgress";
}

export function activityDeltaFallback(item: AgentEventItem, delta: string): AgentChatItem {
    if (item.type === "command_execution") return { id: item.id || randomId(), role: "tool", title: "执行命令", text: activityPlaceholder(item.type), detail: { kind: "command", status: "inProgress", output: delta } };
    return { id: item.id || randomId(), role: "tool", title: item.type === "plan" ? "执行计划" : "思考摘要", text: delta, detail: { kind: activityKind(item.type), status: "inProgress" } };
}

export function activityPlaceholder(type?: string) {
    if (type === "plan") return "正在整理执行步骤…";
    if (type === "command_execution") return "正在执行命令…";
    return REASONING_PLACEHOLDER;
}

export function activityKind(type?: string) {
    if (type === "command_execution") return "command";
    if (type === "plan") return "plan";
    return "reasoning";
}

export function activityDetail(value: unknown, kind: string, status: string): AgentUserDetail {
    const current = value && typeof value === "object" ? (value as Partial<AgentUserDetail>) : {};
    return { kind, status, rows: current.rows, output: current.output, files: current.files, tasks: current.tasks, explanation: current.explanation };
}

function commandActivityDetail(item: AgentEventItem, status: string): AgentUserDetail {
    const rows = [detailRow("工作目录", item.cwd), detailRow("退出状态", item.exitCode), durationDetailRow(item.durationMs)].flatMap((row) => (row ? [row] : []));
    const commandStatus = typeof item.exitCode === "number" && item.exitCode !== 0 ? "failed" : status;
    return { kind: "command", status: commandStatus, rows, output: item.error?.message || stringText(item.aggregatedOutput) };
}

function activityFiles(value: unknown) {
    return (Array.isArray(value) ? value : []).flatMap((change) => {
        const path = stringText(objectField(change, "path"));
        return path ? [{ path, action: changeAction(objectField(change, "kind")) }] : [];
    });
}

function fileActivitySummary(files: Array<{ path: string; action?: string }>, completed: boolean) {
    if (!files.length) return completed ? "已完成文件修改" : "正在准备文件修改…";
    if (files.length === 1) return `${completed ? "已" : "正在"}${files[0].action || "修改"} ${files[0].path}`;
    const names = files.slice(0, 3).map((file) => file.path).join("、");
    return `${completed ? "已修改" : "正在修改"} ${files.length} 个文件：${names}${files.length > 3 ? " 等" : ""}`;
}

function webSearchSummary(item: AgentEventItem) {
    const action = item.action;
    const type = stringText(objectField(action, "type"));
    if (type === "openPage") return `打开网页：${stringText(objectField(action, "url"))}`;
    if (type === "findInPage") return `在网页中查找“${stringText(objectField(action, "pattern")) || "内容"}”`;
    return `搜索：${stringText(item.query) || stringText(objectField(action, "query")) || "相关资料"}`;
}

function webSearchDetailRows(item: AgentEventItem) {
    const action = item.action;
    return [detailRow("关键词", item.query || objectField(action, "query")), detailRow("网页", objectField(action, "url"))].flatMap((row) => (row ? [row] : []));
}

function readableText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(readableText).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    return readableText(objectField(value, "text"));
}

function detailRow(label: string, value: unknown) {
    return value === undefined || value === null || value === "" ? null : { label, value: String(value) };
}

function durationDetailRow(value: unknown) {
    const duration = Number(value || 0);
    return duration > 0 ? { label: "耗时", value: `${(duration / 1000).toFixed(1)} 秒` } : null;
}

function changeAction(value: unknown) {
    if (value === "add") return "新增";
    if (value === "delete") return "删除";
    return "修改";
}

export function parseEventData<T>(event: Event) {
    try {
        return JSON.parse((event as MessageEvent).data) as T;
    } catch {
        return null;
    }
}

export function isCurrentThreadEvent(event: { threadId?: string; thread_id?: string }) {
    const threadId = event.threadId || event.thread_id || "";
    return Boolean(threadId) && threadId === useAgentStore.getState().activeThreadId;
}

export function registerLiveAgentTurn(
    event: { replayed?: boolean; threadId?: string; thread_id?: string; turnId?: string; turn_id?: string },
    authoritativeTurns: ReadonlySet<string>,
    liveTurns: Set<string>,
) {
    const threadId = event.threadId || event.thread_id || "";
    const turnId = event.turnId || event.turn_id || "";
    const key = threadId && turnId ? `${threadId}\0${turnId}` : "";
    if (event.replayed && key && authoritativeTurns.has(key)) return false;
    if (key) liveTurns.add(key);
    return true;
}

export function formatLogText(logs: AgentEventLog[], context: AgentLogContext) {
    const head = [
        "Infinite Canvas Agent 诊断",
        `地址：${context.endpoint}`,
        `连接：${context.connected ? "在线" : context.enabled ? "连接中" : "未启用"} · 状态：${context.activity}`,
        `消息：${context.messages} · 工具：${context.pendingTool ? toolName(context.pendingTool) : "无"}`,
    ].join("\n");
    const body = logs.map((item) => `${item.time} ${item.title}${item.text && item.text !== item.title ? ` · ${item.text}` : ""}`).join("\n");
    return [head, body || "暂无事件日志"].join("\n\n");
}

export function formatLogJson(logs: AgentEventLog[], context: AgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, text, raw }) => ({ time, title, text, raw })) }, null, 2);
}

export function formatAgentEventLog(event: AgentEventPayload) {
    const item = event.item;
    if (event.type === "thread.started") return { title: "创建会话", text: shortId(event.thread_id) };
    if (event.type === "turn.started") return { title: "开始处理", text: shortId(event.turn_id) };
    if (event.type === "plan.updated") {
        const tasks = planTasks(event.plan);
        return { title: "更新任务进度", text: `已完成 ${tasks.filter((item) => item.status === "completed").length}/${tasks.length} 项` };
    }
    if (event.type === "turn.completed" && event.status === "failed") return { title: "处理失败", text: agentErrorView(event.error?.message).text };
    if (event.type === "turn.completed") return { title: event.status === "interrupted" ? "处理已停止" : "处理完成", text: turnSummary(event) };
    if (event.type === "turn.failed" || event.type === "error") return { title: "处理失败", text: agentErrorView(event.message || event.error?.message).text };
    if (event.type === "item.started" && isMcpToolItem(item)) return { title: "调用工具", text: toolName(String(item?.tool || "")) };
    if (event.type === "item.completed" && isMcpToolItem(item)) return { title: item.error ? "工具失败" : "工具完成", text: `${toolName(String(item?.tool || ""))}${item.error?.message ? ` · ${item.error.message}` : ""}` };
    if (event.type === "item.completed" && item?.type === "agent_message") return { title: "收到回复", text: compactText(stringText(item.text)) };
    return null;
}

function turnSummary(event: AgentEventPayload) {
    return event.duration_ms ? `${(event.duration_ms / 1000).toFixed(1)} 秒` : "完成";
}

export function agentErrorView(value: unknown) {
    const text = normalizeText(value);
    if (/selected model is at capacity/i.test(text)) return { title: "模型暂时繁忙", text: "当前选择的模型请求量过大，暂时无法处理。请稍后重试，或切换其他模型后再试。" };
    return { title: "任务失败", text: text || "Codex 未能完成本次任务，请稍后重试。" };
}

export function eventUsage(event: AgentEventPayload): AgentTokenUsage {
    return {
        input: numberField(event.usage, "input_tokens"),
        cached: numberField(event.usage, "cached_input_tokens"),
        output: numberField(event.usage, "output_tokens"),
    };
}

function shortId(value?: string) {
    return value ? value.slice(0, 8) : "";
}

export function compactText(value: string, maxLength = 120) {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function isConnectionErrorMessage(item: AgentChatItem) {
    return item.role === "error" && /连接失败|无法连接本地 Agent|本地 Agent 连接失败/.test(item.text);
}

export function toolName(name: string) {
    if (name === "imagegen" || name.endsWith("__imagegen")) return "生成图片";
    if (name === "view_image" || name.endsWith("__view_image")) return "查看图片";
    if (name === "exec" || name === "exec_command" || name.endsWith("__exec_command")) return "执行命令";
    if (name === "apply_patch" || name.endsWith("__apply_patch")) return "修改文件";
    if (name === "web__run" || name.endsWith("__web__run")) return "搜索资料";
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
    if (name === "site_navigate") return "打开页面";
    if (isSiteTool(name)) return SITE_TOOL_LABELS[name];
    return name ? `调用工具：${name}` : "工具操作";
}

function siteToolSummary(name: string, result: unknown, input: unknown) {
    const data = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    if (name === "site_navigate") return `已打开${routeName(stringText(objectField(input, "path")) || "/")}`;
    if (name === "canvas_list_projects") return `共 ${numberField(data, "total")} 个画布`;
    if (name === "prompts_search") return `找到 ${numberField(data, "total")} 条提示词`;
    if (name === "assets_list") return `共 ${numberField(data, "total")} 个资产`;
    if (name === "assets_add") return "已加入我的素材";
    if (name === "generation_get_status") {
        const summary = data.summary && typeof data.summary === "object" ? (data.summary as Record<string, unknown>) : {};
        return `共 ${numberField(data, "total")} 个任务，排队 ${numberField(summary, "queued")}，运行中 ${numberField(summary, "running")}，成功 ${numberField(summary, "succeeded")}，失败 ${numberField(summary, "failed")}`;
    }
    if (name === "workbench_image_generate" || name === "workbench_video_generate") return typeof data.note === "string" ? data.note : "已在工作台执行";
    if (name === "workbench_image_get_config" || name === "workbench_video_get_config") return "已读取工作台配置";
    return "";
}

function isMcpToolItem(item?: AgentEventItem): item is AgentEventItem & { type: "mcp_tool_call" } {
    return item?.type === "mcp_tool_call";
}

export function toolDetail(item: AgentEventItem | undefined, status: string): AgentUserDetail {
    const name = String(item?.tool || "");
    return { kind: "tool", status, rows: toolInputRows(name, item?.arguments), ...(item?.error?.message ? { output: item.error.message } : {}) };
}

export function toolCallDetail(name: string, input: unknown, status: string, error = ""): AgentUserDetail {
    return { kind: "tool", status, rows: toolInputRows(name, input), ...(error ? { output: error } : {}) };
}

function toolInputRows(name: string, input: unknown) {
    input = parseToolArguments(input);
    if (name === "site_navigate") return [detailRow("目标页面", routeName(stringText(objectField(input, "path")) || "/"))].flatMap((row) => (row ? [row] : []));
    if (name === "prompts_search") return [detailRow("搜索内容", objectField(input, "query"))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_create_text_node") return [detailRow("文本内容", objectField(input, "text"))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_apply_ops") return [detailRow("操作内容", summarizeCanvasAgentOps((objectField(input, "ops") as CanvasAgentOp[] | undefined) || []))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_create_attachment_nodes") return [detailRow("图片数量", Array.isArray(objectField(input, "attachmentIds")) ? (objectField(input, "attachmentIds") as unknown[]).length : 0)].flatMap((row) => (row ? [row] : []));
    return [];
}

export function toolSummary(item?: AgentEventItem) {
    const result = parseToolResult(item?.result);
    const name = String(item?.tool || "");
    if (name === "site_navigate" || isSiteTool(name)) return siteToolSummary(name, result, parseToolArguments(item?.arguments));
    const nodeField = objectField(result, "nodes");
    const connectionField = objectField(result, "connections");
    const nodes = Array.isArray(nodeField) ? nodeField : [];
    const connections = Array.isArray(connectionField) ? connectionField : [];
    if (name === "canvas_get_state") return Array.isArray(nodeField) || Array.isArray(connectionField) ? canvasContentSummary(nodes, connections.length) : "已读取当前画布内容";
    if (name === "canvas_get_selection") return "已读取当前选中内容";
    return "";
}

function canvasContentSummary(nodes: unknown[], connections: number) {
    const counts = nodes.reduce<Record<string, number>>((result, node) => {
        const type = stringText(objectField(node, "type")) || "other";
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

export function toolAction(name: string) {
    const label = toolName(name);
    if (label.startsWith("读取") || label.startsWith("查看") || label.startsWith("搜索") || label.startsWith("打开")) return label;
    return `执行${label}`;
}

export function routeName(path: string) {
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

export function workingActivity(item?: AgentChatItem) {
    const status = String(objectField(item?.detail, "status") || "");
    const output = stringText(objectField(item?.detail, "output"));
    const key = `${item?.id || "waiting"}-${status}-${item?.text || ""}-${output.length}`;
    if (item?.role !== "tool") return { key, text: "正在思考..." };
    if (["inProgress", "in_progress", "running", "pending"].includes(status)) return { key, text: `${item.title || "工具操作"}正在进行...` };
    if (item.title === "读取画布") return { key, text: "画布已读取，Codex 正在整理结果..." };
    return { key, text: `${item.title || "工具操作"}已完成，Codex 正在继续处理...` };
}

export function currentPlanMessage(messages: AgentChatItem[]) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (isPlanMessage(message)) return message;
        if (message.role === "user") return;
    }
}

export function latestPlanMessage(messages: AgentChatItem[]) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (isPlanMessage(messages[index])) return messages[index];
    }
}

export function isPlanMessage(message: AgentChatItem) {
    return message.role === "tool" && objectField(message.detail, "kind") === "todo";
}

function parseToolResult(result: unknown) {
    const content = objectField(result, "content");
    const text = Array.isArray(content)
        ? content
              .map((item) => objectField(item, "text"))
              .filter((item): item is string => typeof item === "string")
              .join("\n")
        : "";
    try {
        return text ? JSON.parse(text) : result;
    } catch {
        return text || result;
    }
}

export function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

export function stringText(value: unknown) {
    return typeof value === "string" ? value : "";
}

export function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function numberField(value: unknown, key: string) {
    const field = objectField(value, key);
    return typeof field === "number" ? field : 0;
}

export function promptWithAttachments(text: string, attachments: AgentAttachment[]) {
    return text || (attachments.length ? "请处理上传的图片附件。" : "");
}

export function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => total + item.dataUrl.length, 0);
}

export function formatBytes(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

export function isCanvasWriteTool(name: string) {
    return name === "canvas_apply_ops" || name === "canvas_create_attachment_nodes";
}

function parseToolArguments(value: unknown) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return {};
    }
}

export function agentMessageId(threadId: string, turnId: string, itemId: string) {
    return `${threadId}:${turnId}:${itemId}`;
}

export function scopeChatItem(item: AgentChatItem, threadId: string, turnId: string) {
    const scopeTurnId = turnId || "pending";
    const prefix = `${threadId || "local"}:${scopeTurnId}:`;
    const sourceItemId = item.itemId || (item.id.startsWith(prefix) ? item.id.slice(prefix.length) : item.id);
    const itemId = item.role === "user" ? "synthetic:user" : sourceItemId;
    return { ...item, id: agentMessageId(threadId || "local", scopeTurnId, itemId), itemId, threadId, turnId };
}

export function bindPendingTurnMessages(messages: AgentChatItem[], threadId: string, turnId: string) {
    const index = messages.findLastIndex((item) => item.role === "user" && item.threadId === threadId && !item.turnId);
    if (index < 0) return messages;
    return messages.map((item, itemIndex) => itemIndex === index ? scopeChatItem(item, threadId, turnId) : item);
}

export function upsertAgentMessage(messages: AgentChatItem[], item: AgentChatItem) {
    const index = messages.findIndex((current) => current.id === item.id);
    if (index < 0) return [...messages, item];
    const current = messages[index];
    const next = { ...current, ...item, attachments: item.attachments || current.attachments, historyText: item.historyText || current.historyText };
    return messages.map((message, itemIndex) => itemIndex === index ? next : message);
}

export function mergeAgentMessages(snapshot: AgentChatItem[], current: AgentChatItem[], threadId: string, liveTurnKeys: ReadonlySet<string>) {
    let messages = [...snapshot];
    current.filter((item) => item.threadId === threadId).forEach((item) => {
        const live = Boolean(item.turnId && liveTurnKeys.has(`${threadId}\0${item.turnId}`));
        const index = messages.findIndex((message) => message.id === item.id);
        if (index < 0) {
            if (!item.turnId || live) messages = upsertAgentMessage(messages, item);
            return;
        }
        const history = messages[index];
        const next = live
            ? { ...history, ...item, attachments: item.attachments || history.attachments, historyText: item.historyText || history.historyText }
            : { ...history, attachments: item.attachments || history.attachments, historyText: item.historyText || history.historyText };
        messages = messages.map((message, itemIndex) => itemIndex === index ? next : message);
    });
    return messages;
}

export function normalizeHistoryMessages(messages: AgentChatItem[]) {
    return messages
        .filter((item) => (normalizeText(item.text) || item.role === "tool") && item.itemId && item.threadId && item.turnId)
        .map(({ streamId: _streamId, ...item }) => scopeChatItem({ ...item, text: normalizeText(item.text) } as AgentChatItem, item.threadId!, item.turnId!));
}

export function mergeHistoryAttachments(messages: AgentChatItem[], currentMessages: AgentChatItem[]) {
    const currentUsers = currentMessages.filter((item) => item.role === "user" && item.attachments?.length).reverse();
    return [...messages]
        .reverse()
        .map((item) => {
            if (item.role !== "user") return item;
            let index = item.clientMessageId
                ? currentUsers.findIndex((current) => current.clientMessageId === item.clientMessageId && current.threadId === item.threadId)
                : -1;
            if (index < 0 && item.turnId) index = currentUsers.findIndex((current) => current.turnId === item.turnId && current.threadId === item.threadId);
            if (index < 0) {
                const candidates = currentUsers
                    .map((current, candidateIndex) => ({ current, candidateIndex }))
                    .filter(({ current }) => current.threadId === item.threadId && (current.text === item.text || current.historyText === item.text));
                if (new Set(candidates.map(({ current }) => current.clientMessageId || current.id)).size === 1) index = candidates[0]?.candidateIndex ?? -1;
            }
            if (index < 0) return item;
            const current = currentUsers.splice(index, 1)[0];
            return { ...item, text: current.text, historyText: current.historyText, attachments: current.attachments };
        })
        .reverse();
}

export function reasoningActivityText(items: Record<string, string>, fallback = "") {
    const summaries = Object.values(items).map((item) => item.trim()).filter(isReasoningSummary);
    return summaries.join("\n\n") || fallback || REASONING_PLACEHOLDER;
}

export function isReasoningSummary(value = "") {
    const text = value.trim();
    return Boolean(text && text !== REASONING_PLACEHOLDER && text !== "已完成分析");
}

export function mergeStreamText(prefix: string, incoming: string) {
    if (!prefix || incoming.startsWith(prefix)) return incoming || prefix;
    if (!incoming || prefix.startsWith(incoming)) return prefix;
    return incoming.length >= prefix.length ? incoming : prefix;
}
