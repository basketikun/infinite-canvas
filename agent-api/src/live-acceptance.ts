import assert from "node:assert/strict";

import { createClient } from "@supabase/supabase-js";

import type { RuntimeEvent } from "./types.js";

const supabaseUrl = required("SUPABASE_URL");
const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
const apiUrl = required("AGENT_API_URL").replace(/\/$/, "");
const auth = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await auth.auth.signInWithPassword({ email: "test@research-canvas.test", password: "12345678" });
assert.ifError(error);
assert.ok(data.session?.access_token, "内置 test 账号尚未由 Agent API 创建");
const token = data.session.access_token;

let projectId: string | undefined;
try {
    const project = await request<{ id: string; canvasWorkspaceId: string }>("/v1/projects", { method: "POST", body: { name: "Pi live acceptance" } });
    projectId = project.id;
    const clientId = "live-acceptance-browser";
    const initialSnapshot = { nodes: [{ id: "seed", type: "text", text: "Pi acceptance seed" }], edges: [] };
    await request(`/v1/projects/${project.id}/canvas/state`, { method: "PUT", body: { clientId, revision: 1, snapshot: initialSnapshot } });
    await request(`/v1/projects/${project.id}/skills/live-acceptance`, {
        method: "PUT",
        body: { enabled: true, definition: "执行验收指令时必须调用用户明确指定的 Canvas 工具，不得只用文字描述工具结果。" },
    });
    const conversation = await request<{ id: string }>(`/v1/projects/${project.id}/conversations`, { method: "POST", body: { title: "Pi live acceptance" } });

    const readRun = await request<{ runId: string }>(`/v1/projects/${project.id}/conversations/${conversation.id}/turns`, {
        method: "POST",
        body: { prompt: "这是自动验收：必须调用 canvas_read_snapshot 读取当前画布，然后用一句话说明读取到的节点。" },
    });
    const readEvents = await streamUntilTerminal(project.id, conversation.id, readRun.runId, 0);
    assertTerminal(readEvents, readRun.runId, "run.completed");
    assert.ok(readEvents.some((event) => event.type === "tool.started" && event.payload.toolName === "canvas_read_snapshot"), "Pi 没有调用只读 Canvas 工具");

    const readCursor = readEvents.at(-1)!.sequence;
    const writeRun = await request<{ runId: string }>(`/v1/projects/${project.id}/conversations/${conversation.id}/turns`, {
        method: "POST",
        body: { prompt: "这是自动验收：必须调用 canvas_apply_operations，请求新增一个 id 为 accepted 的文本节点，summary 使用中文。" },
    });
    const updatedSnapshot = { nodes: [...initialSnapshot.nodes, { id: "accepted", type: "text", text: "accepted" }], edges: [] };
    const writeEvents = await streamUntilTerminal(project.id, conversation.id, writeRun.runId, readCursor, async (event) => {
        if (event.type !== "canvas.tool.requested") return;
        const callId = String(event.payload.callId || "");
        assert.ok(callId);
        await request(`/v1/projects/${project.id}/canvas/tool-results/${callId}`, {
            method: "POST",
            body: { clientId, revision: 2, snapshot: updatedSnapshot, result: { approved: true, applied: true } },
        });
    });
    assertTerminal(writeEvents, writeRun.runId, "run.completed");
    assert.ok(writeEvents.some((event) => event.type === "canvas.tool.requested"), "Pi 没有进入写工具浏览器确认闭环");
    assert.ok(writeEvents.some((event) => event.type === "tool.completed" && event.payload.toolName === "canvas_apply_operations"), "写工具没有完成");

    const snapshot = await request<{ conversation: { sessionRevision: number }; events: RuntimeEvent[] }>(`/v1/projects/${project.id}/conversations/${conversation.id}`);
    assert.ok(snapshot.conversation.sessionRevision >= 2, "Pi session 没有跨 turn 持久化");
    assertStrictSequence(snapshot.events);
    assertCredentialAbsent(snapshot);

    const abortConversation = await request<{ id: string }>(`/v1/projects/${project.id}/conversations`, { method: "POST", body: { title: "Abort acceptance" } });
    const abortRun = await request<{ runId: string }>(`/v1/projects/${project.id}/conversations/${abortConversation.id}/turns`, {
        method: "POST",
        body: { prompt: "持续详细分析当前画布中的研究主题，直到任务被外部停止。" },
    });
    await request(`/v1/projects/${project.id}/conversations/${abortConversation.id}/runs/${abortRun.runId}/abort`, { method: "POST" });
    const abortEvents = await streamUntilTerminal(project.id, abortConversation.id, abortRun.runId, 0);
    assertTerminal(abortEvents, abortRun.runId, "run.aborted");
    assert.ok(!abortEvents.some((event) => event.runId === abortRun.runId && (event.type === "run.completed" || event.type === "run.failed")));

    console.log("Pi live acceptance passed");
} finally {
    if (projectId) await request(`/v1/projects/${projectId}`, { method: "DELETE" });
}

async function streamUntilTerminal(projectId: string, conversationId: string, runId: string, after: number, onEvent?: (event: RuntimeEvent) => Promise<void>) {
    const response = await fetch(`${apiUrl}/v1/projects/${projectId}/conversations/${conversationId}/events?after=${after}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Agent-Protocol-Version"), "1");
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events: RuntimeEvent[] = [];
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
            const serialized = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
            if (!serialized) continue;
            const event = JSON.parse(serialized) as RuntimeEvent;
            events.push(event);
            await onEvent?.(event);
            if (event.runId === runId && terminal(event.type)) {
                await reader.cancel();
                return events;
            }
        }
        if (done) throw new Error(`事件流在 run ${runId} 终态前关闭`);
    }
}

async function request<T = unknown>(path: string, input: { method?: string; body?: unknown } = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
        method: input.method,
        headers: { Authorization: `Bearer ${token}`, ...(input.body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    if (!response.ok) throw new Error(`${input.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
}

function assertTerminal(events: RuntimeEvent[], runId: string, expected: RuntimeEvent["type"]) {
    const terminalEvents = events.filter((event) => event.runId === runId && terminal(event.type));
    assert.deepEqual(terminalEvents.map((event) => event.type), [expected]);
}

function assertStrictSequence(events: RuntimeEvent[]) {
    const sequences = events.map((event) => event.sequence);
    assert.equal(new Set(sequences).size, sequences.length, "持久化事件包含重复 sequence");
    assert.deepEqual(sequences, [...sequences].sort((left, right) => left - right), "持久化事件顺序错误");
}

function assertCredentialAbsent(value: unknown) {
    const apiKey = process.env.PI_API_KEY;
    if (apiKey) assert.ok(!JSON.stringify(value).includes(apiKey), "Pi credential 出现在持久化产品数据中");
}

function terminal(type: RuntimeEvent["type"]) {
    return type === "run.completed" || type === "run.failed" || type === "run.aborted";
}

function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`缺少环境变量 ${name}`);
    return value;
}
