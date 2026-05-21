import { apiGet, compactApiParams } from "@/services/api/request";
import type { GenerationRecord } from "@/services/api/generations";
import type { CreditLog } from "@/services/api/user";

export type AdminGenerationItem = GenerationRecord & {
  username: string;
};

export type AdminGenerationListResponse = {
  items: AdminGenerationItem[];
  total: number;
};

export type AdminGenerationQuery = {
  keyword?: string;
  userId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function fetchAdminGenerations(token: string, query: AdminGenerationQuery = {}) {
  return apiGet<AdminGenerationListResponse>("/api/admin/generations", compactApiParams(query), token);
}

export type AdminCreditLogItem = CreditLog & {
  username: string;
  operatorUsername: string;
};

export type AdminCreditLogListResponse = {
  items: AdminCreditLogItem[];
  total: number;
};

export type AdminCreditLogQuery = {
  keyword?: string;
  userId?: string;
  type?: string;
  page?: number;
  pageSize?: number;
};

export async function fetchAdminCreditLogs(token: string, query: AdminCreditLogQuery = {}) {
  return apiGet<AdminCreditLogListResponse>("/api/admin/credit-logs", compactApiParams(query), token);
}
