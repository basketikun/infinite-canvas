import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
    params: Promise<{ path: string[] }>;
};

const relayPrefixes = new Set(["v1", "v1beta", "mj", "suno"]);

function proxyHeaders(request: NextRequest) {
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("connection");
    headers.set("x-forwarded-host", request.nextUrl.host);
    headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
    return headers;
}

function responseHeaders(response: Response) {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    return headers;
}

async function proxy(request: NextRequest, context: RouteContext) {
    const { path } = await context.params;
    const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";
    const relayApiBaseUrl = process.env.MANGE_BACKEND_API_URL || apiBaseUrl;
    const encodedPath = path.map(encodeURIComponent).join("/");
    const isCanvasRelay = path[0] === "canvas";
    const targetPath = relayPrefixes.has(path[0]) ? `/${encodedPath}` : `/api/${encodedPath}`;
    const targetBaseUrl = relayPrefixes.has(path[0]) || isCanvasRelay ? relayApiBaseUrl : apiBaseUrl;
    const resolvedTargetPath = isCanvasRelay ? `/api/${encodedPath}` : targetPath;
    const target = `${targetBaseUrl.replace(/\/$/, "")}${resolvedTargetPath}${request.nextUrl.search}`;
    const hasBody = request.method !== "GET" && request.method !== "HEAD";

    try {
        const response = await fetch(target, {
            method: request.method,
            headers: proxyHeaders(request),
            body: hasBody ? request.body : undefined,
            duplex: hasBody ? "half" : undefined,
            redirect: "manual",
        } as RequestInit & { duplex?: "half" });

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders(response),
        });
    } catch (error) {
        console.error("Failed to proxy", target, error);
        return Response.json({ code: 1, data: null, msg: "接口连接失败，请确认后端服务已启动" }, { status: 502 });
    }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
