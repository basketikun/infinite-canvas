import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";

type StreamOptions = { signal?: AbortSignal; onDelta?: (text: string) => void };
type ChatStreamState = { buffer: string; text: string };

function chatDelta(event: Record<string, unknown>): string {
    const choices = event.choices;
    if (!Array.isArray(choices)) return "";
    const choice = choices[0] as Record<string, unknown> | undefined;
    const delta = choice && typeof choice === "object" ? (choice.delta as Record<string, unknown>) : undefined;
    return typeof delta?.content === "string" ? delta.content : "";
}

function chatError(event: Record<string, unknown>): string {
    const error = event.error as Record<string, unknown> | undefined;
    if (!error || typeof error.message !== "string") return "";
    const status = error.status_code;
    return status ? `${error.message}（HTTP ${status}）` : error.message;
}

function chatMessageText(payload: unknown): string {
    const record = payload as { choices?: Array<{ message?: { content?: unknown } }> } | null;
    const content = record?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
}

async function readError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return fallback;
    try {
        const payload = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
        const error = typeof payload.error?.message === "string" ? payload.error.message : "";
        return error || (typeof payload.message === "string" ? payload.message : fallback);
    } catch {
        return text.slice(0, 300) || fallback;
    }
}

function handleChatLine(line: string, state: ChatStreamState, onDelta?: (text: string) => void) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
        event = JSON.parse(data) as Record<string, unknown>;
    } catch {
        return;
    }
    const error = chatError(event);
    if (error) throw new Error(error);
    const delta = chatDelta(event);
    if (delta) {
        state.text += delta;
        onDelta?.(state.text);
    }
}

function consumeChatStream(state: ChatStreamState, text: string, onDelta?: (text: string) => void) {
    state.buffer += text;
    let index: number;
    while ((index = state.buffer.indexOf("\n")) >= 0) {
        const line = state.buffer.slice(0, index);
        state.buffer = state.buffer.slice(index + 1);
        handleChatLine(line, state, onDelta);
    }
}

/** POST {baseUrl}/v1/chat/completions（流式），累积 delta.content 并返回全文；error 事件会直接抛出。 */
export async function streamChatCompletions(config: AiConfig, messages: unknown[], options?: StreamOptions): Promise<string> {
    const response = await fetch(buildApiUrl(config.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ model: config.model, messages, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readError(response, "请求失败"));
    if (!response.body) {
        const text = chatMessageText(await response.json());
        if (!text) throw new Error("接口没有返回内容");
        return text;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ChatStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeChatStream(state, decoder.decode(value, { stream: true }), options?.onDelta);
    }
    consumeChatStream(state, decoder.decode(), options?.onDelta);
    if (state.buffer.trim()) handleChatLine(state.buffer, state, options?.onDelta);
    return state.text;
}

function extractAllUrls(text: string): string[] {
    const urls: string[] = [];
    const patterns = [/!\[[^\]]*\]\(([^)\s]+)\)/g, /\[[^\]]*\]\(([^)\s]+)\)/g, /https?:\/\/[^\s)\]]+/g];
    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text))) {
            const url = match[1] ?? match[0];
            if (url && !urls.includes(url)) urls.push(url);
        }
    }
    return urls;
}

export function extractImageUrls(text: string): string[] {
    const urls = extractAllUrls(text);
    if (!urls.length) throw new Error("接口没有返回图片链接");
    return urls;
}

export function extractVideoUrl(text: string): string {
    const urls = extractAllUrls(text);
    if (!urls.length) throw new Error("接口没有返回视频链接");
    return urls.find((url) => /\.mp4(\?|#|$)/i.test(url)) || urls[urls.length - 1];
}
