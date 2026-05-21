import { apiGet, apiPost, apiPut } from "@/services/api/request";

export const AUTH_TOKEN_KEY = "infinite-canvas-auth-token-v1";

export type UserRole = "guest" | "user" | "admin";

export type UserPreferences = {
  quality: string;
  size: string;
  count: string;
};

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  credits: number;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type AuthPayload = {
  username: string;
  password: string;
};

export async function login(payload: AuthPayload) {
  return apiPost<AuthSession>("/api/auth/login", payload);
}

export async function register(payload: AuthPayload) {
  return apiPost<AuthSession>("/api/auth/register", payload);
}

export async function fetchCurrentUser(token?: string) {
  return apiGet<AuthUser>("/api/auth/me", undefined, token);
}

export async function updateMyPreferences(token: string, payload: UserPreferences) {
  return apiPut<UserPreferences>("/api/user/preferences", payload, token);
}
