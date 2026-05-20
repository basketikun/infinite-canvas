import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";

export type AdminUserRole = "user" | "admin";

export type AdminUser = {
  id: string;
  username: string;
  role: AdminUserRole;
  credits: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserList = {
  items: AdminUser[];
  total: number;
};

export type AdminUserQuery = {
  keyword?: string;
  page?: number;
  pageSize?: number;
};

export type AdminUserPayload = {
  id?: string;
  username: string;
  password?: string;
  role: AdminUserRole;
  credits: number;
};

export async function fetchAdminUsers(token: string, query: AdminUserQuery = {}) {
  return apiGet<AdminUserList>("/api/admin/users", compactApiParams(query), token);
}

export async function saveAdminUser(token: string, payload: AdminUserPayload) {
  return apiPost<AdminUser>("/api/admin/users", payload, token);
}

export async function deleteAdminUser(token: string, id: string) {
  return apiDelete<boolean>(`/api/admin/users/${encodeURIComponent(id)}`, token);
}
