import { NextResponse } from "next/server";

import { getCanvasSession } from "@/lib/server/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const session = await getCanvasSession();
    if (!session) return NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(
        {
            authenticated: true,
            user: { sub: session.subject, username: session.username },
            expiresAt: session.expiresAt,
        },
        { headers: { "Cache-Control": "no-store" } },
    );
}
