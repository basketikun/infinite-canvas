import { CONTROL_PLANE_URL } from "@/constant/runtime-config";
import { requestControlPlane } from "./client";

export const AUTH_TOKEN_KEY = "infinite-canvas-control-plane-session";
export type AuthUser = { id: string; username: string; displayName: string; avatarUrl: string; role: "guest" | "user" | "admin"; credits: number };
export type AuthSession = { token: string; user: AuthUser };
export type AuthPayload = { username: string; password: string };

export function login(payload: AuthPayload, baseUrl = CONTROL_PLANE_URL, fetcher?: typeof fetch) {
    return requestControlPlane<AuthSession>("/api/auth/login", { baseUrl, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, fetcher);
}

export function fetchCurrentUser(token: string) {
    return requestControlPlane<AuthUser>("/api/auth/me", { token });
}
