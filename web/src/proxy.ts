import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/auth/callback", "/api/auth/", "/_next/", "/favicon.ico", "/logo.svg"];

export function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.next();

    const hasSession = request.cookies.has("__Host-canvas_session") || request.cookies.has("canvas_session");
    if (hasSession) return NextResponse.next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("return_to", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ["/((?!.*\\.[^/]+$).*)"],
};
