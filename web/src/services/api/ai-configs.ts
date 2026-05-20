import { apiDelete, apiGet, apiPost } from "@/services/api/request";

export type AdminAIConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  imageModel: string;
  textModel: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminAIConfigList = {
  items: AdminAIConfig[];
  total: number;
};

export type AdminAIConfigPayload = {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  imageModel: string;
  textModel: string;
};

export type AdminAIConfigTestResult = {
  modelCount: number;
};

export type AdminAIConfigProbeRequest = {
  id?: string;
  baseUrl: string;
  apiKey?: string;
};

export type AdminAIConfigProbeResult = {
  items: string[];
};

export async function fetchAdminAIConfigs(token: string) {
  return apiGet<AdminAIConfigList>("/api/admin/ai-configs", undefined, token);
}

export async function saveAdminAIConfig(token: string, payload: AdminAIConfigPayload) {
  return apiPost<AdminAIConfig>("/api/admin/ai-configs", payload, token);
}

export async function deleteAdminAIConfig(token: string, id: string) {
  return apiDelete<boolean>(`/api/admin/ai-configs/${encodeURIComponent(id)}`, token);
}

export async function enableAdminAIConfig(token: string, id: string) {
  return apiPost<boolean>(`/api/admin/ai-configs/${encodeURIComponent(id)}/enable`, undefined, token);
}

export async function testAdminAIConfig(token: string, id: string) {
  return apiPost<AdminAIConfigTestResult>(`/api/admin/ai-configs/${encodeURIComponent(id)}/test`, undefined, token);
}

export async function probeAdminAIConfigModels(token: string, payload: AdminAIConfigProbeRequest) {
  return apiPost<AdminAIConfigProbeResult>("/api/admin/ai-configs/probe-models", payload, token);
}
