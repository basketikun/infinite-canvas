import { NextResponse } from "next/server";

import { getCanvasPublicOrigin, getCanvasSession, getCanvasTokenOrigin } from "@/lib/server/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const ALLOWED_ROUTES: Array<{ method: string; pattern: RegExp }> = [
    { method: "GET", pattern: /^\/v1\/models$/ },
    { method: "POST", pattern: /^\/v1\/responses$/ },
    { method: "POST", pattern: /^\/v1\/images\/(generations|edits)$/ },
    { method: "POST", pattern: /^\/v1\/videos$/ },
    { method: "GET", pattern: /^\/v1\/videos\/[^/]+(?:\/content)?$/ },
    { method: "POST", pattern: /^\/v1\/contents\/generations\/tasks$/ },
    { method: "GET", pattern: /^\/v1\/contents\/generations\/tasks\/[^/]+$/ },
    { method: "POST", pattern: /^\/v1\/audio\/speech$/ },
];

async function proxyRequest(request: Request, context: { params: Promise<{ path: string[] }> }) {
    const session = await getCanvasSession();
    if (!session) return NextResponse.json({ error: { message: "登录已失效，请重新登录" } }, { status: 401 });

    const path = `/${(await context.params).path.join("/")}`;
    if (!ALLOWED_ROUTES.some((route) => route.method === request.method && route.pattern.test(path))) {
        return NextResponse.json({ error: { message: "不允许的模型接口" } }, { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== getCanvasPublicOrigin()) {
        return NextResponse.json({ error: { message: "请求来源校验失败" } }, { status: 403 });
    }

    const incomingUrl = new URL(request.url);
    const upstreamUrl = new URL(path, getCanvasTokenOrigin());
    upstreamUrl.search = incomingUrl.search;
    const headers = new Headers(request.headers);
    for (const name of [
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
    headers.set("Authorization", `Bearer ${session.accessToken}`);
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

export const GET = proxyRequest;
export const POST = proxyRequest;
