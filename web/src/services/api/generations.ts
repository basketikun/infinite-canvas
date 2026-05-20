import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";

export type GenerationMode = "image" | "edit";
export type GenerationStatus = "success" | "partial" | "failed";

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
