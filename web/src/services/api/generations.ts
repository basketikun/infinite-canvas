import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";

export type GenerationMode = "image" | "edit";
export type GenerationStatus = "running" | "success" | "partial" | "failed";

export type GenerationRecord = {
  id: string;
  userId: string;
  prompt: string;
  mode: GenerationMode;
  model: string;
  size: string;
  quality: string;
  count: number;
  successCount: number;
  failCount: number;
  durationMs: number;
  status: GenerationStatus;
  thumbnails: string[];
  references: string[];
  // 失败 slot 的错误信息列表（每个失败一条）
  errors?: string[];
  // 调用反代时实际带的请求参数（mode、size、quality、n、references 数量等），仅供 admin 审计
  requestParams?: Record<string, unknown>;
  // 最近一次反代上游响应 raw JSON 字符串（去掉 b64_json 后），仅供 admin 审计
  upstreamMeta?: string;
  createdAt: string;
};

export type GenerationListResponse = {
  items: GenerationRecord[];
  total: number;
};

export type GenerationQuery = {
  page?: number;
  pageSize?: number;
};

export type SaveGenerationPayload = {
  id?: string;
  prompt: string;
  mode: GenerationMode;
  model: string;
  size: string;
  quality: string;
  count: number;
  successCount: number;
  failCount: number;
  durationMs: number;
  status: GenerationStatus;
  thumbnails: string[];
  references: string[];
  errors?: string[];
  requestParams?: Record<string, unknown>;
  upstreamMeta?: string;
};

export async function fetchGenerations(token: string, query: GenerationQuery = {}) {
  return apiGet<GenerationListResponse>("/api/generations", compactApiParams(query), token);
}

export async function saveGeneration(token: string, payload: SaveGenerationPayload) {
  return apiPost<GenerationRecord>("/api/generations", payload, token);
}

export async function deleteGeneration(token: string, id: string) {
  return apiDelete<boolean>(`/api/generations/${encodeURIComponent(id)}`, token);
}
