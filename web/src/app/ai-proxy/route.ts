import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_PROXY_TIMEOUT_MS = 300000;

async function proxy(request: NextRequest) {
    const target = request.headers.get("x-ai-target") || "";
    if (!target) return new Response("Missing x-ai-target", { status: 400 });

    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return new Response("Invalid x-ai-target", { status: 400 });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return new Response("Unsupported AI target", { status: 400 });

    const method = request.method;
    const headers = new Headers();
    copyHeader(request, headers, "Authorization", "Authorization");
    copyHeader(request, headers, "x-goog-api-key", "x-goog-api-key");
    copyHeader(request, headers, "Content-Type", "Content-Type");
    copyHeader(request, headers, "Accept", "Accept");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_PROXY_TIMEOUT_MS);
    try {
        const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
        console.log(`[ai-proxy] ${method} ${url.href} ${body?.byteLength || 0}B`);
        if (body?.byteLength) {
            try {
                const bodyText = new TextDecoder().decode(body).slice(0, 500);
                console.log(`[ai-proxy] body: ${bodyText}`);
            } catch {
                console.log(`[ai-proxy] body: <binary ${body.byteLength}B>`);
            }
        }
        const response = await fetch(url, { method, headers, body: body?.byteLength ? body : undefined, signal: controller.signal });
        console.log(`[ai-proxy] ${method} ${url.href} -> ${response.status}`);
        if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            console.log(`[ai-proxy] error response: ${errorText.slice(0, 500)}`);
            return new Response(errorText || response.statusText, { status: response.status, headers: { "content-type": "text/plain; charset=utf-8" } });
        }
        return new Response(response.body, { status: response.status, headers: responseHeaders(response.headers) });
    } catch (error) {
        console.log(`[ai-proxy] fetch error:`, error);
        if (error instanceof Error && error.name === "AbortError") return new Response("AI proxy timeout", { status: 504 });
        return new Response(error instanceof Error ? error.message : "AI proxy error", { status: 502 });
    } finally {
        clearTimeout(timer);
    }
}

export const GET = proxy;
export const POST = proxy;

function copyHeader(request: NextRequest, headers: Headers, from: string, to: string) {
    const value = request.headers.get(from);
    if (value) headers.set(to, value);
}

function responseHeaders(headers: Headers) {
    const result = new Headers();
    ["content-type", "content-encoding", "transfer-encoding", "content-disposition"].forEach((key) => {
        const value = headers.get(key);
        if (value) result.set(key, value);
    });
    return result;
}
