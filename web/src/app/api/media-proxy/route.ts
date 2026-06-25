import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url") || "";
    if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: "Invalid media URL" }, { status: 400 });

    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok) return NextResponse.json({ error: "Failed to fetch media" }, { status: upstream.status });

    return new NextResponse(upstream.body, {
        status: 200,
        headers: {
            "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
            "Cache-Control": "private, max-age=300",
        },
    });
}
