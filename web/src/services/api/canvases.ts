import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";

export type CanvasSummary = {
  id: string;
  userId: string;
  title: string;
  coverUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type CanvasRecord = {
  id: string;
  userId: string;
  title: string;
  coverUrl: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CanvasListResponse = {
  items: CanvasSummary[];
  total: number;
};

export type CanvasQuery = {
  keyword?: string;
  page?: number;
  pageSize?: number;
};

export type SaveCanvasPayload = {
  id?: string;
  title: string;
  coverUrl?: string;
  data: Record<string, unknown>;
};

export async function fetchCanvases(token: string, query: CanvasQuery = {}) {
  return apiGet<CanvasListResponse>("/api/canvases", compactApiParams(query), token);
}

export async function fetchCanvas(token: string, id: string) {
  return apiGet<CanvasRecord>(`/api/canvases/${encodeURIComponent(id)}`, undefined, token);
}

export async function saveCanvas(token: string, payload: SaveCanvasPayload) {
  return apiPost<CanvasRecord>("/api/canvases", payload, token);
}

export async function deleteCanvas(token: string, id: string) {
  return apiDelete<boolean>(`/api/canvases/${encodeURIComponent(id)}`, token);
}
