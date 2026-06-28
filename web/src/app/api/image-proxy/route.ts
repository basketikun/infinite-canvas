import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedHosts = new Set(["pbs.twimg.com"]);

export async function GET(request: NextRequest) {
    const target = request.nextUrl.searchParams.get("url") || "";
    const url = parseAllowedImageUrl(target);
    if (!url) return new Response("Invalid image URL", { status: 400 });

    const response = await fetch(url, {
        headers: {
            "user-agent": "Mozilla/5.0",
            accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        cache: "force-cache",
    }).catch(() => null);

    if (!response) return new Response("Image fetch failed", { status: 502 });

    if (!response.ok) return new Response("Image fetch failed", { status: response.status });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return new Response("Unsupported content type", { status: 502 });

    return new Response(response.body, {
        headers: {
            "content-type": contentType,
            "cache-control": "public, max-age=604800, stale-while-revalidate=86400",
        },
    });
}

function parseAllowedImageUrl(value: string) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") return null;
        if (!allowedHosts.has(url.hostname)) return null;
        if (!url.pathname.startsWith("/media/")) return null;
        return url;
    } catch {
        return null;
    }
}
