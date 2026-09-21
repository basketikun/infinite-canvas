export type JsonRpcMessage = {
    jsonrpc: "2.0";
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code?: number; message?: string };
};

export interface CodexTransport {
    write(line: string): void;
    onData(handler: (chunk: string) => void): void;
    onExit(handler: (error?: Error) => void): void;
    dispose(): void;
}

export class CodexJsonRpcClient {
    private nextId = 1;
    private buffer = "";
    private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    private notificationHandler: ((method: string, params: unknown) => void) | null = null;
    private requestHandler: ((id: number, method: string, params: unknown) => void) | null = null;

    constructor(private readonly transport: CodexTransport) {
        transport.onData((chunk) => this.read(chunk));
        transport.onExit((error) => this.failAll(error?.message || "Codex runtime 已退出"));
    }

    onNotification(handler: (method: string, params: unknown) => void) {
        this.notificationHandler = handler;
    }

    onServerRequest(handler: (id: number, method: string, params: unknown) => void) {
        this.requestHandler = handler;
    }

    notify(method: string, params: unknown = {}) {
        this.transport.write(JSON.stringify({ jsonrpc: "2.0", method, params }));
    }

    respond(id: number, result: unknown) {
        this.transport.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
    }

    request(method: string, params: unknown = {}) {
        const id = this.nextId++;
        return new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.transport.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
    }

    dispose() {
        this.failAll("Codex runtime 已关闭");
        this.transport.dispose();
    }

    private read(chunk: string) {
        this.buffer += chunk;
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        for (const line of lines) {
            const text = line.trim();
            if (!text) continue;
            let message: JsonRpcMessage;
            try {
                message = JSON.parse(text) as JsonRpcMessage;
            } catch {
                continue;
            }
            this.dispatch(message);
        }
    }

    private dispatch(message: JsonRpcMessage) {
        if (typeof message.id === "number" && this.pending.has(message.id) && (message.result !== undefined || message.error)) {
            const pending = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) pending?.reject(new Error(message.error.message || "Codex 请求失败"));
            else pending?.resolve(message.result);
            return;
        }
        if (typeof message.id === "number" && message.method) {
            this.requestHandler?.(message.id, message.method, message.params);
            return;
        }
        if (message.method) this.notificationHandler?.(message.method, message.params);
    }

    private failAll(text: string) {
        const error = new Error(text);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
    }
}
