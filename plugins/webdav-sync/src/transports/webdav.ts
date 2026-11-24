import { SyncTransportError, type PluginSyncTransport } from "@infinite-canvas/plugin-sdk";

type Probe = Parameters<PluginSyncTransport["test"]>[0]["probe"];
type Failure = ConstructorParameters<typeof SyncTransportError>[0];

function credentials(values: Readonly<Record<string, string>>) {
    const { username = "", password = "" } = values;
    const headers = new Headers();
    if (username || password) {
        const bytes = new TextEncoder().encode(username + ":" + password);
        headers.set("Authorization", "Basic " + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")));
    }
    return headers;
}

// 每个请求默认 2 分钟，大文件按每 MB 额外 10 秒放宽，避免慢速网络传大文件时被中止。
async function timed<T>(active: AbortSignal, controller: AbortController, failure: Failure, action: () => Promise<T>, bytes = 0) {
    active.throwIfAborted();
    const timer = setTimeout(() => controller.abort(), 120000 + Math.ceil(bytes / 1048576) * 10000);
    try {
        const value = await action();
        active.throwIfAborted();
        controller.signal.throwIfAborted();
        return value;
    } catch (error) {
        active.throwIfAborted();
        // 宿主已判定的失败（如地址跳转）原样传回；其余保留超时或网络错误原文，便于用户判断原因。
        if (error instanceof Error && error.name === "SyncTransportError") throw error;
        throw new SyncTransportError(failure, controller.signal.aborted ? "请求超时" : error instanceof Error ? error.message : undefined);
    } finally { clearTimeout(timer); }
}

function checkAuth(status: number) {
    if (status === 401 || status === 403) throw new SyncTransportError("AUTH", `HTTP ${status}`);
}

// RFC 9110 §8.8.3：引号内是原样传回的 opaque-tag，逗号和反斜杠都可以是版本的一部分。
function strongETag(value: string | null): string {
    if (typeof value !== "string" || !/^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(value)) throw new SyncTransportError("REVISION_UNAVAILABLE");
    return value;
}

function directories(probe: Probe, auth: Headers) {
    const caches = new WeakMap<AbortSignal, Map<string, Promise<void>>>();
    async function status(path: readonly string[], method: "MKCOL" | "PROPFIND", active: AbortSignal, failure: Failure) {
        const headers = new Headers(auth);
        if (method === "PROPFIND") headers.set("Depth", "0");
        const controller = new AbortController();
        const result = await timed(active, controller, failure, () => probe(path, method, headers, AbortSignal.any([active, controller.signal])));
        checkAuth(result);
        return result;
    }
    async function ensure(path: readonly string[], active: AbortSignal, owner = active) {
        let cache = caches.get(owner);
        if (!cache) { cache = new Map(); caches.set(owner, cache); }
        for (let i = 1; i <= path.length; i++) {
            const parts = path.slice(0, i), key = parts.join("/");
            if (!cache.has(key)) cache.set(key, (async () => {
                const created = await status(parts, "MKCOL", active, "DIRECTORY");
                if (created >= 200 && created < 300) return;
                if (created === 405 || created === 423) {
                    const existing = await status(parts, "PROPFIND", active, "DIRECTORY");
                    if (existing >= 200 && existing < 300) return;
                }
                throw new SyncTransportError("DIRECTORY", `HTTP ${created}`);
            })());
            await cache.get(key);
        }
    }
    return { status, ensure };
}

export const webdavTransport: PluginSyncTransport = {
    title: "WebDAV 同步",
    defaultDirectory: "infinite-canvas",
    fields: [{ key: "username", title: "用户名" }, { key: "password", title: "应用密码", secret: true }],
    async test(ctx) {
        const dirs = directories(ctx.probe, credentials(ctx.values));
        await dirs.ensure(ctx.directory, ctx.signal);
        const status = await dirs.status(ctx.directory, "PROPFIND", ctx.signal, "TEST");
        if (status < 200 || status >= 300) throw new SyncTransportError("TEST", `HTTP ${status}`);
    },
    open(ctx) {
        const auth = credentials(ctx.values);
        const dirs = directories(async (path, method, headers, signal) => (await ctx.request(path, { method, headers, signal })).status, auth);
        async function get<T>(path: string, caller: AbortSignal, metadata: (response: Response) => T, cache?: RequestCache) {
            const active = AbortSignal.any([ctx.signal, caller]);
            const controller = new AbortController();
            const signal = AbortSignal.any([active, controller.signal]);
            try {
                const response = await timed(active, controller, "READ", () => ctx.request([...ctx.directory, ...path.split("/")], { method: "GET", headers: auth, signal, cache }));
                checkAuth(response.status);
                if (response.status === 404) return null;
                if (response.status >= 400) throw new SyncTransportError("READ", `HTTP ${response.status}`);
                const fields = metadata(response);
                if (!response.ok) throw new SyncTransportError("READ", `HTTP ${response.status}`);
                return { ...fields, blob: await timed(active, controller, "READ", () => response.blob(), Number(response.headers.get("Content-Length"))) };
            } finally { controller.abort(); }
        }
        async function put(path: string, blob: Blob, type: string, caller: AbortSignal, condition?: ["If-Match" | "If-None-Match", string]) {
            const active = AbortSignal.any([ctx.signal, caller]);
            const headers = new Headers(auth);
            if (condition) headers.set(...condition);
            const parts = [...ctx.directory, ...path.split("/")];
            await dirs.ensure(parts.slice(0, -1), active, caller);
            const controller = new AbortController(), signal = AbortSignal.any([active, ctx.signal, controller.signal]);
            const body = blob.slice(0, blob.size, type);
            headers.set("Content-Type", body.type || "application/octet-stream");
            try {
                const response = await timed(active, controller, "WRITE", () => ctx.request(parts, { method: "PUT", headers, body, signal }), body.size);
                checkAuth(response.status);
                if (condition && response.status === 412) throw new SyncTransportError("REMOTE_CONFLICT");
                if (!response.ok) throw new SyncTransportError("WRITE", `HTTP ${response.status}`);
                if (condition && !(condition[0] === "If-None-Match" ? response.status === 201 : response.status === 200 || response.status === 204)) throw new SyncTransportError("REVISION_UNAVAILABLE", `HTTP ${response.status}`);
            } finally { controller.abort(); }
        }
        return {
            async read(path, active = ctx.signal) { return (await get(path, active, () => ({})))?.blob ?? null; },
            write(path, blob, type, active = ctx.signal) { return put(path, blob, type, active); },
            readManifest(path, active = ctx.signal) {
                return get(path, active, (response) => {
                    if (response.status !== 200 || response.headers.has("Content-Range")) throw new SyncTransportError("REVISION_UNAVAILABLE");
                    return { revision: strongETag(response.headers.get("ETag")) };
                }, "no-store");
            },
            async publishManifest(path, blob, expected, active = ctx.signal) {
                return put(path, blob, "application/json", active, expected === null ? ["If-None-Match", "*"] : ["If-Match", strongETag(expected)]);
            },
        };
    },
};
