import { NextResponse } from "next/server";

import { getCanvasPublicOrigin, getCanvasSession, getCanvasTokenOrigin, type CanvasCapability } from "@/lib/server/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const CAPABILITY_HEADER = "x-canvas-capability";
const LONG_RUNNING_IMAGE_ROUTE = /^\/v1\/images\/(generations|edits)$/;
// Leading JSON whitespace keeps Cloudflare alive without changing the final upstream payload.
const JSON_HEARTBEAT = new TextEncoder().encode(" ".repeat(2048) + "\n");
const ALLOWED_ROUTES: Array<{ method: string; pattern: RegExp; capabilities: CanvasCapability[] }> = [
    { method: "POST", pattern: /^\/v1\/responses$/, capabilities: ["text"] },
    { method: "POST", pattern: /^\/v1\/chat\/completions$/, capabilities: ["audio"] },
    { method: "POST", pattern: /^\/v1\/images\/(generations|edits)$/, capabilities: ["image"] },
    { method: "POST", pattern: /^\/v1\/videos$/, capabilities: ["video"] },
    { method: "GET", pattern: /^\/v1\/videos\/[^/]+(?:\/content)?$/, capabilities: ["video"] },
    { method: "POST", pattern: /^\/v1\/contents\/generations\/tasks$/, capabilities: ["video"] },
    { method: "GET", pattern: /^\/v1\/contents\/generations\/tasks\/[^/]+$/, capabilities: ["video"] },
    { method: "POST", pattern: /^\/v1\/audio\/speech$/, capabilities: ["audio"] },
];

async function proxyRequest(request: Request, context: { params: Promise<{ path: string[] }> }) {
    const session = await getCanvasSession();
    if (!session) return NextResponse.json({ error: { message: "登录已失效，请重新登录" } }, { status: 401 });

    const path = "/" + (await context.params).path.join("/");
    const route = ALLOWED_ROUTES.find((candidate) => candidate.method === request.method && candidate.pattern.test(path));
    if (!route) return NextResponse.json({ error: { message: "不允许的模型接口" } }, { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== getCanvasPublicOrigin()) {
        return NextResponse.json({ error: { message: "请求来源校验失败" } }, { status: 403 });
    }

    const capability = request.headers.get(CAPABILITY_HEADER) as CanvasCapability | null;
    if (!capability || !route.capabilities.includes(capability)) {
        return NextResponse.json({ error: { message: "模型能力类型不匹配" } }, { status: 400 });
    }

    const incomingUrl = new URL(request.url);
    const upstreamUrl = new URL(path, getCanvasTokenOrigin());
    upstreamUrl.search = incomingUrl.search;
    const headers = new Headers(request.headers);
    for (const name of [
        CAPABILITY_HEADER,
        "authorization",
        "proxy-authorization",
        "cookie",
        "host",
        "origin",
        "referer",
        "content-length",
        "connection",
        "transfer-encoding",
        "forwarded",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-real-ip",
        "cf-connecting-ip",
        "true-client-ip",
    ]) {
        headers.delete(name);
    }
    headers.set("Authorization", "Bearer " + session.accessTokens[capability]);
    headers.set("Accept-Encoding", "identity");

    const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(600_000)]),
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        init.duplex = "half";
    }

    if (LONG_RUNNING_IMAGE_ROUTE.test(path)) return proxyLongRunningJson(request, upstreamUrl, init);

    try {
        const upstream = await fetch(upstreamUrl, init);
        const responseHeaders = new Headers(upstream.headers);
        for (const name of ["set-cookie", "connection", "transfer-encoding", "content-encoding"]) responseHeaders.delete(name);
        responseHeaders.set("Cache-Control", "no-store");
        return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
    } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499 });
        console.error("Canvas AI proxy failed", error instanceof Error ? error.message : "unknown error");
        return NextResponse.json({ error: { message: "模型服务暂时不可用" } }, { status: 502 });
    }
}

function proxyLongRunningJson(request: Request, upstreamUrl: URL, init: RequestInit & { duplex?: "half" }) {
    const upstreamController = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const enqueue = (value: Uint8Array) => {
                if (!stopped) controller.enqueue(value);
            };
            enqueue(JSON_HEARTBEAT);
            heartbeat = setInterval(() => enqueue(JSON_HEARTBEAT), 15_000);
            void (async () => {
                try {
                    const upstream = await fetch(upstreamUrl, {
                        ...init,
                        signal: AbortSignal.any([init.signal as AbortSignal, upstreamController.signal]),
                    });
                    if (upstream.body) {
                        const reader = upstream.body.getReader();
                        while (!stopped) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            enqueue(value);
                        }
                    }
                } catch (error) {
                    if (!request.signal.aborted && !stopped) {
                        console.error("Canvas long-running AI proxy failed", error instanceof Error ? error.message : "unknown error");
                        enqueue(new TextEncoder().encode(JSON.stringify({ error: { message: "模型服务暂时不可用" } })));
                    }
                } finally {
                    if (heartbeat) clearInterval(heartbeat);
                    if (!stopped) controller.close();
                    stopped = true;
                }
            })();
        },
        cancel() {
            stopped = true;
            if (heartbeat) clearInterval(heartbeat);
            upstreamController.abort();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            "Cache-Control": "no-store, no-transform",
            "Content-Type": "application/json; charset=utf-8",
            "X-Accel-Buffering": "no",
            "X-Canvas-Proxy-Stream": "1",
        },
    });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
