import { apiGet, compactApiParams } from "@/services/api/request";
import type { AuthUser } from "@/services/api/auth";

export type CreditLogType = "consume" | "admin_adjust" | "signup_bonus";

export type CreditLog = {
  id: string;
  userId: string;
  type: CreditLogType;
  amount: number;
  balance: number;
  model: string;
  relatedId: string;
  operatorId: string;
  remark: string;
  createdAt: string;
};

export type CreditLogListResponse = {
  items: CreditLog[];
  total: number;
};

export type CreditProfile = {
  user: AuthUser;
  totalConsumed: number;
  totalGranted: number;
  generatedCount: number;
};

export type CreditLogQuery = {
  page?: number;
  pageSize?: number;
};

export async function fetchProfile(token: string) {
  return apiGet<CreditProfile>("/api/user/profile", undefined, token);
}

export async function fetchCreditLogs(token: string, query: CreditLogQuery = {}) {
  return apiGet<CreditLogListResponse>("/api/user/credit-logs", compactApiParams(query), token);
}
