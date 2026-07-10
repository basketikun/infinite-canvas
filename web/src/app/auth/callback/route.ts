import { NextResponse } from "next/server";

import {
    canvasCookieOptions,
    createCanvasSession,
    getCanvasOAuthClientId,
    getCanvasOAuthClientSecret,
    getCanvasOAuthCookieName,
    getCanvasOAuthRedirectUri,
    getCanvasPublicOrigin,
    getCanvasSessionCookieName,
    getCanvasTokenOrigin,
    readOAuthCookie,
} from "@/lib/server/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenResponse = {
    access_token?: string;
    token_type?: string;
    scope?: string;
    user?: { sub?: string; username?: string };
    error?: string;
    error_description?: string;
};

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const loginUrl = new URL("/login", getCanvasPublicOrigin());
    const code = requestUrl.searchParams.get("code") || "";
    const state = requestUrl.searchParams.get("state") || "";
    const oauth = readOAuthCookie(readCookie(request.headers.get("cookie"), getCanvasOAuthCookieName()));

    if (!oauth || !code || state !== oauth.state) {
        loginUrl.searchParams.set("error", "登录请求已过期，请重新登录");
        return clearOAuthCookie(NextResponse.redirect(loginUrl));
    }

    try {
        const tokenUrl = new URL("/oauth/token", getCanvasTokenOrigin());
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: getCanvasOAuthRedirectUri(),
            code_verifier: oauth.verifier,
        });
        const basic = Buffer.from(`${getCanvasOAuthClientId()}:${getCanvasOAuthClientSecret()}`).toString("base64");
        const tokenResponse = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                Authorization: `Basic ${basic}`,
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
            body,
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
        });
        const payload = (await tokenResponse.json()) as TokenResponse;
        if (!tokenResponse.ok || !payload.access_token || payload.token_type?.toLowerCase() !== "bearer" || !payload.user?.sub || !payload.user.username) {
            throw new Error(payload.error_description || payload.error || `token exchange failed (${tokenResponse.status})`);
        }
        const session = createCanvasSession({
            issuer: getCanvasTokenOrigin(),
            subject: payload.user.sub,
            username: payload.user.username,
            accessToken: payload.access_token,
        });
        const response = NextResponse.redirect(new URL(oauth.returnTo, getCanvasPublicOrigin()));
        response.headers.set("Cache-Control", "no-store");
        response.cookies.set(getCanvasSessionCookieName(), session.sessionId, canvasCookieOptions(session.maxAge));
        return clearOAuthCookie(response);
    } catch (error) {
        console.error("Canvas OAuth callback failed", error instanceof Error ? error.message : "unknown error");
        loginUrl.searchParams.set("error", "登录配置失败，请稍后重试");
        return clearOAuthCookie(NextResponse.redirect(loginUrl));
    }
}

function clearOAuthCookie(response: NextResponse) {
    response.cookies.set(getCanvasOAuthCookieName(), "", canvasCookieOptions(0));
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
