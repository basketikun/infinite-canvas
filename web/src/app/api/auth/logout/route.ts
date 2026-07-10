import { NextResponse } from "next/server";

import { canvasCookieOptions, deleteCanvasSession, getCanvasPublicOrigin, getCanvasSessionCookieName } from "@/lib/server/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    if (request.headers.get("origin") !== getCanvasPublicOrigin()) {
        return NextResponse.json({ error: "请求来源校验失败" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const cookieName = getCanvasSessionCookieName();
    deleteCanvasSession(readCookie(request.headers.get("cookie"), cookieName));
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(cookieName, "", canvasCookieOptions(0));
    return response;
}

function readCookie(header: string | null, name: string) {
    if (!header) return undefined;
    for (const part of header.split(";")) {
        const [key, ...value] = part.trim().split("=");
        if (key === name) return value.join("=");
    }
    return undefined;
}
