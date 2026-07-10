import { NextResponse } from "next/server";

import { canvasCookieOptions, createOAuthRequest, getCanvasOAuthClientId, getCanvasOAuthCookieName, getCanvasOAuthRedirectUri, getCanvasTokenOrigin, normalizeReturnTo } from "@/lib/server/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const returnTo = normalizeReturnTo(new URL(request.url).searchParams.get("return_to"));
        const oauth = createOAuthRequest(returnTo);
        const authorizeUrl = new URL("/oauth/authorize", getCanvasTokenOrigin());
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("client_id", getCanvasOAuthClientId());
        authorizeUrl.searchParams.set("redirect_uri", getCanvasOAuthRedirectUri());
        authorizeUrl.searchParams.set("state", oauth.state);
        authorizeUrl.searchParams.set("code_challenge", oauth.challenge);
        authorizeUrl.searchParams.set("code_challenge_method", "S256");

        const response = NextResponse.redirect(authorizeUrl);
        response.headers.set("Cache-Control", "no-store");
        response.cookies.set(getCanvasOAuthCookieName(), oauth.cookieValue, canvasCookieOptions(oauth.maxAge));
        return response;
    } catch (error) {
        console.error("Canvas login initialization failed", error instanceof Error ? error.message : "unknown error");
        return new NextResponse("Canvas login is not configured", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
